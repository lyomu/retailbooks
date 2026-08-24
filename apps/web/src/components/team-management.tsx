'use client';

import type { OrganizationInvitation, OrganizationMember } from '@retailbooks/contracts';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  EmptyState,
  FieldMessage,
  Input,
  Label,
  Select,
  Skeleton,
} from '@retailbooks/ui';
import { MailPlus, Trash2, UserPlus, Users } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import { formValue } from '../lib/forms';
import {
  hasPermission,
  organizationDisplayName,
  useAssignableRoles,
  useWorkspace,
} from '../lib/workspace';

export function TeamManagement() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;

  const canInvite = hasPermission(organization, 'members.invite');
  const canViewInvitations = hasPermission(organization, 'invitations.view');
  const canRevoke = hasPermission(organization, 'invitations.revoke');
  const canUpdateMembers = hasPermission(organization, 'members.update');
  const canRemoveMembers = hasPermission(organization, 'members.remove');

  const { roles: assignableRoles } = useAssignableRoles(organizationId);
  const [members, setMembers] = useState<OrganizationMember[] | null>(null);
  const [invitations, setInvitations] = useState<OrganizationInvitation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);
  const [removalTarget, setRemovalTarget] = useState<OrganizationMember | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const memberResponse = await apiRequest<{ data: OrganizationMember[] }>(
        `/organizations/${organizationId}/members`,
      );
      setMembers(memberResponse.data);

      if (canViewInvitations) {
        const invitationResponse = await apiRequest<{ data: OrganizationInvitation[] }>(
          `/organizations/${organizationId}/invitations`,
        );
        setInvitations(invitationResponse.data);
      }
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The team could not be loaded.');
    }
  }, [canViewInvitations, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setInviting(true);
    setError(null);
    setNotice(null);
    try {
      const email = formValue(data, 'email').toLowerCase();
      await apiRequest(`/organizations/${organizationId}/invitations`, {
        method: 'POST',
        body: JSON.stringify({ email, roleId: data.get('roleId') }),
      });
      form.reset();
      setNotice(`Invitation sent to ${email}.`);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The invitation could not be sent.');
    } finally {
      setInviting(false);
    }
  }

  async function revoke(invitation: OrganizationInvitation) {
    if (!organizationId) return;
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/organizations/${organizationId}/invitations/${invitation.id}`, {
        method: 'DELETE',
      });
      setInvitations((current) => current.filter(({ id }) => id !== invitation.id));
      setNotice(`Invitation for ${invitation.email} was withdrawn.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The invitation could not be withdrawn.');
    }
  }

  async function changeRole(member: OrganizationMember, roleId: string) {
    if (!organizationId || roleId === member.roleId) return;
    setBusyMemberId(member.id);
    setError(null);
    setNotice(null);
    try {
      const response = await apiRequest<{ data: OrganizationMember }>(
        `/organizations/${organizationId}/members/${member.id}`,
        { method: 'PATCH', body: JSON.stringify({ roleId }) },
      );
      setMembers(
        (current) =>
          current?.map((entry) => (entry.id === member.id ? response.data : entry)) ?? null,
      );
      setNotice(`${member.displayName} is now ${response.data.roleName}.`);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "The member's role could not be changed.",
      );
    } finally {
      setBusyMemberId(null);
    }
  }

  async function confirmRemoval() {
    if (!organizationId || !removalTarget) return;
    setBusyMemberId(removalTarget.id);
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/organizations/${organizationId}/members/${removalTarget.id}`, {
        method: 'DELETE',
      });
      setMembers((current) => current?.filter(({ id }) => id !== removalTarget.id) ?? null);
      setNotice(`${removalTarget.displayName} was removed from this organization.`);
      setRemovalTarget(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That member could not be removed.');
    } finally {
      setBusyMemberId(null);
    }
  }

  if (workspace.loading || (!members && !error)) {
    return (
      <div className="rb-security-loading" aria-label="Loading team">
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
    );
  }

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

      <section className="rb-security-section" aria-labelledby="team-members-title">
        <div className="rb-security-section__header">
          <div>
            <h2 id="team-members-title">People</h2>
            <p>
              Everyone with access to{' '}
              {organization ? organizationDisplayName(organization) : 'this organization'}.
            </p>
          </div>
          <Badge>
            {members?.length ?? 0} member{(members?.length ?? 0) === 1 ? '' : 's'}
          </Badge>
        </div>

        {members?.length ? (
          <ul className="rb-member-list">
            {members.map((member) => (
              <li key={member.id}>
                <span className="rb-avatar" aria-hidden="true">
                  {initialsOf(member.displayName)}
                </span>
                <div className="rb-member-list__copy">
                  <div>
                    <strong>{member.displayName}</strong>
                    {member.userId === workspace.user?.id ? <Badge tone="info">You</Badge> : null}
                    {member.status === 'SUSPENDED' ? <Badge tone="warning">Suspended</Badge> : null}
                  </div>
                  <span>{member.email}</span>
                </div>
                <div className="rb-member-list__actions">
                  {member.isOwnerRole ? (
                    <Badge tone="success">{member.roleName}</Badge>
                  ) : canUpdateMembers ? (
                    <Select
                      aria-label={`Change role for ${member.displayName}`}
                      value={member.roleId}
                      disabled={busyMemberId === member.id}
                      onChange={(event) => void changeRole(member, event.target.value)}
                    >
                      {assignableRoles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Badge>{member.roleName}</Badge>
                  )}
                  {!member.isOwnerRole &&
                  canRemoveMembers &&
                  member.userId !== workspace.user?.id ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      onClick={() => setRemovalTarget(member)}
                      disabled={busyMemberId === member.id}
                      aria-label={`Remove ${member.displayName}`}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={Users}
            title="No members yet"
            description="Invite the people who work on these books."
          />
        )}
      </section>

      {canInvite ? (
        <section className="rb-security-section" aria-labelledby="team-invite-title">
          <div className="rb-security-section__header">
            <div>
              <h2 id="team-invite-title">Invite someone</h2>
              <p>They receive a single-use link that expires in 14 days.</p>
            </div>
          </div>

          <form className="rb-invite-form" onSubmit={(event) => void invite(event)} noValidate>
            <div className="rb-field">
              <Label htmlFor="team-invite-email">Email address</Label>
              <Input
                id="team-invite-email"
                name="email"
                type="email"
                required
                maxLength={254}
                autoComplete="email"
              />
            </div>
            <div className="rb-field">
              <Label htmlFor="team-invite-role">Role</Label>
              <Select id="team-invite-role" name="roleId">
                {assignableRoles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" loading={inviting}>
              <UserPlus aria-hidden="true" /> Send invitation
            </Button>
          </form>
          <FieldMessage>Ownership cannot be granted by invitation.</FieldMessage>
        </section>
      ) : null}

      {canViewInvitations ? (
        <section className="rb-security-section" aria-labelledby="team-pending-title">
          <div className="rb-security-section__header">
            <div>
              <h2 id="team-pending-title">Pending invitations</h2>
              <p>Invitations that have not been accepted yet.</p>
            </div>
          </div>

          {invitations.length ? (
            <ul className="rb-invite-list">
              {invitations.map((invitation) => (
                <li key={invitation.id}>
                  <div className="rb-invite-list__copy">
                    <div>
                      <strong>{invitation.email}</strong>
                      {invitation.expired ? <Badge tone="warning">Expired</Badge> : null}
                      {!invitation.delivered ? <Badge tone="info">Queued</Badge> : null}
                    </div>
                    <span>
                      {invitation.roleName} · invited by {invitation.invitedBy} · expires{' '}
                      {formatDate(invitation.expiresAt)}
                    </span>
                  </div>
                  {canRevoke ? (
                    <Button
                      variant="ghost"
                      type="button"
                      onClick={() => void revoke(invitation)}
                      aria-label={`Withdraw the invitation for ${invitation.email}`}
                    >
                      <Trash2 aria-hidden="true" /> Withdraw
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={MailPlus}
              title="No pending invitations"
              description="Everyone you invited has already joined."
            />
          )}
        </section>
      ) : null}

      <Dialog
        open={removalTarget !== null}
        onOpenChange={(open) => !open && setRemovalTarget(null)}
      >
        {removalTarget ? (
          <DialogContent
            title={`Remove ${removalTarget.displayName}?`}
            description="They will immediately lose access to this organization. You can invite them again later."
          >
            <div className="rb-dialog-footer">
              <Button type="button" variant="outline" onClick={() => setRemovalTarget(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={() => void confirmRemoval()}
                loading={busyMemberId === removalTarget.id}
              >
                Remove member
              </Button>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}

function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0] ?? '')
      .join('')
      .toUpperCase() || 'RB'
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}
