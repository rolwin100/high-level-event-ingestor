import { IsIn, IsOptional } from 'class-validator';

const WINDOWS = ['last_24h', 'last_7d'] as const;
export type SummaryWindow = (typeof WINDOWS)[number];

export class SummaryQueryDto {
  @IsOptional()
  @IsIn(WINDOWS)
  window?: SummaryWindow;
}
