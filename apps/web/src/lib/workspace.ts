'use client';

import type {
  OrganizationSummary,
  PermissionKey,
  PublicUser,
  RoleSummary,
} from '@retailbooks/contracts';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { ApiError, apiRequest } from './api';

export interface WorkspaceSnapshot {
  user: PublicUser | null;
  organizations: OrganizationSummary[];
  activeOrganizationId: string | null;
}

export interface Workspace extends WorkspaceSnapshot {
  loading: boolean;
  error: string | null;
  activeOrganization: OrganizationSummary | null;
  refresh: () => Promise<void>;
}

/**
 * Loads the signed-in user and the organizations they are a member of.
 *
 * The list always comes from the API, which resolves it from the session rather than from anything
 * the browser supplies, so the switcher can never offer an organization the user cannot reach.
 */
export function useWorkspace({
  requireOrganization = false,
}: { requireOrganization?: boolean } = {}): Workspace {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>({
    user: null,
    organizations: [],
    activeOrganizationId: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [me, list] = await Promise.all([
        apiRequest<{ data: PublicUser }>('/me'),
        apiRequest<{
          data: { organizations: OrganizationSummary[]; activeOrganizationId: string | null };
        }>('/organizations'),
      ]);

      setSnapshot({
        user: me.data,
        organizations: list.data.organizations,
        activeOrganizationId: list.data.activeOrganizationId,
      });
      setError(null);

      if (requireOrganization && !list.data.organizations.some((org) => org.status === 'ACTIVE')) {
        router.replace('/onboarding');
        return;
      }
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        router.replace('/login');
        return;
      }
      setError(caught instanceof Error ? caught.message : 'Your workspace could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [requireOrganization, router]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeOrganization =
    snapshot.organizations.find((org) => org.id === snapshot.activeOrganizationId) ?? null;

  return { ...snapshot, activeOrganization, loading, error, refresh: load };
}

/** Gates UI on the caller's effective permission set for an organization, resolved server-side. */
export function hasPermission(
  organization: Pick<OrganizationSummary, 'permissions'> | null | undefined,
  key: PermissionKey,
): boolean {
  return Boolean(organization?.permissions.includes(key));
}

export function organizationDisplayName(organization: {
  legalName: string;
  tradingName: string | null;
}): string {
  return organization.tradingName ?? organization.legalName;
}

/**
 * Fetches the organization's roles for an invite or role-change select. Excludes the owner role --
 * every caller of this hook is choosing a role to assign, and ownership is never assignable that
 * way.
 */
export function useAssignableRoles(organizationId: string | null): {
  roles: RoleSummary[];
  loading: boolean;
} {
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!organizationId) {
      setRoles([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);

    apiRequest<{ data: { roles: RoleSummary[] } }>(`/organizations/${organizationId}/roles`)
      .then((response) => {
        if (cancelled) return;
        setRoles(response.data.roles.filter((role) => !role.isOwnerRole));
      })
      .catch(() => {
        if (!cancelled) setRoles([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  return { roles, loading };
}
