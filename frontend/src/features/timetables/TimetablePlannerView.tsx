"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { cn } from "@/lib/cn";
import { useAcademicContext } from "@/components/layout/AcademicProvider";
import { useAuth } from "@/components/auth/AuthProvider";
import { apiFetch } from "@/lib/api";
import { TimingEditorDrawer } from "@/features/timetables/TimingEditorDrawer";
import {
  classPeriodCellClass,
  emptyPeriodCellClass,
  isNonClassTimingSlot,
  specialPeriodCellClass,
  timingSlotCellClass,
  timingSlotDisplayLabel,
} from "@/features/timetables/timing-slot-utils";

type SlotCell = {
  slotId: number;
  slotType: string;
  assignable: boolean;
  label: string;
  startTime: string;
  endTime: string;
  entry: null | {
    id: number;
    subjectId: number | null;
    subjectCode: string | null;
    subjectName: string | null;
    subjectTypeSnapshot?: string | null;
    entryType: string;
    facultyStaffLinkId: number | null;
    facultyName: string | null;
    facultyHrmsId: string | null;
    roomLabel: string | null;
    customLabel?: string | null;
  };
};

type PlannerResponse = {
  ready: boolean;
  missingTiming?: boolean;
  message?: string;
  context: {
    academicYear: string;
    college: string;
    collegeId?: number;
    course: string;
    courseId?: number;
    branch: string;
    branchId: number | null;
    batch: string;
    year: number | null;
    semester: number | null;
    section: string;
    hasSections: boolean;
    studentCount: number;
    status: string | null;
    timingTemplateName: string | null;
    timingTemplateId?: number;
    planId: number | null;
    versionNo: number | null;
  };
  timing: { id: number; name: string; academicYear: string; semester: number } | null;
  days: string[];
  slotsByDay: Record<
    string,
    Array<{
      id: number;
      label: string;
      startTime: string;
      endTime: string;
      slotType: string;
      isAssignable: boolean;
    }>
  >;
  grid: Record<string, Record<number, SlotCell>>;
  subjects: Array<{ id: number; code: string; name: string; type: string }>;
  faculty: Array<{
    hrmsEmployeeId: string;
    name: string;
    division: string;
    department: string;
    designation: string;
    employeeGroup: string;
  }>;
};

type LocalAssignment = {
  dayOfWeek: string;
  timingSlotId: number;
  subjectId: number | null;
  subjectCode: string;
  subjectName: string;
  subjectTypeSnapshot: string | null;
  entryType: "theory" | "lab" | "other";
  hrmsEmployeeId: string;
  facultyName: string;
  roomLabel: string;
  /** Free/special period label (CRT, Games, Library, etc.) */
  customLabel: string;
};

type PeriodMode = "subject" | "special";

const SPECIAL_PERIOD_SUGGESTIONS = ["CRT", "Games", "Library", "Seminar", "Mentor", "Self Study"];

type ReviewPayload = {
  ok: boolean;
  assignedCount: number;
  unassignedSlots: string[];
  sectionClashes: string[];
  facultyClashes: string[];
  roomClashes: string[];
  warnings: string[];
  unchanged?: boolean;
  unchangedFromPublishedPlanId?: number | null;
  unchangedFromPublishedVersion?: number | null;
  message?: string | null;
};

function assignmentSignature(assignments: LocalAssignment[]): string {
  return JSON.stringify(
    [...assignments]
      .map((item) => ({
        dayOfWeek: item.dayOfWeek,
        timingSlotId: item.timingSlotId,
        subjectId: item.subjectId,
        hrmsEmployeeId: item.hrmsEmployeeId,
        roomLabel: item.roomLabel,
        customLabel: item.customLabel,
        entryType: item.entryType,
      }))
      .sort((a, b) =>
        `${a.dayOfWeek}:${a.timingSlotId}`.localeCompare(`${b.dayOfWeek}:${b.timingSlotId}`),
      ),
  );
}

const DAY_LABEL_TO_CODE: Record<string, string> = {
  Monday: "MON",
  Tuesday: "TUE",
  Wednesday: "WED",
  Thursday: "THUR",
  Friday: "FRI",
  Saturday: "SAT",
  Sunday: "SUN",
};

function mapEmsTypeToEntryType(type: string | null | undefined): "theory" | "lab" | "other" {
  const t = (type ?? "").trim().toLowerCase();
  if (t === "practical" || t === "lab" || t === "practicals") return "lab";
  if (t === "theory") return "theory";
  return "other";
}

function subjectCellDisplay(assignment: Pick<LocalAssignment, "subjectCode" | "subjectName">) {
  const code = assignment.subjectCode.trim();
  const name = assignment.subjectName.trim();
  if (name && code) {
    return { title: name, subtitle: code };
  }
  return { title: name || code || "Subject", subtitle: null };
}

