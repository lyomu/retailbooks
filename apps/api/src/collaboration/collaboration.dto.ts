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
  @IsOptional()
  @IsString()
  @MaxLength(100)
  cursor?: string;
}
