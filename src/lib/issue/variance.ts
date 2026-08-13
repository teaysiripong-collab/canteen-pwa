import { subQty } from "@/lib/quantity";

export type IssueVariance = {
  standardBaseQty: string | null;
  actualBaseQty: string;
  varianceBaseQty: string | null;
  /** Percentage difference from standard, null when there is no standard to compare to. */
  variancePercent: number | null;
};

/**
 * Actual minus standard.
 *
 * Derived rather than stored: the issue document keeps both quantities, and the variance
 * is computed from them on read, so it can never disagree with its own inputs.
 */
export function computeVariance(
  standardBaseQty: string | null,
  actualBaseQty: string,
): IssueVariance {
  if (standardBaseQty === null) {
    return {
      standardBaseQty: null,
      actualBaseQty,
      varianceBaseQty: null,
      variancePercent: null,
    };
  }

  const variance = subQty(actualBaseQty, standardBaseQty);
  const standard = Number(standardBaseQty);

  return {
    standardBaseQty,
    actualBaseQty,
    varianceBaseQty: variance,
    // A zero standard has no meaningful percentage to report.
    variancePercent: standard === 0 ? null : (Number(variance) / standard) * 100,
  };
}
