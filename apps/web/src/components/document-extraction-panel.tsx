'use client';

import {
  Badge,
  Button,
  Dialog,
  DrawerContent,
  ErrorState,
  Input,
  Label,
  Skeleton,
} from '@retailbooks/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError, apiRequest } from '../lib/api';

export type DocumentExtractionStatus =
  | 'PENDING'
  | 'SCANNING'
  | 'QUARANTINED'
  | 'UNSUPPORTED_FOR_EXTRACTION'
  | 'OCR_PROCESSING'
  | 'EXTRACTING'
  | 'READY_FOR_REVIEW'
  | 'FAILED';

export interface ExtractionCandidate {
  vendorName: string | null;
  vendorId: string | null;
  date: string | null;
  currency: string | null;
  subtotalMinor: string | null;
  taxMinor: string | null;
  totalMinor: string | null;
  categoryId: string | null;
  arithmeticValid: boolean;
  fieldFlags: string[];
  sourceRegions: Record<string, { lineIndex: number; page: number; text: string }>;
}

export interface ExtractionDetail {
  id: string;
  attachmentId: string;
  status: DocumentExtractionStatus;
  failureReason: string | null;
  scanSignature: string | null;
  duplicateOfAttachmentId: string | null;
  candidate: ExtractionCandidate | null;
  disposition: 'PENDING' | 'ACCEPTED' | 'REJECTED';
}

const PROCESSING_STATUSES = new Set<DocumentExtractionStatus>([
  'PENDING',
  'SCANNING',
  'OCR_PROCESSING',
  'EXTRACTING',
]);

const POLL_MS = 3_000;
const MAX_POLLS = 20;

