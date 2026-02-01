import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Event } from '../events/entities/event.entity';
import { CacheService } from '../common/cache/cache.service';
// import { withRetry } from '../common/retry/retry.util';  // DISABLED for baseline test
import { SummaryWindow } from './dto/summary-query.dto';

export interface AccountSummaryDto {
  account_id: string;
  window: string;
  totals: Record<string, number>;
  top_users: Array<{ user_id: string; events: number }>;
}

@Injectable()
export class AccountsService {
  constructor(
    @InjectRepository(Event)
    private readonly eventRepository: Repository<Event>,
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
    // BASELINE: No cache, no retry - direct DB query
    // const cached = await this.cache.getSummary(accountId, window);
    // if (cached) {
    //   return JSON.parse(cached) as AccountSummaryDto;
    // }

    const result = await this.computeSummary(accountId, window);
    // await this.cache.setSummary(accountId, window, JSON.stringify(result));  // DISABLED
    return result;
  }

  private async computeSummary(
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

    return {
      account_id: accountId,
      window,
      totals,
      top_users,
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
}
