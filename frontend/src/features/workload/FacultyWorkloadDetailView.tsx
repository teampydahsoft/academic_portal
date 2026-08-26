"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import { useAcademicContext } from "@/components/layout/AcademicProvider";
import { apiFetch } from "@/lib/api";

type Assignment = {
  entryId: number;
  dayLabel: string;
  slotLabel: string | null;
  startTime: string | null;
  endTime: string | null;
  minutes: number;
  entryType: string;
  subjectCode: string | null;
  subjectName: string | null;
  section: string | null;
  batch: string;
  roomLabel: string | null;
};

type DayGroup = {
  dayOfWeek: string;
  dayLabel: string;
  periods: number;
  minutes: number;
  hours: number;
  assignments: Assignment[];
};

type FacultyDetail = {
  id: string;
  name: string;
  code: string;
  department: string;
  status: string;
  periodsPerWeek: number;
  hoursPerWeek: number;
  minutesPerWeek: number;
  subjects: number;
  sections: number;
  theory: number;
  lab: number;
  maxPeriodsInADay: number;
  assignments: Assignment[];
  byDay: DayGroup[];
  source?: string;
  thresholds?: {
    minPeriodsPerWeek: number;
    maxPeriodsPerWeek: number;
    maxPeriodsPerDay: number;
  };
};

export function FacultyWorkloadDetailView() {
  const params = useParams<{ facultyId: string }>();
  const { filters } = useAcademicContext();
  const [faculty, setFaculty] = useState<FacultyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const search = new URLSearchParams();
    if (filters.collegeId !== "all") search.set("collegeId", String(filters.collegeId));
    if (filters.courseId !== "all") search.set("courseId", String(filters.courseId));
    if (filters.branchId !== "all") search.set("branchId", String(filters.branchId));
    if (filters.batch !== "all") search.set("batch", String(filters.batch));
    if (filters.year !== "all") search.set("year", String(filters.year));
    if (filters.semester !== "all") search.set("semester", String(filters.semester));
    if (filters.section !== "all") search.set("section", String(filters.section));
    if (filters.academicYear) search.set("academicYear", filters.academicYear);
    return search.toString();
  }, [filters]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await apiFetch(`/workload/${encodeURIComponent(params.facultyId)}${query ? `?${query}` : ""}`,
          { cache: "no-store" },
        );
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            typeof body === "object" && body && "message" in body
              ? String((body as { message: string }).message)
              : "Faculty workload not found",
          );
        }
        if (!cancelled) setFaculty(body as FacultyDetail);
      } catch (err) {
        if (!cancelled) {
          setFaculty(null);
          setError(err instanceof Error ? err.message : "Failed to load faculty workload");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [params.facultyId, query]);

  if (loading) {
    return <p className="text-sm text-slate-500">Loading faculty workload…</p>;
  }

  if (error || !faculty) {
    return (
      <div>
        <PageHeader title="Faculty workload" />
        <Card>
          <p className="text-sm text-critical">{error ?? "Faculty not found"}</p>
          <Link href="/staff-workload" className="mt-3 inline-block">
            <Button size="sm" variant="secondary">
              Back to workload
            </Button>
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={faculty.name}
        description={`HRMS / staff code: ${faculty.code}`}
        actions={
          <Link href="/staff-workload">
            <Button size="sm" variant="secondary">
              Back
            </Button>
          </Link>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusBadge status={faculty.status} />
        <span className="text-sm text-slate-500">
          {faculty.periodsPerWeek} periods • {faculty.hoursPerWeek} hours / week
        </span>
      </div>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Department" value={faculty.department} />
        <StatCard label="Subjects" value={faculty.subjects} />
        <StatCard label="Sections" value={faculty.sections} />
        <StatCard label="Theory / Lab periods" value={`${faculty.theory} / ${faculty.lab}`} />
      </div>

      <div className="mb-4 grid gap-3 xl:grid-cols-2">
        {faculty.byDay.map((day) => (
          <Card key={day.dayOfWeek}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-navy-900">{day.dayLabel}</h3>
              <p className="text-xs text-slate-500">
                {day.periods} periods • {day.hours} hrs
              </p>
            </div>
            <ul className="space-y-2 text-sm">
              {day.assignments.map((item) => (
                <li
                  key={item.entryId}
                  className="rounded-md border border-border px-3 py-2"
                >
                  <p className="font-medium text-navy-900">
                    {item.startTime}–{item.endTime} {item.slotLabel ? `• ${item.slotLabel}` : ""}
                  </p>
                  <p className="text-slate-600">
                    {item.subjectCode ?? "—"} {item.subjectName ?? ""}
                  </p>
                  <p className="text-xs text-slate-500">
                    {item.entryType} • Section {item.section ?? "—"} • {item.minutes} min
                    {item.roomLabel ? ` • ${item.roomLabel}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>

      {faculty.assignments.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-600">
            No published CLASS assignments for this faculty in the current filters.
          </p>
        </Card>
      ) : null}

      <Card>
        <h3 className="mb-2 text-base font-semibold text-navy-900">Source</h3>
        <p className="text-sm text-slate-600">{faculty.source}</p>
      </Card>
    </div>
  );
}
