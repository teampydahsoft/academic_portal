"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useAcademicContext } from "@/components/layout/AcademicProvider";
import { useAuth } from "@/components/auth/AuthProvider";
import { apiFetch } from "@/lib/api";
import type { CommandCenterSummary } from "@/features/dashboard/DashboardView";
import type { WorkloadSummary } from "@/features/workload/StaffWorkloadView";

type ReportKey =
  | "students"
  | "attendance"
  | "timetables"
  | "workload"
  | "examinations"
  | "results";

type ReportDef = {
  key: ReportKey;
  title: string;
  description: string;
  href: string;
  permissions: string[];
  available: boolean;
};

const REPORTS: ReportDef[] = [
  {
    key: "students",
    title: "Students",
    description: "Active student headcount and attendance-risk cohort in scope.",
    href: "/students",
    permissions: ["students.view"],
    available: true,
  },
  {
    key: "attendance",
    title: "Attendance",
    description: "Average attendance and pending class posting for today.",
    href: "/attendance-analytics",
    permissions: ["attendance_analytics.view"],
    available: true,
  },
  {
    key: "timetables",
    title: "Timetables",
    description: "Published vs required section timetable coverage.",
    href: "/timetables",
    permissions: ["timetable.view"],
    available: true,
  },
  {
    key: "workload",
    title: "Faculty workload",
    description: "Faculty load balance from published timetables.",
    href: "/staff-workload",
    permissions: ["workload.view"],
    available: true,
  },
  {
    key: "examinations",
    title: "Examinations",
    description: "Active examinations configured in the examination portal.",
    href: "/examinations",
    permissions: ["examinations.view"],
    available: true,
  },
  {
    key: "results",
    title: "Results",
    description: "Open the results module for published exam outcomes.",
    href: "/results",
    permissions: ["results.view"],
    available: true,
  },
];

type LiveBundle = {
  summary: CommandCenterSummary | null;
  workload: WorkloadSummary | null;
};

