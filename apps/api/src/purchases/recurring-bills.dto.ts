import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
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

export class RecurringBillTemplateLineDto {
  @IsOptional()
  @IsString()
  @Length(36, 36)
  itemId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  @Transform(trimOrUndefined)
  description?: string;

  @IsString()
  @Matches(/^\d+(\.\d{1,4})?$/, {
    message: 'quantity must be a non-negative decimal string with up to 4 places',
  })
  @Transform(trim)
  quantity!: string;

  @IsString()
  @Matches(/^\d+$/, { message: 'unitPriceMinor must be a non-negative integer string' })
  @Transform(moneyString)
  unitPriceMinor!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, { message: 'discountMinor must be a non-negative integer string' })
  @Transform(moneyString)
  discountMinor?: string;

  @IsOptional()
  @IsString()
  @Length(36, 36)
  taxCodeId?: string;

  @IsOptional()
  @IsString()
  @Length(36, 36)
  accountId?: string;

  @IsOptional()
  @IsString()
  @Length(36, 36)
  warehouseId?: string;
}

export class CreateRecurringBillTemplateDto {
  @IsString()
  @Length(36, 36)
  vendorId!: string;

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
  @IsString()
  @Length(3, 3)
  @Transform(trimUpper)
  currency?: string;

  @IsOptional()
  @IsBoolean()
  autoCreate?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => RecurringBillTemplateLineDto)
  lines!: RecurringBillTemplateLineDto[];
}

export class UpdateRecurringBillTemplateDto {
  @IsOptional()
  @IsString()
  @Length(36, 36)
  vendorId?: string;

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
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => RecurringBillTemplateLineDto)
  lines?: RecurringBillTemplateLineDto[];
}

export class ListRecurringBillTemplatesQueryDto {
  @IsOptional()
  @IsIn(['true', 'false'])
  active?: string;
}
