'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Only surfaces that exist.
 *
 * CLAUDE.md forbids a menu item that leads nowhere, so the navigation is short by design. The
 * portfolio dashboard section 24 describes needs many districts and a database to hold them;
 * until those exist, an "Overview" entry over one synthetic district would be furniture.
 */
const LINKS = [
  { href: '/', label: 'Assessment' },
  { href: '/rules', label: 'Rule library' },
] as const;

export function SiteNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary" className="site-nav">
      <ul>
        {LINKS.map((link) => {
          // A finding lives under the assessment it belongs to, so the assessment entry stays
          // marked while a reader is reading one.
          const current =
            link.href === '/'
              ? pathname === '/' || pathname.startsWith('/finding')
              : pathname.startsWith(link.href);
          return (
            <li key={link.href}>
              <Link href={link.href} aria-current={current ? 'page' : undefined}>
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
