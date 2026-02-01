import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Event } from './entities/event.entity';
import { CreateEventDto } from './dto/create-event.dto';
// import { withRetry } from '../common/retry/retry.util';  // DISABLED for baseline test

@Injectable()
export class EventsService {
  constructor(
    @InjectRepository(Event)
    private readonly eventRepository: Repository<Event>,
  ) {}

  async createMany(dtos: CreateEventDto[]): Promise<{ accepted: number; errors?: Array<{ index: number; message: string }> }> {
    const errors: Array<{ index: number; message: string }> = [];
    let accepted = 0;

    // BASELINE: Per-event insert (no batch, no retry)
    for (let i = 0; i < dtos.length; i++) {
      const dto = dtos[i];
      try {
        const entity = this.eventRepository.create({
          event_id: dto.event_id,
          account_id: dto.account_id,
          user_id: dto.user_id,
          type: dto.type,
          timestamp: new Date(dto.timestamp),
          metadata: dto.metadata ?? {},
        });
        await this.eventRepository.save(entity);
        accepted++;
      } catch (e) {
        errors.push({ index: i, message: e instanceof Error ? e.message : 'Unknown error' });
      }
    }

    return { accepted, errors: errors.length > 0 ? errors : undefined };
  }
}
