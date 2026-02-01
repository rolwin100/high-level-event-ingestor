/**
 * Seed script: generates 1–5M events and inserts in batches.
 * Usage: npx ts-node -r tsconfig-paths/register scripts/seed-events.ts [count]
 * Default count: 1_000_000. Max 5_000_000.
 */
import { DataSource } from 'typeorm';
import { Event } from '../src/events/entities/event.entity';

const EVENT_TYPES = ['message_sent', 'call_made', 'form_submitted', 'login', 'custom'] as const;
const BATCH_SIZE = 5000;

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomElement<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateEvent(index: number): Partial<Event> {
  const accountId = `acc_${randomInt(1, 500)}`;
  const userId = `user_${randomInt(1, 2000)}`;
  const type = randomElement(EVENT_TYPES);
  const daysAgo = randomInt(0, 7);
  const hoursAgo = randomInt(0, 23);
  const timestamp = new Date();
  timestamp.setDate(timestamp.getDate() - daysAgo);
  timestamp.setHours(timestamp.getHours() - hoursAgo, randomInt(0, 59), 0, 0);

  return {
    event_id: `evt_${index}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    account_id: accountId,
    user_id: userId,
    type,
    timestamp,
    metadata: {},
  };
}

async function main() {
  const total = Math.min(
    Math.max(parseInt(process.argv[2] || '1000000', 10), 1),
    5_000_000,
  );

  const dataSource = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/event_ingestion',
    entities: [Event],
    synchronize: false,
  });

  await dataSource.initialize();
  const repo = dataSource.getRepository(Event);

  console.log(`Seeding ${total.toLocaleString()} events in batches of ${BATCH_SIZE}...`);
  const start = Date.now();
  let inserted = 0;

  for (let offset = 0; offset < total; offset += BATCH_SIZE) {
    const batchSize = Math.min(BATCH_SIZE, total - offset);
    const events = Array.from({ length: batchSize }, (_, i) => {
      const e = generateEvent(offset + i);
      return repo.create(e) as Event;
    });
    await repo.save(events);
    inserted += batchSize;
    if (inserted % 50_000 === 0 || inserted === total) {
      console.log(`  ${inserted.toLocaleString()} / ${total.toLocaleString()}`);
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`Done. Inserted ${inserted.toLocaleString()} events in ${elapsed}s`);
  await dataSource.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
