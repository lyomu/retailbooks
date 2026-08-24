import {
  AccountingBasis,
  BusinessType,
  MembershipStatus,
  NumberingReset,
  OrganizationRole,
  TaxTreatment,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
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
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
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
   * Ownership is granted only by creating an organization; an invitation can never mint a second
   * owner.
   */
  @IsIn([OrganizationRole.ADMIN, OrganizationRole.ACCOUNTANT, OrganizationRole.STAFF], {
    message: 'role must be one of ADMIN, ACCOUNTANT, STAFF',
  })
  role!: OrganizationRole;
}

export class InvitationTokenDto {
  @IsString()
  @Length(20, 256)
  token!: string;
}

export class UpdateMemberDto {
  /** The organization owner can never be set here — there is no grant path to OWNER after creation. */
  @IsOptional()
  @IsIn([OrganizationRole.ADMIN, OrganizationRole.ACCOUNTANT, OrganizationRole.STAFF], {
    message: 'role must be one of ADMIN, ACCOUNTANT, STAFF',
  })
  role?: OrganizationRole;

  @IsOptional()
  @IsEnum(MembershipStatus)
  status?: MembershipStatus;
}

export class PermissionChangeDto {
  @IsIn(PERMISSION_KEYS)
  permissionKey!: PermissionKey;

  @IsBoolean()
  granted!: boolean;
}

export class UpdateRolePermissionsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PERMISSION_KEYS.length)
  @ValidateNested({ each: true })
  @Type(() => PermissionChangeDto)
  changes!: PermissionChangeDto[];
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
