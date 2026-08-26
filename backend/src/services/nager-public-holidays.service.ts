import { env } from "../config/env.js";

/**
 * Public holidays for the Student DB Attendance Calendar come from Nager.Date.
 * This module is the Academic Portal reuse of that integration:
 * - read-only fetch
 * - in-memory cache only
 * - never written to Academic Portal or Student DB
 */

export type PublicHoliday = {
  date: string;
  title: string;
  localName: string | null;
  countryCode: string;
  global: boolean;
  counties: string[] | null;
};

type NagerHoliday = {
  date?: string;
  localName?: string;
  name?: string;
  countryCode?: string;
  global?: boolean;
  counties?: string[] | null;
  types?: string[];
};

type YearCacheEntry = {
  expiresAt: number;
  holidays: PublicHoliday[];
};

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
const yearCache = new Map<string, YearCacheEntry>();

function cacheKey(year: number, countryCode: string): string {
  return `${countryCode}:${year}`;
}

function toDateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = value.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function mapHoliday(item: NagerHoliday, fallbackCountry: string): PublicHoliday | null {
  const date = toDateOnly(item.date);
  if (!date) return null;
  const title = (item.name ?? item.localName ?? "").trim();
  if (!title) return null;
  return {
    date,
    title,
    localName: item.localName?.trim() || null,
    countryCode: (item.countryCode ?? fallbackCountry).trim() || fallbackCountry,
    global: item.global !== false,
    counties: Array.isArray(item.counties) ? item.counties : null,
  };
}

async function fetchYear(year: number, countryCode: string): Promise<PublicHoliday[]> {
  const key = cacheKey(year, countryCode);
  const cached = yearCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.holidays;
  }

  const url = `${env.nagerDate.baseUrl.replace(/\/$/, "")}/PublicHolidays/${year}/${countryCode}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    // Nager.Date returns 204 when a country/year has no public-holiday dataset
    // (India is currently unsupported in AvailableCountries).
    if (response.status === 204 || response.status === 404) {
      yearCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, holidays: [] });
      return [];
    }

    if (!response.ok) {
      throw new Error(`Nager.Date returned ${response.status}`);
    }

    const text = await response.text();
    if (!text.trim()) {
      yearCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, holidays: [] });
      return [];
    }

    const body = JSON.parse(text) as unknown;
    const rows = Array.isArray(body) ? (body as NagerHoliday[]) : [];
    const holidays = rows
      .map((row) => mapHoliday(row, countryCode))
      .filter((row): row is PublicHoliday => row != null);

    yearCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, holidays });
    return holidays;
  } catch (error) {
    if (cached) return cached.holidays;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function yearsInRange(startDate: string, endDate: string): number[] {
  const startYear = Number(startDate.slice(0, 4));
  const endYear = Number(endDate.slice(0, 4));
  const years: number[] = [];
  for (let year = startYear; year <= endYear; year += 1) years.push(year);
  return years;
}

export async function listPublicHolidays(input: {
  startDate: string;
  endDate: string;
  countryCode?: string;
}): Promise<{
  source: "nager.date";
  countryCode: string;
  holidays: PublicHoliday[];
  error: string | null;
}> {
  const countryCode = (input.countryCode ?? env.nagerDate.countryCode).trim().toUpperCase() || "IN";
  const startDate = input.startDate.slice(0, 10);
  const endDate = input.endDate.slice(0, 10);

  try {
    const byYear = await Promise.all(
      yearsInRange(startDate, endDate).map((year) => fetchYear(year, countryCode)),
    );
    const holidays = byYear
      .flat()
      .filter((holiday) => holiday.date >= startDate && holiday.date <= endDate)
      .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));

    return { source: "nager.date", countryCode, holidays, error: null };
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "Nager.Date request timed out"
        : error instanceof Error
          ? error.message
          : "Failed to load public holidays from Nager.Date";
    return { source: "nager.date", countryCode, holidays: [], error: message };
  }
}
