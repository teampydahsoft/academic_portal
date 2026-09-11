"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useAuth } from "@/components/auth/AuthProvider";
import { AttendanceAnalyticsView } from "@/features/attendance-analytics/AttendanceAnalyticsView";
import { StaffWorkloadView } from "@/features/workload/StaffWorkloadView";
import { useAcademicContext } from "@/components/layout/AcademicProvider";
import { apiFetch } from "@/lib/api";
import { ChevronRight, Printer } from "lucide-react";
import { cn } from "@/lib/cn";
import { escapeHtml, printElement, printHtml } from "@/lib/print-service";
import {
  classPeriodCellClass,
  emptyPeriodCellClass,
  isNonClassTimingSlot,
  specialPeriodCellClass,
  timingSlotCellClass,
  timingSlotDisplayLabel,
} from "@/features/timetables/timing-slot-utils";

import { useSearchParams } from "next/navigation";

type ReportKey =
  "department-timetables" | "staff-timetables" | "student-analytics";

type ReportDef = {
  key: ReportKey;
  title: string;
  permissions: string[];
};

const REPORT_TABS: ReportDef[] = [
  {
    key: "department-timetables",
    title: "Department-wise timetable reports",
    permissions: ["timetable.view"],
  },
  {
    key: "staff-timetables",
    title: "Staff timetable reports",
    permissions: ["workload.view"],
  },
  {
    key: "student-analytics",
    title: "Student analytics reports",
    permissions: ["attendance_analytics.view"],
  },
];

export function ReportsView() {
  const { hasAnyPermission } = useAuth();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab") as ReportKey | null;

  const [selectedKey, setSelectedKey] = useState<ReportKey | null>(null);

  useEffect(() => {
    if (tabParam && REPORT_TABS.some((t) => t.key === tabParam)) {
      setSelectedKey(tabParam);
    }
  }, [tabParam]);

  const visibleTabs = useMemo(
    () => REPORT_TABS.filter((tab) => hasAnyPermission(...tab.permissions)),
    [hasAnyPermission],
  );

  const activeTab =
    visibleTabs.find((tab) => tab.key === selectedKey) ?? visibleTabs[0];

  function renderActiveReport() {
    if (!activeTab) return null;
    if (activeTab.key === "department-timetables")
      return <DepartmentTimetableReport />;
    if (activeTab.key === "staff-timetables")
      return <StaffWorkloadView embedded />;
    return <AttendanceAnalyticsView embedded />;
  }

  const pageTitle = activeTab ? activeTab.title : "Reports";

  return (
    <div>
      <PageHeader
        title={pageTitle}
        description="Live reports from the selected academic scope."
      />

      {visibleTabs.length === 0 ? (
        <EmptyState
          title="No reports available"
          description="You do not have permission to any report modules in the current role."
        />
      ) : (
        <div>
          {activeTab ? (
            <div className="mt-2">{renderActiveReport()}</div>
          ) : null}
        </div>
      )}
    </div>
  );
}

type TimetableReportRow = {
  planId: number;
  collegeId: number;
  courseId: number;
  branchId: number;
  batch: string;
  section: string | null;
  status: string;
  day: string | null;
  slotId: number | null;
  label: string;
  subjectName: string | null;
  room: string | null;
  slotLabel: string | null;
  startTime: string | null;
  endTime: string | null;
  slotType: string | null;
  slotOrder: number | null;
  facultyName: string | null;
};

