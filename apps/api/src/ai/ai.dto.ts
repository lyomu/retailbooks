import { REPORT_KEYS } from '@retailbooks/contracts';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { DRILLDOWN_REPORT_KEYS } from '../reporting/reporting.service.js';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;
const trimOrUndefined = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const result = value.trim();
  return result === '' ? undefined : result;
};
const upper = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/**
 * The first Ask your books slice is deliberately bounded to a selected report and its filters.
 * Natural-language routing to a report key arrives after its own evaluation suite; accepting a
 * report key here keeps all numeric work in ReportingService from the first release.
 */
export class AskReportDto {
  @IsIn(REPORT_KEYS)
  reportKey!: (typeof REPORT_KEYS)[number];

  @IsString()
  @MinLength(3)
  @MaxLength(1_000)
  @Transform(trim)
  question!: string;

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
  @MaxLength(36)
  projectId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(36)
  tagId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

const DEFAULT_EXPLAIN_NUMBER_QUESTION =
  'Explain this reported amount using only the supplied evidence.';

/**
 * "Explain a number": point-and-click, not free text. A caller targets one already-rendered
 * drill-down row/account rather than typing a question, so `question` is optional and defaults to
 * a fixed prompt when omitted.
 */
export class ExplainNumberDto {
  @IsIn(DRILLDOWN_REPORT_KEYS)
  reportKey!: (typeof DRILLDOWN_REPORT_KEYS)[number];

  @IsUUID()
  rowId!: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(1_000)
  @Transform(trim)
  question?: string;

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
  @MaxLength(36)
  projectId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(36)
  tagId?: string;

  resolvedQuestion(): string {
    return this.question ?? DEFAULT_EXPLAIN_NUMBER_QUESTION;
  }
}

export class SuggestionFeedbackDto {
  @IsOptional()
  @IsString()
  @MaxLength(400)
  @Transform(trimOrUndefined)
  note?: string;
}