function resolveFacultyForSubject(
  assignments: LocalAssignment[],
  subjectId: number,
  entryType: "theory" | "lab" | "other",
  exclude?: { dayOfWeek: string; timingSlotId: number },
) {
  const candidates = assignments.filter((assignment) => {
    if (!assignment.subjectId || !assignment.hrmsEmployeeId) return false;
    if (assignment.subjectId !== subjectId) return false;
    if (
      exclude &&
      assignment.dayOfWeek === exclude.dayOfWeek &&
      assignment.timingSlotId === exclude.timingSlotId
    ) {
      return false;
    }
    return true;
  });
  const typed = candidates.find((assignment) => assignment.entryType === entryType);
  return (typed ?? candidates[0])?.hrmsEmployeeId ?? "";
}

type PlannerFaculty = PlannerResponse["faculty"][number];

function isMeaningfulFacultyField(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 && trimmed !== "—";
}

function FacultyPickerMeta({
  faculty,
  active = false,
}: {
  faculty: PlannerFaculty;
  active?: boolean;
}) {
  const muted = active ? "text-white/75" : "text-slate-500";
  const label = active ? "text-white/60" : "text-slate-400";
  const emphasis = active ? "text-white/90" : "text-slate-700";

  return (
    <div className="mt-1 space-y-0.5">
      <p className={cn("text-xs", muted)}>
        Emp {faculty.hrmsEmployeeId}
        {isMeaningfulFacultyField(faculty.designation) ? ` · ${faculty.designation}` : ""}
      </p>
      {isMeaningfulFacultyField(faculty.department) ? (
        <p className={cn("text-xs leading-snug", emphasis)}>
          <span className={cn("font-medium", label)}>Dept: </span>
          <span className="break-words">{faculty.department}</span>
        </p>
      ) : null}
      {isMeaningfulFacultyField(faculty.division) ? (
        <p className={cn("text-xs leading-snug", muted)}>
          <span className={cn("font-medium", label)}>Division: </span>
          <span className="break-words">{faculty.division}</span>
        </p>
      ) : null}
    </div>
  );
}

