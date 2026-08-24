import { Transform, Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const trimOrUndefined = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

export class AuditLogQueryDto {
  /** Opaque keyset cursor: base64 of `${occurredAtIso}|${id}`, returned as `nextCursor`. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(trimOrUndefined)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  /** Exact key or dot-namespace prefix, e.g. `ledger.` or `ledger.journal_posted`. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(trimOrUndefined)
  eventKey?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  @Transform(trim)
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  @Transform(trim)
  to?: string;
}
