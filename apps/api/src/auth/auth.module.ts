import { Module } from '@nestjs/common';

import { AuthController, MeController } from './auth.controller.js';
import { AuthMailerService } from './auth-mailer.service.js';
import { AuthRateLimitService } from './auth-rate-limit.service.js';
import { AuthService } from './auth.service.js';
import { SessionGuard } from './session.guard.js';

@Module({
  controllers: [AuthController, MeController],
  providers: [AuthService, AuthMailerService, AuthRateLimitService, SessionGuard],
  exports: [AuthService, AuthMailerService, AuthRateLimitService, SessionGuard],
})
export class AuthModule {}
