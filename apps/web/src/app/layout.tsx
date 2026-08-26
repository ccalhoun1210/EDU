import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SiteNav } from '../components/site-nav.js';
import './globals.css';

export const metadata: Metadata = {
  title: 'ComplianceOS EDU',
  description: 'Compliance assurance for publicly funded education programs.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* Section 26.7 targets WCAG 2.2 AA; a keyboard user should not tab the masthead
            on every page to reach the content. */}
        <a className="skip-link" href="#main">
          Skip to content
        </a>

        <header className="masthead">
          <div className="masthead-inner">
            <span className="wordmark">ComplianceOS EDU</span>
            <span className="masthead-note">IDEA Part B fiscal assurance</span>
            <SiteNav />
          </div>
        </header>

        <main id="main">{children}</main>
      </body>
    </html>
  );
}
