"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { DataTable } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import { useAcademicContext } from "@/components/layout/AcademicProvider";
import { apiFetch } from "@/lib/api";

export type FacultyLoad = {
  id: string;
  staffLinkId: number;
  hrmsEmployeeId: string;
  code: string;
  name: string;
  department: string;
  subjects: number;
  sections: number;
  periodsPerWeek: number;
  minutesPerWeek: number;
  hoursPerWeek: number;
  theory: number;
  lab: number;
  maxPeriodsInADay?: number;
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
  };
  faculty: FacultyLoad[];
  source?: string;
};

export function StaffWorkloadView() {
  const { filters } = useAcademicContext();
  const [summary, setSummary] = useState<WorkloadSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [freeOnly, setFreeOnly] = useState(false);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.collegeId !== "all") params.set("collegeId", String(filters.collegeId));
    if (filters.courseId !== "all") params.set("courseId", String(filters.courseId));
    if (filters.branchId !== "all") params.set("branchId", String(filters.branchId));
    if (filters.batch !== "all") params.set("batch", String(filters.batch));
    if (filters.year !== "all") params.set("year", String(filters.year));
    if (filters.semester !== "all") params.set("semester", String(filters.semester));
    if (filters.section !== "all") params.set("section", String(filters.section));
    if (filters.academicYear) params.set("academicYear", filters.academicYear);
    return params.toString();
  }, [filters]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await apiFetch(`/workload/summary${query ? `?${query}` : ""}`,
          { cache: "no-store" },
        );
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
      <PageHeader
        title="Staff Workload"
        description={
          summary?.source ||
          "Derived from published Academic Portal timetables and college timing slots."
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

      {error ? <p className="mb-3 text-sm text-critical">{error}</p> : null}
      {loading ? <p className="mb-3 text-sm text-slate-500">Loading published workload…</p> : null}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Faculty with load" value={kpis.totalFaculty} />
        <StatCard
          label="Average periods / week"
          value={kpis.averageLoad}
          hint={
            summary?.thresholds
              ? `Balanced ${summary.thresholds.minPeriodsPerWeek}–${summary.thresholds.maxPeriodsPerWeek}`
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
        emptyMessage="No published timetable assignments for this filter set."
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
          { key: "department", header: "Department", render: (row) => row.department },
          { key: "subjects", header: "Subjects", render: (row) => row.subjects },
          { key: "sections", header: "Sections", render: (row) => row.sections },
          {
            key: "periods",
            header: "Periods / Week",
            render: (row) => row.periodsPerWeek,
          },
          {
            key: "hours",
            header: "Hours / Week",
            render: (row) => row.hoursPerWeek,
          },
          { key: "theory", header: "Theory", render: (row) => row.theory },
          { key: "lab", header: "Lab", render: (row) => row.lab },
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
