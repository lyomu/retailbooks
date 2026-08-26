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

const trimOrUndefined = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

const moneyString = ({ value }: { value: unknown }): unknown => {
  if (typeof value === 'number' && Number.isInteger(value)) return String(value);
  return typeof value === 'string' ? value.trim() : value;
};

export class CategorizeLineDto {
  @IsString()
  @Length(36, 36)
  accountId!: string;

  @IsString()
  @Matches(/^\d+$/, { message: 'amountMinor must be a non-negative integer string' })
  @Transform(moneyString)
  amountMinor!: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  @Transform(trimOrUndefined)
  description?: string;
}

export class CategorizeBankTransactionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CategorizeLineDto)
  lines!: CategorizeLineDto[];
}

export class ExcludeBankTransactionDto {
  @IsString()
  @Length(1, 240)
  @Transform(trimOrUndefined)
  reason!: string;
}

export class MatchBankTransactionDto {
  @IsIn(['PAYMENT_RECEIVED', 'PAYMENT_MADE', 'EXPENSE', 'TRANSFER'])
  targetType!: 'PAYMENT_RECEIVED' | 'PAYMENT_MADE' | 'EXPENSE' | 'TRANSFER';

  @IsString()
  @Length(36, 36)
  targetId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  @Transform(trimOrUndefined)
  note?: string;
}

export class ListBankTransactionsQueryDto {
  @IsOptional()
  @IsString()
  @Length(36, 36)
  financialAccountId?: string;

  @IsOptional()
  @IsIn(['UNRESOLVED', 'MATCHED', 'POSTED', 'EXCLUDED'])
  disposition?: string;
}
