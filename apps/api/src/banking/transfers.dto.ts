import { Transform } from 'class-transformer';
import { IsISO8601, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const trimOrUndefined = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

const moneyString = ({ value }: { value: unknown }): unknown => {
  if (typeof value === 'number' && Number.isInteger(value)) return String(value);
  return typeof value === 'string' ? value.trim() : value;
};

export class CreateTransferDto {
  @IsString()
  @Length(36, 36)
  fromFinancialAccountId!: string;

  @IsString()
  @Length(36, 36)
  toFinancialAccountId!: string;

  @IsString()
  @IsISO8601({ strict: true })
  @Transform(trim)
  transferDate!: string;

  @IsString()
  @Matches(/^\d+$/, { message: 'fromAmountMinor must be a non-negative integer string' })
  @Transform(moneyString)
  fromAmountMinor!: string;

  @IsString()
  @Matches(/^\d+$/, { message: 'toAmountMinor must be a non-negative integer string' })
  @Transform(moneyString)
  toAmountMinor!: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  @Transform(trimOrUndefined)
  description?: string;
}

export class ListTransfersQueryDto {
  @IsOptional()
  @IsString()
  @Length(36, 36)
  financialAccountId?: string;
}
