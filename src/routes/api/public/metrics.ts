import { createFileRoute } from "@tanstack/react-router";

// Prometheus-style text exposition. Aggregate counters only — no user data.
export const Route = createFileRoute("/api/public/metrics")({
  server: {
    handlers: {
      GET: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.rpc("get_metrics");
        if (error) return new Response("metrics unavailable", { status: 503 });
        const raw = data as Record<string, number | undefined>;
        const g = (k: string) => Number(raw[k] ?? 0);
        const line = (name: string, help: string, type: string, v: number) =>
          `# HELP ${name} ${help}\n# TYPE ${name} ${type}\n${name} ${v}\n`;
        const body = [
          line("notify_queue_depth", "Jobs waiting (ready + delayed + processing)", "gauge", g("queue_depth")),
          line("notify_queue_delayed", "Jobs waiting for a retry backoff", "gauge", g("queue_delayed")),
          line("notify_dlq_depth", "Dead-lettered jobs", "gauge", g("dlq_depth")),
          line("notify_retries_total", "Retries scheduled", "counter", g("retry_count")),
          line("notify_sent_total", "Notifications sent", "counter", g("sent_count")),
          line("bookings_total", "Confirmed bookings", "counter", g("bookings_total")),
          line("http_latency_p95_ms", "p95 latency over last 1000 requests", "gauge", Number(g("p95_latency_ms").toFixed(2))),
          line("http_latency_p50_ms", "p50 latency over last 1000 requests", "gauge", Number(g("p50_latency_ms").toFixed(2))),
        ].join("");
        return new Response(body, { headers: { "content-type": "text/plain; version=0.0.4" } });
      },
    },
  },
});
