/**
 * Baseline load test: POST /events (batch) and GET /accounts/:id/summary.
 * Usage: k6 run scripts/load/baseline.js
 * Requires: k6 (https://k6.io/docs/getting-started/installation/)
 *
 * Current config: 50 req/sec (35 POST + 15 GET) for 60s = ~3000 requests total.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

function randomEvent(i) {
  const types = ['message_sent', 'call_made', 'form_submitted', 'login', 'custom'];
  const ts = new Date();
  ts.setDate(ts.getDate() - Math.floor(Math.random() * 7));
  return {
    event_id: `evt_${i}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    account_id: `acc_${Math.floor(Math.random() * 500) + 1}`,
    user_id: `user_${Math.floor(Math.random() * 2000) + 1}`,
    type: types[Math.floor(Math.random() * types.length)],
    timestamp: ts.toISOString(),
    metadata: {},
  };
}

function batchEvents(n) {
  return Array.from({ length: n }, (_, i) => randomEvent(i));
}

export const options = {
  scenarios: {
    post_events: {
      executor: 'constant-arrival-rate',
      rate: 35,          // 35 POST requests per second
      timeUnit: '1s',
      duration: '60s',
      preAllocatedVUs: 20,
      maxVUs: 50,
      startTime: '0s',
      exec: 'postEvents',
    },
    get_summary: {
      executor: 'constant-arrival-rate',
      rate: 15,          // 15 GET requests per second
      timeUnit: '1s',
      duration: '60s',
      preAllocatedVUs: 10,
      maxVUs: 30,
      startTime: '0s',
      exec: 'getSummary',
    },
  },
};

export function postEvents() {
  const body = JSON.stringify({ events: batchEvents(10) });
  const res = http.post(`${BASE_URL}/events`, body, {
    headers: { 'Content-Type': 'application/json' },
  });
  check(res, { 'POST /events status 201 or 207': (r) => r.status === 201 || r.status === 207 });
  sleep(0.5);
}

export function getSummary() {
  const accountId = `acc_${Math.floor(Math.random() * 500) + 1}`;
  const res = http.get(`${BASE_URL}/accounts/${accountId}/summary?window=last_24h`);
  check(res, { 'GET /accounts/:id/summary status 200': (r) => r.status === 200 });
  sleep(0.5);
}

// k6 prints P50/P95 latency and throughput by default. Run: k6 run scripts/load/baseline.js
