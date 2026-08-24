import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

const trimUpper = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class EnableOrganizationCurrencyDto {
  @IsString()
  @Length(3, 3)
  @Transform(trimUpper)
  currencyCode!: string;
}

export class UpdateOrganizationCurrencyDto {
  @IsBoolean()
  enabled!: boolean;
}

export class UpsertExchangeRateDto {
  @IsString()
  @Length(3, 3)
  @Transform(trimUpper)
  quoteCurrency!: string;

  @IsString()
  @Matches(/^\d+(\.\d{1,10})?$/, {
    message: 'rate must be a positive decimal string with up to 10 places',
  })
  @Transform(trim)
  rate!: string;

  @IsISO8601({ strict: true })
  @Transform(trim)
  rateDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Transform(trim)
  source?: string;
}