export function TimetablePlannerView() {
  const { filters, masters } = useAcademicContext();
  const { hasPermission, hasAnyPermission } = useAuth();
  const canEdit = hasPermission("timetable.edit");
  const canPublish = hasPermission("timetable.publish");
  const canConfigureTimings = hasAnyPermission("timetable.edit");
  const [planner, setPlanner] = useState<PlannerResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<LocalAssignment[]>([]);
  const [selected, setSelected] = useState<{
    day: string;
    slotId: number;
  } | null>(null);
  const [review, setReview] = useState<ReviewPayload | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [baselineSignature, setBaselineSignature] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [timingsOpen, setTimingsOpen] = useState(false);
  const [form, setForm] = useState({
    mode: "subject" as PeriodMode,
    subjectId: "",
    customLabel: "",
    hrmsEmployeeId: "",
    roomLabel: "",
    entryType: "theory" as "theory" | "lab" | "other",
  });
  const [facultySearch, setFacultySearch] = useState("");
  const [facultyOpen, setFacultyOpen] = useState(false);

  const selectedBranch =
    filters.branchId === "all" || !masters
      ? null
      : masters.branches.find((b) => b.id === filters.branchId) ?? null;

  const selectedCollege =
    filters.collegeId === "all" || !masters
      ? null
      : masters.colleges.find((c) => c.id === filters.collegeId) ?? null;

  const timingContextReady =
    filters.collegeId !== "all" &&
    Boolean(filters.academicYear) &&
    filters.semester !== "all";

  const needsSection = Boolean(selectedBranch?.hasSections);
  const filtersComplete =
    filters.collegeId !== "all" &&
    filters.courseId !== "all" &&
    filters.branchId !== "all" &&
    filters.batch !== "all" &&
    filters.semester !== "all" &&
    Boolean(filters.academicYear) &&
    (!needsSection || filters.section !== "all");

  const query = useMemo(() => {
    if (!filtersComplete) return null;
    const params = new URLSearchParams();
    params.set("collegeId", String(filters.collegeId));
    params.set("courseId", String(filters.courseId));
    params.set("branchId", String(filters.branchId));
    params.set("batch", String(filters.batch));
    params.set("semester", String(filters.semester));
    params.set("academicYear", filters.academicYear);
    if (filters.year !== "all") params.set("year", String(filters.year));
    if (filters.section !== "all") params.set("section", filters.section);
    return `?${params.toString()}`;
  }, [filters, filtersComplete]);

  const loadPlanner = useCallback(async () => {
    if (!query) {
      setPlanner(null);
      setAssignments([]);
      setReview(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch(`/timetables/planner${query}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`Failed to load planner (${response.status})`);
      const data = (await response.json()) as PlannerResponse;
      setPlanner(data);
      const loaded: LocalAssignment[] = [];
      for (const day of data.days ?? []) {
        const dayGrid = data.grid?.[day] ?? {};
        for (const cell of Object.values(dayGrid)) {
          if (!cell.assignable || !cell.entry) continue;
          const customLabel = (cell.entry.customLabel ?? "").trim();
          const isSpecial = Boolean(customLabel) && !cell.entry.subjectId;
          const isSubjectClass =
            Boolean(cell.entry.subjectId) && Boolean(cell.entry.facultyHrmsId);
          if (!isSpecial && !isSubjectClass) continue;
          loaded.push({
            dayOfWeek: DAY_LABEL_TO_CODE[day] ?? day,
            timingSlotId: cell.slotId,
            subjectId: cell.entry.subjectId,
            subjectCode: cell.entry.subjectCode ?? "",
            subjectName: cell.entry.subjectName ?? "",
            subjectTypeSnapshot: cell.entry.subjectTypeSnapshot ?? null,
            entryType: (cell.entry.entryType as "theory" | "lab" | "other") || "theory",
            hrmsEmployeeId: cell.entry.facultyHrmsId ?? "",
            facultyName: cell.entry.facultyName ?? "",
            roomLabel: cell.entry.roomLabel ?? "",
            customLabel: isSpecial ? customLabel : "",
          });
        }
      }
      setAssignments(loaded);
      setBaselineSignature(assignmentSignature(loaded));
      setReview(null);
      setInfo(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load planner");
      setPlanner(null);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void loadPlanner();
  }, [loadPlanner]);

  const currentSignature = useMemo(() => assignmentSignature(assignments), [assignments]);
  const hasLocalChanges =
    baselineSignature != null && currentSignature !== baselineSignature;
  const isPublished = planner?.context.status === "published";
  const publishBlocked = isPublished && !hasLocalChanges;

  const assignmentMap = useMemo(() => {
    const map = new Map<string, LocalAssignment>();
    for (const item of assignments) {
      map.set(`${item.dayOfWeek}:${item.timingSlotId}`, item);
    }
    return map;
  }, [assignments]);

  const openAssign = (day: string, cell: SlotCell) => {
    if (!cell.assignable) return;
    const dayCode = DAY_LABEL_TO_CODE[day] ?? day;
    const existing = assignmentMap.get(`${dayCode}:${cell.slotId}`);
    const isSpecial = Boolean(existing?.customLabel) && !existing?.subjectId;
    const entryType = existing?.entryType ?? "theory";
    const subjectId = existing?.subjectId ? String(existing.subjectId) : "";
    const inferredFaculty =
      !existing?.hrmsEmployeeId && subjectId
        ? resolveFacultyForSubject(assignments, Number(subjectId), entryType, {
            dayOfWeek: dayCode,
            timingSlotId: cell.slotId,
          })
        : "";
    setSelected({ day, slotId: cell.slotId });
    setFacultySearch("");
    setFacultyOpen(false);
    setForm({
      mode: isSpecial ? "special" : "subject",
      subjectId,
      customLabel: existing?.customLabel ?? "",
      hrmsEmployeeId: existing?.hrmsEmployeeId ?? inferredFaculty,
      roomLabel: existing?.roomLabel ?? "",
      entryType,
    });
  };

  const saveLocalAssignment = () => {
    if (!selected || !planner) return;
    const dayCode = DAY_LABEL_TO_CODE[selected.day] ?? selected.day;
    const faculty = planner.faculty.find((f) => f.hrmsEmployeeId === form.hrmsEmployeeId);

    if (form.mode === "special") {
      const customLabel = form.customLabel.trim();
      if (!customLabel) {
        setError("Enter a free/special period name (e.g. CRT, Games, Library)");
        return;
      }
      setAssignments((prev) => {
        const next = prev.filter(
          (a) => !(a.dayOfWeek === dayCode && a.timingSlotId === selected.slotId),
        );
        next.push({
          dayOfWeek: dayCode,
          timingSlotId: selected.slotId,
          subjectId: null,
          subjectCode: "",
          subjectName: "",
          subjectTypeSnapshot: null,
          entryType: "other",
          hrmsEmployeeId: faculty?.hrmsEmployeeId ?? "",
          facultyName: faculty?.name ?? "",
          roomLabel: form.roomLabel.trim(),
          customLabel,
        });
        return next;
      });
      setSelected(null);
      setError(null);
      return;
    }

    const subject = planner.subjects.find((s) => String(s.id) === form.subjectId);
    if (!subject || !faculty) {
      setError("Subject and Faculty are required");
      return;
    }
    setAssignments((prev) => {
      const next = prev.filter(
        (a) => !(a.dayOfWeek === dayCode && a.timingSlotId === selected.slotId),
      );
      next.push({
        dayOfWeek: dayCode,
        timingSlotId: selected.slotId,
        subjectId: subject.id,
        subjectCode: subject.code,
        subjectName: subject.name,
        subjectTypeSnapshot: subject.type ?? null,
        entryType: form.entryType,
        hrmsEmployeeId: faculty.hrmsEmployeeId,
        facultyName: faculty.name,
        roomLabel: form.roomLabel.trim(),
        customLabel: "",
      });
      return next;
    });
    setSelected(null);
    setError(null);
  };

  const clearLocalAssignment = () => {
    if (!selected) return;
    const dayCode = DAY_LABEL_TO_CODE[selected.day] ?? selected.day;
    setAssignments((prev) =>
      prev.filter(
        (a) => !(a.dayOfWeek === dayCode && a.timingSlotId === selected.slotId),
      ),
    );
    setForm({
      mode: "subject",
      subjectId: "",
      customLabel: "",
      hrmsEmployeeId: "",
      roomLabel: "",
      entryType: "theory",
    });
    setFacultySearch("");
    setFacultyOpen(false);
    setSelected(null);
    setError(null);
  };

  const scopeBody = () => {
    if (!planner?.context || filters.collegeId === "all") return null;
    return {
      collegeId: Number(filters.collegeId),
      courseId: Number(filters.courseId),
      branchId: Number(filters.branchId),
      academicYear: filters.academicYear,
      batch: String(filters.batch),
      year: filters.year === "all" ? null : Number(filters.year),
      semester: Number(filters.semester),
      section: filters.section === "all" ? null : filters.section,
      assignments: assignments.map((a) => ({
        dayOfWeek: a.dayOfWeek,
        timingSlotId: a.timingSlotId,
        subjectId: a.subjectId,
        entryType: a.entryType,
        hrmsEmployeeId: a.hrmsEmployeeId || null,
        facultyName: a.facultyName || null,
        roomLabel: a.roomLabel || null,
        customLabel: a.customLabel || null,
      })),
    };
  };

  const saveDraft = async () => {
    const body = scopeBody();
    if (!body) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const response = await apiFetch(`/timetables/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Save draft failed");
      if (data.unchanged) {
        setInfo(
          `Timetable is already published (plan #${data.planId}, version ${data.versionNo ?? "—"}) with no changes.`,
        );
      }
      await loadPlanner();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save draft failed");
    } finally {
      setBusy(false);
    }
  };

  const runReview = async () => {
    await saveDraft();
    const planId = planner?.context.planId;
    // reload to get plan id after save
    const body = scopeBody();
    if (!body) return;
    setBusy(true);
    try {
      const plannerRes = await apiFetch(`/timetables/planner${query}`, {
        cache: "no-store",
      });
      const latest = (await plannerRes.json()) as PlannerResponse;
      const id = latest.context.planId ?? planId;
      if (!id) throw new Error("Save draft first");
      const response = await apiFetch(`/timetables/${id}/review`, {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Review failed");
      setReview(data.review as ReviewPayload);
      await loadPlanner();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Review failed");
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    if (publishBlocked) {
      setInfo(
        `This timetable is already published (plan #${planner?.context.planId ?? "—"}, version ${planner?.context.versionNo ?? "—"}). Edit a period before publishing again.`,
      );
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await saveDraft();
      const plannerRes = await apiFetch(`/timetables/planner${query}`, {
        cache: "no-store",
      });
      const latest = (await plannerRes.json()) as PlannerResponse;
      const id = latest.context.planId;
      if (!id) throw new Error("No draft plan to publish");
      const response = await apiFetch(`/timetables/${id}/publish`, {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok) {
        if (data.review) setReview(data.review as ReviewPayload);
        throw new Error(data.message || "Publish failed");
      }
      setReview(data.review as ReviewPayload);
      await loadPlanner();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Publish failed");
    } finally {
      setBusy(false);
    }
  };

  const missingLabel = !filtersComplete
    ? "Select College, Course, Branch, Batch, Semester" +
      (needsSection ? ", and Section" : "") +
      " to open the timetable."
    : null;

  const headerSlots = useMemo(() => {
    if (!planner?.days?.length) return [];
    // Use Monday (or first day) class+break structure for column headers when days share labels;
    // otherwise show union of labels from first day only for compact display.
    const firstDay = planner.days[0];
    return planner.slotsByDay?.[firstDay] ?? [];
  }, [planner]);

  const selectedSlotMeta = useMemo(() => {
    if (!selected || !planner) return null;
    const daySlots = planner.slotsByDay?.[selected.day] ?? [];
    return daySlots.find((s) => s.id === selected.slotId) ?? null;
  }, [selected, planner]);

  const filteredFaculty = useMemo(() => {
    const list = planner?.faculty ?? [];
    const q = facultySearch.trim().toLowerCase();
    if (q.length < 2) return [];
    return list.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        f.hrmsEmployeeId.toLowerCase().includes(q) ||
        f.department.toLowerCase().includes(q) ||
        f.division.toLowerCase().includes(q) ||
        f.designation.toLowerCase().includes(q),
    );
  }, [planner?.faculty, facultySearch]);

  const visibleFaculty = useMemo(
    () => filteredFaculty.slice(0, 6),
    [filteredFaculty],
  );

  const selectedFaculty = useMemo(() => {
    if (!form.hrmsEmployeeId || !planner) return null;
    return (
      planner.faculty.find((f) => f.hrmsEmployeeId === form.hrmsEmployeeId) ?? null
    );
  }, [form.hrmsEmployeeId, planner]);

  const facultyAutoMatched = useMemo(() => {
    if (!selected || form.mode !== "subject" || !form.subjectId || !form.hrmsEmployeeId) {
      return false;
    }
    const dayCode = DAY_LABEL_TO_CODE[selected.day] ?? selected.day;
    const inferred = resolveFacultyForSubject(
      assignments,
      Number(form.subjectId),
      form.entryType,
      { dayOfWeek: dayCode, timingSlotId: selected.slotId },
    );
    return inferred === form.hrmsEmployeeId;
  }, [assignments, form.entryType, form.hrmsEmployeeId, form.mode, form.subjectId, selected]);

  const fieldClass =
    "h-10 w-full rounded-lg border border-border bg-white px-3 text-sm text-navy-900 outline-none transition-colors focus:border-navy-700 focus:ring-2 focus:ring-navy-900/10";

  return (
    <div>
      <PageHeader
        title="Timetable Planning"
        description="College-specific timing templates owned by Academic Portal. Student DB is used only for academic masters."
        actions={
          <>
            {timingContextReady && canConfigureTimings ? (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setTimingsOpen(true)}
              >
                {planner?.missingTiming || !planner?.timing
                  ? "Configure Timings"
                  : "Edit Timings"}
              </Button>
            ) : null}
            {canEdit ? (
              <Button variant="secondary" disabled={!planner?.ready || busy} onClick={() => void saveDraft()}>
                Save Draft
              </Button>
            ) : null}
            {canEdit ? (
              <Button variant="secondary" disabled={!planner?.ready || busy} onClick={() => void runReview()}>
                Review
              </Button>
            ) : null}
            {canPublish ? (
              <Button
                disabled={!planner?.ready || busy || publishBlocked}
                onClick={() => void publish()}
              >
                Publish
              </Button>
            ) : null}
          </>
        }
      />

      {missingLabel ? (
        <Card className="mb-4">
          <p className="text-sm text-slate-600">{missingLabel}</p>
        </Card>
      ) : null}

      {loading ? (
        <Card className="mb-4">
          <p className="text-sm text-slate-500">Loading timetable…</p>
        </Card>
      ) : null}

      {error ? (
        <Card className="mb-4">
          <p className="text-sm text-critical">{error}</p>
        </Card>
      ) : null}

      {info ? (
        <Card className="mb-4 border-brand-200 bg-brand-50/40">
          <p className="text-sm text-navy-900">{info}</p>
        </Card>
      ) : null}

      {publishBlocked ? (
        <Card className="mb-4 border-emerald-200 bg-emerald-50">
          <p className="text-sm font-medium text-navy-900">Timetable already published</p>
          <p className="mt-1 text-sm text-slate-700">
            Plan #{planner?.context.planId ?? "—"}
            {planner?.context.versionNo ? ` · version ${planner.context.versionNo}` : ""} is live.
            Make changes to a period before publishing again.
          </p>
        </Card>
      ) : null}

      {planner?.missingTiming ? (
        <Card className="mb-4 border-warning/40 bg-amber-50">
          <h3 className="font-semibold text-navy-900">No timing configured</h3>
          <p className="mt-2 text-sm text-slate-700">
            {planner.message ||
              "Configure the college timing schedule for this academic year and semester before creating the timetable."}
          </p>
          {timingContextReady ? (
            <div className="mt-3">
              <Button onClick={() => setTimingsOpen(true)}>Configure Timings</Button>
            </div>
          ) : null}
        </Card>
      ) : null}

      {planner?.ready ? (
        <>
          <Card className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-navy-900">
                {planner.context.college}
              </h3>
              <p className="text-sm text-slate-500">
                {planner.context.academicYear} • Semester {planner.context.semester}
                {" • "}
                Timing: {planner.context.timingTemplateName}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                {planner.context.course} / {planner.context.branch}
                {planner.context.hasSections ? ` • Section ${planner.context.section}` : ""}
                {" • Batch "}
                {planner.context.batch}
                {planner.context.year ? ` • Year ${planner.context.year}` : ""}
                {" • "}
                {planner.context.studentCount.toLocaleString()} students
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => setTimingsOpen(true)}>
                Edit Timings
              </Button>
              <StatusBadge status={planner.context.status || "draft"} />
              {planner.context.planId ? (
                <p className="text-xs text-slate-500">
                  Plan #{planner.context.planId}
                  {planner.context.versionNo ? ` • v${planner.context.versionNo}` : ""}
                </p>
              ) : (
                <p className="text-xs text-slate-500">Unsaved workspace</p>
              )}
            </div>
          </Card>

          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[980px] table-fixed border-collapse text-sm">
              <colgroup>
                <col style={{ width: "5.5rem" }} />
                {headerSlots.map((slot) => (
                  <col key={slot.id} />
                ))}
              </colgroup>
              <thead>
                <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <th className="border-b border-border px-2 py-2 text-left">Day</th>
                  {headerSlots.map((slot) => {
                    const nonClass = isNonClassTimingSlot(slot);
                    return (
                      <th key={slot.id} className="border-b border-border px-2 py-2 text-center">
                        <div className="truncate">
                          {nonClass ? timingSlotDisplayLabel(slot) : slot.label}
                        </div>
                        <div className="truncate font-normal normal-case text-[10px] text-slate-400">
                          {nonClass ? slot.label : null}
                          {nonClass ? " · " : null}
                          {slot.startTime}–{slot.endTime}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {planner.days.map((day) => {
                  const daySlots = planner.slotsByDay?.[day] ?? [];
                  const dayCode = DAY_LABEL_TO_CODE[day] ?? day;
                  return (
                    <tr key={day}>
                      <td className="border-b border-border px-2 py-2 font-medium text-navy-900">
                        {day}
                      </td>
                      {headerSlots.map((headerSlot) => {
                        const slot =
                          daySlots.find(
                            (s) =>
                              s.label === headerSlot.label &&
                              s.startTime === headerSlot.startTime,
                          ) ?? null;
                        if (!slot) {
                          return (
                            <td
                              key={`${day}-${headerSlot.id}`}
                              className="border-b border-border bg-slate-50/60 p-1.5"
                            />
                          );
                        }
                        const cell = planner.grid[day]?.[slot.id];
                        const local = assignmentMap.get(`${dayCode}:${slot.id}`);
                        const subject =
                          local && !local.customLabel ? subjectCellDisplay(local) : null;
                        const isBreak = isNonClassTimingSlot(slot);

                        if (isBreak) {
                          return (
                            <td key={`${day}-${slot.id}`} className="border-b border-border p-1.5">
                              <div
                                className={cn(
                                  "flex h-24 flex-col items-center justify-center rounded-md text-xs font-semibold",
                                  timingSlotCellClass(slot),
                                )}
                              >
                                <span>{timingSlotDisplayLabel(slot)}</span>
                                <span className="mt-0.5 text-[10px] font-normal opacity-80">
                                  {slot.startTime}–{slot.endTime}
                                </span>
                              </div>
                            </td>
                          );
                        }

                        return (
                          <td key={`${day}-${slot.id}`} className="border-b border-border p-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                openAssign(day, {
                                  slotId: slot.id,
                                  slotType: slot.slotType,
                                  assignable: true,
                                  label: slot.label,
                                  startTime: slot.startTime,
                                  endTime: slot.endTime,
                                  entry: cell?.entry ?? null,
                                })
                              }
                              className={cn(
                                "h-24 w-full rounded-md border px-2 py-1.5 text-left transition-colors",
                                selected?.day === day && selected.slotId === slot.id
                                  ? "border-navy-800 ring-1 ring-navy-800"
                                  : "border-border hover:border-slate-300",
                                local?.customLabel
                                  ? specialPeriodCellClass()
                                  : local
                                    ? classPeriodCellClass()
                                    : emptyPeriodCellClass(),
                              )}
                            >
                              {local ? (
                                <>
                                  {local.customLabel ? (
                                    <p className="font-semibold text-navy-900">{local.customLabel}</p>
                                  ) : subject ? (
                                    <>
                                      <p className="line-clamp-2 font-semibold leading-snug text-navy-900">
                                        {subject.title}
                                      </p>
                                      {subject.subtitle ? (
                                        <p className="text-xs font-mono text-slate-500">
                                          {subject.subtitle}
                                        </p>
                                      ) : null}
                                    </>
                                  ) : null}
                                  {local.customLabel ? (
                                    <p className="text-xs text-violet-700">Free / Special</p>
                                  ) : null}
                                  {local.facultyName ? (
                                    <p className="text-xs text-slate-600">{local.facultyName}</p>
                                  ) : null}
                                  {local.roomLabel ? (
                                    <p className="text-xs text-slate-500">Room {local.roomLabel}</p>
                                  ) : null}
                                </>
                              ) : (
                                <p className="text-xs text-slate-400">Free / Assign</p>
                              )}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {selected && planner ? (
            <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
              <button
                type="button"
                className="absolute inset-0 bg-navy-950/45"
                aria-label="Close assign dialog"
                onClick={() => setSelected(null)}
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="assign-class-title"
                className="relative z-10 flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
              >
                <div className="border-b border-border px-5 py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3
                        id="assign-class-title"
                        className="text-lg font-semibold text-navy-900"
                      >
                        Assign Period
                      </h3>
                      <p className="mt-0.5 text-sm text-slate-500">
                        {selected.day}
                        {selectedSlotMeta
                          ? ` · ${selectedSlotMeta.label} · ${selectedSlotMeta.startTime}–${selectedSlotMeta.endTime}`
                          : null}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelected(null)}
                      className="rounded-md px-2 py-1 text-lg leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      aria-label="Close"
                    >
                      ×
                    </button>
                  </div>
                </div>

                <div className="space-y-3 px-5 py-4">
                  <div className="flex gap-2 rounded-lg border border-border bg-slate-50 p-1">
                    <button
                      type="button"
                      className={cn(
                        "flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                        form.mode === "subject"
                          ? "bg-white text-navy-900 shadow-sm"
                          : "text-slate-600 hover:text-navy-900",
                      )}
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          mode: "subject",
                          customLabel: "",
                        }))
                      }
                    >
                      Subject class
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                        form.mode === "special"
                          ? "bg-white text-navy-900 shadow-sm"
                          : "text-slate-600 hover:text-navy-900",
                      )}
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          mode: "special",
                          subjectId: "",
                          entryType: "other",
                        }))
                      }
                    >
                      Free / Special
                    </button>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {form.mode === "special" ? (
                      <label className="block text-sm sm:col-span-2">
                        <span className="mb-1.5 block font-medium text-slate-700">
                          Period name
                        </span>
                        <input
                          className={fieldClass}
                          placeholder="e.g. CRT, Games, Library"
                          value={form.customLabel}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, customLabel: e.target.value }))
                          }
                        />
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {SPECIAL_PERIOD_SUGGESTIONS.map((label) => (
                            <button
                              key={label}
                              type="button"
                              className={cn(
                                "rounded-md border px-2 py-1 text-xs transition-colors",
                                form.customLabel.trim().toLowerCase() ===
                                  label.toLowerCase()
                                  ? "border-navy-800 bg-navy-900 text-white"
                                  : "border-border bg-white text-slate-600 hover:border-slate-300",
                              )}
                              onClick={() =>
                                setForm((f) => ({ ...f, customLabel: label }))
                              }
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </label>
                    ) : (
                      <label className="block text-sm sm:col-span-2">
                        <span className="mb-1.5 block font-medium text-slate-700">
                          Subject
                        </span>
                        <select
                          className={fieldClass}
                          value={form.subjectId}
                          onChange={(e) => {
                            const subjectId = e.target.value;
                            const subject = planner.subjects.find(
                              (s) => String(s.id) === subjectId,
                            );
                            const entryType = subject
                              ? mapEmsTypeToEntryType(subject.type)
                              : form.entryType;
                            const dayCode = selected
                              ? DAY_LABEL_TO_CODE[selected.day] ?? selected.day
                              : "";
                            const inferredFaculty = subjectId
                              ? resolveFacultyForSubject(
                                  assignments,
                                  Number(subjectId),
                                  entryType,
                                  selected
                                    ? {
                                        dayOfWeek: dayCode,
                                        timingSlotId: selected.slotId,
                                      }
                                    : undefined,
                                )
                              : "";
                            setForm((f) => ({
                              ...f,
                              subjectId,
                              entryType,
                              hrmsEmployeeId: inferredFaculty,
                            }));
                            if (inferredFaculty) {
                              setFacultySearch("");
                              setFacultyOpen(false);
                            }
                          }}
                        >
                          <option value="">Select subject</option>
                          {planner.subjects.map((subject) => (
                            <option key={subject.id} value={subject.id}>
                              {subject.code} — {subject.name}
                              {subject.type ? ` (${subject.type})` : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}

                    <label className="block text-sm">
                      <span className="mb-1.5 block font-medium text-slate-700">
                        Room / Lab{" "}
                        <span className="font-normal text-slate-400">(optional)</span>
                      </span>
                      <input
                        className={fieldClass}
                        placeholder="e.g. Lab-1, A-204"
                        value={form.roomLabel}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, roomLabel: e.target.value }))
                        }
                      />
                    </label>

                    {form.mode === "subject" ? (
                      <label className="block text-sm">
                        <span className="mb-1.5 block font-medium text-slate-700">
                          Class Type
                        </span>
                        <select
                          className={fieldClass}
                          value={form.entryType}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              entryType: e.target.value as "theory" | "lab" | "other",
                            }))
                          }
                        >
                          <option value="theory">Theory</option>
                          <option value="lab">Lab</option>
                          <option value="other">Other</option>
                        </select>
                      </label>
                    ) : (
                      <div className="block text-sm">
                        <span className="mb-1.5 block font-medium text-slate-700">
                          Type
                        </span>
                        <div className={cn(fieldClass, "flex items-center text-slate-600")}>
                          Free / Special period
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="block text-sm">
                    <span className="mb-1.5 block font-medium text-slate-700">
                      Faculty{" "}
                      {form.mode === "special" ? (
                        <span className="font-normal text-slate-400">(optional)</span>
                      ) : null}
                    </span>

                    {selectedFaculty && !facultyOpen ? (
                      <div className="flex items-start justify-between gap-2 rounded-lg border border-navy-200 bg-navy-50/60 px-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-navy-900">{selectedFaculty.name}</p>
                          <FacultyPickerMeta faculty={selectedFaculty} />
                          {facultyAutoMatched ? (
                            <p className="mt-1 text-xs text-emerald-700">
                              Auto-filled from another period for this subject.
                            </p>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          className="shrink-0 text-xs font-medium text-navy-800 hover:underline"
                          onClick={() => {
                            setForm((f) => ({ ...f, hrmsEmployeeId: "" }));
                            setFacultySearch("");
                            setFacultyOpen(true);
                          }}
                        >
                          Change
                        </button>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-border bg-white">
                        <div className="p-2">
                          <input
                            type="search"
                            autoFocus={!selectedFaculty && form.mode === "subject"}
                            placeholder="Type at least 2 letters to search faculty…"
                            className="h-9 w-full rounded-md border border-border bg-slate-50 px-3 text-sm outline-none focus:border-navy-700 focus:bg-white focus:ring-2 focus:ring-navy-900/10"
                            value={facultySearch}
                            onChange={(e) => {
                              setFacultySearch(e.target.value);
                              setFacultyOpen(true);
                            }}
                          />
                        </div>

                        {facultySearch.trim().length < 2 ? (
                          <p className="border-t border-border px-3 py-3 text-xs text-slate-500">
                            Search by name, emp no, department, division, or designation.
                            {form.mode === "special"
                              ? " Faculty is optional for free/special periods."
                              : ""}
                          </p>
                        ) : filteredFaculty.length === 0 ? (
                          <p className="border-t border-border px-3 py-3 text-sm text-slate-500">
                            No matching staff
                          </p>
                        ) : (
                          <div className="max-h-72 overflow-y-auto border-t border-border p-2">
                            <div className="grid grid-cols-1 gap-1.5">
                              {visibleFaculty.map((faculty) => {
                                const active =
                                  form.hrmsEmployeeId === faculty.hrmsEmployeeId;
                                return (
                                  <button
                                    key={faculty.hrmsEmployeeId}
                                    type="button"
                                    className={cn(
                                      "flex w-full flex-col items-start rounded-md border px-3 py-2.5 text-left transition-colors",
                                      active
                                        ? "border-navy-900 bg-navy-900 text-white"
                                        : "border-border/80 hover:border-slate-300 hover:bg-slate-50",
                                    )}
                                    onClick={() => {
                                      setForm((f) => ({
                                        ...f,
                                        hrmsEmployeeId: faculty.hrmsEmployeeId,
                                      }));
                                      setFacultySearch("");
                                      setFacultyOpen(false);
                                    }}
                                  >
                                    <span
                                      className={cn(
                                        "text-sm font-medium leading-snug",
                                        active ? "text-white" : "text-navy-900",
                                      )}
                                    >
                                      {faculty.name}
                                    </span>
                                    <FacultyPickerMeta faculty={faculty} active={active} />
                                  </button>
                                );
                              })}
                            </div>
                            {filteredFaculty.length > 6 ? (
                              <p className="mt-2 text-xs text-slate-500">
                                Showing 6 of {filteredFaculty.length} — type more to narrow
                              </p>
                            ) : (
                              <p className="mt-2 text-xs text-slate-500">
                                {filteredFaculty.length} match
                                {filteredFaculty.length === 1 ? "" : "es"}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-border bg-slate-50/80 px-5 py-3">
                  <Button variant="ghost" onClick={() => setSelected(null)}>
                    Cancel
                  </Button>
                  <Button variant="secondary" onClick={clearLocalAssignment}>
                    Clear
                  </Button>
                  <Button onClick={saveLocalAssignment}>
                    {form.mode === "special" ? "Save Period" : "Assign"}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          {review ? (
            <Card className="mt-4">
              <h3 className="mb-3 text-base font-semibold text-navy-900">Timetable Review</h3>
              {review.unchanged ? (
                <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-navy-900">
                  {review.message ??
                    "No changes since the last published timetable. Publishing is not required."}
                </div>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 text-sm">
                <div>
                  <p className="font-medium text-navy-900">Assigned Classes</p>
                  <p className="text-slate-600">{review.assignedCount}</p>
                </div>
                <div>
                  <p className="font-medium text-navy-900">Unassigned Slots</p>
                  <ul className="mt-1 list-disc pl-4 text-slate-600">
                    {review.unassignedSlots.length === 0 ? (
                      <li>None</li>
                    ) : (
                      review.unassignedSlots.slice(0, 12).map((item) => (
                        <li key={item}>{item}</li>
                      ))
                    )}
                  </ul>
                </div>
                <div>
                  <p className="font-medium text-navy-900">Section Clashes</p>
                  <ul className="mt-1 list-disc pl-4 text-slate-600">
                    {review.sectionClashes.length === 0 ? (
                      <li>None</li>
                    ) : (
                      review.sectionClashes.map((item) => <li key={item}>{item}</li>)
                    )}
                  </ul>
                </div>
                <div>
                  <p className="font-medium text-navy-900">Faculty Clashes</p>
                  <ul className="mt-1 list-disc pl-4 text-slate-600">
                    {review.facultyClashes.length === 0 ? (
                      <li>None</li>
                    ) : (
                      review.facultyClashes.map((item) => <li key={item}>{item}</li>)
                    )}
                  </ul>
                </div>
                <div>
                  <p className="font-medium text-navy-900">Room Clashes</p>
                  <p className="text-slate-600">
                    {review.roomClashes.length === 0
                      ? "Not enforced (no room master)"
                      : review.roomClashes.join("; ")}
                  </p>
                </div>
                <div>
                  <p className="font-medium text-navy-900">Warnings</p>
                  <ul className="mt-1 list-disc pl-4 text-slate-600">
                    {review.warnings.length === 0 ? (
                      <li>None</li>
                    ) : (
                      review.warnings.map((item) => <li key={item}>{item}</li>)
                    )}
                  </ul>
                </div>
              </div>
            </Card>
          ) : null}
        </>
      ) : null}

      {timingContextReady && selectedCollege ? (
        <TimingEditorDrawer
          open={timingsOpen}
          collegeId={Number(filters.collegeId)}
          collegeName={selectedCollege.name}
          academicYear={filters.academicYear}
          semester={Number(filters.semester)}
          onClose={() => setTimingsOpen(false)}
          onSaved={() => {
            void loadPlanner();
          }}
        />
      ) : null}
    </div>
  );
}
