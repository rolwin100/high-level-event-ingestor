import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Event } from './entities/event.entity';
import { CreateEventDto } from './dto/create-event.dto';
import { withRetry } from '../common/retry/retry.util';

@Injectable()
export class EventsService {
  constructor(
    @InjectRepository(Event)
    private readonly eventRepository: Repository<Event>,
  ) {}

  async createMany(dtos: CreateEventDto[]): Promise<{ accepted: number; errors?: Array<{ index: number; message: string }> }> {
    const errors: Array<{ index: number; message: string }> = [];
    let accepted = 0;

    // Batch insert with retry for resilience
    const entities = dtos.map((dto, i) => {
      try {
        return this.eventRepository.create({
          event_id: dto.event_id,
          account_id: dto.account_id,
          user_id: dto.user_id,
          type: dto.type,
          timestamp: new Date(dto.timestamp),
          metadata: dto.metadata ?? {},
        });
      } catch (e) {
        errors.push({ index: i, message: e instanceof Error ? e.message : 'Unknown error' });
        return null;
      }
    }).filter((e): e is Event => e !== null);

    if (entities.length > 0) {
      try {
        await withRetry(() =>
          this.eventRepository
            .createQueryBuilder()
            .insert()
            .into(Event)
            .values(entities)
            .orIgnore()
            .execute()
        );
        accepted = entities.length;
      } catch (e) {
        // If batch fails, fall back to individual inserts with retry
        for (let i = 0; i < entities.length; i++) {
          try {
            await withRetry(() => this.eventRepository.save(entities[i]));
            accepted++;
          } catch (err) {
            errors.push({ index: i, message: err instanceof Error ? err.message : 'Unknown error' });
          }
        }
      }
    }

    return { accepted, errors: errors.length > 0 ? errors : undefined };
  }
}
