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

Accepts a batch of events. Events are queued for **async processing** via BullMQ and processed in the background.

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

**Response:** `202 Accepted` with `{ "statusCode": 202, "jobId": "...", "queued": N }`.

The endpoint returns immediately after queuing. Events are processed asynchronously by background workers.

**curl:**

```bash
curl -X POST http://localhost:3000/events \
  -H "Content-Type: application/json" \
  -d '{
    "events": [
      {
        "event_id": "evt_001",
        "account_id": "acc_123",
        "user_id": "user_456",
        "type": "message_sent",
        "timestamp": "2026-02-01T10:30:00.000Z",
        "metadata": { "channel": "email" }
      },
      {
        "event_id": "evt_002",
        "account_id": "acc_123",
        "user_id": "user_789",
        "type": "login",
        "timestamp": "2026-02-01T10:35:00.000Z"
      }
    ]
  }'
```

**Example response:**

```json
{
  "statusCode": 202,
  "jobId": "1",
  "queued": 2
}
```

### GET /accounts/sample

Returns a list of sample account IDs from the database (useful for testing).

**Query:** `?limit=N` (default: 10, max: 100).

**curl:**

```bash
curl http://localhost:3000/accounts/sample

# With limit
curl "http://localhost:3000/accounts/sample?limit=5"
```

**Example response:**

```json
{
  "account_ids": ["acc_001", "acc_002", "acc_003"]
}
```

### GET /accounts/:id/summary

Returns an aggregated view for the account. Uses Redis caching (60s TTL).

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

**curl:**

```bash
# Last 24 hours (default)
curl http://localhost:3000/accounts/acc_123/summary

# Last 7 days
curl "http://localhost:3000/accounts/acc_123/summary?window=last_7d"
```

## Baseline vs Improved Performance

| Change | What | Why | Trade-off |
|--------|------|-----|-----------|
| **Async processing (BullMQ)** | POST /events queues jobs for background processing | Immediate 202 response; decouples HTTP latency from DB writes; handles spikes gracefully. | Events not immediately visible; requires Redis for queue. |
| **Indexes** | Composite on `(account_id, timestamp)` and `(account_id, user_id, timestamp)` | Summary and top-users queries use indexes; avoids full scans. | Slightly slower writes; negligible at this scale. |
| **Batch writes** | Single bulk `INSERT` for POST /events instead of per-event save | One round-trip; less lock contention. | Large batches can hit DB limits; we use client batch size. |
| **Redis cache** | GET /accounts/:id/summary cached by `account_id` + `window`, TTL 60s | Repeated summary reads served from Redis; DB load and latency drop. | Data up to 60s stale; acceptable for analytics. |
| **Connection pooling** | TypeORM `extra.max: 20`, `idleTimeoutMillis`, `connectionTimeoutMillis` | Bounded connections; avoids exhaustion under spikes. | Tuning needed for higher concurrency. |
| **Summary aggregation in DB** | GROUP BY type and user_id instead of loading all events | No large in-memory aggregation; scales with event count. | N/A. |

**Before (baseline):** Per-event insert; synchronous processing; summary loaded all events in memory; no cache.  
**After:** Async queue (BullMQ); bulk insert; summary via GROUP BY; Redis cache; pooling. Re-run the same k6 script to compare P50/P95 and throughput.

## Reliability Patterns Implemented

1. **Async event processing (BullMQ)**
   - **Where:** POST /events queues jobs to Redis-backed BullMQ.
   - **How:** Events are processed by background workers with automatic retries (3 attempts, exponential backoff).
   - **Benefits:** HTTP response is immediate (202); DB write failures don't block clients; natural load leveling during spikes.

2. **Timeouts and retries with backoff**
   - DB path for POST /events (insert) and GET /accounts/:id/summary (aggregation) have timeouts and retries. A helper function (`withRetry`) implements exponential backoff (100ms, 200ms, 400ms, max 3 retries). Helpful during high load.

3. **Rate limiting**
   - **Where:** POST /events and GET /accounts/:id/summary via `ThrottlerGuard` (global limit per IP).
   - **How:** 500 requests per minute per IP (configurable in `AppModule`).
   - **Slow DB / spike:** Excess requests get 429 Too Many Requests; client should back off and retry with `Retry-After` (if we add the header).

## Design Doc

See [docs/design.md](docs/design.md) for:

- Avoiding global hotspots (e.g. one “whale” account)
- Exposing SLOs to Product/Business
- Protecting the system from misbehaving tenants

## Load Test Results

See [docs/load-test.md](docs/load-test.md) for baseline vs optimized performance benchmarks.

## Assumptions and Limitations

- **Single-node:** One app instance; no distributed cache invalidation. Queue workers run in the same process.
- **Redis required:** BullMQ and caching both require Redis. If Redis is down, event queuing will fail and summary cache is skipped.
- **Async events:** POST /events returns 202 immediately; events are processed in the background. There may be a slight delay before events appear in summaries.
- **No auth:** Endpoints are unauthenticated; suitable for take-home and local/dev.
- **Windows:** Only `last_24h` and `last_7d`; no custom date ranges.
- **Schema:** TypeORM `synchronize: true` in code (dev); use migrations in production.
- **Duplicate events:** POST /events uses `orIgnore()` on conflict (e.g. duplicate `event_id`); duplicate events are skipped without error.

## License

MIT
