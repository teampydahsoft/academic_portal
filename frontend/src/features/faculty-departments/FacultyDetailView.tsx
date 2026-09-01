"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api";
import { StudentAvatar } from "@/features/students/StudentAvatar";
import { FacultyMenteesPanel } from "./FacultyMenteesPanel";
import { normalizeSectionName } from "./mentoring-section-utils";

type Assignment = {
  entryId: number;
  planId: number;
  dayOfWeek: string;
  entryType: string;
  subjectCode: string | null;
  subjectName: string | null;
  section: string | null;
  batch: string;
  year: number | null;
  semester: number | null;
  collegeId: number;
  courseId: number;
  branchId: number;
  branchName: string | null;
  academicYear: string;
  slotLabel: string | null;
  startTime: string | null;
  endTime: string | null;
  minutes: number;
  roomLabel: string | null;
};

type Workload = {
  periodsPerWeek: number;
  minutesPerWeek: number;
  hoursPerWeek: number;
  theory: number;
  lab: number;
  subjects: number;
  sections: number;
};

type FacultyDetail = {
  hrmsEmployeeId: string;
  staffLinkId: number | null;
  name: string;
  code: string;
  division: string;
  department: string;
  designation: string;
  college: string;
  employeeGroup: string;
  isActive: boolean;
  linkStatus: "linked" | "unlinked";
  assignments: Assignment[];
  workload: Workload | null;
  source: string;
};

const DAY_ORDER = ["MON", "TUE", "WED", "THUR", "FRI", "SAT", "SUN"];
const DAY_LABEL: Record<string, string> = {
  MON: "Monday",
  TUE: "Tuesday",
  WED: "Wednesday",
  THUR: "Thursday",
  FRI: "Friday",
  SAT: "Saturday",
  SUN: "Sunday",
};

type Props = { hrmsId: string };

function formatClassScope(item: Assignment) {
  const sectionName = normalizeSectionName(item.section);
  const sectionLabel = sectionName ? `Sec ${sectionName}` : "All sections";
  const branchLabel = item.branchName?.trim() || "Branch";
  return `${branchLabel} · ${sectionLabel} · ${item.batch} · Y${item.year ?? "?"} S${item.semester ?? "?"}`;
}

