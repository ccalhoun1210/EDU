import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="app-main">
      <h1>No such page</h1>
      <p className="sub">
        If you followed a link to a requirement, it is not in the rule pack this build shipped with.
      </p>
      <p>
        <Link href="/">Back to ComplianceOS EDU</Link> ·{' '}
        <Link href="/assessment">the assessment</Link> ·{' '}
        <Link href="/registry">the rule registry</Link>
      </p>
    </main>
  );
}
