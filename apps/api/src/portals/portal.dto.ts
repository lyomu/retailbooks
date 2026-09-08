import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const upper = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CreatePortalInvitationDto {
  @IsEmail()
  @Transform(trim)
  email!: string;
}

export class PortalInvitationTokenDto {
  @IsString()
  @Length(20, 200)
  token!: string;
}

/** Portal statements accept the same optional ISO date window as the internal endpoint. */
export class PortalStatementQueryDto {
  @IsOptional()
  @Matches(ISO_DATE)
  from?: string;

  @IsOptional()
  @Matches(ISO_DATE)
  to?: string;
}

export class PortalProfileAddressDto {
  @IsIn(['BILLING', 'SHIPPING'])
  kind!: 'BILLING' | 'SHIPPING';

  @IsString()
  @Length(1, 200)
  @Transform(trim)
  line1!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(trim)
  line2?: string;
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  city?: string;
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  region?: string;
  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Transform(trim)
  postalCode?: string;
  @IsString()
  @Length(2, 2)
  @Transform(upper)
  countryCode!: string;
  @IsOptional()
  isDefault?: boolean;
}

export class UpdatePortalProfileDto {
  @IsOptional()
  @IsString()
  @Length(1, 160)
  @Transform(trim)
  displayName?: string;
  @IsOptional()
  @IsEmail()
  @Transform(trim)
  email?: string;
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Transform(trim)
  phone?: string;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PortalProfileAddressDto)
  addresses?: PortalProfileAddressDto[];
}
