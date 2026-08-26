import type { ReactNode } from 'react';
import styles from '@/app/sales.module.css';

/**
 * Numbered docket header used to open every marketing section — a
 * statute-style rail (§ NN / LABEL) beside the heading, under a strong
 * top rule. Shared by the home and pricing pages so both read as one
 * regulatory record rather than a generic card stack.
 */
export function Docket({
  no,
  tag,
  title,
  lede,
}: {
  no: string;
  tag: string;
  title: string;
  lede: ReactNode;
}) {
  return (
    <div className={styles.docket}>
      <p className={styles.docketTag}>
        {no}
        <span>{tag}</span>
      </p>
      <div className={styles.docketBody}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        <p className={styles.sectionLede}>{lede}</p>
      </div>
    </div>
  );
}
