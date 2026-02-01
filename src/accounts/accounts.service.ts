import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual } from 'typeorm';
import { Event } from '../events/entities/event.entity';
import { AccountSummary } from './entities/account-summary.entity';
import { AccountTopUsers } from './entities/account-top-users.entity';
import { CacheService } from '../common/cache/cache.service';
import { withRetry } from '../common/retry/retry.util';
import { SummaryWindow } from './dto/summary-query.dto';

export interface AccountSummaryDto {
  account_id: string;
  window: string;
  totals: Record<string, number>;
  top_users: Array<{ user_id: string; events: number }>;
  source?: 'denormalized' | 'aggregation'; // Indicates data source for debugging
}

@Injectable()
export class AccountsService {
  private readonly logger = new Logger(AccountsService.name);

  constructor(
    @InjectRepository(Event)
    private readonly eventRepository: Repository<Event>,
    @InjectRepository(AccountSummary)
    private readonly summaryRepository: Repository<AccountSummary>,
    @InjectRepository(AccountTopUsers)
    private readonly topUsersRepository: Repository<AccountTopUsers>,
    private readonly cache: CacheService,
  ) {}

  async getSampleAccountIds(limit = 10): Promise<{ account_ids: string[] }> {
    const rows = await this.eventRepository
      .createQueryBuilder('e')
      .select('DISTINCT e.account_id', 'account_id')
      .orderBy('e.account_id')
      .limit(limit)
      .getRawMany<{ account_id: string }>();
    return {
      account_ids: rows.map((r) => r.account_id),
    };
  }

  async getSummary(accountId: string, window: SummaryWindow = 'last_24h'): Promise<AccountSummaryDto> {
    // Check cache first
    const cached = await this.cache.getSummary(accountId, window);
    if (cached) {
      return JSON.parse(cached) as AccountSummaryDto;
    }

    // Try denormalized tables first (fast path), fall back to aggregation
    const result = await withRetry(() => this.computeSummaryFromDenormalized(accountId, window));
    await this.cache.setSummary(accountId, window, JSON.stringify(result));
    return result;
  }

  /**
   * Computes summary from denormalized tables (fast path).
   * Falls back to raw event aggregation if denormalized data is not available.
   */
  private async computeSummaryFromDenormalized(
    accountId: string,
    window: SummaryWindow,
  ): Promise<AccountSummaryDto> {
    const sinceDate = this.windowToDateString(window);

    try {
      // Read from denormalized summary table - simple SUM, no full table scan
      const totalsRows = await this.summaryRepository
        .createQueryBuilder('s')
        .select('s.event_type', 'type')
        .addSelect('SUM(s.count)', 'count')
        .where('s.account_id = :accountId', { accountId })
        .andWhere('s.date >= :sinceDate', { sinceDate })
        .groupBy('s.event_type')
        .getRawMany<{ type: string; count: string }>();

      // Read from denormalized top users table
      const topUsersRows = await this.topUsersRepository
        .createQueryBuilder('u')
        .select('u.user_id', 'user_id')
        .addSelect('SUM(u.event_count)', 'events')
        .where('u.account_id = :accountId', { accountId })
        .andWhere('u.date >= :sinceDate', { sinceDate })
        .groupBy('u.user_id')
        .orderBy('events', 'DESC')
        .limit(10)
        .getRawMany<{ user_id: string; events: string }>();

      // If we have data from denormalized tables, use it
      if (totalsRows.length > 0 || topUsersRows.length > 0) {
        const totals: Record<string, number> = {};
        for (const row of totalsRows) {
          totals[row.type] = parseInt(row.count, 10);
        }

        const top_users = topUsersRows.map((r) => ({
          user_id: r.user_id,
          events: parseInt(r.events, 10),
        }));

        this.logger.debug(`Summary for ${accountId} served from denormalized tables`);

        return {
          account_id: accountId,
          window,
          totals,
          top_users,
          source: 'denormalized',
        };
      }
    } catch (err) {
      this.logger.warn(`Failed to read from denormalized tables, falling back to aggregation: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // Fallback: aggregate from raw events table
    return this.computeSummaryFromEvents(accountId, window);
  }

  /**
   * Fallback: computes summary by aggregating raw events table.
   * Used when denormalized data is not available.
   */
  private async computeSummaryFromEvents(
    accountId: string,
    window: SummaryWindow,
  ): Promise<AccountSummaryDto> {
    const since = this.windowToDate(window);

    // Aggregation in DB: totals by type
    const totalsRows = await this.eventRepository
      .createQueryBuilder('e')
      .select('e.type', 'type')
      .addSelect('COUNT(*)', 'count')
      .where('e.account_id = :accountId', { accountId })
      .andWhere('e.timestamp >= :since', { since: since.toISOString() })
      .groupBy('e.type')
      .getRawMany<{ type: string; count: string }>();

    const totals: Record<string, number> = {};
    for (const row of totalsRows) {
      totals[row.type] = parseInt(row.count, 10);
    }

    // Top users: aggregation in DB
    const topUsersRows = await this.eventRepository
      .createQueryBuilder('e')
      .select('e.user_id', 'user_id')
      .addSelect('COUNT(*)', 'events')
      .where('e.account_id = :accountId', { accountId })
      .andWhere('e.timestamp >= :since', { since: since.toISOString() })
      .groupBy('e.user_id')
      .orderBy('events', 'DESC')
      .limit(10)
      .getRawMany<{ user_id: string; events: string }>();

    const top_users = topUsersRows.map((r) => ({
      user_id: r.user_id,
      events: parseInt(r.events, 10),
    }));

    this.logger.debug(`Summary for ${accountId} served from event aggregation (fallback)`);

    return {
      account_id: accountId,
      window,
      totals,
      top_users,
      source: 'aggregation',
    };
  }

  private windowToDate(window: SummaryWindow): Date {
    const now = new Date();
    if (window === 'last_24h') {
      const d = new Date(now);
      d.setHours(d.getHours() - 24);
      return d;
    }
    if (window === 'last_7d') {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      return d;
    }
    const d = new Date(now);
    d.setHours(d.getHours() - 24);
    return d;
  }

  private windowToDateString(window: SummaryWindow): string {
    return this.windowToDate(window).toISOString().split('T')[0];
  }
}
