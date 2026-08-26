import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const moneyString = ({ value }: { value: unknown }): unknown => {
  if (typeof value === 'number' && Number.isInteger(value)) return String(value);
  return typeof value === 'string' ? value.trim() : value;
};

export class StartReconciliationDto {
  @IsString()
  @Length(36, 36)
  financialAccountId!: string;

  @IsString()
  @IsISO8601({ strict: true })
  @Transform(trim)
  statementStartDate!: string;

  @IsString()
  @IsISO8601({ strict: true })
  @Transform(trim)
  statementEndDate!: string;

  @IsString()
  @Matches(/^-?\d+$/, { message: 'openingBalanceMinor must be an integer string' })
  @Transform(moneyString)
  openingBalanceMinor!: string;

  @IsString()
  @Matches(/^-?\d+$/, { message: 'closingBalanceMinor must be an integer string' })
  @Transform(moneyString)
  closingBalanceMinor!: string;
}

export class SetClearedTransactionsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @Type(() => String)
  transactionIds!: string[];
}

export class ReopenReconciliationDto {
  @IsString()
  @Length(1, 240)
  @Transform(trim)
  reason!: string;
}

export class ListReconciliationsQueryDto {
  @IsOptional()
  @IsString()
  @Length(36, 36)
  financialAccountId?: string;
}
