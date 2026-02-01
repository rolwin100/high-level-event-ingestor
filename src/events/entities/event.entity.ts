import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

export type EventType =
  | 'message_sent'
  | 'call_made'
  | 'form_submitted'
  | 'login'
  | 'custom';

@Entity('events')
@Index(['account_id', 'timestamp'])
@Index(['account_id', 'user_id', 'timestamp'])
export class Event {
  @PrimaryColumn({ type: 'varchar' })
  event_id: string;

  @Column({ type: 'varchar' })
  account_id: string;

  @Column({ type: 'varchar' })
  user_id: string;

  @Column({ type: 'varchar', length: 50 })
  type: EventType | string;

  @Column({ type: 'timestamptz' })
  timestamp: Date;

  @Column({ type: 'jsonb', nullable: true, default: {} })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
