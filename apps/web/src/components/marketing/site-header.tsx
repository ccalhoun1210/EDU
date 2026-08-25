import Link from 'next/link';
import styles from '@/app/sales.module.css';
import { BrandSeal } from './icons';

export function SiteHeader() {
  return (
    <header className={styles.header}>
      <div className={`${styles.container} ${styles.headerInner}`}>
        <Link href="/" className={styles.brand} aria-label="ComplianceOS EDU home">
          <BrandSeal size={42} />
          <span className={styles.brandText}>
            <span className={styles.brandName}>
              ComplianceOS <span>EDU</span>
            </span>
            <span className={styles.brandSub}>State &amp; Federal Education Compliance</span>
          </span>
        </Link>

        <nav className={styles.nav} aria-label="Primary">
          <a className={styles.navLink} href="#mandate">
            Mandate
          </a>
          <a className={styles.navLink} href="#safeguards">
            Safeguards
          </a>
          <a className={styles.navLink} href="#coverage">
            Coverage
          </a>
          <a className={styles.navLink} href="#deployment">
            Deployment
          </a>
        </nav>

        <div className={styles.headerCta}>
          <Link className={`${styles.btn} ${styles.btnGhost}`} href="/registry">
            Rule registry
          </Link>
          <a className={`${styles.btn} ${styles.btnPrimary}`} href="#contact">
            Request access
          </a>
        </div>
      </div>
    </header>
  );
}
