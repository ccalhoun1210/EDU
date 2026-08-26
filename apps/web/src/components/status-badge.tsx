import type { EvaluationStatus } from '@complianceos/domain';
import { statusLabel } from '../lib/summary.js';

/**
 * The status, as a word.
 *
 * Colour is reinforcement and never the signal: the label carries the meaning, the dot in the
 * stylesheet is redundant, and the machine-readable code sits beside it for anyone reconciling
 * the screen against an export. A monitor printing this in greyscale reads it correctly.
 */
export function StatusBadge({ status }: { status: EvaluationStatus }) {
  return (
    <span className={`status status-${status}`}>
      {statusLabel(status)}
      <span className="status-code">{status}</span>
    </span>
  );
}
