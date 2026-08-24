'use client';

import type { PermissionKey, RoleListResponse, RoleSummary } from '@retailbooks/contracts';
import { Button, EmptyState, Skeleton } from '@retailbooks/ui';
import { Lock, ShieldCheck } from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import { hasPermission, useWorkspace } from '../lib/workspace';

export function RolePermissionsMatrix() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const canManage = hasPermission(organization, 'roles.manage');

  const [matrix, setMatrix] = useState<RoleListResponse['data'] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Set<PermissionKey>>>({});
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [savingRoleId, setSavingRoleId] = useState<string | null>(null);

  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;

    apiRequest<{ data: RoleListResponse['data'] }>(`/organizations/${organizationId}/roles`)
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

  function toggle(roleId: string, key: PermissionKey) {
    setDrafts((current) => {
      const next = { ...current };
      const set = new Set(current[roleId]);
      if (set.has(key)) set.delete(key);
      else set.add(key);
      next[roleId] = set;
      return next;
    });
  }

  function isDirty(role: RoleSummary): boolean {
    const draft = drafts[role.id];
    if (!draft) return false;
    if (role.permissions.length !== draft.size) return true;
    return role.permissions.some((key) => !draft.has(key));
  }

  async function save(role: RoleSummary) {
    if (!organizationId || !matrix) return;
    const draft = drafts[role.id] ?? new Set<PermissionKey>();

    setSavingRoleId(role.id);
    setError(null);
    setNotice(null);
    try {
      const response = await apiRequest<{ data: RoleSummary }>(
        `/organizations/${organizationId}/roles/${role.id}`,
        { method: 'PATCH', body: JSON.stringify({ permissions: Array.from(draft) }) },
      );
      setMatrix((current) =>
        current
          ? {
              ...current,
              roles: current.roles.map((entry) => (entry.id === role.id ? response.data : entry)),
            }
          : current,
      );
      setDrafts((current) => ({ ...current, [role.id]: new Set(response.data.permissions) }));
      setNotice(`${response.data.name} permissions updated.`);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Those permissions could not be saved.',
      );
    } finally {
      setSavingRoleId(null);
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

  const owner = matrix.roles.find((role) => role.isOwnerRole);
  const editableRoles = matrix.roles.filter((role) => !role.isOwnerRole);
  const groups = Array.from(new Set(matrix.catalog.map((permission) => permission.group)));
  const columnCount = 1 + matrix.roles.length;

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
                ? `${owner?.name ?? 'Owner'} always has every permission. Adjust what every other role can do.`
                : `${owner?.name ?? 'Owner'} always has every permission. This view reflects what your organization currently grants.`}
            </p>
          </div>
        </div>

        <div className="rb-table-scroll">
          <table className="rb-table rb-permission-matrix">
            <caption className="rb-visually-hidden">Permission matrix by role</caption>
            <thead>
              <tr>
                <th scope="col">Permission</th>
                {owner ? (
                  <th scope="col" className="rb-table--center">
                    {owner.name}
                  </th>
                ) : null}
                {editableRoles.map((role) => (
                  <th scope="col" className="rb-table--center" key={role.id}>
                    {role.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <Fragment key={group}>
                  <tr>
                    <th
                      scope="rowgroup"
                      colSpan={columnCount}
                      className="rb-permission-matrix__group"
                    >
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
                        {owner ? (
                          <td className="rb-table--center">
                            <span
                              className="rb-permission-cell"
                              aria-label={`Always granted to ${owner.name}`}
                            >
                              <ShieldCheck aria-hidden="true" />
                            </span>
                          </td>
                        ) : null}
                        {editableRoles.map((role) => (
                          <td className="rb-table--center" key={role.id}>
                            {permission.protected ? (
                              <span
                                className="rb-permission-cell"
                                aria-label={`${permission.label} cannot be changed for ${role.name}`}
                              >
                                <Lock aria-hidden="true" />
                              </span>
                            ) : (
                              <span className="rb-permission-cell">
                                <input
                                  type="checkbox"
                                  disabled={!canManage || savingRoleId === role.id}
                                  checked={drafts[role.id]?.has(permission.key) ?? false}
                                  onChange={() => toggle(role.id, permission.key)}
                                  aria-label={`${permission.label} for ${role.name}`}
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
            {editableRoles.map((role) =>
              isDirty(role) ? (
                <Button
                  key={role.id}
                  type="button"
                  size="sm"
                  onClick={() => void save(role)}
                  loading={savingRoleId === role.id}
                >
                  Save {role.name} changes
                </Button>
              ) : null,
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function toDraftMap(matrix: RoleListResponse['data']): Record<string, Set<PermissionKey>> {
  return Object.fromEntries(matrix.roles.map((role) => [role.id, new Set(role.permissions)]));
}
