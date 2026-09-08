'use client';

import type { OrganizationSummary } from '@retailbooks/contracts';
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
} from '@retailbooks/ui';
import { Building2, Check, ChevronDown, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { apiRequest } from '../lib/api';
import { organizationDisplayName } from '../lib/workspace';

export function OrganizationSwitcher({
  organizations,
  activeOrganization,
  onSwitched,
}: {
  organizations: OrganizationSummary[];
  activeOrganization: OrganizationSummary | null;
  onSwitched: () => void;
}) {
  const router = useRouter();
  const [switching, setSwitching] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const visibleOrganizations = useMemo(
    () =>
      organizations.filter((organization) =>
        `${organizationDisplayName(organization)} ${organization.role} ${organization.roleKey}`
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase()),
      ),
    [organizations, query],
  );

  const label = activeOrganization
    ? organizationDisplayName(activeOrganization)
    : organizations.length > 0
      ? 'Choose organization'
      : 'No organization yet';

  async function switchTo(organization: OrganizationSummary) {
    if (organization.id === activeOrganization?.id) return;
    setSwitching(organization.id);
    try {
      await apiRequest(`/organizations/${organization.id}/activate`, { method: 'POST' });
      onSwitched();
      if (organization.status === 'DRAFT') {
        router.push('/onboarding');
      } else {
        // A hard destination prevents a just-switched workspace from retaining a resource route
        // or stale client view that belonged to the prior organization.
        router.push('/');
        router.refresh();
      }
    } finally {
      setSwitching(null);
    }
  }

  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <button
          className="rb-organization-switcher"
          type="button"
          aria-label={`Switch organization. Current: ${label}`}
        >
          <Building2 aria-hidden="true" />
          <span>{label}</span>
          <ChevronDown aria-hidden="true" />
        </button>
      </DropdownTrigger>
      <DropdownContent align="start">
        <DropdownLabel>Organizations</DropdownLabel>
        {organizations.length > 6 ? (
          <label className="rb-switcher-search">
            <span className="rb-visually-hidden">Search organizations</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search clients"
            />
          </label>
        ) : null}
        {organizations.length === 0 ? (
          <DropdownItem disabled>No organizations yet</DropdownItem>
        ) : visibleOrganizations.length === 0 ? (
          <DropdownItem disabled>No matching organizations</DropdownItem>
        ) : (
          visibleOrganizations.map((organization) => (
            <DropdownItem
              key={organization.id}
              disabled={switching !== null}
              onSelect={() => void switchTo(organization)}
            >
              <span className="rb-switcher-option">
                <span className="rb-switcher-option__copy">
                  <strong>{organizationDisplayName(organization)}</strong>
                  <small>
                    {organization.role} · {organization.roleKey.toLocaleLowerCase()}
                    {organization.status === 'DRAFT' ? ' · setup unfinished' : ''}
                  </small>
                </span>
                {organization.id === activeOrganization?.id ? (
                  <Check aria-hidden="true" className="rb-switcher-option__check" />
                ) : null}
              </span>
            </DropdownItem>
          ))
        )}
        <DropdownSeparator />
        <DropdownItem onSelect={() => router.push('/onboarding')}>
          <span className="rb-switcher-option">
            <Plus aria-hidden="true" />
            <span>Create organization</span>
          </span>
        </DropdownItem>
      </DropdownContent>
    </Dropdown>
  );
}
