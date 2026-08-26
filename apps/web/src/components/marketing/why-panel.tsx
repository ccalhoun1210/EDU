import styles from '@/app/sales.module.css';
import { RiskGlyph } from '@/components/marketing/icons';

type Row = { k: string; v: string };

/**
 * The "Why panel" from the content brief — a rendered determination showing
 * status, authority, rule pack, snapshot, reasoning, inputs, and source rows.
 * Reuses the exhibit ledger language so it reads as real machine output.
 */
export function WhyPanel() {
  const idRows: Row[] = [
    { k: 'Requirement', v: 'IDEA Part B — LEA Maintenance of Effort' },
    { k: 'Authority', v: '34 CFR § 300.203' },
    { k: 'Rule pack', v: 'US-FED-IDEA-B-2028.2' },
    { k: 'Snapshot', v: 'DS-01JXYZ4K7Q8M' },
  ];

  return (
    <div className={styles.whyPanel}>
      <div className={styles.exhibitHead}>
        <b>Determination</b>
        <span>DET-2028-0417</span>
      </div>

      <div className={styles.exhibitStamp}>
        <span className={`${styles.statusBadge} ${styles.stRisk}`} style={{ fontSize: '0.9rem' }}>
          <RiskGlyph size={16} />
          AT RISK
        </span>
        <span className={styles.exhibitStampCaption}>
          <b>Below the required level under this method</b>
          Two of four methods currently pass.
        </span>
      </div>

      <div className={styles.exLedger}>
        {idRows.map((r) => (
          <div className={styles.exRow} key={r.k}>
            <span className={styles.exKey}>{r.k}</span>
            <span className={styles.exVal}>{r.v}</span>
          </div>
        ))}
        <div className={styles.exRow}>
          <span className={styles.exKey}>Why</span>
          <span className={styles.exVal}>
            Current projected state + local expenditure is $21,640 below the required comparison
            level under this method.
          </span>
        </div>
      </div>

      <div className={styles.exArith}>
        Current projection&nbsp;&nbsp;&nbsp;&nbsp;$4,823,114
        <br />
        Required level&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;$4,844,754
        <br />
        Difference&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
        <span className={styles.neg}>-$21,640</span>
      </div>

      <div className={styles.exLedger}>
        <div className={styles.exRow}>
          <span className={styles.exKey}>Source</span>
          <span className={styles.exVal}>FY2028 Budget Export.xlsx — rows 412–587, fund codes 27xx</span>
        </div>
        <div className={styles.exRow}>
          <span className={styles.exKey}>Next step</span>
          <span className={styles.exVal}>
            Review qualifying methods and documented exceptions before fiscal close.
          </span>
        </div>
      </div>
    </div>
  );
}
