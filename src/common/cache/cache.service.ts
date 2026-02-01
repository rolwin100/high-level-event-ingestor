import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

const SUMMARY_TTL_SEC = 60;

@Injectable()
export class CacheService implements OnModuleDestroy {
  private redis: Redis | null = null;
  private enabled = false;

  constructor(private config: ConfigService) {
    const host = this.config.get<string>('REDIS_HOST', 'localhost');
    const port = this.config.get<number>('REDIS_PORT', 6379);
    try {
      this.redis = new Redis({
        host,
        port,
        maxRetriesPerRequest: 2,
        retryStrategy: (times) => (times > 2 ? null : 500),
        lazyConnect: true,
      });
      this.redis.on('error', () => {
        this.enabled = false;
      });
      this.redis.on('connect', () => {
        this.enabled = true;
      });
      this.redis.connect().then(() => (this.enabled = true)).catch(() => {});
    } catch {
      this.redis = null;
    }
  }

  async onModuleDestroy() {
    if (this.redis) {
      await this.redis.quit();
    }
  }

  async getSummary(accountId: string, window: string): Promise<string | null> {
    if (!this.enabled || !this.redis) return null;
    try {
      return await this.redis.get(`summary:${accountId}:${window}`);
    } catch {
      return null;
    }
  }

  async setSummary(accountId: string, window: string, json: string): Promise<void> {
    if (!this.enabled || !this.redis) return;
    try {
      await this.redis.setex(`summary:${accountId}:${window}`, SUMMARY_TTL_SEC, json);
    } catch {
      // ignore
    }
  }
}
