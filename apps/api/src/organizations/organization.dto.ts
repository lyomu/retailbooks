import {
  AccountingBasis,
  BusinessType,
  MembershipStatus,
  NumberingReset,
  TaxTreatment,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { PERMISSION_KEYS, type PermissionKey } from './permission-catalog.js';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const trimUpper = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

const normalizeEmail = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/** Treats a blank string as "not supplied" so optional wizard fields can be left empty. */
const trimOrUndefined = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

/** Sections a client may write. `TEAM` and `REVIEW` only advance the onboarding step. */
export const ORGANIZATION_SECTIONS = [
  'PROFILE',
  'JURISDICTION',
  'ACCOUNTING',
  'TAX',
  'NUMBERING',
  'TEAM',
  'REVIEW',
] as const;

export type OrganizationSection = (typeof ORGANIZATION_SECTIONS)[number];

export class CreateOrganizationDto {
  @IsString()
  @Length(2, 180)
  @Transform(trim)
  legalName!: string;

  @IsOptional()
  @IsString()
  @Length(2, 180)
  @Transform(trimOrUndefined)
  tradingName?: string;

  @IsEnum(BusinessType)
  businessType!: BusinessType;

  @IsString()
  @Length(2, 2)
  @Transform(trimUpper)
  countryCode!: string;
}

export class UpdateOrganizationDto {
  @IsIn(ORGANIZATION_SECTIONS)
  section!: OrganizationSection;

  @IsOptional()
  @IsString()
  @Length(2, 180)
  @Transform(trim)
  legalName?: string;

  /** `null` clears the optional trading name. */
  @IsOptional()
  @IsString()
  @MaxLength(180)
  @Transform(trim)
  tradingName?: string | null;

  @IsOptional()
  @IsEnum(BusinessType)
  businessType?: BusinessType;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  @Transform(trimUpper)
  countryCode?: string;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  @Transform(trimUpper)
  baseCurrency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Transform(trim)
  timeZone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  @Transform(trim)
  locale?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  fiscalYearStartMonth?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(31)
  fiscalYearStartDay?: number;

  @IsOptional()
  @IsEnum(AccountingBasis)
  accountingBasis?: AccountingBasis;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Transform(trim)
  chartTemplate?: string;

  /** Omit or send an empty string to leave the books start date unset. */
  @IsOptional()
  @IsISO8601()
  @Transform(trimOrUndefined)
  booksStartDate?: string;

  @IsOptional()
  @IsBoolean()
  taxRegistered?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Transform(trim)
  taxIdentifier?: string | null;

  @IsOptional()
  @IsEnum(TaxTreatment)
  defaultTaxTreatment?: TaxTreatment;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(100)
  defaultTaxRate?: number;

  @IsOptional()
  @IsString()
  @Length(1, 12)
  @Matches(/^[A-Z0-9-]+$/, {
    message: 'journalPrefix may contain uppercase letters, numbers, and hyphens only',
  })
  @Transform(trimUpper)
  journalPrefix?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  numberPadding?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  nextJournalNumber?: number;

  @IsOptional()
  @IsEnum(NumberingReset)
  numberingReset?: NumberingReset;
}

export class InviteMemberDto {
  @IsEmail()
  @MaxLength(254)
  @Transform(normalizeEmail)
  email!: string;

  /**
   * Roles are organization-scoped rows rather than a closed set, so validity (does this role exist
   * in this organization, and is it not the owner role) is checked in
   * `RolesService.resolveAssignableRole`, not here. Ownership is granted only by creating an
   * organization; an invitation can never mint a second owner.
   */
  @IsUUID()
  roleId!: string;
}

export class InvitationTokenDto {
  @IsString()
  @Length(20, 256)
  token!: string;
}

export class UpdateMemberDto {
  /** The organization owner can never be set here — `resolveAssignableRole` rejects the owner role. */
  @IsOptional()
  @IsUUID()
  roleId?: string;

  @IsOptional()
  @IsEnum(MembershipStatus)
  status?: MembershipStatus;
}

export class CreateRoleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Transform(trim)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  @Transform(trimOrUndefined)
  description?: string;

  /** The role's complete permission set, not a diff -- creating a role always states it in full. */
  @IsArray()
  @ArrayMaxSize(PERMISSION_KEYS.length)
  @IsIn(PERMISSION_KEYS, { each: true })
  permissions!: PermissionKey[];
}

export class UpdateRoleDto {
  /** Rejected for system roles -- their name is what makes them recognizable across organizations. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Transform(trim)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  @Transform(trimOrUndefined)
  description?: string;

  /** Replaces the role's permission set entirely when supplied; omit to leave it unchanged. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PERMISSION_KEYS.length)
  @IsIn(PERMISSION_KEYS, { each: true })
  permissions?: PermissionKey[];
}

export class GenerateFiscalYearDto {
  /**
   * Optional local calendar date. When omitted, the API uses the organization's fiscal-year start
   * rule and time zone to generate the currently active fiscal year.
   */
  @IsOptional()
  @IsISO8601({ strict: true })
  @Transform(trimOrUndefined)
  startsOn?: string;
}

export class PeriodTransitionDto {
  @IsOptional()
  @IsString()
  @MaxLength(240)
  @Transform(trimOrUndefined)
  note?: string;
}

export class UpdateJournalNumberingDto {
  @IsOptional()
  @IsString()
  @Length(1, 12)
  @Matches(/^[A-Z0-9-]+$/, {
    message: 'journalPrefix may contain uppercase letters, numbers, and hyphens only',
  })
  @Transform(trimUpper)
  journalPrefix?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  numberPadding?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  nextJournalNumber?: number;

  @IsOptional()
  @IsEnum(NumberingReset)
  numberingReset?: NumberingReset;
}

export class UpdateDocumentNumberingDto {
  @IsOptional()
  @IsString()
  @Length(1, 16)
  @Matches(/^[A-Z0-9-]+$/, {
    message: 'prefix may contain uppercase letters, numbers, and hyphens only',
  })
  @Transform(trimUpper)
  prefix?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  numberPadding?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  nextNumber?: number;

  @IsOptional()
  @IsEnum(NumberingReset)
  numberingReset?: NumberingReset;
}
