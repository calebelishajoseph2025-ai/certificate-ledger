/**
 * Invariants and funnel computation for Certificate Ledger.
 */

export interface FunnelData {
  uniqueRecords: number;
  ready: number;
  eligible: number;
  issuedEver: number;
  currentlyValid: number;
  dropOffs: {
    needsCorrection: number;
    notCompleted: number;
    pending: number;
    revoked: number;
  };
  annotations: {
    rowsReceived: number;
    duplicateRowsMerged: number;
  };
}

export interface StatsSummary {
  eligibleTotal: number;
  issued: number;
  revoked: number;
  pending: number;
  needsCorrection: number;
  notCompleted: number;
  enrollmentsWithDuplicates: number;
  invariantHolds: boolean;
  funnel: FunnelData;
  byCourse: Record<
    string,
    {
      code: string;
      title: string;
      theme: string;
      eligible: number;
      issued: number;
      revoked: number;
      pending: number;
    }
  >;
}

export function computeFunnel(
  uniqueRecords: number,
  ready: number,
  eligible: number,
  issuedEver: number,
  currentlyValid: number,
  rowsReceived: number = 0,
  duplicateRowsMerged: number = 0
): FunnelData {
  const needsCorrection = Math.max(0, uniqueRecords - ready);
  const notCompleted = Math.max(0, ready - eligible);
  const pending = Math.max(0, eligible - issuedEver);
  const revoked = Math.max(0, issuedEver - currentlyValid);

  return {
    uniqueRecords,
    ready,
    eligible,
    issuedEver,
    currentlyValid,
    dropOffs: {
      needsCorrection,
      notCompleted,
      pending,
      revoked,
    },
    annotations: {
      rowsReceived,
      duplicateRowsMerged,
    },
  };
}

export function verifyCountInvariant(
  eligibleTotal: number,
  pending: number,
  issued: number,
  revoked: number
): { holds: boolean; formula: string } {
  const sum = pending + issued + revoked;
  const holds = eligibleTotal === sum;
  const formula = `${eligibleTotal} eligible = ${pending} pending + ${issued} issued + ${revoked} revoked`;
  return { holds, formula };
}
