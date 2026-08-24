import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { clearActiveOrganizationCookie } from '../organizations/organization-cookie.js';
import { hashIdentifier } from './auth.crypto.js';
import { AuthRateLimitService } from './auth-rate-limit.service.js';
import { AuthService } from './auth.service.js';
import { EmailDto, LoginDto, ResetPasswordDto, SignupDto, TokenDto } from './auth.dto.js';
import { getCookie, requestMetadata } from './request-context.js';
import { clearSessionCookie, SESSION_COOKIE, setSessionCookie } from './session-cookie.js';
import { SessionGuard, type AuthenticatedRequest } from './session.guard.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly rateLimit: AuthRateLimitService,
  ) {}

  @Post('signup')
  @HttpCode(202)
  async signup(@Body() input: SignupDto, @Req() request: Request) {
    const metadata = requestMetadata(request, this.auth.pepper);
    await this.rateLimit.consume(`auth:signup:ip:${metadata.ipHash}`, 25, 60 * 60);
    await this.rateLimit.consume(
      `auth:signup:${metadata.ipHash}:${hashIdentifier(input.email, this.auth.pepper)}`,
      5,
      60 * 60,
    );
    return { data: await this.auth.signup(input, metadata) };
  }

  @Post('resend-verification')
  @HttpCode(202)
  async resendVerification(@Body() input: EmailDto, @Req() request: Request) {
    const metadata = requestMetadata(request, this.auth.pepper);
    await this.rateLimit.consume(`auth:verify-resend:${metadata.ipHash}`, 5, 60 * 60);
    return { data: await this.auth.resendVerification(input.email) };
  }

  @Post('verify-email')
  @HttpCode(200)
  async verifyEmail(@Body() input: TokenDto, @Req() request: Request) {
    const metadata = requestMetadata(request, this.auth.pepper);
    await this.rateLimit.consume(`auth:verify:${metadata.ipHash}`, 12, 60 * 60);
    return { data: await this.auth.verifyEmail(input.token, metadata) };
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() input: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const metadata = requestMetadata(request, this.auth.pepper);
    await this.rateLimit.consume(`auth:login:ip:${metadata.ipHash}`, 50, 15 * 60);
    await this.rateLimit.consume(
      `auth:login:${metadata.ipHash}:${hashIdentifier(input.email, this.auth.pepper)}`,
      8,
      15 * 60,
    );
    const result = await this.auth.login(input, metadata);
    setSessionCookie(response, result.token);
    return { data: { user: result.user } };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(getCookie(request, SESSION_COOKIE));
    clearSessionCookie(response);
    clearActiveOrganizationCookie(response);
  }

  @Post('forgot-password')
  @HttpCode(202)
  async forgotPassword(@Body() input: EmailDto, @Req() request: Request) {
    const metadata = requestMetadata(request, this.auth.pepper);
    await this.rateLimit.consume(`auth:forgot:ip:${metadata.ipHash}`, 25, 60 * 60);
    await this.rateLimit.consume(
      `auth:forgot:${metadata.ipHash}:${hashIdentifier(input.email, this.auth.pepper)}`,
      5,
      60 * 60,
    );
    return { data: await this.auth.forgotPassword(input.email) };
  }

  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(@Body() input: ResetPasswordDto, @Req() request: Request) {
    const metadata = requestMetadata(request, this.auth.pepper);
    await this.rateLimit.consume(`auth:reset:${metadata.ipHash}`, 8, 60 * 60);
    return { data: await this.auth.resetPassword(input, metadata) };
  }

  @Get('sessions')
  @UseGuards(SessionGuard)
  async sessions(@Req() request: AuthenticatedRequest) {
    return {
      data: await this.auth.listSessions(request.auth.user.id, request.auth.sessionId),
    };
  }

  @Delete('sessions/others')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async revokeOthers(@Req() request: AuthenticatedRequest) {
    await this.auth.revokeOtherSessions(request.auth.user.id, request.auth.sessionId);
  }

  @Delete('sessions/:sessionId')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async revokeSession(
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.revokeSession(sessionId, request.auth.user.id);
    if (sessionId === request.auth.sessionId) clearSessionCookie(response);
  }
}

@Controller('me')
@UseGuards(SessionGuard)
export class MeController {
  @Get()
  me(@Req() request: AuthenticatedRequest) {
    return { data: request.auth.user };
  }
}
