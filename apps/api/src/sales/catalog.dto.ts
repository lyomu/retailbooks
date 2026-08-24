import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const trimUpper = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

const trimOrUndefined = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

const moneyString = ({ value }: { value: unknown }): unknown => {
  if (typeof value === 'number' && Number.isInteger(value)) return String(value);
  return typeof value === 'string' ? value.trim() : value;
};

export class CreateUnitDto {
  @IsString()
  @Length(1, 16)
  @Transform(trimUpper)
  code!: string;

  @IsString()
  @Length(1, 80)
  @Transform(trim)
  name!: string;
}

export class UpdateUnitDto {
  @IsOptional()
  @IsString()
  @Length(1, 16)
  @Transform(trimUpper)
  code?: string;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  @Transform(trim)
  name?: string;
}

export class CreateCategoryDto {
  @IsString()
  @Length(1, 120)
  @Transform(trim)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(36, 36)
  parentCategoryId?: string;
}

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  @Transform(trim)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(36, 36)
  parentCategoryId?: string;
}

export class ItemPriceDto {
  @IsOptional()
  @IsString()
  @Length(1, 40)
  @Transform(trimOrUndefined)
  priceListKey?: string;

  @IsString()
  @Length(3, 3)
  @Transform(trimUpper)
  currency!: string;

  @IsString()
  @Matches(/^\d+$/, { message: 'unitPriceMinor must be a non-negative integer string' })
  @Transform(moneyString)
  unitPriceMinor!: string;
}

export class CreateItemDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Transform(trimOrUndefined)
  sku?: string;

  @IsString()
  @Length(1, 160)
  @Transform(trim)
  name!: string;

  @IsIn(['GOODS', 'SERVICE', 'NON_STOCK'])
  itemType!: 'GOODS' | 'SERVICE' | 'NON_STOCK';

  @IsOptional()
  @IsString()
  @Length(36, 36)
  categoryId?: string;

  @IsOptional()
  @IsString()
  @Length(36, 36)
  defaultUnitId?: string;

  @IsOptional()
  @IsString()
  @Length(36, 36)
  revenueAccountId?: string;

  @IsOptional()
  @IsString()
  @Length(36, 36)
  defaultTaxCodeId?: string;

  @IsOptional()
  @IsBoolean()
  freeDescriptionAllowed?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ItemPriceDto)
  prices?: ItemPriceDto[];
}

export class UpdateItemDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Transform(trimOrUndefined)
  sku?: string;

  @IsOptional()
  @IsString()
  @Length(1, 160)
  @Transform(trim)
  name?: string;

  @IsOptional()
  @IsIn(['GOODS', 'SERVICE', 'NON_STOCK'])
  itemType?: 'GOODS' | 'SERVICE' | 'NON_STOCK';

  @IsOptional()
  @IsString()
  @Length(36, 36)
  categoryId?: string;

  @IsOptional()
  @IsString()
  @Length(36, 36)
  defaultUnitId?: string;

  @IsOptional()
  @IsString()
  @Length(36, 36)
  revenueAccountId?: string;

  @IsOptional()
  @IsString()
  @Length(36, 36)
  defaultTaxCodeId?: string;

  @IsOptional()
  @IsBoolean()
  freeDescriptionAllowed?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ItemPriceDto)
  prices?: ItemPriceDto[];
}

export class ListItemsQueryDto {
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}