function DepartmentTimetableReport() {
  const { masters } = useAcademicContext();
  const [academicYear, setAcademicYear] = useState("");
  const [selectedCollege, setSelectedCollege] = useState<number | null>(null);
  const [selectedCourse, setSelectedCourse] = useState<number | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<number | null>(null);
  const [selectedBatch, setSelectedBatch] = useState<string | null>(null);
  const [rows, setRows] = useState<TimetableReportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);
  const batchRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (masters && !academicYear) {
      const currentYear =
        masters.defaults.academicYear ||
        masters.academicYears.find((item) => item.isActive)?.label;
      if (currentYear) setAcademicYear(currentYear);
    }
  }, [masters, academicYear]);

  useEffect(() => {
    let cancelled = false;
    async function loadRows() {
      if (!academicYear) {
        setRows([]);
        return;
      }
      setLoading(true);
      try {
        const params = new URLSearchParams({ academicYear });
        const response = await apiFetch(`/timetables/report?${params}`, {
          cache: "no-store",
        });
        const data = response.ok
          ? (((await response.json()) as { data?: TimetableReportRow[] })
              .data ?? [])
          : [];
        if (!cancelled) setRows(data);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadRows();
    return () => {
      cancelled = true;
    };
  }, [academicYear]);

  const colleges = useMemo(
    () =>
      masters?.colleges.filter((college) =>
        rows.some((row) => row.collegeId === college.id),
      ) ?? [],
    [masters, rows],
  );
  const courses = useMemo(
    () =>
      masters?.courses.filter((course) =>
        rows.some(
          (row) =>
            (selectedCollege == null || row.collegeId === selectedCollege) &&
            row.courseId === course.id,
        ),
      ) ?? [],
    [masters, rows, selectedCollege],
  );
  const branches = useMemo(
    () =>
      masters?.branches.filter((branch) =>
        rows.some(
          (row) =>
            (selectedCollege == null || row.collegeId === selectedCollege) &&
            (selectedCourse == null || row.courseId === selectedCourse) &&
            row.branchId === branch.id,
        ),
      ) ?? [],
    [masters, rows, selectedCollege, selectedCourse],
  );
  const timetableRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          (selectedCollege == null || row.collegeId === selectedCollege) &&
          (selectedCourse == null || row.courseId === selectedCourse) &&
          row.branchId === selectedBranch &&
          (selectedBatch == null || row.batch === selectedBatch),
      ),
    [rows, selectedCollege, selectedCourse, selectedBranch, selectedBatch],
  );
  const timetableBatches = useMemo(
    () =>
      Array.from(new Set(timetableRows.map((row) => row.batch))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [timetableRows],
  );
  const timetableDays = ["MON", "TUE", "WED", "THUR", "FRI", "SAT", "SUN"];
  const batches = useMemo(
    () =>
      Array.from(
        new Set(
          rows
            .filter(
              (row) =>
                (selectedCollege == null ||
                  row.collegeId === selectedCollege) &&
                (selectedCourse == null || row.courseId === selectedCourse) &&
                (selectedBranch == null || row.branchId === selectedBranch),
            )
            .map((row) => row.batch),
        ),
      ).sort(),
    [rows, selectedCollege, selectedCourse, selectedBranch],
  );
  const branchStats = useMemo(() => {
    const availableBatches = masters?.batches ?? [];
    return branches.map((branch) => {
      const expected = new Set(
        availableBatches
          .filter((item) => item.branchId === branch.id)
          .map((item) => item.batch),
      );
      const configured = new Set(
        rows
          .filter((row) => row.branchId === branch.id)
          .map((row) => row.batch),
      );
      const expectedCount = expected.size || configured.size;
      return {
        branch,
        configured: configured.size,
        notConfigured: Math.max(0, expectedCount - configured.size),
      };
    });
  }, [branches, masters?.batches, rows]);

  const scopeName = (
    id: number | null,
    items: Array<{ id: number; name: string }>,
    fallback: string,
  ) => items.find((item) => item.id === id)?.name ?? fallback;

  function printSelectedTables() {
    const selectedCourses = selectedCourse
      ? (masters?.courses ?? []).filter((course) => course.id === selectedCourse)
      : courses;
    const content = selectedCourses
      .map(
        (course) =>
          `<h2 class="course-title">${escapeHtml(course.name)}</h2>${buildCoursePrintHtml(selectedCollege, course.id, selectedBranch, selectedBatch)}`,
      )
      .join("");
    if (!content) return;

    const collegeName = scopeName(
      selectedCollege,
      masters?.colleges ?? [],
      "All colleges",
    );
    const courseName = scopeName(
      selectedCourse,
      masters?.courses ?? [],
      "All courses",
    );
    const branchName = scopeName(
      selectedBranch,
      masters?.branches ?? [],
      "All branches",
    );
    printHtml(content, {
      title: "Department-wise timetable report",
      subtitle: [
        academicYear,
        collegeName,
        courseName,
        branchName,
        selectedBatch ?? "All batches",
      ].join(" · "),
    });
  }

  function buildCoursePrintHtml(
    collegeId: number | null,
    courseId: number,
    branchId: number | null = null,
    batchFilter: string | null = null,
  ) {
    const courseRows = rows.filter(
      (row) =>
        row.courseId === courseId &&
        (collegeId == null || row.collegeId === collegeId) &&
        (branchId == null || row.branchId === branchId) &&
        (batchFilter == null || row.batch === batchFilter),
    );
    const slotKey = (row: TimetableReportRow) =>
      String(
        row.slotOrder ??
          row.slotId ??
          `${row.slotLabel ?? ""}|${row.startTime ?? ""}|${row.endTime ?? ""}`,
      );
    const groups = new Map<string, TimetableReportRow[]>();
    for (const row of courseRows) {
      const key = `${row.branchId}:${row.batch}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    return Array.from(groups.entries())
      .map(([key, batchRows]) => {
        const [branchId, batch] = key.split(":");
        const periods = Array.from(
          new Map(
            batchRows
              .filter((row) => row.slotId != null)
              .map((row) => [slotKey(row), row]),
          ).values(),
        ).sort(
          (a, b) =>
            (a.slotOrder ?? a.slotId ?? 0) - (b.slotOrder ?? b.slotId ?? 0),
        );
        const branchName =
          masters?.branches.find((branch) => branch.id === Number(branchId))
            ?.name ?? `Branch ${branchId}`;
        const header = periods
          .map(
            (period) =>
              `<th>${escapeHtml(period.slotLabel || `P${period.slotId}`)}<br><small>${escapeHtml(`${period.startTime?.slice(0, 5) ?? ""}-${period.endTime?.slice(0, 5) ?? ""}`)}</small></th>`,
          )
          .join("");
        const body = ["MON", "TUE", "WED", "THUR", "FRI", "SAT", "SUN"]
          .map((day) => {
            const cells = periods
              .map((period) => {
                const slotRows = batchRows.filter(
                  (row) => row.day === day && slotKey(row) === slotKey(period),
                );
                const slotType = period.slotType ?? "CLASS";
                const emptyLabel =
                  slotType === "LUNCH"
                    ? "Lunch Break"
                    : slotType === "BREAK"
                      ? "Break"
                      : slotType === "ACTIVITY"
                        ? period.slotLabel
                        : "Free";
                if (!slotRows.length) {
                  return `<td class="${emptyLabel === "Free" ? "empty-cell" : "break-cell"}">${escapeHtml(emptyLabel ?? "Free")}</td>`;
                }
                return `<td>${slotRows
                  .map(
                    (row) =>
                      `<div class="${row.subjectName ? "subject-cell" : "special-cell"}"><strong>${escapeHtml(row.subjectName || row.label)}</strong><br><small>${escapeHtml(row.label)}${row.facultyName ? ` · ${escapeHtml(row.facultyName)}` : ""}${row.room ? ` · Room ${escapeHtml(row.room)}` : ""}</small></div>`,
                  )
                  .join("")}</td>`;
              })
              .join("");
            return `<tr><th>${day}</th>${cells}</tr>`;
          })
          .join("");
        return `<section class="batch-section"><div class="batch-title">${escapeHtml(branchName)} · Batch ${escapeHtml(batch)}</div><table class="batch-table"><thead><tr><th style="width:6%">Day</th>${header}</tr></thead><tbody>${body}</tbody></table></section>`;
      })
      .join("");
  }

  function printScoped(scope: {
    college?: number | null;
    course?: number | null;
    branch?: number | null;
    batch?: string | null;
  }) {
    if (scope.course != null) {
      const collegeName = scopeName(
        scope.college ?? null,
        masters?.colleges ?? [],
        "All colleges",
      );
      const courseName = scopeName(scope.course, masters?.courses ?? [], "Course");
      const branchName = scopeName(
        scope.branch ?? null,
        masters?.branches ?? [],
        "All branches",
      );
      const isBranchPrint = scope.branch != null;
      printHtml(
        buildCoursePrintHtml(
          scope.college ?? null,
          scope.course,
          scope.branch ?? null,
          scope.batch ?? null,
        ),
        {
        title: isBranchPrint ? "Branch timetable report" : "Course timetable report",
        subtitle: [
          academicYear,
          collegeName,
          courseName,
          branchName,
          scope.batch ?? "All batches",
        ].join(" · "),
      });
      return;
    }
    const collegeCourses = (masters?.courses ?? []).filter((course) =>
      rows.some(
        (row) =>
          row.courseId === course.id &&
          (scope.college == null || row.collegeId === scope.college),
      ),
    );
    const content = collegeCourses
      .map(
        (course) =>
          `<h2 class="course-title">${escapeHtml(course.name)}</h2>${buildCoursePrintHtml(scope.college ?? null, course.id, scope.branch ?? null, scope.batch ?? null)}`,
      )
      .join("");
    if (!content) return;

    printHtml(content, {
      title: "College timetable report",
      subtitle: [
        academicYear,
        scopeName(scope.college ?? null, masters?.colleges ?? [], "All colleges"),
        scopeName(scope.branch ?? null, masters?.branches ?? [], "All branches"),
        scope.batch ?? "All batches",
      ].join(" · "),
    });
  }

  function renderTimetableMatrix(batch: string) {
    const batchRows = timetableRows.filter((row) => row.batch === batch);
    const slotKey = (row: TimetableReportRow) =>
      String(
        row.slotOrder ??
          row.slotId ??
          `${row.slotLabel ?? ""}|${row.startTime ?? ""}|${row.endTime ?? ""}`,
      );
    const batchPeriods = Array.from(
      new Map(
        batchRows
          .filter((row) => row.slotId != null)
          .map((row) => [slotKey(row), row]),
      ).values(),
    ).sort(
      (a, b) => (a.slotOrder ?? a.slotId ?? 0) - (b.slotOrder ?? b.slotId ?? 0),
    );
    const getSlot = (period: TimetableReportRow) => ({
      slotType: period.slotType ?? "CLASS",
      label: period.slotLabel || `P${period.slotId}`,
      startTime: period.startTime ?? "",
      endTime: period.endTime ?? "",
    });
    return (
      <div
        key={batch}
        ref={(element) => {
          batchRefs.current[batch] = element;
        }}
        className="space-y-1.5"
      >
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-navy-900">Batch {batch}</h4>
          <button
            type="button"
            aria-label={`Print batch ${batch}`}
            title={`Print batch ${batch}`}
            className="print:hidden inline-flex h-6 w-6 items-center justify-center rounded border border-border text-navy-800 hover:bg-slate-100"
            onClick={() => {
              const element = batchRefs.current[batch];
              if (element)
                printElement(element, {
                  title: "Batch timetable report",
                  subtitle: [academicYear, batch].join(" · "),
                });
            }}
          ><Printer className="h-3.5 w-3.5" /></button>
        </div>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[980px] table-fixed border-collapse text-sm">
            <colgroup>
              <col style={{ width: "5.5rem" }} />
              {batchPeriods.map((period) => (
                <col key={slotKey(period)} />
              ))}
            </colgroup>
            <thead>
              <tr className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                <th className="border-b border-r border-border px-1.5 py-1.5 text-left">
                  Day
                </th>
                {batchPeriods.map((period) => {
                  const slot = getSlot(period);
                  const nonClass = isNonClassTimingSlot(slot);
                  return (
                    <th
                      key={slotKey(period)}
                      className="border-b border-r border-border px-1.5 py-1.5 text-center"
                    >
                      <div className="truncate">
                        {nonClass ? timingSlotDisplayLabel(slot) : slot.label}
                      </div>
                      <div className="truncate text-[8px] font-normal normal-case text-slate-400">
                        {nonClass ? `${slot.label} · ` : ""}
                        {slot.startTime.slice(0, 5)}–{slot.endTime.slice(0, 5)}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {timetableDays.map((day) => (
                <tr key={day}>
                  <td className="border-b border-r border-border px-1.5 py-1.5 text-[11px] font-medium text-navy-900">
                    {day}
                  </td>
                  {batchPeriods.map((period) => {
                    const slot = getSlot(period);
                    const periodKey = slotKey(period);
                    const cellRows = batchRows.filter(
                      (row) => row.day === day && slotKey(row) === periodKey,
                    );
                    const nonClass = isNonClassTimingSlot(slot);
                    return (
                      <td
                        key={`${day}-${periodKey}`}
                        className="border-b border-r border-border p-0.5 align-top text-center"
                      >
                        {nonClass ? (
                          <div
                            className={cn(
                              "flex h-full min-h-[56px] flex-col items-center justify-center rounded px-0.5 text-center text-[10px] font-semibold",
                              timingSlotCellClass(slot),
                            )}
                          >
                            <span>{timingSlotDisplayLabel(slot)}</span>
                            <span className="text-[8px] font-normal opacity-80">
                              {slot.startTime.slice(0, 5)}–
                              {slot.endTime.slice(0, 5)}
                            </span>
                          </div>
                        ) : cellRows.length ? (
                          cellRows.map((row) => (
                            <div
                              key={`${row.planId}-${row.slotId}`}
                              className={cn(
                                "flex min-h-[56px] h-full w-full flex-col justify-between overflow-hidden rounded border px-1 py-1 text-left",
                                row.subjectName
                                  ? classPeriodCellClass()
                                  : specialPeriodCellClass(),
                              )}
                            >
                              <div>
                                <p className="line-clamp-2 text-[10px] font-bold leading-tight text-navy-900">
                                  {row.subjectName || row.label}
                                </p>
                                <p className="mt-0.5 truncate text-[8px] font-mono text-slate-500">
                                  {row.label}
                                </p>
                              </div>
                              <div className="space-y-0.5 text-[8px] text-slate-600">
                                {row.facultyName ? (
                                  <p className="truncate">{row.facultyName}</p>
                                ) : null}
                                {row.room ? (
                                  <p className="text-slate-500">
                                    Room {row.room}
                                  </p>
                                ) : null}
                              </div>
                            </div>
                          ))
                        ) : (
                          <div
                            className={cn(
                              "flex min-h-[56px] h-full items-center justify-center rounded border text-[10px] font-medium",
                              emptyPeriodCellClass(),
                            )}
                          >
                            <span className="text-slate-400">Free</span>
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div ref={reportRef} className="space-y-4 print:text-black">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <label className="text-sm text-slate-600">
          Academic Year
          <select
            value={academicYear}
            onChange={(event) => {
              setAcademicYear(event.target.value);
              setSelectedCollege(null);
              setSelectedCourse(null);
              setSelectedBranch(null);
            }}
            className="mt-1 block h-9 rounded-md border border-border bg-white px-2 text-sm"
          >
            <option value="">Select academic year</option>
            {masters?.academicYears.map((item) => (
              <option key={item.label}>{item.label}</option>
            ))}
          </select>
        </label>
        <label className="text-sm text-slate-600">
          College
          <select
            value={selectedCollege ?? ""}
            onChange={(event) => {
              setSelectedCollege(
                event.target.value ? Number(event.target.value) : null,
              );
              setSelectedCourse(null);
              setSelectedBranch(null);
              setSelectedBatch(null);
            }}
            className="mt-1 block h-9 rounded-md border border-border bg-white px-2 text-sm"
          >
            <option value="">All colleges</option>
            {masters?.colleges.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-slate-600">
          Course
          <select
            value={selectedCourse ?? ""}
            onChange={(event) => {
              setSelectedCourse(
                event.target.value ? Number(event.target.value) : null,
              );
              setSelectedBranch(null);
              setSelectedBatch(null);
            }}
            className="mt-1 block h-9 rounded-md border border-border bg-white px-2 text-sm"
          >
            <option value="">All courses</option>
            {courses.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-slate-600">
          Branch
          <select
            value={selectedBranch ?? ""}
            onChange={(event) => {
              setSelectedBranch(
                event.target.value ? Number(event.target.value) : null,
              );
              setSelectedBatch(null);
            }}
            className="mt-1 block h-9 rounded-md border border-border bg-white px-2 text-sm"
          >
            <option value="">All branches</option>
            {branches.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-slate-600">
          Batch
          <select
            value={selectedBatch ?? ""}
            onChange={(event) => setSelectedBatch(event.target.value || null)}
            className="mt-1 block h-9 rounded-md border border-border bg-white px-2 text-sm"
          >
            <option value="">All batches</option>
            {batches.map((batch) => (
              <option key={batch}>{batch}</option>
            ))}
          </select>
        </label>
        <Button size="sm" variant="secondary" onClick={printSelectedTables}>
          <Printer className="mr-1 h-4 w-4" />
          Print selected tables
        </Button>
      </div>
      {!academicYear ? (
        <EmptyState
          title="Select an academic year"
          description="Choose an academic year to view colleges and their timetable coverage."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">College</th>
                <th className="px-3 py-3 print:hidden">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={2}
                    className="px-4 py-6 text-center text-slate-500"
                  >
                    Loading colleges...
                  </td>
                </tr>
              ) : (
                colleges.map((college) => (
                  <Fragment key={college.id}>
                    <tr
                      className="cursor-pointer border-t border-border hover:bg-slate-50"
                      onClick={() => {
                        setSelectedCollege(
                          selectedCollege === college.id ? null : college.id,
                        );
                        setSelectedCourse(null);
                        setSelectedBranch(null);
                      }}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 font-medium text-navy-900">
                          <ChevronRight
                            className={`h-4 w-4 transition-transform ${selectedCollege === college.id ? "rotate-90" : ""}`}
                          />
                          {college.name}
                        </div>
                      </td>
                      <td className="px-3 py-3 print:hidden">
                        <button
                          type="button"
                          aria-label={`Print ${college.name} timetable`}
                          title={`Print ${college.name} timetable`}
                          className="inline-flex h-7 w-7 items-center justify-center rounded border border-border text-navy-800 hover:bg-slate-100"
                          onClick={(event) => {
                            event.stopPropagation();
                            printScoped({ college: college.id });
                          }}
                        >
                          <Printer className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                    {selectedCollege === college.id ? (
                      <tr>
                        <td colSpan={2} className="bg-slate-50 px-6 py-4">
                          <div className="space-y-3">
                            <div className="text-xs font-semibold uppercase text-slate-500">
                              Courses
                            </div>
                            {courses.map((course) => (
                              <div
                                key={course.id}
                                className="overflow-hidden rounded-md border border-border bg-white"
                              >
                                <button
                                  type="button"
                                  className="flex w-full items-center gap-2 px-4 py-3 text-left font-medium text-navy-900 hover:bg-slate-50"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setSelectedCourse(
                                      selectedCourse === course.id
                                        ? null
                                        : course.id,
                                    );
                                    setSelectedBranch(null);
                                  }}
                                >
                                  <ChevronRight
                                    className={`h-4 w-4 transition-transform ${selectedCourse === course.id ? "rotate-90" : ""}`}
                                  />
                                  {course.name}
                                  <span
                                    role="button"
                                    tabIndex={0}
                                    aria-label={`Print ${course.name} timetable`}
                                    title={`Print ${course.name} timetable`}
                                    className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded border border-border text-navy-800 hover:bg-slate-100 print:hidden"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      printScoped({
                                        college: selectedCollege,
                                        course: course.id,
                                      });
                                    }}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter" || event.key === " ") {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        printScoped({
                                          college: selectedCollege,
                                          course: course.id,
                                        });
                                      }
                                    }}
                                  >
                                    <Printer className="h-3.5 w-3.5" />
                                  </span>
                                </button>
                                {selectedCourse === course.id ? (
                                  <div className="border-t border-border px-4 py-3">
                                    <div className="mb-2 text-xs font-semibold uppercase text-slate-500">
                                      Branches
                                    </div>
                                    <div className="overflow-hidden rounded-md border border-border bg-white">
                                      <table className="w-full text-left text-xs">
                                        <thead className="bg-slate-100 text-[10px] uppercase text-slate-500">
                                          <tr>
                                            <th className="px-3 py-2">
                                              Branch
                                            </th>
                                            <th className="px-3 py-2 text-center">
                                              Configured
                                            </th>
                                            <th className="px-3 py-2 text-center">
                                              Not configured
                                            </th>
                                            <th className="px-3 py-2 text-center print:hidden">
                                              Action
                                            </th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {branchStats.map(
                                            ({
                                              branch,
                                              configured,
                                              notConfigured,
                                            }) => (
                                              <tr
                                                key={branch.id}
                                                className="cursor-pointer border-t border-border hover:bg-slate-50"
                                                onClick={(event) => {
                                                  event.stopPropagation();
                                                  setSelectedBranch(
                                                    selectedBranch === branch.id
                                                      ? null
                                                      : branch.id,
                                                  );
                                                }}
                                              >
                                                <td className="px-3 py-2 font-medium text-navy-900">
                                                  <span className="flex items-center gap-2">
                                                    <ChevronRight
                                                      className={`h-3.5 w-3.5 transition-transform ${selectedBranch === branch.id ? "rotate-90" : ""}`}
                                                    />
                                                    {branch.name}
                                                  </span>
                                                </td>
                                                <td className="px-3 py-2 text-center text-emerald-700">
                                                  {configured}
                                                </td>
                                                <td className="px-3 py-2 text-center text-rose-700">
                                                  {notConfigured}
                                                </td>
                                                <td className="px-3 py-2 text-center print:hidden">
                                                  <button
                                                    type="button"
                                                    aria-label={`Print ${branch.name} timetable`}
                                                    title={`Print ${branch.name} timetable`}
                                                    className="inline-flex h-6 w-6 items-center justify-center rounded border border-border text-navy-800 hover:bg-slate-100"
                                                    onClick={(event) => {
                                                      event.stopPropagation();
                                                      printScoped({
                                                        college: selectedCollege,
                                                        course: selectedCourse,
                                                        branch: branch.id,
                                                      });
                                                    }}
                                                  >
                                                    <Printer className="h-3.5 w-3.5" />
                                                  </button>
                                                </td>
                                              </tr>
                                            ),
                                          )}
                                        </tbody>
                                      </table>
                                    </div>
                                    {selectedBranch === null ? null : (
                                      <div className="mt-3 space-y-4">
                                        {timetableBatches.map((batch) =>
                                          renderTimetableMatrix(batch),
                                        )}
                                      </div>
                                    )}
                                  </div>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))
              )}
              {!loading && colleges.length === 0 ? (
                <tr>
                  <td
                    colSpan={2}
                    className="px-4 py-6 text-center text-slate-500"
                  >
                    No timetable data found for this academic year.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
