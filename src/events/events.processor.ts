import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { EventsService } from './events.service';
import { CreateEventDto } from './dto/create-event.dto';
import { SummaryService } from '../accounts/summary.service';

export interface EventsJobData {
  events: CreateEventDto[];
}

@Processor('events')
export class EventsProcessor extends WorkerHost {
  private readonly logger = new Logger(EventsProcessor.name);

  constructor(
    private readonly eventsService: EventsService,
    private readonly summaryService: SummaryService,
  ) {
    super();
  }

  async process(job: Job<EventsJobData>): Promise<{ accepted: number; errors?: Array<{ index: number; message: string }> }> {
    this.logger.log(`Processing job ${job.id} with ${job.data.events.length} events`);

    const result = await this.eventsService.createMany(job.data.events);

    // Update denormalized summary tables for fast reads
    if (result.accepted > 0) {
      try {
        await this.summaryService.updateSummaries(job.data.events);
        this.logger.debug(`Job ${job.id}: Updated denormalized summaries`);
      } catch (err) {
        // Log but don't fail the job - summaries are eventually consistent
        this.logger.warn(`Job ${job.id}: Failed to update summaries: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }

    if (result.errors && result.errors.length > 0) {
      // also the failed events can be retried using DLQ (Dead Letter Queue) which is a queue that is used to store failed jobs. Since its a assignment we will not be using it. But in a production environment it is a good practice to use it.
      this.logger.warn(`Job ${job.id} completed with ${result.errors.length} errors`);
    } else {
      this.logger.log(`Job ${job.id} completed: ${result.accepted} events accepted`);
    }

    return result;
  }
}
