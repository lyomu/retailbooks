import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class NotificationPreferenceDto {
  @IsString()
  @MaxLength(100)
  eventKey!: string;

  @IsOptional()
  @IsBoolean()
  inAppEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  emailEnabled?: boolean;
}
