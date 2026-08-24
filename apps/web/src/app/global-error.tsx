'use client';

import '@retailbooks/ui/tokens.css';
import '@retailbooks/ui/styles.css';
import './styles.css';

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <div className="rb-standalone">
          <div className="rb-standalone__card rb-card">
            <h1>RetailBooks hit an unexpected error</h1>
            <p>Reload the page, or try again.</p>
            <div className="rb-standalone__actions">
              <button
                type="button"
                className="rb-button rb-button--outline rb-button--md"
                onClick={() => reset()}
              >
                Try again
              </button>
              <a className="rb-button rb-button--primary rb-button--md" href="/">
                Back to dashboard
              </a>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
