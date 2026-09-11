"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { DataTable } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  MobileDataCardHeader,
  MobileDataCardGrid,
  MobileDataCardField,
} from "@/components/ui/MobileDataCard";
import { useAcademicContext } from "@/components/layout/AcademicProvider";
import { StudentAvatar } from "@/features/students/StudentAvatar";
import { StudentDetailDrawer } from "@/features/students/StudentDetailDrawer";
import type { StudentListRow } from "@/features/students/student-types";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";
import { LoadingAnimation } from "@/components/ui/LoadingAnimation";

export type StudentRow = StudentListRow;

type SortKey = "name" | "rollNo" | "attendance" | "risk";
type SortDir = "asc" | "desc";

const PAGE_SIZE = 50;

const RISK_RANK: Record<string, number> = {
  High: 3,
  Medium: 2,
  Low: 1,
};

function compareValues(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function yearSemLabel(row: StudentListRow) {
  if (row.year == null && row.semester == null) return "—";
  if (row.year != null && row.semester != null) return `${row.year}-${row.semester}`;
  if (row.year != null) return `Y${row.year}`;
  return `Sem ${row.semester}`;
}

function SortableHeader({
  label,
  active,
  direction,
  onToggle,
}: {
  label: string;
  active: boolean;
  direction: SortDir;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className={cn(
        "group inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 -mx-1",
        "text-left uppercase tracking-wide transition-colors",
        "hover:bg-slate-200/70 hover:text-navy-900 focus-visible:outline-none",
        "focus-visible:ring-2 focus-visible:ring-navy-700/30",
        active ? "text-navy-900" : "text-slate-500",
      )}
      aria-label={`Sort by ${label}`}
      title={
        active
          ? direction === "asc"
            ? `Sorted ${label} ascending — click for descending`
            : `Sorted ${label} descending — click for ascending`
          : `Sort by ${label}`
      }
    >
      <span>{label}</span>
      <span className="flex flex-col leading-none" aria-hidden>
        <ChevronUp
          className={cn(
            "h-3 w-3 -mb-0.5",
            active && direction === "asc"
              ? "text-navy-900"
              : "text-slate-300 group-hover:text-slate-500",
          )}
          strokeWidth={active && direction === "asc" ? 2.75 : 2}
        />
        <ChevronDown
          className={cn(
            "h-3 w-3 -mt-0.5",
            active && direction === "desc"
              ? "text-navy-900"
              : "text-slate-300 group-hover:text-slate-500",
          )}
          strokeWidth={active && direction === "desc" ? 2.75 : 2}
        />
      </span>
    </button>
  );
}

function buildStudentsQuery(
  filters: ReturnType<typeof useAcademicContext>["filters"],
  offset: number,
) {
  const params = new URLSearchParams();
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String(offset));
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.collegeId !== "all") params.set("collegeId", String(filters.collegeId));
  if (filters.courseId !== "all") params.set("courseId", String(filters.courseId));
  if (filters.branchId !== "all") params.set("branchId", String(filters.branchId));
  if (filters.batch !== "all") params.set("batch", String(filters.batch));
  if (filters.year !== "all") params.set("year", String(filters.year));
  if (filters.semester !== "all") params.set("semester", String(filters.semester));
  if (filters.section !== "all") params.set("section", String(filters.section));
  if (filters.studentStatus !== "all") {
    params.set("status", String(filters.studentStatus));
  }
  return params.toString();
}

function buildStudentsStatsQuery(
  filters: ReturnType<typeof useAcademicContext>["filters"],
) {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.collegeId !== "all") params.set("collegeId", String(filters.collegeId));
  if (filters.courseId !== "all") params.set("courseId", String(filters.courseId));
  if (filters.branchId !== "all") params.set("branchId", String(filters.branchId));
  if (filters.batch !== "all") params.set("batch", String(filters.batch));
  if (filters.year !== "all") params.set("year", String(filters.year));
  if (filters.semester !== "all") params.set("semester", String(filters.semester));
  if (filters.section !== "all") params.set("section", String(filters.section));
  if (filters.studentStatus !== "all") {
    params.set("status", String(filters.studentStatus));
  }
  return params.toString();
}

type FilterScopedStats = {
  total: number;
  avgAttendance: number | null;
  below75: number;
  highRisk: number;
  mediumRisk: number;
  lowRisk: number;
};

