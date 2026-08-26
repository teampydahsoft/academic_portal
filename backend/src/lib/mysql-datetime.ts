/**
 * MySQL DATETIME helpers.
 *
 * Academic pool uses `dateStrings: true`, so DATETIME comes back as
 * `"YYYY-MM-DD HH:mm:ss"` with no timezone. We store session/auth timestamps
 * in UTC and must parse/display them as UTC → local, not as naive local time.
 */

/** Format a Date (or now) as MySQL DATETIME in UTC. */
export function toMysqlUtcDateTime(date: Date = new Date()): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Convert MySQL DATETIME / ISO / Date into a UTC ISO string for APIs.
 * Naive MySQL strings are treated as UTC wall-clock.
 */
export function mysqlDateTimeToIso(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  const raw = String(value).trim();
  if (!raw) return null;

  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw)) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  // "2026-08-26 05:26:14" or "2026-08-26T05:26:14" → treat as UTC
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
  const d = new Date(`${normalized}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
