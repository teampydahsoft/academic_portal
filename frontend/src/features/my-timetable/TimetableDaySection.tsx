import { cn } from "@/lib/cn";
import type { MyTimetableDay } from "./types";
import { TimetableClassCard } from "./TimetableClassCard";
import { TimetableFreePeriodCard } from "./TimetableFreePeriodCard";
import { formatShortDate } from "./utils";

type Props = {
  day: MyTimetableDay;
  date: Date;
  isToday: boolean;
  compact?: boolean;
};

export function TimetableDaySection({ day, date, isToday, compact = false }: Props) {
  const classPeriods = day.periods.filter((period) => period.kind === "class");

  return (
    <section
      className={cn(
        "flex h-full flex-col rounded-lg border bg-card shadow-sm",
        isToday ? "border-brand-300 ring-1 ring-brand-100" : "border-border",
      )}
      aria-labelledby={`day-${day.dayOfWeek}`}
    >
      <header
        className={cn(
          "border-b px-4 py-3",
          isToday ? "border-brand-100 bg-brand-50/40" : "border-border",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {isToday ? (
              <p className="text-[10px] font-bold uppercase tracking-widest text-brand-700">
                Today
              </p>
            ) : null}
            <h2 id={`day-${day.dayOfWeek}`} className="text-sm font-semibold text-navy-900">
              {day.dayLabel}
            </h2>
            <p className="text-xs text-slate-500">{formatShortDate(date)}</p>
          </div>
          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
            {classPeriods.length} {classPeriods.length === 1 ? "class" : "classes"}
          </span>
        </div>
      </header>

      <div className="flex-1 space-y-2 p-3">
        {day.periods.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">No classes scheduled</p>
        ) : (
          day.periods.map((period) =>
            period.kind === "class" ? (
              <TimetableClassCard
                key={`class-${period.entryId}`}
                period={period}
                compact={compact}
              />
            ) : (
              <TimetableFreePeriodCard
                key={`free-${period.startTime}-${period.endTime}`}
                period={period}
              />
            ),
          )
        )}
      </div>
    </section>
  );
}
