'use client';

import { Button, Card, EmptyState, Input, Label, PageHeader, Skeleton } from '@retailbooks/ui';
import { Search } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { ApiError, apiRequest } from '../lib/api';
import { useWorkspace } from '../lib/workspace';

interface DocumentSearchResult {
  attachmentId: string;
  entityType: 'EXPENSE' | 'BILL';
  entityId: string;
  filename: string;
  snippet: string;
  href: string;
}

/**
 * Keyword search over Expense/Bill receipts that have finished Phase 13D extraction. The backend
 * already filters by organization, extraction status, and the caller's own domain permission --
 * this page just renders whatever it returns, and never treats OCR-derived snippet text as HTML
 * (OCR output is untrusted; it is rendered as plain text only).
 */
export function DocumentSearchPage() {
  const workspace = useWorkspace({ requireOrganization: true });
  const organization = workspace.activeOrganization;
  const organizationId = organization?.id ?? null;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DocumentSearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    if (!organizationId || query.trim().length < 2) return;
    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest<{ data: DocumentSearchResult[] }>(
        `/organizations/${organizationId}/documents/search?q=${encodeURIComponent(query.trim())}`,
      );
      setResults(response.data);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The search could not be completed.');
      setResults(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Search receipts and bills"
        description="Keyword search over reviewed Expense and Bill attachments you have access to."
      />
      <div className="rb-ledger-stack">
        <Card className="rb-report-filters">
          <div className="rb-field">
            <Label htmlFor="document-search-query">Search</Label>
            <Input
              id="document-search-query"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void search();
              }}
              placeholder="Vendor name, item, reference…"
            />
          </div>
          <Button
            onClick={() => void search()}
            loading={loading}
            disabled={query.trim().length < 2}
          >
            <Search aria-hidden="true" /> Search
          </Button>
        </Card>

        {error ? (
          <div className="rb-auth-error" role="alert">
            {error}
          </div>
        ) : null}
        {loading ? <Skeleton /> : null}
        {results && results.length === 0 ? (
          <EmptyState
            title="No matches"
            description="No reviewed receipts or bills matched that search."
          />
        ) : null}
        {results && results.length > 0 ? (
          <Card>
            <ul className="rb-attachment-list">
              {results.map((result) => (
                <li key={result.attachmentId}>
                  <Link href={result.href} className="rb-attachment-link">
                    {result.filename}
                  </Link>
                  <span className="rb-table-secondary">{result.snippet}</span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </>
  );
}
