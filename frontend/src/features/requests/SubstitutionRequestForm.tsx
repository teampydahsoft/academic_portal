"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useAuth } from "@/components/auth/AuthProvider";
import { canRaiseRequestForOthers, isStaffOnlyRequester } from "@/lib/teaching-scope";
import { apiFetch } from "@/lib/api";

type ClassOption = {
  timetableEntryId: number;
  timingSlotId: number;
  slotLabel: string;
  startTime: string;
  endTime: string;
  subjectName: string | null;
  sectionName: string;
  batch: string;
  collegeId: number;
  courseId: number;
  branchId: number;
  yearOfStudy: number | null;
  semesterNumber: number | null;
  academicYear: string;
  facultyName?: string | null;
  facultyHrmsId?: string | null;
};

type EmployeeOption = {
  staffLinkId: number;
  name: string;
  hrmsEmployeeId: string;
  employeeCode: string | null;
  division: string | null;
  department: string | null;
  college: string | null;
};

type EmployeeSearchResponse = {
  data: EmployeeOption[];
  filterOptions?: {
    divisions: string[];
    departments: string[];
  };
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
  const staffOnly = isStaffOnlyRequester(authorization);
  const delegateRequest = canRaiseRequestForOthers(authorization);

  const [sessionDate, setSessionDate] = useState("");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [employeeSearchDraft, setEmployeeSearchDraft] = useState("");
  const [divisionFilter, setDivisionFilter] = useState("all");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [divisionOptions, setDivisionOptions] = useState<string[]>([]);
  const [departmentOptions, setDepartmentOptions] = useState<string[]>([]);
  const [employeeOptions, setEmployeeOptions] = useState<EmployeeOption[]>([]);
  const [searchingEmployees, setSearchingEmployees] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeOption | null>(null);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [selectedClassIndex, setSelectedClassIndex] = useState<number | "">("");
  const [resolvedClass, setResolvedClass] = useState<ResolvedClass | null>(null);
  const [resolvingClass, setResolvingClass] = useState(false);
  const [facultySearch, setFacultySearch] = useState("");
  const [facultyOptions, setFacultyOptions] = useState<FacultyAvailability[]>([]);
  const [searchingFaculty, setSearchingFaculty] = useState(false);
  const [replacementStaffLinkId, setReplacementStaffLinkId] = useState<number | "">("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedClass =
    selectedClassIndex !== "" ? classes[selectedClassIndex] ?? null : null;

  const classSelectionReady = Boolean(sessionDate && selectedClass);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setEmployeeSearch(employeeSearchDraft.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [employeeSearchDraft]);

  useEffect(() => {
    if (!delegateRequest) return;
    if (employeeSearch.length > 0 && employeeSearch.length < 2) {
      setEmployeeOptions([]);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearchingEmployees(true);
      const params = new URLSearchParams();
      if (employeeSearch.length >= 2) params.set("search", employeeSearch);
      if (divisionFilter !== "all") params.set("division", divisionFilter);
      if (departmentFilter !== "all") params.set("department", departmentFilter);

      void apiFetch(`/faculty-substitutions/employee-search?${params}`, { cache: "no-store" })
        .then(async (res) => {
          const body = (await res.json().catch(() => ({}))) as EmployeeSearchResponse;
          if (cancelled) return;
          if (!res.ok) {
            setEmployeeOptions([]);
            return;
          }
          setEmployeeOptions(body.data ?? []);
          if (body.filterOptions) {
            setDivisionOptions(body.filterOptions.divisions ?? []);
            setDepartmentOptions(body.filterOptions.departments ?? []);
          }
        })
        .catch(() => {
          if (!cancelled) setEmployeeOptions([]);
        })
        .finally(() => {
          if (!cancelled) setSearchingEmployees(false);
        });
    }, employeeSearch.length >= 2 ? 300 : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [delegateRequest, employeeSearch, divisionFilter, departmentFilter]);

  const departmentChoices = useMemo(() => {
    if (departmentOptions.length > 0) return departmentOptions;
    return [...new Set(employeeOptions.map((row) => row.department).filter(Boolean) as string[])].sort();
  }, [departmentOptions, employeeOptions]);

  useEffect(() => {
    if (!sessionDate) {
      setClasses([]);
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        if (staffOnly) {
          const res = await apiFetch(
            `/faculty-substitutions/my-classes?sessionDate=${sessionDate}`,
            { cache: "no-store" },
          );
          const body = await res.json().catch(() => ({}));
          if (cancelled) return;
          setClasses(res.ok ? ((body as { data: ClassOption[] }).data ?? []) : []);
          return;
        }

        if (!selectedEmployee) {
          setClasses([]);
          return;
        }

        const res = await apiFetch(
          `/faculty-substitutions/staff-classes?sessionDate=${sessionDate}&staffLinkId=${selectedEmployee.staffLinkId}`,
          { cache: "no-store" },
        );
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        setClasses(res.ok ? ((body as { data: ClassOption[] }).data ?? []) : []);
      } catch {
        if (!cancelled) setClasses([]);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [staffOnly, sessionDate, selectedEmployee]);

  const resolveClass = useCallback(async () => {
    if (!sessionDate || !selectedClass) return null;

    const response = await apiFetch("/faculty-substitutions/resolve-class", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionDate,
        timetableEntryId: selectedClass.timetableEntryId,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error((body as { message?: string }).message ?? "Could not resolve class");
    }
    return body as ResolvedClass;
  }, [sessionDate, selectedClass]);

  useEffect(() => {
    if (!classSelectionReady) {
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

  function resetClassSelection() {
    setSelectedClassIndex("");
    setResolvedClass(null);
    setReplacementStaffLinkId("");
    setFacultyOptions([]);
    setFacultySearch("");
  }

  function selectEmployee(employee: EmployeeOption) {
    setSelectedEmployee(employee);
    setEmployeeSearchDraft(employee.name);
    setEmployeeSearch(employee.name);
    resetClassSelection();
  }

  function formatEmployeeMeta(employee: EmployeeOption) {
    return [employee.division, employee.department, employee.college, employee.hrmsEmployeeId]
      .filter(Boolean)
      .join(" • ");
  }

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
          {staffOnly
            ? "Pick your class, search for a replacement faculty, and submit."
            : "Search the employee who needs substitution, pick their class on the selected date, then choose a replacement faculty."}
        </p>

        {delegateRequest ? (
          <div className="space-y-3 rounded-lg border border-border bg-slate-50 p-4">
            <div>
              <p className="text-sm font-medium text-navy-900">Employee (faculty)</p>
              <p className="mt-1 text-xs text-slate-500">
                Browse linked faculty or narrow by division, department, and name.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-medium text-slate-600">Division</span>
                <select
                  value={divisionFilter}
                  onChange={(e) => {
                    setDivisionFilter(e.target.value);
                    setDepartmentFilter("all");
                    if (selectedEmployee) {
                      setSelectedEmployee(null);
                      resetClassSelection();
                    }
                  }}
                  className={inputClass}
                >
                  <option value="all">All divisions</option>
                  {divisionOptions.map((division) => (
                    <option key={division} value={division}>
                      {division}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm">
                <span className="mb-1 block text-xs font-medium text-slate-600">Department</span>
                <select
                  value={departmentFilter}
                  onChange={(e) => {
                    setDepartmentFilter(e.target.value);
                    if (selectedEmployee) {
                      setSelectedEmployee(null);
                      resetClassSelection();
                    }
                  }}
                  className={inputClass}
                >
                  <option value="all">All departments</option>
                  {departmentChoices.map((department) => (
                    <option key={department} value={department}>
                      {department}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm sm:col-span-1">
                <span className="mb-1 block text-xs font-medium text-slate-600">Search</span>
                <input
                  value={employeeSearchDraft}
                  onChange={(e) => {
                    setEmployeeSearchDraft(e.target.value);
                    if (selectedEmployee && e.target.value !== selectedEmployee.name) {
                      setSelectedEmployee(null);
                      resetClassSelection();
                    }
                  }}
                  className={inputClass}
                  placeholder="Name, employee ID, department…"
                />
              </label>
            </div>

            {searchingEmployees ? (
              <p className="text-xs text-slate-500">Loading staff…</p>
            ) : null}

            <div className="overflow-hidden rounded-md border border-border bg-white">
              <div className="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)] gap-3 border-b border-border bg-slate-100 px-3 py-2 text-xs font-medium uppercase tracking-wide text-slate-600 sm:grid">
                <span>Name</span>
                <span>Division</span>
                <span>Department</span>
                <span>Employee ID</span>
              </div>
              <div className="max-h-56 overflow-y-auto">
                {employeeOptions.length === 0 && !searchingEmployees ? (
                  <p className="px-3 py-4 text-sm text-slate-500">
                    {employeeSearch.length > 0 && employeeSearch.length < 2
                      ? "Type at least 2 characters to search by name."
                      : "No linked faculty match the current filters."}
                  </p>
                ) : null}
                {employeeOptions.map((employee) => {
                  const selected = selectedEmployee?.staffLinkId === employee.staffLinkId;
                  return (
                    <button
                      key={employee.staffLinkId}
                      type="button"
                      onClick={() => selectEmployee(employee)}
                      className={`grid w-full gap-1 border-b border-border px-3 py-3 text-left text-sm last:border-0 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)] sm:items-center sm:gap-3 ${
                        selected ? "bg-brand-50" : "hover:bg-slate-50"
                      }`}
                    >
                      <span className="font-medium text-navy-900">{employee.name}</span>
                      <span className="text-xs text-slate-600 sm:text-sm">
                        <span className="font-medium text-slate-500 sm:hidden">Division: </span>
                        {employee.division ?? "—"}
                      </span>
                      <span className="text-xs text-slate-600 sm:text-sm">
                        <span className="font-medium text-slate-500 sm:hidden">Department: </span>
                        {employee.department ?? "—"}
                      </span>
                      <span className="text-xs text-slate-500 sm:text-sm">
                        <span className="font-medium text-slate-500 sm:hidden">ID: </span>
                        {employee.hrmsEmployeeId}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {selectedEmployee ? (
              <p className="text-xs text-success">
                Selected: <strong>{selectedEmployee.name}</strong>
                {formatEmployeeMeta(selectedEmployee) ? ` · ${formatEmployeeMeta(selectedEmployee)}` : ""}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-navy-900">Date</span>
            <input
              type="date"
              value={sessionDate}
              onChange={(e) => {
                setSessionDate(e.target.value);
                resetClassSelection();
              }}
              className={inputClass}
              disabled={delegateRequest && !selectedEmployee}
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-navy-900">
              {staffOnly ? "Your class" : "Class to substitute"}
            </span>
            <select
              value={selectedClassIndex === "" ? "" : String(selectedClassIndex)}
              onChange={(e) => {
                setSelectedClassIndex(e.target.value === "" ? "" : Number(e.target.value));
              }}
              className={inputClass}
              disabled={!classes.length || (delegateRequest && !selectedEmployee)}
            >
              <option value="">
                {delegateRequest && !selectedEmployee
                  ? "Select employee first…"
                  : "Select class…"}
              </option>
              {classes.map((item, index) => (
                <option key={`${item.timetableEntryId}-${item.timingSlotId}`} value={index}>
                  {item.slotLabel} ({item.startTime}–{item.endTime}) — {item.subjectName ?? "Class"}
                  {item.sectionName && item.sectionName !== "—"
                    ? ` • Section ${item.sectionName}`
                    : ""}
                </option>
              ))}
            </select>
          </label>
        </div>

        {sessionDate && classes.length === 0 && (staffOnly || selectedEmployee) ? (
          <p className="text-sm text-warning">
            {staffOnly
              ? "You have no assigned classes on this date."
              : "This employee has no assigned classes on this date."}
          </p>
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
                    {[faculty.division, faculty.department, faculty.college, faculty.hrmsEmployeeId]
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
                placeholder="Why is a substitution needed?"
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
