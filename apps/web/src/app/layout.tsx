import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Public_Sans } from 'next/font/google';
import './globals.css';

const publicSans = Public_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

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
  themeColor: '#123a6b',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={publicSans.variable}>
      <body>{children}</body>
    </html>
  );
}
