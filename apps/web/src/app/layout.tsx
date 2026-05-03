import './globals.css';
import type { ReactNode } from 'react';
import { Toaster } from 'sonner';
import { ThemeScript } from '@/components/theme-script';

export const metadata = {
  title: 'holo — context layer for AI agents',
  description:
    'Open-source, self-hostable MCP context layer. Serious infrastructure for serious AI work.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
        <link rel="preconnect" href="https://api.fontshare.com" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f[]=general-sans@400,500,600,700&display=swap"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
        />
      </head>
      <body className="min-h-screen bg-bg text-text antialiased">
        {children}
        <Toaster position="bottom-right" theme="system" closeButton richColors />
      </body>
    </html>
  );
}
