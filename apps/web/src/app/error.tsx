'use client';

import { Button, Card } from '@retailbooks/ui';
import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="rb-standalone">
      <Card className="rb-standalone__card">
        <span className="rb-standalone__mark" aria-hidden="true">
          <AlertTriangle />
        </span>
        <h1>Something went wrong</h1>
        <p>An unexpected error interrupted this page. Try again, or go back to the dashboard.</p>
        <div className="rb-standalone__actions">
          <Button type="button" variant="outline" onClick={() => reset()}>
            Try again
          </Button>
          <Button asChild>
            <Link href="/">Back to dashboard</Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}
