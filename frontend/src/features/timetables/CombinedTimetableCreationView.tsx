"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  Briefcase,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  CheckSquare,
  Clock,
  Copy,
  GraduationCap,
  Info,
  Layers,
  Layers3,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Square,
  Trash2,
  UserCheck,
  Users,
  X,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAcademicContext } from "@/components/layout/AcademicProvider";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  isNonClassTimingSlot,
  timingSlotDisplayLabel,
} from "@/features/timetables/timing-slot-utils";

const DAY_CODE_TO_LABEL: Record<string, string> = {
  MON: "Monday",
  TUE: "Tuesday",
  WED: "Wednesday",
  THUR: "Thursday",
  FRI: "Friday",
  SAT: "Saturday",
  SUN: "Sunday",
};

const DAY_LABEL_TO_CODE: Record<string, string> = {
  Monday: "MON",
  Tuesday: "TUE",
  Wednesday: "WED",
  Thursday: "THUR",
  Friday: "FRI",
  Saturday: "SAT",
  Sunday: "SUN",
};

type TimingSlot = {
  id: number;
  label: string;
  startTime: string;
  endTime: string;
  slotType: string;
  isAssignable: boolean;
  dayOfWeek?: string;
  dayLabel?: string;
};

type BranchPlanEntry = {
  id: number;
  dayOfWeek: string;
  timingSlotId: number;
  subjectId: number | null;
  subjectCode: string | null;
  subjectName: string | null;
  subjectTypeSnapshot?: string | null;
  entryType: string;
  facultyStaffLinkId: number | null;
  facultyName: string | null;
  facultyHrmsId: string | null;
  roomLabel: string | null;
  batchLabel: string | null;
  customLabel: string | null;
  weeklyRotation?: boolean;
  rotationPattern?: string | null;
};

type BranchOverview = {
  branchId: number;
  branchName: string;
  branchCode: string | null;
  plan: null | {
    id: number;
    status: string;
    versionNo: number;
    timingTemplateName: string | null;
    sectionName: string | null;
    notes: string | null;
    assignedCount: number;
    entries: BranchPlanEntry[];
  };
};

type CombinedSubject = {
  id: number;
  code: string;
  name: string;
  type: string;
  semester: number | null;
  year: number | null;
  branchIds: number[];
  branchNames: string[];
  isCommon: boolean;
};

type FacultyOption = {
  hrmsEmployeeId: string;
  name: string;
  division: string;
  department: string;
  designation: string;
  employeeGroup: string;
};

type LocalPeriodAssignment = {
  dayOfWeek: string;
  timingSlotId: number;
  subjectId: number | null;
  subjectCode: string;
  subjectName: string;
  entryType: "theory" | "lab" | "other";
  hrmsEmployeeId: string;
  facultyName: string;
  roomLabel: string;
  batchLabel: string;
  customLabel: string;
};

const SPECIAL_PERIOD_PRESETS = [
  "CRT",
  "Library",
  "Games & Sports",
  "Seminar",
  "Mentoring",
  "Self Study",
  "Club Activities",
];

const ROOM_SUGGESTIONS = [
  "Room 101",
  "Room 102",
  "Room 201",
  "Room 202",
  "Room 301",
  "CSE Lab 1",
  "ECE Lab",
  "Central Seminar Hall",
  "Drawing Hall",
];

function getCurrentAcademicYearLabel(): string {
  const now = new Date();
  const currentYear = now.getFullYear();
  // Academic session: Indian academic sessions begin June/July (month >= 5)
  // Calendar current year with next year (e.g. 2026-2027)
  const startYear = now.getMonth() >= 5 ? currentYear : currentYear - 1;
  return `${startYear}-${startYear + 1}`;
}

function calculateSlotDurationMinutes(slot?: TimingSlot): number {
  if (!slot?.startTime || !slot?.endTime) return 50;
  const [sh, sm] = slot.startTime.split(":").map(Number);
  const [eh, em] = slot.endTime.split(":").map(Number);
  if (!Number.isFinite(sh) || !Number.isFinite(sm) || !Number.isFinite(eh) || !Number.isFinite(em)) return 50;
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  const diff = end - start;
  return diff > 0 ? diff : 50;
}

function formatMinutesToHours(minutes: number): string {
  const hours = minutes / 60;
  return hours % 1 === 0 ? `${hours} hrs` : `${hours.toFixed(1)} hrs`;
}