const emptyFilterStats: FilterScopedStats = {
  total: 0,
  avgAttendance: null,
  below75: 0,
  highRisk: 0,
  mediumRisk: 0,
  lowRisk: 0,
};

export function StudentsRegisterView() {
  const { filters, setStudentsListStats } = useAcademicContext();
  const [students, setStudents] = useState<StudentListRow[]>([]);
  const [totalStudents, setTotalStudents] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [filterStats, setFilterStats] = useState<FilterScopedStats>(emptyFilterStats);
  const [statsLoading, setStatsLoading] = useState(true);

  const filterKey = useMemo(() => buildStudentsQuery(filters, 0), [filters]);
  const statsKey = useMemo(() => buildStudentsStatsQuery(filters), [filters]);
  const loadLockRef = useRef(false);
  const studentsRef = useRef(students);
  const totalRef = useRef(totalStudents);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const filterStatsRef = useRef(filterStats);
  const statsLoadingRef = useRef(statsLoading);

  useEffect(() => {
    studentsRef.current = students;
  }, [students]);

  useEffect(() => {
    totalRef.current = totalStudents;
  }, [totalStudents]);

  useEffect(() => {
    filterStatsRef.current = filterStats;
  }, [filterStats]);

  useEffect(() => {
    statsLoadingRef.current = statsLoading;
  }, [statsLoading]);

  const publishStats = useCallback(
    (
      loaded: number,
      nextLoading: boolean,
      nextLoadingMore: boolean,
      scoped: FilterScopedStats = filterStatsRef.current,
      nextStatsLoading: boolean = statsLoadingRef.current,
    ) => {
      setStudentsListStats({
        total: scoped.total,
        loaded,
        loading: nextLoading || nextStatsLoading,
        loadingMore: nextLoadingMore,
        avgAttendance: scoped.avgAttendance,
        below75: scoped.below75,
        highRisk: scoped.highRisk,
        mediumRisk: scoped.mediumRisk,
        lowRisk: scoped.lowRisk,
      });
    },
    [setStudentsListStats],
  );

  useEffect(() => {
    return () => {
      setStudentsListStats(null);
    };
  }, [setStudentsListStats]);

  useEffect(() => {
    let cancelled = false;
    async function loadStats() {
      setStatsLoading(true);
      publishStats(studentsRef.current.length, loading, loadingMore, emptyFilterStats, true);
      try {
        const qs = statsKey ? `?${statsKey}` : "";
        const response = await apiFetch(`/students/stats${qs}`, { cache: "no-store" });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            typeof body === "object" && body && "message" in body
              ? String((body as { message: string }).message)
              : `Failed to load student stats (${response.status})`,
          );
        }
        if (cancelled) return;
        const scoped: FilterScopedStats = {
          total: Number((body as FilterScopedStats).total ?? 0),
          avgAttendance:
            (body as FilterScopedStats).avgAttendance == null
              ? null
              : Number((body as FilterScopedStats).avgAttendance),
          below75: Number((body as FilterScopedStats).below75 ?? 0),
          highRisk: Number((body as FilterScopedStats).highRisk ?? 0),
          mediumRisk: Number((body as FilterScopedStats).mediumRisk ?? 0),
          lowRisk: Number((body as FilterScopedStats).lowRisk ?? 0),
        };
        setFilterStats(scoped);
        setStatsLoading(false);
        publishStats(studentsRef.current.length, false, false, scoped, false);
      } catch {
        if (!cancelled) {
          setFilterStats(emptyFilterStats);
          setStatsLoading(false);
          publishStats(studentsRef.current.length, false, false, emptyFilterStats, false);
        }
      }
    }
    void loadStats();
    return () => {
      cancelled = true;
    };
    // Intentionally omit loading/loadingMore — list progress is synced separately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statsKey, publishStats]);

  useEffect(() => {
    let cancelled = false;
    async function loadFirstPage() {
      loadLockRef.current = true;
      setLoading(true);
      setLoadingMore(false);
      setError(null);
      setStudents([]);
      setTotalStudents(0);
      publishStats(0, true, false);
      try {
        const response = await apiFetch(`/students?${filterKey}`, {
          cache: "no-store",
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          const message =
            typeof body === "object" && body && "message" in body
              ? String((body as { message: string }).message)
              : `Failed to load students (${response.status})`;
          throw new Error(message);
        }
        if (cancelled) return;
        const payload = body as { data?: StudentListRow[]; total?: number };
        const rows = payload.data ?? [];
        const total = Number(payload.total ?? rows.length);
        setStudents(rows);
        setTotalStudents(total);
        publishStats(rows.length, false, false);
      } catch (err) {
        if (!cancelled) {
          setStudents([]);
          setTotalStudents(0);
          setError(err instanceof Error ? err.message : "Failed to load students");
          publishStats(0, false, false);
        }
      } finally {
        if (!cancelled) setLoading(false);
        loadLockRef.current = false;
      }
    }
    void loadFirstPage();
    return () => {
      cancelled = true;
    };
  }, [filterKey, publishStats]);

  const loadMore = useCallback(async () => {
    if (loadLockRef.current || loading) return;
    const loaded = studentsRef.current.length;
    const total = totalRef.current;
    if (loaded >= total) return;

    loadLockRef.current = true;
    setLoadingMore(true);
    publishStats(loaded, false, true);
    try {
      const query = buildStudentsQuery(filters, loaded);
      const response = await apiFetch(`/students?${query}`, {
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof body === "object" && body && "message" in body
            ? String((body as { message: string }).message)
            : `Failed to load more students (${response.status})`,
        );
      }
      const payload = body as { data?: StudentListRow[]; total?: number };
      const nextRows = payload.data ?? [];
      const nextTotal = Number(payload.total ?? total);
      const prev = studentsRef.current;
      const seen = new Set(prev.map((row) => row.id));
      const merged = [...prev];
      for (const row of nextRows) {
        if (!seen.has(row.id)) merged.push(row);
      }
      setTotalStudents(nextTotal);
      setStudents(merged);
      publishStats(merged.length, false, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load more students");
      publishStats(studentsRef.current.length, false, false);
    } finally {
      setLoadingMore(false);
      loadLockRef.current = false;
    }
  }, [filters, loading, publishStats]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMore();
        }
      },
      { root: null, rootMargin: "240px 0px", threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore, students.length, totalStudents, loading]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir("asc");
  }

  const sortedStudents = useMemo(() => {
    const rows = [...students];
    rows.sort((a, b) => {
      let cmp = 0;

      if (sortKey === "name") {
        cmp = compareValues(a.name.trim(), b.name.trim());
      } else if (sortKey === "rollNo") {
        const aValue = (a.rollNo ?? "").trim();
        const bValue = (b.rollNo ?? "").trim();
        if (!aValue && bValue) cmp = 1;
        else if (aValue && !bValue) cmp = -1;
        else cmp = compareValues(aValue, bValue);
      } else if (sortKey === "attendance") {
        cmp = a.attendance - b.attendance;
      } else {
        cmp = (RISK_RANK[a.risk] ?? 0) - (RISK_RANK[b.risk] ?? 0);
      }

      if (cmp !== 0) return sortDir === "asc" ? cmp : -cmp;
      return compareValues(a.name, b.name) || compareValues(a.admissionNo, b.admissionNo);
    });
    return rows;
  }, [students, sortKey, sortDir]);

  const snoById = useMemo(() => {
    const map = new Map<string, number>();
    sortedStudents.forEach((row, index) => {
      map.set(row.id, index + 1);
    });
    return map;
  }, [sortedStudents]);

  const hasMore = students.length < totalStudents;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold leading-none text-navy-900">
          Student Academic Register
        </h1>
        {hasMore || loadingMore ? (
          <p className="text-xs text-slate-500">
            {loadingMore
              ? "Loading more students…"
              : `Scroll to load more (${students.length.toLocaleString("en-IN")} / ${totalStudents.toLocaleString("en-IN")})`}
          </p>
        ) : null}
      </div>

      {error ? (
        <div className="mb-2 rounded-lg border border-border bg-card p-3">
          <p className="text-sm font-medium text-navy-900">Unable to load students.</p>
          <p className="mt-1 text-sm text-critical">{error}</p>
        </div>
      ) : null}

      <div className={cn("relative", loading && sortedStudents.length === 0 && "min-h-[200px]")}>
        {loading && !students.length ? (
          <LoadingAnimation label="Loading students…" />
        ) : null}

        <DataTable
          rows={sortedStudents}
          rowKey={(row) => row.id}
          onRowClick={(row) => setSelectedId(row.id)}
          emptyMessage={loading ? " " : "No students match the selected page filters."}
          mobileRender={(row) => (
            <div className="flex flex-col gap-1">
              <MobileDataCardHeader
                title={
                  <div className="flex items-center gap-2">
                    <StudentAvatar
                      name={row.name}
                      photo={row.photo}
                      studentId={row.id}
                      hasPhoto={Boolean(row.hasPhoto)}
                      size="sm"
                    />
                    <div className="min-w-0">
                      <p className="text-base font-semibold leading-tight">{row.name}</p>
                      <p className="text-xs font-normal text-slate-500 mt-0.5">Adm: {row.admissionNo}</p>
                    </div>
                  </div>
                }
                status={<StatusBadge status={row.status} />}
              />
              <MobileDataCardGrid>
                <MobileDataCardField label="PIN / Roll" value={row.rollNo || row.admissionNo || "—"} />
                <MobileDataCardField label="Attendance" value={`${row.attendance}%`} />
                <MobileDataCardField label="Branch / Section" value={`${row.branch} ${row.section ? `- ${row.section}` : ""}`} />
                <MobileDataCardField label="Risk" value={<StatusBadge status={row.risk} />} />
              </MobileDataCardGrid>
            </div>
          )}
          columns={[
            {
              key: "sno",
              header: "S.No",
              className: "w-14 whitespace-nowrap text-slate-500",
              render: (row) => (
                <span className="tabular-nums text-xs font-medium text-slate-500">
                  {snoById.get(row.id) ?? "—"}
                </span>
              ),
            },
            {
              key: "student",
              header: (
                <SortableHeader
                  label="Student"
                  active={sortKey === "name"}
                  direction={sortDir}
                  onToggle={() => toggleSort("name")}
                />
              ),
              className: "min-w-[240px]",
              render: (row) => (
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-md text-left hover:bg-slate-100/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-700/30"
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedId(row.id);
                  }}
                  aria-label={`Open details for ${row.name}`}
                >
                  <StudentAvatar
                    name={row.name}
                    photo={row.photo}
                    studentId={row.id}
                    hasPhoto={Boolean(row.hasPhoto)}
                    size="sm"
                  />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-navy-900">{row.name}</p>
                    <p className="truncate text-xs text-slate-500">Adm: {row.admissionNo}</p>
                  </div>
                </button>
              ),
            },
            {
              key: "rollNo",
              header: (
                <SortableHeader
                  label="PIN / Roll"
                  active={sortKey === "rollNo"}
                  direction={sortDir}
                  onToggle={() => toggleSort("rollNo")}
                />
              ),
              render: (row) =>
                row.rollNo || row.admissionNo ? (
                  <span className="font-mono text-[13px] text-navy-900">{row.rollNo || row.admissionNo}</span>
                ) : (
                  <span className="text-slate-400">—</span>
                ),
            },
            { key: "college", header: "College", render: (row) => row.college },
            { key: "course", header: "Course", render: (row) => row.course },
            { key: "branch", header: "Branch", render: (row) => row.branch },
            {
              key: "yearSem",
              header: "Year-Sem",
              render: (row) => (
                <span className="inline-flex rounded bg-blue-50 px-2 py-0.5 text-xs font-semibold text-info">
                  {yearSemLabel(row)}
                </span>
              ),
            },
            { key: "batch", header: "Batch", render: (row) => row.batch },
            { key: "section", header: "Section", render: (row) => row.section },
            {
              key: "status",
              header: "Student Status",
              render: (row) => <StatusBadge status={row.status} />,
            },
            {
              key: "attendance",
              header: (
                <SortableHeader
                  label="Attendance"
                  active={sortKey === "attendance"}
                  direction={sortDir}
                  onToggle={() => toggleSort("attendance")}
                />
              ),
              render: (row) => `${row.attendance}%`,
            },
            {
              key: "risk",
              header: (
                <SortableHeader
                  label="Risk"
                  active={sortKey === "risk"}
                  direction={sortDir}
                  onToggle={() => toggleSort("risk")}
                />
              ),
              render: (row) => <StatusBadge status={row.risk} />,
            },
          ]}
        />

        <div ref={sentinelRef} className="h-8 w-full" aria-hidden />
        {loadingMore ? (
          <p className="py-3 text-center text-xs text-slate-500">Loading more students…</p>
        ) : null}
        {!loading && !hasMore && students.length > 0 ? (
          <p className="py-2 text-center text-xs text-slate-400">
            All {totalStudents.toLocaleString("en-IN")} students loaded
          </p>
        ) : null}
      </div>

      <StudentDetailDrawer
        studentId={selectedId}
        open={selectedId != null}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}
