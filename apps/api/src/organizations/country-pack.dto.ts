import { BadRequestException } from '@nestjs/common';
import { CountryPackTier, type Prisma } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const trimUpper = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/**
 * Defaults an organization adopts when it takes this pack. The required keys mirror the catalog's
 * `CountryPackDefaults` shape; the service rejects a draft that omits any of them so a pack can
 * never publish half-specified.
 */
const REQUIRED_DEFAULT_KEYS = [
  'currency',
  'locale',
  'timeZone',
  'fiscalYearStartMonth',
  'fiscalYearStartDay',
  'chartTemplate',
  'journalPrefix',
  'numberPadding',
  'numberingReset',
] as const;

export class TaxPackInputDto {
  @IsString()
  @Length(1, 24)
  @Transform(trim)
  version!: string;

  @IsString()
  @Length(2, 120)
  @Transform(trim)
  name!: string;

  @IsArray()
  @IsObject({ each: true })
  rates!: Prisma.InputJsonObject[];

  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  registrationFields?: Prisma.InputJsonObject[];

  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  exemptions?: Prisma.InputJsonObject[];

  @IsOptional()
  @IsObject()
  reportingMappings?: Prisma.InputJsonObject;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  notes?: string[];
}

export class CreateCountryPackDto {
  @IsString()
  @Length(2, 8)
  @Matches(/^[A-Z0-9]+$/, { message: 'code may contain uppercase letters and numbers only' })
  @Transform(trimUpper)
  code!: string;

  @IsString()
  @Length(1, 24)
  @Transform(trim)
  version!: string;

  @IsString()
  @Length(2, 2)
  @Transform(trimUpper)
  countryCode!: string;

  @IsString()
  @Length(2, 120)
  @Transform(trim)
  name!: string;

  @IsEnum(CountryPackTier)
  tier!: CountryPackTier;

  @IsObject()
  defaults!: Prisma.InputJsonObject;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  notes?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  supportedEntityTypes?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => TaxPackInputDto)
  taxPack?: TaxPackInputDto;
}

export class UpdateCountryPackDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  @Transform(trim)
  name?: string;

  /** Tier changes are an admin action by definition; the seed path can never raise a tier. */
  @IsOptional()
  @IsEnum(CountryPackTier)
  tier?: CountryPackTier;

  @IsOptional()
  @IsObject()
  defaults?: Prisma.InputJsonObject;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  notes?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  supportedEntityTypes?: string[];

  /**
   * Upserted against the draft's tax pack by `version`: a matching version is replaced in place, a
   * new one is added alongside it. Tax metadata is versioned with the country pack it backs rather
   * than as an independent global entity, so this is the one place it is ever edited.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => TaxPackInputDto)
  taxPack?: TaxPackInputDto;
}

export function assertPackDefaultsShape(defaults: Prisma.InputJsonObject): void {
  const missing = REQUIRED_DEFAULT_KEYS.filter((key) => !(key in defaults));
  if (missing.length > 0) {
    throw new BadRequestException(
      `Country pack defaults are missing required keys: ${missing.join(', ')}`,
    );
  }
}
