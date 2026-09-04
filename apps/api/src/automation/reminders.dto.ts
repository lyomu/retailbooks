import { IsArray, IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateReminderPolicyDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsArray()
  offsets!: unknown[];

  @IsString()
  @MaxLength(240)
  subject!: string;

  @IsString()
  @MaxLength(20_000)
  bodyTemplate!: string;
}

export class UpdateReminderPolicyDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsArray()
  offsets?: unknown[];

  @IsOptional()
  @IsString()
  @MaxLength(240)
  subject?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  bodyTemplate?: string;
}

export class ReminderPolicyActiveDto {
  @IsBoolean()
  active!: boolean;
}
