import { Clock3 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import type { MyTimetableDay } from "./types";
import {
  buildCourseSectionLine,
  findCurrentClass,
  findNextClass,
  formatLongDate,
  formatTime12h,
  getTodayTeachingStatus,
  todayStatusMessage,
  type TodayTeachingStatus,
} from "./utils";

type Props = {
  todayDay: MyTimetableDay | undefined;
  classesToday: number;
  todayCode: string;
  now: Date;
};

function StatusDetail({
  status,
  todayDay,
  now,
}: {
  status: TodayTeachingStatus;
  todayDay: MyTimetableDay | undefined;
  now: Date;
}) {
  const currentClass = findCurrentClass(todayDay, now);
  const nextClass = findNextClass(todayDay, now);

  if (status === "in-class" && currentClass) {
    return (
      <div className="min-w-0 flex-1 rounded-lg border border-brand-200 bg-white p-3 shadow-sm sm:max-w-sm">
        <p className="text-[10px] font-bold uppercase tracking-widest text-brand-700">
          Current class
        </p>
        <p className="mt-1 break-words text-sm font-semibold text-navy-900">
          {currentClass.subjectName ?? currentClass.subjectCode}
        </p>
        <p className="text-xs text-slate-500">
          Until {formatTime12h(currentClass.endTime)}
          {currentClass.roomLabel ? ` • Room ${currentClass.roomLabel}` : ""}
        </p>
      </div>
    );
  }

  if ((status === "before-first" || status === "between-classes") && nextClass) {
    return (
      <div className="min-w-0 flex-1 rounded-lg border border-border bg-white p-3 shadow-sm sm:max-w-sm">
        <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">
          <Clock3 className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Next class
        </p>
        <p className="mt-1 text-sm font-semibold text-navy-900">
          {formatTime12h(nextClass.startTime)}
        </p>
        <p className="break-words text-sm text-navy-900">
          {nextClass.subjectName ?? nextClass.subjectCode}
        </p>
        <p className="break-words text-xs text-slate-500">
          {buildCourseSectionLine(nextClass)}
          {nextClass.roomLabel ? ` • Room ${nextClass.roomLabel}` : ""}
        </p>
      </div>
    );
  }

  return null;
}

export function TimetableTodayPanel({ todayDay, classesToday, todayCode, now }: Props) {
  const status = getTodayTeachingStatus(
    todayDay,
    todayCode as "SUN" | "MON" | "TUE" | "WED" | "THUR" | "FRI" | "SAT",
    now,
  );

  return (
    <Card className="mb-4 border-brand-100 bg-brand-50/30">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-brand-700">Today</p>
          <h2 className="text-base font-semibold text-navy-900">{formatLongDate(now)}</h2>
          <p className="mt-1 text-sm text-slate-600">{todayStatusMessage(status)}</p>
          {classesToday > 0 ? (
            <p className="mt-1 text-xs text-slate-500">
              {classesToday} scheduled {classesToday === 1 ? "class" : "classes"}
            </p>
          ) : null}
        </div>

        <StatusDetail status={status} todayDay={todayDay} now={now} />
      </div>
    </Card>
  );
}
