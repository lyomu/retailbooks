import type { Prisma } from '@prisma/client';
import type { WorkflowCondition } from '@retailbooks/contracts';
import { describe, expect, it } from 'vitest';

import { conditionMatches } from '../src/automation/workflows.service.js';

/**
 * `conditionMatches` is a pure function with no DI dependencies, exported specifically so this
 * DB-free unit test can exercise every operator directly. The contract layer (`workflowConditionSchema`)
 * already constrains `operator` to the six values below; the point here is to pin each operator's
 * runtime semantics: a matching value, a non-matching value, a missing payload field, and (for the
 * numeric comparators) a non-numeric payload value that must short-circuit to `false` rather than
 * throw.
 */
function match(condition: WorkflowCondition, payload: Prisma.JsonValue): boolean {
  return conditionMatches(condition, payload);
}

describe('workflow condition operator evaluation', () => {
  describe('equals', () => {
    const condition: WorkflowCondition = { field: 'status', operator: 'equals', value: 'ISSUED' };

    it('matches an equal value', () => {
      expect(match(condition, { status: 'ISSUED' })).toBe(true);
    });

    it('does not match a different value', () => {
      expect(match(condition, { status: 'DRAFT' })).toBe(false);
    });

    it('does not match when the field is missing', () => {
      expect(match(condition, {})).toBe(false);
    });
  });

  describe('notEquals', () => {
    const condition: WorkflowCondition = {
      field: 'status',
      operator: 'notEquals',
      value: 'ISSUED',
    };

    it('matches a different value', () => {
      expect(match(condition, { status: 'DRAFT' })).toBe(true);
    });

    it('does not match an equal value', () => {
      expect(match(condition, { status: 'ISSUED' })).toBe(false);
    });

    it('matches when the field is missing (undefined is not equal to a concrete value)', () => {
      expect(match(condition, {})).toBe(true);
    });
  });

  describe('exists', () => {
    const condition: WorkflowCondition = { field: 'reference', operator: 'exists' };

    it('matches a present, non-null value', () => {
      expect(match(condition, { reference: 'INV-001' })).toBe(true);
    });

    it('does not match when the field is missing', () => {
      expect(match(condition, {})).toBe(false);
    });

    it('does not match a null value', () => {
      expect(match(condition, { reference: null })).toBe(false);
    });
  });

  describe('greaterThan', () => {
    const condition: WorkflowCondition = { field: 'amount', operator: 'greaterThan', value: 100 };

    it('matches a larger numeric value', () => {
      expect(match(condition, { amount: 200 })).toBe(true);
    });

    it('does not match a smaller or equal value', () => {
      expect(match(condition, { amount: 50 })).toBe(false);
      expect(match(condition, { amount: 100 })).toBe(false);
    });

    it('does not match when the field is missing', () => {
      expect(match(condition, {})).toBe(false);
    });

    it('does not throw and returns false for a non-numeric payload value', () => {
      expect(() => match(condition, { amount: '200' })).not.toThrow();
      expect(match(condition, { amount: '200' })).toBe(false);
    });
  });

  describe('lessThan', () => {
    const condition: WorkflowCondition = { field: 'amount', operator: 'lessThan', value: 100 };

    it('matches a smaller numeric value', () => {
      expect(match(condition, { amount: 50 })).toBe(true);
    });

    it('does not match a larger or equal value', () => {
      expect(match(condition, { amount: 200 })).toBe(false);
      expect(match(condition, { amount: 100 })).toBe(false);
    });

    it('does not match when the field is missing', () => {
      expect(match(condition, {})).toBe(false);
    });

    it('does not throw and returns false for a non-numeric payload value', () => {
      expect(() => match(condition, { amount: '50' })).not.toThrow();
      expect(match(condition, { amount: '50' })).toBe(false);
    });
  });

  describe('in', () => {
    const condition: WorkflowCondition = {
      field: 'status',
      operator: 'in',
      value: ['ISSUED', 'PAID'],
    };

    it('matches a value present in the list', () => {
      expect(match(condition, { status: 'ISSUED' })).toBe(true);
      expect(match(condition, { status: 'PAID' })).toBe(true);
    });

    it('does not match a value absent from the list', () => {
      expect(match(condition, { status: 'DRAFT' })).toBe(false);
    });

    it('does not match when the field is missing', () => {
      expect(match(condition, {})).toBe(false);
    });

    it('returns false when the condition value is not an array', () => {
      expect(
        match({ field: 'status', operator: 'in', value: 'ISSUED' }, { status: 'ISSUED' }),
      ).toBe(false);
    });
  });
});
