// Live test against the real database. Runs only when TEST_EMAIL / TEST_PASSWORD
// (a confirmed account) and VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY are set.
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const email = process.env.TEST_EMAIL;
const password = process.env.TEST_PASSWORD;
const live = Boolean(url && key && email && password);

describe.skipIf(!live)("booking concurrency (live)", () => {
  it("50 concurrent requests on one slot → exactly 1 succeeds", async () => {
    const sb = createClient(url!, key!, { auth: { persistSession: false } });
    const { error } = await sb.auth.signInWithPassword({ email: email!, password: password! });
    expect(error).toBeNull();
    const { data: slot } = await sb
      .from("slots")
      .insert({ label: "concurrency-test", starts_at: new Date().toISOString() })
      .select("id")
      .single();
    const res = await Promise.all(
      Array.from({ length: 50 }, () =>
        sb.rpc("create_booking", { p_slot_id: slot!.id, p_key: crypto.randomUUID() }),
      ),
    );
    const codes = res.map((r) => (r.data as { status: number }).status);
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(49);
  });

  it("same idempotency key → same result, one booking", async () => {
    const sb = createClient(url!, key!, { auth: { persistSession: false } });
    await sb.auth.signInWithPassword({ email: email!, password: password! });
    const { data: slot } = await sb
      .from("slots")
      .insert({ label: "idem-test", starts_at: new Date().toISOString() })
      .select("id")
      .single();
    const k = crypto.randomUUID();
    const res = await Promise.all(
      Array.from({ length: 10 }, () => sb.rpc("create_booking", { p_slot_id: slot!.id, p_key: k })),
    );
    const bodies = new Set(res.map((r) => JSON.stringify((r.data as { body: unknown }).body)));
    expect(bodies.size).toBe(1);
    expect(res.every((r) => (r.data as { status: number }).status === 201)).toBe(true);
  });
});
