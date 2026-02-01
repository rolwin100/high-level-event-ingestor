# Event injestion and analytics

write-heavy event ingestion and read-heavy account summaries, with performance and reliability hardening.

## How to Run the Service

1. **Start PostgreSQL and Redis**

   ```bash
   docker-compose up -d
   ```

2. **Install dependencies**

   ```bash
   pnpm install
   # or npm install --legacy-peer-deps
   ```

3. **Configure environment**

   Copy `.env.example` to `.env` and adjust if needed (defaults work with docker-compose):

   ```bash
   cp .env.example .env
   ```

4. **Run the app**

   The app uses TypeORM `synchronize: true` in dev, so the schema is created on startup. In prod we should not use this. I have added this because I want the schema to sync in ur system when ur viewing the application.

   ```bash
   npm run start:dev
   ```

   Service listens on `http://localhost:3000` (or `PORT` from `.env`).

## How to Run the Seed Script

Generate 1–5M events (default 1M). Requires PostgreSQL running (e.g. `docker-compose up -d`).

```bash
pnpm run seed
# or with a custom count (e.g. 2M):
npx tsx scripts/seed-events.ts 2000000
```

Uses batches of 5,000; progress is logged every 50k events.

## How to Run the Load Tests

**Prerequisites:** [k6](https://k6.io/docs/getting-started/installation/) installed. App and DB/Redis running.

```bash
# Default base URL: http://localhost:3000
k6 run scripts/load/baseline.js

# Custom base URL
BASE_URL=http://localhost:3000 k6 run scripts/load/baseline.js
```

The script runs two scenarios for 60s: POST /events (batches of 10) and GET /accounts/:id/summary. k6 prints P50/P95 latency and throughput by default.

- **Normal load:** ~200–500 req/min (adjust `rate` in the script).
- **Peak load:** increase `rate` and `maxVUs` (e.g. 2k–5k req/min).

## Part 1 – Baseline Service & Data Model

### Load definitions

- **Normal load:** 200–500 requests/minute across POST /events and GET /accounts/:id/summary.
- **Peak load:** 2,000–5,000 requests/minute (or higher; limited by machine/DB). The baseline k6 script runs at ~15 req/s (~900 req/min) with 10 POST /events/s and 5 GET /summary/s.

## API

### POST /events

Accepts a batch of events.

**Request body:**

```json
{
  "events": [
    {
      "event_id": "uuid-or-string",
      "account_id": "acc_123",
      "user_id": "user_456",
      "type": "message_sent | call_made | form_submitted | login | custom",
      "timestamp": "2025-01-01T10:00:00Z",
      "metadata": { "any": "shape" }
    }
  ]
}
```

**Response:** `201` with `{ "statusCode": 201, "accepted": N }` or `207` with `{ "statusCode": 207, "accepted": N, "errors": [...] }`.

### GET /accounts/:id/summary

Returns an aggregated view for the account.

**Query:** `?window=last_24h` or `last_7d` (default: `last_24h`).

**Response:**

```json
{
  "account_id": "acc_123",
  "window": "last_24h",
  "totals": {
    "message_sent": 1234,
    "call_made": 56,
    "form_submitted": 12
  },
  "top_users": [
    { "user_id": "user_1", "events": 400 },
    { "user_id": "user_2", "events": 300 }
  ]
}
```

## Baseline vs Improved Performance

| Change | What | Why | Trade-off |
|--------|------|-----|-----------|
| **Indexes** | Composite on `(account_id, timestamp)` and `(account_id, user_id, timestamp)` | Summary and top-users queries use indexes; avoids full scans. | Slightly slower writes; negligible at this scale. |
| **Batch writes** | Single bulk `INSERT` for POST /events instead of per-event save | One round-trip; less lock contention. | Large batches can hit DB limits; we use client batch size. |
| **Redis cache** | GET /accounts/:id/summary cached by `account_id` + `window`, TTL 60s | Repeated summary reads served from Redis; DB load and latency drop. | Data up to 60s stale; acceptable for analytics. |
| **Connection pooling** | TypeORM `extra.max: 20`, `idleTimeoutMillis`, `connectionTimeoutMillis` | Bounded connections; avoids exhaustion under spikes. | Tuning needed for higher concurrency. |
| **Summary aggregation in DB** | GROUP BY type and user_id instead of loading all events | No large in-memory aggregation; scales with event count. | N/A. |

**Before (baseline):** Per-event insert; summary loaded all events in memory; no cache.  
**After:** Bulk insert; summary via GROUP BY; Redis cache; pooling. Re-run the same k6 script to compare P50/P95 and throughput.

## Reliability Patterns Implemented

1. **Timeouts and retries with backoff**
   - DB path for POST /events (insert) and GET /accounts/:id/summary (aggregation) I have added timeouts and retries. For retry an helper function has been written which does and backoff when db is slow. So backoff increases retry time exponentially ex 100ms, 200ms, 400ms max of 3 times. The retry is helpfull during high load.

2. **Rate limiting**
   - **Where:** POST /events and GET /accounts/:id/summary via `ThrottlerGuard` (global limit per IP).
   - **How:** 500 requests per minute per IP (configurable in `AppModule`).
   - **Slow DB / spike:** Excess requests get 429 Too Many Requests; client should back off and retry with `Retry-After` (if we add the header).

## Design Doc

See [docs/design.md](docs/design.md) for:

- Avoiding global hotspots (e.g. one “whale” account)
- Exposing SLOs to Product/Business
- Protecting the system from misbehaving tenants

## Assumptions and Limitations

- **Single-node:** One app instance; no distributed cache invalidation or queue workers across nodes.
- **No auth:** Endpoints are unauthenticated; suitable for take-home and local/dev.
- **Windows:** Only `last_24h` and `last_7d`; no custom date ranges.
- **Schema:** TypeORM `synchronize: true` in code (dev); use migrations in production.
- **Redis optional:** If Redis is down, summary cache is skipped; app still works (no cache).
- **Duplicate events:** POST /events uses `orIgnore()` on conflict (e.g. duplicate `event_id`); duplicate events are skipped without error.

## License

MIT
