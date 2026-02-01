import { Entity, Column, PrimaryColumn, Index, UpdateDateColumn } from 'typeorm';

/**
 * Denormalized table for fast top-users lookups.
 * Stores daily event counts per user per account.
 * Updated incrementally when events are processed.
 */
@Entity('account_top_users')
@Index(['account_id', 'date'])
@Index(['account_id', 'date', 'event_count'])
export class AccountTopUsers {
  @PrimaryColumn({ type: 'varchar' })
  account_id: string;

  @PrimaryColumn({ type: 'date' })
  date: string;

  @PrimaryColumn({ type: 'varchar' })
  user_id: string;

  @Column({ type: 'int', default: 0 })
  event_count: number;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
