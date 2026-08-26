/**
 * Display-only formatting. No regulatory logic lives here, and none may.
 *
 * Everything that turns a computed quantity into text comes from `@complianceos/rules-engine`
 * so that the table and the prose beneath it cannot disagree. What is left is the mechanical
 * work of turning identifiers into headings.
 */

/**
 * A property name as a heading.
 *
 * An all-caps identifier is an enum member from the regulatory vocabulary — `LOCAL_ONLY`,
 * `ACTUAL_EXPENDITURE` — and is left exactly as it is. Rewriting one would put a second
 * spelling of a defined term on screen, and a reader reconciling this page against a rule
 * pack needs the term the pack uses.
 */
export function humanizeKey(key: string): string {
  if (/^[A-Z0-9_]+$/.test(key)) return key;
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}
