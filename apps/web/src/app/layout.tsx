import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import '@retailbooks/ui/tokens.css';
import '@retailbooks/ui/styles.css';
import './styles.css';

export const metadata: Metadata = {
  title: 'RetailBooks',
  description: 'AI invoicing and accounting that keeps small businesses clear, organized, and ready for what is next.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a className="rb-skip-link" href="#main-content">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
