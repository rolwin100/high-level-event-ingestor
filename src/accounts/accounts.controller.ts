import { Controller, Get, Param, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { TimeoutInterceptor } from '../common/timeout/timeout.interceptor';
import { AccountsService } from './accounts.service';
import type { SummaryWindow } from './dto/summary-query.dto';

@Controller('accounts')
@UseGuards(ThrottlerGuard)
@UseInterceptors(new TimeoutInterceptor(15_000))
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Get('sample')
  async getSampleAccountIds(@Query('limit') limit?: string) {
    const n = limit != null ? Math.min(parseInt(limit, 10) || 10, 100) : 10;
    return this.accountsService.getSampleAccountIds(n);
  }

  @Get(':id/summary')
  async getSummary(
    @Param('id') id: string,
    @Query('window') window?: string,
  ) {
    const w: SummaryWindow = window === 'last_7d' ? 'last_7d' : 'last_24h';
    return this.accountsService.getSummary(id, w);
  }
}
