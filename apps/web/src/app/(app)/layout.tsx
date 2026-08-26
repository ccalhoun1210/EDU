import type { ReactNode } from 'react';
import Link from 'next/link';
import { SiteNav } from '@/components/site-nav';
import { currentSession } from '@/lib/session';

/**
 * The application's chrome.
 *
 * A route group rather than a path segment, so the marketing site keeps `/` and the two
 * surfaces stop competing for one layout. Everything here is wrapped in `.app-main` because
 * the application's stylesheet is scoped under that class: bare element rules would otherwise
 * reach the marketing pages, which use a plain `<main>` with their own full-bleed containers.
 *
 * The layout reads the session because it is the one component every application route has
 * in common, and because who you are signed in as belongs in the masthead rather than being
 * something each page discovers for itself. Reading it here makes every route in this group
 * dynamic, which they already were: each one is `force-dynamic` so that a deployment missing
 * its regulatory content fails visibly on a request rather than serving a value baked in at
 * build time.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await currentSession();

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

          {session.signedIn ? (
            <form action="/api/auth/sign-out" method="post" className="masthead-identity">
              {/* The tenant is not named here. A district officer knows which district they
                  work for; what they need to see is which account is acting, because that
                  is what decides what the pages below will and will not show them. */}
              <span className="masthead-who" title={session.principal.email}>
                {session.principal.displayName}
              </span>
              <button type="submit" className="link-button">
                Sign out
              </button>
            </form>
          ) : (
            <span className="masthead-identity">
              {/* Offered even on a deployment with nothing to sign in to: the page says so
                  plainly, which is better than a control that silently is not there. */}
              <Link href="/sign-in">Sign in</Link>
            </span>
          )}
        </div>
      </header>

      <main id="main">{children}</main>
    </div>
  );
}
