import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;
const upper = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
const lower = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const KEY = /^[a-z][a-z0-9_.-]*$/;

export const PLATFORM_ROLES = ['SUPPORT', 'OPERATIONS', 'SUPERADMIN'] as const;

/** Shared page window. Platform lists are cross-tenant, so an unbounded page is not offered. */
export class PlatformPageDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class GrantPlatformAdminDto {
  @IsEmail()
  @Transform(lower)
  email!: string;

  @IsIn(PLATFORM_ROLES)
  role!: (typeof PLATFORM_ROLES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trim)
  note?: string;
}

export class OrganizationSearchDto extends PlatformPageDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  query?: string;

  @IsOptional()
  @IsIn(['DRAFT', 'ACTIVE', 'SUSPENDED'])
  status?: 'DRAFT' | 'ACTIVE' | 'SUSPENDED';

  @IsOptional()
  @IsString()
  @Length(2, 2)
  @Transform(upper)
  countryCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Transform(lower)
  planKey?: string;

  @IsOptional()
  @Matches(ISO_DATE)
  createdFrom?: string;

  @IsOptional()
  @Matches(ISO_DATE)
  createdTo?: string;
}

/**
 * Suspension requires a reason. Months later the only durable answer to "why is this tenant locked
 * out?" is the one recorded at the moment it happened, so the API refuses to record the action
 * without it.
 */
export class SuspendOrganizationDto {
  @IsString()
  @Length(4, 500)
  @Transform(trim)
  reason!: string;
}

export class ReactivateOrganizationDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trim)
  reason?: string;
}

export class UserSearchDto extends PlatformPageDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  @Transform(trim)
  query?: string;

  @IsOptional()
  @IsIn(['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'CLOSED'])
  status?: 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
}

export class UpdateUserStatusDto {
  @IsIn(['ACTIVE', 'SUSPENDED', 'CLOSED'])
  status!: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';

  @IsString()
  @Length(4, 500)
  @Transform(trim)
  reason!: string;
}

export class CreatePlanDto {
  @IsString()
  @Matches(KEY, { message: 'key must be lower-case letters, digits, dot, dash or underscore' })
  @MaxLength(40)
  @Transform(lower)
  key!: string;

  @IsString()
  @Length(1, 120)
  @Transform(trim)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trim)
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  trialDays?: number;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'priceMinor must be a non-negative integer string' })
  priceMinor?: string;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  @Transform(upper)
  currency?: string;

  @IsOptional()
  @IsIn(['MONTHLY', 'YEARLY'])
  billingInterval?: 'MONTHLY' | 'YEARLY';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  sortOrder?: number;
}

export class UpdatePlanDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  @Transform(trim)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trim)
  description?: string;

  @IsOptional()
  @IsIn(['DRAFT', 'ACTIVE', 'RETIRED'])
  status?: 'DRAFT' | 'ACTIVE' | 'RETIRED';

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  trialDays?: number;

  @IsOptional()
  @Matches(/^\d+$/, { message: 'priceMinor must be a non-negative integer string' })
  priceMinor?: string;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  @Transform(upper)
  currency?: string;

  @IsOptional()
  @IsIn(['MONTHLY', 'YEARLY'])
  billingInterval?: 'MONTHLY' | 'YEARLY';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  sortOrder?: number;
}

/**
 * `limitValue` is deliberately tri-state: absent leaves it unchanged, `null` means unlimited, and a
 * number is a cap. `enabled: false` withdraws the capability altogether, which is a different
 * statement from a limit of zero.
 */
export class UpsertEntitlementDto {
  @IsString()
  @Matches(KEY)
  @MaxLength(60)
  @Transform(lower)
  key!: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  limitValue?: number | null;
}

export class AssignPlanDto {
  @IsUUID()
  planId!: string;

  @IsOptional()
  @IsIn(['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED'])
  status?: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';

  @IsOptional()
  @Matches(ISO_DATE)
  trialEndsAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trim)
  reason?: string;
}

export class CreateFeatureFlagDto {
  @IsString()
  @Matches(KEY)
  @MaxLength(60)
  @Transform(lower)
  key!: string;

  @IsString()
  @Length(1, 120)
  @Transform(trim)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trim)
  description?: string;

  @IsOptional()
  @IsBoolean()
  defaultEnabled?: boolean;
}

export class UpdateFeatureFlagDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  @Transform(trim)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trim)
  description?: string;

  @IsOptional()
  @IsBoolean()
  defaultEnabled?: boolean;

  @IsOptional()
  @IsIn(['ACTIVE', 'ARCHIVED'])
  status?: 'ACTIVE' | 'ARCHIVED';
}

/**
 * Exactly one target must match the scope. The database enforces this too, with a check constraint;
 * validating it here means the caller gets a 400 that names the problem instead of a 500 from a
 * constraint violation.
 */
export class UpsertFlagRuleDto {
  @IsIn(['GLOBAL', 'COUNTRY', 'PLAN', 'ORGANIZATION'])
  scope!: 'GLOBAL' | 'COUNTRY' | 'PLAN' | 'ORGANIZATION';

  @IsOptional()
  @IsString()
  @Length(2, 2)
  @Transform(upper)
  countryCode?: string;

  @IsOptional()
  @IsUUID()
  planId?: string;

  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trim)
  note?: string;
}

export class FlagPreviewDto {
  @IsOptional()
  @IsString()
  @Length(2, 2)
  @Transform(upper)
  countryCode?: string;

  @IsOptional()
  @IsUUID()
  planId?: string;

  @IsOptional()
  @IsUUID()
  organizationId?: string;
}

export class SecurityEventSearchDto extends PlatformPageDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(trim)
  eventKey?: string;

  @IsOptional()
  @IsIn(['INFO', 'WARN', 'ERROR', 'CRITICAL'])
  severity?: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';

  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @Matches(ISO_DATE)
  from?: string;

  @IsOptional()
  @Matches(ISO_DATE)
  to?: string;
}

export class PlatformAuditSearchDto extends PlatformPageDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(trim)
  eventKey?: string;

  @IsOptional()
  @IsUUID()
  organizationId?: string;
}

export class FailedJobSearchDto extends PlatformPageDto {
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}
