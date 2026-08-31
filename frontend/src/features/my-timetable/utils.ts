import type { AcademicFilters } from "@/components/layout/AcademicProvider";
import type { MyTimetableDay, MyTimetableResponse } from "./types";

export const WEEK_DAY_CODES = ["MON", "TUE", "WED", "THUR", "FRI", "SAT"] as const;

export type WeekDayCode = (typeof WEEK_DAY_CODES)[number];

export type TodayTeachingStatus =
  | "no-classes"
  | "before-first"
  | "in-class"
  | "between-classes"
  | "completed"
  | "non-teaching-day";

const JS_DAY_TO_CODE: Record<number, WeekDayCode | "SUN"> = {
  0: "SUN",
  1: "MON",
  2: "TUE",
  3: "WED",
  4: "THUR",
  5: "FRI",
  6: "SAT",
};

export function getTodayDayCode(): WeekDayCode | "SUN" {
  return JS_DAY_TO_CODE[new Date().getDay()];
}

export function startOfWeekMonday(date: Date, weekOffset = 0): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff + weekOffset * 7);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function getWeekDates(weekOffset = 0): {
  start: Date;
  end: Date;
  byDayCode: Record<string, Date>;
} {
  const start = startOfWeekMonday(new Date(), weekOffset);
  const end = new Date(start);
  end.setDate(start.getDate() + 5);

  const byDayCode: Record<string, Date> = {};
  WEEK_DAY_CODES.forEach((code, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    byDayCode[code] = date;
  });

  return { start, end, byDayCode };
}

export function formatShortDate(date: Date): string {
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function formatWeekRange(start: Date, end: Date): string {
  const sameYear = start.getFullYear() === end.getFullYear();
  const startLabel = start.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  const endLabel = end.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${startLabel} – ${endLabel}`;
}

export function formatLongDate(date: Date): string {
  return date.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export function formatTime12h(time: string): string {
  const [hStr, mStr] = time.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return time;
  const suffix = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${suffix}`;
}

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function classPeriods(day: MyTimetableDay | undefined) {
  return (
    day?.periods.filter(
      (period): period is Extract<typeof period, { kind: "class" }> =>
        period.kind === "class",
    ) ?? []
  );
}

export function findNextClass(
  day: MyTimetableDay | undefined,
  now = new Date(),
) {
  if (!day) return null;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const upcoming = classPeriods(day)
    .filter((period) => toMinutes(period.startTime) > nowMinutes)
    .sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
  return upcoming[0] ?? null;
}

export function findCurrentClass(
  day: MyTimetableDay | undefined,
  now = new Date(),
) {
  if (!day) return null;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return (
    classPeriods(day).find(
      (period) =>
        nowMinutes >= toMinutes(period.startTime) &&
        nowMinutes < toMinutes(period.endTime),
    ) ?? null
  );
}

export function getTodayTeachingStatus(
  day: MyTimetableDay | undefined,
  todayCode: WeekDayCode | "SUN",
  now = new Date(),
): TodayTeachingStatus {
  if (todayCode === "SUN") return "non-teaching-day";
  if (!day || day.classCount === 0) return "no-classes";

  const classes = classPeriods(day);
  if (classes.length === 0) return "no-classes";

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const firstStart = toMinutes(classes[0]!.startTime);
  const lastEnd = toMinutes(classes[classes.length - 1]!.endTime);

  if (nowMinutes < firstStart) return "before-first";
  if (findCurrentClass(day, now)) return "in-class";
  if (nowMinutes >= lastEnd) return "completed";
  if (findNextClass(day, now)) return "between-classes";
  return "completed";
}

export function countWeekClasses(weekDays: MyTimetableDay[]): number {
  return weekDays.reduce((sum, day) => sum + day.classCount, 0);
}

export function hasActiveAcademicFilters(filters: AcademicFilters): boolean {
  return (
    filters.collegeId !== "all" ||
    filters.courseId !== "all" ||
    filters.branchId !== "all" ||
    filters.batch !== "all" ||
    filters.year !== "all" ||
    filters.semester !== "all" ||
    filters.section !== "all" ||
    Boolean(filters.academicYear)
  );
}

export function linkedAccountMessage(payload: MyTimetableResponse | null): string {
  if (payload?.reason === "no_hrms_link") {
    return "Your account is not linked to an HRMS faculty profile. Your timetable cannot be displayed until your account is linked.";
  }
  if (payload?.reason === "no_staff_link") {
    return "Your faculty profile could not be found. Contact your administrator to link your portal account.";
  }
  return "Your account is not linked to a faculty profile. Contact your administrator for assistance.";
}

export function entryTypeLabel(entryType: string): string {
  const normalized = entryType.toLowerCase();
  if (normalized === "theory") return "Theory";
  if (normalized === "lab") return "Lab";
  return entryType;
}

export function buildCourseSectionLine(
  period: Extract<import("./types").TimetablePeriod, { kind: "class" }>,
): string {
  const program = [period.courseName, period.branchName].filter(Boolean).join(" ");
  const section = period.section ? `Section ${period.section}` : null;
  const yearSem =
    period.year != null || period.semester != null
      ? [
          period.year != null ? `Year ${period.year}` : null,
          period.semester != null ? `Sem ${period.semester}` : null,
        ]
          .filter(Boolean)
          .join(" • ")
      : null;

  return [program || null, yearSem, section].filter(Boolean).join(" • ");
}

export function todayStatusMessage(status: TodayTeachingStatus): string {
  switch (status) {
    case "no-classes":
      return "No classes scheduled today.";
    case "non-teaching-day":
      return "Sunday — no scheduled teaching periods.";
    case "before-first":
      return "Your first class is coming up today.";
    case "in-class":
      return "You are currently in a scheduled class.";
    case "between-classes":
      return "You have more classes scheduled later today.";
    case "completed":
      return "You have completed today's scheduled classes.";
    default:
      return "";
  }
}
