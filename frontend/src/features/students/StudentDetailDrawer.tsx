"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";
import { StudentAvatar } from "@/features/students/StudentAvatar";
import type { StudentDetail } from "@/features/students/student-types";

type Props = {
  studentId: string | null;
  open: boolean;
  onClose: () => void;
};

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; student: StudentDetail };

function formatSemester(semester: number | null) {
  if (semester == null) return null;
  return `Semester ${semester}`;
}

/** Display MySQL DATE (YYYY-MM-DD) as dd-mm-yyyy to match Student DB UI. */
function formatDateDmY(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) return iso;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function joinMeta(parts: Array<string | null | undefined>) {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join(" • ");
}

function DetailSkeleton() {
  return (
    <div className="animate-pulse" aria-hidden>
      <div className="border-b border-border px-5 py-5">
        <div className="flex gap-4">
          <div className="h-16 w-16 rounded-full bg-slate-200" />
          <div className="flex-1 space-y-2">
            <div className="h-5 w-2/3 rounded bg-slate-200" />
            <div className="h-3 w-1/3 rounded bg-slate-200" />
            <div className="h-3 w-1/2 rounded bg-slate-200" />
          </div>
          <div className="h-6 w-16 rounded bg-slate-200" />
        </div>
      </div>
      <div className="flex gap-2 border-b border-border px-5 py-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-8 w-24 rounded-md bg-slate-200" />
        ))}
      </div>
      <div className="px-5 py-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-16 rounded-md bg-slate-200" />
          ))}
        </div>
      </div>
    </div>
  );
}

function hasValues(fields: Array<{ value?: string | number | null }>) {
  return fields.some((field) => field.value != null && field.value !== "");
}

type DetailTab = "academic" | "personal" | "contact" | "attendance";

const TAB_META: Record<
  DetailTab,
  {
    label: string;
    accent: string;
    active: string;
    panel: string;
    chip: string;
    cardEdge: string;
  }
> = {
  academic: {
    label: "Academic",
    accent: "border-info",
    active: "bg-blue-50 text-info border-info",
    panel: "border-info/30 bg-blue-50/40",
    chip: "bg-blue-100 text-info",
    cardEdge: "border-l-info",
  },
  personal: {
    label: "Personal",
    accent: "border-navy-800",
    active: "bg-slate-100 text-navy-900 border-navy-800",
    panel: "border-slate-300 bg-slate-50/70",
    chip: "bg-slate-200 text-navy-800",
    cardEdge: "border-l-navy-800",
  },
  contact: {
    label: "Contact",
    accent: "border-success",
    active: "bg-green-50 text-success border-success",
    panel: "border-success/30 bg-green-50/40",
    chip: "bg-green-100 text-success",
    cardEdge: "border-l-success",
  },
  attendance: {
    label: "Attendance",
    accent: "border-warning",
    active: "bg-amber-50 text-warning border-warning",
    panel: "border-warning/30 bg-amber-50/40",
    chip: "bg-amber-100 text-warning",
    cardEdge: "border-l-warning",
  },
};

function FieldCard({
  label,
  value,
  edgeClass,
}: {
  label: string;
  value: string | number;
  edgeClass: string;
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-border border-l-4 bg-white p-3 shadow-sm",
        edgeClass,
      )}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1.5 break-words text-sm font-medium text-navy-900">{value}</p>
    </div>
  );
}

function ColoredInfoGrid({
  fields,
  edgeClass,
}: {
  fields: Array<{ label: string; value?: string | number | null }>;
  edgeClass: string;
}) {
  const visible = fields.filter(
    (field): field is { label: string; value: string | number } =>
      field.value != null && field.value !== "",
  );
  if (visible.length === 0) {
    return <p className="text-sm text-slate-500">No details available in this section.</p>;
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {visible.map((field) => (
        <FieldCard
          key={field.label}
          label={field.label}
          value={field.value}
          edgeClass={edgeClass}
        />
      ))}
    </div>
  );
}

function AttendanceBar({ pct, periodLabel }: { pct: number; periodLabel: string }) {
  const capped = Math.max(0, Math.min(100, pct));
  const tone =
    capped > 0 && capped < 65
      ? "bg-critical"
      : capped > 0 && capped < 75
        ? "bg-warning"
        : "bg-success";
  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center justify-between gap-3 text-xs text-slate-500">
        <span className="min-w-0 break-words">{periodLabel}</span>
        <span className="shrink-0 font-medium text-navy-900">{pct}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={cn("h-full rounded-full transition-all", tone)} style={{ width: `${capped}%` }} />
      </div>
    </div>
  );
}

