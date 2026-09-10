"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { DataTable } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api";

const selectClassName =
  "h-10 w-full rounded-md border border-border bg-white px-3 text-sm text-navy-900 outline-none focus:border-navy-800 sm:w-auto sm:min-w-[160px]";

const searchClassName =
  "h-10 w-full rounded-md border border-border bg-white px-3 text-sm text-navy-900 outline-none focus:border-navy-800 sm:min-w-[220px]";

export type FacultyLoad = {
  id: string;
  staffLinkId: number;
  hrmsEmployeeId: string;
  code: string;
  name: string;
  department: string;
  division: string;
  periodsPerWeek: number;
  hoursPerWeek: number;
  hoursByDay: {
    MON: number;
    TUE: number;
    WED: number;
    THUR: number;
    FRI: number;
    SAT: number;
    SUN: number;
  };
  periodsByDay: {
    MON: number;
    TUE: number;
    WED: number;
    THUR: number;
    FRI: number;
    SAT: number;
    SUN: number;
  };
  status: string;
};

export type WorkloadSummary = {
  kpis: {
    totalFaculty: number;
    averageLoad: number;
    averageHours?: number;
    overloaded: number;
    underloaded: number;
    balanced: number;
  };
  thresholds?: {
    minPeriodsPerWeek: number;
    maxPeriodsPerWeek: number;
    maxPeriodsPerDay: number;
    minHoursPerWeek: number | null;
    maxHoursPerWeek: number | null;
  };
  faculty: FacultyLoad[];
  filterOptions?: {
    divisions: string[];
    departments: string[];
  };
  source?: string;
};

const DAY_COLUMNS = [
  { key: "MON", label: "Mon" },
  { key: "TUE", label: "Tue" },
  { key: "WED", label: "Wed" },
  { key: "THUR", label: "Thu" },
  { key: "FRI", label: "Fri" },
  { key: "SAT", label: "Sat" },
] as const;

function formatDayLoad(row: FacultyLoad, day: (typeof DAY_COLUMNS)[number]["key"]) {
  const periods = row.periodsByDay[day];
  const hours = row.hoursByDay[day];
  if (!periods) return "—";
  return hours > 0 ? `${periods}p · ${hours}h` : `${periods}p`;
}

export function StaffWorkloadView({ embedded = false }: { embedded?: boolean }) {
  const [summary, setSummary] = useState<WorkloadSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [freeOnly, setFreeOnly] = useState(false);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [divisionFilter, setDivisionFilter] = useState("all");
  const [deptFilter, setDeptFilter] = useState("all");

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchDraft.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchDraft]);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (divisionFilter !== "all") params.set("division", divisionFilter);
    if (deptFilter !== "all") params.set("department", deptFilter);
    if (search) params.set("search", search);
    return params.toString();
  }, [divisionFilter, deptFilter, search]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await apiFetch(`/workload/summary${query ? `?${query}` : ""}`, {
          cache: "no-store",
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            typeof body === "object" && body && "message" in body
              ? String((body as { message: string }).message)
              : "Failed to load workload",
          );
        }
        if (!cancelled) setSummary(body as WorkloadSummary);
      } catch (err) {
        if (!cancelled) {
          setSummary(null);
          setError(err instanceof Error ? err.message : "Failed to load workload");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [query]);

  const divisionOptions = summary?.filterOptions?.divisions ?? [];
  const deptOptions = summary?.filterOptions?.departments ?? [];

  const faculty = useMemo(() => {
    const rows = summary?.faculty ?? [];
    if (!freeOnly) return rows;
    return rows.filter((row) => row.status === "Underloaded");
  }, [summary, freeOnly]);

  const kpis = summary?.kpis ?? {
    totalFaculty: 0,
    averageLoad: 0,
    averageHours: 0,
    overloaded: 0,
    underloaded: 0,
    balanced: 0,
  };

  return (
    <div>
      {!embedded ? (
        <PageHeader
          title="Staff Workload"
          description={
            summary?.source ||
            "Teaching hours from published timetables across all branches. Filter by division or department."
          }
          actions={
            <Button
              variant={freeOnly ? "primary" : "secondary"}
              onClick={() => setFreeOnly((prev) => !prev)}
            >
              {freeOnly ? "Show all faculty" : "Find underloaded faculty"}
            </Button>
          }
        />
      ) : null}

      <div className="mb-4 flex flex-col gap-3 rounded-lg border border-border bg-card p-3 sm:flex-row sm:flex-wrap sm:items-center">
        <input
          type="search"
          placeholder="Search name, code, or department…"
          className={searchClassName}
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
        />
        <select
          className={selectClassName}
          value={divisionFilter}
          onChange={(e) => setDivisionFilter(e.target.value)}
        >
          <option value="all">All divisions</option>
          {divisionOptions.map((division) => (
            <option key={division} value={division}>
              {division}
            </option>
          ))}
        </select>
        <select
          className={selectClassName}
          value={deptFilter}
          onChange={(e) => setDeptFilter(e.target.value)}
        >
          <option value="all">All departments</option>
          {deptOptions.map((department) => (
            <option key={department} value={department}>
              {department}
            </option>
          ))}
        </select>
      </div>

      {error ? <p className="mb-3 text-sm text-critical">{error}</p> : null}
      {loading ? <p className="mb-3 text-sm text-slate-500">Loading published workload…</p> : null}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Faculty with load" value={kpis.totalFaculty} />
        <StatCard
          label="Average periods / week"
          value={kpis.averageLoad}
          hint={
            summary?.thresholds
              ? `Balanced ${summary.thresholds.minPeriodsPerWeek}–${summary.thresholds.maxPeriodsPerWeek} periods` +
                (summary.thresholds.minHoursPerWeek != null
                  ? ` · min ${summary.thresholds.minHoursPerWeek}h`
                  : "")
              : "From published CLASS slots"
          }
        />
        <StatCard label="Overloaded" value={kpis.overloaded} tone="critical" />
        <StatCard label="Underloaded" value={kpis.underloaded} tone="warning" />
        <StatCard label="Balanced" value={kpis.balanced} tone="success" />
      </div>

      <DataTable
        rows={faculty}
        rowKey={(row) => row.id}
        emptyMessage="No faculty match the current filters."
        columns={[
          {
            key: "name",
            header: "Faculty",
            render: (row) => (
              <div>
                <p className="font-medium text-navy-900">{row.name}</p>
                <p className="text-xs text-slate-500">{row.code}</p>
              </div>
            ),
          },
          { key: "division", header: "Division", render: (row) => row.division },
          { key: "department", header: "Department", render: (row) => row.department },
          ...DAY_COLUMNS.map((day) => ({
            key: day.key,
            header: day.label,
            render: (row: FacultyLoad) => formatDayLoad(row, day.key),
          })),
          {
            key: "hours",
            header: "Total hrs / wk",
            render: (row) => row.hoursPerWeek,
          },
          {
            key: "periods",
            header: "Periods / wk",
            render: (row) => row.periodsPerWeek,
          },
          {
            key: "status",
            header: "Load Status",
            render: (row) => <StatusBadge status={row.status} />,
          },
          {
            key: "actions",
            header: "Actions",
            render: (row) => (
              <Link href={`/staff-workload/${row.id}`}>
                <Button size="sm" variant="secondary">
                  Details
                </Button>
              </Link>
            ),
          },
        ]}
      />
    </div>
  );
}
