import { Transform } from 'class-transformer';
import { IsArray, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { DOMAIN_EVENT_NAMES } from '@retailbooks/contracts';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateWorkflowRuleDto {
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  name!: string;

  @IsIn(DOMAIN_EVENT_NAMES)
  trigger!: (typeof DOMAIN_EVENT_NAMES)[number];

  @IsArray()
  conditions!: unknown[];

  @IsArray()
  actions!: unknown[];
}

export class UpdateWorkflowRuleDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  name?: string;

  @IsOptional()
  @IsIn(DOMAIN_EVENT_NAMES)
  trigger?: (typeof DOMAIN_EVENT_NAMES)[number];

  @IsOptional()
  @IsArray()
  conditions?: unknown[];

  @IsOptional()
  @IsArray()
  actions?: unknown[];
}

export class WorkflowStatusDto {
  @IsIn(['ACTIVE', 'INACTIVE'])
  status!: 'ACTIVE' | 'INACTIVE';
}

export class WorkflowDryRunDto {
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}
