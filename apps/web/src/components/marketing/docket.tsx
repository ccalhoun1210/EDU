import type { ReactNode } from 'react';
import styles from '@/app/sales.module.css';

/**
 * A single leaf of the bound record. Every mid-page section is a
 * LedgerSection: a mono section number (§ NN) and label hang in the left
 * margin against a continuous vertical rule — the binding spine — with the
 * heading, lede, and content in the column to its right. Shared by the home
 * and pricing pages so both read as one regulatory record, not a card stack.
 */
export function LedgerSection({
  id,
  no,
  tag,
  title,
  lede,
  first,
  children,
}: {
  id?: string;
  no: string;
  tag: string;
  title: string;
  lede?: ReactNode;
  /** Opens the record with a heavier top rule (use on the first section). */
  first?: boolean;
  children?: ReactNode;
}) {
  return (
    <section id={id} className={`${styles.section} ${first ? styles.sectionRule : ''}`}>
      <div className={styles.container}>
        <div className={styles.sectionGrid}>
          <div className={styles.gutter}>
            <span className={styles.gutterNo}>{no}</span>
            <span className={styles.gutterTag}>{tag}</span>
          </div>
          <div className={styles.sectionMain}>
            <h2 className={styles.sectionTitle}>{title}</h2>
            {lede ? <p className={styles.sectionLede}>{lede}</p> : null}
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}
