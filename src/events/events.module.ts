import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Event } from './entities/event.entity';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { EventsProcessor } from './events.processor';
import { AccountsModule } from '../accounts/accounts.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Event]),
    BullModule.registerQueue({ name: 'events' }),
    forwardRef(() => AccountsModule),
  ],
  controllers: [EventsController],
  providers: [EventsService, EventsProcessor],
  exports: [EventsService],
})
export class EventsModule {}
