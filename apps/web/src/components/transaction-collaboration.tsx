'use client';

import { Activity, FileUp, MessageSquare } from 'lucide-react';
import { useEffect, useState } from 'react';

import { apiRequest } from '../lib/api';

/**
 * Reusable detail-surface collaboration unit. Parent pages supply the target they already
 * authorize; this component never substitutes collaboration privileges for parent access.
 */
export function TransactionCollaboration({
  organizationId,
  targetType,
  targetId,
}: {
  organizationId: string;
  targetType: string;
  targetId: string;
}) {
  const base = `/organizations/${organizationId}/collaboration/${targetType}/${targetId}`;
  const [tab, setTab] = useState<'comments' | 'files' | 'activity'>('comments');
  const [comments, setComments] = useState<
    Array<{ id: string; body: string; author: string; createdAt: string }>
  >([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    void apiRequest<{ data: typeof comments }>(`${base}/comments`)
      .then((result) => setComments(result.data))
      .catch(() => setError('Comments could not be loaded.'));
  }, [base]);
  async function postComment() {
    if (!message.trim()) return;
    try {
      const result = await apiRequest<{ data: (typeof comments)[number] }>(`${base}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body: message }),
      });
      setComments((current) => [...current, result.data]);
      setMessage('');
    } catch {
      setError('Your comment could not be saved. Try again.');
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
            aria-selected={tab === key}
            onClick={() => setTab(key)}
          >
            <Icon aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {tab === 'comments' ? (
        <div className="rb-collaboration__comments">
          {comments.length === 0 ? (
            <p>No comments yet.</p>
          ) : (
            comments.map((comment) => (
              <article key={comment.id}>
                <strong>{comment.author}</strong>
                <p>{comment.body}</p>
                <time>{new Date(comment.createdAt).toLocaleString()}</time>
              </article>
            ))
          )}
          <label>
            <span className="rb-visually-hidden">Add a comment</span>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Add an internal comment"
              maxLength={4000}
            />
          </label>
          <button type="button" onClick={() => void postComment()} disabled={!message.trim()}>
            Post comment
          </button>
        </div>
      ) : (
        <p>
          {tab === 'files'
            ? 'Files are available from the transaction attachment controls.'
            : 'Activity appears here as changes are recorded.'}
        </p>
      )}
    </section>
  );
}
