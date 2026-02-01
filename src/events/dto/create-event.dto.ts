import {
  IsArray,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsIn,
  IsISO8601,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const EVENT_TYPES = ['message_sent', 'call_made', 'form_submitted', 'login', 'custom'] as const;

export class CreateEventDto {
  @IsString()
  @IsNotEmpty()
  event_id: string;

  @IsString()
  @IsNotEmpty()
  account_id: string;

  @IsString()
  @IsNotEmpty()
  user_id: string;

  @IsString()
  @IsIn(EVENT_TYPES)
  type: (typeof EVENT_TYPES)[number] | string;

  @IsISO8601()
  timestamp: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class CreateEventsBatchDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateEventDto)
  events: CreateEventDto[];
}
