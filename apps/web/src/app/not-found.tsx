import { Button, Card } from '@retailbooks/ui';
import { BookOpenText } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Page not found | RetailBooks' };

export default function NotFound() {
  return (
    <div className="rb-standalone">
      <Card className="rb-standalone__card">
        <span className="rb-standalone__mark" aria-hidden="true">
          <BookOpenText />
        </span>
        <h1>Page not found</h1>
        <p>The page you&rsquo;re looking for doesn&rsquo;t exist or may have moved.</p>
        <div className="rb-standalone__actions">
          <Button asChild>
            <Link href="/">Back to dashboard</Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}
