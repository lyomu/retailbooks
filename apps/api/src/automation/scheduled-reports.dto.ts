import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CalendarScheduleDto {
  @IsIn(['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUALLY'])
  cadence!: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUALLY';

  @IsString()
  localTime!: string;

  @IsObject()
  options?: Record<string, unknown>;
}

export class CreateScheduledReportDto {
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  name!: string;

  @IsUUID()
  savedReportId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  recipientUserIds!: string[];

  @IsIn(['csv', 'xlsx', 'pdf'])
  format!: 'csv' | 'xlsx' | 'pdf';

  @ValidateNested()
  @Type(() => CalendarScheduleDto)
  schedule!: CalendarScheduleDto;
}

export class UpdateScheduledReportDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  recipientUserIds?: string[];

  @IsOptional()
  @IsIn(['csv', 'xlsx', 'pdf'])
  format?: 'csv' | 'xlsx' | 'pdf';

  @IsOptional()
  @ValidateNested()
  @Type(() => CalendarScheduleDto)
  schedule?: CalendarScheduleDto;
}

export class ScheduledReportActiveDto {
  @IsBoolean()
  active!: boolean;
}
