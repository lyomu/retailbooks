import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateExpenseCategoryDto {
  @IsString()
  @Length(1, 120)
  @Transform(trim)
  name!: string;

  @IsString()
  @Length(36, 36)
  accountId!: string;
}

export class UpdateExpenseCategoryDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  @Transform(trim)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(36, 36)
  accountId?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
