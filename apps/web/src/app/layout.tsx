import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from '../lib/providers';
import { ThemeProvider, NO_FLASH_SCRIPT } from '../lib/theme';

export const metadata = {
  title: 'Link Checker',
  description: 'Find and analyze backlinks across donor pages',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
      </head>
      <body>
        <ThemeProvider>
          <Providers>{children}</Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}
