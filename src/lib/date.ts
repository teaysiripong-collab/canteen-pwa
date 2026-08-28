/**
 * Business dates are Bangkok dates. The server runs in UTC, so `new Date()` rolls over to
 * the next day at 17:00 local time — which would mark food as expired a shift early and
 * put the night shift's movements on the wrong day.
 */
export const BUSINESS_TIME_ZONE = "Asia/Bangkok";

const isoFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today as YYYY-MM-DD in the canteen's timezone. */
export function todayIso(now: Date = new Date()): string {
  return isoFormatter.format(now);
}

/** Adds (or subtracts) whole days to a YYYY-MM-DD string without touching timezones. */
export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`; negative when `to` is in the past. */
export function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}