export function DocumentExtractionPanel({
  basePath,
  attachmentId,
  filename,
  canManage,
  onClose,
  onApply,
}: {
  /** e.g. `/organizations/:id/expenses/:expenseId` or `/organizations/:id/bills/:billId` */
  basePath: string;
  attachmentId: string;
  filename: string;
  canManage: boolean;
  onClose: () => void;
  /** Only Expense wires this: its single-amount form can be pre-filled directly. Bills' line-item
   * structure isn't a one-field mapping, so it omits this and just shows accept/reject. */
  onApply?: (candidate: ExtractionCandidate) => void;
}) {
  const [extraction, setExtraction] = useState<ExtractionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const pollCount = useRef(0);

  const load = useCallback(async () => {
    try {
      const response = await apiRequest<{ data: ExtractionDetail | null }>(
        `${basePath}/attachments/${attachmentId}/extraction`,
      );
      setExtraction(response.data);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'This extraction could not be loaded.',
      );
    }
  }, [basePath, attachmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!extraction || !PROCESSING_STATUSES.has(extraction.status)) return;
    if (pollCount.current >= MAX_POLLS) return;
    const timer = setTimeout(() => {
      pollCount.current += 1;
      void load();
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [extraction, load]);

  async function decide(action: 'accept' | 'reject') {
    setBusy(action);
    try {
      const response = await apiRequest<{ data: ExtractionDetail }>(
        `${basePath}/attachments/${attachmentId}/extraction/${action}`,
        { method: 'POST' },
      );
      setExtraction(response.data);
      if (action === 'accept' && onApply && extraction?.candidate) onApply(extraction.candidate);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'That could not be recorded.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent
        side="right"
        title={`Receipt review: ${filename}`}
        description="Deterministic scan/OCR status and an editable candidate for this receipt."
      >
        <div className="rb-explain-panel">
          {error ? (
            <ErrorState title="This extraction could not be loaded" description={error} />
          ) : null}
          {!extraction && !error ? <Skeleton /> : null}
          {extraction ? <ExtractionBody extraction={extraction} /> : null}
          {extraction?.status === 'READY_FOR_REVIEW' && extraction.candidate ? (
            <CandidateForm candidate={extraction.candidate} />
          ) : null}
          {extraction?.status === 'READY_FOR_REVIEW' &&
          canManage &&
          extraction.disposition === 'PENDING' ? (
            <div className="rb-explain-ai">
              {onApply ? (
                <Button size="sm" loading={busy === 'accept'} onClick={() => void decide('accept')}>
                  Use these values
                </Button>
              ) : (
                <Button size="sm" loading={busy === 'accept'} onClick={() => void decide('accept')}>
                  Accept
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                loading={busy === 'reject'}
                onClick={() => void decide('reject')}
              >
                Dismiss
              </Button>
            </div>
          ) : null}
          {extraction && extraction.disposition !== 'PENDING' ? (
            <Badge tone={extraction.disposition === 'ACCEPTED' ? 'success' : 'neutral'}>
              {extraction.disposition === 'ACCEPTED' ? 'Values used' : 'Dismissed'}
            </Badge>
          ) : null}
        </div>
      </DrawerContent>
    </Dialog>
  );
}

function ExtractionBody({ extraction }: { extraction: ExtractionDetail }) {
  if (PROCESSING_STATUSES.has(extraction.status)) {
    return (
      <div className="rb-explain-unavailable" aria-live="polite">
        <Badge tone="neutral">{statusCopy(extraction.status)}</Badge>
        <Skeleton />
      </div>
    );
  }
  if (extraction.status === 'QUARANTINED') {
    return (
      <div className="rb-explain-unavailable" role="alert">
        <Badge tone="danger">Quarantined</Badge>
        <p className="rb-muted">
          The malware scanner flagged this file
          {extraction.scanSignature ? ` (${extraction.scanSignature})` : ''}. It was never
          OCR&apos;d and can&apos;t be used.
        </p>
      </div>
    );
  }
  if (extraction.status === 'UNSUPPORTED_FOR_EXTRACTION') {
    return (
      <div className="rb-explain-unavailable">
        <Badge tone="neutral">Not OCR&apos;d</Badge>
        <p className="rb-muted">
          This file passed the malware scan, but this file type isn&apos;t read for candidate fields
          yet.
        </p>
      </div>
    );
  }
  if (extraction.status === 'FAILED') {
    return (
      <div className="rb-explain-unavailable" role="alert">
        <Badge tone="warning">Processing failed</Badge>
        <p className="rb-muted">{failureCopy(extraction.failureReason)}</p>
      </div>
    );
  }
  if (extraction.duplicateOfAttachmentId) {
    return <Badge tone="warning">This looks like a duplicate of another uploaded file.</Badge>;
  }
  return null;
}

function CandidateForm({ candidate }: { candidate: ExtractionCandidate }) {
  return (
    <div className="rb-explain-ready">
      <div className="rb-explain-summary-row">
        <Badge tone={candidate.arithmeticValid ? 'success' : 'neutral'}>
          {candidate.arithmeticValid ? 'Subtotal + tax reconciles' : 'Reconciliation unverified'}
        </Badge>
      </div>
      <Field label="Vendor" flagged={candidate.fieldFlags.includes('vendor_unmatched')}>
        <Input readOnly value={candidate.vendorName ?? ''} placeholder="Not found" />
        {candidate.vendorId ? <Badge tone="success">Matched existing vendor</Badge> : null}
      </Field>
      <Field label="Date" flagged={hasFlag(candidate.fieldFlags, 'date')}>
        <Input readOnly value={candidate.date ?? ''} placeholder="Not found" />
      </Field>
      <Field label="Currency" flagged={hasFlag(candidate.fieldFlags, 'currency')}>
        <Input readOnly value={candidate.currency ?? ''} placeholder="Not found" />
      </Field>
      <Field label="Subtotal" flagged={hasFlag(candidate.fieldFlags, 'subtotal')}>
        <Input readOnly value={formatMinor(candidate.subtotalMinor)} placeholder="Not found" />
      </Field>
      <Field label="Tax" flagged={hasFlag(candidate.fieldFlags, 'tax')}>
        <Input readOnly value={formatMinor(candidate.taxMinor)} placeholder="Not found" />
      </Field>
      <Field label="Total" flagged={hasFlag(candidate.fieldFlags, 'total')}>
        <Input readOnly value={formatMinor(candidate.totalMinor)} placeholder="Not found" />
      </Field>
      <p className="rb-muted rb-explain-caption">
        A deterministic OCR/regex reading of the receipt -- not verified fact. Review every value
        against the receipt before using it.
      </p>
    </div>
  );
}

function Field({
  label,
  flagged,
  children,
}: {
  label: string;
  flagged: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rb-field">
      <Label>
        {label} {flagged ? <Badge tone="warning">Check this</Badge> : null}
      </Label>
      {children}
    </div>
  );
}

function hasFlag(flags: string[], prefix: string): boolean {
  return flags.some((flag) => flag.startsWith(prefix));
}

function formatMinor(value: string | null): string {
  if (value === null) return '';
  try {
    return (Number(BigInt(value)) / 100).toFixed(2);
  } catch {
    return value;
  }
}

function statusCopy(status: DocumentExtractionStatus): string {
  if (status === 'PENDING') return 'Queued for scanning…';
  if (status === 'SCANNING') return 'Scanning for malware…';
  if (status === 'OCR_PROCESSING') return 'Reading the receipt…';
  return 'Extracting candidate fields…';
}

function failureCopy(reason: string | null): string {
  if (reason === 'SCANNER_UNAVAILABLE')
    return 'The malware scanner was unavailable; this will retry.';
  if (reason === 'OCR_FAILED') return 'OCR failed or timed out; this will retry.';
  if (reason === 'CONTENT_HASH_MISMATCH') return 'The stored file did not match what was uploaded.';
  return 'Processing failed and will be retried.';
}
