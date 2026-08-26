"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { Card } from "@/components/ui/Card";
import { useAcademicContext } from "@/components/layout/AcademicProvider";
import { apiFetch } from "@/lib/api";

export type CommandCenterSummary = {
  activeStudents: number;
  sectionCount: number;
  timetablesPublished: { published: number; total: number };
  facultyCount: number;
  facultyExceptions: number;
  attendancePendingToday: number;
  averageAttendance: number;
  studentsBelowThreshold: number;
  openRiskCases: number;
  examReadiness: string;
  activeExams: number;
  classesToday: { scheduled: number; posted: number; pending: number };
  source?: {
    students: string;
    staff: string;
    exams: string;
    timetables: string;
  };
};

const emptySummary: CommandCenterSummary = {
  activeStudents: 0,
  sectionCount: 0,
  timetablesPublished: { published: 0, total: 0 },
  facultyCount: 0,
  facultyExceptions: 0,
  attendancePendingToday: 0,
  averageAttendance: 0,
  studentsBelowThreshold: 0,
  openRiskCases: 0,
  examReadiness: "—",
  activeExams: 0,
  classesToday: { scheduled: 0, posted: 0, pending: 0 },
};

export function CommandCenterView() {
  const { filters } = useAcademicContext();
  const [summary, setSummary] = useState<CommandCenterSummary>(emptySummary);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.collegeId !== "all") params.set("collegeId", String(filters.collegeId));
    if (filters.courseId !== "all") params.set("courseId", String(filters.courseId));
    if (filters.branchId !== "all") params.set("branchId", String(filters.branchId));
    if (filters.section !== "all") params.set("section", filters.section);
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }, [filters.collegeId, filters.courseId, filters.branchId, filters.section]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await apiFetch(`/command-center/summary${query}`,
          { cache: "no-store" },
        );
        if (!response.ok) throw new Error(`Failed to load summary (${response.status})`);
        const data = (await response.json()) as CommandCenterSummary;
        if (!cancelled) setSummary(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load summary");
          setSummary(emptySummary);
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

  const filterHint = useMemo(() => {
    const parts: string[] = [];
    if (filters.collegeId !== "all") parts.push("college");
    if (filters.courseId !== "all") parts.push("course");
    if (filters.branchId !== "all") parts.push("branch");
    if (filters.section !== "all") parts.push("section");
    return parts.length
      ? `Scoped to selected ${parts.join(" → ")}`
      : "All colleges";
  }, [filters]);

  return (
    <div>
      <PageHeader
        title="Academic Command Center"
        description="Filters above apply across modules. Change them here or on any page — no need to return to dashboard."
      />

      <p className="mb-3 text-xs text-slate-500">
        {loading ? "Updating stats…" : filterHint}
        {error ? ` · ${error}` : null}
      </p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Link href="/students">
          <StatCard
            label="Active Students"
            value={summary.activeStudents.toLocaleString()}
            hint={`${summary.sectionCount} configured sections`}
            tone="info"
          />
        </Link>
        <Link href="/timetables">
          <StatCard
            label="Timetables Published"
            value={`${summary.timetablesPublished.published} / ${summary.timetablesPublished.total}`}
            hint="Portal-owned section timetables"
            tone="warning"
          />
        </Link>
        <Link href="/staff-workload">
          <StatCard
            label="Faculty in HRMS"
            value={summary.facultyCount.toLocaleString()}
            hint="Staff master source (global)"
            tone="info"
          />
        </Link>
        <Link href="/attendance-analytics">
          <StatCard
            label="Below Attendance Threshold"
            value={summary.studentsBelowThreshold.toLocaleString()}
            hint="Last 90 days, under 75%"
            tone="critical"
          />
        </Link>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Average Attendance"
          value={`${summary.averageAttendance}%`}
          hint="Last 90 days"
          tone="success"
        />
        <Link href="/mentoring-risks">
          <StatCard
            label="Open Risk Cases"
            value={summary.openRiskCases.toLocaleString()}
            hint="Derived from attendance risk"
            tone="warning"
          />
        </Link>
        <Link href="/examinations">
          <StatCard
            label="Active Exams"
            value={summary.activeExams}
            hint={summary.examReadiness}
            tone="info"
          />
        </Link>
        <Link href="/attendance-posting">
          <StatCard
            label="Attendance Pending Today"
            value={summary.attendancePendingToday}
            hint="After timetable publish + class posting"
            tone="warning"
          />
        </Link>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <h3 className="mb-3 text-base font-semibold text-navy-900">
            Live Data Sources
          </h3>
          <ul className="space-y-2 text-sm text-slate-700">
            <li>Students & attendance → student_database (read-only)</li>
            <li>Staff / departments → HRMS MongoDB (read-only)</li>
            <li>Exams & subjects → examination_portal (read-only)</li>
            <li>Section timetables & class posting → academic_portal (owned here)</li>
            <li>Branch sections → course_branches.metadata (same as student portal)</li>
          </ul>
        </Card>
        <Card>
          <h3 className="mb-3 text-base font-semibold text-navy-900">
            Today’s Class Attendance Status
          </h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Scheduled" value={summary.classesToday.scheduled} />
            <StatCard label="Posted" value={summary.classesToday.posted} tone="success" />
            <StatCard label="Pending" value={summary.classesToday.pending} tone="warning" />
          </div>
        </Card>
      </div>
    </div>
  );
}
