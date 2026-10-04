<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Booking integrity (idempotency, one-booking-per-slot, token bucket, job retry/dead-letter) lives in Postgres functions; server functions in src/lib/booking.functions.ts only call them — why: DB locks/constraints are the only safe concurrency boundary on stateless workers.
- Worker/metrics DB functions are service_role-only and called via the admin client inside handlers — why: users must not claim jobs or forge latencies.
