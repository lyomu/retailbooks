import { Transform } from 'class-transformer';
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

const decimalString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : value;

const PROJECT_STATUSES = ['OPEN', 'ON_HOLD', 'COMPLETED', 'CANCELLED'] as const;
const BILLING_METHODS = ['TIME_AND_MATERIALS', 'FIXED_PRICE', 'NON_BILLABLE'] as const;
const TASK_STATUSES = ['OPEN', 'IN_PROGRESS', 'DONE'] as const;

const HOURS_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;
const MINOR_PATTERN = /^\d+$/;
const PERCENT_PATTERN = /^\d{1,3}(\.\d{1,4})?$/;

export class CreateProjectDto {
  @IsString()
  @MaxLength(160)
  @Transform(trim)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Transform(trimOrUndefined)
  code?: string;

  @IsOptional()
  @IsString()
  @Length(36, 36)
  customerId?: string;

  @IsOptional()
  @IsString()
  @Length(36, 36)
  managerUserId?: string;

  @IsOptional()
  @IsIn(BILLING_METHODS)
  billingMethod?: (typeof BILLING_METHODS)[number];

  @IsOptional()
  @IsString()
  @Length(3, 3)
  @Transform(trimUpper)
  currency?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  @Transform(trimOrUndefined)
  startsOn?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  @Transform(trimOrUndefined)
  endsOn?: string;

  @IsOptional()
  @IsString()
  @Matches(MINOR_PATTERN, { message: 'budgetAmountMinor must be a non-negative integer string' })
  @Transform(moneyString)
  budgetAmountMinor?: string;

  @IsOptional()
  @IsString()
  @Matches(HOURS_PATTERN, { message: 'budgetHours must be decimal hours, e.g. "120.00"' })
  @Transform(decimalString)
  budgetHours?: string;

  @IsOptional()
  @IsString()
  @Matches(MINOR_PATTERN, { message: 'defaultRateMinor must be a non-negative integer string' })
  @Transform(moneyString)
  defaultRateMinor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trimOrUndefined)
  description?: string;
}

export class UpdateProjectDto extends CreateProjectDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  @Transform(trim)
  declare name: string;
}

export class ChangeProjectStatusDto {
  @IsIn(PROJECT_STATUSES)
  status!: (typeof PROJECT_STATUSES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(240)
  @Transform(trimOrUndefined)
  reason?: string;
}

export class CreateProjectTaskDto {
  @IsString()
  @MaxLength(160)
  @Transform(trim)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(36, 36)
  assigneeUserId?: string;

  @IsOptional()
  @IsIn(TASK_STATUSES)
  status?: (typeof TASK_STATUSES)[number];

  @IsOptional()
  @IsString()
  @Matches(HOURS_PATTERN, { message: 'estimateHours must be decimal hours, e.g. "8.00"' })
  @Transform(decimalString)
  estimateHours?: string;

  @IsOptional()
  @IsBoolean()
  billableDefault?: boolean;

  @IsOptional()
  @IsString()
  @Matches(MINOR_PATTERN, { message: 'rateMinor must be a non-negative integer string' })
  @Transform(moneyString)
  rateMinor?: string;
}

export class UpdateProjectTaskDto extends CreateProjectTaskDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  @Transform(trim)
  declare name: string;
}

export class CreateTimeEntryDto {
  @IsString()
  @Length(36, 36)
  projectId!: string;

  @IsOptional()
  @IsString()
  @Length(36, 36)
  taskId?: string;

  /** Omitted means "my own time". Recording for someone else needs `projects.time.approve`. */
  @IsOptional()
  @IsString()
  @Length(36, 36)
  userId?: string;

  @IsISO8601({ strict: true })
  @Transform(trim)
  entryDate!: string;

  @IsString()
  @Matches(HOURS_PATTERN, { message: 'hours must be decimal hours, e.g. "7.50"' })
  @Transform(decimalString)
  hours!: string;

