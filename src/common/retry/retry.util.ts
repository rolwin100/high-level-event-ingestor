/**
 * Retry with exponential backoff for DB/external calls.
 * Used to avoid cascading failures when DB is slow or temporarily unavailable.
 */
const defaultOptions = {
  retries: 3,
  minTimeout: 100,
  maxTimeout: 2000,
  factor: 2,
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<typeof defaultOptions> = {},
): Promise<T> {
  const opts = { ...defaultOptions, ...options };
  let lastError: unknown;
  let delay = opts.minTimeout;

  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt === opts.retries) break;
      await new Promise((r) => setTimeout(r, Math.min(delay, opts.maxTimeout)));
      delay *= opts.factor;
    }
  }
  throw lastError;
}
