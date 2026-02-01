# Load Test Documentation

## Prerequisites

- App running: `pnpm run start:dev`
- PostgreSQL and Redis running: `docker-compose up -d`
- Database seeded: `npm run seed` (1M+ events)
- k6 installed
- htop installed

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

## After Optimizations

Run the same test with optimizations enabled (current app).

| Metric | Before | After |
|--------|--------|-------|
| **Throughput** | _____ req/s | _____ req/s |
| **P50 latency** | _____ ms | _____ ms |
| **P90 latency** | _____ ms | _____ ms |
| **P95 latency** | _____ ms | _____ ms |
| **Error rate** | _____ % | _____ % |
| **CPU (Node)** | _____ % | _____ % |
| **Memory (Node)** | _____ MB | _____ MB |

---

## Notes

### Test Configuration

| Test | POST rate | GET rate | Total | Duration | Requests |
|------|-----------|----------|-------|----------|----------|
| Baseline @ 15 req/s | 10/s | 5/s | 15/s | 60s | ~900 |
| Baseline @ 50 req/s | 35/s | 15/s | 50/s | 60s | ~3000 |

