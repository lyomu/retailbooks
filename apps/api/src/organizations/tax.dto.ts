import { TaxTreatment } from '@prisma/client';
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

const rateString = ({ value }: { value: unknown }): unknown => {
  if (typeof value === 'number') return String(value);
  return typeof value === 'string' ? value.trim() : value;
};

export class CreateTaxCodeDto {
  @IsString()
  @Length(2, 24)
  @Matches(/^[0-9A-Z-]+$/, {
    message: 'code may contain uppercase letters, numbers, and hyphens only',
  })
  @Transform(trimUpper)
  code!: string;

  @IsString()
  @Length(2, 120)
  @Transform(trim)
  name!: string;

  @IsIn(Object.values(TaxTreatment))
  treatment!: TaxTreatment;

  @IsBoolean()
  recoverable!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  @Transform(trimOrUndefined)
  description?: string;

  @IsOptional()
  @IsString()
  @Length(36, 36)
  salesTaxAccountId?: string;

  @IsOptional()
  @IsString()
  @Length(36, 36)
  purchaseTaxAccountId?: string;
}

export class UpdateTaxCodeDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  @Transform(trim)
  name?: string;

  @IsOptional()
  @IsIn(Object.values(TaxTreatment))
  treatment?: TaxTreatment;

  @IsOptional()
  @IsBoolean()
  recoverable?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  @Transform(trimOrUndefined)
  description?: string;

  @IsOptional()
  @IsString()
  @Length(36, 36)
  salesTaxAccountId?: string;

  @IsOptional()
  @IsString()
  @Length(36, 36)
  purchaseTaxAccountId?: string;
}

export class CreateTaxRateDto {
  @IsString()
  @Matches(/^\d+(\.\d{1,4})?$/, {
    message: 'ratePercent must be a non-negative decimal with up to 4 places',
  })
  @Transform(rateString)
  ratePercent!: string;

  @IsString()
  @IsISO8601({ strict: true })
  @Transform(trim)
  effectiveFrom!: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  @Transform(trimOrUndefined)
  effectiveTo?: string;
}

export class CalculateTaxDto {
  @IsString()
  @Length(36, 36)
  taxCodeId!: string;

  @IsString()
  @Matches(/^\d+$/, { message: 'amountMinor must be a non-negative integer string' })
  @Transform(moneyString)
  amountMinor!: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  @Transform(trimOrUndefined)
  asOfDate?: string;
}
