import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Shell } from "@/components/Shell";
import { AuthPanel } from "@/components/AuthPanel";
import { useSession } from "@/hooks/use-session";
import { createBooking, createSlot, listSlots, myBookings } from "@/lib/booking.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Booking API — test console" },
      { name: "description", content: "Create slots and bookings with idempotency keys, and fire 50 concurrent requests at one slot." },
      { property: "og:title", content: "Booking API — test console" },
      { property: "og:description", content: "Idempotent, double-booking-safe bookings with a retrying notification queue." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

function Index() {
  const { session, ready } = useSession();
  return (
    <Shell>
      <h1 className="mb-1 text-2xl font-semibold">Booking API test console</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Idempotency keys · one booking per slot enforced by the database · queued notifications with retries.
      </p>
      {!ready ? null : session ? <Console /> : <AuthPanel />}
    </Shell>
  );
}

function Console() {
  const qc = useQueryClient();
  const fetchSlots = useServerFn(listSlots);
  const fetchMine = useServerFn(myBookings);
  const doSlot = useServerFn(createSlot);
  const doBook = useServerFn(createBooking);
  const slots = useQuery({ queryKey: ["slots"], queryFn: () => fetchSlots() });
  const mine = useQuery({ queryKey: ["mine"], queryFn: () => fetchMine() });

  const [label, setLabel] = useState("Haircut 10:00");
  const [at, setAt] = useState(() => new Date(Date.now() + 864e5).toISOString().slice(0, 16));
  const [key, setKey] = useState<string>(() => crypto.randomUUID());
  const [out, setOut] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["slots"] });
    qc.invalidateQueries({ queryKey: ["mine"] });
  };

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      setOut(await fn());
    } catch (e) {
      setOut({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
      refresh();
    }
  }

  const book = (slot_id: string) => run(() => doBook({ data: { slot_id, idempotency_key: key } }));

  const burst = () =>
    run(async () => {
      const free = slots.data?.find((s) => !s.booked);
      if (!free) return { detail: "No free slot — create one first." };
      const t = performance.now();
      const res = await Promise.all(
        Array.from({ length: 50 }, () =>
          doBook({ data: { slot_id: free.id, idempotency_key: crypto.randomUUID() } }).catch((e) => ({
            status: 500,
            body: String(e),
          })),
        ),
      );
      const counts: Record<number, number> = {};
      res.forEach((r) => (counts[r.status] = (counts[r.status] ?? 0) + 1));
      return {
        test: "50 concurrent requests, same slot, different keys",
        slot: free.label,
        status_counts: counts,
        winners: counts[201] ?? 0,
        verdict: (counts[201] ?? 0) === 1 ? "PASS — exactly one booking" : "CHECK — see counts (429 = rate limited)",
        wall_ms: Math.round(performance.now() - t),
      };
    });

  const replay = () =>
    run(async () => {
      const free = slots.data?.find((s) => !s.booked);
      if (!free) return { detail: "No free slot — create one first." };
      const k = crypto.randomUUID();
      const res = await Promise.all(
        Array.from({ length: 5 }, () => doBook({ data: { slot_id: free.id, idempotency_key: k } })),
      );
      const ids = new Set(res.map((r) => JSON.stringify(r.body)));
      return {
        test: "5 concurrent requests, same idempotency key",
        statuses: res.map((r) => r.status),
        replays: res.filter((r) => r.replay).length,
        identical_bodies: ids.size === 1,
      };
    });

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section className="panel">
        <h2 className="panel-title">1 · Create slot</h2>
        <div className="space-y-2">
          <input className="field" value={label} onChange={(e) => setLabel(e.target.value)} />
          <input className="field" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
          <button
            className="btn-primary"
            disabled={busy}
            onClick={() => run(() => doSlot({ data: { label, starts_at: new Date(at).toISOString() } }))}
          >
            Create slot
          </button>
        </div>
      </section>

      <section className="panel">
        <h2 className="panel-title">2 · Idempotency-Key</h2>
        <input className="field mb-2" value={key} onChange={(e) => setKey(e.target.value)} />
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost" onClick={() => setKey(crypto.randomUUID())}>New key</button>
          <button className="btn-ghost" disabled={busy} onClick={replay}>Same key ×5</button>
          <button className="btn-danger" disabled={busy} onClick={burst}>Fire 50 at one slot</button>
        </div>
      </section>

      <section className="panel">
        <h2 className="panel-title">Slots</h2>
        <ul className="divide-y divide-border text-sm">
          {slots.data?.length === 0 && <li className="py-2 text-muted-foreground">No slots yet.</li>}
          {slots.data?.map((s) => (
            <li key={s.id} className="flex items-center justify-between py-2">
              <span>
                {s.label} <span className="text-muted-foreground">· {new Date(s.starts_at).toLocaleString()}</span>
              </span>
              {s.booked ? (
                <span className="tag-booked">booked</span>
              ) : (
                <button className="btn-ghost" disabled={busy} onClick={() => book(s.id)}>Book</button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2 className="panel-title">Response</h2>
        <pre className="code-block">{out ? JSON.stringify(out, null, 2) : "—"}</pre>
        <p className="mt-3 text-xs text-muted-foreground">My bookings: {mine.data?.length ?? 0}</p>
      </section>
    </div>
  );
}
