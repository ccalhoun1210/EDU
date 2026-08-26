import type { ReactNode } from 'react';
import { SiteNav } from '@/components/site-nav';

/**
 * The application's chrome.
 *
 * A route group rather than a path segment, so the marketing site keeps `/` and the two
 * surfaces stop competing for one layout. Everything here is wrapped in `.app-main` because
 * the application's stylesheet is scoped under that class: bare element rules would otherwise
 * reach the marketing pages, which use a plain `<main>` with their own full-bleed containers.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="app-main">
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
    </div>
  );
}
