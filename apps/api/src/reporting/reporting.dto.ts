import { REPORT_KEYS } from '@retailbooks/contracts';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;
const trimOrUndefined = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const result = value.trim();
  return result === '' ? undefined : result;
};
const upper = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
const lower = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class ReportQueryDto {
  @IsOptional()
  @IsISO8601({ strict: true })
  @Transform(trimOrUndefined)
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  @Transform(trimOrUndefined)
  to?: string;

  @IsOptional()
  @IsIn(['ACCRUAL', 'CASH'])
  @Transform(upper)
  basis?: 'ACCRUAL' | 'CASH';

  @IsOptional()
  @IsIn(['BASE', 'TRANSACTION'])
  @Transform(upper)
  currencyMode?: 'BASE' | 'TRANSACTION';

  @IsOptional()
  @IsString()
  @Length(36, 36)
  projectId?: string;

  @IsOptional()
  @IsString()
  @Length(36, 36)
  tagId?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  @Transform(trimOrUndefined)
  comparisonFrom?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  @Transform(trimOrUndefined)
  comparisonTo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  pageSize?: number;
}

export class ReportKeyParamDto {
  @IsIn(REPORT_KEYS)
  reportKey!: (typeof REPORT_KEYS)[number];
}

export class ReportExportQueryDto extends ReportQueryDto {
  @IsIn(['csv', 'xlsx', 'pdf'])
  @Transform(lower)
  format!: 'csv' | 'xlsx' | 'pdf';
}

export class CreateSavedReportDto {
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  name!: string;

  @IsIn(REPORT_KEYS)
  reportKey!: (typeof REPORT_KEYS)[number];

  @IsObject()
  filters!: Record<string, unknown>;
}

export class UpdateSavedReportDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trimOrUndefined)
  name?: string;

  @IsOptional()
  @IsIn(REPORT_KEYS)
  reportKey?: (typeof REPORT_KEYS)[number];

  @IsOptional()
  @IsObject()
  filters?: Record<string, unknown>;
}
