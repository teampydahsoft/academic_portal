"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api";
import {
  WorkloadTimetableGrid,
  type FacultyTimetable,
} from "@/features/workload/WorkloadTimetableGrid";

type FacultyDetail = {
  id: string;
  name: string;
  code: string;
  department: string;
  division?: string;
  designation?: string;
  status: string;
  periodsPerWeek: number;
  hoursPerWeek: number;
  subjects: number;
  sections: number;
  theory: number;
  lab: number;
  hoursByDay?: {
    MON: number;
    TUE: number;
    WED: number;
    THUR: number;
    FRI: number;
    SAT: number;
    SUN: number;
  };
  timetable: FacultyTimetable | null;
  source?: string;
};

export function FacultyWorkloadDetailView() {
  const params = useParams<{ facultyId: string }>();
  const [faculty, setFaculty] = useState<FacultyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await apiFetch(`/workload/${encodeURIComponent(params.facultyId)}`, {
          cache: "no-store",
        });
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
  }, [params.facultyId]);

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
        description={[
          `HRMS / staff code: ${faculty.code}`,
          faculty.department && faculty.department !== "—" ? faculty.department : null,
          faculty.designation && faculty.designation !== "—" ? faculty.designation : null,
          faculty.division && faculty.division !== "—" ? faculty.division : null,
        ]
          .filter(Boolean)
          .join(" · ")}
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
        <StatCard label="Branches taught" value={faculty.sections} />
        <StatCard label="Subjects" value={faculty.subjects} />
        <StatCard label="Theory / Lab periods" value={`${faculty.theory} / ${faculty.lab}`} />
      </div>

      {!faculty.timetable ? (
        <Card className="mb-4">
          <p className="text-sm text-slate-600">
            No published CLASS assignments for this faculty.
          </p>
        </Card>
      ) : (
        <WorkloadTimetableGrid timetable={faculty.timetable} />
      )}

      <Card className="mt-4">
        <h3 className="mb-2 text-base font-semibold text-navy-900">Source</h3>
        <p className="text-sm text-slate-600">{faculty.source}</p>
      </Card>
    </div>
  );
}
