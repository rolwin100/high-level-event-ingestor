import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Event } from '../events/entities/event.entity';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { SummaryService } from './summary.service';
import { AccountSummary } from './entities/account-summary.entity';
import { AccountTopUsers } from './entities/account-top-users.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Event, AccountSummary, AccountTopUsers]),
  ],
  controllers: [AccountsController],
  providers: [AccountsService, SummaryService],
  exports: [SummaryService],
})
export class AccountsModule {}
