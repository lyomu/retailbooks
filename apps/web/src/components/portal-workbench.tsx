'use client';

import {
  Download,
  FileText,
  LogOut,
  MessageSquare,
  Paperclip,
  ReceiptText,
  UserRound,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError, apiDownload, apiRequest, apiUpload } from '../lib/api';

type PortalAccount = { id: string; organizationName: string; customerName: string };
type PortalDocument = {
  id: string;
  type: string;
  number: string | null;
  status: string;
  issueDate: string | null;
  dueDate: string | null;
  currency: string;
  totalMinor: string;
  exposedAt: string;
};
type PortalDocumentDetail = {
  id: string;
  type: string;
  number: string | null;
  status: string;
  issueDate: string | null;
  dueDate: string | null;
  currency: string;
  totalMinor: string;
  lines: Array<{
    description: string;
    quantity: string;
    unitPriceMinor: string;
    discountMinor: string;
    totalMinor: string;
  }>;
};
type PortalComment = { id: string; body: string; author: string; createdAt: string };
type PortalFile = { id: string; filename: string; sizeBytes: number; createdAt: string };
type PortalAddress = {
  id?: string;
  kind: 'BILLING' | 'SHIPPING';
  line1: string;
  line2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string;
  isDefault: boolean;
};
type PortalProfile = {
  displayName: string;
  email: string | null;
  phone: string | null;
  addresses: PortalAddress[];
};
type Statement = {
  from: string | null;
  to: string;
  summary: { openingBalanceMinor: string; closingBalanceMinor: string };
  transactions: Array<{
    id: string;
    date: string;
    description: string;
    debitMinor: string;
    creditMinor: string;
    balanceMinor: string;
  }>;
};