export function CombinedTimetableCreationView() {
  const { masters, loading: mastersLoading } = useAcademicContext();

  // Selected filters
  const [collegeId, setCollegeId] = useState<number | null>(null);
  const [courseId, setCourseId] = useState<number | null>(null);
  const [academicYear, setAcademicYear] = useState<string>("");
  const [year, setYear] = useState<number>(1);
  const [semester, setSemester] = useState<number>(1);
  const [section, setSection] = useState<string>("all");

  // Multi-selected branches checklist
  const [selectedBranchIds, setSelectedBranchIds] = useState<number[]>([]);

  // Remote data
  const [branchesOverview, setBranchesOverview] = useState<BranchOverview[]>([]);
  const [timingSlots, setTimingSlots] = useState<TimingSlot[]>([]);
  const [timingTemplateName, setTimingTemplateName] = useState<string>("");
  const [subjects, setSubjects] = useState<CombinedSubject[]>([]);
  const [facultyList, setFacultyList] = useState<FacultyOption[]>([]);
  const [loadingOverview, setLoadingOverview] = useState<boolean>(false);
  const [loadingSubjects, setLoadingSubjects] = useState<boolean>(false);

  // Editor assignments grid: key = `${dayOfWeek}:${timingSlotId}`
  const [assignments, setAssignments] = useState<Record<string, LocalPeriodAssignment>>({});

  // Slot modal state
  const [activeSlotModal, setActiveSlotModal] = useState<{
    day: string;
    slot: TimingSlot;
    current?: LocalPeriodAssignment;
  } | null>(null);

  // Publish & Workload review modal state
  const [isPublishModalOpen, setIsPublishModalOpen] = useState<boolean>(false);
  const [reviewTab, setReviewTab] = useState<"faculty" | "subjects">("faculty");

  // Operation statuses
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveStatus, setSaveStatus] = useState<{
    type: "success" | "error";
    message: string;
    details?: Array<{ branchId: number; planId: number; status: string; versionNo: number }>;
    workloadSummary?: {
      totalSlots: number;
      totalHours: string;
      facultyCount: number;
      subjectsCount: number;
    };
  } | null>(null);

  // Resolve current active academic year strictly to current year with next year (e.g. 2026-2027)
  const currentAcademicYear = useMemo(() => {
    const calculated = getCurrentAcademicYearLabel();
    if (!masters) return calculated;

    // 1. Explicitly match the calculated current academic year in masters list
    const match = masters.academicYears.find((ay) => ay.label === calculated);
    if (match) return match.label;

    // 2. If defaults exists and does not exceed current calendar year, use it
    if (
      masters.defaults?.academicYear &&
      parseInt(masters.defaults.academicYear.slice(0, 4), 10) <= new Date().getFullYear()
    ) {
      return masters.defaults.academicYear;
    }

    // 3. Fall back to active flag in masters if not a future year
    const activeAy = masters.academicYears.find((ay) => ay.isActive)?.label;
    if (activeAy && parseInt(activeAy.slice(0, 4), 10) <= new Date().getFullYear()) {
      return activeAy;
    }

    return calculated;
  }, [masters]);

  // Auto-init college, academicYear, course from masters
  useEffect(() => {
    if (!masters) return;

    if (!collegeId && masters.colleges.length > 0) {
      const defaultCollege = masters.defaults.collegeId ?? masters.colleges[0].id;
      setCollegeId(defaultCollege);
    }

    if (currentAcademicYear && academicYear !== currentAcademicYear) {
      setAcademicYear(currentAcademicYear);
    }
  }, [masters, collegeId, currentAcademicYear, academicYear]);

  // Filter courses for selected college
  const coursesForCollege = useMemo(() => {
    if (!masters || !collegeId) return [];
    return masters.courses.filter((c) => c.collegeId === collegeId);
  }, [masters, collegeId]);

  // Auto-select first course when college changes
  useEffect(() => {
    if (coursesForCollege.length > 0) {
      if (!courseId || !coursesForCollege.some((c) => c.id === courseId)) {
        setCourseId(coursesForCollege[0].id);
      }
    } else {
      setCourseId(null);
    }
  }, [coursesForCollege, courseId]);

  // Selected course object
  const selectedCourse = useMemo(() => {
    return coursesForCollege.find((c) => c.id === courseId) ?? null;
  }, [coursesForCollege, courseId]);

  // Year options for course
  const yearOptions = useMemo(() => {
    if (selectedCourse?.yearOptions && selectedCourse.yearOptions.length > 0) {
      return selectedCourse.yearOptions;
    }
    const total = selectedCourse?.totalYears ?? 4;
    return Array.from({ length: total }, (_, i) => i + 1);
  }, [selectedCourse]);

  // Semesters for course
  const semesterOptions = useMemo(() => {
    if (selectedCourse?.yearSemesterConfig && selectedCourse.yearSemesterConfig.length > 0) {
      const config = selectedCourse.yearSemesterConfig.find((c) => c.year === year);
      const count = config?.semesters ?? selectedCourse.semestersPerYear ?? 2;
      return Array.from({ length: count }, (_, i) => i + 1);
    }
    const count = selectedCourse?.semestersPerYear ?? 2;
    return Array.from({ length: count }, (_, i) => i + 1);
  }, [selectedCourse, year]);

  // All branches for course
  const branchesForCourse = useMemo(() => {
    if (!masters || !courseId) return [];
    return masters.branches.filter((b) => b.courseId === courseId);
  }, [masters, courseId]);

  // Default select first 2 branches or all branches if few
  useEffect(() => {
    if (branchesForCourse.length > 0) {
      const valid = selectedBranchIds.filter((id) => branchesForCourse.some((b) => b.id === id));
      if (valid.length === 0) {
        // Select first 2 or all if <= 3
        const initial = branchesForCourse.slice(0, Math.min(3, branchesForCourse.length)).map((b) => b.id);
        setSelectedBranchIds(initial);
      } else {
        setSelectedBranchIds(valid);
      }
    } else {
      setSelectedBranchIds([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchesForCourse]);

  // Load faculty list once
  useEffect(() => {
    async function fetchFaculty() {
      try {
        const res = await apiFetch("/timetables/faculty", { cache: "no-store" });
        if (res.ok) {
          const json = await res.json();
          setFacultyList(json.data ?? []);
        }
      } catch (err) {
        console.warn("Could not load faculty list:", err);
      }
    }
    fetchFaculty();
  }, []);

  // Fetch branches overview & timing template
  const fetchOverview = useCallback(async () => {
    if (!collegeId || !courseId || !academicYear || semester == null) {
      return;
    }

    setLoadingOverview(true);
    setSaveStatus(null);
    try {
      const params = new URLSearchParams({
        collegeId: String(collegeId),
        courseId: String(courseId),
        academicYear,
        year: String(year),
        semester: String(semester),
      });
      if (section && section !== "all") {
        params.set("section", section);
      }

      const res = await apiFetch(`/timetables/combined/overview?${params.toString()}`, {
        cache: "no-store",
      });
      if (res.ok) {
        const json = await res.json();
        setBranchesOverview(json.branches ?? []);
        if (json.timing) {
          setTimingTemplateName(json.timing.name ?? "Timing Template");
          setTimingSlots(json.timing.slots ?? []);
        } else {
          setTimingTemplateName("");
          setTimingSlots([]);
        }
      }
    } catch (err) {
      console.error("Failed to load combined branches overview:", err);
    } finally {
      setLoadingOverview(false);
    }
  }, [collegeId, courseId, academicYear, year, semester, section]);

  // Trigger overview reload when filters change
  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  // Fetch combined subjects whenever selectedBranchIds or context changes
  useEffect(() => {
    async function fetchSubjects() {
      if (!collegeId || !courseId || !academicYear || semester == null || selectedBranchIds.length === 0) {
        setSubjects([]);
        return;
      }

      setLoadingSubjects(true);
      try {
        const params = new URLSearchParams({
          collegeId: String(collegeId),
          courseId: String(courseId),
          academicYear,
          year: String(year),
          semester: String(semester),
          branchIds: selectedBranchIds.join(","),
        });

        const res = await apiFetch(`/timetables/combined/subjects?${params.toString()}`, {
          cache: "no-store",
        });
        if (res.ok) {
          const json = await res.json();
          setSubjects(json.data ?? []);
        }
      } catch (err) {
        console.error("Failed to load combined subjects:", err);
      } finally {
        setLoadingSubjects(false);
      }
    }

    fetchSubjects();
  }, [collegeId, courseId, academicYear, year, semester, selectedBranchIds]);

  // Toggle single branch in checklist
  const handleToggleBranch = (branchId: number) => {
    setSelectedBranchIds((prev) => {
      if (prev.includes(branchId)) {
        if (prev.length <= 1) return prev; // keep at least 1
        return prev.filter((id) => id !== branchId);
      }
      return [...prev, branchId];
    });
  };

  // Select all / clear branches
  const handleSelectAllBranches = () => {
    setSelectedBranchIds(branchesForCourse.map((b) => b.id));
  };

  const handleSelectFirstTwoBranches = () => {
    setSelectedBranchIds(branchesForCourse.slice(0, 2).map((b) => b.id));
  };

  // Load schedule from an existing branch plan into the editor
  const handleLoadScheduleFromBranch = (branchOverview: BranchOverview) => {
    if (!branchOverview.plan || branchOverview.plan.entries.length === 0) return;

    const newAssignments: Record<string, LocalPeriodAssignment> = {};
    for (const entry of branchOverview.plan.entries) {
      const dayCode = (DAY_LABEL_TO_CODE[entry.dayOfWeek] ?? entry.dayOfWeek) as string;
      const key = `${dayCode}:${entry.timingSlotId}`;
      newAssignments[key] = {
        dayOfWeek: dayCode,
        timingSlotId: entry.timingSlotId,
        subjectId: entry.subjectId,
        subjectCode: entry.subjectCode ?? "",
        subjectName: entry.subjectName ?? "",
        entryType: (entry.entryType as "theory" | "lab" | "other") || "theory",
        hrmsEmployeeId: entry.facultyHrmsId ?? "",
        facultyName: entry.facultyName ?? "",
        roomLabel: entry.roomLabel ?? "",
        batchLabel: entry.batchLabel ?? "",
        customLabel: entry.customLabel ?? "",
      };
    }

    setAssignments(newAssignments);
    setSaveStatus({
      type: "success",
      message: `Loaded ${branchOverview.plan.entries.length} period slots from ${branchOverview.branchName} into the combined timetable editor. You can now tweak or publish it to all checked branches!`,
    });
  };

  // Group timing slots by day of week
  const daysOfWeek = useMemo(() => {
    return [
      { code: "MON", label: "Monday" },
      { code: "TUE", label: "Tuesday" },
      { code: "WED", label: "Wednesday" },
      { code: "THUR", label: "Thursday" },
      { code: "FRI", label: "Friday" },
      { code: "SAT", label: "Saturday" },
    ];
  }, []);

  // Distinct period columns (by order / label)
  const periodColumns = useMemo(() => {
    const mondaySlots = timingSlots.filter(
      (s) => s.dayOfWeek === "MON" || s.dayLabel === "Monday",
    );
    if (mondaySlots.length > 0) return mondaySlots;

    // Fallback: unique by label/time
    const seen = new Set<string>();
    const cols: TimingSlot[] = [];
    for (const slot of timingSlots) {
      const key = `${slot.label}-${slot.startTime}`;
      if (!seen.has(key)) {
        seen.add(key);
        cols.push(slot);
      }
    }
    return cols;
  }, [timingSlots]);

  // Find slot for day and template period
  const getSlotForDay = useCallback(
    (dayCode: string, colSlot: TimingSlot): TimingSlot | null => {
      return (
        timingSlots.find(
          (s) =>
            (s.dayOfWeek === dayCode || s.dayLabel === DAY_CODE_TO_LABEL[dayCode as keyof typeof DAY_CODE_TO_LABEL]) &&
            s.label === colSlot.label &&
            s.startTime === colSlot.startTime,
        ) ?? null
      );
    },
    [timingSlots],
  );

  // Assign or remove slot in editor
  const handleSaveSlotAssignment = (assignment: LocalPeriodAssignment) => {
    const key = `${assignment.dayOfWeek}:${assignment.timingSlotId}`;
    setAssignments((prev) => ({
      ...prev,
      [key]: assignment,
    }));
    setActiveSlotModal(null);
  };

  const handleClearSlotAssignment = (dayOfWeek: string, timingSlotId: number) => {
    const key = `${dayOfWeek}:${timingSlotId}`;
    setAssignments((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setActiveSlotModal(null);
  };

  const handleClearAllAssignments = () => {
    if (Object.keys(assignments).length === 0) return;
    if (window.confirm("Are you sure you want to clear all assigned periods in this combined draft?")) {
      setAssignments({});
    }
  };

  // Total assigned class periods
  const totalAssignedCount = useMemo(() => {
    return Object.keys(assignments).length;
  }, [assignments]);

  // Fast slot lookup map for durations
  const timingSlotMap = useMemo(() => {
    const map = new Map<number, TimingSlot>();
    for (const slot of timingSlots) {
      map.set(slot.id, slot);
    }
    return map;
  }, [timingSlots]);

  // Aggregated Subjects Total Slots Summary
  const subjectSlotsSummary = useMemo(() => {
    const map = new Map<
      string,
      {
        code: string;
        name: string;
        type: string;
        slotsCount: number;
        totalMinutes: number;
        facultySet: Set<string>;
      }
    >();

    for (const a of Object.values(assignments)) {
      const key = a.subjectId
        ? `sub-${a.subjectId}`
        : `custom-${a.subjectCode || a.customLabel || "unlabeled"}`;
      const slot = timingSlotMap.get(a.timingSlotId);
      const minutes = calculateSlotDurationMinutes(slot);

      const code = a.subjectCode || a.customLabel || "—";
      const name = a.subjectName || a.customLabel || "Period";
      const type = a.entryType;

      const existing = map.get(key);
      if (!existing) {
        const facultySet = new Set<string>();
        if (a.facultyName) facultySet.add(a.facultyName);
        map.set(key, {
          code,
          name,
          type,
          slotsCount: 1,
          totalMinutes: minutes,
          facultySet,
        });
      } else {
        existing.slotsCount += 1;
        existing.totalMinutes += minutes;
        if (a.facultyName) existing.facultySet.add(a.facultyName);
      }
    }

    return Array.from(map.values())
      .map((item) => ({
        ...item,
        totalHours: formatMinutesToHours(item.totalMinutes),
        facultyNames: Array.from(item.facultySet),
      }))
      .sort((a, b) => b.slotsCount - a.slotsCount);
  }, [assignments, timingSlotMap]);

  // Aggregated Faculty Total Working Hours Summary
  const facultyWorkloadSummary = useMemo(() => {
    const map = new Map<
      string,
      {
        hrmsId: string;
        name: string;
        department: string;
        designation: string;
        slotsCount: number;
        totalMinutes: number;
        subjectsSet: Set<string>;
        daysSet: Set<string>;
      }
    >();

    let unassignedSlots = 0;

    for (const a of Object.values(assignments)) {
      const slot = timingSlotMap.get(a.timingSlotId);
      const minutes = calculateSlotDurationMinutes(slot);

      if (!a.hrmsEmployeeId && !a.facultyName) {
        unassignedSlots += 1;
        continue;
      }

      const key = a.hrmsEmployeeId || a.facultyName;
      const existing = map.get(key);
      const facultyOpt = facultyList.find((f) => f.hrmsEmployeeId === a.hrmsEmployeeId);

      if (!existing) {
        const subjectsSet = new Set<string>();
        if (a.subjectCode || a.customLabel) subjectsSet.add(a.subjectCode || a.customLabel);
        const daysSet = new Set<string>();
        if (a.dayOfWeek) {
          const dayName = DAY_CODE_TO_LABEL[a.dayOfWeek as keyof typeof DAY_CODE_TO_LABEL] || a.dayOfWeek;
          daysSet.add(dayName.slice(0, 3));
        }

        map.set(key, {
          hrmsId: a.hrmsEmployeeId || "—",
          name: a.facultyName || facultyOpt?.name || "Faculty",
          department: facultyOpt?.department || facultyOpt?.division || "—",
          designation: facultyOpt?.designation || "Faculty",
          slotsCount: 1,
          totalMinutes: minutes,
          subjectsSet,
          daysSet,
        });
      } else {
        existing.slotsCount += 1;
        existing.totalMinutes += minutes;
        if (a.subjectCode || a.customLabel) existing.subjectsSet.add(a.subjectCode || a.customLabel);
        if (a.dayOfWeek) {
          const dayName = DAY_CODE_TO_LABEL[a.dayOfWeek as keyof typeof DAY_CODE_TO_LABEL] || a.dayOfWeek;
          existing.daysSet.add(dayName.slice(0, 3));
        }
      }
    }

    const list = Array.from(map.values())
      .map((item) => ({
        ...item,
        totalHours: formatMinutesToHours(item.totalMinutes),
        subjectCodes: Array.from(item.subjectsSet),
        days: Array.from(item.daysSet),
      }))
      .sort((a, b) => b.totalMinutes - a.totalMinutes);

    const totalMinutes = list.reduce((sum, f) => sum + f.totalMinutes, 0);

    return {
      list,
      unassignedSlots,
      totalFacultyMinutes: totalMinutes,
      totalFacultyHours: formatMinutesToHours(totalMinutes),
    };
  }, [assignments, timingSlotMap, facultyList]);

  // Open Publish Review & Workload Confirmation Modal
  const handleOpenPublishModal = () => {
    if (!collegeId || !courseId || !academicYear || semester == null) {
      setSaveStatus({
        type: "error",
        message: "Please ensure College, Course, Year of Study, and Semester are all selected.",
      });
      return;
    }

    if (selectedBranchIds.length === 0) {
      setSaveStatus({
        type: "error",
        message: "Please select at least one branch in the checklist to apply the timetable to.",
      });
      return;
    }

    if (totalAssignedCount === 0) {
      setSaveStatus({
        type: "error",
        message: "No periods have been assigned yet. Please assign at least one period slot before publishing.",
      });
      return;
    }

    setIsPublishModalOpen(true);
  };

  // Execute Save or Publish
  const handleExecuteSave = async (publish: boolean) => {
    if (!collegeId || !courseId || !academicYear || semester == null) {
      setSaveStatus({
        type: "error",
        message: "Please ensure College, Course, Year of Study, and Semester are all selected.",
      });
      return;
    }

    if (selectedBranchIds.length === 0) {
      setSaveStatus({
        type: "error",
        message: "Please select at least one branch in the checklist to apply the timetable to.",
      });
      return;
    }

    const assignmentList = Object.values(assignments).map((a) => ({
      dayOfWeek: a.dayOfWeek,
      timingSlotId: a.timingSlotId,
      subjectId: a.subjectId,
      subjectCode: a.subjectCode,
      subjectName: a.subjectName,
      entryType: a.entryType,
      hrmsEmployeeId: a.hrmsEmployeeId || null,
      roomLabel: a.roomLabel || null,
      batchLabel: a.batchLabel || "",
      customLabel: a.customLabel || null,
    }));

    if (assignmentList.length === 0) {
      setSaveStatus({
        type: "error",
        message: "No periods have been assigned yet. Please assign at least one period slot before saving.",
      });
      return;
    }

    setIsSaving(true);
    setSaveStatus(null);

    try {
      const res = await apiFetch("/timetables/combined/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collegeId,
          courseId,
          branchIds: selectedBranchIds,
          academicYear,
          year,
          semester,
          section: section && section !== "all" ? section : null,
          notes: `Combined timetable across ${selectedBranchIds.length} branches (${selectedBranches.map((b) => b.code || b.name).join(", ")})`,
          assignments: assignmentList,
          publish,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Failed to save combined timetable.");
      }

      setSaveStatus({
        type: "success",
        message: data.message || `Successfully ${publish ? "published" : "saved"} combined timetable for ${selectedBranchIds.length} branches!`,
        details: data.results,
        workloadSummary: {
          totalSlots: totalAssignedCount,
          totalHours: facultyWorkloadSummary.totalFacultyHours,
          facultyCount: facultyWorkloadSummary.list.length,
          subjectsCount: subjectSlotsSummary.length,
        },
      });

      if (publish) {
        setIsPublishModalOpen(false);
      }

      // Refresh overview
      fetchOverview();
    } catch (err) {
      setSaveStatus({
        type: "error",
        message: err instanceof Error ? err.message : "Error saving combined timetable",
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Selected branch names helper
  const selectedBranches = useMemo(() => {
    return branchesForCourse.filter((b) => selectedBranchIds.includes(b.id));
  }, [branchesForCourse, selectedBranchIds]);

  return (
    <div className="space-y-6 pb-20">
      {/* STEP 1: Academic & College Scope Filter Bar */}
      <Card className="border-border/80 bg-white p-5 shadow-xs">
        <div className="flex items-center justify-between gap-2 mb-3.5">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
            <Building2 className="h-4 w-4 text-indigo-600" />
            <span>Step 1: Academic Scope & College Selection</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchOverview}
            disabled={loadingOverview}
            className="h-7 text-xs gap-1.5 text-slate-600 hover:text-indigo-600"
          >
            <RefreshCw className={cn("h-3 w-3", loadingOverview && "animate-spin")} />
            Refresh
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
          {/* College */}
          <div>
            <label className="text-[11px] font-bold text-slate-600 uppercase mb-1 block">
              College
            </label>
            <select
              value={collegeId ?? ""}
              onChange={(e) => setCollegeId(Number(e.target.value))}
              disabled={mastersLoading || !masters}
              className="w-full h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-navy-950 focus:border-indigo-600 focus:outline-none"
            >
              {masters?.colleges.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Course */}
          <div>
            <label className="text-[11px] font-bold text-slate-600 uppercase mb-1 block">
              Course
            </label>
            <select
              value={courseId ?? ""}
              onChange={(e) => setCourseId(Number(e.target.value))}
              disabled={mastersLoading || coursesForCollege.length === 0}
              className="w-full h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-navy-950 focus:border-indigo-600 focus:outline-none"
            >
              {coursesForCollege.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Current Academic Year (Read-only Default Display) */}
          <div>
            <label className="text-[11px] font-bold text-slate-600 uppercase mb-1 block">
              Current Academic Year
            </label>
            <div className="flex h-9 w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50/90 px-3 text-xs font-semibold text-navy-950">
              <span className="flex items-center gap-1.5 font-bold">
                <Calendar className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
                {currentAcademicYear || academicYear || "Loading…"}
              </span>
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                Active
              </span>
            </div>
          </div>

          {/* Year of Study */}
          <div>
            <label className="text-[11px] font-bold text-slate-600 uppercase mb-1 block">
              Year of Study
            </label>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="w-full h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-navy-950 focus:border-indigo-600 focus:outline-none"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  Year {y}
                </option>
              ))}
            </select>
          </div>

          {/* Semester */}
          <div>
            <label className="text-[11px] font-bold text-slate-600 uppercase mb-1 block">
              Semester
            </label>
            <select
              value={semester}
              onChange={(e) => setSemester(Number(e.target.value))}
              className="w-full h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-navy-950 focus:border-indigo-600 focus:outline-none"
            >
              {semesterOptions.map((s) => (
                <option key={s} value={s}>
                  Semester {s}
                </option>
              ))}
            </select>
          </div>
        </div>

        {timingTemplateName ? (
          <div className="mt-3.5 flex items-center justify-between rounded-lg border border-slate-200/80 bg-slate-50/70 px-3 py-2 text-xs text-slate-600">
            <div className="flex items-center gap-2">
              <Clock className="h-3.5 w-3.5 text-indigo-600" />
              <span>
                Active Timing: <strong className="text-navy-900">{timingTemplateName}</strong> ({timingSlots.length} slot definitions)
              </span>
            </div>
            <span className="text-[11px] text-slate-500 font-medium">
              Applicable to all branches in this semester
            </span>
          </div>
        ) : (
          <div className="mt-3.5 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
            <span>No active timing template found for this college and semester. Please configure one in Timing Templates.</span>
          </div>
        )}
      </Card>

      {/* STEP 2: Branch Combination Checklist Card */}
      <Card className="border-border/80 bg-white p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-white text-[11px] font-bold">
              2
            </span>
            <h3 className="text-sm sm:text-base font-bold text-navy-900">
              Branch Combinations Checklist
            </h3>
            <span className="hidden sm:inline text-xs text-slate-300">•</span>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-900 border border-indigo-100">
              <Layers3 className="h-3 w-3 text-indigo-600" />
              <span>
                {selectedBranchIds.length} of {branchesForCourse.length} Selected:
              </span>
              <span className="font-bold text-indigo-700">
                {selectedBranches.map((b) => b.code || b.name).join(" + ") || "None"}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleSelectAllBranches}
              disabled={branchesForCourse.length === 0}
              className="text-xs h-7.5 gap-1.5"
            >
              <CheckSquare className="h-3.5 w-3.5 text-indigo-600" />
              Select All
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleSelectFirstTwoBranches}
              disabled={branchesForCourse.length < 2}
              className="text-xs h-7.5"
            >
              First 2
            </Button>
          </div>
        </div>

        {/* All Branches Inline List */}
        <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
          {branchesForCourse.length === 0 ? (
            <div className="text-xs text-slate-500 py-1 italic">
              No branches found for the selected course.
            </div>
          ) : (
            branchesForCourse.map((branch) => {
              const isChecked = selectedBranchIds.includes(branch.id);
              const overview = branchesOverview.find((b) => b.branchId === branch.id);
              const plan = overview?.plan;

              return (
                <div
                  key={branch.id}
                  onClick={() => handleToggleBranch(branch.id)}
                  className={cn(
                    "group relative inline-flex items-center gap-2.5 px-3 py-2 rounded-xl border text-xs transition-all cursor-pointer select-none",
                    isChecked
                      ? "border-indigo-600 bg-indigo-50/70 shadow-xs ring-1 ring-indigo-600/30 text-navy-950 font-semibold"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 text-slate-700",
                  )}
                >
                  {/* Checkbox */}
                  <div className="shrink-0 text-indigo-600">
                    {isChecked ? (
                      <CheckSquare className="h-4 w-4 text-indigo-600" />
                    ) : (
                      <Square className="h-4 w-4 text-slate-300 group-hover:text-slate-400" />
                    )}
                  </div>

                  {/* Branch Code & Name */}
                  <div className="flex items-center gap-1.5">
                    {branch.code && (
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase",
                          isChecked
                            ? "bg-indigo-600 text-white"
                            : "bg-slate-100 text-slate-700",
                        )}
                      >
                        {branch.code}
                      </span>
                    )}
                    <span className="font-bold leading-tight">
                      {branch.name}
                    </span>
                  </div>

                  {/* Status Indicator */}
                  <div className="flex items-center gap-1.5 pl-2 border-l border-slate-200">
                    {plan ? (
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                          plan.status === "published"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-amber-100 text-amber-800",
                        )}
                      >
                        <span
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            plan.status === "published" ? "bg-emerald-600" : "bg-amber-600",
                          )}
                        />
                        {plan.assignedCount} periods
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-400 font-medium">
                        No timetable
                      </span>
                    )}

                    {/* Load Schedule button */}
                    {plan && plan.assignedCount > 0 && (
                      <button
                        type="button"
                        title={`Load existing ${branch.code || branch.name} schedule (${plan.assignedCount} periods) into editor`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (overview) handleLoadScheduleFromBranch(overview);
                        }}
                        className="inline-flex items-center gap-1 rounded bg-white px-1.5 py-0.5 text-[10px] font-bold text-indigo-700 border border-indigo-200 shadow-2xs hover:bg-indigo-50 hover:border-indigo-300 cursor-pointer ml-0.5"
                      >
                        <Copy className="h-2.5 w-2.5" />
                        Load
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Card>

      {/* Save / Error Feedback Banner */}
      {saveStatus && (
        <div
          className={cn(
            "flex items-start gap-3 rounded-xl border p-4 text-xs font-medium animate-in fade-in",
            saveStatus.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-red-200 bg-red-50 text-red-900",
          )}
        >
          {saveStatus.type === "success" ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
          )}
          <div className="flex-1 space-y-1.5">
            <div className="font-bold text-sm leading-tight">{saveStatus.message}</div>
            {saveStatus.workloadSummary && (
              <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] font-semibold text-emerald-800">
                <span className="rounded bg-emerald-100 px-2 py-0.5 border border-emerald-200">
                  {saveStatus.workloadSummary.totalSlots} Slots Assigned
                </span>
                <span className="rounded bg-emerald-100 px-2 py-0.5 border border-emerald-200">
                  {saveStatus.workloadSummary.totalHours} Faculty Teaching Workload
                </span>
                <span className="rounded bg-emerald-100 px-2 py-0.5 border border-emerald-200">
                  {saveStatus.workloadSummary.subjectsCount} Subjects Covered
                </span>
                <span className="rounded bg-emerald-100 px-2 py-0.5 border border-emerald-200">
                  {saveStatus.workloadSummary.facultyCount} Faculty Deployed
                </span>
              </div>
            )}
            {saveStatus.details && saveStatus.details.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2 pt-1">
                {saveStatus.details.map((d) => {
                  const bName = branchesForCourse.find((b) => b.id === d.branchId)?.name ?? `Branch ${d.branchId}`;
                  return (
                    <span
                      key={d.branchId}
                      className="rounded-md border border-emerald-300 bg-emerald-100/80 px-2 py-0.5 text-[11px] font-semibold text-emerald-950"
                    >
                      ✓ {bName}: Plan #{d.planId} ({d.status} v{d.versionNo})
                    </span>
                  );
                })}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setSaveStatus(null)}
            className="text-slate-400 hover:text-slate-600 font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* STEP 3: Unified Combined Timetable Editor Grid */}
      <Card className="border-border/80 bg-white p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-white text-[11px] font-bold">
                3
              </span>
              <h3 className="text-sm sm:text-base font-bold text-navy-900">
                Combined Schedule Matrix (Weekly Planner Grid)
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Click any period slot below to assign or customize the common subject, faculty, and room.
            </p>
          </div>

          {/* Quick Actions & Save Buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-slate-600 px-2 py-1 bg-slate-100 rounded-md">
              {totalAssignedCount} periods assigned
            </span>

            {totalAssignedCount > 0 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleClearAllAssignments}
                className="text-xs text-red-600 hover:text-red-700 h-8 gap-1"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear
              </Button>
            )}

            {totalAssignedCount > 0 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setIsPublishModalOpen(true)}
                className="text-xs h-8 gap-1.5"
                title="View faculty working hours and subject slots breakdown"
              >
                <Clock className="h-3.5 w-3.5 text-indigo-600" />
                Workload & Slots
              </Button>
            )}

            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleExecuteSave(false)}
              disabled={isSaving || totalAssignedCount === 0}
              className="text-xs font-semibold h-8"
            >
              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              Save Draft for {selectedBranchIds.length} Branches
            </Button>

            <Button
              variant="primary"
              size="sm"
              onClick={handleOpenPublishModal}
              disabled={isSaving || totalAssignedCount === 0}
              className="text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white h-8 gap-1.5 shadow-xs"
            >
              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Publish to All {selectedBranchIds.length} Branches
            </Button>
          </div>
        </div>

        {/* Interactive Timetable Grid Table */}
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 shadow-2xs">
          <table className="w-full min-w-[850px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-100/80 text-navy-950">
                <th className="py-2.5 px-3 font-bold uppercase tracking-wider text-[11px] w-28 border-r border-slate-200">
                  Day / Period
                </th>
                {periodColumns.map((col, idx) => {
                  const isBreak = isNonClassTimingSlot(col);
                  return (
                    <th
                      key={col.id || idx}
                      className={cn(
                        "py-2.5 px-3 font-bold border-r border-slate-200 text-center last:border-r-0",
                        isBreak ? "bg-slate-200/50 text-slate-500" : "bg-slate-100/90 text-navy-900",
                      )}
                    >
                      <div className="text-xs font-bold leading-tight">{col.label}</div>
                      <div className="text-[10px] font-normal text-slate-500 mt-0.5">
                        {col.startTime?.slice(0, 5)} - {col.endTime?.slice(0, 5)}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {daysOfWeek.map(({ code: dayCode, label: dayLabel }) => (
                <tr key={dayCode} className="hover:bg-slate-50/50 transition-colors">
                  {/* Day Label */}
                  <td className="py-2.5 px-3 font-bold text-navy-900 bg-slate-50/70 border-r border-slate-200">
                    <div>{dayLabel}</div>
                    <div className="text-[10px] font-semibold text-slate-400">{dayCode}</div>
                  </td>

                  {/* Period Slot Cells */}
                  {periodColumns.map((col, idx) => {
                    const slot = getSlotForDay(dayCode, col);
                    const isBreak = !slot || isNonClassTimingSlot(slot);

                    if (isBreak) {
                      return (
                        <td
                          key={col.id || idx}
                          className="py-2 px-1 text-center bg-slate-100/40 border-r border-slate-200 text-slate-400 text-[10px] select-none font-medium"
                        >
                          {timingSlotDisplayLabel(col)}
                        </td>
                      );
                    }

                    const key = `${dayCode}:${slot.id}`;
                    const assignment = assignments[key];

                    return (
                      <td
                        key={slot.id}
                        className="p-1 border-r border-slate-200 last:border-r-0 align-top h-20 min-w-[130px]"
                      >
                        {assignment ? (
                          <div
                            onClick={() =>
                              setActiveSlotModal({
                                day: dayCode,
                                slot,
                                current: assignment,
                              })
                            }
                            className={cn(
                              "h-full rounded-lg p-2 border transition-all cursor-pointer flex flex-col justify-between group",
                              assignment.entryType === "lab"
                                ? "border-amber-200 bg-amber-50/70 hover:bg-amber-100/60"
                                : assignment.entryType === "other"
                                  ? "border-purple-200 bg-purple-50/70 hover:bg-purple-100/60"
                                  : "border-indigo-200 bg-indigo-50/70 hover:bg-indigo-100/60",
                            )}
                          >
                            <div>
                              <div className="flex items-center justify-between gap-1 mb-1">
                                <span className="font-bold text-[11px] text-navy-950 truncate max-w-[90px]">
                                  {assignment.customLabel || assignment.subjectCode}
                                </span>
                                <span
                                  className={cn(
                                    "rounded px-1 text-[9px] font-bold uppercase",
                                    assignment.entryType === "lab"
                                      ? "bg-amber-200 text-amber-900"
                                      : assignment.entryType === "other"
                                        ? "bg-purple-200 text-purple-900"
                                        : "bg-indigo-200 text-indigo-900",
                                  )}
                                >
                                  {assignment.entryType}
                                </span>
                              </div>

                              <p className="text-[10px] text-slate-700 font-medium line-clamp-1">
                                {assignment.subjectName || assignment.customLabel}
                              </p>
                            </div>

                            <div className="mt-1 pt-1 border-t border-slate-200/50 flex items-center justify-between text-[10px] text-slate-500">
                              <span className="truncate max-w-[70px]" title={assignment.facultyName}>
                                {assignment.facultyName || "No faculty"}
                              </span>
                              {assignment.roomLabel && (
                                <span className="font-semibold text-slate-700 truncate max-w-[40px]">
                                  {assignment.roomLabel}
                                </span>
                              )}
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              setActiveSlotModal({
                                day: dayCode,
                                slot,
                              })
                            }
                            className="w-full h-full min-h-[70px] rounded-lg border border-dashed border-slate-200 bg-white/60 hover:bg-indigo-50/50 hover:border-indigo-300 text-slate-400 hover:text-indigo-600 flex flex-col items-center justify-center transition-all cursor-pointer group"
                          >
                            <Plus className="h-4 w-4 text-slate-300 group-hover:text-indigo-600 transition-colors" />
                            <span className="text-[10px] font-medium mt-0.5">Assign</span>
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Period Assignment Modal */}
      {activeSlotModal && (
        <PeriodEditModal
          isOpen={Boolean(activeSlotModal)}
          onClose={() => setActiveSlotModal(null)}
          dayCode={activeSlotModal.day}
          slot={activeSlotModal.slot}
          existing={activeSlotModal.current}
          subjects={subjects}
          facultyList={facultyList}
          selectedBranchCount={selectedBranchIds.length}
          onSave={handleSaveSlotAssignment}
          onClear={() => handleClearSlotAssignment(activeSlotModal.day, activeSlotModal.slot.id)}
        />
      )}

      {/* Publish & Workload Review Modal */}
      {isPublishModalOpen && (
        <PublishReviewModal
          isOpen={isPublishModalOpen}
          onClose={() => setIsPublishModalOpen(false)}
          onConfirmPublish={() => handleExecuteSave(true)}
          isSaving={isSaving}
          totalAssignedCount={totalAssignedCount}
          selectedBranches={selectedBranches}
          collegeName={masters?.colleges.find((c) => c.id === collegeId)?.name || "College"}
          courseName={selectedCourse?.name || "Course"}
          year={year}
          semester={semester}
          academicYear={currentAcademicYear || academicYear}
          reviewTab={reviewTab}
          onTabChange={setReviewTab}
          subjectSlotsSummary={subjectSlotsSummary}
          facultyWorkloadSummary={facultyWorkloadSummary}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------------
// Period Assignment Modal Sub-Component
// ----------------------------------------------------------------------

type PeriodEditModalProps = {
  isOpen: boolean;
  onClose: () => void;
  dayCode: string;
  slot: TimingSlot;
  existing?: LocalPeriodAssignment;
  subjects: CombinedSubject[];
  facultyList: FacultyOption[];
  selectedBranchCount: number;
  onSave: (assignment: LocalPeriodAssignment) => void;
  onClear: () => void;
};

function PeriodEditModal({
  isOpen,
  onClose,
  dayCode,
  slot,
  existing,
  subjects,
  facultyList,
  selectedBranchCount,
  onSave,
  onClear,
}: PeriodEditModalProps) {
  const [mode, setMode] = useState<"subject" | "special">(
    existing?.entryType === "other" && existing.customLabel ? "special" : "subject",
  );

  const [selectedSubjectId, setSelectedSubjectId] = useState<number | null>(existing?.subjectId ?? null);
  const [entryType, setEntryType] = useState<"theory" | "lab" | "other">(existing?.entryType ?? "theory");
  const [facultyHrmsId, setFacultyHrmsId] = useState<string>(existing?.hrmsEmployeeId ?? "");
  const [roomLabel, setRoomLabel] = useState<string>(existing?.roomLabel ?? "");
  const [customLabel, setCustomLabel] = useState<string>(existing?.customLabel ?? "");
  const [batchLabel, setBatchLabel] = useState<string>(existing?.batchLabel ?? "");
  const [facultySearch, setFacultySearch] = useState<string>("");

  useEffect(() => {
    if (existing) {
      setSelectedSubjectId(existing.subjectId);
      setEntryType(existing.entryType);
      setFacultyHrmsId(existing.hrmsEmployeeId);
      setRoomLabel(existing.roomLabel);
      setCustomLabel(existing.customLabel);
      setBatchLabel(existing.batchLabel);
      setMode(existing.entryType === "other" && existing.customLabel ? "special" : "subject");
    } else {
      // Default to first subject if available
      if (subjects.length > 0) {
        setSelectedSubjectId(subjects[0].id);
      }
    }
  }, [existing, subjects]);

  if (!isOpen) return null;

  const currentSubject = subjects.find((s) => s.id === selectedSubjectId);

  const filteredFaculty = facultyList.filter(
    (f) =>
      !facultySearch ||
      f.name.toLowerCase().includes(facultySearch.toLowerCase()) ||
      f.department.toLowerCase().includes(facultySearch.toLowerCase()) ||
      f.hrmsEmployeeId.toLowerCase().includes(facultySearch.toLowerCase()),
  );

  const handleApply = () => {
    if (mode === "subject") {
      if (!selectedSubjectId && !currentSubject) {
        alert("Please select a subject.");
        return;
      }
      const chosenFaculty = facultyList.find((f) => f.hrmsEmployeeId === facultyHrmsId);

      onSave({
        dayOfWeek: dayCode,
        timingSlotId: slot.id,
        subjectId: currentSubject?.id ?? null,
        subjectCode: currentSubject?.code ?? "",
        subjectName: currentSubject?.name ?? "",
        entryType,
        hrmsEmployeeId: facultyHrmsId,
        facultyName: chosenFaculty?.name ?? "",
        roomLabel,
        batchLabel,
        customLabel: "",
      });
    } else {
      if (!customLabel.trim()) {
        alert("Please enter or select a label for this special period.");
        return;
      }
      const chosenFaculty = facultyList.find((f) => f.hrmsEmployeeId === facultyHrmsId);

      onSave({
        dayOfWeek: dayCode,
        timingSlotId: slot.id,
        subjectId: null,
        subjectCode: customLabel,
        subjectName: customLabel,
        entryType: "other",
        hrmsEmployeeId: facultyHrmsId,
        facultyName: chosenFaculty?.name ?? "",
        roomLabel,
        batchLabel,
        customLabel,
      });
    }
  };

  const dayLabel = DAY_CODE_TO_LABEL[dayCode as keyof typeof DAY_CODE_TO_LABEL] ?? dayCode;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <button
        type="button"
        className="absolute inset-0 bg-navy-950/60 backdrop-blur-xs transition-opacity"
        aria-label="Close dialog"
        onClick={onClose}
      />

      {/* Modal Box */}
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="border-b border-border bg-gradient-to-r from-indigo-50/80 to-white px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-navy-950">
                Assign Period: {slot.label}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {dayLabel} • {slot.startTime?.slice(0, 5)} - {slot.endTime?.slice(0, 5)} • Applied to {selectedBranchCount} branches
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Mode Switcher */}
          <div className="mt-3 flex rounded-lg bg-slate-200/60 p-1 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setMode("subject")}
              className={cn(
                "flex-1 py-1.5 rounded-md transition-all",
                mode === "subject" ? "bg-white text-indigo-900 shadow-2xs font-bold" : "text-slate-600 hover:text-slate-900",
              )}
            >
              Curriculum Subject / Lab
            </button>
            <button
              type="button"
              onClick={() => setMode("special")}
              className={cn(
                "flex-1 py-1.5 rounded-md transition-all",
                mode === "special" ? "bg-white text-indigo-900 shadow-2xs font-bold" : "text-slate-600 hover:text-slate-900",
              )}
            >
              Special / Activity (CRT, Library)
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {mode === "subject" ? (
            <>
              {/* Subject Selection */}
              <div>
                <label className="text-xs font-bold text-slate-700 uppercase mb-1.5 block">
                  Select Subject
                </label>
                <select
                  value={selectedSubjectId ?? ""}
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    setSelectedSubjectId(id);
                    const sub = subjects.find((s) => s.id === id);
                    if (sub && sub.type?.toLowerCase().includes("lab")) {
                      setEntryType("lab");
                    } else {
                      setEntryType("theory");
                    }
                  }}
                  className="w-full h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-navy-950 focus:border-indigo-600 focus:outline-none"
                >
                  {subjects.map((sub) => (
                    <option key={sub.id} value={sub.id}>
                      {sub.code}: {sub.name} {sub.isCommon ? "★ (Common)" : ""}
                    </option>
                  ))}
                </select>

                {currentSubject && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                    <span className="font-semibold text-navy-900">{currentSubject.name}</span>
                    <span>•</span>
                    <span className="capitalize">{currentSubject.type || "Theory"}</span>
                    {currentSubject.isCommon && (
                      <span className="rounded bg-purple-100 px-1 py-0.2 text-[9px] font-bold text-purple-900">
                        Common across branches
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Entry Type */}
              <div>
                <label className="text-xs font-bold text-slate-700 uppercase mb-1.5 block">
                  Period Type
                </label>
                <div className="flex gap-2">
                  {(["theory", "lab", "other"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setEntryType(t)}
                      className={cn(
                        "flex-1 py-1.5 rounded-lg border text-xs font-semibold capitalize transition-all cursor-pointer",
                        entryType === t
                          ? "border-indigo-600 bg-indigo-50 text-indigo-950 ring-1 ring-indigo-600/20 font-bold"
                          : "border-slate-200 text-slate-600 hover:bg-slate-50",
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Special Label Presets */}
              <div>
                <label className="text-xs font-bold text-slate-700 uppercase mb-1.5 block">
                  Activity / Special Period Label
                </label>
                <input
                  type="text"
                  placeholder="e.g. CRT, Library, Games, Mentoring..."
                  value={customLabel}
                  onChange={(e) => setCustomLabel(e.target.value)}
                  className="w-full h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-navy-950 focus:border-indigo-600 focus:outline-none"
                />

                <div className="mt-2 flex flex-wrap gap-1.5">
                  {SPECIAL_PERIOD_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setCustomLabel(preset)}
                      className={cn(
                        "rounded-md border px-2 py-0.5 text-[10px] font-medium transition-colors cursor-pointer",
                        customLabel === preset
                          ? "border-purple-600 bg-purple-100 text-purple-950 font-bold"
                          : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100",
                      )}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Faculty Selector */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-700 uppercase">
                Assigned Faculty
              </label>
              <div className="relative w-40">
                <input
                  type="text"
                  placeholder="Search faculty..."
                  value={facultySearch}
                  onChange={(e) => setFacultySearch(e.target.value)}
                  className="w-full h-7 rounded border border-slate-200 bg-white pl-2 pr-5 text-[11px] focus:outline-none focus:border-indigo-600"
                />
                <Search className="h-3 w-3 text-slate-400 absolute right-1.5 top-2 pointer-events-none" />
              </div>
            </div>

            <select
              value={facultyHrmsId}
              onChange={(e) => setFacultyHrmsId(e.target.value)}
              className="w-full h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-navy-950 focus:border-indigo-600 focus:outline-none"
            >
              <option value="">-- No Faculty / Unassigned --</option>
              {filteredFaculty.map((f) => (
                <option key={f.hrmsEmployeeId} value={f.hrmsEmployeeId}>
                  {f.name} ({f.designation || f.department || f.hrmsEmployeeId})
                </option>
              ))}
            </select>
          </div>

          {/* Room / Location */}
          <div>
            <label className="text-xs font-bold text-slate-700 uppercase mb-1.5 block">
              Room / Lab / Location
            </label>
            <input
              type="text"
              placeholder="e.g. Room 301, ECE Lab, Seminar Hall"
              value={roomLabel}
              onChange={(e) => setRoomLabel(e.target.value)}
              className="w-full h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-navy-950 focus:border-indigo-600 focus:outline-none"
            />
            <div className="mt-1.5 flex flex-wrap gap-1">
              {ROOM_SUGGESTIONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRoomLabel(r)}
                  className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-border bg-slate-50 px-5 py-3.5 flex items-center justify-between">
          <div>
            {existing && (
              <Button
                variant="secondary"
                size="sm"
                onClick={onClear}
                className="text-xs text-red-600 hover:text-red-700 h-8 gap-1"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove Period
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onClose} className="text-xs h-8">
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleApply}
              className="text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white h-8"
            >
              Apply to Slot
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------
// Publish Confirmation & Workload Summary Modal Sub-Component
// ----------------------------------------------------------------------

type PublishReviewModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onConfirmPublish: () => void;
  isSaving: boolean;
  totalAssignedCount: number;
  selectedBranches: Array<{ id: number; name: string; code: string | null }>;
  collegeName: string;
  courseName: string;
  year: number;
  semester: number;
  academicYear: string;
  reviewTab: "faculty" | "subjects";
  onTabChange: (tab: "faculty" | "subjects") => void;
  subjectSlotsSummary: Array<{
    code: string;
    name: string;
    type: string;
    slotsCount: number;
    totalHours: string;
    facultyNames: string[];
  }>;
  facultyWorkloadSummary: {
    list: Array<{
      hrmsId: string;
      name: string;
      department: string;
      designation: string;
      slotsCount: number;
      totalHours: string;
      subjectCodes: string[];
      days: string[];
    }>;
    unassignedSlots: number;
    totalFacultyHours: string;
  };
};

function PublishReviewModal({
  isOpen,
  onClose,
  onConfirmPublish,
  isSaving,
  totalAssignedCount,
  selectedBranches,
  collegeName,
  courseName,
  year,
  semester,
  academicYear,
  reviewTab,
  onTabChange,
  subjectSlotsSummary,
  facultyWorkloadSummary,
}: PublishReviewModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-navy-950/60 backdrop-blur-xs transition-opacity"
        onClick={() => !isSaving && onClose()}
      />

      {/* Modal Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 flex w-full max-w-4xl max-h-[90vh] flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="border-b border-border bg-gradient-to-r from-indigo-50/90 via-purple-50/40 to-white px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-xs">
                  <Sparkles className="h-4 w-4" />
                </span>
                <h3 className="text-lg font-bold text-navy-950">
                  Publish Timetable Workload & Slots Review
                </h3>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Verify faculty total working hours and subject slot distribution before publishing to all {selectedBranches.length} branches.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Scope Tags */}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-md bg-white border border-indigo-200/80 px-2.5 py-0.5 font-semibold text-slate-700">
              College: <strong className="text-navy-900">{collegeName}</strong>
            </span>
            <span className="rounded-md bg-white border border-indigo-200/80 px-2.5 py-0.5 font-semibold text-slate-700">
              Course: <strong className="text-navy-900">{courseName}</strong> (Yr {year}, Sem {semester})
            </span>
            <span className="rounded-md bg-white border border-indigo-200/80 px-2.5 py-0.5 font-semibold text-slate-700">
              Academic Year: <strong className="text-navy-900">{academicYear}</strong>
            </span>
            <span className="rounded-md bg-indigo-100/90 border border-indigo-300 px-2.5 py-0.5 font-bold text-indigo-900">
              Target Branches ({selectedBranches.length}): {selectedBranches.map((b) => b.code || b.name).join(" + ")}
            </span>
          </div>
        </div>

        {/* 4 KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-5 bg-slate-50/60 border-b border-slate-100">
          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-2xs">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
              Total Assigned Slots
            </span>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-xl font-bold text-navy-950">{totalAssignedCount}</span>
              <span className="text-[11px] text-slate-500">periods/week</span>
            </div>
          </div>

          <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-3 shadow-2xs">
            <span className="text-[11px] font-bold text-indigo-800 uppercase tracking-wider block">
              Total Teaching Workload
            </span>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-xl font-bold text-indigo-950">{facultyWorkloadSummary.totalFacultyHours}</span>
              <span className="text-[11px] text-indigo-700">hours/week</span>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-2xs">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
              Configured Subjects
            </span>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-xl font-bold text-navy-950">{subjectSlotsSummary.length}</span>
              <span className="text-[11px] text-slate-500">subjects</span>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-2xs">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
              Faculty Deployed
            </span>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-xl font-bold text-navy-950">{facultyWorkloadSummary.list.length}</span>
              <span className="text-[11px] text-slate-500">teachers</span>
            </div>
          </div>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-5 overflow-y-auto space-y-4 max-h-[calc(90vh-270px)]">
          {/* Optional unassigned notice */}
          {facultyWorkloadSummary.unassignedSlots > 0 && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/90 px-3.5 py-2.5 text-xs text-amber-900">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
              <span>
                <strong>{facultyWorkloadSummary.unassignedSlots} slot(s)</strong> have no faculty member assigned. They will be published with open faculty allocation.
              </span>
            </div>
          )}

          {/* Section Switcher Tabs */}
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onTabChange("faculty")}
                className={cn(
                  "px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer",
                  reviewTab === "faculty"
                    ? "bg-indigo-600 text-white shadow-xs"
                    : "text-slate-600 hover:bg-slate-100",
                )}
              >
                <UserCheck className="h-3.5 w-3.5" />
                Faculty Total Working Hours ({facultyWorkloadSummary.list.length})
              </button>
              <button
                type="button"
                onClick={() => onTabChange("subjects")}
                className={cn(
                  "px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer",
                  reviewTab === "subjects"
                    ? "bg-indigo-600 text-white shadow-xs"
                    : "text-slate-600 hover:bg-slate-100",
                )}
              >
                <BookOpen className="h-3.5 w-3.5" />
                Subjects Total Slots ({subjectSlotsSummary.length})
              </button>
            </div>
          </div>

          {/* Tab 1: Faculty Total Working Hours */}
          {reviewTab === "faculty" && (
            <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-2xs">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-100/80 text-navy-950 font-bold uppercase text-[10.5px]">
                    <th className="py-2.5 px-3">Faculty Member</th>
                    <th className="py-2.5 px-3">Department</th>
                    <th className="py-2.5 px-3 text-center">Total Assigned Slots</th>
                    <th className="py-2.5 px-3 text-center">Total Working Hours</th>
                    <th className="py-2.5 px-3">Subjects Taught</th>
                    <th className="py-2.5 px-3">Active Days</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {facultyWorkloadSummary.list.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-xs text-slate-400 italic">
                        No faculty members assigned to period slots yet.
                      </td>
                    </tr>
                  ) : (
                    facultyWorkloadSummary.list.map((f, idx) => (
                      <tr key={f.hrmsId || idx} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-2.5 px-3">
                          <div className="font-bold text-navy-950">{f.name}</div>
                          {f.hrmsId && f.hrmsId !== "—" && (
                            <div className="text-[10px] text-slate-400 font-mono">ID: {f.hrmsId}</div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-slate-600 font-medium">
                          {f.department || "—"}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span className="inline-flex items-center justify-center rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-bold text-indigo-900 border border-indigo-100">
                            {f.slotsCount} slots
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-800 border border-emerald-200">
                            <Clock className="h-3 w-3 text-emerald-600" />
                            {f.totalHours}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex flex-wrap gap-1">
                            {f.subjectCodes.map((c, i) => (
                              <span key={i} className="rounded bg-slate-100 px-1.5 py-0.2 text-[10px] font-semibold text-slate-700">
                                {c}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-slate-500 text-[11px]">
                          {f.days.join(", ")}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Tab 2: Subjects Total Slots */}
          {reviewTab === "subjects" && (
            <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-2xs">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-100/80 text-navy-950 font-bold uppercase text-[10.5px]">
                    <th className="py-2.5 px-3">Subject Code</th>
                    <th className="py-2.5 px-3">Subject Name</th>
                    <th className="py-2.5 px-3">Type</th>
                    <th className="py-2.5 px-3 text-center">Total Slots Allocated</th>
                    <th className="py-2.5 px-3 text-center">Weekly Duration</th>
                    <th className="py-2.5 px-3">Assigned Faculty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {subjectSlotsSummary.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-xs text-slate-400 italic">
                        No subjects assigned in this timetable schedule yet.
                      </td>
                    </tr>
                  ) : (
                    subjectSlotsSummary.map((s, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-2.5 px-3 font-mono font-bold text-navy-950">
                          {s.code}
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-slate-800">
                          {s.name}
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={cn(
                              "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase",
                              s.type === "theory"
                                ? "bg-blue-100 text-blue-900"
                                : s.type === "lab"
                                ? "bg-purple-100 text-purple-900"
                                : "bg-slate-100 text-slate-700",
                            )}
                          >
                            {s.type}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span className="inline-flex items-center justify-center rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-bold text-indigo-900 border border-indigo-100">
                            {s.slotsCount} slots
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-800">
                            <Clock className="h-3 w-3 text-slate-500" />
                            {s.totalHours}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-700">
                          {s.facultyNames.length > 0 ? (
                            <span className="font-medium">{s.facultyNames.join(", ")}</span>
                          ) : (
                            <span className="text-slate-400 italic text-[11px]">Unassigned</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 bg-slate-50/80 px-6 py-3.5 flex items-center justify-between">
          <Button
            variant="secondary"
            size="sm"
            onClick={onClose}
            disabled={isSaving}
            className="text-xs"
          >
            Back to Planner
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={onConfirmPublish}
            disabled={isSaving || totalAssignedCount === 0}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs gap-1.5 h-8.5 px-4 shadow-xs"
          >
            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Confirm & Publish to All {selectedBranches.length} Branches
          </Button>
        </div>
      </div>
    </div>
  );
}
