import Link from 'next/link';
import styles from '@/app/sales.module.css';

export function SiteHeader() {
  return (
    <header className={styles.header}>
      <div className={`${styles.container} ${styles.headerInner}`}>
        <Link href="/" className={styles.brand}>
          <span className={styles.mark} aria-hidden>
            C
          </span>
          ComplianceOS <span style={{ color: 'var(--muted)', fontWeight: 500 }}>EDU</span>
        </Link>

        <nav className={styles.nav} aria-label="Primary">
          <a className={styles.navLink} href="#how">
            How it works
          </a>
          <a className={styles.navLink} href="#security">
            Security
          </a>
          <a className={styles.navLink} href="#coverage">
            Coverage
          </a>
          <a className={styles.navLink} href="#pricing">
            Pricing
          </a>
        </nav>

        <div className={styles.headerCta}>
          <Link className={`${styles.btn} ${styles.btnGhost}`} href="/registry">
            Live registry
          </Link>
          <a className={`${styles.btn} ${styles.btnPrimary}`} href="#contact">
            Request a demo
          </a>
        </div>
      </div>
    </header>
  );
}
