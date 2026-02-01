import { Body, Controller, Post, HttpStatus, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { Response } from 'express';
import { TimeoutInterceptor } from '../common/timeout/timeout.interceptor';
import { CreateEventsBatchDto } from './dto/create-event.dto';
import type { EventsJobData } from './events.processor';

@Controller()
@UseGuards(ThrottlerGuard)
@UseInterceptors(new TimeoutInterceptor(15_000))
export class EventsController {
  constructor(
    @InjectQueue('events') private readonly eventsQueue: Queue<EventsJobData>,
  ) {}

  @Post('events')
  async createEvents(@Body() body: CreateEventsBatchDto, @Res({ passthrough: true }) res: Response) {
    const job = await this.eventsQueue.add('create', { events: body.events });
    res.status(HttpStatus.ACCEPTED);
    return { statusCode: 202, jobId: job.id, queued: body.events.length };
  }
}