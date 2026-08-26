import type { Metadata } from 'next';
import { SiteHeader } from '@/components/marketing/site-header';
import { SiteFooter } from '@/components/marketing/site-footer';
import { LedgerSection } from '@/components/marketing/docket';
import {
  ArrowRightIcon,
  LockIcon,
  NoWriteIcon,
  ShieldIcon,
  FileCheckIcon,
} from '@/components/marketing/icons';
import styles from '@/app/sales.module.css';

export const metadata: Metadata = {
  title: 'Trust & security — ComplianceOS EDU',
  description:
    'The page procurement reads first: read-only integrations, FERPA-aligned data handling, accessibility conformance, data residency, and subprocessors — each stated at its true status.',
};

const POSTURE = [
  {
    Icon: NoWriteIcon,
    title: 'Read-only, always',
    desc: 'Every integration reads a copy of your data. We cannot write to your SIS, IEP platform, or ERP. Nothing we do can alter or corrupt a system of record.',
    status: 'Enforced',
  },
  {
    Icon: LockIcon,
    title: 'Encryption in transit and at rest',
    desc: 'TLS 1.2+ for all connections; student-level data encrypted at rest with managed keys.',
    status: 'In place',
  },
  {
    Icon: ShieldIcon,
    title: 'Least-privilege access',
    desc: 'Access to district data is role-scoped and logged. Every query that touches student data is attributable to a person.',
    status: 'In place',
  },
  {
    Icon: FileCheckIcon,
    title: 'Immutable, reproducible runs',
    desc: 'A finalized assessment is never rewritten. New data produces a new run against a new snapshot, so any past conclusion can be reproduced exactly.',
    status: 'Enforced',
  },
];

const DOCUMENTS = [
  {
    name: 'Data Privacy Agreement (DPA)',
    cite: 'FERPA-aligned',
    body: 'A FERPA-aligned DPA is executed before any student-level data is processed. We act as a school official with a legitimate educational interest under your direct control, and use student data only to provide the service.',
  },
  {
    name: 'Accessibility Conformance Report (ACR)',
    cite: 'WCAG 2.1 AA / § 508',
    body: 'A VPAT-format conformance report targeting WCAG 2.1 AA and Section 508 is provided for procurement review. It gates purchase for most public agencies, so we treat it as a deliverable, not marketing.',
  },
  {
    name: 'Data residency',
    cite: 'US-based',
    body: 'District data is stored and processed in United States regions. We disclose the specific region and provider in the DPA and do not move student data outside the US.',
  },
  {
    name: 'Subprocessors',
    cite: 'Disclosed',
    body: 'The list of subprocessors that may process district data — infrastructure, storage, and support — is disclosed in the DPA and kept current. Material changes are communicated before they take effect.',
  },
];

const STANDARDS = [
  { term: 'SOC 2 Type II', status: 'In progress', note: 'Controls implemented; formal audit scheduled. We will publish the report when it exists — not a badge before it does.' },
  { term: 'Penetration testing', status: 'Planned', note: 'Independent third-party test planned ahead of first production district.' },
  { term: 'Incident response', status: 'In place', note: 'Documented breach-notification process aligned to state and FERPA timelines.' },
  { term: 'Data retention & deletion', status: 'In place', note: 'District data returned or destroyed on contract termination, per the DPA.' },
];

export default function TrustPage() {
  return (
    <div className={styles.page}>
      <a className={styles.skipLink} href="#main">
        Skip to content
      </a>
      <SiteHeader active="/trust" />

      <main id="main">
        <section className={styles.pageHero}>
          <div className={styles.container}>
            <p className={styles.pageKicker}>Trust &amp; security</p>
            <h1 className={styles.pageTitle}>Everything here is stated at its true status.</h1>
            <p className={styles.pageIntro}>
              We would rather show an honest “in progress” than an unbacked badge — the same
              standard we hold your determinations to. This is the page your procurement office
              reads first, so it answers procurement’s questions, not marketing’s.
            </p>
          </div>
        </section>

        {/* Security posture */}
        <LedgerSection
          first
          id="posture"
          no="§ 01"
          tag="Security posture"
          title="The guarantees that hold whatever else changes."
        >
          <div className={styles.trustList}>
            {POSTURE.map(({ Icon, title, desc, status }) => (
              <div className={styles.trustRow} key={title}>
                <span className={styles.trustIcon}>
                  <Icon size={20} />
                </span>
                <p className={styles.trustTitle}>{title}</p>
                <p className={styles.trustDesc}>{desc}</p>
                <span className={styles.trustStatus}>{status}</span>
              </div>
            ))}
          </div>
        </LedgerSection>

        {/* Procurement documents */}
        <LedgerSection
          id="documents"
          no="§ 02"
          tag="Procurement documents"
          title="The paperwork your district needs, and what it says."
          lede="Each of these is available for review during procurement. Ask and we send the current version."
        >
          <div className={styles.defList}>
            {DOCUMENTS.map((d) => (
              <div className={styles.defRow} key={d.name}>
                <div className={styles.defHead}>
                  <h3 className={styles.defName}>{d.name}</h3>
                  <span className={styles.defCite}>{d.cite}</span>
                </div>
                <p>{d.body}</p>
              </div>
            ))}
          </div>
        </LedgerSection>

        {/* Standards & status */}
        <LedgerSection
          id="standards"
          no="§ 03"
          tag="Standards register"
          title="Where each standard actually stands."
          lede="Stated plainly. An unearned badge is exactly the kind of unbacked claim this product exists to catch."
        >
          <table className={styles.dataTable}>
            <thead>
              <tr>
                <th scope="col">Standard</th>
                <th scope="col">Status</th>
                <th scope="col">Note</th>
              </tr>
            </thead>
            <tbody>
              {STANDARDS.map((s) => (
                <tr key={s.term}>
                  <th scope="row">{s.term}</th>
                  <td>
                    <span className={styles.trustStatus}>{s.status}</span>
                  </td>
                  <td style={{ fontFamily: 'inherit', color: 'var(--muted)', fontWeight: 400 }}>
                    {s.note}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </LedgerSection>

        {/* CTA */}
        <section id="contact" className={`${styles.section} ${styles.cta}`}>
          <div className={styles.container}>
            <div className={styles.ctaInner}>
              <div>
                <h2 className={styles.ctaTitle}>Send this to your procurement office.</h2>
                <p className={styles.ctaSub}>
                  We will provide the DPA, the accessibility conformance report, and the
                  subprocessor list for review — before any student data is processed.
                </p>
              </div>
              <div className={styles.ctaActions}>
                <a
                  className={`${styles.btn} ${styles.btnPrimary} ${styles.btnLg}`}
                  href="mailto:security@complianceos.edu?subject=Procurement%20documents"
                >
                  Request the documents
                  <ArrowRightIcon size={18} />
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
