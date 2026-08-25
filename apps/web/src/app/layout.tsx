import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'ComplianceOS EDU — Compliance assurance for publicly funded education',
  description:
    'Turn the regulations governing special education and other funded programs into versioned, citable rule packs. Prove compliance instead of guessing at it.',
  openGraph: {
    title: 'ComplianceOS EDU',
    description:
      'Compliance assurance for publicly funded education programs — versioned, citable rule packs with honest determinations.',
    type: 'website',
  },
};

export const viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0f1115' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
