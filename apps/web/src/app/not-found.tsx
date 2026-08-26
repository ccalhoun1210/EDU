import Link from 'next/link';

export default function NotFound() {
  return (
    <>
      <h1>No such page</h1>
      <p className="sub">
        This deployment serves one assessment and the rule library behind it. If you followed a link
        to a requirement, it is not in the rule pack this build shipped with.
      </p>
      <p>
        <Link href="/">Back to the assessment</Link>
      </p>
    </>
  );
}
