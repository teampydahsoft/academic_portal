"use client";

import { useMemo } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Printer } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  isNonClassTimingSlot,
  timingSlotCellClass,
  timingSlotDisplayLabel,
} from "@/features/timetables/timing-slot-utils";

type TimingSlot = {
  id: number;
  label: string;
  startTime: string;
  endTime: string;
  slotType: string;
  isAssignable: boolean;
};

type GridCell =
  | {
      kind: "class";
      branchName: string | null;
      year: number | null;
      semester: number | null;
      subjectName: string | null;
      entryType: string;
    }
  | { kind: "break"; label: string }
  | null;

export type FacultyTimetable = {
  timingTemplateId: number;
  timingTemplateName: string | null;
  periodsPerWeek: number;
  days: string[];
  headerSlots: TimingSlot[];
  slotsByDay: Record<string, TimingSlot[]>;
  grid: Record<string, Record<number, GridCell>>;
};

function formatClassCell(cell: Extract<GridCell, { kind: "class" }>) {
  const branch = cell.branchName?.trim() || "Branch";
  const year = cell.year != null ? `Year ${cell.year}` : null;
  const semester = cell.semester != null ? `Sem ${cell.semester}` : null;
  return {
    title: branch,
    subtitle: [year, semester].filter(Boolean).join(" · "),
  };
}

function slotMinutes(startTime: string, endTime: string) {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  if (![sh, sm, eh, em].every(Number.isFinite)) return 0;
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  return end > start ? end - start : 0;
}

function roundHours(minutes: number) {
  return Math.round((minutes / 60) * 10) / 10;
}

function formatPeriodHours(periods: number, minutes: number) {
  const hours = roundHours(minutes);
  const periodLabel = `${periods} period${periods === 1 ? "" : "s"}`;
  return hours > 0 ? `${periodLabel} · ${hours} hrs` : periodLabel;
}

function findMatchingSlot(daySlots: TimingSlot[], headerSlot: TimingSlot) {
  return (
    daySlots.find(
      (item) =>
        item.label === headerSlot.label && item.startTime === headerSlot.startTime,
    ) ?? null
  );
}

