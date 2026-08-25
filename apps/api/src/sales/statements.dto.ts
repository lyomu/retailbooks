import { Transform } from 'class-transformer';
import { IsISO8601, IsOptional } from 'class-validator';

const trimOrUndefined = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

export class GetStatementQueryDto {
  @IsOptional()
  @IsISO8601({ strict: true })
  @Transform(trimOrUndefined)
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  @Transform(trimOrUndefined)
  to?: string;
}
