import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export const APPROVAL_TARGET_TYPES = [
  'QUOTE',
  'SALES_ORDER',
  'INVOICE',
  'CREDIT_NOTE',
  'PURCHASE_ORDER',
  'BILL',
  'PAYMENT_MADE',
  'INVENTORY_ADJUSTMENT',
  'JOURNAL',
] as const;

export type ApprovalTargetTypeInput = (typeof APPROVAL_TARGET_TYPES)[number];

export class ApprovalPolicyStepDto {
  @IsOptional()
  @IsUUID()
  approverUserId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  requiredPermission?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  label?: string;
}

export class CreateApprovalPolicyDto {
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  name!: string;

  @IsIn(APPROVAL_TARGET_TYPES)
  targetType!: ApprovalTargetTypeInput;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  priority?: number;

  @IsOptional()
  @IsObject()
  conditions?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  allowSelfApproval?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApprovalPolicyStepDto)
  steps!: ApprovalPolicyStepDto[];
}

export class UpdateApprovalPolicyDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  priority?: number;

  @IsOptional()
  @IsObject()
  conditions?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  allowSelfApproval?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApprovalPolicyStepDto)
  steps?: ApprovalPolicyStepDto[];
}

export class ApprovalDecisionDto {
  @IsIn(['APPROVED', 'REJECTED'])
  decision!: 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  @Transform(trim)
  comment?: string;
}

export class SubmitApprovalRequestDto {
  @IsIn(APPROVAL_TARGET_TYPES)
  targetType!: ApprovalTargetTypeInput;

  @IsUUID()
  targetId!: string;
}
