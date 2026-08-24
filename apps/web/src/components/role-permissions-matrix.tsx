'use client';

import type { OrganizationRole, PermissionKey, RoleMatrixResponse } from '@retailbooks/contracts';
import { Button, EmptyState, Skeleton } from '@retailbooks/ui';
import { Lock, ShieldCheck } from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import { hasPermission, roleLabel, useWorkspace } from '../lib/workspace';

const EDITABLE_ROLES: readonly OrganizationRole[] = ['ADMIN', 'ACCOUNTANT', 'STAFF'];

export function RolePermissionsMatrix() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canManage = hasPermission(organization, 'roles.manage');

  const [matrix, setMatrix] = useState<RoleMatrixResponse['data'] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Set<PermissionKey>>>({});
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [savingRole, setSavingRole] = useState<OrganizationRole | null>(null);

  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;

    apiRequest<{ data: RoleMatrixResponse['data'] }>(`/organizations/${organizationId}/roles`)
      .then((response) => {
        if (cancelled) return;
        setMatrix(response.data);
        setDrafts(toDraftMap(response.data));
        setForbidden(false);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        if (caught instanceof ApiError && caught.status === 403) {
          setForbidden(true);
          return;
        }
        setError(
          caught instanceof Error ? caught.message : 'The permission matrix could not be loaded.',
        );
      });

    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  function toggle(role: OrganizationRole, key: PermissionKey) {
    setDrafts((current) => {
      const next = { ...current };
      const set = new Set(current[role]);
      if (set.has(key)) set.delete(key);
      else set.add(key);
      next[role] = set;
      return next;
    });
  }

  function isDirty(role: OrganizationRole): boolean {
    if (!matrix) return false;
    const original = originalPermissions(matrix, role);
    const draft = drafts[role];
    if (!draft) return false;
    if (original.size !== draft.size) return true;
    for (const key of original) if (!draft.has(key)) return true;
    return false;
  }

  async function save(role: OrganizationRole) {
    if (!organizationId || !matrix) return;
    const original = originalPermissions(matrix, role);
    const draft = drafts[role] ?? new Set<PermissionKey>();
    const changes = matrix.catalog
      .filter((permission) => !permission.protected)
      .map((permission) => permission.key)
      .filter((key) => original.has(key) !== draft.has(key))
      .map((key) => ({ permissionKey: key, granted: draft.has(key) }));

    if (changes.length === 0) return;

    setSavingRole(role);
    setError(null);
    setNotice(null);
    try {
      const response = await apiRequest<{ data: RoleMatrixResponse['data'] }>(
        `/organizations/${organizationId}/roles/${role}`,
        { method: 'PATCH', body: JSON.stringify({ changes }) },
      );
      setMatrix(response.data);
      setDrafts(toDraftMap(response.data));
      setNotice(`${roleLabel(role)} permissions updated.`);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Those permissions could not be saved.',
      );
    } finally {
      setSavingRole(null);
    }
  }

  if (forbidden) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="You don't have access to this"
        description="Ask an owner or administrator to view roles and permissions."
      />
    );
  }

  if (workspace.loading || (!matrix && !error)) {
    return (
      <div className="rb-security-loading" aria-label="Loading permission matrix">
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
    );
  }

  if (!matrix) {
    return (
      <div className="rb-auth-error" role="alert">
        {error}
      </div>
    );
  }

  const groups = Array.from(new Set(matrix.catalog.map((permission) => permission.group)));

  return (
    <div className="rb-security-stack">
      {error ? (
        <div className="rb-auth-error" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rb-auth-notice" role="status">
          {notice}
        </div>
      ) : null}

      <section className="rb-security-section" aria-labelledby="role-matrix-title">
        <div className="rb-security-section__header">
          <div>
            <h2 id="role-matrix-title">Permission matrix</h2>
            <p>
              {canManage
                ? 'Owner always has every permission. Adjust what Administrator, Accountant, and Staff can do.'
                : 'Owner always has every permission. This view reflects what your organization currently grants.'}
            </p>
          </div>
        </div>

        <div className="rb-table-scroll">
          <table className="rb-table rb-permission-matrix">
            <caption className="rb-visually-hidden">Permission matrix by role</caption>
            <thead>
              <tr>
                <th scope="col">Permission</th>
                <th scope="col" className="rb-table--center">
                  Owner
                </th>
                {EDITABLE_ROLES.map((role) => (
                  <th scope="col" className="rb-table--center" key={role}>
                    {roleLabel(role)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <Fragment key={group}>
                  <tr>
                    <th scope="rowgroup" colSpan={5} className="rb-permission-matrix__group">
                      {group}
                    </th>
                  </tr>
                  {matrix.catalog
                    .filter((permission) => permission.group === group)
                    .map((permission) => (
                      <tr key={permission.key}>
                        <td>
                          <strong>{permission.label}</strong>
                          <span className="rb-table-secondary">{permission.description}</span>
                        </td>
                        <td className="rb-table--center">
                          <span className="rb-permission-cell" aria-label="Always granted to Owner">
                            <ShieldCheck aria-hidden="true" />
                          </span>
                        </td>
                        {EDITABLE_ROLES.map((role) => (
                          <td className="rb-table--center" key={role}>
                            {permission.protected ? (
                              <span
                                className="rb-permission-cell"
                                aria-label={`${permission.label} cannot be changed for ${roleLabel(role)}`}
                              >
                                <Lock aria-hidden="true" />
                              </span>
                            ) : (
                              <span className="rb-permission-cell">
                                <input
                                  type="checkbox"
                                  disabled={!canManage || savingRole === role}
                                  checked={drafts[role]?.has(permission.key) ?? false}
                                  onChange={() => toggle(role, permission.key)}
                                  aria-label={`${permission.label} for ${roleLabel(role)}`}
                                />
                              </span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        {canManage ? (
          <div className="rb-permission-matrix__actions">
            {EDITABLE_ROLES.map((role) =>
              isDirty(role) ? (
                <Button
                  key={role}
                  type="button"
                  size="sm"
                  onClick={() => void save(role)}
                  loading={savingRole === role}
                >
                  Save {roleLabel(role)} changes
                </Button>
              ) : null,
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function originalPermissions(
  matrix: RoleMatrixResponse['data'],
  role: OrganizationRole,
): Set<PermissionKey> {
  const entry = matrix.effective.find((item) => item.role === role);
  return new Set(entry?.permissions ?? []);
}

function toDraftMap(matrix: RoleMatrixResponse['data']): Record<string, Set<PermissionKey>> {
  return Object.fromEntries(
    matrix.effective.map((entry) => [entry.role, new Set(entry.permissions)]),
  );
}
