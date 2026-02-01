import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { EventsService } from './events.service';
import { CreateEventDto } from './dto/create-event.dto';

export interface EventsJobData {
  events: CreateEventDto[];
}

@Processor('events')
export class EventsProcessor extends WorkerHost {
  private readonly logger = new Logger(EventsProcessor.name);

  constructor(private readonly eventsService: EventsService) {
    super();
  }

  async process(job: Job<EventsJobData>): Promise<{ accepted: number; errors?: Array<{ index: number; message: string }> }> {
    this.logger.log(`Processing job ${job.id} with ${job.data.events.length} events`);

    const result = await this.eventsService.createMany(job.data.events);

    if (result.errors && result.errors.length > 0) {
      this.logger.warn(`Job ${job.id} completed with ${result.errors.length} errors`);
    } else {
      this.logger.log(`Job ${job.id} completed: ${result.accepted} events accepted`);
    }

    return result;
  }
}
