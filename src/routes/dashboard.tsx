import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Shell } from "@/components/Shell";
import { AuthPanel } from "@/components/AuthPanel";
import { useSession } from "@/hooks/use-session";
import { getMetrics, runWorker } from "@/lib/booking.functions";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Booking API — live metrics" },
      { name: "description", content: "Queue depth, retry count, dead letters and p95 latency, refreshed every 2 seconds." },
      { property: "og:title", content: "Booking API — live metrics" },
      { property: "og:description", content: "Queue depth, retries and p95 latency for the booking API." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { session, ready } = useSession();
  return (
    <Shell>
      <h1 className="mb-6 text-2xl font-semibold">Live metrics</h1>
      {!ready ? null : session ? <Metrics /> : <AuthPanel />}
    </Shell>
  );
}

const CARDS: [string, string, (v: number) => string][] = [
  ["queue_depth", "Queue depth", String],
  ["retry_count", "Retries", String],
  ["p95_latency_ms", "p95 latency", (v) => `${v.toFixed(0)} ms`],
  ["dlq_depth", "Dead-lettered", String],
  ["sent_count", "Sent", String],
  ["queue_delayed", "Waiting on backoff", String],
  ["p50_latency_ms", "p50 latency", (v) => `${v.toFixed(0)} ms`],
  ["bookings_total", "Bookings", String],
  ["samples", "Latency samples", String],
];

function Metrics() {
  const qc = useQueryClient();
  const fetchM = useServerFn(getMetrics);
  const work = useServerFn(runWorker);
  const m = useQuery({ queryKey: ["metrics"], queryFn: () => fetchM(), refetchInterval: 2000 });
  return (
    <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {CARDS.map(([k, label, fmt], i) => (
          <div key={k} className={i < 3 ? "stat stat-hero" : "stat"}>
            <div className="stat-label">{label}</div>
            <div className="stat-value">{m.data ? fmt(Number(m.data[k] ?? 0)) : "…"}</div>
          </div>
        ))}
      </div>
      <div className="mt-6 flex items-center gap-3 text-sm text-muted-foreground">
        <button
          className="btn-ghost"
          onClick={async () => {
            await work();
            qc.invalidateQueries({ queryKey: ["metrics"] });
          }}
        >
          Run worker now
        </button>
        Refreshes every 2 s. The provider fails 30% of the time; jobs retry with 1 s, 2 s, 4 s, 8 s backoff and are
        dead-lettered after 5 attempts.
      </div>
    </>
  );
}
