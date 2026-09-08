import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';

import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { PortalAccessService } from './portal-access.service.js';
import type { PortalRequest } from './portal-context.js';

@Injectable()
export class PortalAccessGuard implements CanActivate {
  constructor(private readonly access: PortalAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const id = request.params.portalUserId;
    if (!request.auth || typeof id !== 'string')
      throw new NotFoundException('Portal account not found.');
    (request as PortalRequest).portal = await this.access.require(request.auth.user.id, id);
    return true;
  }
}
