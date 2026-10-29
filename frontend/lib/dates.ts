// Local-calendar date helpers.
//
// Never build a "YYYY-MM-DD" string with `date.toISOString().slice(0, 10)`:
// toISOString() converts to UTC first, so in a timezone ahead of UTC (Pakistan,
// UTC+5) local midnight lands on the PREVIOUS day -- "1 October" came out as
// "30 September". These helpers format the date as the user sees it.

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function todayYmd(): string {
  return ymd(new Date());
}

/** 1st of the month containing `d` (default: today). */
export function firstOfMonthYmd(d: Date = new Date()): string {
  return ymd(new Date(d.getFullYear(), d.getMonth(), 1));
}

/** "YYYY-MM" for the month containing `d` (default: today). */
export function monthKeyOf(d: Date = new Date()): string {
  return ymd(d).slice(0, 7);
}

/** Last day of the month "YYYY-MM". */
export function lastOfMonthYmd(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return ymd(new Date(y, m, 0));
}
