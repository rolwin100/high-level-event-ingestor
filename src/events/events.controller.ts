import { Body, Controller, Post, HttpStatus, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { TimeoutInterceptor } from '../common/timeout/timeout.interceptor';
import { EventsService } from './events.service';
import { CreateEventsBatchDto } from './dto/create-event.dto';

@Controller()
@UseGuards(ThrottlerGuard)
@UseInterceptors(new TimeoutInterceptor(15_000))
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Post('events')
  async createEvents(@Body() body: CreateEventsBatchDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.eventsService.createMany(body.events);
    if (result.errors && result.errors.length > 0 && result.accepted === 0) {
      res.status(HttpStatus.BAD_REQUEST);
      return { statusCode: 400, message: 'Validation failed', errors: result.errors };
    }
    if (result.errors && result.errors.length > 0 && result.accepted > 0) {
      res.status(207);
      return { statusCode: 207, accepted: result.accepted, errors: result.errors };
    }
    return { statusCode: 201, accepted: result.accepted };
  }
}