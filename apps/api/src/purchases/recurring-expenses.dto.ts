import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const trimOrUndefined = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

const trimUpper = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

const moneyString = ({ value }: { value: unknown }): unknown => {
  if (typeof value === 'number' && Number.isInteger(value)) return String(value);
  return typeof value === 'string' ? value.trim() : value;
};

export class CreateRecurringExpenseTemplateDto {
  @IsOptional()
  @IsString()
  @Length(36, 36)
  payeeVendorId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  @Transform(trimOrUndefined)
  payeeName?: string;

  @IsIn(['WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUALLY'])
  cadence!: string;

  @IsString()
  @IsISO8601({ strict: true })
  @Transform(trim)
  startDate!: string;

  @IsOptional()
  @IsString()
  @IsISO8601({ strict: true })
  @Transform(trimOrUndefined)
  endDate?: string;

  @IsOptional()
  @IsBoolean()
  autoCreate?: boolean;

  @IsString()
  @Length(36, 36)
  paidThroughAccountId!: string;

  @IsOptional()
  @IsString()
  @Length(36, 36)
  categoryId?: string;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  @Transform(trimUpper)
  currency?: string;

  @IsString()
  @Matches(/^\d+$/, { message: 'amountMinor must be a non-negative integer string' })
  @Transform(moneyString)
  amountMinor!: string;

  @IsOptional()
  @IsString()
  @Length(36, 36)
  taxCodeId?: string;
}

export class UpdateRecurringExpenseTemplateDto {
  @IsOptional()
  @IsString()
  @Length(36, 36)
  payeeVendorId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  @Transform(trimOrUndefined)
  payeeName?: string;

  @IsOptional()
  @IsIn(['WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUALLY'])
  cadence?: string;

  @IsOptional()
  @IsString()
  @IsISO8601({ strict: true })
  @Transform(trimOrUndefined)
  endDate?: string;

  @IsOptional()
  @IsBoolean()
  autoCreate?: boolean;

  @IsOptional()
  @IsString()
  @Length(36, 36)
  paidThroughAccountId?: string;

  @IsOptional()
  @IsString()
  @Length(36, 36)
  categoryId?: string;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  @Transform(trimUpper)
  currency?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, { message: 'amountMinor must be a non-negative integer string' })
  @Transform(moneyString)
  amountMinor?: string;

  @IsOptional()
  @IsString()
  @Length(36, 36)
  taxCodeId?: string;
}

export class ListRecurringExpenseTemplatesQueryDto {
  @IsOptional()
  @IsIn(['true', 'false'])
  active?: string;
}
