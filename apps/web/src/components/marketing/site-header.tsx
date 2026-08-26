import Link from 'next/link';
import styles from '@/app/sales.module.css';

export function SiteHeader() {
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
          <a className={styles.navLink} href="#problem">
            The problem
          </a>
          <a className={styles.navLink} href="#result">
            A worked result
          </a>
          <a className={styles.navLink} href="#trust">
            Trust &amp; security
          </a>
          <Link className={styles.navLink} href="/pricing">
            Pricing
          </Link>
        </nav>

        <div className={styles.headerCta}>
          <Link className={`${styles.btn} ${styles.btnGhost}`} href="/registry">
            Rule registry
          </Link>
          <a className={`${styles.btn} ${styles.btnPrimary}`} href="#contact">
            Request a demo
          </a>
        </div>
      </div>
    </header>
  );
}
