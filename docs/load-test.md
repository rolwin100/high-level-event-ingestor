# Load Test Documentation

## Prerequisites

- App running: `pnpm run start:dev`
- PostgreSQL and Redis running: `docker-compose up -d`
- Database seeded: `pnpm run seed 50000000` (1M+ events, tested with 5M)
- k6 installed
- htop installed
- **Rate limiter disabled:** Comment out `@UseGuards(ThrottlerGuard)` in `src/events/events.controller.ts` and `src/accounts/accounts.controller.ts` to avoid 429 errors during high-load tests

## Dataset Size

The system has been tested with **5 million events**. The optimizations (async queue, denormalized tables, Redis cache) maintain consistent performance at this scale.

## Running the Load Test

1. Start the app (in one terminal):
   ```bash
   pnpm run start:dev
   ```

2. Open htop (in another terminal):
   ```bash
   htop
   ```
   Note the Node process CPU % and memory during the test.

3. Run k6 (in another terminal):
   ```bash
   k6 run scripts/load/baseline.js
   ```

4. After 60s, k6 prints results. Record the values below.

---

## Baseline Results (Without Optimizations)

> **Note:** The baseline code (without optimizations) is available on branch [`feat/without-optimizations`](https://github.com/your-repo/tree/feat/without-optimizations).

**Optimizations disabled:**
- Rate limiting (ThrottlerGuard)
- Timeout interceptor
- Redis cache
- Batch insert (changed to per-event insert)
- Retries (withRetry)

| Metric | Value |
|--------|-------|
| **Throughput** | 14.86 req/s |
| **P50 latency** | 35.11 ms |
| **P90 latency** | 46.57 ms |
| **P95 latency** | 50.8 ms |
| **Max latency** | 91.35 ms |
| **Error rate** | 0% |
| **CPU (Node)** | 20 % |

### Checks

| Endpoint | Passed | Failed |
|----------|--------|--------|
| POST /events (201 or 207) | 600 | 0 |
| GET /accounts/:id/summary (200) | 300 | 0 |

### Bottlenecks Observed (15 req/sec)

- [x] Per-event insert slower than batch (higher latency)
- [x] No cache: every summary hits the DB
- [ ] Connection pool exhaustion
- [ ] CPU spike
- [ ] Event loop blocking

---

## Baseline Results - 50 req/sec (Without Optimizations)

| Metric | Value |
|--------|-------|
| **Throughput** | 49.51 req/s |
| **P50 latency** | 14.59 ms |
| **P90 latency** | 19.14 ms |
| **P95 latency** | 20.71 ms |
| **Max latency** | 251.22 ms |
| **Error rate** | 0% |
| **Dropped iterations** | 5 |
| **CPU (Node)** | 43% |

### Checks

| Endpoint | Passed | Failed |
|----------|--------|--------|
| POST /events (201 or 207) | ~2100 | 0 |
| GET /accounts/:id/summary (200) | ~900 | 0 |
| **Total** | 2996 | 0 |

### Bottlenecks Observed (50 req/sec)

- [x] Per-event insert slower than batch
- [x] No cache: every summary hits the DB
- [x] Max latency spike (251ms) under higher load
- [x] 5 dropped iterations (k6 couldn't keep up with target rate)
- [ ] Connection pool exhaustion
- [x] CPU spike

---

## After Optimizations - 50 req/sec

Results with all optimizations enabled:
- **Async queue (BullMQ):** POST /events returns 202 immediately
- **Denormalized tables:** Pre-aggregated summary data
- **Redis cache:** 60s TTL for summaries
- **Batch inserts + retries**

| Metric | Before (Baseline) | After (Optimized) | Improvement |
|--------|-------------------|-------------------|-------------|
| **Throughput** | 49.51 req/s | 49.60 req/s | Same |
| **P50 latency** | 14.59 ms | 2.0 ms | **7.3x faster** |
| **P90 latency** | 19.14 ms | 2.92 ms | **6.6x faster** |
| **P95 latency** | 20.71 ms | 3.54 ms | **5.8x faster** |
| **Max latency** | 251.22 ms | 37.56 ms | **6.7x faster** |
| **Error rate** | 0% | 0% | Same |
| **Dropped iterations** | 5 | 0 | **No drops** |
| **CPU (Node)** | 43% | 54% - 60% (makes sense because additional proceesing was added)| *(observe via htop)* |

### Checks (Optimized)

| Endpoint | Passed | Failed |
|----------|--------|--------|
| POST /events (202 queued) | 2100 | 0 |
| GET /accounts/:id/summary (200) | 901 | 0 |
| **Total** | 3001 | 0 |

### Improvements Observed

- [x] **~7x latency reduction** across all percentiles
- [x] **Max latency spikes eliminated** (251ms → 37ms)
- [x] **No dropped iterations** (k6 keeps up with target rate)
- [x] **Immediate response** for POST /events (async queue)
- [x] **Fast reads** from denormalized tables + cache

---

## Summary

| Configuration | P50 Latency | P95 Latency | Max Latency | Dropped |
|---------------|-------------|-------------|-------------|---------|
| Baseline @ 15 req/s | 35.11 ms | 50.8 ms | 91.35 ms | 0 |
| Baseline @ 50 req/s | 14.59 ms | 20.71 ms | 251.22 ms | 5 |
| **Optimized @ 50 req/s** | **2.0 ms** | **3.54 ms** | **37.56 ms** | **0** |

---

## Notes

### Test Configuration

| Test | POST rate | GET rate | Total | Duration | Requests |
|------|-----------|----------|-------|----------|----------|
| Baseline @ 15 req/s | 10/s | 5/s | 15/s | 60s | ~900 |
| Baseline @ 50 req/s | 35/s | 15/s | 50/s | 60s | ~3000 |
| Optimized @ 50 req/s | 35/s | 15/s | 50/s | 60s | ~3000 |

