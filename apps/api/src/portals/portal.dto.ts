import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

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
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
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