export function ReportsView() {
  const { filters } = useAcademicContext();
  const { hasAnyPermission } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<LiveBundle>({ summary: null, workload: null });
  const [expanded, setExpanded] = useState<ReportKey | null>(null);

  const visibleReports = useMemo(
    () => REPORTS.filter((r) => hasAnyPermission(...r.permissions)),
    [hasAnyPermission],
  );

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.collegeId !== "all") params.set("collegeId", String(filters.collegeId));
    if (filters.courseId !== "all") params.set("courseId", String(filters.courseId));
    if (filters.branchId !== "all") params.set("branchId", String(filters.branchId));
    if (filters.section !== "all") params.set("section", filters.section);
    if (filters.batch !== "all") params.set("batch", String(filters.batch));
    if (filters.year !== "all") params.set("year", String(filters.year));
    if (filters.semester !== "all") params.set("semester", String(filters.semester));
    if (filters.academicYear) params.set("academicYear", filters.academicYear);
    return params.toString();
  }, [filters]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const canDashboard = hasAnyPermission("dashboard.view", "reports.view");
        const canWorkload = hasAnyPermission("workload.view");

        const [summaryRes, workloadRes] = await Promise.all([
          canDashboard
            ? apiFetch(`/command-center/summary${query ? `?${query}` : ""}`, {
                cache: "no-store",
              })
            : Promise.resolve(null),
          canWorkload
            ? apiFetch(`/workload/summary${query ? `?${query}` : ""}`, {
                cache: "no-store",
              })
            : Promise.resolve(null),
        ]);

        let summary: CommandCenterSummary | null = null;
        let workload: WorkloadSummary | null = null;

        if (summaryRes) {
          if (!summaryRes.ok) {
            throw new Error(`Failed to load command center (${summaryRes.status})`);
          }
          summary = (await summaryRes.json()) as CommandCenterSummary;
        }
        if (workloadRes) {
          if (workloadRes.ok) {
            workload = (await workloadRes.json()) as WorkloadSummary;
          }
        }

        if (!cancelled) setData({ summary, workload });
      } catch (err) {
        if (!cancelled) {
          setData({ summary: null, workload: null });
          setError(err instanceof Error ? err.message : "Failed to load report sources");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [query, hasAnyPermission]);

  function renderPreview(key: ReportKey) {
    const s = data.summary;
    const w = data.workload;

    if (loading) {
      return <p className="text-sm text-slate-500">Loading live figures…</p>;
    }

    if (key === "students") {
      if (!s) {
        return (
          <EmptyState
            title="Report not available yet"
            description="Student summary requires dashboard.view access to dashboard data."
            className="py-6"
          />
        );
      }
      return (
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label="Active students" value={s.activeStudents.toLocaleString()} tone="info" />
          <StatCard label="Sections" value={s.sectionCount} />
          <StatCard
            label="Below 75%"
            value={s.studentsBelowThreshold.toLocaleString()}
            tone="critical"
          />
        </div>
      );
    }

    if (key === "attendance") {
      if (!s) {
        return (
          <EmptyState
            title="Report not available yet"
            description="Attendance summary requires dashboard data."
            className="py-6"
          />
        );
      }
      return (
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label="Average attendance" value={`${s.averageAttendance}%`} tone="success" />
          <StatCard label="Pending today" value={s.attendancePendingToday} tone="warning" />
          <StatCard label="Posted today" value={s.classesToday.posted} tone="info" />
        </div>
      );
    }

    if (key === "timetables") {
      if (!s) {
        return (
          <EmptyState
            title="Report not available yet"
            description="Timetable coverage requires dashboard data."
            className="py-6"
          />
        );
      }
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <StatCard
            label="Published / total"
            value={`${s.timetablesPublished.published} / ${s.timetablesPublished.total}`}
            tone="warning"
          />
          <StatCard label="Configured sections" value={s.sectionCount} />
        </div>
      );
    }

    if (key === "workload") {
      if (!w) {
        return (
          <EmptyState
            title="Report not available yet"
            description="Workload summary could not be loaded for the current scope."
            className="py-6"
          />
        );
      }
      return (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Faculty" value={w.kpis.totalFaculty} />
          <StatCard label="Average load" value={w.kpis.averageLoad} tone="info" />
          <StatCard label="Overloaded" value={w.kpis.overloaded} tone="critical" />
          <StatCard label="Underloaded" value={w.kpis.underloaded} tone="warning" />
        </div>
      );
    }

    if (key === "examinations") {
      if (!s) {
        return (
          <EmptyState
            title="Report not available yet"
            description="Examination summary requires dashboard data."
            className="py-6"
          />
        );
      }
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <StatCard label="Active exams" value={s.activeExams} tone="info" />
          <StatCard label="Readiness" value={s.examReadiness} />
        </div>
      );
    }

    if (key === "results") {
      return (
        <EmptyState
          title="Open results module"
          description="Detailed result tables live in the Results module. No separate export report endpoint is available yet."
          className="py-6"
          action={
            <Link href="/results">
              <Button size="sm" variant="secondary">
                Go to Results
              </Button>
            </Link>
          }
        />
      );
    }

    return (
      <EmptyState
        title="Report not available yet"
        description="This report does not have a backend data source yet."
        className="py-6"
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Live summary views from existing Academic Portal APIs. Export/download is not available until a dedicated report endpoint exists."
      />

      {error ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-critical">
          {error}
        </div>
      ) : null}

      {visibleReports.length === 0 ? (
        <EmptyState
          title="No reports available"
          description="You do not have permission to any report data sources in the current role."
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {visibleReports.map((report) => {
            const open = expanded === report.key;
            return (
              <Card key={report.key}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-navy-900">{report.title}</h3>
                    <p className="mt-1 text-sm text-slate-500">{report.description}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant={open ? "primary" : "secondary"}
                      onClick={() => setExpanded(open ? null : report.key)}
                    >
                      {open ? "Hide" : "Preview"}
                    </Button>
                    <Link href={report.href}>
                      <Button size="sm" variant="ghost">
                        Open module
                      </Button>
                    </Link>
                  </div>
                </div>
                {open ? <div className="mt-4 border-t border-border pt-4">{renderPreview(report.key)}</div> : null}
              </Card>
            );
          })}
        </div>
      )}

      <Card className="mt-4">
        <h3 className="text-sm font-semibold text-navy-900">Not available yet</h3>
        <p className="mt-1 text-sm text-slate-500">
          Audit exports, backlog registers, and file downloads are not connected. No fake
          export actions are shown.
        </p>
      </Card>
    </div>
  );
}