export function StudentDetailBody({ student }: { student: StudentDetail }) {
  const semesterOptions = student.attendanceSemesters ?? [];
  const currentKey =
    student.attendancePeriod?.yearSemLabel ??
    (student.year != null && student.semester != null
      ? `${student.year}-${student.semester}`
      : semesterOptions.find((item) => item.isCurrent)?.key ??
        semesterOptions[0]?.key ??
        "");

  const [selectedKey, setSelectedKey] = useState(currentKey);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [attendanceError, setAttendanceError] = useState<string | null>(null);
  const [attendanceView, setAttendanceView] = useState({
    attendance: student.attendance,
    present: student.present,
    absent: student.absent,
    workingDays: student.workingDays,
    risk: student.risk,
    attendancePeriod: student.attendancePeriod,
  });

  useEffect(() => {
    setSelectedKey(currentKey);
    setAttendanceView({
      attendance: student.attendance,
      present: student.present,
      absent: student.absent,
      workingDays: student.workingDays,
      risk: student.risk,
      attendancePeriod: student.attendancePeriod,
    });
    setAttendanceError(null);
  }, [student.id, currentKey, student.attendance, student.present, student.absent, student.workingDays, student.risk, student.attendancePeriod]);

  useEffect(() => {
    const option = semesterOptions.find((item) => item.key === selectedKey);
    if (!selectedKey || !option) return;
    const { yearOfStudy, semesterNumber } = option;

    // Current semester data already loaded with the student payload.
    if (selectedKey === currentKey) {
      setAttendanceView({
        attendance: student.attendance,
        present: student.present,
        absent: student.absent,
        workingDays: student.workingDays,
        risk: student.risk,
        attendancePeriod: student.attendancePeriod,
      });
      setAttendanceError(null);
      setAttendanceLoading(false);
      return;
    }

    let cancelled = false;
    async function loadSemesterAttendance() {
      setAttendanceLoading(true);
      setAttendanceError(null);
      try {
        const params = new URLSearchParams({
          year: String(yearOfStudy),
          semester: String(semesterNumber),
        });
        const response = await apiFetch(`/students/${student.id}/attendance?${params}`,
          { cache: "no-store" },
        );
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            typeof body === "object" && body && "message" in body
              ? String((body as { message: string }).message)
              : "Unable to load semester attendance.",
          );
        }
        if (!cancelled) {
          setAttendanceView({
            attendance: Number(body.attendance ?? 0),
            present: Number(body.present ?? 0),
            absent: Number(body.absent ?? 0),
            workingDays: Number(body.workingDays ?? 0),
            risk: String(body.risk ?? "Low"),
            attendancePeriod: body.attendancePeriod,
          });
        }
      } catch (error) {
        if (!cancelled) {
          setAttendanceError(
            error instanceof Error ? error.message : "Unable to load semester attendance.",
          );
        }
      } finally {
        if (!cancelled) setAttendanceLoading(false);
      }
    }
    void loadSemesterAttendance();
    return () => {
      cancelled = true;
    };
  }, [
    selectedKey,
    currentKey,
    semesterOptions,
    student.id,
    student.attendance,
    student.present,
    student.absent,
    student.workingDays,
    student.risk,
    student.attendancePeriod,
  ]);

  const academicFields = [
    { label: "College", value: student.college },
    { label: "Course", value: student.course },
    { label: "Branch", value: student.branch },
    { label: "Batch", value: student.batch },
    { label: "Year", value: student.year },
    { label: "Semester", value: formatSemester(student.semester) },
    {
      label: "Year-Sem",
      value: student.attendancePeriod?.yearSemLabel ?? null,
    },
    {
      label: "Sem start date",
      value: formatDateDmY(student.attendancePeriod?.startDate),
    },
    {
      label: "Sem end date",
      value: formatDateDmY(student.attendancePeriod?.endDate),
    },
    { label: "Section", value: student.section },
    { label: "Admission type", value: student.admissionType },
    { label: "Admission date", value: student.admissionDate },
    { label: "Previous college", value: student.previousCollege },
  ];

  const personalFields = [
    { label: "Full name", value: student.name },
    { label: "Date of birth", value: student.dob },
    { label: "Gender", value: student.gender },
    { label: "Mobile", value: student.mobile },
    { label: "Email", value: student.email },
    { label: "Address", value: student.address },
    { label: "City / Village", value: student.cityVillage },
    { label: "Mandal", value: student.mandal },
    { label: "District", value: student.district },
  ];

  const contactFields = [
    { label: "Student mobile", value: student.mobile },
    { label: "Student email", value: student.email },
    { label: "Father / guardian", value: student.fatherName },
    { label: "Parent mobile 1", value: student.parentMobile1 },
    { label: "Parent mobile 2", value: student.parentMobile2 },
    { label: "Preferred mobile", value: student.preferredMobile },
  ];

  const statusFields = [
    { label: "Current status", value: student.status },
    { label: "Year", value: student.year },
    { label: "Semester", value: formatSemester(student.semester) },
    { label: "Batch", value: student.batch },
    { label: "Section", value: student.section },
    { label: "Scholar status", value: student.scholarStatus },
    { label: "Fee status", value: student.feeStatus },
    { label: "Registration status", value: student.registrationStatus },
    { label: "Certificates status", value: student.certificatesStatus },
  ];

  const tabs = useMemo(() => {
    const list: DetailTab[] = [];
    if (hasValues(academicFields)) list.push("academic");
    if (hasValues(personalFields)) list.push("personal");
    if (hasValues(contactFields)) list.push("contact");
    list.push("attendance");
    return list;
  }, [student]);

  const [tab, setTab] = useState<DetailTab>("academic");

  useEffect(() => {
    setTab(tabs[0] ?? "attendance");
  }, [student.id, tabs]);

  const academicLine = joinMeta([
    student.course,
    student.branch,
    student.batch ? `Batch ${student.batch}` : null,
  ]);
  const yearLine = joinMeta([
    student.year != null ? `Year ${student.year}` : null,
    formatSemester(student.semester),
    student.section ? `Section ${student.section}` : null,
  ]);

  const active = TAB_META[tab];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border px-5 py-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-4">
            <StudentAvatar name={student.name} photo={student.photo} size="lg" />
            <div className="min-w-0">
              <h3 className="text-lg font-semibold text-navy-900">{student.name}</h3>
              <p className="mt-1 text-sm text-slate-600">
                Admission No: <span className="font-medium text-navy-900">{student.admissionNo}</span>
              </p>
              {student.rollNo ? (
                <p className="mt-0.5 text-sm text-slate-600">
                  Roll No: <span className="font-medium text-navy-900">{student.rollNo}</span>
                </p>
              ) : null}
              {academicLine ? <p className="mt-2 text-sm text-slate-600">{academicLine}</p> : null}
              {yearLine ? <p className="text-sm text-slate-600">{yearLine}</p> : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end">
            <StatusBadge status={student.status} />
            <StatusBadge status={student.risk} />
            <p className="text-sm font-medium text-navy-900">{student.attendance}% Attend.</p>
          </div>
        </div>
      </div>

      <div
        className="flex flex-wrap gap-2 border-b border-border bg-slate-50/80 px-4 py-3"
        role="tablist"
        aria-label="Student detail sections"
      >
        {tabs.map((key) => {
          const meta = TAB_META[key];
          const selected = tab === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={selected}
              id={`student-tab-${key}`}
              aria-controls={`student-panel-${key}`}
              onClick={() => setTab(key)}
              className={cn(
                "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                selected
                  ? meta.active
                  : "border-transparent bg-white text-slate-600 hover:bg-slate-100",
              )}
            >
              {meta.label}
            </button>
          );
        })}
      </div>

      <div
        id={`student-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`student-tab-${tab}`}
        className={cn("min-h-0 flex-1 overflow-y-auto border-t-4 px-5 py-5", active.accent, active.panel)}
      >
        <div className="mb-4 flex items-center gap-2">
          <span className={cn("rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide", active.chip)}>
            {active.label}
          </span>
          <h4 className="text-sm font-semibold text-navy-900">
            {tab === "academic"
              ? "Academic Information"
              : tab === "personal"
                ? "Personal Information"
                : tab === "contact"
                  ? "Contact / Guardian"
                  : "Attendance & Academic Status"}
          </h4>
        </div>

        {tab === "academic" ? (
          <ColoredInfoGrid fields={academicFields} edgeClass={active.cardEdge} />
        ) : null}

        {tab === "personal" ? (
          <ColoredInfoGrid fields={personalFields} edgeClass={active.cardEdge} />
        ) : null}

        {tab === "contact" ? (
          <ColoredInfoGrid fields={contactFields} edgeClass={active.cardEdge} />
        ) : null}

        {tab === "attendance" ? (
          <div className="space-y-4">
            <div className="rounded-md border border-border bg-white p-4 shadow-sm">
              {semesterOptions.length > 0 ? (
                <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <label className="block min-w-[220px] text-sm">
                    <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Semester
                    </span>
                    <select
                      className="h-9 w-full rounded-md border border-border bg-white px-2 text-sm text-navy-900 outline-none focus:border-navy-800"
                      value={selectedKey}
                      onChange={(e) => setSelectedKey(e.target.value)}
                      aria-label="Select semester for attendance"
                    >
                      {semesterOptions.map((option) => (
                        <option key={option.key} value={option.key}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {attendanceLoading ? (
                    <p className="text-xs text-slate-500">Loading semester attendance…</p>
                  ) : null}
                </div>
              ) : null}

              {attendanceError ? (
                <p className="mb-3 text-sm text-critical">{attendanceError}</p>
              ) : null}

              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div className="rounded-md border-l-4 border-l-info bg-blue-50/60 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Attendance
                  </p>
                  <p className="mt-1 text-xl font-semibold text-navy-900">
                    {attendanceView.attendance}%
                  </p>
                </div>
                <div className="rounded-md border-l-4 border-l-success bg-green-50/60 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Present
                  </p>
                  <p className="mt-1 text-xl font-semibold text-navy-900">
                    {attendanceView.present}
                  </p>
                </div>
                <div className="rounded-md border-l-4 border-l-critical bg-red-50/60 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Absent
                  </p>
                  <p className="mt-1 text-xl font-semibold text-navy-900">
                    {attendanceView.absent}
                  </p>
                </div>
                <div className="rounded-md border-l-4 border-l-warning bg-amber-50/60 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Working days
                  </p>
                  <p className="mt-1 text-xl font-semibold text-navy-900">
                    {attendanceView.workingDays}
                  </p>
                </div>
              </div>
              <AttendanceBar
                pct={attendanceView.attendance}
                periodLabel={
                  attendanceView.attendancePeriod?.label ??
                  "Last 90 days (semester dates unavailable)"
                }
              />
              {attendanceView.attendancePeriod?.source === "semester" ? (
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <div className="rounded-md border border-border bg-slate-50 px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Year-Sem
                    </p>
                    <p className="mt-0.5 font-medium text-navy-900">
                      {attendanceView.attendancePeriod.yearSemLabel ?? "—"}
                    </p>
                  </div>
                  <div className="rounded-md border border-border bg-slate-50 px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Start date
                    </p>
                    <p className="mt-0.5 font-medium text-navy-900">
                      {formatDateDmY(attendanceView.attendancePeriod.startDate) ?? "—"}
                    </p>
                  </div>
                  <div className="rounded-md border border-border bg-slate-50 px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      End date
                    </p>
                    <p className="mt-0.5 font-medium text-navy-900">
                      {formatDateDmY(attendanceView.attendancePeriod.endDate) ?? "—"}
                    </p>
                  </div>
                </div>
              ) : null}
              <div className="mt-3 flex items-center gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Risk</span>
                <StatusBadge status={attendanceView.risk} />
              </div>
            </div>
            {hasValues(statusFields) ? (
              <ColoredInfoGrid fields={statusFields} edgeClass={active.cardEdge} />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function StudentDetailDrawer({ studentId, open, onClose }: Props) {
  const titleId = useId();
  const [state, setState] = useState<LoadState>({ status: "idle" });

  const load = useCallback(async (id: string) => {
    setState({ status: "loading" });
    try {
      const response = await apiFetch(`/students/${id}`, {
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message =
          typeof body === "object" && body && "message" in body
            ? String((body as { message: string }).message)
            : "Unable to load student details.";
        throw new Error(message);
      }
      setState({ status: "ready", student: body as StudentDetail });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Unable to load student details.",
      });
    }
  }, []);

  useEffect(() => {
    if (!open || !studentId) {
      setState({ status: "idle" });
      return;
    }
    void load(studentId);
  }, [open, studentId, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-3 sm:p-6">
      <button
        type="button"
        className="absolute inset-0 bg-navy-950/45"
        aria-label="Close student details"
        onClick={onClose}
      />
      <div
        className="relative z-10 flex max-h-[min(92vh,900px)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 id={titleId} className="text-lg font-semibold text-navy-900">
              Student Details
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">From Student Database</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label="Close student details"
            onClick={onClose}
          >
            Close
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {state.status === "loading" || state.status === "idle" ? <DetailSkeleton /> : null}

          {state.status === "error" ? (
            <div className="px-5 py-10">
              <p className="text-sm font-medium text-navy-900">Unable to load student details.</p>
              <p className="mt-1 text-sm text-critical">{state.message}</p>
              <Button
                className="mt-4"
                size="sm"
                variant="secondary"
                onClick={() => studentId && void load(studentId)}
              >
                Retry
              </Button>
            </div>
          ) : null}

          {state.status === "ready" ? <StudentDetailBody student={state.student} /> : null}
        </div>
      </div>
    </div>
  );
}
