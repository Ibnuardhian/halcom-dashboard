const NUMBER = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });

/**
 * A money amount with thousands separators, or an en dash when unknown. The sales export holds plain
 * numbers and no currency; they are assumed to be IDR (docs/requirements/OPEN_QUESTIONS.md T-14), so no
 * currency symbol is shown next to a number.
 */
export function formatAmount(value: number | null): string {
  return value === null ? "–" : NUMBER.format(value);
}

export function formatPercent(value: number | null): string {
  return value === null ? "–" : `${value}%`;
}
