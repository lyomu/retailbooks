import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class RecurringJournalLineDto {
  @IsString()
  accountId!: string;

  @Matches(/^\d+$/, { message: 'debitMinor must be a non-negative integer string' })
  debitMinor!: string;

  @Matches(/^\d+$/, { message: 'creditMinor must be a non-negative integer string' })
  creditMinor!: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  description?: string;
}

export class CreateRecurringJournalTemplateDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  memo?: string;

  @IsIn(['WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUALLY'])
  cadence!: 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUALLY';

  @IsDateString({}, { message: 'startDate must be an ISO date' })
  startDate!: string;

  @IsOptional()
  @IsDateString({}, { message: 'endDate must be an ISO date' })
  endDate?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecurringJournalLineDto)
  lines!: RecurringJournalLineDto[];
}

export class UpdateRecurringJournalTemplateDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  memo?: string;

  @IsOptional()
  @IsIn(['WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUALLY'])
  cadence?: 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUALLY';

  @IsOptional()
  @IsDateString({}, { message: 'endDate must be an ISO date' })
  endDate?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecurringJournalLineDto)
  lines?: RecurringJournalLineDto[];
}
