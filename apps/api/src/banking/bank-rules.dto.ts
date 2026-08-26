import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class BankRuleConditionDto {
  @IsIn(['description', 'reference', 'amountMinor', 'direction'])
  field!: 'description' | 'reference' | 'amountMinor' | 'direction';

  @IsIn(['contains', 'equals', 'gt', 'gte', 'lt', 'lte'])
  operator!: 'contains' | 'equals' | 'gt' | 'gte' | 'lt' | 'lte';

  @IsString()
  @Length(1, 240)
  value!: string;
}

export class CreateBankRuleDto {
  @IsString()
  @Length(1, 120)
  @Transform(trim)
  name!: string;

  @IsInt()
  @Min(1)
  @Max(10_000)
  priority!: number;

  @IsOptional()
  @IsBoolean()
  matchAny?: boolean;

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => BankRuleConditionDto)
  conditions!: BankRuleConditionDto[];

  @IsOptional()
  @IsString()
  @Length(36, 36)
  suggestAccountId?: string;

  @IsOptional()
  @IsString()
  @Length(36, 36)
  suggestContactId?: string;

  @IsOptional()
  @IsString()
  @Length(36, 36)
  suggestVendorId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  suggestTags?: string[];

  @IsOptional()
  @IsBoolean()
  stopOnMatch?: boolean;
}

export class UpdateBankRuleDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  @Transform(trim)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000)
  priority?: number;

  @IsOptional()
  @IsBoolean()
  matchAny?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => BankRuleConditionDto)
  conditions?: BankRuleConditionDto[];

  @IsOptional()
  @IsString()
  @Length(36, 36)
  suggestAccountId?: string;

  @IsOptional()
  @IsString()
  @Length(36, 36)
  suggestContactId?: string;

  @IsOptional()
  @IsString()
  @Length(36, 36)
  suggestVendorId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  suggestTags?: string[];

  @IsOptional()
  @IsBoolean()
  stopOnMatch?: boolean;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
