import './globals.css';
import Link from 'next/link';
import type { ReactNode } from 'react';

export const metadata = { title: 'holo' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100">
        <header
          style={{
            borderBottom: '1px solid var(--border)',
            padding: '12px 24px',
          }}
        >
          <nav style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
            <Link
              href="/"
              style={{
                fontSize: '14px',
                fontWeight: 600,
                color: 'var(--text)',
                textDecoration: 'none',
              }}
            >
              holo
            </Link>
            <Link
              href="/marketplace"
              style={{
                fontSize: '14px',
                color: 'var(--text-muted)',
                textDecoration: 'none',
              }}
            >
              Marketplace
            </Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