  @IsOptional()
  @IsBoolean()
  billable?: boolean;

  @IsOptional()
  @IsString()
  @Matches(MINOR_PATTERN, { message: 'rateMinor must be a non-negative integer string' })
  @Transform(moneyString)
  rateMinor?: string;

  @IsOptional()
  @IsString()
  @Matches(MINOR_PATTERN, { message: 'costRateMinor must be a non-negative integer string' })
  @Transform(moneyString)
  costRateMinor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trimOrUndefined)
  note?: string;
}

export class UpdateTimeEntryDto {
  @IsOptional()
  @IsString()
  @Length(36, 36)
  taskId?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  @Transform(trimOrUndefined)
  entryDate?: string;

  @IsOptional()
  @IsString()
  @Matches(HOURS_PATTERN, { message: 'hours must be decimal hours, e.g. "7.50"' })
  @Transform(decimalString)
  hours?: string;

  @IsOptional()
  @IsBoolean()
  billable?: boolean;

  @IsOptional()
  @IsString()
  @Matches(MINOR_PATTERN, { message: 'rateMinor must be a non-negative integer string' })
  @Transform(moneyString)
  rateMinor?: string;

  @IsOptional()
  @IsString()
  @Matches(MINOR_PATTERN, { message: 'costRateMinor must be a non-negative integer string' })
  @Transform(moneyString)
  costRateMinor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trimOrUndefined)
  note?: string;
}

export class TimeDecisionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @Length(36, 36, { each: true })
  timeEntryIds!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trimOrUndefined)
  comment?: string;
}

export class LinkProjectExpenseDto {
  @IsString()
  @Length(36, 36)
  expenseId!: string;

  @IsOptional()
  @IsBoolean()
  billable?: boolean;

  @IsOptional()
  @IsString()
  @Matches(PERCENT_PATTERN, { message: 'markupPercent must be a percentage, e.g. "12.5"' })
  @Transform(decimalString)
  markupPercent?: string;
}

export class UpdateProjectExpenseDto {
  @IsOptional()
  @IsBoolean()
  billable?: boolean;

  @IsOptional()
  @IsString()
  @Matches(PERCENT_PATTERN, { message: 'markupPercent must be a percentage, e.g. "12.5"' })
  @Transform(decimalString)
  markupPercent?: string;
}

export class UpsertProjectBudgetDto {
  @IsString()
  @Length(36, 36)
  taskId!: string;

  @IsOptional()
  @IsString()
  @Matches(HOURS_PATTERN, { message: 'budgetHours must be decimal hours, e.g. "120.00"' })
  @Transform(decimalString)
  budgetHours?: string;

  @IsOptional()
  @IsString()
  @Matches(MINOR_PATTERN, { message: 'budgetAmountMinor must be a non-negative integer string' })
  @Transform(moneyString)
  budgetAmountMinor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  @Transform(trimOrUndefined)
  note?: string;
}

export class GenerateProjectInvoiceDto {
  /** Omitted means "everything approved and unbilled". */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @Length(36, 36, { each: true })
  timeEntryIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @Length(36, 36, { each: true })
  projectExpenseIds?: string[];

  @IsOptional()
  @IsISO8601({ strict: true })
  @Transform(trimOrUndefined)
  issueDate?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  @Transform(trimOrUndefined)
  dueDate?: string;

  /** Defaults to true. Pass false to leave the generated invoice as an editable draft. */
  @IsOptional()
  @IsBoolean()
  issue?: boolean;
}

export class TimeEntryQueryDto {
  @IsOptional()
  @IsString()
  @Length(36, 36)
  projectId?: string;

  @IsOptional()
  @IsString()
  @Length(36, 36)
  userId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(trimUpper)
  status?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  @Transform(trimOrUndefined)
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  @Transform(trimOrUndefined)
  to?: string;
}

export class ProjectQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Transform(trimUpper)
  status?: string;
}
