import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

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

export class CreateWarehouseDto {
  @IsString()
  @Length(1, 32)
  @Transform(trimUpper)
  code!: string;

  @IsString()
  @Length(1, 120)
  @Transform(trim)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  @Transform(trimOrUndefined)
  address?: string;
}

export class UpdateWarehouseDto {
  @IsOptional()
  @IsString()
  @Length(1, 32)
  @Transform(trimUpper)
  code?: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  @Transform(trim)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  @Transform(trimOrUndefined)
  address?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}

export class ListStockMovementsQueryDto {
  @IsOptional()
  @IsString()
  @Length(36, 36)
  itemId?: string;

  @IsOptional()
  @IsString()
  @Length(36, 36)
  warehouseId?: string;
}

export class ListInventoryAdjustmentsQueryDto {
  @IsOptional()
  @IsIn(['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'POSTED', 'VOID', 'CANCELLED'])
  status?: string;
}

export class CreateInventoryAdjustmentDto {
  @IsString()
  @Length(36, 36)
  itemId!: string;

  @IsString()
  @Length(36, 36)
  warehouseId!: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'adjustmentDate must be YYYY-MM-DD' })
  adjustmentDate!: string;

  @IsString()
  @Matches(/^-?\d+(\.\d{1,4})?$/, {
    message: 'quantityDelta must be a decimal string with up to 4 places',
  })
  @Transform(trim)
  quantityDelta!: string;

  @IsOptional()
  @IsString()
  @Matches(/^-?\d+$/, { message: 'valueDeltaMinor must be an integer string' })
  @Transform(moneyString)
  valueDeltaMinor?: string;

  @IsString()
  @Length(1, 240)
  @Transform(trim)
  reason!: string;

  @IsOptional()
  @IsString()
  @Length(36, 36)
  accountId?: string;
}

export class UpdateInventoryAdjustmentDto {
  @IsOptional()
  @IsString()
  @Length(36, 36)
  itemId?: string;

  @IsOptional()
  @IsString()
  @Length(36, 36)
  warehouseId?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'adjustmentDate must be YYYY-MM-DD' })
  adjustmentDate?: string;

  @IsOptional()
  @IsString()
  @Matches(/^-?\d+(\.\d{1,4})?$/, {
    message: 'quantityDelta must be a decimal string with up to 4 places',
  })
  @Transform(trim)
  quantityDelta?: string;

  @IsOptional()
  @IsString()
  @Matches(/^-?\d+$/, { message: 'valueDeltaMinor must be an integer string' })
  @Transform(moneyString)
  valueDeltaMinor?: string;

  @IsOptional()
  @IsString()
  @Length(1, 240)
  @Transform(trim)
  reason?: string;

  @IsOptional()
  @IsString()
  @Length(36, 36)
  accountId?: string;
}

export class CreateInventoryTransferDto {
  @IsString()
  @Length(36, 36)
  itemId!: string;

  @IsString()
  @Length(36, 36)
  fromWarehouseId!: string;

  @IsString()
  @Length(36, 36)
  toWarehouseId!: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'transferDate must be YYYY-MM-DD' })
  transferDate!: string;

  @IsString()
  @Matches(/^\d+(\.\d{1,4})?$/, {
    message: 'quantity must be a non-negative decimal string with up to 4 places',
  })
  @Transform(trim)
  quantity!: string;
}
