"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAcademicContext } from "@/components/layout/AcademicProvider";
import { TimetableDaySection } from "./TimetableDaySection";
import { TimetableSummary } from "./TimetableSummary";
import { TimetableTodayPanel } from "./TimetableTodayPanel";
import { DateSubstitutionsPanel } from "./DateSubstitutionsPanel";
import {
  formatNavigationWeekLabel,
  TimetableWeekNavigation,
} from "./TimetableWeekNavigation";
import { useMyTimetable } from "./useMyTimetable";
import { WorkloadTimetableGrid } from "@/features/workload/WorkloadTimetableGrid";
import {
  countWeekClasses,
  getTodayDayCode,
  getWeekDates,
  hasActiveAcademicFilters,
  linkedAccountMessage,
  WEEK_DAY_CODES,
} from "./utils";

const PAGE_DESCRIPTION = "Your published teaching schedule for the selected week.";

function TimetableSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-16 rounded-lg border border-border bg-card" />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-24 rounded-lg border border-border bg-card" />
        ))}
      </div>
      <div className="h-36 rounded-lg border border-border bg-card" />
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-56 rounded-lg border border-border bg-card" />
        ))}
      </div>
    </div>
  );
}

export function MyTimetableView() {
  const { filters } = useAcademicContext();
  const { payload, loading, error, reload } = useMyTimetable();
  const [weekOffset, setWeekOffset] = useState(0);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const weekDates = useMemo(() => getWeekDates(weekOffset), [weekOffset]);
  const todayCode = getTodayDayCode();
  const isCurrentWeek = weekOffset === 0;
  const filtersActive = hasActiveAcademicFilters(filters);

  const todayDay = useMemo(
    () => payload?.weekDays.find((day) => day.dayOfWeek === todayCode),
    [payload?.weekDays, todayCode],
  );

  const classesToday = todayDay?.classCount ?? 0;
  const weekClassCount = payload ? countWeekClasses(payload.weekDays) : 0;

  if (loading) {
    return (
      <div>
        <PageHeader title="My Timetable" description={PAGE_DESCRIPTION} />
        <TimetableSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="My Timetable" description={PAGE_DESCRIPTION} />
        <EmptyState
          title="Unable to load timetable"
          description="We couldn't retrieve your published timetable. Please try again."
          action={
            <Button type="button" size="sm" onClick={() => void reload()}>
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  if (!payload?.linked) {
    return (
      <div>
        <PageHeader title="My Timetable" description={PAGE_DESCRIPTION} />
        <EmptyState
          title="Account not linked"
          description={linkedAccountMessage(payload)}
        />
      </div>
    );
  }

  if (!payload.published) {
    return (
      <div>
        <PageHeader title="My Timetable" description={PAGE_DESCRIPTION} />
        <EmptyState
          title="No published timetable available"
          description={
            filtersActive
              ? "No classes match the current academic filters. Try adjusting the filters above or contact your HOD if you believe this is incorrect."
              : "Your timetable has not been assigned or published yet. Contact your HOD or academic administrator if you believe this is incorrect."
          }
        />
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <PageHeader
        title="My Timetable"
        description={PAGE_DESCRIPTION}
        actions={<StatusBadge status="Published" />}
      />

      <div className="mb-4">
        <TimetableWeekNavigation
          weekLabel={formatNavigationWeekLabel(weekDates.start, weekDates.end)}
          onPrevious={() => setWeekOffset((value) => value - 1)}
          onNext={() => setWeekOffset((value) => value + 1)}
          onToday={() => setWeekOffset(0)}
          isCurrentWeek={isCurrentWeek}
        />
      </div>

      {payload.summary ? (
        <div className="mb-4">
          <TimetableSummary
            classesToday={classesToday}
            periodsThisWeek={payload.summary.periodsThisWeek}
            theory={payload.summary.theory}
            lab={payload.summary.lab}
          />
        </div>
      ) : null}

      {isCurrentWeek ? (
        <>
          <TimetableTodayPanel
            todayDay={todayDay}
            classesToday={classesToday}
            todayCode={todayCode}
            now={now}
          />
          <DateSubstitutionsPanel sessionDate={now.toISOString().slice(0, 10)} />
        </>
      ) : null}

      {payload.timetable ? (
        <div className="mb-4">
          <WorkloadTimetableGrid timetable={payload.timetable} />
        </div>
      ) : null}

      {weekClassCount === 0 ? (
        <EmptyState
          title="No classes scheduled for this week"
          description={
            filtersActive
              ? "No classes match the current academic filters for this weekly schedule."
              : "Your published timetable does not include any classes for the selected week."
          }
          className="mb-4"
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {WEEK_DAY_CODES.map((code) => {
            const day = payload.weekDays.find((item) => item.dayOfWeek === code);
            if (!day) return null;
            const date = weekDates.byDayCode[code]!;
            return (
              <TimetableDaySection
                key={code}
                day={day}
                date={date}
                isToday={isCurrentWeek && code === todayCode}
                compact
              />
            );
          })}
        </div>
      )}

      <p className="mt-4 text-center text-xs text-slate-400">
        Read-only view of your published teaching schedule.
      </p>
    </div>
  );
}
