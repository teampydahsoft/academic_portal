"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  CheckCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  History,
  Phone,
  ShieldAlert,
  User,
} from "lucide-react";
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

type DetailTab = "academic" | "attendance" | "complaints" | "personal" | "contact";

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
  attendance: {
    label: "Attendance",
    accent: "border-purple-600",
    active: "bg-purple-50 text-purple-700 border-purple-600",
    panel: "border-purple-300 bg-purple-50/40",
    chip: "bg-purple-100 text-purple-700",
    cardEdge: "border-l-purple-600",
  },
  complaints: {
    label: "Complaints",
    accent: "border-orange-500",
    active: "bg-orange-50 text-orange-700 border-orange-500",
    panel: "border-orange-300 bg-orange-50/40",
    chip: "bg-orange-100 text-orange-700",
    cardEdge: "border-l-orange-500",
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

  const personalFields = useMemo(
    () => [
      { label: "Full name", value: student.name },
      { label: "Date of birth", value: formatDateDmY(student.dob) },
      { label: "Gender", value: student.gender },
      { label: "Mobile", value: student.mobile },
      { label: "Email", value: student.email },
      { label: "Address", value: student.address },
      { label: "City / Village", value: student.cityVillage },
      { label: "Mandal", value: student.mandal },
      { label: "District", value: student.district },
    ],
    [
      student.name,
      student.dob,
      student.gender,
      student.mobile,
      student.email,
      student.address,
      student.cityVillage,
      student.mandal,
      student.district,
    ],
  );

  const contactFields = useMemo(
    () => [
      { label: "Student mobile", value: student.mobile },
      { label: "Student email", value: student.email },
      { label: "Father / guardian", value: student.fatherName },
      { label: "Parent mobile 1", value: student.parentMobile1 },
      { label: "Parent mobile 2", value: student.parentMobile2 },
      { label: "Preferred mobile", value: student.preferredMobile },
    ],
    [
      student.mobile,
      student.email,
      student.fatherName,
      student.parentMobile1,
      student.parentMobile2,
      student.preferredMobile,
    ],
  );

  const tabs = useMemo(() => {
    const list: DetailTab[] = [];
    list.push("academic");
    list.push("attendance");
    list.push("complaints");
    if (hasValues(personalFields)) list.push("personal");
    if (hasValues(contactFields)) list.push("contact");
    return list;
  }, [personalFields, contactFields]);

  const [tab, setTab] = useState<DetailTab>("academic");
  const [expandedHistory, setExpandedHistory] = useState<Record<number, boolean>>({});

  // Only reset active tab to "academic" when a different student is loaded
  useEffect(() => {
    setTab("academic");
    if (student.complaints && student.complaints.length > 0) {
      setExpandedHistory({ [student.complaints[0].id]: true });
    } else {
      setExpandedHistory({});
    }
  }, [student.id]);

  const toggleComplaintHistory = (id: number) => {
    setExpandedHistory((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const openComplaintInComplaintsTab = (complaintId: number) => {
    setTab("complaints");
    setExpandedHistory((prev) => ({
      ...prev,
      [complaintId]: true,
    }));
  };

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
          const complaintCount = student.complaints?.length ?? 0;
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
                "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                selected
                  ? meta.active
                  : "border-transparent bg-white text-slate-600 hover:bg-slate-100",
              )}
            >
              <span>{meta.label}</span>
              {key === "complaints" && complaintCount > 0 ? (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                    selected ? "bg-orange-200 text-orange-900" : "bg-orange-100 text-orange-700",
                  )}
                >
                  {complaintCount}
                </span>
              ) : null}
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
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={cn("rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wide", active.chip)}>
              {active.label}
            </span>
            <h4 className="text-sm font-semibold text-navy-900">
              {tab === "academic"
                ? "Academic Overview & Quick Navigation"
                : tab === "attendance"
                  ? "Detailed Attendance Records"
                  : tab === "complaints"
                    ? "Complaints & Mentoring Cases"
                    : tab === "personal"
                      ? "Personal Information"
                      : "Contact / Guardian Details"}
            </h4>
          </div>
          {tab !== "academic" ? (
            <button
              type="button"
              onClick={() => setTab("academic")}
              className="inline-flex items-center gap-1 text-xs font-semibold text-navy-700 hover:text-navy-900 hover:underline"
            >
              ← Back to Overview
            </button>
          ) : null}
        </div>

        {tab === "academic" ? (
          <div className="flex flex-col gap-4">
            {/* Top Grid: Attendance & Complaints Snapshots */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* 1. Attendance Snapshot Card */}
              <div className="flex flex-col rounded-xl border border-purple-200 bg-white p-4 shadow-sm hover:border-purple-300 transition-colors">
                <div className="mb-3 flex items-center justify-between border-b border-purple-100 pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-100 text-purple-700">
                      <Calendar className="h-4 w-4" />
                    </span>
                    <div>
                      <h3 className="text-sm font-bold text-navy-900">Attendance Overview</h3>
                      <p className="text-[11px] text-slate-500">
                        {attendanceView.attendancePeriod?.label ?? "Current Attendance Window"}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTab("attendance")}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-purple-700 hover:text-purple-900 hover:underline"
                  >
                    View Details <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="grid grid-cols-4 gap-2 mb-3">
                  <div className="rounded-lg border border-purple-100 bg-purple-50/50 p-2 text-center">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Overall</p>
                    <p className="mt-0.5 text-base font-bold text-purple-700">{attendanceView.attendance}%</p>
                  </div>
                  <div className="rounded-lg border border-green-100 bg-green-50/50 p-2 text-center">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Present</p>
                    <p className="mt-0.5 text-base font-bold text-success">{attendanceView.present}</p>
                  </div>
                  <div className="rounded-lg border border-red-100 bg-red-50/50 p-2 text-center">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Absent</p>
                    <p className="mt-0.5 text-base font-bold text-critical">{attendanceView.absent}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-center">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Working</p>
                    <p className="mt-0.5 text-base font-bold text-navy-900">{attendanceView.workingDays}</p>
                  </div>
                </div>

                <AttendanceBar
                  pct={attendanceView.attendance}
                  periodLabel={attendanceView.attendancePeriod?.label ?? "Current period"}
                />

                <div className="mt-3 flex items-center justify-between pt-2 border-t border-slate-100 text-xs text-slate-500">
                  <div className="flex items-center gap-1.5">
                    <span>Risk:</span>
                    <StatusBadge status={attendanceView.risk} />
                  </div>
                  <button
                    type="button"
                    onClick={() => setTab("attendance")}
                    className="font-medium text-purple-700 hover:underline"
                  >
                    Change semester →
                  </button>
                </div>
              </div>

              {/* 2. Complaints & Mentoring Snapshot Card */}
              <div className="flex flex-col rounded-xl border border-orange-200 bg-white p-4 shadow-sm hover:border-orange-300 transition-colors">
                <div className="mb-3 flex items-center justify-between border-b border-orange-100 pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-orange-100 text-orange-700">
                      <AlertTriangle className="h-4 w-4" />
                    </span>
                    <div>
                      <h3 className="text-sm font-bold text-navy-900">Complaints & Risks</h3>
                      <p className="text-[11px] text-slate-500">
                        {student.complaints && student.complaints.length > 0
                          ? `${student.complaints.length} active case(s) recorded`
                          : "Mentoring case records"}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (student.complaints && student.complaints.length > 0) {
                        openComplaintInComplaintsTab(student.complaints[0].id);
                      } else {
                        setTab("complaints");
                      }
                    }}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-orange-700 hover:text-orange-900 hover:underline"
                  >
                    View Timeline <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>

                {student.complaints && student.complaints.length > 0 ? (
                  <div className="flex flex-1 flex-col justify-between">
                    {(() => {
                      const latest = student.complaints[0];
                      const totalActions = (latest.interventions?.length ?? 0) + (latest.events?.length ?? 0);
                      return (
                        <div className="rounded-lg border border-orange-100 bg-orange-50/40 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-navy-900 text-sm">{latest.riskType}</span>
                            <StatusBadge status={latest.status} />
                          </div>
                          <p className="mt-1 line-clamp-2 text-xs text-slate-600">
                            {latest.initialNotes || latest.riskReason || "No details provided"}
                          </p>
                          {latest.initialNotes && latest.riskReason && latest.riskReason !== latest.initialNotes ? (
                            <p className="mt-0.5 line-clamp-1 text-[11px] text-slate-400">
                              Trigger: {latest.riskReason}
                            </p>
                          ) : null}
                          <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 font-medium">
                            <span className="capitalize text-orange-700 bg-orange-100/70 px-1.5 py-0.5 rounded border border-orange-200">
                              {latest.severity} Priority
                            </span>
                            <span>Raised by: <strong className="text-navy-900">{latest.openedByName || "Staff"}</strong></span>
                            <span>•</span>
                            <span>{formatDateDmY(latest.openedAt)}</span>
                            <span>•</span>
                            <span>{totalActions} history action(s)</span>
                          </div>
                        </div>
                      );
                    })()}

                    <div className="mt-3 flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                      <span className="text-slate-500 font-medium">
                        {student.complaints.length > 1
                          ? `+${student.complaints.length - 1} additional complaint(s)`
                          : "Complete history available"}
                      </span>
                      <button
                        type="button"
                        onClick={() => openComplaintInComplaintsTab(student.complaints![0].id)}
                        className="font-semibold text-orange-700 hover:underline"
                      >
                        Open Full History →
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/50 p-4 text-center">
                    <CheckCircle className="h-6 w-6 text-success mb-1" />
                    <p className="text-xs font-semibold text-navy-900">Clear Record</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">No active complaints or risks logged for this student.</p>
                    <button
                      type="button"
                      onClick={() => setTab("complaints")}
                      className="mt-2 text-xs font-medium text-orange-600 hover:underline"
                    >
                      View Complaints Panel →
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Middle Grid: Academic & Administration Details */}
            <div className="flex flex-col rounded-xl border border-border bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-2.5">
                <h3 className="text-sm font-bold text-navy-900">Academic & Administration Profile</h3>
                <span className="text-xs font-medium text-slate-500">Student Database Records</span>
              </div>
              
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Program / Branch</p>
                  <p className="mt-1 font-semibold text-sm text-navy-900">{student.course || "—"} - {student.branch || "—"}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{student.college || "—"}</p>
                </div>
                <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Year / Sem / Section</p>
                  <p className="mt-1 font-semibold text-sm text-navy-900">
                    {joinMeta([student.year != null ? `Year ${student.year}` : null, formatSemester(student.semester)]) || "—"}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {joinMeta([student.batch ? `Batch ${student.batch}` : null, student.section ? `Sec ${student.section}` : null]) || "—"}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Admission Details</p>
                  <p className="mt-1 font-semibold text-sm text-navy-900">{student.admissionNo || "—"}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {joinMeta([student.admissionType, formatDateDmY(student.admissionDate)]) || "—"}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Administrative Status</p>
                  <div className="mt-1 flex flex-col gap-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Fee:</span>
                      <span className={cn("font-semibold", student.feeStatus === "Paid" ? "text-success" : "text-navy-900")}>
                        {student.feeStatus || "—"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Reg:</span>
                      <span className="font-semibold text-navy-900">{student.registrationStatus || "—"}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Grid: Personal, Contact & Marks Snapshots */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              {/* Personal Info Snapshot Card */}
              <div className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-300 transition-colors">
                <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-navy-800">
                      <User className="h-4 w-4" />
                    </span>
                    <div>
                      <h3 className="text-sm font-bold text-navy-900">Personal Details</h3>
                    </div>
                  </div>
                  {hasValues(personalFields) ? (
                    <button
                      type="button"
                      onClick={() => setTab("personal")}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-navy-800 hover:underline"
                    >
                      View All <ArrowRight className="h-3 w-3" />
                    </button>
                  ) : null}
                </div>
                
                <div className="flex flex-col gap-2 text-xs">
                  <div className="flex justify-between rounded-md bg-slate-50 px-2.5 py-1.5">
                    <span className="text-slate-500">DOB:</span>
                    <span className="font-medium text-navy-900">{formatDateDmY(student.dob) || "—"}</span>
                  </div>
                  <div className="flex justify-between rounded-md bg-slate-50 px-2.5 py-1.5">
                    <span className="text-slate-500">Gender:</span>
                    <span className="font-medium text-navy-900">{student.gender || "—"}</span>
                  </div>
                  <div className="flex justify-between rounded-md bg-slate-50 px-2.5 py-1.5">
                    <span className="text-slate-500">Location:</span>
                    <span className="font-medium text-navy-900 truncate max-w-[150px]">
                      {joinMeta([student.cityVillage, student.district]) || "—"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Contact & Guardian Snapshot Card */}
              <div className="flex flex-col rounded-xl border border-green-200 bg-white p-4 shadow-sm hover:border-green-300 transition-colors">
                <div className="mb-3 flex items-center justify-between border-b border-green-100 pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-green-100 text-success">
                      <Phone className="h-4 w-4" />
                    </span>
                    <div>
                      <h3 className="text-sm font-bold text-navy-900">Contact & Guardian</h3>
                    </div>
                  </div>
                  {hasValues(contactFields) ? (
                    <button
                      type="button"
                      onClick={() => setTab("contact")}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-success hover:underline"
                    >
                      View All <ArrowRight className="h-3 w-3" />
                    </button>
                  ) : null}
                </div>

                <div className="flex flex-col gap-2 text-xs">
                  <div className="flex justify-between rounded-md bg-slate-50 px-2.5 py-1.5">
                    <span className="text-slate-500">Student:</span>
                    <span className="font-medium text-navy-900">{student.mobile || "—"}</span>
                  </div>
                  <div className="flex justify-between rounded-md bg-slate-50 px-2.5 py-1.5">
                    <span className="text-slate-500">Parent:</span>
                    <span className="font-medium text-navy-900">{student.parentMobile1 || student.parentMobile2 || "—"}</span>
                  </div>
                  <div className="flex justify-between rounded-md bg-slate-50 px-2.5 py-1.5">
                    <span className="text-slate-500">Father:</span>
                    <span className="font-medium text-navy-900 truncate max-w-[150px]">{student.fatherName || "—"}</span>
                  </div>
                </div>
              </div>

              {/* Marks Card */}
              <div className="flex flex-col rounded-xl border border-border bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-2.5">
                  <h3 className="text-sm font-bold text-navy-900">Marks</h3>
                  <span className="text-xs text-slate-400">Examinations</span>
                </div>
                <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-slate-200 bg-slate-50/50 p-3 text-center">
                  <p className="text-xs text-slate-500">Marks and exam results will appear here once published.</p>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {tab === "attendance" ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* 1. Attendance Panel */}
            <div className="flex flex-col rounded-md border border-border bg-white p-4 shadow-sm lg:col-span-2">
              <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-base font-semibold text-navy-900">Attendance</h3>
              </div>
              
              {semesterOptions.length > 0 ? (
                <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <label className="block min-w-[140px] text-sm">
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
                    <p className="text-xs text-slate-500">Loading…</p>
                  ) : null}
                </div>
              ) : null}

              {attendanceError ? (
                <p className="mb-3 text-sm text-critical">{attendanceError}</p>
              ) : null}

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md border-l-4 border-l-info bg-blue-50/60 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Attendance
                  </p>
                  <p className="mt-1 text-lg font-semibold text-navy-900">
                    {attendanceView.attendance}%
                  </p>
                </div>
                <div className="rounded-md border-l-4 border-l-success bg-green-50/60 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Present
                  </p>
                  <p className="mt-1 text-lg font-semibold text-navy-900">
                    {attendanceView.present}
                  </p>
                </div>
                <div className="rounded-md border-l-4 border-l-critical bg-red-50/60 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Absent
                  </p>
                  <p className="mt-1 text-lg font-semibold text-navy-900">
                    {attendanceView.absent}
                  </p>
                </div>
                <div className="rounded-md border-l-4 border-l-warning bg-amber-50/60 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Working days
                  </p>
                  <p className="mt-1 text-lg font-semibold text-navy-900">
                    {attendanceView.workingDays}
                  </p>
                </div>
              </div>
              <div className="mt-2">
                <AttendanceBar
                  pct={attendanceView.attendance}
                  periodLabel={
                    attendanceView.attendancePeriod?.label ??
                    "Last 90 days (semester dates unavailable)"
                  }
                />
              </div>
              {attendanceView.attendancePeriod?.source === "semester" ? (
                <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
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
              <div className="mt-4 flex items-center gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Risk</span>
                <StatusBadge status={attendanceView.risk} />
              </div>
            </div>
          </div>
        ) : null}

        {tab === "complaints" ? (
          <div className="flex flex-col gap-4">
            {student.complaints && student.complaints.length > 0 ? (
              <div className="flex flex-col gap-4">
                {student.complaints.map((complaint) => {
                  const isExpanded = Boolean(expandedHistory[complaint.id]);
                  const historyCount =
                    1 + (complaint.interventions?.length ?? 0) + (complaint.events?.length ?? 0);

                  return (
                    <div
                      key={complaint.id}
                      className="flex flex-col rounded-xl border border-border bg-white shadow-sm overflow-hidden"
                    >
                      {/* Card Header & Summary */}
                      <div className="border-b border-slate-100 bg-slate-50/80 px-5 py-4">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <h3 className="text-base font-bold text-navy-900">
                              {complaint.riskType}
                            </h3>
                            <StatusBadge status={complaint.status} />
                            <span className="capitalize text-orange-700 bg-orange-100/70 px-2 py-0.5 rounded border border-orange-200 font-semibold text-xs">
                              {complaint.severity} Priority
                            </span>
                          </div>

                          {/* History Button to toggle stages and timeline */}
                          <button
                            type="button"
                            onClick={() => toggleComplaintHistory(complaint.id)}
                            className={cn(
                              "inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold shadow-xs transition-colors",
                              isExpanded
                                ? "border-navy-900 bg-navy-900 text-white"
                                : "border-slate-300 bg-white text-navy-900 hover:bg-slate-100 hover:border-slate-400"
                            )}
                          >
                            <History className={cn("h-3.5 w-3.5", isExpanded ? "text-orange-300" : "text-orange-600")} />
                            <span>{isExpanded ? "Hide History" : "History & Stages"}</span>
                            <span
                              className={cn(
                                "rounded-full px-1.5 py-0.2 text-[10px] font-bold",
                                isExpanded ? "bg-navy-800 text-slate-200" : "bg-slate-100 text-slate-700"
                              )}
                            >
                              {historyCount}
                            </span>
                            {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                          </button>
                        </div>

                        {/* Complaint Reason / Statement */}
                        <p className="text-sm font-medium text-slate-800 mt-2.5">
                          {complaint.initialNotes || complaint.riskReason || "No details provided"}
                        </p>
                        {complaint.initialNotes && complaint.riskReason && complaint.riskReason !== complaint.initialNotes ? (
                          <p className="text-xs text-slate-500 mt-1">
                            <span className="font-semibold text-slate-600">Trigger metric:</span> {complaint.riskReason}
                          </p>
                        ) : null}

                        {/* Summary metadata: Who raised that & timestamps */}
                        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-600 font-medium">
                          <div className="flex items-center gap-1.5">
                            <User className="h-3.5 w-3.5 text-slate-400" />
                            <span>
                              Raised by: <strong className="font-semibold text-navy-900">{complaint.openedByName || "Staff / Faculty"}</strong>
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Calendar className="h-3.5 w-3.5 text-slate-400" />
                            <span>
                              Opened on: <strong className="font-semibold text-navy-900">{formatDateDmY(complaint.openedAt)}</strong>
                            </span>
                          </div>
                          {complaint.resolvedAt ? (
                            <div className="flex items-center gap-1.5 text-success">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              <span>
                                Resolved: <strong>{formatDateDmY(complaint.resolvedAt)}</strong>
                              </span>
                            </div>
                          ) : null}
                        </div>
                      </div>

                      {/* Expandable History, Stages & Timeline Section */}
                      {isExpanded ? (
                        <div className="px-5 py-4 bg-white space-y-4">
                          {/* 1. Who Raised It Detail Banner */}
                          <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3.5">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                              <div className="flex items-center gap-3">
                                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-info">
                                  <User className="h-4 w-4" />
                                </div>
                                <div>
                                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                                    Complaint Initiated / Raised By
                                  </p>
                                  <p className="font-semibold text-sm text-navy-900">
                                    {complaint.openedByName || "Staff / Faculty Member"}
                                  </p>
                                </div>
                              </div>
                              <div className="text-left sm:text-right text-xs text-slate-500">
                                <p>Date Raised: <strong className="font-semibold text-navy-900">{formatDateDmY(complaint.openedAt)}</strong></p>
                                <p className="text-[11px] mt-0.5">Initial Stage: <span className="font-semibold text-navy-800">Open</span></p>
                              </div>
                            </div>
                            {complaint.initialNotes ? (
                              <div className="mt-2.5 pt-2.5 border-t border-blue-100 text-xs text-slate-700">
                                <span className="font-semibold text-slate-900">Complaint Statement: </span>
                                {complaint.initialNotes}
                              </div>
                            ) : null}
                            {complaint.riskReason && complaint.riskReason !== complaint.initialNotes ? (
                              <div className={cn("text-xs text-slate-600", complaint.initialNotes ? "mt-1 text-[11px]" : "mt-2.5 pt-2.5 border-t border-blue-100")}>
                                <span className="font-semibold text-slate-900">Risk Assessment Trigger: </span>
                                {complaint.riskReason}
                              </div>
                            ) : null}
                          </div>

                          {/* 2. Lifecycle Stages Stepper ("What stages it got") */}
                          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-3 flex items-center gap-1.5">
                              <ShieldAlert className="h-4 w-4 text-orange-600" />
                              Complaint Lifecycle & Stages
                            </h4>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                              {/* Stage 1: Raised */}
                              <div className="flex items-start gap-2 rounded-md bg-white border border-green-200 p-2.5 shadow-xs">
                                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-100 text-success">
                                  <CheckCircle2 className="h-4 w-4" />
                                </div>
                                <div className="min-w-0">
                                  <p className="text-xs font-bold text-navy-900">1. Raised</p>
                                  <p className="text-[10px] text-slate-500 truncate">{formatDateDmY(complaint.openedAt)}</p>
                                  <p className="text-[10px] text-success font-semibold">Logged in system</p>
                                </div>
                              </div>

                              {/* Stage 2: Monitoring */}
                              <div className={cn(
                                "flex items-start gap-2 rounded-md bg-white border p-2.5 shadow-xs",
                                complaint.status === "monitoring"
                                  ? "border-purple-300 ring-2 ring-purple-100 bg-purple-50/30"
                                  : ["resolved", "escalated"].includes(complaint.status) || (complaint.interventions?.length ?? 0) > 0
                                    ? "border-green-200"
                                    : "border-slate-200 opacity-60"
                              )}>
                                <div className={cn(
                                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                                  complaint.status === "monitoring"
                                    ? "bg-purple-100 text-purple-700"
                                    : ["resolved", "escalated"].includes(complaint.status) || (complaint.interventions?.length ?? 0) > 0
                                      ? "bg-green-100 text-success"
                                      : "bg-slate-100 text-slate-400"
                                )}>
                                  {["resolved", "escalated"].includes(complaint.status) || (complaint.interventions?.length ?? 0) > 0 ? (
                                    <CheckCircle2 className="h-4 w-4" />
                                  ) : (
                                    <Clock className="h-4 w-4" />
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <p className="text-xs font-bold text-navy-900">2. Monitoring</p>
                                  <p className="text-[10px] text-slate-500">
                                    {(complaint.interventions?.length ?? 0) > 0 ? `${complaint.interventions.length} intervention(s)` : "Tracking"}
                                  </p>
                                  <p className={cn(
                                    "text-[10px] font-semibold",
                                    complaint.status === "monitoring" ? "text-purple-700" : ["resolved", "escalated"].includes(complaint.status) ? "text-success" : "text-slate-400"
                                  )}>
                                    {complaint.status === "monitoring" ? "Currently Active" : ["resolved", "escalated"].includes(complaint.status) ? "Completed" : "Pending"}
                                  </p>
                                </div>
                              </div>

                              {/* Stage 3: Escalation */}
                              <div className={cn(
                                "flex items-start gap-2 rounded-md bg-white border p-2.5 shadow-xs",
                                complaint.status === "escalated" || complaint.escalatedAt
                                  ? "border-red-300 ring-2 ring-red-100 bg-red-50/30"
                                  : "border-slate-200 opacity-60"
                              )}>
                                <div className={cn(
                                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                                  complaint.status === "escalated" || complaint.escalatedAt
                                    ? "bg-red-100 text-critical"
                                    : "bg-slate-100 text-slate-400"
                                )}>
                                  <AlertTriangle className="h-4 w-4" />
                                </div>
                                <div className="min-w-0">
                                  <p className="text-xs font-bold text-navy-900">3. Escalation</p>
                                  <p className="text-[10px] text-slate-500">
                                    {complaint.escalatedAt ? formatDateDmY(complaint.escalatedAt) : "Disciplinary / Risk"}
                                  </p>
                                  <p className={cn(
                                    "text-[10px] font-semibold",
                                    complaint.status === "escalated"
                                      ? "text-critical font-bold"
                                      : complaint.escalatedAt
                                        ? "text-amber-700"
                                        : "text-slate-400"
                                  )}>
                                    {complaint.status === "escalated" ? "Active Escalation" : complaint.escalatedAt ? "Was Escalated" : "Not Escalated"}
                                  </p>
                                </div>
                              </div>

                              {/* Stage 4: Resolution */}
                              <div className={cn(
                                "flex items-start gap-2 rounded-md bg-white border p-2.5 shadow-xs",
                                complaint.status === "resolved" || complaint.resolvedAt
                                  ? "border-green-300 ring-2 ring-green-100 bg-green-50/30"
                                  : "border-slate-200 opacity-60"
                              )}>
                                <div className={cn(
                                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                                  complaint.status === "resolved" || complaint.resolvedAt
                                    ? "bg-green-100 text-success"
                                    : "bg-slate-100 text-slate-400"
                                )}>
                                  <CheckCircle2 className="h-4 w-4" />
                                </div>
                                <div className="min-w-0">
                                  <p className="text-xs font-bold text-navy-900">4. Resolution</p>
                                  <p className="text-[10px] text-slate-500">
                                    {complaint.resolvedAt ? formatDateDmY(complaint.resolvedAt) : "Final Closure"}
                                  </p>
                                  <p className={cn(
                                    "text-[10px] font-semibold",
                                    complaint.status === "resolved" ? "text-success" : "text-slate-400"
                                  )}>
                                    {complaint.status === "resolved" ? "Case Resolved" : "Open / In Progress"}
                                  </p>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* 3. Detailed Chronological Audit Timeline */}
                          {(() => {
                            const timelineItems: Array<{
                              key: string;
                              date: string;
                              type: "created" | "event" | "intervention";
                              title: string;
                              actor: string;
                              notes?: string | null;
                              outcome?: string | null;
                              followUpDate?: string | null;
                              badge: string;
                              badgeClass: string;
                              dotColor: string;
                            }> = [];

                            // Complaint creation
                            timelineItems.push({
                              key: `created-${complaint.id}`,
                              date: complaint.openedAt,
                              type: "created",
                              title: `Complaint Raised: ${complaint.riskType}`,
                              actor: complaint.openedByName || "Staff / Faculty Member",
                              notes: complaint.initialNotes || complaint.riskReason || "Complaint officially filed into the mentoring and risk monitoring system.",
                              badge: "Complaint Raised",
                              badgeClass: "bg-blue-100 text-info border-blue-200",
                              dotColor: "bg-info",
                            });

                            // Events / Status changes
                            (complaint.events || []).forEach((e) => {
                              const isStatusChange = e.eventType === "status_change" || Boolean(e.oldStatus && e.newStatus);
                              timelineItems.push({
                                key: `evt-${e.id}`,
                                date: e.createdAt,
                                type: "event",
                                title: isStatusChange
                                  ? `Stage Transition: ${e.oldStatus || "Open"} → ${e.newStatus}`
                                  : e.eventType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
                                actor: e.actorName || "System / Staff",
                                notes: e.notes,
                                badge: e.newStatus ? `Stage: ${e.newStatus}` : e.eventType,
                                badgeClass: e.newStatus === "resolved"
                                  ? "bg-green-100 text-success border-green-200"
                                  : e.newStatus === "escalated"
                                    ? "bg-red-100 text-critical border-red-200"
                                    : "bg-purple-100 text-purple-700 border-purple-200",
                                dotColor: e.newStatus === "resolved"
                                  ? "bg-success"
                                  : e.newStatus === "escalated"
                                    ? "bg-critical"
                                    : "bg-purple-600",
                              });
                            });

                            // Interventions
                            (complaint.interventions || []).forEach((i) => {
                              timelineItems.push({
                                key: `int-${i.id}`,
                                date: i.actionAt,
                                type: "intervention",
                                title: `Intervention: ${i.actionType}`,
                                actor: i.actionByName || "Assigned Mentor / Staff",
                                notes: i.notes,
                                outcome: i.outcome,
                                followUpDate: i.followUpDate,
                                badge: i.actionType,
                                badgeClass: "bg-amber-100 text-amber-800 border-amber-200",
                                dotColor: "bg-amber-500",
                              });
                            });

                            // Sort descending: newest on top
                            timelineItems.sort(
                              (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
                            );

                            return (
                              <div className="rounded-lg border border-slate-200 bg-white p-4">
                                <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-2.5">
                                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                                    <Clock className="h-4 w-4 text-slate-500" />
                                    Detailed Audit Trail & Timeline ({timelineItems.length})
                                  </h4>
                                  <span className="text-[11px] text-slate-500 font-medium">Newest first</span>
                                </div>

                                <div className="relative border-l-2 border-slate-200 ml-3 space-y-4 pb-1 pt-1">
                                  {timelineItems.map((item) => (
                                    <div key={item.key} className="relative pl-6">
                                      {/* Dot */}
                                      <div
                                        className={cn(
                                          "absolute -left-[9px] top-1.5 h-4 w-4 rounded-full border-2 border-white shadow-xs",
                                          item.dotColor
                                        )}
                                      />

                                      <div className="flex flex-wrap items-center justify-between gap-1 mb-1">
                                        <div className="flex items-center gap-2">
                                          <span className="text-sm font-bold text-navy-900">{item.title}</span>
                                          <span className={cn("rounded px-2 py-0.5 text-[10px] font-semibold border", item.badgeClass)}>
                                            {item.badge}
                                          </span>
                                        </div>
                                        <span className="text-xs text-slate-500 font-medium">
                                          {formatDateDmY(item.date)}
                                        </span>
                                      </div>

                                      <p className="text-xs text-slate-500 mb-1.5">
                                        Recorded by: <strong className="font-semibold text-navy-900">{item.actor}</strong>
                                      </p>

                                      {item.notes ? (
                                        <div className="rounded-md bg-slate-50 p-2 text-xs text-slate-700 mb-1">
                                          <span className="font-semibold text-slate-900">Notes: </span>
                                          {item.notes}
                                        </div>
                                      ) : null}

                                      {item.outcome ? (
                                        <div className="rounded-md bg-green-50/70 border border-green-200 p-2 text-xs text-slate-800 mb-1">
                                          <span className="font-semibold text-success">Outcome: </span>
                                          {item.outcome}
                                        </div>
                                      ) : null}

                                      {item.followUpDate ? (
                                        <p className="text-[11px] text-slate-500 font-medium mt-1">
                                          Follow-up Date: <strong className="text-navy-900">{formatDateDmY(item.followUpDate)}</strong>
                                        </p>
                                      ) : null}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-slate-200 bg-slate-50/50 p-8">
                <div className="text-center">
                  <p className="text-sm font-medium text-slate-600">No active complaints</p>
                  <p className="mt-1 text-xs text-slate-500">The student has a clear record.</p>
                </div>
              </div>
            )}
          </div>
        ) : null}

        {tab === "personal" ? (
          <ColoredInfoGrid fields={personalFields} edgeClass={active.cardEdge} />
        ) : null}

        {tab === "contact" ? (
          <ColoredInfoGrid fields={contactFields} edgeClass={active.cardEdge} />
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
