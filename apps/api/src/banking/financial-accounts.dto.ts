import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, Length } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const trimUpper = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

const FINANCIAL_ACCOUNT_TYPES = ['BANK', 'CASH', 'CREDIT_CARD', 'OTHER'] as const;

export class CreateFinancialAccountDto {
  @IsString()
  @Length(1, 120)
  @Transform(trim)
  name!: string;

  @IsIn(FINANCIAL_ACCOUNT_TYPES)
  type!: (typeof FINANCIAL_ACCOUNT_TYPES)[number];

  @IsString()
  @Length(3, 3)
  @Transform(trimUpper)
  currency!: string;

  @IsString()
  @Length(36, 36)
  glAccountId!: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  openingBalanceMinor?: string;
}

export class UpdateFinancialAccountDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  @Transform(trim)
  name?: string;

  @IsOptional()
  @IsIn(FINANCIAL_ACCOUNT_TYPES)
  type?: (typeof FINANCIAL_ACCOUNT_TYPES)[number];

  @IsOptional()
  @IsString()
  @Length(3, 3)
  @Transform(trimUpper)
  currency?: string;

  @IsOptional()
  @IsString()
  @Length(36, 36)
  glAccountId?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ListFinancialAccountsQueryDto {
  @IsOptional()
  @IsIn(['true', 'false'])
  active?: string;
}
