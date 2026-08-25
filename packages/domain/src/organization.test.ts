import { describe, expect, it } from 'vitest';
import { grantsAccessTo } from './organization.js';

const stateAgency = { tenantId: 't1', organizationId: 'state-al' };
const district = { tenantId: 't1', organizationId: 'lea-lee-county' };

describe('grantsAccessTo', () => {
  it('grants access to the exact organization named by a scope', () => {
    expect(grantsAccessTo([district], district)).toBe(true);
  });

  it('does not let a parent organization reach a child organization', () => {
    expect(grantsAccessTo([stateAgency], district)).toBe(false);
  });

  it('does not let a scope cross a tenant boundary', () => {
    expect(grantsAccessTo([district], { tenantId: 't2', organizationId: 'lea-lee-county' })).toBe(
      false,
    );
  });
});
