/**
 * The sign-in page.
 *
 * Spec: Master Technical Buildout section 18.
 *
 * What this page offers depends on what the deployment is, and it says which rather than
 * rendering a form that cannot work. An unconnected deployment has nothing to sign in to
 * and says so; a connected one with no demonstration roster is waiting on its district's
 * identity provider to be federated and says that. Neither is a "coming soon" shell: both
 * are the true state of the deployment, stated, with the working alternative linked.
 */

import Link from 'next/link';
import { connected, demoRoster } from '@/lib/roster';
import { currentSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Sign in — ComplianceOS EDU',
};

/**
 * The refusal, in words, without saying which account exists.
 *
 * Both messages are true of every failing case they cover. "Refused" covers an unknown
 * handle, a suspended account and one whose membership was revoked, and says the same thing
 * about all three, because distinguishing them here would turn the sign-in page into a
 * directory of the district's staff.
 */
const REFUSAL: Record<string, string> = {
  unavailable: 'Sign-in is not available on this deployment right now.',
  refused: 'That account cannot sign in. Ask a district administrator to check your access.',
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const errorParam = params['error'];
  // Read from a lookup rather than rendered: an error string from the query string that
  // reached the page would be reflected content, and this page is unauthenticated.
  const refusal = typeof errorParam === 'string' ? REFUSAL[errorParam] : undefined;

  const session = await currentSession();
  if (session.signedIn) {
    return (
      <>
        <h1>Already signed in</h1>
        <p className="sub">
          You are signed in as <strong>{session.principal.displayName}</strong> (
          {session.principal.email}).
        </p>
        <p>
          <Link href="/assessment">Open the assessment</Link>
        </p>
      </>
    );
  }

  const config = connected();
  if (config === null) {
    return (
      <>
        <h1>Sign-in is not available on this deployment</h1>
        <p className="sub">
          This build has no database configured, so there are no districts, no users and nothing to
          sign in to.
        </p>
        <p>
          What it does have is the whole pipeline running over a synthetic district. Open the{' '}
          <Link href="/assessment">assessment</Link> to see an export parsed, mapped, sealed into a
          content-hashed snapshot and evaluated against the rule pack this build shipped with — or
          the <Link href="/registry">rule registry</Link> to see that content itself.
        </p>
      </>
    );
  }

  const roster = await demoRoster();

  if (roster === null || roster.length === 0) {
    return (
      <>
        <h1>Sign in with your district identity provider</h1>
        <p className="sub">
          This deployment authenticates through each district&rsquo;s own federation — its SAML
          connection, Google Workspace or Microsoft Entra tenant. No district provider is federated
          to this build yet.
        </p>
        <p className="note note-warn">
          This platform never stores a password. Accounts are provisioned by an administrator and
          matched on the identity provider&rsquo;s subject claim, so a mailbox that changes hands
          does not carry access with it.
        </p>
        <p>
          <Link href="/assessment">See the worked example</Link> in the meantime.
        </p>
      </>
    );
  }

  return (
    <>
      <h1>Sign in</h1>

      {refusal === undefined ? null : (
        <p className="note note-fail" role="alert">
          {refusal}
        </p>
      )}

      <p className="sub">
        Choose an account. Every entry below is a real user of the demonstration district with an
        active membership — the roster is read from the database, not from a list in the
        configuration.
      </p>

      <p className="note note-warn">
        <strong>This sign-in authenticates nobody.</strong> It exists so the product can be walked
        through before a district&rsquo;s identity provider is federated, and it refuses to run on a
        production deployment. What it grants is still decided by the database: membership,
        capability and scope are re-read on every request, so an account whose grant is revoked
        stops working immediately.
      </p>

      <form action="/api/auth/sign-in" method="post" className="sign-in-list">
        <ul className="issue-list">
          {roster.map((identity) => (
            <li key={identity.subjectId}>
              <button type="submit" name="handle" value={identity.handle} className="link-button">
                <strong>{identity.displayName}</strong>
                <span className="muted"> {identity.email}</span>
              </button>
              {identity.mfaSatisfied ? null : (
                <span className="muted"> — no second factor asserted</span>
              )}
            </li>
          ))}
        </ul>
      </form>
    </>
  );
}
