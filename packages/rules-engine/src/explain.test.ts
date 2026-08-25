/**
 * Behavioural tests for deterministic explanations.
 *
 * Spec: Master Technical Buildout sections 8.7 and 40. CLAUDE.md invariant 1.
 *
 * The explanation is the "Why" a district reads, so two things have to hold at once. It must
 * be pure substitution — a template that could compute could disagree with the calculation it
 * describes, and a wording that drifts between runs cannot be attested to. And it must never
 * render a gap as silence: an unresolved placeholder that collapses to an empty string turns
 * "we do not have this figure" into a sentence that reads as though the figure were zero.
 */

import { describe, expect, it } from 'vitest';
import type { CalculationStep, CalculatorValue } from '@complianceos/calculators';
import {
  explain,
  generateExplanation,
  renderExplanation,
  type ExplanationContext,
} from './explain.js';

// --- fixtures ---------------------------------------------------------------------------

/** The em-dash the module renders when a placeholder resolves to nothing. */
const ABSENT = '—';

function step(overrides: Partial<CalculationStep> = {}): CalculationStep {
  return {
    key: 'required_local',
    label: 'Required local effort',
    value: '1',
    unit: 'TEXT',
    ...overrides,
  };
}

function context(overrides: Partial<ExplanationContext> = {}): ExplanationContext {
  return { status: 'PASS', inputs: {}, output: {}, steps: [], missingInputs: [], ...overrides };
}

function inputs(values: Record<string, CalculatorValue | null>): ExplanationContext {
  return context({ inputs: values });
}

// --- placeholder resolution ----------------------------------------------------------------

describe('renderExplanation — placeholder resolution', () => {
  it('resolves the status', () => {
    expect(renderExplanation('This rule was {{status}}.', context({ status: 'FAIL' }))).toBe(
      'This rule was FAIL.',
    );
  });

  it('resolves a declared input by name', () => {
    expect(
      renderExplanation('Enrolled: {{input.child_count}}.', inputs({ child_count: 412 })),
    ).toBe('Enrolled: 412.');
  });

  it('resolves a nested path through calculator output', () => {
    const ctx = context({ output: { comparison: { basis: 'TOTAL_LOCAL' } } });

    expect(renderExplanation('Basis: {{output.comparison.basis}}.', ctx)).toBe(
      'Basis: TOTAL_LOCAL.',
    );
  });

  it('resolves a calculation step by key', () => {
    const ctx = context({
      steps: [step({ key: 'required_local', value: '5000000.00', unit: 'USD' })],
    });

    expect(renderExplanation('Required: {{step.required_local}}.', ctx)).toBe(
      'Required: $5,000,000.00.',
    );
  });

  it('resolves the missing-input list', () => {
    const ctx = context({ missingInputs: ['prior_local', 'current_local'] });

    expect(renderExplanation('Missing: {{missing}}.', ctx)).toBe(
      'Missing: prior_local, current_local.',
    );
  });

  it('tolerates whitespace inside the braces', () => {
    const ctx = inputs({ child_count: 412 });

    expect(renderExplanation('{{  input.child_count  }}', ctx)).toBe('412');
    expect(renderExplanation('{{ status }}', ctx)).toBe('PASS');
  });

  it('substitutes every occurrence, not merely the first', () => {
    expect(renderExplanation('{{status}} / {{status}}', context({ status: 'RISK' }))).toBe(
      'RISK / RISK',
    );
  });

  it('leaves text outside placeholders exactly as authored', () => {
    const rendered = renderExplanation(
      '**Maintenance of effort** was {{status}} under 34 CFR 300.203(a).',
      context({ status: 'PASS' }),
    );

    expect(rendered).toBe('**Maintenance of effort** was PASS under 34 CFR 300.203(a).');
  });
});

// --- absence ----------------------------------------------------------------------------

