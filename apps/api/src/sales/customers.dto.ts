import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
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

export class ContactAddressDto {
  @IsIn(['BILLING', 'SHIPPING'])
  kind!: 'BILLING' | 'SHIPPING';

  @IsString()
  @Length(1, 200)
  @Transform(trim)
  line1!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(trimOrUndefined)
  line2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trimOrUndefined)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trimOrUndefined)
  region?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Transform(trimOrUndefined)
  postalCode?: string;

  @IsString()
  @Length(2, 2)
  @Transform(trimUpper)
  countryCode!: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class ContactTaxIdDto {
  @IsString()
  @Length(1, 24)
  @Transform(trim)
  label!: string;

  @IsString()
  @Length(1, 60)
  @Transform(trim)
  value!: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  @Transform(trimUpper)
  countryCode?: string;
}

export class ListContactsQueryDto {
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}

export class CreateContactDto {
  @IsString()
  @Length(1, 160)
  @Transform(trim)
  displayName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(trimOrUndefined)
  legalName?: string;

  @IsOptional()
  @IsEmail()
  @Transform(trimOrUndefined)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Transform(trimOrUndefined)
  phone?: string;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  @Transform(trimUpper)
  currency?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  paymentTermsDays?: number;

  @IsOptional()
  @IsString()
  @Length(36, 36)
  receivableAccountId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ContactAddressDto)
  addresses?: ContactAddressDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ContactTaxIdDto)
  taxIds?: ContactTaxIdDto[];
}

export class UpdateContactDto {
  @IsOptional()
  @IsString()
  @Length(1, 160)
  @Transform(trim)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(trimOrUndefined)
  legalName?: string;

  @IsOptional()
  @IsEmail()
  @Transform(trimOrUndefined)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Transform(trimOrUndefined)
  phone?: string;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  @Transform(trimUpper)
  currency?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  paymentTermsDays?: number;

  @IsOptional()
  @IsString()
  @Length(36, 36)
  receivableAccountId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ContactAddressDto)
  addresses?: ContactAddressDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ContactTaxIdDto)
  taxIds?: ContactTaxIdDto[];
}
