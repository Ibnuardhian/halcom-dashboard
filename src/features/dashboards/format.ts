const DAY = new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });

/** `17 Okt 2026`: the calendar day in the business time zone (Asia/Jakarta), without the time. */
export function formatDay(date: Date): string {
  return DAY.format(date);
}