describe('renderExplanation — a gap is never rendered as silence', () => {
  it('renders an unknown namespace as the absent marker, not as an empty string', () => {
    const rendered = renderExplanation('Value: {{nonsense}}.', context());

    expect(rendered).toBe(`Value: ${ABSENT}.`);
    expect(rendered).not.toBe('Value: .');
  });

  it('renders an undeclared input as the absent marker rather than leaking the braces', () => {
    const rendered = renderExplanation('Value: {{input.not_declared}}.', inputs({ a: '1.00' }));

    expect(rendered).toBe(`Value: ${ABSENT}.`);
    expect(rendered).not.toContain('{{');
  });

  it('renders a declared-but-absent input as the absent marker', () => {
    // `null` is how the engine records "looked, found nothing". It must not print as "null".
    const rendered = renderExplanation(
      'Prior year: {{input.prior_local}}.',
      inputs({ prior_local: null }),
    );

    expect(rendered).toBe(`Prior year: ${ABSENT}.`);
  });

  it('renders an unknown step key as the absent marker', () => {
    const ctx = context({ steps: [step({ key: 'required_local' })] });

    expect(renderExplanation('{{step.no_such_step}}', ctx)).toBe(ABSENT);
  });

  it('renders an empty missing-input list as the absent marker', () => {
    expect(renderExplanation('{{missing}}', context({ missingInputs: [] }))).toBe(ABSENT);
  });

  it('renders an empty list input as the absent marker rather than nothing at all', () => {
    expect(renderExplanation('{{input.exceptions}}', inputs({ exceptions: [] }))).toBe(ABSENT);
  });

  it('renders a partial path that runs off the end of an object as the absent marker', () => {
    const ctx = context({ output: { comparison: { basis: 'TOTAL_LOCAL' } } });

    expect(renderExplanation('{{output.comparison.basis.deeper}}', ctx)).toBe(ABSENT);
  });
});

// --- formatting ----------------------------------------------------------------------------

describe('renderExplanation — formatting', () => {
  it('renders a USD step as formatted currency', () => {
    const ctx = context({
      steps: [step({ key: 'shortfall', value: '1234567.80', unit: 'USD' })],
    });

    expect(renderExplanation('{{step.shortfall}}', ctx)).toBe('$1,234,567.80');
  });

  it('renders a per-child USD step as formatted currency', () => {
    const ctx = context({
      steps: [step({ key: 'per_child', value: '10250.00', unit: 'USD_PER_CHILD' })],
    });

    expect(renderExplanation('{{step.per_child}}', ctx)).toBe('$10,250.00');
  });

  it('renders a percent step with its sign', () => {
    const ctx = context({ steps: [step({ key: 'share', value: '12.5', unit: 'PERCENT' })] });

    expect(renderExplanation('{{step.share}}', ctx)).toBe('12.5%');
  });

  it('leaves a non-numeric USD step value alone rather than mangling it', () => {
    const ctx = context({ steps: [step({ key: 'shortfall', value: 'n/a', unit: 'USD' })] });

    expect(renderExplanation('{{step.shortfall}}', ctx)).toBe('n/a');
  });

  it('renders a decimal-string input as currency', () => {
    // Money arrives as a decimal string (invariant 5); a district should read "$5,250,000.00",
    // not the raw numeral.
    expect(
      renderExplanation('{{input.current_local}}', inputs({ current_local: '5250000.00' })),
    ).toBe('$5,250,000.00');
  });

  it('renders a negative decimal-string input with the sign in front of the dollar', () => {
    expect(renderExplanation('{{input.shortfall}}', inputs({ shortfall: '-1200.50' }))).toBe(
      '-$1,200.50',
    );
  });

  it('renders a list input as a comma-separated series', () => {
    const ctx = inputs({ exceptions: ['300.204(a)', '300.204(c)'] });

    expect(renderExplanation('{{input.exceptions}}', ctx)).toBe('300.204(a), 300.204(c)');
  });

  it('renders a boolean input as a word rather than dropping it', () => {
    expect(
      renderExplanation('{{input.exception_claimed}}', inputs({ exception_claimed: false })),
    ).toBe('false');
  });
});

