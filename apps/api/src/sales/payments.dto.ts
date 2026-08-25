import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';

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

export class CreatePaymentDto {
  @IsString()
  @Length(36, 36)
  contactId!: string;

  @IsString()
  @IsISO8601({ strict: true })
  @Transform(trimOrUndefined)
  receivedDate!: string;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  @Transform(trimUpper)
  currency?: string;

  @IsString()
  @Matches(/^\d+$/, { message: 'amountMinor must be a non-negative integer string' })
  @Transform(moneyString)
  amountMinor!: string;
}

export class PaymentAllocationLineDto {
  @IsString()
  @Length(36, 36)
  invoiceId!: string;

  @IsString()
  @Matches(/^\d+$/, { message: 'amountMinor must be a non-negative integer string' })
  @Transform(moneyString)
  amountMinor!: string;
}

export class AllocatePaymentDto {
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PaymentAllocationLineDto)
  allocations!: PaymentAllocationLineDto[];
}

export class ListPaymentsQueryDto {
  @IsOptional()
  @IsIn(['UNAPPLIED', 'PARTIALLY_ALLOCATED', 'FULLY_ALLOCATED'])
  status?: string;
}
