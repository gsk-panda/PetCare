/**
 * Dates in this app are calendar days at the facility, never instants.
 *
 * Two traps this module exists to close:
 *
 *  - `new Date().toISOString().slice(0, 10)` is the UTC date, not the local
 *    one. For a US facility it rolls over mid-evening, so the board and the
 *    care rounds start showing tomorrow while staff are still working today.
 *  - Even for a Date built at local noon, `toISOString()` crosses the date
 *    line far enough east to land on the wrong day.
 *
 * So: format from local components, and take "today" from the facility's
 * configured timezone rather than the browser's.
 */

let facilityZone: string | undefined;

/** Set once from tenant metadata, before anything renders a date. */
export function setFacilityTimezone(tz: string | undefined): void {
  facilityZone = tz;
}

export function facilityTimezone(): string | undefined {
  return facilityZone;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** YYYY-MM-DD from a Date's local components. Never routes through UTC. */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Today at the facility. Falls back to the browser's zone before tenant
 * metadata has loaded, which is right far more often than UTC would be.
 */
export function facilityToday(): string {
  // en-CA formats as YYYY-MM-DD, which is exactly the wire format.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: facilityZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Shift a YYYY-MM-DD by whole days without ever leaving calendar arithmetic. */
export function shiftDate(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const at = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  at.setDate(at.getDate() + days);
  return isoDate(at);
}

/** Whole days from today at the facility to `iso`; negative once past. */
export function daysFromToday(iso: string): number {
  const [ty, tm, td] = facilityToday().split('-').map(Number);
  const [y, m, d] = iso.split('-').map(Number);
  const from = Date.UTC(ty ?? 1970, (tm ?? 1) - 1, td ?? 1);
  const to = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  return Math.round((to - from) / 86_400_000);
}
