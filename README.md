# Booking Guardian

Build a FastAPI + PostgreSQL + Redis booking API with a tiny HTML test UI.

KEY FEATURE: create booking with idempotency keys (same key = same result, no duplicates), prevent double-booking with DB constraints/locks, and send notifications through a background worker queue with retries and dead-letter handling.

Also: JWT auth, rate limiting (token bucket in Redis), Swagger docs, pytest suite including a concurrency test where 50 requests hit the same slot and only 1 succeeds.

SIGNATURE: /metrics endpoint and a page showing queue depth, retry count, p95 latency.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://happy-slots-api.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/9c0fe1c2-2465-4af2-93d4-0ec6e7ceaaee).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
