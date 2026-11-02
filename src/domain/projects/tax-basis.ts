/**
 * Whether the Estimated PO value Sales enter and the target margin / gross profit include the PPN. Sales enter the value with PPN and
 * the margin without it, so a margin percentage is taken of the value without PPN. A Superadmin sets each side and the rate.
 */
export type TaxBasis = { valueIncludesTax: boolean; marginIncludesTax: boolean; taxRatePercent: number };

export const DEFAULT_TAX_BASIS: TaxBasis = { valueIncludesTax: true, marginIncludesTax: false, taxRatePercent: 11 };
export const MAX_TAX_RATE_PERCENT = 30;

/** A stored basis read back: anything missing or out of range falls back to the default. */
export function readTaxBasis(value: unknown): TaxBasis {
  const v = (value ?? {}) as Partial<Record<keyof TaxBasis, unknown>>;
  const rate = typeof v.taxRatePercent === "number" && v.taxRatePercent >= 0 && v.taxRatePercent <= MAX_TAX_RATE_PERCENT ? v.taxRatePercent : DEFAULT_TAX_BASIS.taxRatePercent;
  return {
    valueIncludesTax: typeof v.valueIncludesTax === "boolean" ? v.valueIncludesTax : DEFAULT_TAX_BASIS.valueIncludesTax,
    marginIncludesTax: typeof v.marginIncludesTax === "boolean" ? v.marginIncludesTax : DEFAULT_TAX_BASIS.marginIncludesTax,
    taxRatePercent: rate,
  };
}

/** What a sale value is multiplied by to be on the margin's basis (value with PPN and margin without: 1 / 1.11). */
export function marginFactor(basis: TaxBasis): number {
  const tax = 1 + basis.taxRatePercent / 100;
  return (basis.marginIncludesTax ? tax : 1) / (basis.valueIncludesTax ? tax : 1);
}

export const taxLabel = (includes: boolean): string => (includes ? "incl. PPN" : "excl. PPN");
