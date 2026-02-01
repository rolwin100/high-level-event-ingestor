import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountSummary } from './entities/account-summary.entity';
import { AccountTopUsers } from './entities/account-top-users.entity';
import { CreateEventDto } from '../events/dto/create-event.dto';

/**
 * Service responsible for maintaining denormalized summary tables.
 * Called after events are inserted to update aggregated counts.
 */
@Injectable()
export class SummaryService {
  private readonly logger = new Logger(SummaryService.name);

  constructor(
    @InjectRepository(AccountSummary)
    private readonly summaryRepo: Repository<AccountSummary>,
    @InjectRepository(AccountTopUsers)
    private readonly topUsersRepo: Repository<AccountTopUsers>,
  ) {}

  /**
   * Updates denormalized tables based on newly inserted events.
   * Groups events by (account_id, date, type) and (account_id, date, user_id)
   * and performs upserts with count increments.
   */
  async updateSummaries(events: CreateEventDto[]): Promise<void> {
    if (events.length === 0) return;

    // Group events by (account_id, date, type)
    const typeCounts = new Map<string, { account_id: string; date: string; event_type: string; count: number }>();
    // Group events by (account_id, date, user_id)
    const userCounts = new Map<string, { account_id: string; date: string; user_id: string; count: number }>();

    for (const event of events) {
      const date = new Date(event.timestamp).toISOString().split('T')[0];

      // Aggregate type counts
      const typeKey = `${event.account_id}|${date}|${event.type}`;
      const existing = typeCounts.get(typeKey);
      if (existing) {
        existing.count++;
      } else {
        typeCounts.set(typeKey, {
          account_id: event.account_id,
          date,
          event_type: event.type,
          count: 1,
        });
      }

      // Aggregate user counts
      const userKey = `${event.account_id}|${date}|${event.user_id}`;
      const existingUser = userCounts.get(userKey);
      if (existingUser) {
        existingUser.count++;
      } else {
        userCounts.set(userKey, {
          account_id: event.account_id,
          date,
          user_id: event.user_id,
          count: 1,
        });
      }
    }

    // Upsert type counts (batch)
    await this.upsertTypeCounts(Array.from(typeCounts.values()));

    // Upsert user counts (batch)
    await this.upsertUserCounts(Array.from(userCounts.values()));

    this.logger.debug(
      `Updated summaries: ${typeCounts.size} type entries, ${userCounts.size} user entries`,
    );
  }

  private async upsertTypeCounts(
    entries: Array<{ account_id: string; date: string; event_type: string; count: number }>,
  ): Promise<void> {
    if (entries.length === 0) return;

    // Use raw query for efficient upsert with increment
    // PostgreSQL ON CONFLICT DO UPDATE to increment count
    for (const entry of entries) {
      await this.summaryRepo
        .createQueryBuilder()
        .insert()
        .into(AccountSummary)
        .values({
          account_id: entry.account_id,
          date: entry.date,
          event_type: entry.event_type,
          count: entry.count,
        })
        .orUpdate(['count', 'updated_at'], ['account_id', 'date', 'event_type'])
        .setParameter('count', entry.count)
        .execute()
        .catch(async () => {
          // Fallback: increment existing count
          await this.summaryRepo
            .createQueryBuilder()
            .update(AccountSummary)
            .set({ count: () => `count + ${entry.count}` })
            .where('account_id = :account_id', { account_id: entry.account_id })
            .andWhere('date = :date', { date: entry.date })
            .andWhere('event_type = :event_type', { event_type: entry.event_type })
            .execute();
        });
    }
  }

  private async upsertUserCounts(
    entries: Array<{ account_id: string; date: string; user_id: string; count: number }>,
  ): Promise<void> {
    if (entries.length === 0) return;

    for (const entry of entries) {
      await this.topUsersRepo
        .createQueryBuilder()
        .insert()
        .into(AccountTopUsers)
        .values({
          account_id: entry.account_id,
          date: entry.date,
          user_id: entry.user_id,
          event_count: entry.count,
        })
        .orUpdate(['event_count', 'updated_at'], ['account_id', 'date', 'user_id'])
        .setParameter('event_count', entry.count)
        .execute()
        .catch(async () => {
          // Fallback: increment existing count
          await this.topUsersRepo
            .createQueryBuilder()
            .update(AccountTopUsers)
            .set({ event_count: () => `event_count + ${entry.count}` })
            .where('account_id = :account_id', { account_id: entry.account_id })
            .andWhere('date = :date', { date: entry.date })
            .andWhere('user_id = :user_id', { user_id: entry.user_id })
            .execute();
        });
    }
  }
}
