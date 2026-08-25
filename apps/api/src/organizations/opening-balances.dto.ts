import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class OpeningBalanceLineDto {
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

export class OpeningBalancePartyLineDto {
  @IsIn(['RECEIVABLE', 'PAYABLE'])
  side!: 'RECEIVABLE' | 'PAYABLE';

  /** Required when side is RECEIVABLE; names an existing contact (customer). */
  @ValidateIf((line: OpeningBalancePartyLineDto) => line.side === 'RECEIVABLE')
  @IsString()
  contactId?: string;

  /** Required when side is PAYABLE; names an existing vendor. */
  @ValidateIf((line: OpeningBalancePartyLineDto) => line.side === 'PAYABLE')
  @IsString()
  vendorId?: string;

  @Matches(/^\d+$/, { message: 'amountMinor must be a non-negative integer string' })
  amountMinor!: string;
}

export class CreateOpeningBalanceBatchDto {
  @IsDateString({}, { message: 'asOfDate must be an ISO date' })
  asOfDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  description?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OpeningBalanceLineDto)
  lines?: OpeningBalanceLineDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OpeningBalancePartyLineDto)
  partyLines?: OpeningBalancePartyLineDto[];
}

export class UpdateOpeningBalanceBatchDto extends CreateOpeningBalanceBatchDto {}

export class OpeningBalanceTransitionDto {
  @IsOptional()
  @IsString()
  @Length(4, 240)
  reason?: string;
}

/** Page-level query params are intentionally minimal for V1; the wizard works one batch at a time. */
export class ListOpeningBalanceBatchesQueryDto {
  @IsOptional()
  @IsIn(['DRAFT', 'VALIDATED', 'FINALIZED', 'VOID'])
  status?: 'DRAFT' | 'VALIDATED' | 'FINALIZED' | 'VOID';
}