// --- a template cannot compute ---------------------------------------------------------------

describe('renderExplanation — a template cannot compute', () => {
  it('does not evaluate arithmetic written inside a placeholder', () => {
    const rendered = renderExplanation('{{ 2 + 2 }}', context());

    expect(rendered).not.toContain('4');
  });

  it('does not resolve a placeholder naming a global', () => {
    const ctx = context();

    expect(renderExplanation('{{ globalThis.process.pid }}', ctx)).toBe(ABSENT);
    expect(renderExplanation('{{ process.env.DATABASE_URL }}', ctx)).toBe(ABSENT);
    expect(renderExplanation('{{ constructor.constructor }}', ctx)).toBe(ABSENT);
  });

  it('treats a placeholder-looking input value as text, never as a template to expand again', () => {
    // A fact arriving from a district export must not be able to reach the resolver. One pass
    // of substitution, over the authored template only.
    const ctx = inputs({ note: '{{status}}' });

    expect(renderExplanation('Note: {{input.note}}.', context({ ...ctx, status: 'FAIL' }))).toBe(
      'Note: {{status}}.',
    );
  });

  /**
   * DEFECT: `readPath` walks the prototype chain — it indexes each segment with no
   * own-property check — so `{{input.constructor}}`, `{{output.toString}}` and
   * `{{input.__proto__}}` resolve to members of `Object.prototype` and render as engine
   * internals (`"function Object() { [native code] }"`) inside a district-facing compliance
   * explanation. Nothing is invoked, so a template still cannot compute, but a name that is
   * not a declared input must resolve to the absent marker. Correct behaviour: resolve only
   * own enumerable properties at every segment, otherwise `ABSENT`.
   */
  it('resolves a prototype member to the absent marker rather than to engine internals', () => {
    // Plain indexing walks the prototype chain, so `{{input.constructor}}` would render
    // "function Object() { [native code] }" inside a district-facing compliance explanation.
    // Nothing is ever invoked, but a name that is not a declared input must resolve to
    // nothing at all.
    const ctx = inputs({ current_local: '5250000.00' });

    expect(renderExplanation('{{input.constructor}}', ctx)).toBe(ABSENT);
    expect(renderExplanation('{{input.toString}}', ctx)).toBe(ABSENT);
    expect(renderExplanation('{{input.__proto__}}', ctx)).toBe(ABSENT);
    expect(renderExplanation('{{output.hasOwnProperty}}', ctx)).toBe(ABSENT);
    expect(renderExplanation('{{input.valueOf}}', ctx)).toBe(ABSENT);
  });

  /**
   * DEFECT: the placeholder pattern only accepts `[a-zA-Z0-9_.[\]]`, so a placeholder holding
   * any other character — an authoring typo like `{{input.prior-local}}`, or an expression
   * such as `{{ shortfall + 1 }}` — never matches and is emitted into the rendered
   * explanation verbatim, braces and all. A district then reads raw template syntax in a
   * compliance document. Correct behaviour: match any `{{...}}` span and render the ones that
   * do not resolve as the absent marker, so template scaffolding can never reach a reader.
   */
  it('renders a malformed placeholder as the absent marker rather than as raw braces', () => {
    // Template scaffolding must never reach a district. An authoring typo renders as the
    // absent marker; it does not render as itself.
    expect(renderExplanation('{{input.prior-local}}', context())).toBe(ABSENT);
    expect(renderExplanation('{{ shortfall + 1 }}', context())).toBe(ABSENT);
    expect(renderExplanation('{{}}', context())).toBe(ABSENT);
    expect(renderExplanation('Shortfall: {{ input.a b }}.', context())).toBe(
      `Shortfall: ${ABSENT}.`,
    );
  });
});

