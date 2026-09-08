'use client';

import { FileText, LogOut, MessageSquare, ReceiptText, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { ApiError, apiRequest } from '../lib/api';

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

export function PortalWorkbench() {
  const [accounts, setAccounts] = useState<PortalAccount[]>([]);
  const [active, setActive] = useState<PortalAccount | null>(null);
  const [documents, setDocuments] = useState<PortalDocument[]>([]);
  const [profileOpen, setProfileOpen] = useState(false);
  const [statement, setStatement] = useState<string | null>(null);
  const [selected, setSelected] = useState<PortalDocument | null>(null);
  const [detail, setDetail] = useState<{
    lines?: Array<{ description: string; quantity: string; totalMinor: string }>;
  } | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'signed-out'>('loading');

  useEffect(() => {
    void (async () => {
      try {
        const response = await apiRequest<{ data: PortalAccount[] }>('/portal/accounts');
        setAccounts(response.data);
        const first = response.data[0] ?? null;
        setActive(first);
        if (first) {
          const overview = await apiRequest<{ data: { documents: PortalDocument[] } }>(
            `/portal/accounts/${first.id}/overview`,
          );
          setDocuments(overview.data.documents);
        }
        setState('ready');
      } catch (error) {
        setState(error instanceof ApiError && error.status === 401 ? 'signed-out' : 'error');
      }
    })();
  }, []);

  async function selectAccount(id: string) {
    const account = accounts.find((candidate) => candidate.id === id) ?? null;
    setActive(account);
    if (!account) return;
    const overview = await apiRequest<{ data: { documents: PortalDocument[] } }>(
      `/portal/accounts/${account.id}/overview`,
    );
    setDocuments(overview.data.documents);
  }

  async function download(document: PortalDocument) {
    if (!active) return;
    const response = await apiRequest<{ data: { downloadUrl: string } }>(
      `/portal/accounts/${active.id}/documents/${document.type}/${document.id}/download`,
    );
    window.location.assign(response.data.downloadUrl);
  }

  async function openDocument(document: PortalDocument) {
    if (!active) return;
    setSelected(document);
    const response = await apiRequest<{
      data: { lines?: Array<{ description: string; quantity: string; totalMinor: string }> };
    }>(`/portal/accounts/${active.id}/documents/${document.type}/${document.id}`);
    setDetail(response.data);
  }

  async function decideQuote(decision: 'accept' | 'decline') {
    if (!active || !selected || selected.type !== 'QUOTE') return;
    await apiRequest(`/portal/accounts/${active.id}/quotes/${selected.id}/${decision}`, {
      method: 'POST',
    });
    await selectAccount(active.id);
    setSelected(null);
    setDetail(null);
  }

  async function loadStatement() {
    if (!active) return;
    const response = await apiRequest<{ data: { closingBalanceMinor: string } }>(
      `/portal/accounts/${active.id}/statement`,
    );
    setStatement(response.data.closingBalanceMinor);
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
        <a href="#messages">
          <MessageSquare aria-hidden="true" /> Messages
        </a>
        <a href="#profile">
          <UserRound aria-hidden="true" /> Profile
        </a>
        <button type="button" onClick={() => void loadStatement()}>
          Statement
        </button>
      </nav>
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
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Status</th>
                  <th>Date</th>
                  <th className="rb-number">Amount</th>
                  <th>
                    <span className="rb-visually-hidden">Download</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {documents.map((document) => (
                  <tr key={`${document.type}-${document.id}`}>
                    <td>
                      <button
                        type="button"
                        className="rb-portal__download"
                        onClick={() => void openDocument(document)}
                      >
                        <strong>{document.number ?? document.type.replace('_', ' ')}</strong>
                      </button>
                      <small>{document.type.replace('_', ' ')}</small>
                    </td>
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
                        className="rb-portal__download"
                        onClick={() => void download(document)}
                      >
                        Download PDF
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {selected ? (
        <section className="rb-portal__section" aria-live="polite">
          <h2>{selected.number ?? selected.type.replaceAll('_', ' ')}</h2>
          <p>
            {selected.status.replaceAll('_', ' ')} · {selected.currency}{' '}
            {formatMinor(selected.totalMinor)}
          </p>
          {detail?.lines?.map((line, index) => (
            <p key={index}>
              {line.description} × {line.quantity} — {formatMinor(line.totalMinor)}
            </p>
          ))}
          {selected.type === 'QUOTE' && selected.status === 'SENT' ? (
            <div>
              <button
                type="button"
                className="rb-portal__link"
                onClick={() => void decideQuote('accept')}
              >
                Accept quote
              </button>
              <button
                type="button"
                className="rb-portal__download"
                onClick={() => void decideQuote('decline')}
              >
                Decline quote
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
      {statement !== null ? (
        <section className="rb-portal__section" aria-live="polite">
          <h2>Statement balance</h2>
          <p>Your current derived balance is {formatMinor(statement)}.</p>
        </section>
      ) : null}
      <section id="messages" className="rb-portal__section rb-portal__section--split">
        <div>
          <h2>Questions about a document?</h2>
          <p>
            Open a document to view customer-visible messages and files. Your messages are shared
            with the RetailBooks team for this account.
          </p>
        </div>
        <a href="#documents" className="rb-portal__link">
          Choose a document
        </a>
      </section>
      <section id="profile" className="rb-portal__section rb-portal__section--split">
        <div>
          <h2>Your contact details</h2>
          <p>
            Keep the customer-facing email, phone, and billing or shipping address current. Your
            sign-in email stays private.
          </p>
        </div>
        <button type="button" className="rb-portal__link" onClick={() => setProfileOpen(true)}>
          Update details
        </button>
      </section>
      {profileOpen && active ? (
        <PortalProfile accountId={active.id} onClose={() => setProfileOpen(false)} />
      ) : null}
    </main>
  );
}

function PortalProfile({ accountId, onClose }: { accountId: string; onClose: () => void }) {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notice, setNotice] = useState('');
  async function save() {
    await apiRequest(`/portal/accounts/${accountId}/profile`, {
      method: 'PATCH',
      body: JSON.stringify({
        ...(displayName ? { displayName } : {}),
        ...(email ? { email } : {}),
        ...(phone ? { phone } : {}),
      }),
    });
    setNotice('Your customer contact details were updated.');
  }
  return (
    <section className="rb-portal__profile" aria-label="Update contact details">
      <h2>Update contact details</h2>
      {notice ? <p role="status">{notice}</p> : null}
      <label>
        Name
        <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
      </label>
      <label>
        Customer email
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      <label>
        Phone
        <input value={phone} onChange={(event) => setPhone(event.target.value)} />
      </label>
      <div>
        <button type="button" className="rb-portal__link" onClick={() => void save()}>
          Save details
        </button>
        <button type="button" className="rb-portal__download" onClick={onClose}>
          Close
        </button>
      </div>
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
