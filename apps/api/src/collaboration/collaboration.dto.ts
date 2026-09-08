import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateCommentDto {
  @IsString()
  @Length(1, 4000)
  @Transform(trim)
  body!: string;

  @IsOptional()
  @IsIn(['INTERNAL', 'CUSTOMER'])
  visibility?: 'INTERNAL' | 'CUSTOMER';
}

export class CollaborationCursorDto {
  // A cursor is base64url over an ISO timestamp plus a UUID, which lands around 116 characters --
  // the previous 100-character limit rejected the very cursors this API hands out, so the second
  // page of any timeline was unreachable. The bound stays only to cap an obviously absurd input.
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}
