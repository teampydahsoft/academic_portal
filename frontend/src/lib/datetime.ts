/** Institute timezone for all portal date/time display. */
export const INDIAN_TIME_ZONE = "Asia/Kolkata";

/**
 * Parse API date/time values. MySQL DATETIME strings without a timezone are UTC wall-clock.
 * Calendar dates (YYYY-MM-DD) are interpreted as IST midnight.
 */
export function parseApiDateTime(value: string | null | undefined): Date | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const date = new Date(`${raw}T00:00:00+05:30`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw)) {
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
  const date = new Date(`${normalized}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatIndianDate(value: string | null | undefined) {
  const date = parseApiDateTime(value);
  if (!date) return "—";
  return date.toLocaleDateString("en-IN", {
    timeZone: INDIAN_TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatIndianDateTime(value: string | null | undefined) {
  const date = parseApiDateTime(value);
  if (!date) return "—";
  return date.toLocaleString("en-IN", {
    timeZone: INDIAN_TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}
