const DAY = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Jakarta" });

/** `17-10-2026`: the calendar day in the business time zone (Asia/Jakarta), without the time. */
export function formatDay(date: Date): string {
  return DAY.format(date).replaceAll("/", "-");
}