// --- the generated fallback ----------------------------------------------------------------

describe('generateExplanation — the shown work', () => {
  it('leads with the result', () => {
    expect(generateExplanation(context({ status: 'FAIL' })).startsWith('Result: FAIL.')).toBe(true);
  });

  it('says why nothing could be determined when inputs were missing', () => {
    const rendered = generateExplanation(
      context({ status: 'INDETERMINATE', missingInputs: ['prior_local', 'current_local'] }),
    );

    expect(rendered).toContain('could not be determined');
    expect(rendered).toContain('prior_local, current_local');
  });

  it('omits the missing-data sentence when nothing was missing', () => {
    expect(generateExplanation(context())).not.toContain('could not be determined');
  });

  it('lists the steps in the order the calculator produced them', () => {
    const rendered = generateExplanation(
      context({
        steps: [
          step({ key: 'a', label: 'Prior year local', value: '5000000.00', unit: 'USD' }),
          step({ key: 'b', label: 'Current year local', value: '4000000.00', unit: 'USD' }),
        ],
      }),
    );

    expect(rendered.indexOf('Prior year local')).toBeLessThan(
      rendered.indexOf('Current year local'),
    );
    expect(rendered).toContain('- Prior year local: $5,000,000.00');
  });

  it('carries a step detail and citation so a figure can be checked against a ledger', () => {
    const rendered = generateExplanation(
      context({
        steps: [
          step({
            key: 'shortfall',
            label: 'Shortfall',
            value: '1000000.00',
            unit: 'USD',
            detail: '5,000,000.00 − 4,000,000.00',
            citation: '34 CFR 300.203(b)',
          }),
        ],
      }),
    );

    expect(rendered).toContain(
      '- Shortfall: $1,000,000.00 (5,000,000.00 − 4,000,000.00) [34 CFR 300.203(b)]',
    );
  });

  it('omits the calculation block entirely when there are no steps', () => {
    expect(generateExplanation(context())).toBe('Result: PASS.');
  });
});

// --- explain ---------------------------------------------------------------------------------

describe('explain — template, then fallback', () => {
  const templates = new Map([['moe-compliance', 'Effort was {{status}}.']]);

  it('renders the named template when the pack carries it', () => {
    expect(explain('moe-compliance', templates, context({ status: 'FAIL' }))).toBe(
      'Effort was FAIL.',
    );
  });

  it('falls back to the generated step listing when the named template is absent', () => {
    const ctx = context({
      status: 'FAIL',
      steps: [step({ key: 'shortfall', label: 'Shortfall', value: '1000.00', unit: 'USD' })],
    });

    const rendered = explain('no-such-template', templates, ctx);

    // A content bug must still leave the district looking at the arithmetic.
    expect(rendered).toContain('Result: FAIL.');
    expect(rendered).toContain('- Shortfall: $1,000.00');
  });

  it('includes the missing-input sentence in the fallback when inputs were missing', () => {
    const rendered = explain(
      'no-such-template',
      templates,
      context({ status: 'INDETERMINATE', missingInputs: ['prior_local'] }),
    );

    expect(rendered).toContain('the following data was not available: prior_local.');
  });

  it('renders identically for the same context twice', () => {
    // Determinism is what makes an explanation attestable — a wording that drifts between runs
    // cannot be part of a reproducible result.
    const ctx = context({
      status: 'FAIL',
      inputs: { current_local: '4000000.00', prior_local: '5000000.00' },
      output: { shortfall: '1000000.00' },
      steps: [step({ key: 'shortfall', label: 'Shortfall', value: '1000000.00', unit: 'USD' })],
      missingInputs: ['child_count'],
    });

    expect(explain('moe-compliance', templates, ctx)).toBe(
      explain('moe-compliance', templates, ctx),
    );
    expect(explain('absent', templates, ctx)).toBe(explain('absent', templates, ctx));
  });
});
