import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
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

export class CreditNoteLineDto {
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

  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, { message: 'unitPriceMinor must be a non-negative integer string' })
  @Transform(moneyString)
  unitPriceMinor?: string;

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
  revenueAccountId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(trimOrUndefined)
  projectTag?: string;
}

export class CreateCreditNoteDto {
  @IsString()
  @Length(36, 36)
  contactId!: string;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  @Transform(trimUpper)
  currency?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CreditNoteLineDto)
  lines!: CreditNoteLineDto[];
}

export class UpdateCreditNoteDto {
  @IsOptional()
  @IsString()
  @Length(36, 36)
  contactId?: string;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  @Transform(trimUpper)
  currency?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CreditNoteLineDto)
  lines?: CreditNoteLineDto[];
}

export class ListCreditNotesQueryDto {
  @IsOptional()
  @IsIn(['DRAFT', 'ISSUED', 'APPLIED', 'REFUNDED', 'VOID'])
  status?: string;
}

export class CreditNoteAllocationLineDto {
  @IsString()
  @Length(36, 36)
  invoiceId!: string;

  @IsString()
  @Matches(/^\d+$/, { message: 'amountMinor must be a non-negative integer string' })
  @Transform(moneyString)
  amountMinor!: string;
}

export class AllocateCreditNoteDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CreditNoteAllocationLineDto)
  allocations!: CreditNoteAllocationLineDto[];
}

export class RefundCreditNoteDto {
  @IsString()
  @Matches(/^\d+$/, { message: 'amountMinor must be a non-negative integer string' })
  @Transform(moneyString)
  amountMinor!: string;
}