export function WorkloadTimetableGrid({ timetable }: { timetable: FacultyTimetable }) {
  const { dayTotals, columnTotals, weekTotal } = useMemo(() => {
    const dayTotals = timetable.days.map((day) => {
      const daySlots = timetable.slotsByDay[day] ?? [];
      let periods = 0;
      let minutes = 0;
      for (const slot of daySlots) {
        const cell = timetable.grid[day]?.[slot.id];
        if (cell?.kind !== "class") continue;
        periods += 1;
        minutes += slotMinutes(slot.startTime, slot.endTime);
      }
      return { day, periods, minutes };
    });

    const columnTotals = timetable.headerSlots.map((headerSlot) => {
      let periods = 0;
      let minutes = 0;
      for (const day of timetable.days) {
        const slot = findMatchingSlot(timetable.slotsByDay[day] ?? [], headerSlot);
        if (!slot) continue;
        const cell = timetable.grid[day]?.[slot.id];
        if (cell?.kind !== "class") continue;
        periods += 1;
        minutes += slotMinutes(slot.startTime, slot.endTime);
      }
      return { slotId: headerSlot.id, periods, minutes };
    });

    const weekTotal = dayTotals.reduce(
      (acc, day) => ({
        periods: acc.periods + day.periods,
        minutes: acc.minutes + day.minutes,
      }),
      { periods: 0, minutes: 0 },
    );

    return { dayTotals, columnTotals, weekTotal };
  }, [timetable]);

  const dayTotalByDay = useMemo(
    () => new Map(dayTotals.map((item) => [item.day, item])),
    [dayTotals],
  );
  const columnTotalBySlot = useMemo(
    () => new Map(columnTotals.map((item) => [item.slotId, item])),
    [columnTotals],
  );

  return (
    <Card className="mb-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-navy-900">Weekly teaching schedule</h3>
          <p className="text-sm text-slate-500">
            {timetable.timingTemplateName
              ? `Timing: ${timetable.timingTemplateName}`
              : "Published college timing slots"}
            {" · "}
            {timetable.periodsPerWeek} period
            {timetable.periodsPerWeek === 1 ? "" : "s"} / week across all branches
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => window.print()} className="print:hidden">
          <Printer className="mr-2 h-4 w-4" /> Download PDF
        </Button>
      </div>

      <div className="overflow-x-auto print:overflow-visible print:border-0 rounded-lg border border-border bg-card">
        <table className="w-full min-w-[980px] print:min-w-full table-fixed border-collapse text-sm">
          <colgroup>
            <col style={{ width: "5.5rem" }} />
            {timetable.headerSlots.map((slot) => (
              <col key={slot.id} />
            ))}
            <col style={{ width: "6.5rem" }} />
          </colgroup>
          <thead>
            <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <th className="border-b border-border px-2 py-2 text-left">Day</th>
              {timetable.headerSlots.map((slot) => {
                const nonClass = isNonClassTimingSlot(slot);
                return (
                  <th key={slot.id} className="border-b border-border px-2 py-2 text-center">
                    <div className="truncate">
                      {nonClass ? timingSlotDisplayLabel(slot) : slot.label}
                    </div>
                    <div className="truncate font-normal normal-case text-[10px] text-slate-400">
                      {nonClass ? slot.label : null}
                      {nonClass ? " · " : null}
                      {slot.startTime}–{slot.endTime}
                    </div>
                  </th>
                );
              })}
              <th className="border-b border-border bg-slate-100 px-2 py-2 text-center">
                Day total
              </th>
            </tr>
          </thead>
          <tbody>
            {timetable.days.map((day) => {
              const daySlots = timetable.slotsByDay[day] ?? [];
              const dayTotal = dayTotalByDay.get(day);
              return (
                <tr key={day}>
                  <td className="border-b border-border px-2 py-2 font-medium text-navy-900">
                    {day}
                  </td>
                  {timetable.headerSlots.map((headerSlot) => {
                    const slot = findMatchingSlot(daySlots, headerSlot);

                    if (!slot) {
                      return (
                        <td
                          key={`${day}-${headerSlot.id}`}
                          className="border-b border-border bg-slate-50/60 p-1.5"
                        />
                      );
                    }

                    const cell = timetable.grid[day]?.[slot.id] ?? null;

                    if (cell?.kind === "break") {
                      return (
                        <td key={`${day}-${slot.id}`} className="border-b border-border p-1.5">
                          <div
                            className={cn(
                              "flex h-24 flex-col items-center justify-center rounded-md text-xs font-semibold",
                              timingSlotCellClass(slot),
                            )}
                          >
                            <span>{cell.label}</span>
                            <span className="mt-0.5 text-[10px] font-normal opacity-80">
                              {slot.startTime}–{slot.endTime}
                            </span>
                          </div>
                        </td>
                      );
                    }

                    const classCell =
                      cell?.kind === "class" ? formatClassCell(cell) : null;

                    return (
                      <td key={`${day}-${slot.id}`} className="border-b border-border p-1.5">
                        <div
                          className={cn(
                            "h-24 w-full rounded-md border px-2 py-1.5 text-left",
                            classCell
                              ? "border-border bg-blue-50/70"
                              : "border-border bg-slate-50",
                          )}
                        >
                          {classCell ? (
                            <>
                              <p className="line-clamp-2 font-semibold leading-snug text-navy-900">
                                {classCell.title}
                              </p>
                              {classCell.subtitle ? (
                                <p className="text-xs text-slate-600">{classCell.subtitle}</p>
                              ) : null}
                              {cell?.kind === "class" && cell.subjectName ? (
                                <p className="mt-1 line-clamp-1 text-xs text-slate-500">
                                  {cell.subjectName}
                                  {cell.entryType ? ` · ${cell.entryType}` : ""}
                                </p>
                              ) : null}
                            </>
                          ) : (
                            <p className="text-xs text-slate-400">—</p>
                          )}
                        </div>
                      </td>
                    );
                  })}
                  <td className="border-b border-border bg-slate-50 px-3 py-2 text-sm font-medium text-navy-900">
                    {dayTotal && dayTotal.periods > 0
                      ? formatPeriodHours(dayTotal.periods, dayTotal.minutes)
                      : "—"}
                  </td>
                </tr>
              );
            })}
            <tr className="bg-slate-50">
              <td className="border-b border-border px-3 py-2 text-sm font-semibold text-navy-900">
                Total
              </td>
              {timetable.headerSlots.map((headerSlot) => {
                const total = columnTotalBySlot.get(headerSlot.id);
                return (
                  <td
                    key={`total-${headerSlot.id}`}
                    className="border-b border-border px-3 py-2 text-xs font-medium text-slate-600"
                  >
                    {total && total.periods > 0
                      ? formatPeriodHours(total.periods, total.minutes)
                      : "—"}
                  </td>
                );
              })}
              <td className="border-b border-border bg-navy-50 px-3 py-2 text-sm font-semibold text-navy-900">
                {formatPeriodHours(weekTotal.periods, weekTotal.minutes)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}
