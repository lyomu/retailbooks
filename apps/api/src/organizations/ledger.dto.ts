import { LedgerAccountType, LedgerNormalBalance } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const trimUpper = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

const trimOrUndefined = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

const moneyString = ({ value }: { value: unknown }): unknown => {
  if (typeof value === 'number' && Number.isInteger(value)) return String(value);
  return typeof value === 'string' ? value.trim() : value;
};

export class CreateAccountDto {
  @IsString()
  @Length(2, 24)
  @Matches(/^[0-9A-Z.-]+$/, {
    message: 'code may contain uppercase letters, numbers, dots, and hyphens only',
  })
  @Transform(trimUpper)
  code!: string;

  @IsString()
  @Length(2, 120)
  @Transform(trim)
  name!: string;

  @IsIn(Object.values(LedgerAccountType))
  type!: LedgerAccountType;

  @IsIn(Object.values(LedgerNormalBalance))
  normalBalance!: LedgerNormalBalance;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  @Transform(trimOrUndefined)
  description?: string;
}

export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  @Length(2, 24)
  @Matches(/^[0-9A-Z.-]+$/, {
    message: 'code may contain uppercase letters, numbers, dots, and hyphens only',
  })
  @Transform(trimUpper)
  code?: string;

  @IsOptional()
  @IsString()
  @Length(2, 120)
  @Transform(trim)
  name?: string;

  @IsOptional()
  @IsIn(Object.values(LedgerAccountType))
  type?: LedgerAccountType;

  @IsOptional()
  @IsIn(Object.values(LedgerNormalBalance))
  normalBalance?: LedgerNormalBalance;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  @Transform(trimOrUndefined)
  description?: string;
}

export class JournalLineDto {
  @IsString()
  @Length(36, 36)
  accountId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  @Transform(trimOrUndefined)
  description?: string;

  @IsString()
  @Matches(/^\d+$/, { message: 'debitMinor must be a non-negative integer string' })
  @Transform(moneyString)
  debitMinor!: string;

  @IsString()
  @Matches(/^\d+$/, { message: 'creditMinor must be a non-negative integer string' })
  @Transform(moneyString)
  creditMinor!: string;

  @IsOptional()
  @IsString()
  @Length(36, 36)
  taxCodeId?: string;
}

export class UpsertJournalDto {
  @IsString()
  @IsISO8601({ strict: true })
  @Transform(trim)
  journalDate!: string;

  @IsString()
  @Length(3, 3)
  @Transform(trimUpper)
  currency!: string;

  @IsString()
  @Length(2, 240)
  @Transform(trim)
  description!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Transform(trimOrUndefined)
  sourceType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(trimOrUndefined)
  sourceId?: string;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => JournalLineDto)
  lines!: JournalLineDto[];
}

export class JournalQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(trimUpper)
  status?: string;
}

export class ReversalDto {
  @IsOptional()
  @IsISO8601({ strict: true })
  @Transform(trimOrUndefined)
  journalDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  @Transform(trimOrUndefined)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trimOrUndefined)
  idempotencyKey?: string;
}

export class TrialBalanceQueryDto {
  @IsOptional()
  @IsISO8601({ strict: true })
  @Transform(trimOrUndefined)
  asOf?: string;
}

export class AccountLedgerQueryDto {
  @IsOptional()
  @IsISO8601({ strict: true })
  @Transform(trimOrUndefined)
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  @Transform(trimOrUndefined)
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
