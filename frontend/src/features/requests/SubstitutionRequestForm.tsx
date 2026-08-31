"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useAcademicContext } from "@/components/layout/AcademicProvider";
import { apiFetch } from "@/lib/api";

type PeriodOption = {
  timingSlotId: number;
  slotLabel: string;
  startTime: string;
  endTime: string;
  subjectName: string | null;
};

type ResolvedClass = {
  timetableEntryId: number;
  planId: number;
  subjectName: string | null;
  subjectCode: string | null;
  roomLabel: string | null;
  originalFacultyStaffLinkId: number;
  originalFacultyName: string | null;
  slotLabel: string;
  startTime: string;
  endTime: string;
  sectionName: string;
  batch: string;
  yearOfStudy: number | null;
  semesterNumber: number | null;
  academicYear: string;
  collegeId: number;
  courseId: number;
  branchId: number;
  timingSlotId: number;
};

type FacultyAvailability = {
  staffLinkId: number;
  name: string;
  hrmsEmployeeId: string;
  department: string | null;
  available: boolean;
  busyWith: { subjectName: string | null; sectionName: string | null } | null;
};

type Props = {
  onCancel: () => void;
};

export function SubstitutionRequestForm({ onCancel }: Props) {
  const router = useRouter();
  const { filters, masters } = useAcademicContext();

  const [step, setStep] = useState(1);
  const [sessionDate, setSessionDate] = useState("");
  const [periods, setPeriods] = useState<PeriodOption[]>([]);
  const [timingSlotId, setTimingSlotId] = useState<number | "">("");
  const [resolvedClass, setResolvedClass] = useState<ResolvedClass | null>(null);
  const [facultySearch, setFacultySearch] = useState("");
  const [facultyOptions, setFacultyOptions] = useState<FacultyAvailability[]>([]);
  const [replacementStaffLinkId, setReplacementStaffLinkId] = useState<number | "">("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scope = useMemo(() => {
    const collegeId = filters.collegeId !== "all" ? Number(filters.collegeId) : null;
    const courseId = filters.courseId !== "all" ? Number(filters.courseId) : null;
    const branchId = filters.branchId !== "all" ? Number(filters.branchId) : null;
    const batch = filters.batch !== "all" ? String(filters.batch) : null;
    const year = filters.year !== "all" ? Number(filters.year) : null;
    const semester = filters.semester !== "all" ? Number(filters.semester) : null;
    const section = filters.section !== "all" ? String(filters.section) : null;
    const academicYear = filters.academicYear || null;
    return { collegeId, courseId, branchId, batch, year, semester, section, academicYear };
  }, [filters]);

  const scopeReady =
    scope.collegeId &&
    scope.courseId &&
    scope.branchId &&
    scope.batch &&
    scope.section &&
    scope.year != null &&
    scope.semester != null;

  useEffect(() => {
    if (!scopeReady || !sessionDate) {
      setPeriods([]);
      return;
    }
    const params = new URLSearchParams({
      sessionDate,
      collegeId: String(scope.collegeId),
      courseId: String(scope.courseId),
      branchId: String(scope.branchId),
      batch: scope.batch!,
      sectionName: scope.section!,
      yearOfStudy: String(scope.year),
      semesterNumber: String(scope.semester),
    });
    if (scope.academicYear) params.set("academicYear", scope.academicYear);

    void apiFetch(`/faculty-substitutions/periods?${params}`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) return;
        setPeriods((body as { data: PeriodOption[] }).data ?? []);
      })
      .catch(() => undefined);
  }, [scopeReady, sessionDate, scope]);

  async function resolveClass() {
    if (!scopeReady || !sessionDate || !timingSlotId) {
      setError("Select academic scope, date, and period.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch("/faculty-substitutions/resolve-class", {
        method: "POST",
        body: JSON.stringify({
          sessionDate,
          collegeId: scope.collegeId,
          courseId: scope.courseId,
          branchId: scope.branchId,
          batch: scope.batch,
          yearOfStudy: scope.year,
          semesterNumber: scope.semester,
          sectionName: scope.section,
          timingSlotId,
          academicYear: scope.academicYear,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((body as { message?: string }).message ?? "Could not resolve class");
      }
      setResolvedClass(body as ResolvedClass);
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resolve class");
    } finally {
      setBusy(false);
    }
  }

  async function loadFaculty() {
    if (!resolvedClass || !sessionDate) return;
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        sessionDate,
        collegeId: String(resolvedClass.collegeId),
        branchId: String(resolvedClass.branchId),
        timingSlotId: String(resolvedClass.timingSlotId ?? timingSlotId),
        timetableEntryId: String(resolvedClass.timetableEntryId),
        search: facultySearch,
      });
      const response = await apiFetch(`/faculty-substitutions/faculty-availability?${params}`, {
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((body as { message?: string }).message ?? "Could not load faculty");
      }
      setFacultyOptions((body as { data: FacultyAvailability[] }).data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load faculty");
    } finally {
      setBusy(false);
    }
  }

  async function submitRequest() {
    if (!resolvedClass || !replacementStaffLinkId || !reason.trim()) {
      setError("Complete all substitution fields.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch("/requests", {
        method: "POST",
        body: JSON.stringify({
          typeKey: "faculty_substitution",
          collegeId: resolvedClass.collegeId,
          branchId: resolvedClass.branchId,
          substitution: {
            sessionDate,
            timetableEntryId: resolvedClass.timetableEntryId,
            replacementFacultyStaffLinkId: replacementStaffLinkId,
            reason: reason.trim(),
            collegeId: resolvedClass.collegeId,
            courseId: resolvedClass.courseId,
            branchId: resolvedClass.branchId,
            batch: resolvedClass.batch,
            yearOfStudy: resolvedClass.yearOfStudy,
            semesterNumber: resolvedClass.semesterNumber,
            sectionName: resolvedClass.sectionName,
            timingSlotId: resolvedClass.timingSlotId,
            academicYear: resolvedClass.academicYear,
          },
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((body as { message?: string }).message ?? "Unable to create request");
      }
      const id = (body as { request: { id: number } }).request.id;
      const submitResponse = await apiFetch(`/requests/${id}/submit`, {
        method: "POST",
        body: "{}",
      });
      if (!submitResponse.ok) {
        router.push(`/requests/${id}`);
        return;
      }
      router.push(`/requests/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to submit request");
    } finally {
      setBusy(false);
    }
  }

  const selectedFaculty = facultyOptions.find((f) => f.staffLinkId === replacementStaffLinkId);

  return (
    <Card className="max-w-3xl">
      <div className="mb-4 flex flex-wrap gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
        {["Class details", "Resolve class", "Replacement", "Reason", "Review"].map((label, index) => (
          <span
            key={label}
            className={step === index + 1 ? "text-navy-900" : ""}
          >
            {index + 1}. {label}
          </span>
        ))}
      </div>

      {step === 1 ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Use the academic filters in the header for college, course, branch, year, semester, section, and batch.
          </p>
          {!scopeReady ? (
            <p className="text-sm text-warning">Select a full academic scope before continuing.</p>
          ) : null}
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-navy-900">Date</span>
            <input
              type="date"
              value={sessionDate}
              onChange={(e) => {
                setSessionDate(e.target.value);
                setTimingSlotId("");
                setResolvedClass(null);
              }}
              className="h-11 w-full rounded-md border border-border px-3 text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-navy-900">Period</span>
            <select
              value={timingSlotId}
              onChange={(e) => setTimingSlotId(e.target.value ? Number(e.target.value) : "")}
              className="h-11 w-full rounded-md border border-border bg-white px-3 text-sm"
              disabled={!periods.length}
            >
              <option value="">Select period…</option>
              {periods.map((period) => (
                <option key={period.timingSlotId} value={period.timingSlotId}>
                  {period.slotLabel} ({period.startTime}–{period.endTime})
                  {period.subjectName ? ` — ${period.subjectName}` : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              className="w-full sm:w-auto"
              disabled={!scopeReady || !sessionDate || !timingSlotId || busy}
              onClick={() => void resolveClass()}
            >
              {busy ? "Resolving…" : "Continue"}
            </Button>
            <Button variant="secondary" className="w-full sm:w-auto" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {step >= 2 && resolvedClass ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-slate-50 p-4 text-sm">
            <p className="font-semibold text-navy-900">Resolved class</p>
            <p className="mt-2">
              {resolvedClass.subjectName ?? "Subject"} • {resolvedClass.sectionName} •{" "}
              {resolvedClass.slotLabel} ({resolvedClass.startTime}–{resolvedClass.endTime})
            </p>
            <p className="mt-1 text-slate-600">
              Current faculty: {resolvedClass.originalFacultyName ?? "—"}
              {resolvedClass.roomLabel ? ` • Room ${resolvedClass.roomLabel}` : ""}
            </p>
          </div>

          {step === 3 ? (
            <>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-navy-900">Search replacement faculty</span>
                <input
                  value={facultySearch}
                  onChange={(e) => setFacultySearch(e.target.value)}
                  className="h-10 w-full rounded-md border border-border px-3 text-sm"
                  placeholder="Search by name or employee id"
                />
              </label>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void loadFaculty()}>
                Search availability
              </Button>
              <div className="space-y-2">
                {facultyOptions.map((faculty) => (
                  <button
                    key={faculty.staffLinkId}
                    type="button"
                    disabled={!faculty.available}
                    onClick={() => setReplacementStaffLinkId(faculty.staffLinkId)}
                    className={`w-full rounded-lg border px-3 py-3 text-left text-sm ${
                      replacementStaffLinkId === faculty.staffLinkId
                        ? "border-navy-800 bg-brand-50"
                        : "border-border bg-white"
                    } ${!faculty.available ? "opacity-60" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-navy-900">{faculty.name}</span>
                      <span
                        className={`text-xs font-medium ${
                          faculty.available ? "text-success" : "text-critical"
                        }`}
                      >
                        {faculty.available ? "Available" : "Busy"}
                      </span>
                    </div>
                    {!faculty.available && faculty.busyWith ? (
                      <p className="mt-1 text-xs text-slate-500">
                        {faculty.busyWith.subjectName ?? "Class"} • {faculty.busyWith.sectionName ?? "—"}
                      </p>
                    ) : null}
                  </button>
                ))}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  className="w-full sm:w-auto"
                  disabled={!replacementStaffLinkId}
                  onClick={() => setStep(4)}
                >
                  Continue
                </Button>
                <Button variant="secondary" className="w-full sm:w-auto" onClick={() => setStep(1)}>
                  Back
                </Button>
              </div>
            </>
          ) : null}

          {step === 4 ? (
            <>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-navy-900">Reason (required)</span>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="min-h-28 w-full rounded-md border border-border px-3 py-2 text-sm"
                />
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button className="w-full sm:w-auto" disabled={!reason.trim()} onClick={() => setStep(5)}>
                  Review
                </Button>
                <Button variant="secondary" className="w-full sm:w-auto" onClick={() => setStep(3)}>
                  Back
                </Button>
              </div>
            </>
          ) : null}

          {step === 5 ? (
            <>
              <div className="rounded-lg border border-border p-4 text-sm text-slate-700">
                <p>
                  <strong>Date:</strong> {sessionDate}
                </p>
                <p>
                  <strong>Class:</strong> {resolvedClass.sectionName} • {resolvedClass.subjectName}
                </p>
                <p>
                  <strong>Period:</strong> {resolvedClass.slotLabel} ({resolvedClass.startTime}–
                  {resolvedClass.endTime})
                </p>
                <p>
                  <strong>Original faculty:</strong> {resolvedClass.originalFacultyName}
                </p>
                <p>
                  <strong>Replacement faculty:</strong> {selectedFaculty?.name ?? "—"}
                </p>
                <p>
                  <strong>Reason:</strong> {reason}
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button className="w-full sm:w-auto" disabled={busy} onClick={() => void submitRequest()}>
                  {busy ? "Submitting…" : "Submit request"}
                </Button>
                <Button variant="secondary" className="w-full sm:w-auto" onClick={() => setStep(4)}>
                  Back
                </Button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="mt-3 text-sm text-critical">{error}</p> : null}
      {masters ? null : (
        <p className="mt-2 text-xs text-slate-500">Loading academic masters…</p>
      )}
    </Card>
  );
}
