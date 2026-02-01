import { Entity, Column, PrimaryColumn, Index, UpdateDateColumn } from 'typeorm';

/**
 * Denormalized table for fast account summary lookups.
 * Stores daily event counts by type per account.
 * Updated incrementally when events are processed.
 */
@Entity('account_summary')
@Index(['account_id', 'date'])
export class AccountSummary {
  @PrimaryColumn({ type: 'varchar' })
  account_id: string;

  @PrimaryColumn({ type: 'date' })
  date: string;

  @PrimaryColumn({ type: 'varchar', length: 50 })
  event_type: string;

  @Column({ type: 'int', default: 0 })
  count: number;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