export function FacultyDetailView({ hrmsId }: Props) {
  const [faculty, setFaculty] = useState<FacultyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch(`/faculty/${encodeURIComponent(hrmsId)}`, {
          cache: "no-store",
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((body as { message?: string }).message ?? `Error ${res.status}`);
        if (!cancelled) setFaculty(body as FacultyDetail);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [hrmsId]);

  if (loading) return <p className="text-sm text-slate-500">Loading faculty…</p>;

  if (error || !faculty) {
    return (
      <div>
        <PageHeader title="Faculty" />
        <Card>
          <p className="text-sm text-critical">{error ?? "Faculty not found."}</p>
          <Link href="/faculty-departments" className="mt-3 inline-block">
            <Button size="sm" variant="secondary">
              Back
            </Button>
          </Link>
        </Card>
      </div>
    );
  }

  const byDay = DAY_ORDER.map((day) => ({
    day,
    label: DAY_LABEL[day],
    items: faculty.assignments.filter((a) => a.dayOfWeek === day),
  })).filter((g) => g.items.length > 0);

  const mentoringAssignments = faculty.assignments.map((item) => ({
    section: item.section,
    batch: item.batch,
    year: item.year,
    semester: item.semester,
    collegeId: item.collegeId,
    courseId: item.courseId,
    branchId: item.branchId,
    branchName: item.branchName,
    academicYear: item.academicYear,
    planId: item.planId,
  }));

  return (
    <div>
      <PageHeader
        title="Faculty profile"
        description="Staff details, mentoring assignments, and published timetable workload."
        actions={
          <Link href="/faculty-departments">
            <Button size="sm" variant="secondary">
              Back
            </Button>
          </Link>
        }
      />

      <Card className="mb-4">
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start">
          <StudentAvatar name={faculty.name} photo={null} size="lg" className="mx-auto sm:mx-0" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-xl font-semibold text-navy-900">{faculty.name}</h2>
                <p className="mt-1 text-sm text-slate-600">
                  {faculty.designation} · {faculty.division} · {faculty.department}
                </p>
              </div>
              <StatusBadge status={faculty.linkStatus === "linked" ? "Active" : "Pending"} />
            </div>

            <dl className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">HRMS ID</dt>
                <dd className="mt-1 text-sm font-medium text-navy-900">{faculty.hrmsEmployeeId}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Department</dt>
                <dd className="mt-1 text-sm font-medium text-navy-900">{faculty.department}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Employee group</dt>
                <dd className="mt-1 text-sm font-medium text-navy-900">{faculty.employeeGroup}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">College</dt>
                <dd className="mt-1 text-sm font-medium text-navy-900">{faculty.college || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Staff link</dt>
                <dd className="mt-1 text-sm font-medium text-navy-900">
                  {faculty.staffLinkId ? `#${faculty.staffLinkId}` : "Not linked"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Division</dt>
                <dd className="mt-1 text-sm font-medium text-navy-900">{faculty.division}</dd>
              </div>
            </dl>
          </div>
        </div>
      </Card>

      {faculty.staffLinkId ? (
        <FacultyMenteesPanel
          staffLinkId={faculty.staffLinkId}
          facultyName={faculty.name}
          assignments={mentoringAssignments}
        />
      ) : (
        <Card className="mb-4">
          <p className="text-sm text-slate-600">
            Mentoring assignments require an Academic Portal staff link. This faculty will be linked
            automatically when first assigned on a published timetable.
          </p>
        </Card>
      )}

      {faculty.workload ? (
        <div className="mb-4">
          <h2 className="mb-2 text-sm font-semibold text-navy-900">Workload (Published Timetable)</h2>
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {[
              { label: "Periods / Week", value: faculty.workload.periodsPerWeek },
              { label: "Hours / Week", value: faculty.workload.hoursPerWeek },
              { label: "Theory", value: faculty.workload.theory },
              { label: "Lab", value: faculty.workload.lab },
              { label: "Subjects", value: faculty.workload.subjects },
              { label: "Sections", value: faculty.workload.sections },
            ].map(({ label, value }) => (
              <Card key={label}>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
                <p className="mt-1 text-xl font-semibold text-navy-900">{value}</p>
              </Card>
            ))}
          </div>
          {faculty.staffLinkId ? (
            <div className="mt-2">
              <Link href={`/staff-workload/${faculty.staffLinkId}`}>
                <Button size="sm" variant="secondary">
                  Full workload detail →
                </Button>
              </Link>
            </div>
          ) : null}
        </div>
      ) : (
        <Card className="mb-4">
          <p className="text-sm text-slate-600">
            No published timetable assignments — workload cannot be derived.
          </p>
          <p className="mt-1 text-xs text-slate-400">{faculty.source}</p>
        </Card>
      )}

      {byDay.length > 0 ? (
        <div className="mb-4">
          <h2 className="mb-2 text-sm font-semibold text-navy-900">Published Timetable Assignments</h2>
          <div className="grid gap-3 xl:grid-cols-2">
            {byDay.map(({ day, label, items }) => (
              <Card key={day}>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="font-semibold text-navy-900">{label}</h3>
                  <span className="text-xs text-slate-500">
                    {items.length} period{items.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <ul className="space-y-2 text-sm">
                  {items.map((item) => (
                    <li key={item.entryId} className="rounded-md border border-border px-3 py-2">
                      <p className="font-medium text-navy-900">
                        {item.startTime}–{item.endTime}
                        {item.slotLabel ? ` · ${item.slotLabel}` : ""}
                      </p>
                      <p className="text-slate-600">
                        {item.subjectCode ?? "—"} {item.subjectName ?? ""}
                      </p>
                      <p className="text-xs text-slate-500">
                        {item.entryType} · {formatClassScope(item)}
                        {item.roomLabel ? ` · ${item.roomLabel}` : ""} · {item.minutes} min · AY{" "}
                        {item.academicYear}
                      </p>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        </div>
      ) : (
        faculty.linkStatus === "linked" && (
          <Card className="mb-4">
            <p className="text-sm text-slate-600">
              This faculty is linked but has no CLASS assignments on any published timetable.
            </p>
          </Card>
        )
      )}

      <Card>
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Source</p>
        <p className="text-xs text-slate-500">HRMS → ap_staff_link. {faculty.source}</p>
      </Card>
    </div>
  );
}
