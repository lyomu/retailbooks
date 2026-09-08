'use client';

import type { CollaborationTargetType } from '@retailbooks/contracts';
import { Activity, FileUp, Loader2, MessageSquare } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError, apiRequest, apiUpload } from '../lib/api';

type Comment = {
  id: string;
  body: string;
  visibility: 'INTERNAL' | 'CUSTOMER';
  author: string;
  createdAt: string;
};
type Attachment = {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
};
type ActivityEntry = {
  id: string;
  kind: string;
  eventKey: string;
  visibility: 'INTERNAL' | 'CUSTOMER';
  occurredAt: string;
};

type Tab = 'comments' | 'files' | 'activity';

/**
 * Reusable detail-surface collaboration unit. Parent pages supply the target they already
 * authorize; this component never substitutes collaboration privileges for parent access.
 *
 * `customerEligible` reflects whether the *document type* can ever be shown to a customer, and
 * `canShareWithCustomer` whether this member may do so. Both must hold before the visibility
 * control appears — the server enforces the same pair, so hiding it is presentation, not policy.
 */
export function TransactionCollaboration({
  organizationId,
  targetType,
  targetId,
  canComment = true,
  canUpload = true,
  canShareWithCustomer = false,
  customerEligible = false,
}: {
  organizationId: string;
  targetType: CollaborationTargetType;
  targetId: string;
  canComment?: boolean;
  canUpload?: boolean;
  canShareWithCustomer?: boolean;
  customerEligible?: boolean;
}) {
  const base = `/organizations/${organizationId}/collaboration/${targetType}/${targetId}`;
  const [tab, setTab] = useState<Tab>('comments');
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [attachments, setAttachments] = useState<Attachment[] | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[] | null>(null);
  const [activityCursor, setActivityCursor] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [shareWithCustomer, setShareWithCustomer] = useState(false);
  const [busy, setBusy] = useState<'comment' | 'upload' | 'activity' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const shareable = customerEligible && canShareWithCustomer;

  useEffect(() => {
    let cancelled = false;
    setComments(null);
    setAttachments(null);
    setActivity(null);
    setActivityCursor(null);
    void apiRequest<{ data: Comment[] }>(`${base}/comments`)
      .then((result) => {
        if (!cancelled) setComments(result.data);
      })
      .catch(() => {
        if (!cancelled) setError('Comments could not be loaded.');
      });
    return () => {
      cancelled = true;
    };
  }, [base]);

  const loadFiles = useCallback(async () => {
    try {
      const result = await apiRequest<{ data: Attachment[] }>(`${base}/attachments`);
      setAttachments(result.data);
    } catch {
      setError('Files could not be loaded.');
    }
  }, [base]);

  const loadActivity = useCallback(
    async (cursor?: string) => {
      setBusy('activity');
      try {
        const result = await apiRequest<{ data: ActivityEntry[]; nextCursor: string | null }>(
          `${base}/activity${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
        );
        setActivity((current) => (cursor && current ? [...current, ...result.data] : result.data));
        setActivityCursor(result.nextCursor);
      } catch {
        setError('Activity could not be loaded.');
      } finally {
        setBusy(null);
      }
    },
    [base],
  );

  function selectTab(next: Tab) {
    setTab(next);
    setError('');
    if (next === 'files' && attachments === null) void loadFiles();
    if (next === 'activity' && activity === null) void loadActivity();
  }

  async function postComment() {
    if (!message.trim()) return;
    setBusy('comment');
    setError('');
    try {
      const result = await apiRequest<{ data: Comment }>(`${base}/comments`, {
        method: 'POST',
        body: JSON.stringify({
          body: message,
          visibility: shareable && shareWithCustomer ? 'CUSTOMER' : 'INTERNAL',
        }),
      });
      setComments((current) => [...(current ?? []), result.data]);
      setMessage('');
      setNotice(
        result.data.visibility === 'CUSTOMER'
          ? 'Comment posted and shared with the customer.'
          : 'Internal comment posted.',
      );
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Your comment could not be saved. Try again.',
      );
    } finally {
      setBusy(null);
    }
  }

  async function uploadFile(file: File) {
    setBusy('upload');
    setError('');
    try {
      const result = await apiUpload<{ data: Attachment }>(`${base}/attachments`, file);
      setAttachments((current) => [result.data, ...(current ?? [])]);
      setNotice(`${result.data.filename} uploaded.`);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'The file could not be uploaded. Try again.',
      );
    } finally {
      setBusy(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function downloadFile(attachment: Attachment) {
    setError('');
    try {
      // Listing never carries a URL: the download is re-authorized here and the link is short-lived.
      const result = await apiRequest<{ data: { downloadUrl: string } }>(
        `${base}/attachments/${attachment.id}/download`,
      );
      window.open(result.data.downloadUrl, '_blank', 'noopener,noreferrer');
    } catch {
      setError('That file could not be opened. Try again.');
    }
  }

  return (
    <section className="rb-collaboration" aria-label="Collaboration">
      <div className="rb-collaboration__tabs" role="tablist" aria-label="Collaboration sections">
        {(
          [
            ['comments', MessageSquare, 'Comments'],
            ['files', FileUp, 'Files'],
            ['activity', Activity, 'Activity'],
          ] as const
        ).map(([key, Icon, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`rb-collaboration-tab-${key}`}
            aria-selected={tab === key}
            aria-controls={`rb-collaboration-panel-${key}`}
            onClick={() => selectTab(key)}
          >
            <Icon aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
      {error ? (
        <p className="rb-collaboration__alert" role="alert">
          {error}
        </p>
      ) : null}
      <p className="rb-visually-hidden" role="status">
        {notice}
      </p>

      {tab === 'comments' ? (
        <div
          className="rb-collaboration__comments"
          role="tabpanel"
          id="rb-collaboration-panel-comments"
          aria-labelledby="rb-collaboration-tab-comments"
        >
          {comments === null ? (
            <p className="rb-collaboration__muted">Loading comments…</p>
          ) : comments.length === 0 ? (
            <p className="rb-collaboration__muted">No comments yet.</p>
          ) : (
            comments.map((comment) => (
              <article key={comment.id}>
                <strong>{comment.author}</strong>
                {comment.visibility === 'CUSTOMER' ? (
                  <span className="rb-collaboration__badge">Shared with customer</span>
                ) : null}
                <p>{comment.body}</p>
                <time dateTime={comment.createdAt}>
                  {new Date(comment.createdAt).toLocaleString()}
                </time>
              </article>
            ))
          )}
          {canComment ? (
            <>
              <label>
                <span className="rb-visually-hidden">Add a comment</span>
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder={
                    shareable && shareWithCustomer
                      ? 'This comment will be visible to the customer'
                      : 'Add an internal comment'
                  }
                  maxLength={4000}
                />
              </label>
              <div className="rb-collaboration__actions">
                {shareable ? (
                  <label className="rb-collaboration__toggle">
                    <input
                      type="checkbox"
                      checked={shareWithCustomer}
                      onChange={(event) => setShareWithCustomer(event.target.checked)}
                    />
                    Share with customer
                  </label>
                ) : null}
                <button
                  type="button"
                  onClick={() => void postComment()}
                  disabled={!message.trim() || busy === 'comment'}
                >
                  {busy === 'comment' ? <Loader2 aria-hidden="true" /> : null}
                  Post comment
                </button>
              </div>
            </>
          ) : (
            <p className="rb-collaboration__muted">
              Your role can read this discussion but not add to it.
            </p>
          )}
        </div>
      ) : null}

      {tab === 'files' ? (
        <div
          className="rb-collaboration__panel"
          role="tabpanel"
          id="rb-collaboration-panel-files"
          aria-labelledby="rb-collaboration-tab-files"
        >
          {attachments === null ? (
            <p className="rb-collaboration__muted">Loading files…</p>
          ) : attachments.length === 0 ? (
            <p className="rb-collaboration__muted">No files attached yet.</p>
          ) : (
            <ul className="rb-collaboration__files">
              {attachments.map((attachment) => (
                <li key={attachment.id}>
                  <button type="button" onClick={() => void downloadFile(attachment)}>
                    {attachment.filename}
                  </button>
                  <span>{Math.max(1, Math.round(attachment.sizeBytes / 1024))} KB</span>
                </li>
              ))}
            </ul>
          )}
          {canUpload ? (
            <div className="rb-collaboration__actions">
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
                onClick={() => fileInputRef.current?.click()}
                disabled={busy === 'upload'}
              >
                {busy === 'upload' ? <Loader2 aria-hidden="true" /> : null}
                Upload file
              </button>
              <span className="rb-collaboration__muted">
                PDF, image, CSV, XLSX, DOCX, or text up to 15MB.
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === 'activity' ? (
        <div
          className="rb-collaboration__panel"
          role="tabpanel"
          id="rb-collaboration-panel-activity"
          aria-labelledby="rb-collaboration-tab-activity"
        >
          {activity === null ? (
            <p className="rb-collaboration__muted">Loading activity…</p>
          ) : activity.length === 0 ? (
            <p className="rb-collaboration__muted">
              Activity appears here as changes are recorded.
            </p>
          ) : (
            <ol className="rb-collaboration__activity">
              {activity.map((entry) => (
                <li key={entry.id}>
                  <span>{describeActivity(entry.eventKey)}</span>
                  <time dateTime={entry.occurredAt}>
                    {new Date(entry.occurredAt).toLocaleString()}
                  </time>
                </li>
              ))}
            </ol>
          )}
          {activityCursor ? (
            <button
              type="button"
              onClick={() => void loadActivity(activityCursor)}
              disabled={busy === 'activity'}
            >
              Load older activity
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** Turns a dot-namespaced event key into a sentence without needing a per-event lookup table. */
function describeActivity(eventKey: string): string {
  const readable = eventKey.replaceAll('.', ' ').replaceAll('_', ' ');
  return readable.charAt(0).toUpperCase() + readable.slice(1);
}
