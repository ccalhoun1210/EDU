import Link from 'next/link';
import styles from '@/app/sales.module.css';

const NAV = [
  { href: '/how-it-works', label: 'How it works' },
  { href: '/idea-fiscal', label: 'IDEA fiscal' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/trust', label: 'Trust' },
  { href: '/resources', label: 'Resources' },
] as const;

export function SiteHeader({ active }: { active?: string }) {
  return (
    <header className={styles.header}>
      <a href="#main" className={styles.skipLink}>
        Skip to main content
      </a>
      <div className={`${styles.container} ${styles.headerInner}`}>
        <Link href="/" className={styles.brand} aria-label="ComplianceOS EDU, home">
          <span className={styles.brandMark} aria-hidden>
            CO
          </span>
          <span className={styles.brandText}>
            <span className={styles.brandName}>
              ComplianceOS <span>EDU</span>
            </span>
            <span className={styles.brandSub}>IDEA Part B fiscal compliance</span>
          </span>
        </Link>

        <nav className={styles.nav} aria-label="Primary">
          {NAV.map((item) => (
            <Link
              key={item.href}
              className={styles.navLink}
              href={item.href}
              aria-current={active === item.href ? 'page' : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className={styles.headerCta}>
          <Link className={`${styles.btn} ${styles.btnGhost}`} href="/registry">
            Rule registry
          </Link>
          <a
            className={`${styles.btn} ${styles.btnPrimary}`}
            href="mailto:demo@complianceos.edu?subject=ComplianceOS%20EDU%20demo"
          >
            Request a demo
          </a>
        </div>
      </div>
    </header>
  );
}
