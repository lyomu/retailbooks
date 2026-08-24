import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';

import { AuthService, type SessionContext } from './auth.service.js';
import { getCookie } from './request-context.js';
import { SESSION_COOKIE, setSessionCookie } from './session-cookie.js';

export interface AuthenticatedRequest extends Request {
  auth: SessionContext;
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const session = await this.auth.authenticate(getCookie(request, SESSION_COOKIE));
    (request as AuthenticatedRequest).auth = session;
    if (session.rotatedToken) setSessionCookie(response, session.rotatedToken);
    return true;
  }
}
