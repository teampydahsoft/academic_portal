"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useAcademicContext } from "@/components/layout/AcademicProvider";
import { useAuth } from "@/components/auth/AuthProvider";
import { isTeachingStaffOnly } from "@/lib/teaching-scope";
import { apiFetch } from "@/lib/api";

type PeriodOption = {
  timingSlotId: number;
  slotLabel: string;
  startTime: string;
  endTime: string;
  subjectName: string | null;
};

type MyClassOption = PeriodOption & {
  timetableEntryId: number;
  sectionName: string;
  batch: string;
  collegeId: number;
  courseId: number;
  branchId: number;
  yearOfStudy: number | null;
  semesterNumber: number | null;
  academicYear: string;
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
  division?: string | null;
  college?: string | null;
  available: boolean;
  busyWith: { subjectName: string | null; sectionName: string | null } | null;
};

type Props = {
  onCancel: () => void;
};

const inputClass =
  "h-11 w-full rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-navy-800";

export function SubstitutionRequestForm({ onCancel }: Props) {
  const router = useRouter();
  const { authorization } = useAuth();
  const teachingStaffOnly = isTeachingStaffOnly(authorization);
  const { filters, masters } = useAcademicContext();

  const [sessionDate, setSessionDate] = useState("");
  const [periods, setPeriods] = useState<PeriodOption[]>([]);
  const [myClasses, setMyClasses] = useState<MyClassOption[]>([]);
  const [selectedMyClassIndex, setSelectedMyClassIndex] = useState<number | "">("");
  const [timingSlotId, setTimingSlotId] = useState<number | "">("");
  const [resolvedClass, setResolvedClass] = useState<ResolvedClass | null>(null);
  const [resolvingClass, setResolvingClass] = useState(false);
  const [facultySearch, setFacultySearch] = useState("");
  const [facultyOptions, setFacultyOptions] = useState<FacultyAvailability[]>([]);
  const [searchingFaculty, setSearchingFaculty] = useState(false);
  const [replacementStaffLinkId, setReplacementStaffLinkId] = useState<number | "">("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedMyClass =
    teachingStaffOnly && selectedMyClassIndex !== ""
      ? myClasses[selectedMyClassIndex] ?? null
      : null;

  const adminScope = useMemo(() => {
    if (teachingStaffOnly) return null;
    return {
      collegeId: filters.collegeId !== "all" ? Number(filters.collegeId) : null,
      courseId: filters.courseId !== "all" ? Number(filters.courseId) : null,
      branchId: filters.branchId !== "all" ? Number(filters.branchId) : null,
      batch: filters.batch !== "all" ? String(filters.batch) : null,
      year: filters.year !== "all" ? Number(filters.year) : null,
      semester: filters.semester !== "all" ? Number(filters.semester) : null,
      section: filters.section !== "all" ? String(filters.section) : null,
      academicYear: filters.academicYear || null,
    };
  }, [
    teachingStaffOnly,
    filters.collegeId,
    filters.courseId,
    filters.branchId,
    filters.batch,
    filters.year,
    filters.semester,
    filters.section,
    filters.academicYear,
  ]);

  const adminScopeReady = Boolean(
    adminScope?.collegeId &&
      adminScope.courseId &&
      adminScope.branchId &&
      adminScope.batch &&
      adminScope.section &&
      adminScope.year != null &&
      adminScope.semester != null,
  );

  const classSelectionReady = teachingStaffOnly
    ? selectedMyClass != null
    : adminScopeReady && typeof timingSlotId === "number";

  useEffect(() => {
    if (!teachingStaffOnly) return;
    if (!sessionDate) {
      setMyClasses([]);
      return;
    }
    let cancelled = false;
    void apiFetch(`/faculty-substitutions/my-classes?sessionDate=${sessionDate}`, {
      cache: "no-store",
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        setMyClasses(res.ok ? ((body as { data: MyClassOption[] }).data ?? []) : []);
      })
      .catch(() => {
        if (!cancelled) setMyClasses([]);
      });
    return () => {
      cancelled = true;
    };
  }, [teachingStaffOnly, sessionDate]);

  useEffect(() => {
    if (teachingStaffOnly || !adminScopeReady || !sessionDate || !adminScope) {
      setPeriods([]);
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({
      sessionDate,
      collegeId: String(adminScope.collegeId),
      courseId: String(adminScope.courseId),
      branchId: String(adminScope.branchId),
      batch: adminScope.batch!,
      sectionName: adminScope.section!,
      yearOfStudy: String(adminScope.year),
      semesterNumber: String(adminScope.semester),
    });
    if (adminScope.academicYear) params.set("academicYear", adminScope.academicYear);
    void apiFetch(`/faculty-substitutions/periods?${params}`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (cancelled || !res.ok) return;
        setPeriods((body as { data: PeriodOption[] }).data ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [
    teachingStaffOnly,
    adminScopeReady,
    sessionDate,
    adminScope?.collegeId,
    adminScope?.courseId,
    adminScope?.branchId,
    adminScope?.batch,
    adminScope?.section,
    adminScope?.year,
    adminScope?.semester,
    adminScope?.academicYear,
  ]);

  const resolveClass = useCallback(async () => {
    if (!sessionDate || !classSelectionReady) return null;

    let payload: Record<string, unknown> | null = null;
    if (teachingStaffOnly && selectedMyClass) {
      payload = { sessionDate, timetableEntryId: selectedMyClass.timetableEntryId };
    } else if (!teachingStaffOnly && adminScope && typeof timingSlotId === "number") {
      payload = {
        sessionDate,
        collegeId: adminScope.collegeId,
        courseId: adminScope.courseId,
        branchId: adminScope.branchId,
        batch: adminScope.batch,
        yearOfStudy: adminScope.year,
        semesterNumber: adminScope.semester,
        sectionName: adminScope.section,
        timingSlotId,
        academicYear: adminScope.academicYear,
      };
    }
    if (!payload) return null;

    const response = await apiFetch("/faculty-substitutions/resolve-class", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error((body as { message?: string }).message ?? "Could not resolve class");
    }
    return body as ResolvedClass;
  }, [
    sessionDate,
    classSelectionReady,
    teachingStaffOnly,
    selectedMyClass,
    adminScope,
    timingSlotId,
  ]);

  useEffect(() => {
    if (!classSelectionReady || !sessionDate) {
      setResolvedClass(null);
      setReplacementStaffLinkId("");
      setFacultyOptions([]);
      return;
    }

    let cancelled = false;
    setResolvingClass(true);
    setError(null);

    void resolveClass()
      .then((resolved) => {
        if (cancelled) return;
        setResolvedClass(resolved);
        setReplacementStaffLinkId("");
        setFacultyOptions([]);
      })
      .catch((err) => {
        if (cancelled) return;
        setResolvedClass(null);
        setError(err instanceof Error ? err.message : "Could not resolve class");
      })
      .finally(() => {
        if (!cancelled) setResolvingClass(false);
      });

    return () => {
      cancelled = true;
    };
  }, [classSelectionReady, sessionDate, resolveClass]);

  useEffect(() => {
    if (!resolvedClass || !sessionDate) {
      setFacultyOptions([]);
      return;
    }

    const query = facultySearch.trim();
    if (query.length > 0 && query.length < 2) {
      setFacultyOptions([]);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearchingFaculty(true);
      const params = new URLSearchParams({
        sessionDate,
        collegeId: String(resolvedClass.collegeId),
        branchId: String(resolvedClass.branchId),
        timingSlotId: String(resolvedClass.timingSlotId),
        timetableEntryId: String(resolvedClass.timetableEntryId),
      });
      if (query) params.set("search", query);

      void apiFetch(`/faculty-substitutions/faculty-availability?${params}`, {
        cache: "no-store",
      })
        .then(async (res) => {
          const body = await res.json().catch(() => ({}));
          if (cancelled) return;
          if (!res.ok) {
            setFacultyOptions([]);
            return;
          }
          setFacultyOptions((body as { data: FacultyAvailability[] }).data ?? []);
        })
        .catch(() => {
          if (!cancelled) setFacultyOptions([]);
        })
        .finally(() => {
          if (!cancelled) setSearchingFaculty(false);
        });
    }, query ? 300 : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [resolvedClass, sessionDate, facultySearch]);

  async function submitRequest() {
    if (!resolvedClass || !replacementStaffLinkId || !reason.trim()) {
      setError("Select a replacement faculty and provide a reason.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch("/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      router.push(submitResponse.ok ? `/requests/${id}` : `/requests/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to submit request");
    } finally {
      setBusy(false);
    }
  }

  const selectedFaculty = facultyOptions.find((f) => f.staffLinkId === replacementStaffLinkId);
  const canSubmit = Boolean(resolvedClass && replacementStaffLinkId && reason.trim() && !busy);

  return (
    <Modal
      title="Faculty substitution request"
      wide
      onClose={onCancel}
      headerActions={
        <Button size="sm" disabled={!canSubmit} onClick={() => void submitRequest()}>
          {busy ? "Submitting…" : "Submit request"}
        </Button>
      }
    >
      <div className="space-y-5">
        <p className="text-sm text-slate-600">
          {teachingStaffOnly
            ? "Pick your class, search for a replacement faculty across the institute, and submit."
            : "Complete all details below. Use academic filters in the header for scope."}
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-navy-900">Date</span>
            <input
              type="date"
              value={sessionDate}
              onChange={(e) => {
                setSessionDate(e.target.value);
                setTimingSlotId("");
                setSelectedMyClassIndex("");
              }}
              className={inputClass}
            />
          </label>

          {teachingStaffOnly ? (
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-navy-900">Your class</span>
              <select
                value={selectedMyClassIndex === "" ? "" : String(selectedMyClassIndex)}
                onChange={(e) => {
                  const index = e.target.value === "" ? "" : Number(e.target.value);
                  setSelectedMyClassIndex(index);
                  if (index !== "" && myClasses[index]) {
                    setTimingSlotId(myClasses[index]!.timingSlotId);
                  } else {
                    setTimingSlotId("");
                  }
                }}
                className={inputClass}
                disabled={!myClasses.length}
              >
                <option value="">Select your class…</option>
                {myClasses.map((item, index) => (
                  <option key={`${item.timetableEntryId}-${item.timingSlotId}`} value={index}>
                    {item.slotLabel} ({item.startTime}–{item.endTime}) — {item.subjectName ?? "Class"}
                    {item.sectionName && item.sectionName !== "—"
                      ? ` • Section ${item.sectionName}`
                      : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-navy-900">Period</span>
              <select
                value={timingSlotId}
                onChange={(e) => setTimingSlotId(e.target.value ? Number(e.target.value) : "")}
                className={inputClass}
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
          )}
        </div>

        {sessionDate && teachingStaffOnly && myClasses.length === 0 ? (
          <p className="text-sm text-warning">You have no assigned classes on this date.</p>
        ) : null}

        {resolvingClass ? (
          <p className="text-sm text-slate-500">Loading class details…</p>
        ) : null}

        {resolvedClass ? (
          <div className="rounded-lg border border-border bg-slate-50 p-4 text-sm">
            <p className="font-semibold text-navy-900">Class details</p>
            <p className="mt-2">
              {resolvedClass.subjectName ?? "Subject"}
              {resolvedClass.sectionName && resolvedClass.sectionName !== "—"
                ? ` • Section ${resolvedClass.sectionName}`
                : ""}{" "}
              • {resolvedClass.slotLabel} ({resolvedClass.startTime}–{resolvedClass.endTime})
            </p>
            <p className="mt-1 text-slate-600">
              Current faculty: {resolvedClass.originalFacultyName ?? "—"}
              {resolvedClass.roomLabel ? ` • Room ${resolvedClass.roomLabel}` : ""}
            </p>
          </div>
        ) : null}

        {resolvedClass ? (
          <>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-navy-900">
                Search replacement faculty (institute-wide)
              </span>
              <input
                value={facultySearch}
                onChange={(e) => setFacultySearch(e.target.value)}
                className={inputClass}
                placeholder="Search by name, employee ID, department, or college"
              />
              <p className="mt-1 text-xs text-slate-500">
                Type at least 2 characters to search. Available faculty are shown first.
              </p>
            </label>

            {searchingFaculty ? (
              <p className="text-sm text-slate-500">Searching faculty…</p>
            ) : null}

            <div className="max-h-56 space-y-2 overflow-y-auto">
              {facultyOptions.length === 0 && !searchingFaculty ? (
                <p className="text-sm text-slate-500">
                  {facultySearch.trim().length >= 2
                    ? "No matching faculty found."
                    : "Start typing to search all linked faculty."}
                </p>
              ) : null}
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
                  <p className="mt-1 text-xs text-slate-500">
                    {[faculty.department, faculty.college, faculty.hrmsEmployeeId]
                      .filter(Boolean)
                      .join(" • ")}
                  </p>
                  {!faculty.available && faculty.busyWith ? (
                    <p className="mt-1 text-xs text-slate-500">
                      {faculty.busyWith.subjectName ?? "Class"} •{" "}
                      {faculty.busyWith.sectionName ?? "—"}
                    </p>
                  ) : null}
                </button>
              ))}
            </div>

            <label className="block text-sm">
              <span className="mb-1 block font-medium text-navy-900">Reason (required)</span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="min-h-24 w-full rounded-md border border-border px-3 py-2 text-sm outline-none focus:border-navy-800"
                placeholder="Why do you need a substitution?"
              />
            </label>

            {selectedFaculty ? (
              <p className="text-sm text-slate-600">
                Replacement: <strong>{selectedFaculty.name}</strong>
              </p>
            ) : null}
          </>
        ) : null}

        {error ? <p className="text-sm text-critical">{error}</p> : null}
        {!teachingStaffOnly && !masters ? (
          <p className="text-xs text-slate-500">Loading academic masters…</p>
        ) : null}

        <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row">
          <Button className="w-full sm:w-auto" disabled={!canSubmit} onClick={() => void submitRequest()}>
            {busy ? "Submitting…" : "Submit request"}
          </Button>
          <Button variant="secondary" className="w-full sm:w-auto" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}
