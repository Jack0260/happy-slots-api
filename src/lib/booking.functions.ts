import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { MAX_ATTEMPTS, sendNotification } from "./notify";

export type ApiResult = { status: number; body: Json; replay?: boolean; ms?: number };

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function record(op: string, start: number, status: number) {
  const ms = performance.now() - start;
  const a = await admin();
  await a.rpc("record_latency", { p_op: op, p_ms: ms, p_status: status });
  return ms;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function limited(supabase: any, capacity = 20, refill = 5): Promise<boolean> {
  const { data, error } = await supabase.rpc("take_token", { p_capacity: capacity, p_refill: refill });
  if (error) throw new Error(error.message);
  return data === true;
}

export async function drainQueue(limit = 20) {
  const a = await admin();
  const { data: jobs, error } = await a.rpc("claim_jobs", { p_limit: limit });
  if (error) throw new Error(error.message);
  const results: Record<string, number> = { sent: 0, retry: 0, dead: 0 };
  for (const job of jobs ?? []) {
    let ok = true;
    let err: string | null = null;
    try {
      await sendNotification(job);
    } catch (e) {
      ok = false;
      err = e instanceof Error ? e.message : String(e);
    }
    const { data } = await a.rpc("complete_job", {
      p_id: job.id,
      p_ok: ok,
      p_error: err ?? undefined,
      p_max_attempts: MAX_ATTEMPTS,
    });
    if (typeof data === "string" && data in results) results[data]++;
  }
  return { processed: jobs?.length ?? 0, ...results };
}

export const listSlots = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [{ data: slots, error }, { data: booked }] = await Promise.all([
      context.supabase.from("slots").select("id,label,starts_at").order("starts_at"),
      context.supabase.rpc("get_booked_slot_ids"),
    ]);
    if (error) throw new Error(error.message);
    const set = new Set((booked ?? []).map((r: { slot_id: string }) => r.slot_id));
    return (slots ?? []).map((s) => ({ ...s, booked: set.has(s.id) }));
  });

export const createSlot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ label: z.string().trim().min(1).max(120), starts_at: z.string().datetime() }).parse(d),
  )
  .handler(async ({ context, data }): Promise<ApiResult> => {
    const t = performance.now();
    if (!(await limited(context.supabase))) {
      return { status: 429, body: { detail: "Rate limit exceeded" }, ms: await record("create_slot", t, 429) };
    }
    const { data: row, error } = await context.supabase
      .from("slots")
      .insert({ label: data.label, starts_at: data.starts_at, created_by: context.userId })
      .select("id,label,starts_at")
      .single();
    const status = error ? 400 : 201;
    return { status, body: error ? { detail: error.message } : row, ms: await record("create_slot", t, status) };
  });

export const createBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ slot_id: z.string().uuid(), idempotency_key: z.string().min(1).max(255) }).parse(d),
  )
  .handler(async ({ context, data }): Promise<ApiResult> => {
    const t = performance.now();
    // Bucket: 60 tokens, refills 20/s — enough for the 50-request burst test.
    if (!(await limited(context.supabase, 60, 20))) {
      return { status: 429, body: { detail: "Rate limit exceeded" }, ms: await record("create_booking", t, 429) };
    }
    const { data: res, error } = await context.supabase.rpc("create_booking", {
      p_slot_id: data.slot_id,
      p_key: data.idempotency_key,
    });
    if (error) throw new Error(error.message);
    const r = res as { status: number; body: Json; replay: boolean };
    const ms = await record("create_booking", t, r.status);
    // Wake the worker on enqueue (new booking => new notification job).
    if (r.status === 201 && !r.replay) await drainQueue(5);
    return { ...r, ms };
  });

export const myBookings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("bookings")
      .select("id,slot_id,status,created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const runWorker = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => drainQueue(50));

export const getMetrics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const a = await admin();
    // Process due retries whenever the dashboard is open, then report.
    await drainQueue(20);
    const { data, error } = await a.rpc("get_metrics");
    if (error) throw new Error(error.message);
    return data as Record<string, number>;
  });
