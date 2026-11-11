import {describe, expect, it} from 'vitest';
import {dropOffSum} from './format';
import type {Funnel} from './schemas';

describe('funnel mapping', () => {
  it('drop-offs sum to the gaps between stages', () => {
    const funnel: Funnel = {
      uniqueRecords: 20,
      ready: 16,
      eligible: 12,
      issuedEver: 10,
      currentlyValid: 8,
      dropOffs: {
        needsCorrection: 4,
        notCompleted: 4,
        pending: 2,
        revoked: 2,
      },
      annotations: {rowsReceived: 22, duplicateRowsMerged: 2},
    };
    expect(dropOffSum(funnel)).toBe(
      funnel.dropOffs.needsCorrection +
        funnel.dropOffs.notCompleted +
        funnel.dropOffs.pending +
        funnel.dropOffs.revoked,
    );
    expect(funnel.dropOffs.needsCorrection).toBe(funnel.uniqueRecords - funnel.ready);
    expect(funnel.dropOffs.notCompleted).toBe(funnel.ready - funnel.eligible);
    expect(funnel.dropOffs.pending).toBe(funnel.eligible - funnel.issuedEver);
    expect(funnel.dropOffs.revoked).toBe(funnel.issuedEver - funnel.currentlyValid);
  });
});
