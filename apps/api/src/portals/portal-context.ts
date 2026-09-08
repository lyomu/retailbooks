import type { AuthenticatedRequest } from '../auth/session.guard.js';

/**
 * The resolved portal boundary. It is rebuilt from the active grant on every request; clients
 * never choose an organization or customer scope independently of this object.
 */
export interface PortalContext {
  id: string;
  organizationId: string;
  contactId: string;
  userId: string;
  organizationName: string;
  contactName: string;
}

export interface PortalRequest extends AuthenticatedRequest {
  portal: PortalContext;
}
