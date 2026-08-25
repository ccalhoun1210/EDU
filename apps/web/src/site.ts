/**
 * Single source of truth for the public marketing surface.
 *
 * `NEXT_PUBLIC_CONTACT_EMAIL` overrides the address every call to action points at, so the
 * inbox can change per environment without a code change. Set it in Vercel before launch.
 */
const DEFAULT_CONTACT_EMAIL = 'hello@complianceos-edu.com';

export const SITE = {
  name: 'ComplianceOS EDU',
  description:
    'Compliance assurance for publicly funded education programs. ComplianceOS EDU reads from the systems your district already runs, evaluates versioned federal and state rules, and shows the evidence behind every result.',
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || DEFAULT_CONTACT_EMAIL,
} as const;

/** Builds a mailto link with a subject line, so an inbound note arrives already triaged. */
export function contactHref(subject: string): string {
  return `mailto:${SITE.contactEmail}?subject=${encodeURIComponent(subject)}`;
}
