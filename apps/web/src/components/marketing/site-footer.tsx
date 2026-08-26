import Link from 'next/link';
import styles from '@/app/sales.module.css';

/**
 * Shared record colophon. Used on every marketing page so the whole site
 * reads as one bound document with a consistent authority statement.
 */
export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.container}>
        <div className={styles.footerGrid}>
          <div className={styles.footerBrand}>
            <span className={styles.brandName}>
              ComplianceOS <span>EDU</span>
            </span>
            <p className={styles.footerBlurb}>
              Compliance assurance for publicly funded education programs. Versioned rule packs,
              cited authorities, and determinations you can defend in a monitoring visit.
            </p>
          </div>
          <div className={styles.footerCol}>
            <h4>Product</h4>
            <ul>
              <li>
                <Link href="/how-it-works">How it works</Link>
              </li>
              <li>
                <Link href="/idea-fiscal">IDEA fiscal rules</Link>
              </li>
              <li>
                <Link href="/registry">Rule registry</Link>
              </li>
              <li>
                <Link href="/pricing">Pricing</Link>
              </li>
            </ul>
          </div>
          <div className={styles.footerCol}>
            <h4>Company</h4>
            <ul>
              <li>
                <Link href="/for-state-agencies">For state agencies</Link>
              </li>
              <li>
                <Link href="/resources">Resources</Link>
              </li>
              <li>
                <Link href="/about">About</Link>
              </li>
              <li>
                <Link href="/trust">Trust &amp; security</Link>
              </li>
            </ul>
          </div>
          <div className={styles.footerCol}>
            <h4>Talk to us</h4>
            <ul>
              <li>
                <a href="mailto:demo@complianceos.edu">Request a demo</a>
              </li>
              <li>
                <a href="mailto:states@complianceos.edu">Talk about your state</a>
              </li>
              <li>
                <Link href="/trust">Accessibility statement</Link>
              </li>
            </ul>
          </div>
        </div>
        <div className={styles.footerBar}>
          <p className={styles.footerStatement}>
            ComplianceOS EDU is an independent software vendor and is not a government agency. Our
            rule packs cite the controlling authority and are reviewed before release; a
            determination is decision-support, not legal advice.
          </p>
          <span>© 2026 ComplianceOS EDU</span>
        </div>
      </div>
    </footer>
  );
}