export function PortalWorkbench() {
  const [accounts, setAccounts] = useState<PortalAccount[]>([]);
  const [active, setActive] = useState<PortalAccount | null>(null);
  const [documents, setDocuments] = useState<PortalDocument[]>([]);
  const [selected, setSelected] = useState<PortalDocument | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'signed-out' | 'revoked'>(
    'loading',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  /** A grant can be revoked between page load and the next request; say so rather than failing. */
  const handle = useCallback((caught: unknown) => {
    if (caught instanceof ApiError && caught.status === 401) {
      setState('signed-out');
      return;
    }
    if (caught instanceof ApiError && caught.status === 404) {
      setState('revoked');
      return;
    }
    setError(caught instanceof ApiError ? caught.message : 'Something went wrong. Try again.');
  }, []);

  const loadAccount = useCallback(async (account: PortalAccount) => {
    const overview = await apiRequest<{ data: { documents: PortalDocument[] } }>(
      `/portal/accounts/${account.id}/overview`,
    );
    setDocuments(overview.data.documents);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const response = await apiRequest<{ data: PortalAccount[] }>('/portal/accounts');
        setAccounts(response.data);
        const first = response.data[0] ?? null;
        setActive(first);
        if (first) await loadAccount(first);
        setState('ready');
      } catch (caught) {
        setState(caught instanceof ApiError && caught.status === 401 ? 'signed-out' : 'error');
      }
    })();
  }, [loadAccount]);

  async function selectAccount(id: string) {
    const account = accounts.find((candidate) => candidate.id === id) ?? null;
    setActive(account);
    setSelected(null);
    setDocuments([]);
    setError('');
    if (!account) return;
    try {
      await loadAccount(account);
    } catch (caught) {
      handle(caught);
    }
  }

  async function download(document: PortalDocument) {
    if (!active) return;
    setBusy(true);
    setError('');
    try {
      const response = await apiRequest<{ data: { downloadUrl: string } }>(
        `/portal/accounts/${active.id}/documents/${document.type}/${document.id}/download`,
      );
      window.open(response.data.downloadUrl, '_blank', 'noopener,noreferrer');
    } catch (caught) {
      handle(caught);
    } finally {
      setBusy(false);
    }
  }

  if (state === 'loading')
    return <PortalState title="Loading your portal" copy="Getting your documents ready." />;
  if (state === 'signed-out')
    return (
      <PortalState
        title="Sign in to view your documents"
        copy="Use the email address that received your customer portal invitation."
        action={{ href: '/portal/login', label: 'Sign in' }}
      />
    );
  if (state === 'revoked')
    return (
      <PortalState
        title="This portal access has ended"
        copy="Your access to this customer account was withdrawn. Contact the business if you still need these documents."
        action={{ href: '/portal', label: 'Reload the portal' }}
      />
    );
  if (state === 'error')
    return (
      <PortalState
        title="We could not open your portal"
        copy="Please refresh, or sign in again if your access has changed."
        action={{ href: '/portal/login', label: 'Sign in again' }}
      />
    );

  return (
    <main id="main-content" className="rb-portal">
      <header className="rb-portal__header">
        <Link href="/portal" className="rb-portal__brand">
          <ReceiptText aria-hidden="true" /> RetailBooks portal
        </Link>
        <a className="rb-portal__signout" href="/login">
          <LogOut aria-hidden="true" /> Sign out
        </a>
      </header>
      <section className="rb-portal__welcome">
        <div>
          <p className="rb-portal__kicker">Customer documents</p>
          <h1>{active ? active.organizationName : 'Your customer portal'}</h1>
          <p>
            {active
              ? `Documents and messages for ${active.customerName}.`
              : 'You do not have an active customer account yet.'}
          </p>
        </div>
        {accounts.length > 1 ? (
          <label className="rb-portal__switch">
            <span>Customer account</span>
            <select
              value={active?.id ?? ''}
              onChange={(event) => void selectAccount(event.target.value)}
            >
              {accounts.map((account) => (
                <option value={account.id} key={account.id}>
                  {account.organizationName} — {account.customerName}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </section>
      <nav className="rb-portal__nav" aria-label="Customer portal">
        <a href="#documents">
          <FileText aria-hidden="true" /> Documents
        </a>
        <a href="#statement">
          <ReceiptText aria-hidden="true" /> Statement
        </a>
        <a href="#profile">
          <UserRound aria-hidden="true" /> Profile
        </a>
      </nav>
      {error ? (
        <p className="rb-portal__alert" role="alert">
          {error}
        </p>
      ) : null}
      <section id="documents" className="rb-portal__section">
        <div className="rb-portal__section-heading">
          <div>
            <h2>Your documents</h2>
            <p>Only documents shared with this customer account are shown.</p>
          </div>
        </div>
        {documents.length === 0 ? (
          <p className="rb-portal__empty">There are no shared documents yet.</p>
        ) : (
          <div className="rb-portal__table-wrap">
            <table className="rb-portal__table">
              <caption className="rb-visually-hidden">
                Documents shared with this customer account
              </caption>
              <thead>
                <tr>
                  <th scope="col">Document</th>
                  <th scope="col">Status</th>
                  <th scope="col">Date</th>
                  <th scope="col" className="rb-number">
                    Amount
                  </th>
                  <th scope="col">
                    <span className="rb-visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {documents.map((document) => (
                  <tr key={`${document.type}-${document.id}`}>
                    <th scope="row">
                      <button
                        type="button"
                        className="rb-portal__rowlink"
                        aria-expanded={selected?.id === document.id}
                        onClick={() =>
                          setSelected((current) => (current?.id === document.id ? null : document))
                        }
                      >
                        {document.number ?? document.type.replaceAll('_', ' ')}
                      </button>
                      <small>{document.type.replaceAll('_', ' ').toLowerCase()}</small>
                    </th>
                    <td>
                      <span className="rb-portal__status">
                        {document.status.replaceAll('_', ' ')}
                      </span>
                    </td>
                    <td>
                      {document.issueDate ? new Date(document.issueDate).toLocaleDateString() : '—'}
                    </td>
                    <td className="rb-number">
                      {document.currency} {formatMinor(document.totalMinor)}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="rb-portal__ghost"
                        disabled={busy}
                        onClick={() => void download(document)}
                      >
                        <Download aria-hidden="true" /> PDF
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {selected && active ? (
        <PortalDocumentPanel
          key={`${selected.type}-${selected.id}`}
          accountId={active.id}
          document={selected}
          onClose={() => setSelected(null)}
          onDecided={() => {
            setSelected(null);
            void selectAccount(active.id);
          }}
          onFailure={handle}
        />
      ) : null}
      {active ? <PortalStatement accountId={active.id} onFailure={handle} /> : null}
      {active ? <PortalProfileSection accountId={active.id} onFailure={handle} /> : null}
    </main>
  );
}

function PortalDocumentPanel({
  accountId,
  document,
  onClose,
  onDecided,
  onFailure,
}: {
  accountId: string;
  document: PortalDocument;
  onClose: () => void;
  onDecided: () => void;
  onFailure: (caught: unknown) => void;
}) {
  const base = `/portal/accounts/${accountId}/documents/${document.type}/${document.id}`;
  const [detail, setDetail] = useState<PortalDocumentDetail | null>(null);
  const [comments, setComments] = useState<PortalComment[] | null>(null);
  const [files, setFiles] = useState<PortalFile[] | null>(null);
  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState<'accept' | 'decline' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [detailResponse, commentResponse, fileResponse] = await Promise.all([
          apiRequest<{ data: PortalDocumentDetail }>(base),
          apiRequest<{ data: PortalComment[] }>(`${base}/comments`),
          apiRequest<{ data: PortalFile[] }>(`${base}/attachments`),
        ]);
        if (cancelled) return;
        setDetail(detailResponse.data);
        setComments(commentResponse.data);
        setFiles(fileResponse.data);
      } catch (caught) {
        if (!cancelled) onFailure(caught);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base, onFailure]);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  async function decide(decision: 'accept' | 'decline') {
    setBusy(decision);
    setError('');
    try {
      await apiRequest(`/portal/accounts/${accountId}/quotes/${document.id}/${decision}`, {
        method: 'POST',
      });
      onDecided();
    } catch (caught) {
      // A decision that lost a race is the common case here, and it is not a portal failure:
      // the quote simply is not awaiting a response any more.
      setError(
        caught instanceof ApiError && caught.status === 404
          ? 'This quote is no longer awaiting your response. Refresh to see its current status.'
          : 'Your response could not be recorded. Try again.',
      );
      setConfirming(null);
    } finally {
      setBusy(null);
    }
  }

  async function postComment() {
    if (!message.trim()) return;
    setBusy('comment');
    setError('');
    try {
      const result = await apiRequest<{ data: PortalComment }>(`${base}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body: message }),
      });
      setComments((current) => [...(current ?? []), result.data]);
      setMessage('');
      setNotice('Your message was sent.');
    } catch {
      setError('Your message could not be sent. Try again.');
    } finally {
      setBusy(null);
    }
  }

  async function uploadFile(file: File) {
    setBusy('upload');
    setError('');
    try {
      const result = await apiUpload<{ data: PortalFile }>(`${base}/attachments`, file);
      setFiles((current) => [result.data, ...(current ?? [])]);
      setNotice(`${result.data.filename} was shared.`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'That file could not be shared.');
    } finally {
      setBusy(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function openFile(file: PortalFile) {
    setError('');
    try {
      const result = await apiRequest<{ data: { downloadUrl: string } }>(
        `${base}/attachments/${file.id}/download`,
      );
      window.open(result.data.downloadUrl, '_blank', 'noopener,noreferrer');
    } catch {
      setError('That file could not be opened. Try again.');
    }
  }

  const label = document.number ?? document.type.replaceAll('_', ' ');
  return (
    <section className="rb-portal__section rb-portal__detail" aria-label={`Document ${label}`}>
      <div className="rb-portal__section-heading">
        <div>
          <h2 tabIndex={-1} ref={headingRef}>
            {label}
          </h2>
          <p>
            {document.status.replaceAll('_', ' ')} · {document.currency}{' '}
            {formatMinor(document.totalMinor)}
            {document.dueDate ? ` · due ${new Date(document.dueDate).toLocaleDateString()}` : ''}
          </p>
        </div>
        <button type="button" className="rb-portal__ghost" onClick={onClose}>
          Close
        </button>
      </div>
      {error ? (
        <p className="rb-portal__alert" role="alert">
          {error}
        </p>
      ) : null}
      <p className="rb-visually-hidden" role="status">
        {notice}
      </p>

      {detail === null ? (
        <p className="rb-portal__empty">Loading document…</p>
      ) : detail.lines.length === 0 ? (
        <p className="rb-portal__empty">This document has no itemised lines.</p>
      ) : (
        <div className="rb-portal__table-wrap">
          <table className="rb-portal__table">
            <caption className="rb-visually-hidden">Lines on {label}</caption>
            <thead>
              <tr>
                <th scope="col">Description</th>
                <th scope="col" className="rb-number">
                  Qty
                </th>
                <th scope="col" className="rb-number">
                  Unit price
                </th>
                <th scope="col" className="rb-number">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {detail.lines.map((line, index) => (
                <tr key={index}>
                  <th scope="row">{line.description}</th>
                  <td className="rb-number">{line.quantity}</td>
                  <td className="rb-number">{formatMinor(line.unitPriceMinor)}</td>
                  <td className="rb-number">{formatMinor(line.totalMinor)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={3}>
                  Total
                </th>
                <td className="rb-number">
                  {detail.currency} {formatMinor(detail.totalMinor)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {document.type === 'QUOTE' && document.status === 'SENT' ? (
        <div className="rb-portal__decision">
          {confirming === null ? (
            <>
              <button
                type="button"
                className="rb-portal__link"
                onClick={() => setConfirming('accept')}
              >
                Accept quote
              </button>
              <button
                type="button"
                className="rb-portal__ghost"
                onClick={() => setConfirming('decline')}
              >
                Decline quote
              </button>
            </>
          ) : (
            <>
              <p>
                {confirming === 'accept'
                  ? `Accept ${label}? The business is told straight away.`
                  : `Decline ${label}? You can still ask a question below instead.`}
              </p>
              <button
                type="button"
                className="rb-portal__link"
                disabled={busy !== null}
                onClick={() => void decide(confirming)}
              >
                {busy === confirming ? 'Sending…' : `Yes, ${confirming}`}
              </button>
              <button
                type="button"
                className="rb-portal__ghost"
                disabled={busy !== null}
                onClick={() => setConfirming(null)}
              >
                Cancel
              </button>
            </>
          )}
        </div>
      ) : null}

      <div className="rb-portal__thread">
        <h3>
          <MessageSquare aria-hidden="true" /> Messages
        </h3>
        {comments === null ? (
          <p className="rb-portal__muted">Loading messages…</p>
        ) : comments.length === 0 ? (
          <p className="rb-portal__muted">No messages about this document yet.</p>
        ) : (
          <ol className="rb-portal__messages">
            {comments.map((comment) => (
              <li key={comment.id}>
                <strong>{comment.author}</strong>
                <p>{comment.body}</p>
                <time dateTime={comment.createdAt}>
                  {new Date(comment.createdAt).toLocaleString()}
                </time>
              </li>
            ))}
          </ol>
        )}
        <label>
          <span className="rb-visually-hidden">Write a message about {label}</span>
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Ask a question about this document"
            maxLength={4000}
          />
        </label>
        <div className="rb-portal__decision">
          <button
            type="button"
            className="rb-portal__link"
            disabled={!message.trim() || busy === 'comment'}
            onClick={() => void postComment()}
          >
            {busy === 'comment' ? 'Sending…' : 'Send message'}
          </button>
        </div>
      </div>

      <div className="rb-portal__thread">
        <h3>
          <Paperclip aria-hidden="true" /> Files
        </h3>
        {files === null ? (
          <p className="rb-portal__muted">Loading files…</p>
        ) : files.length === 0 ? (
          <p className="rb-portal__muted">No files have been shared about this document.</p>
        ) : (
          <ul className="rb-portal__files">
            {files.map((file) => (
              <li key={file.id}>
                <button type="button" onClick={() => void openFile(file)}>
                  {file.filename}
                </button>
                <span>{Math.max(1, Math.round(file.sizeBytes / 1024))} KB</span>
              </li>
            ))}
          </ul>
        )}
        <div className="rb-portal__decision">
          <input
            ref={fileInputRef}
            type="file"
            className="rb-visually-hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadFile(file);
            }}
          />
          <button
            type="button"
            className="rb-portal__ghost"
            disabled={busy === 'upload'}
            onClick={() => fileInputRef.current?.click()}
          >
            {busy === 'upload' ? 'Uploading…' : 'Share a file'}
          </button>
          <span className="rb-portal__muted">PDF, image, CSV, XLSX, DOCX, or text up to 15MB.</span>
        </div>
      </div>
    </section>
  );
}

function PortalStatement({
  accountId,
  onFailure,
}: {
  accountId: string;
  onFailure: (caught: unknown) => void;
}) {
  const [statement, setStatement] = useState<Statement | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(
    async (range: { from: string; to: string }) => {
      setBusy(true);
      setError('');
      try {
        const query = new URLSearchParams();
        if (range.from) query.set('from', range.from);
        if (range.to) query.set('to', range.to);
        const suffix = query.size > 0 ? `?${query.toString()}` : '';
        const response = await apiRequest<{ data: Statement }>(
          `/portal/accounts/${accountId}/statement${suffix}`,
        );
        setStatement(response.data);
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 400) {
          setError('Enter dates as YYYY-MM-DD.');
        } else {
          onFailure(caught);
        }
      } finally {
        setBusy(false);
      }
    },
    [accountId, onFailure],
  );

  useEffect(() => {
    void load({ from: '', to: '' });
  }, [load]);

  async function exportCsv() {
    setBusy(true);
    setError('');
    try {
      const query = new URLSearchParams();
      if (from) query.set('from', from);
      if (to) query.set('to', to);
      const suffix = query.size > 0 ? `?${query.toString()}` : '';
      const file = await apiDownload(`/portal/accounts/${accountId}/statement/export${suffix}`);
      // The anchor is attached before it is clicked and the object URL is revoked on the next
      // task: revoking it in the same tick cancels the download the click just started.
      const url = URL.createObjectURL(file.blob);
      const link = window.document.createElement('a');
      link.href = url;
      link.download = file.filename;
      link.hidden = true;
      window.document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch {
      setError('The statement could not be exported. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="statement" className="rb-portal__section">
      <div className="rb-portal__section-heading">
        <div>
          <h2>Statement</h2>
          <p>Everything invoiced, paid, and credited on this account.</p>
        </div>
      </div>
      <div className="rb-portal__filters">
        <label>
          From
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
        <button
          type="button"
          className="rb-portal__ghost"
          disabled={busy}
          onClick={() => void load({ from, to })}
        >
          Apply
        </button>
        <button
          type="button"
          className="rb-portal__link"
          disabled={busy || statement === null}
          onClick={() => void exportCsv()}
        >
          <Download aria-hidden="true" /> Export CSV
        </button>
      </div>
      {error ? (
        <p className="rb-portal__alert" role="alert">
          {error}
        </p>
      ) : null}
      {statement === null ? (
        <p className="rb-portal__empty">Loading your statement…</p>
      ) : (
        <>
          <p className="rb-portal__balance" aria-live="polite">
            Closing balance <strong>{formatMinor(statement.summary.closingBalanceMinor)}</strong>{' '}
            (opened at {formatMinor(statement.summary.openingBalanceMinor)})
          </p>
          {statement.transactions.length === 0 ? (
            <p className="rb-portal__empty">Nothing was recorded in this period.</p>
          ) : (
            <div className="rb-portal__table-wrap">
              <table className="rb-portal__table">
                <caption className="rb-visually-hidden">Statement transactions</caption>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Description</th>
                    <th scope="col" className="rb-number">
                      Charges
                    </th>
                    <th scope="col" className="rb-number">
                      Credits
                    </th>
                    <th scope="col" className="rb-number">
                      Balance
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {statement.transactions.map((transaction) => (
                    <tr key={transaction.id}>
                      <td>{transaction.date}</td>
                      <th scope="row">{transaction.description}</th>
                      <td className="rb-number">{formatMinor(transaction.debitMinor)}</td>
                      <td className="rb-number">{formatMinor(transaction.creditMinor)}</td>
                      <td className="rb-number">{formatMinor(transaction.balanceMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function PortalProfileSection({
  accountId,
  onFailure,
}: {
  accountId: string;
  onFailure: (caught: unknown) => void;
}) {
  const [profile, setProfile] = useState<PortalProfile | null>(null);
  const [addresses, setAddresses] = useState<PortalAddress[]>([]);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await apiRequest<{ data: PortalProfile }>(
          `/portal/accounts/${accountId}/profile`,
        );
        if (cancelled) return;
        setProfile(response.data);
        setDisplayName(response.data.displayName);
        setEmail(response.data.email ?? '');
        setPhone(response.data.phone ?? '');
        setAddresses(response.data.addresses);
      } catch (caught) {
        if (!cancelled) onFailure(caught);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, onFailure]);

  function updateAddress(index: number, patch: Partial<PortalAddress>) {
    setAddresses((current) =>
      current.map((address, position) => (position === index ? { ...address, ...patch } : address)),
    );
  }

  async function save() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await apiRequest<{ data: PortalProfile }>(
        `/portal/accounts/${accountId}/profile`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            displayName,
            email: email || undefined,
            phone: phone || undefined,
            addresses: addresses.map((address) => ({
              kind: address.kind,
              line1: address.line1,
              line2: address.line2 || undefined,
              city: address.city || undefined,
              region: address.region || undefined,
              postalCode: address.postalCode || undefined,
              countryCode: address.countryCode,
              isDefault: address.isDefault,
            })),
          }),
        },
      );
      setProfile(response.data);
      setAddresses(response.data.addresses);
      setNotice('Your contact details were updated.');
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Your details could not be saved. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="profile" className="rb-portal__section">
      <div className="rb-portal__section-heading">
        <div>
          <h2>Your contact details</h2>
          <p>
            Keep the customer-facing email, phone, and billing or shipping address current. Your
            sign-in email stays private.
          </p>
        </div>
      </div>
      {profile === null ? (
        <p className="rb-portal__empty">Loading your details…</p>
      ) : (
        <form
          className="rb-portal__form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {error ? (
            <p className="rb-portal__alert" role="alert">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="rb-portal__notice" role="status">
              {notice}
            </p>
          ) : null}
          <div className="rb-portal__fields">
            <label>
              Name
              <input
                value={displayName}
                required
                maxLength={160}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>
            <label>
              Customer email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label>
              Phone
              <input
                value={phone}
                maxLength={40}
                onChange={(event) => setPhone(event.target.value)}
              />
            </label>
          </div>

          <h3>Addresses</h3>
          {addresses.length === 0 ? (
            <p className="rb-portal__muted">No address on file yet.</p>
          ) : null}
          {addresses.map((address, index) => (
            <fieldset key={address.id ?? `new-${index}`} className="rb-portal__address">
              <legend>{address.kind === 'BILLING' ? 'Billing address' : 'Shipping address'}</legend>
              <div className="rb-portal__fields">
                <label>
                  Address line 1
                  <input
                    value={address.line1}
                    required
                    maxLength={200}
                    onChange={(event) => updateAddress(index, { line1: event.target.value })}
                  />
                </label>
                <label>
                  Address line 2
                  <input
                    value={address.line2 ?? ''}
                    maxLength={200}
                    onChange={(event) => updateAddress(index, { line2: event.target.value })}
                  />
                </label>
                <label>
                  City
                  <input
                    value={address.city ?? ''}
                    maxLength={120}
                    onChange={(event) => updateAddress(index, { city: event.target.value })}
                  />
                </label>
                <label>
                  Region
                  <input
                    value={address.region ?? ''}
                    maxLength={120}
                    onChange={(event) => updateAddress(index, { region: event.target.value })}
                  />
                </label>
                <label>
                  Postal code
                  <input
                    value={address.postalCode ?? ''}
                    maxLength={32}
                    onChange={(event) => updateAddress(index, { postalCode: event.target.value })}
                  />
                </label>
                <label>
                  Country code
                  <input
                    value={address.countryCode}
                    required
                    minLength={2}
                    maxLength={2}
                    onChange={(event) =>
                      updateAddress(index, { countryCode: event.target.value.toUpperCase() })
                    }
                  />
                </label>
              </div>
              <div className="rb-portal__decision">
                <label className="rb-portal__toggle">
                  <input
                    type="checkbox"
                    checked={address.isDefault}
                    onChange={(event) => updateAddress(index, { isDefault: event.target.checked })}
                  />
                  Use as default {address.kind.toLowerCase()} address
                </label>
                <button
                  type="button"
                  className="rb-portal__ghost"
                  onClick={() =>
                    setAddresses((current) => current.filter((_, position) => position !== index))
                  }
                >
                  Remove
                </button>
              </div>
            </fieldset>
          ))}
          <div className="rb-portal__decision">
            {(['BILLING', 'SHIPPING'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                className="rb-portal__ghost"
                onClick={() =>
                  setAddresses((current) => [
                    ...current,
                    {
                      kind,
                      line1: '',
                      line2: null,
                      city: null,
                      region: null,
                      postalCode: null,
                      countryCode: '',
                      isDefault: current.every((address) => address.kind !== kind),
                    },
                  ])
                }
              >
                Add {kind.toLowerCase()} address
              </button>
            ))}
            <button type="submit" className="rb-portal__link" disabled={busy}>
              {busy ? 'Saving…' : 'Save details'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

export function PortalState({
  title,
  copy,
  action,
}: {
  title: string;
  copy: string;
  action?: { href: string; label: string };
}) {
  return (
    <main id="main-content" className="rb-portal-state">
      <ReceiptText aria-hidden="true" />
      <h1>{title}</h1>
      <p>{copy}</p>
      {action ? <Link href={action.href}>{action.label}</Link> : null}
    </main>
  );
}

function formatMinor(value: string) {
  return (Number(value) / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
