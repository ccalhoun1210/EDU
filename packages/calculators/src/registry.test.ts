import { describe, expect, it } from 'vitest';
import { CALCULATOR_REGISTRY } from '@complianceos/rulepack-sdk';
import { CALCULATORS, NOT_YET_IMPLEMENTED } from './registry.js';

describe('the calculator registry and the allow-list', () => {
  it('implements nothing the allow-list does not permit', () => {
    // A calculator a rule pack may not reference is unreachable code that looks like a
    // capability. The allow-list is the contract; this is the implementation of it.
    for (const name of CALCULATORS.keys()) {
      expect(CALCULATOR_REGISTRY).toContain(name);
    }
  });

  it('registers each implementation under its own declared name', () => {
    for (const [key, calculator] of CALCULATORS) {
      expect(calculator.name).toBe(key);
    }
  });

  it('accounts for every allow-listed name, as implemented or as deliberately pending', () => {
    // ADR 0003 names this seam: the rule schema and the calculator registry have to be kept
    // in sync, and this is what does the keeping. Adding a name to the allow-list forces a
    // decision here; shipping an implementation forces removing it from the pending list.
    const accounted = new Set([...CALCULATORS.keys(), ...NOT_YET_IMPLEMENTED]);

    expect([...accounted].sort()).toEqual([...CALCULATOR_REGISTRY].sort());
  });

  it('does not list an implemented calculator as pending', () => {
    for (const name of NOT_YET_IMPLEMENTED) {
      expect(CALCULATORS.has(name)).toBe(false);
    }
  });

  it('gives every implementation a citation and a declared input list', () => {
    // Section 35: a calculator without an authority is not ready to be written.
    for (const calculator of CALCULATORS.values()) {
      expect(calculator.authority.length).toBeGreaterThan(0);
      expect(calculator.inputs.length).toBeGreaterThan(0);
      expect(calculator.title.length).toBeGreaterThan(0);
    }
  });
});
