"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAcademicContext } from "@/components/layout/AcademicProvider";
import { apiFetch } from "@/lib/api";
import { escapeHtml, printElement, printHtml } from "@/lib/print-service";
import { cn } from "@/lib/cn";
import {
  RotateCcw,
  Search,
  BookOpen,
  FileSpreadsheet,
  FileText,
  X,
  CalendarCheck,
  UserCheck,
  ArrowRight,
  ArrowLeftRight,
  UserX,
  User,
  Clock,
  Calendar,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  Percent,
  Info,
  Users,
  Eye,
} from "lucide-react";

type KpiModalType = "master" | "conducted" | "changed" | "substituted" | "swapped" | "rate" | null;

type ReportSummary = {
  totalMasterPeriods: number;
  totalMasterPeriodsScheduled?: number;
  totalScheduledSessions: number;
  totalConductedSessions: number;
  totalChangesRecorded: number;
  facultySubstitutionsCount: number;
  subjectSwapsCount: number;
  revertedCount: number;
  overallChangeRatePct: number;
  attendanceAvgPct: number;
};

type SubjectStat = {
  subjectCode: string;
  subjectName: string;
  masterWeeklyPeriods: number;
  totalScheduled?: number;
  totalConducted: number;
  timesChanged: number;
  timesSwappedOut: number;
  timesSwappedIn: number;
  facultyNames: string[];
  assignedFacultyNames?: string[];
  changedFaculties?: Array<{ facultyName: string; originalFacultyName?: string; count: number }>;
  turnoutPct?: number | null;
  attendancePct: number;
};

type FacultyStat = {
  hrmsId: string;
  facultyName: string;
  masterAssignedPeriods: number;
  classesConducted: number;
  relievedCount: number;
  substituteTakenCount: number;
  netTeachingCount: number;
  subjects: string[];
};

type ComparisonItem = {
  id: number;
  date: string;
  dayOfWeek: string;
  time: string;
  slotLabel: string;
  branchId?: number | null;
  branchName?: string;
  branchCode?: string;
  batch: string;
  sectionName: string | null;
  semester: number;
  masterSubjectCode: string | null;
  masterSubjectName: string | null;
  masterFacultyName: string | null;
  masterFacultyHrmsId: string | null;
  todaySubjectCode: string | null;
  todaySubjectName: string | null;
  todayFacultyName: string | null;
  todayFacultyHrmsId: string | null;
  varianceType: "UNCHANGED" | "FACULTY_SUBSTITUTE" | "SUBJECT_SWAP" | "BOTH";
  isConducted: boolean;
  presentCount: number;
  absentCount: number;
  attendancePct: number | null;
};

type MasterPeriodItem = {
  id: number;
  dayOfWeek: string;
  slotLabel: string;
  slotTime: string;
  branchId?: number | null;
  branchName?: string;
  branchCode?: string;
  batch: string;
  semester: number;
  sectionName: string | null;
  subjectCode: string;
  subjectName: string;
  facultyName: string;
  facultyHrmsId: string | null;
  entryType: string;
  customLabel?: string | null;
};

type ChangeEvent = {
  id: number;
  timetableDate: string;
  collegeId: number;
  courseId: number;
  branchId: number;
  branchName?: string;
  branchCode?: string;
  batch: string;
  semester: number;
  sectionName: string | null;
  slotLabel: string;
  slotTime: string;
  masterSubjectCode: string | null;
  masterSubjectName: string | null;
  masterFacultyHrmsId: string | null;
  masterFacultyName: string | null;
  newSubjectCode: string | null;
  newSubjectName: string | null;
  newFacultyHrmsId: string | null;
  newFacultyName: string | null;
  changeType: string;
  remarks: string | null;
  changedByName: string | null;
  createdAt: string;
  varianceType: "FACULTY_SUBSTITUTE" | "SUBJECT_SWAP" | "BOTH" | "REVERTED" | "PERIOD_OVERRIDE";
};

type CatalogClass = {
  key: string;
  label: string;
  collegeId?: number;
  courseId?: number;
  branchId?: number;
  batch: string;
  year: number;
  semester: number;
  sections: string[];
};

type ReportResponse = {
  summary: ReportSummary;
  subjects: SubjectStat[];
  faculties: FacultyStat[];
  recentChanges: ChangeEvent[];
  comparisons?: ComparisonItem[];
  masterScheduledPeriods?: MasterPeriodItem[];
  catalogSubjects?: Array<{ subjectCode: string; subjectName: string }>;
  catalogFaculties?: Array<{ hrmsId: string; facultyName: string }>;
  catalogClasses?: CatalogClass[];
};

function cleanSectionCode(raw: string | null | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  const stripped = trimmed.replace(/^(?:(?:section|sec)[\s.:_-]*)+/i, "").trim();
  return (stripped || trimmed).toUpperCase();
}

function getTodayDateString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDisplayDate(dateStr: string): string {
  if (!dateStr) return "";
  const parts = dateStr.split("-");
  if (parts.length === 3) {
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    }
  }
  return dateStr;
}

export type MasterReportSection = "variation" | "subjects" | "staff" | "audit";

export interface MasterVsChangedReportProps {
  activeSection?: MasterReportSection;
  onNavigateSection?: (section: MasterReportSection) => void;
}

export function MasterVsChangedReport({
  activeSection = "variation",
}: MasterVsChangedReportProps) {
  const { masters } = useAcademicContext();
  const [academicYear, setAcademicYear] = useState("");
  const [selectedCollege, setSelectedCollege] = useState<number | null>(null);
  const [selectedCourse, setSelectedCourse] = useState<number | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<number | null>(null);
  const [selectedClassKey, setSelectedClassKey] = useState<string | null>(null);
  const [selectedBatch, setSelectedBatch] = useState<string | null>(null);
  const [selectedSection, setSelectedSection] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedSemester, setSelectedSemester] = useState<number | null>(null);
  const [selectedStaffHrmsId, setSelectedStaffHrmsId] = useState<string | null>(null);
  const [selectedSubjectCode, setSelectedSubjectCode] = useState<string | null>(null);

  // Subject Analysis display mode: "section-wise" (Class & Section wise) or "consolidated"
  const [subjectViewMode, setSubjectViewMode] = useState<"section-wise" | "consolidated">("section-wise");

  // Pop-up modal state for Staff Profile & Action Log
  const [activeStaffModal, setActiveStaffModal] = useState<FacultyStat | null>(null);
  const [staffModalSearch, setStaffModalSearch] = useState("");

  // Pop-up modal state for Subject Delivery & Alteration Action Log
  const [activeSubjectModal, setActiveSubjectModal] = useState<(SubjectStat & {
    cohortTitle?: string;
    branchCode?: string;
    batch?: string;
    sectionLetter?: string;
  }) | null>(null);
  const [subjectModalSearch, setSubjectModalSearch] = useState("");

  // Date mode: "today" or "range"
  const [dateMode, setDateMode] = useState<"today" | "range">("today");
  const [startDate, setStartDate] = useState(getTodayDateString());
  const [endDate, setEndDate] = useState(getTodayDateString());
  const [searchQuery, setSearchQuery] = useState("");

  // Interactive KPI Pop Card / Drawer State
  const [activeKpiDrawer, setActiveKpiDrawer] = useState<KpiModalType>(null);
  const [drawerSearch, setDrawerSearch] = useState("");

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ReportResponse | null>(null);
  const printAreaRef = useRef<HTMLDivElement>(null);

  // Close drawer & modals on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setActiveKpiDrawer(null);
        setActiveStaffModal(null);
        setActiveSubjectModal(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Initialize active academic year
  useEffect(() => {
    if (masters && !academicYear) {
      const currentYear =
        masters.defaults.academicYear ||
        masters.academicYears.find((item) => item.isActive)?.label ||
        masters.academicYears[0]?.label;
      if (currentYear) setAcademicYear(currentYear);
    }
  }, [masters, academicYear]);

  // Load report data from server
  const loadReport = useCallback(async () => {
    if (!academicYear) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("academicYear", academicYear);
      if (selectedCollege != null) params.set("collegeId", String(selectedCollege));
      if (selectedCourse != null) params.set("courseId", String(selectedCourse));
      if (selectedBranch != null) params.set("branchId", String(selectedBranch));
      if (selectedBatch) params.set("batch", selectedBatch);
      if (selectedYear != null) params.set("year", String(selectedYear));
      if (selectedSemester != null) params.set("semester", String(selectedSemester));
      if (selectedSection) {
        params.set("sectionName", selectedSection);
        params.set("section", selectedSection);
      }
      if (selectedStaffHrmsId && activeSection === "variation") params.set("staffHrmsId", selectedStaffHrmsId);
      if (selectedSubjectCode && activeSection === "variation") params.set("subjectCode", selectedSubjectCode);

      if (dateMode === "today") {
        const todayStr = getTodayDateString();
        params.set("startDate", todayStr);
        params.set("endDate", todayStr);
      } else {
        if (startDate) params.set("startDate", startDate);
        if (endDate) params.set("endDate", endDate);
      }

      const res = await apiFetch(`/today-timetable/master-vs-changed-report?${params.toString()}`);
      if (res.ok) {
        const json = (await res.json()) as ReportResponse;
        setData(json);
      }
    } catch (err) {
      console.error("Failed to load master vs changed report:", err);
    } finally {
      setLoading(false);
    }
  }, [
    academicYear,
    selectedCollege,
    selectedCourse,
    selectedBranch,
    selectedBatch,
    selectedYear,
    selectedSemester,
    selectedSection,
    selectedStaffHrmsId,
    selectedSubjectCode,
    activeSection,
    dateMode,
    startDate,
    endDate,
  ]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  // Cascading Course Filter
  const filterCourses = useMemo(() => {
    if (!masters) return [];
    if (selectedCollege != null) {
      return masters.courses.filter((course) => course.collegeId === selectedCollege);
    }
    return masters.courses;
  }, [masters, selectedCollege]);

  // Cascading Branch Filter
  const filterBranches = useMemo(() => {
    if (!masters) return [];
    if (selectedCourse != null) {
      return masters.branches.filter((branch) => branch.courseId === selectedCourse);
    }
    if (selectedCollege != null) {
      const collegeCourseIds = new Set(
        masters.courses
          .filter((course) => course.collegeId === selectedCollege)
          .map((course) => course.id),
      );
      return masters.branches.filter((branch) => collegeCourseIds.has(branch.courseId));
    }
    return masters.branches;
  }, [masters, selectedCollege, selectedCourse]);

  // Available Classes: derived from live server catalog (filtered reactively) or fallback from masters
  const availableClasses = useMemo<CatalogClass[]>(() => {
    let list = data?.catalogClasses ?? [];
    if (selectedCollege != null) {
      list = list.filter((c) => !c.collegeId || c.collegeId === selectedCollege);
    }
    if (selectedCourse != null) {
      list = list.filter((c) => !c.courseId || c.courseId === selectedCourse);
    }
    if (selectedBranch != null) {
      list = list.filter((c) => !c.branchId || c.branchId === selectedBranch);
    }
    if (list.length > 0) {
      return list;
    }
    if (!masters || selectedBranch == null) return [];
    const branchSections = masters.sections.filter((s) => s.branchId === selectedBranch);
    const branchBatches = (masters.batches ?? []).filter((b) => b.branchId === selectedBranch);
    const batchSet = Array.from(
      new Set([...branchSections.map((s) => s.batch), ...branchBatches.map((b) => b.batch)]),
    )
      .filter(Boolean)
      .sort();

    const romanYears = ["I", "II", "III", "IV"];
    return batchSet.map((b, idx) => {
      const bSecs = Array.from(
        new Set(
          branchSections
            .filter((s) => s.batch === b)
            .map((s) => cleanSectionCode(s.name))
            .filter(Boolean),
        ),
      ).sort();
      const approxYear = Math.min(4, Math.max(1, idx + 1));
      return {
        key: `${b}_${approxYear}_1`,
        label: `${romanYears[approxYear - 1] || approxYear} Year (Batch ${b})`,
        collegeId: selectedCollege ?? undefined,
        courseId: selectedCourse ?? undefined,
        branchId: selectedBranch,
        batch: b,
        year: approxYear,
        semester: 1,
        sections: bSecs,
      };
    });
  }, [data?.catalogClasses, masters, selectedCollege, selectedCourse, selectedBranch]);

  // Active selected class object
  const activeClassObj = useMemo(() => {
    if (!selectedClassKey) return null;
    return availableClasses.find((c) => c.key === selectedClassKey) ?? null;
  }, [availableClasses, selectedClassKey]);

  // Year options for the course
  const yearOptions = useMemo(() => {
    if (selectedCourse != null && masters) {
      const course = masters.courses.find((c) => c.id === selectedCourse);
      if (course?.totalYears) {
        return Array.from({ length: course.totalYears }, (_, i) => i + 1);
      }
    }
    return masters?.yearOptions ?? [1, 2, 3, 4];
  }, [masters, selectedCourse]);

  // Dynamic sections: if class is selected, show exact sections for that class (e.g. 2 sections or 4 sections)
  const availableSections = useMemo<string[]>(() => {
    if (activeClassObj) {
      return activeClassObj.sections;
    }
    if (selectedYear != null) {
      const matchingClasses = availableClasses.filter((c) => c.year === selectedYear);
      const allSecs = new Set<string>();
      for (const c of matchingClasses) {
        for (const s of c.sections) allSecs.add(s);
      }
      return Array.from(allSecs).sort();
    }
    const allSecs = new Set<string>();
    for (const c of availableClasses) {
      for (const s of c.sections) allSecs.add(s);
    }
    return Array.from(allSecs).sort();
  }, [activeClassObj, selectedYear, availableClasses]);

  // Keep section valid when available sections change
  useEffect(() => {
    if (selectedSection != null && !availableSections.includes(selectedSection)) {
      setSelectedSection(null);
    }
  }, [availableSections, selectedSection]);

  // Handlers for class, year, semester
  const handleClassChange = (key: string | null) => {
    setSelectedClassKey(key);
    if (key) {
      const match = availableClasses.find((c) => c.key === key);
      if (match) {
        setSelectedBatch(match.batch);
        if (match.year) setSelectedYear(match.year);
        if (match.semester) setSelectedSemester(match.semester);
        if (selectedSection && !match.sections.includes(selectedSection)) {
          setSelectedSection(null);
        }
      }
    } else {
      setSelectedBatch(null);
      setSelectedSection(null);
      setSelectedYear(null);
      setSelectedSemester(null);
    }
  };

  const handleYearChange = (year: number | null) => {
    setSelectedYear(year);
    if (year == null) {
      if (activeClassObj) {
        setSelectedClassKey(null);
        setSelectedBatch(null);
        setSelectedSection(null);
      }
    } else if (activeClassObj && activeClassObj.year !== year) {
      const matchCls = availableClasses.find((c) => c.year === year);
      if (matchCls) {
        setSelectedClassKey(matchCls.key);
        setSelectedBatch(matchCls.batch);
      } else {
        setSelectedClassKey(null);
        setSelectedBatch(null);
        setSelectedSection(null);
      }
    }
  };

  const handleSemesterChange = (sem: number | null) => {
    setSelectedSemester(sem);
    if (activeClassObj && activeClassObj.semester !== sem) {
      setSelectedClassKey(null);
      setSelectedBatch(null);
      setSelectedSection(null);
    }
  };

  // Catalog faculties & subjects (for drilldown / reference)
  const availableFaculties = useMemo(() => {
    if (data?.catalogFaculties && data.catalogFaculties.length > 0) return data.catalogFaculties;
    if (data?.faculties && data.faculties.length > 0)
      return data.faculties.map((f) => ({ hrmsId: f.hrmsId, facultyName: f.facultyName }));
    return [];
  }, [data?.catalogFaculties, data?.faculties]);

  const availableSubjects = useMemo(() => {
    if (data?.catalogSubjects && data.catalogSubjects.length > 0) return data.catalogSubjects;
    if (data?.subjects && data.subjects.length > 0)
      return data.subjects.map((s) => ({ subjectCode: s.subjectCode, subjectName: s.subjectName }));
    return [];
  }, [data?.catalogSubjects, data?.subjects]);

  const selectedStaffObj = useMemo<FacultyStat | null>(() => {
    if (!selectedStaffHrmsId) return null;
    const fromStats = data?.faculties?.find((f) => f.hrmsId === selectedStaffHrmsId);
    if (fromStats) return fromStats;
    const fromCatalog = availableFaculties.find((f) => f.hrmsId === selectedStaffHrmsId);
    if (fromCatalog) {
      return {
        hrmsId: fromCatalog.hrmsId,
        facultyName: fromCatalog.facultyName,
        masterAssignedPeriods: 0,
        classesConducted: 0,
        relievedCount: 0,
        substituteTakenCount: 0,
        netTeachingCount: 0,
        subjects: [],
      };
    }
    return null;
  }, [selectedStaffHrmsId, data?.faculties, availableFaculties]);

  const selectedSubjectObj = useMemo<SubjectStat | null>(() => {
    if (!selectedSubjectCode) return null;
    const fromStats = data?.subjects?.find((s) => s.subjectCode === selectedSubjectCode);
    if (fromStats) return fromStats;
    const fromCatalog = availableSubjects.find((s) => s.subjectCode === selectedSubjectCode);
    if (fromCatalog) {
      return {
        subjectCode: fromCatalog.subjectCode,
        subjectName: fromCatalog.subjectName,
        masterWeeklyPeriods: 0,
        totalConducted: 0,
        timesChanged: 0,
        timesSwappedOut: 0,
        timesSwappedIn: 0,
        facultyNames: [],
        attendancePct: 0,
      };
    }
    return null;
  }, [selectedSubjectCode, data?.subjects, availableSubjects]);

  // Reset all filters
  const handleResetFilters = () => {
    setSelectedCollege(null);
    setSelectedCourse(null);
    setSelectedBranch(null);
    setSelectedClassKey(null);
    setSelectedBatch(null);
    setSelectedYear(null);
    setSelectedSemester(null);
    setSelectedSection(null);
    setSelectedStaffHrmsId(null);
    setSelectedSubjectCode(null);
    setDateMode("today");
    const t = getTodayDateString();
    setStartDate(t);
    setEndDate(t);
    setSearchQuery("");
  };

  const hasActiveFilters = Boolean(
    selectedCollege != null ||
      selectedCourse != null ||
      selectedBranch != null ||
      selectedClassKey != null ||
      selectedYear != null ||
      selectedSemester != null ||
      selectedSection != null ||
      selectedStaffHrmsId != null ||
      selectedSubjectCode != null ||
      dateMode === "range" ||
      searchQuery,
  );

  const summary = data?.summary ?? {
    totalMasterPeriods: 0,
    totalScheduledSessions: 0,
    totalConductedSessions: 0,
    totalChangesRecorded: 0,
    facultySubstitutionsCount: 0,
    subjectSwapsCount: 0,
    revertedCount: 0,
    overallChangeRatePct: 0,
    attendanceAvgPct: 0,
  };

  // Filtered comparison items (Master vs Today)
  const filteredComparisons = useMemo(() => {
    const list = data?.comparisons ?? [];
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter(
      (c) =>
        (c.masterSubjectName || "").toLowerCase().includes(q) ||
        (c.masterSubjectCode || "").toLowerCase().includes(q) ||
        (c.masterFacultyName || "").toLowerCase().includes(q) ||
        (c.todaySubjectName || "").toLowerCase().includes(q) ||
        (c.todaySubjectCode || "").toLowerCase().includes(q) ||
        (c.todayFacultyName || "").toLowerCase().includes(q) ||
        (c.batch || "").toLowerCase().includes(q) ||
        (c.sectionName || "").toLowerCase().includes(q) ||
        c.slotLabel.toLowerCase().includes(q) ||
        c.date.includes(q),
    );
  }, [data?.comparisons, searchQuery]);

  // Memoized maps for Assigned Faculty (Master) and Changed Faculty (Substitutions) per Subject
  const { subjectAssignedFacultyMap, subjectChangedFacultyMap } = useMemo(() => {
    const assignedMap = new Map<string, Set<string>>();
    const changedMap = new Map<string, Map<string, { facultyName: string; originalFacultyName?: string; count: number }>>();

    // 1. Gather master assignments from masterScheduledPeriods if present
    if (data?.masterScheduledPeriods) {
      for (const p of data.masterScheduledPeriods) {
        if (p.subjectCode && p.facultyName && p.facultyName.trim() && p.facultyName !== "None" && p.facultyName !== "Faculty Assigned") {
          const code = p.subjectCode.trim();
          if (!assignedMap.has(code)) assignedMap.set(code, new Set());
          assignedMap.get(code)!.add(p.facultyName.trim());
        }
      }
    }

    // 2. Scan comparisons (Master Timetable vs Today Timetable for all scheduled sessions)
    const compList = data?.comparisons ?? [];
    for (const c of compList) {
      const masterCode = c.masterSubjectCode?.trim();
      const todayCode = c.todaySubjectCode?.trim();
      const masterFac = (c.masterFacultyName && c.masterFacultyName.trim() && c.masterFacultyName !== "None" && c.masterFacultyName !== "Faculty Assigned")
        ? c.masterFacultyName.trim()
        : "";
      const todayFac = (c.todayFacultyName && c.todayFacultyName.trim() && c.todayFacultyName !== "None" && c.todayFacultyName !== "Faculty Assigned")
        ? c.todayFacultyName.trim()
        : "";

      if (masterCode && masterFac) {
        if (!assignedMap.has(masterCode)) assignedMap.set(masterCode, new Set());
        assignedMap.get(masterCode)!.add(masterFac);
      }

      // Identify staff changed / substituted comparing Master Timetable vs Today Timetable
      const hasFacultyChanged =
        c.varianceType === "FACULTY_SUBSTITUTE" ||
        c.varianceType === "BOTH" ||
        Boolean(
          todayFac &&
          masterFac &&
          todayFac.toLowerCase() !== masterFac.toLowerCase()
        ) ||
        Boolean(
          c.todayFacultyHrmsId &&
          c.masterFacultyHrmsId &&
          c.todayFacultyHrmsId.trim() !== c.masterFacultyHrmsId.trim()
        );

      if (hasFacultyChanged && todayFac) {
        const codesToTrack = new Set<string>();
        if (masterCode) codesToTrack.add(masterCode);
        if (todayCode) codesToTrack.add(todayCode);

        for (const code of codesToTrack) {
          if (!changedMap.has(code)) changedMap.set(code, new Map());
          const subMap = changedMap.get(code)!;
          const key = `${todayFac}__${masterFac}`;
          if (!subMap.has(key)) {
            subMap.set(key, {
              facultyName: todayFac,
              originalFacultyName: masterFac || undefined,
              count: 1,
            });
          } else {
            subMap.get(key)!.count++;
          }
        }
      }
    }

    // Fallback to subjects catalog/stats facultyNames
    if (data?.subjects) {
      for (const s of data.subjects) {
        if (s.subjectCode && s.facultyNames) {
          const code = s.subjectCode.trim();
          if (!assignedMap.has(code) || assignedMap.get(code)!.size === 0) {
            assignedMap.set(code, new Set(s.facultyNames.map((n) => n.trim())));
          }
        }
      }
    }

    return {
      subjectAssignedFacultyMap: assignedMap,
      subjectChangedFacultyMap: changedMap,
    };
  }, [data?.comparisons, data?.masterScheduledPeriods, data?.subjects]);

  // Filtered subjects list
  const filteredSubjects = useMemo(() => {
    const list = data?.subjects ?? [];
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter(
      (s) =>
        s.subjectName.toLowerCase().includes(q) ||
        s.subjectCode.toLowerCase().includes(q) ||
        s.facultyNames.some((f) => f.toLowerCase().includes(q)) ||
        Array.from(subjectAssignedFacultyMap.get(s.subjectCode) ?? []).some((f) => f.toLowerCase().includes(q)) ||
        Array.from(subjectChangedFacultyMap.get(s.subjectCode)?.values() ?? []).some((cf) => cf.facultyName.toLowerCase().includes(q)),
    );
  }, [data?.subjects, searchQuery, subjectAssignedFacultyMap, subjectChangedFacultyMap]);

  // Filtered faculty list
  const filteredFaculties = useMemo(() => {
    const list = data?.faculties ?? [];
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter(
      (f) =>
        f.facultyName.toLowerCase().includes(q) ||
        f.hrmsId.toLowerCase().includes(q) ||
        f.subjects.some((s) => s.toLowerCase().includes(q)),
    );
  }, [data?.faculties, searchQuery]);

  // Subject Analytics derived metrics
  const subjectAnalytics = useMemo(() => {
    const list = filteredSubjects;
    const totalSubjects = list.length;
    const totalWeeklyQuota = list.reduce((acc, s) => acc + (Number(s.masterWeeklyPeriods) || 0), 0);
    const totalConducted = list.reduce((acc, s) => acc + (Number(s.totalConducted) || 0), 0);
    const alteredSubjectsCount = list.filter((s) => (Number(s.timesChanged) || 0) > 0).length;
    const totalChanges = list.reduce((acc, s) => acc + (Number(s.timesChanged) || 0), 0);
    const totalSwappedOut = list.reduce((acc, s) => acc + (Number(s.timesSwappedOut) || 0), 0);
    const totalSwappedIn = list.reduce((acc, s) => acc + (Number(s.timesSwappedIn) || 0), 0);
    const withAttendance = list.filter((s) => s.attendancePct > 0);
    const avgAttendance =
      withAttendance.length > 0
        ? Math.round(withAttendance.reduce((acc, s) => acc + s.attendancePct, 0) / withAttendance.length)
        : 0;

    return {
      totalSubjects,
      totalWeeklyQuota,
      totalConducted,
      alteredSubjectsCount,
      totalChanges,
      totalSwappedOut,
      totalSwappedIn,
      avgAttendance,
    };
  }, [filteredSubjects]);

  // Staff Analytics derived metrics
  const staffAnalytics = useMemo(() => {
    const list = filteredFaculties;
    const totalStaff = list.length;
    const totalAssignedLoad = list.reduce((acc, f) => acc + (Number(f.masterAssignedPeriods) || 0), 0);
    const totalConducted = list.reduce((acc, f) => acc + (Number(f.classesConducted) || 0), 0);
    const totalRelieved = list.reduce((acc, f) => acc + (Number(f.relievedCount) || 0), 0);
    const totalSubstituteTaken = list.reduce((acc, f) => acc + (Number(f.substituteTakenCount) || 0), 0);
    const totalNetLoad = list.reduce((acc, f) => acc + (Number(f.netTeachingCount) || 0), 0);
    const activeFacultyCount = list.filter(
      (f) => f.classesConducted > 0 || f.masterAssignedPeriods > 0 || f.substituteTakenCount > 0,
    ).length;

    return {
      totalStaff,
      totalAssignedLoad,
      totalConducted,
      totalRelieved,
      totalSubstituteTaken,
      totalNetLoad,
      activeFacultyCount,
    };
  }, [filteredFaculties]);

  // Drill-down sessions for selected subject
  const subjectSessions = useMemo(() => {
    if (!selectedSubjectCode) return [];
    const code = selectedSubjectCode.trim().toUpperCase();
    return (data?.comparisons || []).filter(
      (c) =>
        (c.masterSubjectCode && c.masterSubjectCode.trim().toUpperCase() === code) ||
        (c.todaySubjectCode && c.todaySubjectCode.trim().toUpperCase() === code) ||
        (c.masterSubjectName && c.masterSubjectName.trim().toUpperCase() === code) ||
        (c.todaySubjectName && c.todaySubjectName.trim().toUpperCase() === code),
    );
  }, [selectedSubjectCode, data?.comparisons]);

  // Drill-down sessions for selected staff
  const staffSessions = useMemo(() => {
    if (!selectedStaffHrmsId) return [];
    const hrms = selectedStaffHrmsId.trim();
    return (data?.comparisons || []).filter(
      (c) =>
        (c.masterFacultyHrmsId && c.masterFacultyHrmsId.trim() === hrms) ||
        (c.todayFacultyHrmsId && c.todayFacultyHrmsId.trim() === hrms),
    );
  }, [selectedStaffHrmsId, data?.comparisons]);

  // Sessions for Active Staff Popup Modal with detailed action role calculation
  const modalStaffSessions = useMemo(() => {
    if (!activeStaffModal) return [];
    const hrms = (activeStaffModal.hrmsId || "").trim().toLowerCase();
    const facName = (activeStaffModal.facultyName || "").trim().toLowerCase();

    return (data?.comparisons || [])
      .filter((c) => {
        const todayHrms = (c.todayFacultyHrmsId || "").trim().toLowerCase();
        const masterHrms = (c.masterFacultyHrmsId || "").trim().toLowerCase();
        const todayName = (c.todayFacultyName || "").trim().toLowerCase();
        const masterName = (c.masterFacultyName || "").trim().toLowerCase();

        const matchHrms =
          Boolean(hrms) && (todayHrms === hrms || masterHrms === hrms);
        const matchName =
          Boolean(facName) && (todayName === facName || masterName === facName);
        return matchHrms || matchName;
      })
      .map((c) => {
        const todayHrms = (c.todayFacultyHrmsId || "").trim().toLowerCase();
        const masterHrms = (c.masterFacultyHrmsId || "").trim().toLowerCase();
        const todayName = (c.todayFacultyName || "").trim().toLowerCase();
        const masterName = (c.masterFacultyName || "").trim().toLowerCase();

        const isTodayTeacher = (Boolean(hrms) && todayHrms === hrms) || (Boolean(facName) && todayName === facName);
        const isMasterTeacher = (Boolean(hrms) && masterHrms === hrms) || (Boolean(facName) && masterName === facName);

        let actionRole: "substitute_taken" | "relieved_away" | "regular_conducted" | "scheduled_pending" = "regular_conducted";
        let actionTitle = "Regular Scheduled Class";
        let actionBadgeClass = "text-emerald-800 bg-emerald-50 border-emerald-300";

        if (isTodayTeacher && !isMasterTeacher && c.masterFacultyName) {
          actionRole = "substitute_taken";
          actionTitle = `Substitute Taken (+) for ${c.masterFacultyName}`;
          actionBadgeClass = "text-sky-800 bg-sky-50 border-sky-300 font-bold";
        } else if (!isTodayTeacher && isMasterTeacher && c.todayFacultyName) {
          actionRole = "relieved_away";
          actionTitle = `Relieved Away (-) by ${c.todayFacultyName}`;
          actionBadgeClass = "text-rose-800 bg-rose-50 border-rose-300 font-bold";
        } else if (c.isConducted) {
          actionRole = "regular_conducted";
          actionTitle = "Conducted As Master";
          actionBadgeClass = "text-emerald-800 bg-emerald-50 border-emerald-300";
        } else {
          actionRole = "scheduled_pending";
          actionTitle = "Scheduled Master Slot";
          actionBadgeClass = "text-slate-700 bg-slate-100 border-slate-200";
        }

        return {
          ...c,
          isTodayTeacher,
          isMasterTeacher,
          actionRole,
          actionTitle,
          actionBadgeClass,
        };
      });
  }, [activeStaffModal, data?.comparisons]);

  const filteredModalStaffSessions = useMemo(() => {
    if (!staffModalSearch.trim()) return modalStaffSessions;
    const q = staffModalSearch.toLowerCase();
    return modalStaffSessions.filter(
      (s) =>
        (s.date || "").includes(q) ||
        (s.slotLabel || "").toLowerCase().includes(q) ||
        (s.time || "").toLowerCase().includes(q) ||
        (s.masterSubjectName || "").toLowerCase().includes(q) ||
        (s.masterSubjectCode || "").toLowerCase().includes(q) ||
        (s.todaySubjectName || "").toLowerCase().includes(q) ||
        (s.todaySubjectCode || "").toLowerCase().includes(q) ||
        (s.sectionName || "").toLowerCase().includes(q) ||
        (s.batch || "").toLowerCase().includes(q) ||
        (s.masterFacultyName || "").toLowerCase().includes(q) ||
        (s.todayFacultyName || "").toLowerCase().includes(q) ||
        (s.actionTitle || "").toLowerCase().includes(q),
    );
  }, [modalStaffSessions, staffModalSearch]);

  // Sessions for Active Subject Popup Modal with delivery & alteration actions
  const modalSubjectSessions = useMemo(() => {
    if (!activeSubjectModal) return [];
    const code = (activeSubjectModal.subjectCode || "").trim().toUpperCase();
    const name = (activeSubjectModal.subjectName || "").trim().toLowerCase();

    return (data?.comparisons || [])
      .filter((c) => {
        const matchCode =
          (c.masterSubjectCode && c.masterSubjectCode.trim().toUpperCase() === code) ||
          (c.todaySubjectCode && c.todaySubjectCode.trim().toUpperCase() === code);
        const matchName =
          (c.masterSubjectName && c.masterSubjectName.trim().toLowerCase() === name) ||
          (c.todaySubjectName && c.todaySubjectName.trim().toLowerCase() === name);

        if (!matchCode && !matchName) return false;

        if (activeSubjectModal.sectionLetter) {
          const sec = cleanSectionCode(c.sectionName);
          const targetSec = cleanSectionCode(activeSubjectModal.sectionLetter);
          if (sec && targetSec && sec !== targetSec) return false;
        }
        return true;
      })
      .map((c) => {
        const isSub =
          c.varianceType === "FACULTY_SUBSTITUTE" ||
          Boolean(
            c.todayFacultyName &&
            c.masterFacultyName &&
            c.todayFacultyName.trim().toLowerCase() !== c.masterFacultyName.trim().toLowerCase()
          );
        const isSwap =
          c.varianceType === "SUBJECT_SWAP" ||
          Boolean(
            c.todaySubjectCode &&
            c.masterSubjectCode &&
            c.todaySubjectCode.trim().toUpperCase() !== c.masterSubjectCode.trim().toUpperCase()
          );

        let actionRole: "as_master" | "substitute" | "swapped" | "both" = "as_master";
        let actionTitle = "Conducted As Master";
        let actionBadgeClass = "text-emerald-800 bg-emerald-50 border-emerald-300";

        if (isSub && isSwap) {
          actionRole = "both";
          actionTitle = `Swap & Sub (${c.todayFacultyName})`;
          actionBadgeClass = "text-purple-800 bg-purple-50 border-purple-300 font-bold";
        } else if (isSub) {
          actionRole = "substitute";
          actionTitle = `Faculty Substituted (${c.todayFacultyName})`;
          actionBadgeClass = "text-amber-800 bg-amber-50 border-amber-300 font-bold";
        } else if (isSwap) {
          actionRole = "swapped";
          actionTitle = `Subject Swapped (${c.todaySubjectName})`;
          actionBadgeClass = "text-sky-800 bg-sky-50 border-sky-300 font-bold";
        }

        return {
          ...c,
          isSub,
          isSwap,
          actionRole,
          actionTitle,
          actionBadgeClass,
        };
      });
  }, [activeSubjectModal, data?.comparisons]);

  const filteredModalSubjectSessions = useMemo(() => {
    if (!subjectModalSearch.trim()) return modalSubjectSessions;
    const q = subjectModalSearch.toLowerCase();
    return modalSubjectSessions.filter(
      (s) =>
        (s.date || "").includes(q) ||
        (s.slotLabel || "").toLowerCase().includes(q) ||
        (s.time || "").toLowerCase().includes(q) ||
        (s.sectionName || "").toLowerCase().includes(q) ||
        (s.batch || "").toLowerCase().includes(q) ||
        (s.masterFacultyName || "").toLowerCase().includes(q) ||
        (s.todayFacultyName || "").toLowerCase().includes(q) ||
        (s.masterSubjectName || "").toLowerCase().includes(q) ||
        (s.todaySubjectName || "").toLowerCase().includes(q) ||
        (s.actionTitle || "").toLowerCase().includes(q),
    );
  }, [modalSubjectSessions, subjectModalSearch]);

  // Filtered recent changes (Audit Log)
  const filteredRecentChanges = useMemo(() => {
    const list = data?.recentChanges ?? [];
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter(
      (c) =>
        (c.masterSubjectName || "").toLowerCase().includes(q) ||
        (c.masterSubjectCode || "").toLowerCase().includes(q) ||
        (c.masterFacultyName || "").toLowerCase().includes(q) ||
        (c.newSubjectName || "").toLowerCase().includes(q) ||
        (c.newSubjectCode || "").toLowerCase().includes(q) ||
        (c.newFacultyName || "").toLowerCase().includes(q) ||
        (c.batch || "").toLowerCase().includes(q) ||
        (c.sectionName || "").toLowerCase().includes(q) ||
        (c.remarks || "").toLowerCase().includes(q) ||
        c.slotLabel.toLowerCase().includes(q) ||
        c.timetableDate.includes(q),
    );
  }, [data?.recentChanges, searchQuery]);

  // Branch lookup map for displaying branch codes (CSE, ECE, MEC...)
  const branchLookup = useMemo(() => {
    const map = new Map<number, { name: string; code: string }>();
    (masters?.branches || []).forEach((b) => {
      map.set(b.id, {
        name: b.name,
        code: b.code || b.name,
      });
    });
    return map;
  }, [masters?.branches]);

  const getBranchBadge = useCallback(
    (branchId?: number | null, fallbackCode?: string | null): string => {
      if (fallbackCode && fallbackCode.trim()) return fallbackCode.trim();
      if (branchId && branchLookup.has(branchId)) return branchLookup.get(branchId)!.code;
      if (selectedBranch && branchLookup.has(selectedBranch)) return branchLookup.get(selectedBranch)!.code;
      return "CSE";
    },
    [branchLookup, selectedBranch],
  );

  // Group comparisons cleanly by academic cohort (Branch + Batch + Section)
  // Ensures distinct classes (e.g. BCSE Sec A vs DCSE Sec A vs DECE Sec A) are separated accurately into their own cohort cards
  const comparisonsBySection = useMemo(() => {
    type CohortMeta = {
      branchCode: string;
      branchId?: number | null;
      batch: string;
      sectionLetter: string;
    };

    const map = new Map<string, ComparisonItem[]>();
    const cohortMeta = new Map<string, CohortMeta>();

    for (const c of filteredComparisons) {
      const branchCode = (c.branchCode && c.branchCode.trim()) ? c.branchCode.trim() : getBranchBadge(c.branchId, c.branchCode);
      const batch = (c.batch && c.batch.trim() && c.batch !== "Regular") ? c.batch.trim() : (selectedBatch || "Regular");
      const secLetter = cleanSectionCode(c.sectionName) || "Unassigned";
      const key = `${branchCode}__${batch}__${secLetter}`;

      if (!map.has(key)) {
        map.set(key, []);
        cohortMeta.set(key, {
          branchCode,
          branchId: c.branchId,
          batch,
          sectionLetter: secLetter,
        });
      }
      map.get(key)!.push(c);
    }

    // Sort cohort keys: by branch code, then by batch (descending), then by section letter
    const sortedKeys = Array.from(map.keys()).sort((a, b) => {
      const metaA = cohortMeta.get(a)!;
      const metaB = cohortMeta.get(b)!;

      if (metaA.branchCode !== metaB.branchCode) {
        return metaA.branchCode.localeCompare(metaB.branchCode);
      }
      if (metaA.batch !== metaB.batch) {
        return metaB.batch.localeCompare(metaA.batch);
      }
      if (metaA.sectionLetter === "Unassigned") return 1;
      if (metaB.sectionLetter === "Unassigned") return -1;
      return metaA.sectionLetter.localeCompare(metaB.sectionLetter);
    });

    return sortedKeys.map((key) => {
      const rawItems = map.get(key)!;
      const meta = cohortMeta.get(key)!;

      // Sort items chronologically by date and start time / slot
      const items = [...rawItems].sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return (a.time || "").localeCompare(b.time || "");
      });

      const conductedCount = items.filter((i) => i.isConducted).length;
      const substitutedCount = items.filter(
        (i) => i.varianceType === "FACULTY_SUBSTITUTE" || i.varianceType === "BOTH",
      ).length;
      const swappedCount = items.filter(
        (i) => i.varianceType === "SUBJECT_SWAP" || i.varianceType === "BOTH",
      ).length;
      const unchangedCount = items.filter((i) => i.varianceType === "UNCHANGED").length;

      const secTitle = meta.sectionLetter === "Unassigned"
        ? `${meta.branchCode} · All Sections`
        : `Section ${meta.sectionLetter}`;

      // Derive distinct subjects taught in this specific class & section
      type CohortSubjectEntry = {
        subjectCode: string;
        subjectName: string;
        masterWeeklyPeriods: number;
        totalScheduled: number;
        totalConducted: number;
        timesChanged: number;
        timesSwappedOut: number;
        timesSwappedIn: number;
        assignedFaculty: Set<string>;
        changedFaculty: Map<string, { facultyName: string; originalFacultyName?: string; count: number }>;
        totalPresent: number;
        totalMarked: number;
      };

      const cSubMap = new Map<string, CohortSubjectEntry>();

      // 1. Master scheduled periods for this cohort
      const matchedMasterPeriods = (data?.masterScheduledPeriods || []).filter((m) => {
        const secL = cleanSectionCode(m.sectionName) || "Unassigned";
        const bCode = (m.branchCode && m.branchCode.trim()) ? m.branchCode.trim() : getBranchBadge(m.branchId, m.branchCode);
        const bBatch = (m.batch && m.batch.trim() && m.batch !== "Regular") ? m.batch.trim() : (selectedBatch || "Regular");
        const secMatch = meta.sectionLetter === "Unassigned" || secL === meta.sectionLetter;
        const branchMatch = !bCode || bCode === meta.branchCode;
        const batchMatch = !bBatch || bBatch.toLowerCase().replace(/^batch\s*/i, "") === meta.batch.toLowerCase().replace(/^batch\s*/i, "");
        return secMatch && branchMatch && batchMatch;
      });

      for (const m of matchedMasterPeriods) {
        const code = (m.subjectCode || m.customLabel || "SPECIAL").trim();
        if (!code) continue;
        if (!cSubMap.has(code)) {
          cSubMap.set(code, {
            subjectCode: code,
            subjectName: m.subjectName || m.customLabel || code,
            masterWeeklyPeriods: 0,
            totalScheduled: 0,
            totalConducted: 0,
            timesChanged: 0,
            timesSwappedOut: 0,
            timesSwappedIn: 0,
            assignedFaculty: new Set(),
            changedFaculty: new Map(),
            totalPresent: 0,
            totalMarked: 0,
          });
        }
        const sEntry = cSubMap.get(code)!;
        sEntry.masterWeeklyPeriods++;
        if (m.facultyName && m.facultyName.trim() && m.facultyName !== "None" && m.facultyName !== "Faculty Assigned") {
          sEntry.assignedFaculty.add(m.facultyName.trim());
        }
      }

      // 2. Timetable comparison sessions for this cohort
      for (const c of items) {
        const masterCode = c.masterSubjectCode?.trim() || "";
        const todayCode = c.todaySubjectCode?.trim() || masterCode;
        const isSwap = c.varianceType === "SUBJECT_SWAP" || c.varianceType === "BOTH";
        const isSub = c.varianceType === "FACULTY_SUBSTITUTE" || c.varianceType === "BOTH";

        const primaryCode = masterCode || todayCode;
        if (primaryCode) {
          if (!cSubMap.has(primaryCode)) {
            cSubMap.set(primaryCode, {
              subjectCode: primaryCode,
              subjectName: c.masterSubjectName || c.todaySubjectName || primaryCode,
              masterWeeklyPeriods: 0,
              totalScheduled: 0,
              totalConducted: 0,
              timesChanged: 0,
              timesSwappedOut: 0,
              timesSwappedIn: 0,
              assignedFaculty: new Set(),
              changedFaculty: new Map(),
              totalPresent: 0,
              totalMarked: 0,
            });
          }
          const pEntry = cSubMap.get(primaryCode)!;
          pEntry.totalScheduled++;
          if (c.masterFacultyName?.trim() && c.masterFacultyName !== "None" && c.masterFacultyName !== "Faculty Assigned") {
            pEntry.assignedFaculty.add(c.masterFacultyName.trim());
          }
        }

        const conductedCode = todayCode || masterCode;
        if (conductedCode) {
          if (!cSubMap.has(conductedCode)) {
            cSubMap.set(conductedCode, {
              subjectCode: conductedCode,
              subjectName: c.todaySubjectName || c.masterSubjectName || conductedCode,
              masterWeeklyPeriods: 0,
              totalScheduled: 0,
              totalConducted: 0,
              timesChanged: 0,
              timesSwappedOut: 0,
              timesSwappedIn: 0,
              assignedFaculty: new Set(),
              changedFaculty: new Map(),
              totalPresent: 0,
              totalMarked: 0,
            });
          }
          const cEntry = cSubMap.get(conductedCode)!;
          if (c.isConducted) {
            cEntry.totalConducted++;
            if (c.presentCount != null) cEntry.totalPresent += c.presentCount;
            if (c.presentCount != null || c.absentCount != null) {
              cEntry.totalMarked += (c.presentCount || 0) + (c.absentCount || 0);
            }
          }
        }

        // Swaps
        if (isSwap && masterCode && todayCode && masterCode !== todayCode) {
          if (cSubMap.has(masterCode)) {
            const mE = cSubMap.get(masterCode)!;
            mE.timesSwappedOut++;
            mE.timesChanged++;
          }
          if (cSubMap.has(todayCode)) {
            const tE = cSubMap.get(todayCode)!;
            tE.timesSwappedIn++;
            tE.timesChanged++;
          }
        }

        // Faculty Substitutions
        const facChanged =
          isSub ||
          Boolean(
            c.todayFacultyName &&
            c.masterFacultyName &&
            c.todayFacultyName.trim().toLowerCase() !== c.masterFacultyName.trim().toLowerCase()
          );

        if (facChanged && c.todayFacultyName) {
          const targetCodes = new Set<string>();
          if (masterCode) targetCodes.add(masterCode);
          if (todayCode) targetCodes.add(todayCode);

          for (const tc of targetCodes) {
            if (cSubMap.has(tc)) {
              const entry = cSubMap.get(tc)!;
              entry.timesChanged++;
              const tFac = c.todayFacultyName.trim();
              const mFac = c.masterFacultyName?.trim() || undefined;
              const k = `${tFac}__${mFac || ""}`;
              if (!entry.changedFaculty.has(k)) {
                entry.changedFaculty.set(k, { facultyName: tFac, originalFacultyName: mFac, count: 1 });
              } else {
                entry.changedFaculty.get(k)!.count++;
              }
            }
          }
        }
      }

      const cohortSubjects = Array.from(cSubMap.values()).map((sub) => {
        const turnoutPct =
          sub.totalMarked > 0
            ? Math.round((sub.totalPresent / sub.totalMarked) * 100)
            : (sub.totalConducted > 0 ? 100 : null);

        const effectiveAttendancePct =
          sub.totalConducted > 0 && sub.totalScheduled > 0 && turnoutPct != null
            ? (dateMode === "range" && sub.totalScheduled > sub.totalConducted
                ? Math.round((sub.totalConducted / sub.totalScheduled) * turnoutPct)
                : turnoutPct)
            : (sub.totalConducted > 0 && turnoutPct != null ? turnoutPct : null);

        return {
          subjectCode: sub.subjectCode,
          subjectName: sub.subjectName,
          masterWeeklyPeriods: sub.masterWeeklyPeriods,
          totalScheduled: sub.totalScheduled,
          totalConducted: sub.totalConducted,
          timesChanged: sub.timesChanged,
          timesSwappedOut: sub.timesSwappedOut,
          timesSwappedIn: sub.timesSwappedIn,
          assignedFaculty: Array.from(sub.assignedFaculty),
          changedFaculty: Array.from(sub.changedFaculty.values()),
          turnoutPct,
          effectiveAttendancePct,
        };
      }).sort((a, b) => b.totalConducted - a.totalConducted || b.masterWeeklyPeriods - a.masterWeeklyPeriods);

      return {
        sectionKey: key,
        cohortKey: key,
        branchCode: meta.branchCode,
        branchId: meta.branchId,
        batch: meta.batch,
        sectionLetter: meta.sectionLetter,
        sectionTitle: secTitle,
        items,
        totalClasses: items.length,
        conductedCount,
        substitutedCount,
        swappedCount,
        unchangedCount,
        cohortSubjects,
      };
    });
  }, [filteredComparisons, getBranchBadge, selectedBatch, data?.masterScheduledPeriods, dateMode]);

  // Drill-down data sets for KPI Analytics Drawer
  const changedItems = useMemo(() => {
    const list: Array<{
      id: string;
      date: string;
      slotLabel: string;
      slotTime: string;
      branchCode?: string;
      branchName?: string;
      batch: string;
      sectionName: string | null;
      masterSubjectName: string;
      masterSubjectCode: string;
      masterFacultyName: string;
      masterFacultyHrmsId?: string | null;
      newSubjectName: string;
      newSubjectCode: string;
      newFacultyName: string;
      newFacultyHrmsId?: string | null;
      varianceType: string;
      remarks: string | null;
      changedByName?: string | null;
    }> = [];

    const seenKeys = new Set<string>();

    // 1. Authoritative change events from data.recentChanges
    (data?.recentChanges || []).forEach((c) => {
      const secCode = cleanSectionCode(c.sectionName);
      if (selectedSection && secCode && secCode !== cleanSectionCode(selectedSection)) {
        return;
      }
      const slotClean = (c.slotLabel || "").toUpperCase().replace(/\s+/g, "");
      const timeClean = (c.slotTime || "").trim();
      const bClean = (c.batch || "").trim().toLowerCase().replace(/^batch\s*/i, "");

      seenKeys.add(`${c.timetableDate}_${bClean}_${secCode}_${slotClean}`);
      if (timeClean) {
        seenKeys.add(`${c.timetableDate}_${bClean}_${secCode}_${timeClean}`);
      }

      list.push({
        id: `change-${c.id}`,
        date: c.timetableDate,
        slotLabel: c.slotLabel,
        slotTime: c.slotTime,
        branchCode: c.branchCode,
        branchName: c.branchName,
        batch: c.batch,
        sectionName: c.sectionName,
        masterSubjectName: c.masterSubjectName || "Scheduled Subject",
        masterSubjectCode: c.masterSubjectCode || "",
        masterFacultyName: c.masterFacultyName || "Scheduled Faculty",
        masterFacultyHrmsId: c.masterFacultyHrmsId,
        newSubjectName: c.newSubjectName || c.masterSubjectName || "Current Subject",
        newSubjectCode: c.newSubjectCode || c.masterSubjectCode || "",
        newFacultyName: c.newFacultyName || c.masterFacultyName || "Current Faculty",
        newFacultyHrmsId: c.newFacultyHrmsId,
        varianceType: c.varianceType,
        remarks: c.remarks,
        changedByName: c.changedByName,
      });
    });

    // 2. Only add from comparisons if this session was NOT already in recentChanges
    (data?.comparisons || []).forEach((c) => {
      if (c.varianceType !== "UNCHANGED") {
        const secCode = cleanSectionCode(c.sectionName);
        if (selectedSection && secCode && secCode !== cleanSectionCode(selectedSection)) {
          return;
        }
        const slotClean = (c.slotLabel || "").toUpperCase().replace(/\s+/g, "");
        const timeClean = (c.time || "").trim();
        const bClean = (c.batch || "").trim().toLowerCase().replace(/^batch\s*/i, "");

        const keyBySlot = `${c.date}_${bClean}_${secCode}_${slotClean}`;
        const keyByTime = `${c.date}_${bClean}_${secCode}_${timeClean}`;

        // Prevent duplicate if already captured from recentChanges
        const alreadyInList =
          seenKeys.has(keyBySlot) ||
          (timeClean ? seenKeys.has(keyByTime) : false) ||
          list.some(
            (item) =>
              item.date === c.date &&
              (item.batch || "").trim().toLowerCase().replace(/^batch\s*/i, "") === bClean &&
              cleanSectionCode(item.sectionName) === secCode &&
              ((slotClean && (item.slotLabel || "").toUpperCase().replace(/\s+/g, "") === slotClean) ||
                (timeClean && (item.slotTime || "").trim() === timeClean) ||
                (item.newSubjectCode && c.todaySubjectCode && item.newSubjectCode === c.todaySubjectCode)),
          );

        if (!alreadyInList) {
          seenKeys.add(keyBySlot);
          if (timeClean) seenKeys.add(keyByTime);
          list.push({
            id: `comp-${c.id}`,
            date: c.date,
            slotLabel: c.slotLabel,
            slotTime: c.time,
            branchCode: c.branchCode,
            branchName: c.branchName,
            batch: c.batch,
            sectionName: c.sectionName,
            masterSubjectName: c.masterSubjectName || "Scheduled Subject",
            masterSubjectCode: c.masterSubjectCode || "",
            masterFacultyName: c.masterFacultyName || "Scheduled Faculty",
            masterFacultyHrmsId: c.masterFacultyHrmsId,
            newSubjectName: c.todaySubjectName || c.masterSubjectName || "Current Subject",
            newSubjectCode: c.todaySubjectCode || c.masterSubjectCode || "",
            newFacultyName: c.todayFacultyName || c.masterFacultyName || "Current Faculty",
            newFacultyHrmsId: c.todayFacultyHrmsId,
            varianceType: c.varianceType,
            remarks: "Session altered from master schedule",
            changedByName: "Timetable Coordinator",
          });
        }
      }
    });

    return list;
  }, [data?.recentChanges, data?.comparisons, selectedSection]);

  // Specific Faculty Substitutions (Who was changed & Who took over)
  const substitutedItems = useMemo(() => {
    return changedItems.filter((c) => {
      return (
        c.varianceType === "FACULTY_SUBSTITUTE" ||
        c.varianceType === "BOTH" ||
        (c.masterFacultyName && c.newFacultyName && c.masterFacultyName.trim().toLowerCase() !== c.newFacultyName.trim().toLowerCase()) ||
        (c.masterFacultyHrmsId && c.newFacultyHrmsId && c.masterFacultyHrmsId !== c.newFacultyHrmsId)
      );
    });
  }, [changedItems]);

  // Specific Subject Swaps
  const swappedItems = useMemo(() => {
    return changedItems.filter((c) => {
      return (
        c.varianceType === "SUBJECT_SWAP" ||
        c.varianceType === "BOTH" ||
        (c.masterSubjectCode && c.newSubjectCode && c.masterSubjectCode.trim() !== c.newSubjectCode.trim()) ||
        (c.masterSubjectName && c.newSubjectName && c.masterSubjectName.trim().toLowerCase() !== c.newSubjectName.trim().toLowerCase())
      );
    });
  }, [changedItems]);

  // Conducted Classes (De-duplicated)
  const conductedItems = useMemo(() => {
    const list: NonNullable<typeof data>["comparisons"] = [];
    const seen = new Set<string>();
    (data?.comparisons || []).forEach((c) => {
      if (c.isConducted) {
        const secCode = cleanSectionCode(c.sectionName);
        if (selectedSection && secCode && secCode !== cleanSectionCode(selectedSection)) {
          return;
        }
        const key = `${c.date}_${c.slotLabel}_${c.batch}_${secCode}`;
        if (!seen.has(key)) {
          seen.add(key);
          list.push(c);
        }
      }
    });
    return list;
  }, [data?.comparisons, selectedSection]);

  // Master scheduled classes for today / date range (strictly excluding breaks)
  const masterScheduledList = useMemo(() => {
    let list = data?.masterScheduledPeriods ?? [];
    if (selectedSection) {
      const secCode = cleanSectionCode(selectedSection);
      list = list.filter((item) => cleanSectionCode(item.sectionName) === secCode);
    }
    return list;
  }, [data?.masterScheduledPeriods, selectedSection]);

  const filteredDrawerMasterScheduled = useMemo(() => {
    if (!drawerSearch.trim()) return masterScheduledList;
    const q = drawerSearch.toLowerCase();
    return masterScheduledList.filter(
      (m) =>
        m.subjectName.toLowerCase().includes(q) ||
        m.subjectCode.toLowerCase().includes(q) ||
        m.facultyName.toLowerCase().includes(q) ||
        m.slotLabel.toLowerCase().includes(q) ||
        (m.branchCode || "").toLowerCase().includes(q) ||
        (m.branchName || "").toLowerCase().includes(q) ||
        (m.sectionName || "").toLowerCase().includes(q),
    );
  }, [masterScheduledList, drawerSearch]);

  // Master subjects quota (De-duplicated)
  const masterSubjectItems = useMemo(() => {
    const map = new Map<string, NonNullable<typeof data>["subjects"][0]>();
    (data?.subjects || []).forEach((s) => {
      if (s.masterWeeklyPeriods > 0 && !map.has(s.subjectCode)) {
        map.set(s.subjectCode, s);
      }
    });
    return Array.from(map.values());
  }, [data?.subjects]);

  // Drawer Search Filtered Results
  const filteredDrawerSubstitutions = useMemo(() => {
    if (!drawerSearch.trim()) return substitutedItems;
    const q = drawerSearch.toLowerCase();
    return substitutedItems.filter(
      (s) =>
        s.masterFacultyName.toLowerCase().includes(q) ||
        s.newFacultyName.toLowerCase().includes(q) ||
        s.masterSubjectName.toLowerCase().includes(q) ||
        s.newSubjectName.toLowerCase().includes(q) ||
        s.slotLabel.toLowerCase().includes(q) ||
        s.date.includes(q) ||
        (s.sectionName || "").toLowerCase().includes(q) ||
        (s.remarks || "").toLowerCase().includes(q),
    );
  }, [substitutedItems, drawerSearch]);

  const filteredDrawerChanges = useMemo(() => {
    if (!drawerSearch.trim()) return changedItems;
    const q = drawerSearch.toLowerCase();
    return changedItems.filter(
      (c) =>
        c.masterSubjectName.toLowerCase().includes(q) ||
        c.newSubjectName.toLowerCase().includes(q) ||
        c.masterFacultyName.toLowerCase().includes(q) ||
        c.newFacultyName.toLowerCase().includes(q) ||
        c.slotLabel.toLowerCase().includes(q) ||
        c.date.includes(q) ||
        (c.sectionName || "").toLowerCase().includes(q) ||
        (c.remarks || "").toLowerCase().includes(q),
    );
  }, [changedItems, drawerSearch]);

  const filteredDrawerSwaps = useMemo(() => {
    if (!drawerSearch.trim()) return swappedItems;
    const q = drawerSearch.toLowerCase();
    return swappedItems.filter(
      (s) =>
        s.masterSubjectName.toLowerCase().includes(q) ||
        s.newSubjectName.toLowerCase().includes(q) ||
        s.newFacultyName.toLowerCase().includes(q) ||
        s.slotLabel.toLowerCase().includes(q) ||
        s.date.includes(q) ||
        (s.sectionName || "").toLowerCase().includes(q) ||
        (s.remarks || "").toLowerCase().includes(q),
    );
  }, [swappedItems, drawerSearch]);

  const filteredDrawerConducted = useMemo(() => {
    const list = conductedItems;
    if (!drawerSearch.trim()) return list;
    const q = drawerSearch.toLowerCase();
    return list.filter(
      (c) =>
        (c.todaySubjectName || "").toLowerCase().includes(q) ||
        (c.todayFacultyName || "").toLowerCase().includes(q) ||
        c.slotLabel.toLowerCase().includes(q) ||
        c.date.includes(q) ||
        (c.sectionName || "").toLowerCase().includes(q),
    );
  }, [conductedItems, drawerSearch]);

  const filteredDrawerMaster = useMemo(() => {
    const list = masterSubjectItems;
    if (!drawerSearch.trim()) return list;
    const q = drawerSearch.toLowerCase();
    return list.filter(
      (s) =>
        s.subjectName.toLowerCase().includes(q) ||
        s.subjectCode.toLowerCase().includes(q) ||
        s.facultyNames.some((f) => f.toLowerCase().includes(q)),
    );
  }, [masterSubjectItems, drawerSearch]);

  // Handler to open Staff Profile & Action Modal
  const openStaffModalByName = useCallback((facultyName: string, hrmsId?: string | null) => {
    if (!facultyName) return;
    const cleanName = facultyName.trim().toLowerCase();
    const cleanHrms = (hrmsId || "").trim();

    const existing = (data?.faculties || []).find((f) => {
      if (cleanHrms && f.hrmsId === cleanHrms) return true;
      return f.facultyName.trim().toLowerCase() === cleanName;
    });

    if (existing) {
      setActiveStaffModal(existing);
      setStaffModalSearch("");
      return;
    }

    const catalog = (data?.catalogFaculties || []).find((cf) => {
      if (cleanHrms && cf.hrmsId === cleanHrms) return true;
      return cf.facultyName.trim().toLowerCase() === cleanName;
    });

    let masterQuota = 0;
    let conducted = 0;
    let relieved = 0;
    let subTaken = 0;
    const subjects = new Set<string>();

    (data?.comparisons || []).forEach((c) => {
      const isToday =
        (cleanHrms && c.todayFacultyHrmsId === cleanHrms) ||
        (c.todayFacultyName && c.todayFacultyName.trim().toLowerCase() === cleanName);
      const isMaster =
        (cleanHrms && c.masterFacultyHrmsId === cleanHrms) ||
        (c.masterFacultyName && c.masterFacultyName.trim().toLowerCase() === cleanName);

      if (isMaster) {
        masterQuota++;
        if (c.masterSubjectName) subjects.add(c.masterSubjectName);
      }
      if (isToday && c.isConducted) conducted++;
      if (isMaster && !isToday && c.todayFacultyName) relieved++;
      if (isToday && !isMaster && c.masterFacultyName) subTaken++;
    });

    setActiveStaffModal({
      hrmsId: catalog?.hrmsId || cleanHrms || "N/A",
      facultyName: catalog?.facultyName || facultyName,
      masterAssignedPeriods: masterQuota,
      classesConducted: conducted,
      relievedCount: relieved,
      substituteTakenCount: subTaken,
      netTeachingCount: conducted + subTaken - relieved,
      subjects: Array.from(subjects),
    });
    setStaffModalSearch("");
  }, [data]);

  // Handler to open Subject Detail & Delivery Action Modal
  const openSubjectModal = useCallback((
    sub: {
      subjectCode: string;
      subjectName: string;
      masterWeeklyPeriods: number;
      totalScheduled?: number;
      totalConducted: number;
      timesChanged: number;
      timesSwappedOut: number;
      timesSwappedIn: number;
      facultyNames?: string[];
      assignedFaculty?: string[];
      changedFaculty?: Array<{ facultyName: string; originalFacultyName?: string; count: number }>;
      turnoutPct?: number | null;
      attendancePct?: number;
      effectiveAttendancePct?: number | null;
    },
    cohortMeta?: {
      cohortTitle?: string;
      branchCode?: string;
      batch?: string;
      sectionLetter?: string;
    }
  ) => {
    setActiveSubjectModal({
      subjectCode: sub.subjectCode,
      subjectName: sub.subjectName,
      masterWeeklyPeriods: sub.masterWeeklyPeriods,
      totalScheduled: sub.totalScheduled,
      totalConducted: sub.totalConducted,
      timesChanged: sub.timesChanged,
      timesSwappedOut: sub.timesSwappedOut,
      timesSwappedIn: sub.timesSwappedIn,
      facultyNames: sub.facultyNames ?? sub.assignedFaculty ?? [],
      attendancePct: sub.attendancePct ?? sub.turnoutPct ?? 0,
      assignedFacultyNames: sub.assignedFaculty,
      changedFaculties: sub.changedFaculty,
      turnoutPct: sub.turnoutPct,
      cohortTitle: cohortMeta?.cohortTitle,
      branchCode: cohortMeta?.branchCode,
      batch: cohortMeta?.batch,
      sectionLetter: cohortMeta?.sectionLetter,
    });
    setSubjectModalSearch("");
  }, []);

  // Download HTML-based Excel Spreadsheet (.xls)
  const downloadExcelFile = useCallback((htmlTableContent: string, filename: string) => {
    const excelHtml = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Report</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:Worksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
        <meta http-equiv="content-type" content="text/html; charset=UTF-8"/>
        <style>
          body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #0f172a; }
          table { border-collapse: collapse; margin-bottom: 24px; width: 100%; }
          th { background-color: #0f172a; color: #ffffff; font-weight: bold; border: 1px solid #64748b; padding: 7px 10px; text-align: left; }
          td { border: 1px solid #cbd5e1; padding: 6px 9px; vertical-align: top; }
          .title-h1 { font-size: 16pt; font-weight: bold; color: #0f172a; }
          .meta-p { font-size: 10pt; color: #475569; }
          .section-h2 { font-size: 13pt; font-weight: bold; background-color: #f1f5f9; color: #0f172a; border-bottom: 2px solid #0f172a; padding: 6px; }
          .kpi-th { background-color: #1e293b; color: #ffffff; font-weight: bold; }
          .kpi-val { font-size: 12pt; font-weight: bold; }
          .highlight-sky { background-color: #e0f2fe; color: #0369a1; font-weight: bold; }
          .highlight-rose { background-color: #ffe4e6; color: #be123c; font-weight: bold; }
          .highlight-emerald { background-color: #dcfce7; color: #15803d; font-weight: bold; }
          .highlight-amber { background-color: #fef3c7; color: #92400e; font-weight: bold; }
        </style>
      </head>
      <body>
        ${htmlTableContent}
      </body>
      </html>
    `;
    const blob = new Blob([excelHtml], { type: "application/vnd.ms-excel;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename.endsWith(".xls") ? filename : `${filename}.xls`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, []);

  // Export Subject Modal to PDF (Abstract first, then Date-wise Delivery Log)
  const exportSubjectModalPdf = useCallback(() => {
    if (!activeSubjectModal) return;
    const sub = activeSubjectModal;
    const dateRangeLabel =
      dateMode === "range"
        ? `${startDate ? formatDisplayDate(startDate) : "Start"} to ${endDate ? formatDisplayDate(endDate) : "End"}`
        : formatDisplayDate(getTodayDateString());

    const assignedStr =
      (sub.assignedFacultyNames ?? sub.facultyNames ?? []).join(", ") || "Not Assigned";
    const changedStr =
      (sub.changedFaculties ?? [])
        .map((cf) => `${cf.facultyName}${cf.originalFacultyName ? ` (sub for ${cf.originalFacultyName})` : ""} (${cf.count}x)`)
        .join("; ") || "100% Fidelity (No Alterations)";

    const effectiveTurnout =
      sub.attendancePct != null && sub.attendancePct > 0
        ? `${sub.attendancePct}%`
        : sub.turnoutPct != null
          ? `${sub.turnoutPct}%`
          : "—";

    const dateMap = new Map<string, typeof modalSubjectSessions>();
    modalSubjectSessions.forEach((s) => {
      const d = s.date || "Scheduled Plan";
      if (!dateMap.has(d)) dateMap.set(d, []);
      dateMap.get(d)!.push(s);
    });
    const sortedDates = Array.from(dateMap.keys()).sort();

    let dateTablesHtml = "";
    if (sortedDates.length === 0) {
      dateTablesHtml = `<p style="color: #64748b; font-size: 11px; padding: 12px 0;">No timetable sessions recorded for this subject in the selected range.</p>`;
    } else {
      sortedDates.forEach((d) => {
        const sessions = dateMap.get(d)!;
        const dayName = sessions[0]?.dayOfWeek || "";
        dateTablesHtml += `
          <div style="margin-top: 14px; break-inside: avoid;">
            <div style="background-color: #f1f5f9; padding: 5px 8px; font-weight: bold; font-size: 11px; border: 1px solid #cbd5e1; border-bottom: none;">
              📅 Date: ${d} ${dayName ? `(${dayName})` : ""} &bull; ${sessions.length} Session(s)
            </div>
            <table style="width: 100%; border-collapse: collapse; font-size: 10px; margin-bottom: 8px;">
              <thead>
                <tr style="background-color: #334155; color: white;">
                  <th style="padding: 5px; border: 1px solid #94a3b8; text-align: left;">Slot & Time</th>
                  <th style="padding: 5px; border: 1px solid #94a3b8; text-align: left;">Class & Section</th>
                  <th style="padding: 5px; border: 1px solid #94a3b8; text-align: left;">Master Assigned Faculty</th>
                  <th style="padding: 5px; border: 1px solid #94a3b8; text-align: left;">Actual Conducted Faculty</th>
                  <th style="padding: 5px; border: 1px solid #94a3b8; text-align: left;">Action Role / Status</th>
                  <th style="padding: 5px; border: 1px solid #94a3b8; text-align: center;">Conducted</th>
                  <th style="padding: 5px; border: 1px solid #94a3b8; text-align: center;">Turnout</th>
                </tr>
              </thead>
              <tbody>
                ${sessions
                  .map(
                    (s) => `
                  <tr>
                    <td style="padding: 5px; border: 1px solid #cbd5e1;">${s.slotLabel} (${s.time})</td>
                    <td style="padding: 5px; border: 1px solid #cbd5e1;">${s.sectionName ? `Sec ${cleanSectionCode(s.sectionName)}` : "All"} &bull; Batch ${s.batch}</td>
                    <td style="padding: 5px; border: 1px solid #cbd5e1;">${escapeHtml(s.masterFacultyName || "—")}</td>
                    <td style="padding: 5px; border: 1px solid #cbd5e1; font-weight: ${s.isSub ? "bold" : "normal"}; color: ${s.isSub ? "#b45309" : "#0f172a"};">
                      ${escapeHtml(s.todayFacultyName || "—")}
                    </td>
                    <td style="padding: 5px; border: 1px solid #cbd5e1;">${escapeHtml(s.actionTitle)}</td>
                    <td style="padding: 5px; border: 1px solid #cbd5e1; text-align: center;">${s.isConducted ? "Yes ✓" : "Scheduled"}</td>
                    <td style="padding: 5px; border: 1px solid #cbd5e1; text-align: center; font-weight: bold;">${s.attendancePct != null ? `${s.attendancePct}%` : "Pending"}</td>
                  </tr>
                `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        `;
      });
    }

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; color: #0f172a; padding: 10px;">
        <div style="border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin-bottom: 12px;">
          <h2 style="margin: 0; font-size: 18px; color: #0f172a;">Subject Delivery & Timetable Alteration Report</h2>
          <p style="margin: 4px 0 0; font-size: 11px; color: #475569;">
            <strong>Subject:</strong> ${escapeHtml(sub.subjectName)} (${escapeHtml(sub.subjectCode)}) &bull; 
            ${sub.cohortTitle ? `<strong>Cohort:</strong> ${escapeHtml(sub.cohortTitle)} &bull; ` : ""}
            <strong>Period:</strong> ${escapeHtml(dateRangeLabel)} &bull; 
            <strong>Academic Year:</strong> ${escapeHtml(academicYear || "Current")}
          </p>
        </div>

        <!-- 1. Executive Abstract -->
        <div style="margin-bottom: 14px; break-inside: avoid;">
          <h3 style="font-size: 12px; text-transform: uppercase; margin: 0 0 6px; color: #0f172a; border-bottom: 1px solid #cbd5e1; padding-bottom: 3px;">
            1. Executive Abstract & Workload Metrics
          </h3>
          <table style="width: 100%; border-collapse: collapse; font-size: 10px; margin-bottom: 8px;">
            <thead>
              <tr style="background-color: #0f172a; color: white;">
                <th style="padding: 6px; border: 1px solid #64748b;">Master Quota</th>
                <th style="padding: 6px; border: 1px solid #64748b;">Conducted</th>
                <th style="padding: 6px; border: 1px solid #64748b;">Swapped Out</th>
                <th style="padding: 6px; border: 1px solid #64748b;">Swapped In</th>
                <th style="padding: 6px; border: 1px solid #64748b;">Total Changes</th>
                <th style="padding: 6px; border: 1px solid #64748b;">Attendance Rate</th>
              </tr>
            </thead>
            <tbody>
              <tr style="text-align: center; font-weight: bold; background-color: #f8fafc;">
                <td style="padding: 8px; border: 1px solid #cbd5e1; font-size: 13px;">${sub.masterWeeklyPeriods} p/wk</td>
                <td style="padding: 8px; border: 1px solid #cbd5e1; font-size: 13px; color: #15803d;">${sub.totalConducted} held</td>
                <td style="padding: 8px; border: 1px solid #cbd5e1; font-size: 13px; color: #be123c;">${sub.timesSwappedOut}</td>
                <td style="padding: 8px; border: 1px solid #cbd5e1; font-size: 13px; color: #15803d;">${sub.timesSwappedIn}</td>
                <td style="padding: 8px; border: 1px solid #cbd5e1; font-size: 13px; color: #b45309;">${sub.timesChanged}</td>
                <td style="padding: 8px; border: 1px solid #cbd5e1; font-size: 13px; color: #1e40af;">${effectiveTurnout}</td>
              </tr>
            </tbody>
          </table>

          <table style="width: 100%; border-collapse: collapse; font-size: 10px;">
            <tr>
              <td style="width: 25%; font-weight: bold; padding: 5px; border: 1px solid #cbd5e1; background-color: #f1f5f9;">Assigned Master Faculty:</td>
              <td style="padding: 5px; border: 1px solid #cbd5e1;">${escapeHtml(assignedStr)}</td>
            </tr>
            <tr>
              <td style="width: 25%; font-weight: bold; padding: 5px; border: 1px solid #cbd5e1; background-color: #f1f5f9;">Substitute & Reliever Faculty:</td>
              <td style="padding: 5px; border: 1px solid #cbd5e1;">${escapeHtml(changedStr)}</td>
            </tr>
          </table>
        </div>

        <!-- 2. Date-wise Data Breakdown -->
        <div>
          <h3 style="font-size: 12px; text-transform: uppercase; margin: 12px 0 4px; color: #0f172a; border-bottom: 1px solid #cbd5e1; padding-bottom: 3px;">
            2. Date-wise Timetable Delivery & Alteration Sessions (${dateRangeLabel})
          </h3>
          ${dateTablesHtml}
        </div>
      </div>
    `;

    printHtml(htmlContent, {
      title: `Subject_Report_${sub.subjectCode}_${dateMode === "range" ? `${startDate}_to_${endDate}` : getTodayDateString()}`,
      subtitle: `Curriculum delivery report for ${sub.subjectName} (${sub.subjectCode})`,
    });
  }, [activeSubjectModal, dateMode, startDate, endDate, academicYear, modalSubjectSessions]);

  // Export Subject Modal to Excel (Abstract first, then Date-wise Delivery Log)
  const exportSubjectModalExcel = useCallback(() => {
    if (!activeSubjectModal) return;
    const sub = activeSubjectModal;
    const dateRangeLabel =
      dateMode === "range"
        ? `${startDate || "Start"} to ${endDate || "End"}`
        : getTodayDateString();

    const assignedStr =
      (sub.assignedFacultyNames ?? sub.facultyNames ?? []).join("; ") || "Not Assigned";
    const changedStr =
      (sub.changedFaculties ?? [])
        .map((cf) => `${cf.facultyName}${cf.originalFacultyName ? ` (sub for ${cf.originalFacultyName})` : ""} (${cf.count}x)`)
        .join("; ") || "None";

    const effectiveTurnout =
      sub.attendancePct != null && sub.attendancePct > 0
        ? `${sub.attendancePct}%`
        : sub.turnoutPct != null
          ? `${sub.turnoutPct}%`
          : "—";

    const dateMap = new Map<string, typeof modalSubjectSessions>();
    modalSubjectSessions.forEach((s) => {
      const d = s.date || "Scheduled";
      if (!dateMap.has(d)) dateMap.set(d, []);
      dateMap.get(d)!.push(s);
    });
    const sortedDates = Array.from(dateMap.keys()).sort();

    let sessionRowsHtml = "";
    sortedDates.forEach((d) => {
      const sessions = dateMap.get(d)!;
      sessions.forEach((s) => {
        sessionRowsHtml += `
          <tr>
            <td>${escapeHtml(s.date)}</td>
            <td>${escapeHtml(s.dayOfWeek || "")}</td>
            <td>${escapeHtml(s.slotLabel)}</td>
            <td>${escapeHtml(s.time)}</td>
            <td>${escapeHtml(s.sectionName ? `Sec ${cleanSectionCode(s.sectionName)}` : "All")}</td>
            <td>${escapeHtml(s.batch)}</td>
            <td>${escapeHtml(s.masterFacultyName || "—")}</td>
            <td>${escapeHtml(s.todayFacultyName || "—")}</td>
            <td>${escapeHtml(s.actionTitle)}</td>
            <td>${s.isConducted ? "Conducted" : "Scheduled"}</td>
            <td>${s.attendancePct != null ? `${s.attendancePct}%` : "Pending"}</td>
          </tr>
        `;
      });
    });

    const excelHtml = `
      <table>
        <tr>
          <td colspan="11" class="title-h1">ACADEMIC PORTAL &bull; SUBJECT ANALYSIS REPORT</td>
        </tr>
        <tr>
          <td colspan="11" class="meta-p">
            Subject: <b>${escapeHtml(sub.subjectName)} (${escapeHtml(sub.subjectCode)})</b> | 
            Cohort: <b>${escapeHtml(sub.cohortTitle || "All Sections")}</b> | 
            Period: <b>${escapeHtml(dateRangeLabel)}</b> | 
            Academic Year: <b>${escapeHtml(academicYear || "Current")}</b>
          </td>
        </tr>
      </table>

      <!-- 1. EXECUTIVE ABSTRACT -->
      <table>
        <tr>
          <th colspan="7" class="section-h2">1. EXECUTIVE ABSTRACT</th>
        </tr>
        <tr>
          <th class="kpi-th">Master Quota (p/wk)</th>
          <th class="kpi-th">Conducted Sessions</th>
          <th class="kpi-th">Swapped Out</th>
          <th class="kpi-th">Swapped In</th>
          <th class="kpi-th">Total Alterations</th>
          <th class="kpi-th">Attendance Rate</th>
          <th class="kpi-th">Turnout Status</th>
        </tr>
        <tr>
          <td class="kpi-val">${sub.masterWeeklyPeriods}</td>
          <td class="kpi-val highlight-emerald">${sub.totalConducted}</td>
          <td class="kpi-val highlight-rose">${sub.timesSwappedOut}</td>
          <td class="kpi-val highlight-emerald">${sub.timesSwappedIn}</td>
          <td class="kpi-val highlight-amber">${sub.timesChanged}</td>
          <td class="kpi-val highlight-sky">${effectiveTurnout}</td>
          <td>${sub.totalConducted > 0 ? "Turnout Recorded" : "Pending"}</td>
        </tr>
        <tr>
          <td colspan="2"><b>Assigned Master Faculty:</b></td>
          <td colspan="5">${escapeHtml(assignedStr)}</td>
        </tr>
        <tr>
          <td colspan="2"><b>Substitute / Reliever Faculty:</b></td>
          <td colspan="5">${escapeHtml(changedStr)}</td>
        </tr>
      </table>

      <!-- 2. DATE-WISE BREAKDOWN -->
      <table>
        <tr>
          <th colspan="11" class="section-h2">2. DATE-WISE TIMETABLE DELIVERY & ACTION LOG</th>
        </tr>
        <tr>
          <th>Date</th>
          <th>Day</th>
          <th>Slot</th>
          <th>Time</th>
          <th>Class & Section</th>
          <th>Batch</th>
          <th>Master Faculty</th>
          <th>Conducted Faculty</th>
          <th>Action Status</th>
          <th>Conducted</th>
          <th>Attendance Turnout</th>
        </tr>
        ${sessionRowsHtml || `<tr><td colspan="11">No delivery sessions found in this date range.</td></tr>`}
      </table>
    `;

    downloadExcelFile(
      excelHtml,
      `Subject_${sub.subjectCode}_${dateMode === "range" ? `${startDate}_to_${endDate}` : getTodayDateString()}.xls`,
    );
  }, [activeSubjectModal, dateMode, startDate, endDate, academicYear, modalSubjectSessions, downloadExcelFile]);

  // Export Staff Modal to PDF (Abstract first, then Date-wise Delivery Log)
  const exportStaffModalPdf = useCallback(() => {
    if (!activeStaffModal) return;
    const f = activeStaffModal;
    const dateRangeLabel =
      dateMode === "range"
        ? `${startDate ? formatDisplayDate(startDate) : "Start"} to ${endDate ? formatDisplayDate(endDate) : "End"}`
        : formatDisplayDate(getTodayDateString());

    const dateMap = new Map<string, typeof modalStaffSessions>();
    modalStaffSessions.forEach((s) => {
      const d = s.date || "Scheduled Plan";
      if (!dateMap.has(d)) dateMap.set(d, []);
      dateMap.get(d)!.push(s);
    });
    const sortedDates = Array.from(dateMap.keys()).sort();

    let dateTablesHtml = "";
    if (sortedDates.length === 0) {
      dateTablesHtml = `<p style="color: #64748b; font-size: 11px; padding: 12px 0;">No timetable sessions recorded for this faculty member in the selected range.</p>`;
    } else {
      sortedDates.forEach((d) => {
        const sessions = dateMap.get(d)!;
        const dayName = sessions[0]?.dayOfWeek || "";
        dateTablesHtml += `
          <div style="margin-top: 14px; break-inside: avoid;">
            <div style="background-color: #f1f5f9; padding: 5px 8px; font-weight: bold; font-size: 11px; border: 1px solid #cbd5e1; border-bottom: none;">
              📅 Date: ${d} ${dayName ? `(${dayName})` : ""} &bull; ${sessions.length} Session(s)
            </div>
            <table style="width: 100%; border-collapse: collapse; font-size: 10px; margin-bottom: 8px;">
              <thead>
                <tr style="background-color: #334155; color: white;">
                  <th style="padding: 5px; border: 1px solid #94a3b8; text-align: left;">Slot & Time</th>
                  <th style="padding: 5px; border: 1px solid #94a3b8; text-align: left;">Class & Section</th>
                  <th style="padding: 5px; border: 1px solid #94a3b8; text-align: left;">Subject Name & Code</th>
                  <th style="padding: 5px; border: 1px solid #94a3b8; text-align: left;">Action Role Taken</th>
                  <th style="padding: 5px; border: 1px solid #94a3b8; text-align: center;">Conducted</th>
                  <th style="padding: 5px; border: 1px solid #94a3b8; text-align: center;">Turnout</th>
                </tr>
              </thead>
              <tbody>
                ${sessions
                  .map(
                    (s) => `
                  <tr>
                    <td style="padding: 5px; border: 1px solid #cbd5e1;">${s.slotLabel} (${s.time})</td>
                    <td style="padding: 5px; border: 1px solid #cbd5e1;">${s.sectionName ? `Sec ${cleanSectionCode(s.sectionName)}` : "All"} &bull; Batch ${s.batch}</td>
                    <td style="padding: 5px; border: 1px solid #cbd5e1;">
                      <b>${escapeHtml(s.todaySubjectName || s.masterSubjectName || "—")}</b> 
                      <span style="color: #64748b;">(${escapeHtml(s.todaySubjectCode || s.masterSubjectCode || "")})</span>
                    </td>
                    <td style="padding: 5px; border: 1px solid #cbd5e1; font-weight: bold;">${escapeHtml(s.actionTitle)}</td>
                    <td style="padding: 5px; border: 1px solid #cbd5e1; text-align: center;">${s.isConducted ? "Yes ✓" : "Scheduled"}</td>
                    <td style="padding: 5px; border: 1px solid #cbd5e1; text-align: center; font-weight: bold;">${s.attendancePct != null ? `${s.attendancePct}%` : "—"}</td>
                  </tr>
                `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        `;
      });
    }

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; color: #0f172a; padding: 10px;">
        <div style="border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin-bottom: 12px;">
          <h2 style="margin: 0; font-size: 18px; color: #0f172a;">Faculty Workload & Action Audit Report</h2>
          <p style="margin: 4px 0 0; font-size: 11px; color: #475569;">
            <strong>Faculty Name:</strong> ${escapeHtml(f.facultyName)} &bull; 
            <strong>HRMS ID:</strong> #${escapeHtml(f.hrmsId)} &bull; 
            <strong>Period:</strong> ${escapeHtml(dateRangeLabel)} &bull; 
            <strong>Academic Year:</strong> ${escapeHtml(academicYear || "Current")}
          </p>
        </div>

        <!-- 1. Executive Abstract -->
        <div style="margin-bottom: 14px; break-inside: avoid;">
          <h3 style="font-size: 12px; text-transform: uppercase; margin: 0 0 6px; color: #0f172a; border-bottom: 1px solid #cbd5e1; padding-bottom: 3px;">
            1. Executive Abstract & Workload Metrics
          </h3>
          <table style="width: 100%; border-collapse: collapse; font-size: 10px; margin-bottom: 8px;">
            <thead>
              <tr style="background-color: #0f172a; color: white;">
                <th style="padding: 6px; border: 1px solid #64748b;">Master Quota</th>
                <th style="padding: 6px; border: 1px solid #64748b;">Classes Conducted</th>
                <th style="padding: 6px; border: 1px solid #64748b;">Relieved Away (-)</th>
                <th style="padding: 6px; border: 1px solid #64748b;">Substitute Taken (+)</th>
                <th style="padding: 6px; border: 1px solid #64748b;">Net Teaching Load</th>
                <th style="padding: 6px; border: 1px solid #64748b;">Shift Status</th>
              </tr>
            </thead>
            <tbody>
              <tr style="text-align: center; font-weight: bold; background-color: #f8fafc;">
                <td style="padding: 8px; border: 1px solid #cbd5e1; font-size: 13px;">${f.masterAssignedPeriods} p/wk</td>
                <td style="padding: 8px; border: 1px solid #cbd5e1; font-size: 13px; color: #15803d;">${f.classesConducted} held</td>
                <td style="padding: 8px; border: 1px solid #cbd5e1; font-size: 13px; color: #be123c;">${f.relievedCount > 0 ? `-${f.relievedCount}` : 0}</td>
                <td style="padding: 8px; border: 1px solid #cbd5e1; font-size: 13px; color: #0284c7;">${f.substituteTakenCount > 0 ? `+${f.substituteTakenCount}` : 0}</td>
                <td style="padding: 8px; border: 1px solid #cbd5e1; font-size: 13px; color: #0f172a;">${f.netTeachingCount} sessions</td>
                <td style="padding: 8px; border: 1px solid #cbd5e1; font-size: 11px;">
                  ${f.substituteTakenCount - f.relievedCount >= 0 ? "+" : ""}${f.substituteTakenCount - f.relievedCount} variance
                </td>
              </tr>
            </tbody>
          </table>

          <table style="width: 100%; border-collapse: collapse; font-size: 10px;">
            <tr>
              <td style="width: 25%; font-weight: bold; padding: 5px; border: 1px solid #cbd5e1; background-color: #f1f5f9;">Assigned Subjects:</td>
              <td style="padding: 5px; border: 1px solid #cbd5e1;">${escapeHtml(f.subjects.join(", ") || "None")}</td>
            </tr>
            <tr>
              <td style="width: 25%; font-weight: bold; padding: 5px; border: 1px solid #cbd5e1; background-color: #f1f5f9;">Substitutions Covered for Colleagues:</td>
              <td style="padding: 5px; border: 1px solid #cbd5e1; font-weight: bold; color: #0284c7;">${f.substituteTakenCount} session(s)</td>
            </tr>
            <tr>
              <td style="width: 25%; font-weight: bold; padding: 5px; border: 1px solid #cbd5e1; background-color: #f1f5f9;">Relief Covered by Colleagues:</td>
              <td style="padding: 5px; border: 1px solid #cbd5e1; font-weight: bold; color: #be123c;">${f.relievedCount} session(s)</td>
            </tr>
          </table>
        </div>

        <!-- 2. Date-wise Data Breakdown -->
        <div>
          <h3 style="font-size: 12px; text-transform: uppercase; margin: 12px 0 4px; color: #0f172a; border-bottom: 1px solid #cbd5e1; padding-bottom: 3px;">
            2. Date-wise Timetable Delivery & Substitution Actions (${dateRangeLabel})
          </h3>
          ${dateTablesHtml}
        </div>
      </div>
    `;

    printHtml(htmlContent, {
      title: `Staff_Report_${f.hrmsId}_${dateMode === "range" ? `${startDate}_to_${endDate}` : getTodayDateString()}`,
      subtitle: `Workload and action audit report for ${f.facultyName} (#${f.hrmsId})`,
    });
  }, [activeStaffModal, dateMode, startDate, endDate, academicYear, modalStaffSessions]);

  // Export Staff Modal to Excel (Abstract first, then Date-wise Delivery Log)
  const exportStaffModalExcel = useCallback(() => {
    if (!activeStaffModal) return;
    const f = activeStaffModal;
    const dateRangeLabel =
      dateMode === "range"
        ? `${startDate || "Start"} to ${endDate || "End"}`
        : getTodayDateString();

    const dateMap = new Map<string, typeof modalStaffSessions>();
    modalStaffSessions.forEach((s) => {
      const d = s.date || "Scheduled";
      if (!dateMap.has(d)) dateMap.set(d, []);
      dateMap.get(d)!.push(s);
    });
    const sortedDates = Array.from(dateMap.keys()).sort();

    let sessionRowsHtml = "";
    sortedDates.forEach((d) => {
      const sessions = dateMap.get(d)!;
      sessions.forEach((s) => {
        sessionRowsHtml += `
          <tr>
            <td>${escapeHtml(s.date)}</td>
            <td>${escapeHtml(s.dayOfWeek || "")}</td>
            <td>${escapeHtml(s.slotLabel)}</td>
            <td>${escapeHtml(s.time)}</td>
            <td>${escapeHtml(s.sectionName ? `Sec ${cleanSectionCode(s.sectionName)}` : "All")}</td>
            <td>${escapeHtml(s.batch)}</td>
            <td>${escapeHtml(s.todaySubjectName || s.masterSubjectName || "—")}</td>
            <td>${escapeHtml(s.todaySubjectCode || s.masterSubjectCode || "—")}</td>
            <td>${escapeHtml(s.actionTitle)}</td>
            <td>${s.isConducted ? "Conducted" : "Scheduled"}</td>
            <td>${s.attendancePct != null ? `${s.attendancePct}%` : "Pending"}</td>
          </tr>
        `;
      });
    });

    const excelHtml = `
      <table>
        <tr>
          <td colspan="11" class="title-h1">ACADEMIC PORTAL &bull; FACULTY WORKLOAD & ACTION AUDIT REPORT</td>
        </tr>
        <tr>
          <td colspan="11" class="meta-p">
            Faculty: <b>${escapeHtml(f.facultyName)}</b> | 
            HRMS ID: <b>#${escapeHtml(f.hrmsId)}</b> | 
            Period: <b>${escapeHtml(dateRangeLabel)}</b> | 
            Academic Year: <b>${escapeHtml(academicYear || "Current")}</b>
          </td>
        </tr>
      </table>

      <!-- 1. EXECUTIVE ABSTRACT -->
      <table>
        <tr>
          <th colspan="6" class="section-h2">1. EXECUTIVE ABSTRACT</th>
        </tr>
        <tr>
          <th class="kpi-th">Master Quota (p/wk)</th>
          <th class="kpi-th">Classes Conducted</th>
          <th class="kpi-th">Relieved Away (-)</th>
          <th class="kpi-th">Substitute Taken (+)</th>
          <th class="kpi-th">Net Teaching Load</th>
          <th class="kpi-th">Net Shift</th>
        </tr>
        <tr>
          <td class="kpi-val">${f.masterAssignedPeriods}</td>
          <td class="kpi-val highlight-emerald">${f.classesConducted}</td>
          <td class="kpi-val highlight-rose">${f.relievedCount > 0 ? `-${f.relievedCount}` : 0}</td>
          <td class="kpi-val highlight-sky">${f.substituteTakenCount > 0 ? `+${f.substituteTakenCount}` : 0}</td>
          <td class="kpi-val"><b>${f.netTeachingCount}</b></td>
          <td>${f.substituteTakenCount - f.relievedCount >= 0 ? "+" : ""}${f.substituteTakenCount - f.relievedCount}</td>
        </tr>
        <tr>
          <td colspan="2"><b>Assigned Subjects:</b></td>
          <td colspan="4">${escapeHtml(f.subjects.join(", ") || "None")}</td>
        </tr>
        <tr>
          <td colspan="2"><b>Substitutions Covered for Colleagues:</b></td>
          <td colspan="4">${f.substituteTakenCount} session(s)</td>
        </tr>
        <tr>
          <td colspan="2"><b>Relief Covered by Colleagues:</b></td>
          <td colspan="4">${f.relievedCount} session(s)</td>
        </tr>
      </table>

      <!-- 2. DATE-WISE BREAKDOWN -->
      <table>
        <tr>
          <th colspan="11" class="section-h2">2. DATE-WISE TIMETABLE & ACTION LOG</th>
        </tr>
        <tr>
          <th>Date</th>
          <th>Day</th>
          <th>Slot</th>
          <th>Time</th>
          <th>Class & Section</th>
          <th>Batch</th>
          <th>Subject Name</th>
          <th>Subject Code</th>
          <th>Action Role Taken</th>
          <th>Conducted</th>
          <th>Attendance Turnout</th>
        </tr>
        ${sessionRowsHtml || `<tr><td colspan="11">No delivery sessions found in this date range.</td></tr>`}
      </table>
    `;

    downloadExcelFile(
      excelHtml,
      `Staff_${f.hrmsId}_${dateMode === "range" ? `${startDate}_to_${endDate}` : getTodayDateString()}.xls`,
    );
  }, [activeStaffModal, dateMode, startDate, endDate, academicYear, modalStaffSessions, downloadExcelFile]);

  // Export to Excel / CSV with Executive Abstract + Date-wise breakdown
  const handleExportCsv = () => {
    const dateRangeLabel =
      dateMode === "range"
        ? `${startDate || "Start"} to ${endDate || "End"}`
        : getTodayDateString();

    if (activeSection === "subjects") {
      if (selectedSubjectObj) {
        exportSubjectModalExcel();
        return;
      }

      const subjectsList = filteredSubjects.length ? filteredSubjects : (data?.subjects ?? []);
      if (!subjectsList.length) {
        alert("No subject data available to export.");
        return;
      }

      // Group comparisons by date for Date-wise breakdown
      const dateMap = new Map<string, typeof filteredComparisons>();
      filteredComparisons.forEach((c) => {
        const d = c.date || "Scheduled";
        if (!dateMap.has(d)) dateMap.set(d, []);
        dateMap.get(d)!.push(c);
      });
      const sortedDates = Array.from(dateMap.keys()).sort();

      let sessionRowsHtml = "";
      sortedDates.forEach((d) => {
        const sessions = dateMap.get(d)!;
        sessions.forEach((s) => {
          sessionRowsHtml += `
            <tr>
              <td>${escapeHtml(s.date)}</td>
              <td>${escapeHtml(s.dayOfWeek || "")}</td>
              <td>${escapeHtml(s.slotLabel)}</td>
              <td>${escapeHtml(s.time)}</td>
              <td>${escapeHtml(s.sectionName ? `Sec ${cleanSectionCode(s.sectionName)}` : "All")}</td>
              <td>${escapeHtml(s.batch)}</td>
              <td>${escapeHtml(s.todaySubjectName || s.masterSubjectName || "—")} (${escapeHtml(s.todaySubjectCode || s.masterSubjectCode || "")})</td>
              <td>${escapeHtml(s.masterFacultyName || "—")}</td>
              <td>${escapeHtml(s.todayFacultyName || "—")}</td>
              <td>${escapeHtml(s.varianceType === "UNCHANGED" ? "As Master" : s.varianceType === "FACULTY_SUBSTITUTE" ? "Faculty Substitute" : s.varianceType === "SUBJECT_SWAP" ? "Subject Swap" : "Sub & Swap")}</td>
              <td>${s.isConducted ? "Conducted" : "Scheduled"}</td>
              <td>${s.attendancePct != null ? `${s.attendancePct}%` : "Pending"}</td>
            </tr>
          `;
        });
      });

      let rosterRowsHtml = "";
      subjectsList.forEach((s) => {
        const assigned = Array.from(subjectAssignedFacultyMap.get(s.subjectCode) ?? (s.facultyNames ?? [])).join("; ");
        const changed = Array.from(subjectChangedFacultyMap.get(s.subjectCode)?.values() ?? [])
          .map((cf) => cf.originalFacultyName ? `${cf.facultyName} (sub for ${cf.originalFacultyName})` : cf.facultyName)
          .join("; ");

        rosterRowsHtml += `
          <tr>
            <td>${escapeHtml(s.subjectCode)}</td>
            <td>${escapeHtml(s.subjectName || "")}</td>
            <td>${s.masterWeeklyPeriods}</td>
            <td>${s.totalConducted}</td>
            <td>${escapeHtml(assigned || "—")}</td>
            <td>${escapeHtml(changed || "100% Fidelity")}</td>
            <td>${s.timesSwappedOut}</td>
            <td>${s.timesSwappedIn}</td>
            <td>${s.timesChanged}</td>
            <td>${s.attendancePct != null ? `${s.attendancePct}%` : "Pending"}</td>
          </tr>
        `;
      });

      const excelHtml = `
        <table>
          <tr>
            <td colspan="12" class="title-h1">ACADEMIC PORTAL &bull; SUBJECT ANALYSIS REPORT</td>
          </tr>
          <tr>
            <td colspan="12" class="meta-p">
              Filter Scope: <b>${escapeHtml(selectedCohortTitle || "All Sections")}</b> | 
              Period: <b>${escapeHtml(dateRangeLabel)}</b> | 
              Academic Year: <b>${escapeHtml(academicYear || "Current")}</b>
            </td>
          </tr>
        </table>

        <!-- 1. EXECUTIVE ABSTRACT -->
        <table>
          <tr>
            <th colspan="7" class="section-h2">1. EXECUTIVE ABSTRACT</th>
          </tr>
          <tr>
            <th class="kpi-th">Total Subjects</th>
            <th class="kpi-th">Master Quota (p/wk)</th>
            <th class="kpi-th">Conducted Sessions</th>
            <th class="kpi-th">Swapped Out</th>
            <th class="kpi-th">Swapped In</th>
            <th class="kpi-th">Total Alterations</th>
            <th class="kpi-th">Attendance Rate</th>
          </tr>
          <tr>
            <td class="kpi-val highlight-emerald">${subjectAnalytics.totalSubjects}</td>
            <td class="kpi-val">${subjectAnalytics.totalMasterQuota}</td>
            <td class="kpi-val highlight-emerald">${subjectAnalytics.totalConducted}</td>
            <td class="kpi-val highlight-rose">${subjectAnalytics.totalSwappedOut}</td>
            <td class="kpi-val highlight-emerald">${subjectAnalytics.totalSwappedIn}</td>
            <td class="kpi-val highlight-amber">${subjectAnalytics.totalChanges}</td>
            <td class="kpi-val highlight-sky">${subjectAnalytics.avgAttendancePct != null ? `${subjectAnalytics.avgAttendancePct}%` : "Pending"}</td>
          </tr>
        </table>

        <!-- 2. SUBJECT ROSTER & ALLOCATION SUMMARY -->
        <table>
          <tr>
            <th colspan="10" class="section-h2">2. SUBJECT ALLOCATION & ALTERATION ROSTER</th>
          </tr>
          <tr>
            <th>Subject Code</th>
            <th>Subject Name</th>
            <th>Master Quota</th>
            <th>Conducted</th>
            <th>Assigned Faculty</th>
            <th>Changed / Substitute Faculty</th>
            <th>Swapped Out</th>
            <th>Swapped In</th>
            <th>Total Changes</th>
            <th>Attendance %</th>
          </tr>
          ${rosterRowsHtml}
        </table>

        <!-- 3. DATE-WISE BREAKDOWN -->
        <table>
          <tr>
            <th colspan="12" class="section-h2">3. DATE-WISE TIMETABLE DELIVERY & ALTERATION LOG (${escapeHtml(dateRangeLabel)})</th>
          </tr>
          <tr>
            <th>Date</th>
            <th>Day</th>
            <th>Slot</th>
            <th>Time</th>
            <th>Class & Section</th>
            <th>Batch</th>
            <th>Subject</th>
            <th>Master Faculty</th>
            <th>Conducted Faculty</th>
            <th>Action Status</th>
            <th>Conducted</th>
            <th>Turnout %</th>
          </tr>
          ${sessionRowsHtml || `<tr><td colspan="12">No delivery sessions found in this date range.</td></tr>`}
        </table>
      `;

      downloadExcelFile(
        excelHtml,
        `Subject_Analytics_${dateMode === "range" ? `${startDate}_to_${endDate}` : getTodayDateString()}.xls`,
      );
      return;
    }

    if (activeSection === "staff") {
      if (selectedStaffObj) {
        exportStaffModalExcel();
        return;
      }

      const facultiesList = filteredFaculties.length ? filteredFaculties : (data?.faculties ?? []);
      if (!facultiesList.length) {
        alert("No faculty data available to export.");
        return;
      }

      // Group comparisons by date for Date-wise breakdown
      const dateMap = new Map<string, typeof filteredComparisons>();
      filteredComparisons.forEach((c) => {
        const d = c.date || "Scheduled";
        if (!dateMap.has(d)) dateMap.set(d, []);
        dateMap.get(d)!.push(c);
      });
      const sortedDates = Array.from(dateMap.keys()).sort();

      let sessionRowsHtml = "";
      sortedDates.forEach((d) => {
        const sessions = dateMap.get(d)!;
        sessions.forEach((s) => {
          sessionRowsHtml += `
            <tr>
              <td>${escapeHtml(s.date)}</td>
              <td>${escapeHtml(s.dayOfWeek || "")}</td>
              <td>${escapeHtml(s.slotLabel)}</td>
              <td>${escapeHtml(s.time)}</td>
              <td>${escapeHtml(s.sectionName ? `Sec ${cleanSectionCode(s.sectionName)}` : "All")}</td>
              <td>${escapeHtml(s.batch)}</td>
              <td>${escapeHtml(s.todaySubjectName || s.masterSubjectName || "—")}</td>
              <td>${escapeHtml(s.todayFacultyName || s.masterFacultyName || "—")}</td>
              <td>${escapeHtml(s.varianceType === "UNCHANGED" ? "As Master" : s.varianceType === "FACULTY_SUBSTITUTE" ? "Faculty Substitute" : s.varianceType === "SUBJECT_SWAP" ? "Subject Swap" : "Sub & Swap")}</td>
              <td>${s.isConducted ? "Conducted" : "Scheduled"}</td>
              <td>${s.attendancePct != null ? `${s.attendancePct}%` : "—"}</td>
            </tr>
          `;
        });
      });

      let staffRowsHtml = "";
      facultiesList.forEach((f) => {
        staffRowsHtml += `
          <tr>
            <td>${escapeHtml(f.facultyName || "")}</td>
            <td>#${escapeHtml(f.hrmsId)}</td>
            <td>${escapeHtml((f.subjects || []).join(", ") || "—")}</td>
            <td>${f.masterAssignedPeriods}</td>
            <td>${f.classesConducted}</td>
            <td>${f.relievedCount}</td>
            <td>${f.substituteTakenCount}</td>
            <td><b>${f.netTeachingCount}</b></td>
            <td>${f.substituteTakenCount - f.relievedCount >= 0 ? "+" : ""}${f.substituteTakenCount - f.relievedCount}</td>
          </tr>
        `;
      });

      const excelHtml = `
        <table>
          <tr>
            <td colspan="11" class="title-h1">ACADEMIC PORTAL &bull; FACULTY WORKLOAD & ACTION AUDIT REPORT</td>
          </tr>
          <tr>
            <td colspan="11" class="meta-p">
              Filter Scope: <b>${escapeHtml(selectedCohortTitle || "All Sections")}</b> | 
              Period: <b>${escapeHtml(dateRangeLabel)}</b> | 
              Academic Year: <b>${escapeHtml(academicYear || "Current")}</b>
            </td>
          </tr>
        </table>

        <!-- 1. EXECUTIVE ABSTRACT -->
        <table>
          <tr>
            <th colspan="6" class="section-h2">1. EXECUTIVE ABSTRACT</th>
          </tr>
          <tr>
            <th class="kpi-th">Total Staff</th>
            <th class="kpi-th">Master Quota (p/wk)</th>
            <th class="kpi-th">Classes Conducted</th>
            <th class="kpi-th">Relieved Out (-)</th>
            <th class="kpi-th">Substitute In (+)</th>
            <th class="kpi-th">Net Teaching Load</th>
          </tr>
          <tr>
            <td class="kpi-val highlight-amber">${staffAnalytics.totalStaff}</td>
            <td class="kpi-val">${staffAnalytics.totalMasterQuota}</td>
            <td class="kpi-val highlight-emerald">${staffAnalytics.totalConducted}</td>
            <td class="kpi-val highlight-rose">${staffAnalytics.totalRelieved}</td>
            <td class="kpi-val highlight-sky">${staffAnalytics.totalSubstitute}</td>
            <td class="kpi-val"><b>${staffAnalytics.totalNetLoad}</b></td>
          </tr>
        </table>

        <!-- 2. FACULTY WORKLOAD ROSTER -->
        <table>
          <tr>
            <th colspan="9" class="section-h2">2. FACULTY WORKLOAD & ALLOCATION ROSTER</th>
          </tr>
          <tr>
            <th>Faculty Name</th>
            <th>HRMS ID</th>
            <th>Assigned Subjects</th>
            <th>Master Quota</th>
            <th>Conducted</th>
            <th>Relieved Out</th>
            <th>Substitute In</th>
            <th>Net Load</th>
            <th>Net Variance</th>
          </tr>
          ${staffRowsHtml}
        </table>

        <!-- 3. DATE-WISE BREAKDOWN -->
        <table>
          <tr>
            <th colspan="11" class="section-h2">3. DATE-WISE TIMETABLE & ACTION LOG (${escapeHtml(dateRangeLabel)})</th>
          </tr>
          <tr>
            <th>Date</th>
            <th>Day</th>
            <th>Slot</th>
            <th>Time</th>
            <th>Class & Section</th>
            <th>Batch</th>
            <th>Subject</th>
            <th>Faculty In Charge</th>
            <th>Action Role Taken</th>
            <th>Conducted</th>
            <th>Attendance Turnout</th>
          </tr>
          ${sessionRowsHtml || `<tr><td colspan="11">No delivery sessions found in this date range.</td></tr>`}
        </table>
      `;

      downloadExcelFile(
        excelHtml,
        `Staff_Analytics_${dateMode === "range" ? `${startDate}_to_${endDate}` : getTodayDateString()}.xls`,
      );
      return;
    }

    if (activeSection === "audit") {
      const changesList = filteredRecentChanges.length ? filteredRecentChanges : (data?.recentChanges ?? []);
      if (!changesList.length) {
        alert("No change audit data available to export.");
        return;
      }
      const headers = [
        "Date",
        "Slot",
        "Batch",
        "Section",
        "Master Subject",
        "Master Faculty",
        "Actual Subject",
        "Actual Faculty",
        "Type",
        "Reason",
      ];
      const rows = changesList.map((c) => [
        c.timetableDate,
        `"${c.slotLabel} (${c.slotTime})"`,
        c.batch,
        c.sectionName || "N/A",
        `"${(c.masterSubjectName || c.masterSubjectCode || "").replace(/"/g, '""')}"`,
        `"${(c.masterFacultyName || "").replace(/"/g, '""')}"`,
        `"${(c.newSubjectName || c.newSubjectCode || "").replace(/"/g, '""')}"`,
        `"${(c.newFacultyName || "").replace(/"/g, '""')}"`,
        c.varianceType,
        `"${(c.remarks || "").replace(/"/g, '""')}"`,
      ]);
      const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
      const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `change_audit_log_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }

    // Default: activeSection === "variation"
    if (!filteredComparisons.length) {
      alert("No data available to export.");
      return;
    }
    const headers = [
      "Slot/Time",
      "Date",
      "Day",
      "Batch",
      "Section",
      "Master Subject Code",
      "Master Subject Name",
      "Master Faculty",
      "Today Subject Code",
      "Today Subject Name",
      "Today Faculty",
      "Variation Status",
      "Conducted Status",
      "Attendance %",
    ];
    const rows = filteredComparisons.map((c) => [
      `"${c.slotLabel} (${c.time})"`,
      c.date,
      c.dayOfWeek,
      c.batch,
      c.sectionName || "N/A",
      c.masterSubjectCode || "",
      `"${(c.masterSubjectName || "").replace(/"/g, '""')}"`,
      `"${(c.masterFacultyName || "").replace(/"/g, '""')}"`,
      c.todaySubjectCode || "",
      `"${(c.todaySubjectName || "").replace(/"/g, '""')}"`,
      `"${(c.todayFacultyName || "").replace(/"/g, '""')}"`,
      c.varianceType === "UNCHANGED"
        ? "As Master"
        : c.varianceType === "FACULTY_SUBSTITUTE"
          ? "Faculty Substitute"
          : c.varianceType === "SUBJECT_SWAP"
            ? "Subject Swap"
            : "Both Sub & Swap",
      c.isConducted ? "Conducted" : "Scheduled",
      c.attendancePct != null ? `${c.attendancePct}%` : "Pending",
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `master_vs_today_timetable_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Export to PDF / Print (Comprehensive formatted report with Abstract first, then Date-wise breakdown)
  const handlePrintPdf = () => {
    const dateRangeLabel =
      dateMode === "range"
        ? `${startDate ? formatDisplayDate(startDate) : "Start"} to ${endDate ? formatDisplayDate(endDate) : "End"}`
        : formatDisplayDate(getTodayDateString());

    if (activeSection === "subjects") {
      if (selectedSubjectObj) {
        exportSubjectModalPdf();
        return;
      }

      const subjectsList = filteredSubjects.length ? filteredSubjects : (data?.subjects ?? []);
      if (!subjectsList.length) {
        alert("No subject data available to print.");
        return;
      }

      // Group comparisons by date for Date-wise breakdown
      const dateMap = new Map<string, typeof filteredComparisons>();
      filteredComparisons.forEach((c) => {
        const d = c.date || "Scheduled Plan";
        if (!dateMap.has(d)) dateMap.set(d, []);
        dateMap.get(d)!.push(c);
      });
      const sortedDates = Array.from(dateMap.keys()).sort();

      let dateTablesHtml = "";
      sortedDates.forEach((d) => {
        const sessions = dateMap.get(d)!;
        const dayName = sessions[0]?.dayOfWeek || "";
        dateTablesHtml += `
          <div style="margin-top: 14px; break-inside: avoid;">
            <div style="background-color: #f1f5f9; padding: 5px 8px; font-weight: bold; font-size: 11px; border: 1px solid #cbd5e1; border-bottom: none;">
              📅 Date: ${d} ${dayName ? `(${dayName})` : ""} &bull; ${sessions.length} Session(s)
            </div>
            <table style="width: 100%; border-collapse: collapse; font-size: 10px; margin-bottom: 8px;">
              <thead>
                <tr style="background-color: #334155; color: white;">
                  <th style="padding: 5px; border: 1px solid #94a3b8; text-align: left;">Slot & Time</th>
                  <th style="padding: 5px; border: 1px solid #94a3b8; text-align: left;">Class & Section</th>
                  <th style="padding: 5px; border: 1px solid #94a3b8; text-align: left;">Subject</th>
                  <th style="padding: 5px; border: 1px solid #94a3b8; text-align: left;">Master Faculty</th>
                  <th style="padding: 5px; border: 1px solid #94a3b8; text-align: left;">Actual Faculty</th>
                  <th style="padding: 5px; border: 1px solid #94a3b8; text-align: left;">Action Role</th>
                  <th style="padding: 5px; border: 1px solid #94a3b8; text-align: center;">Conducted</th>
                  <th style="padding: 5px; border: 1px solid #94a3b8; text-align: center;">Turnout</th>
                </tr>
              </thead>
              <tbody>
                ${sessions
                  .map(
                    (s) => `
                  <tr>
                    <td style="padding: 5px; border: 1px solid #cbd5e1;">${s.slotLabel} (${s.time})</td>
                    <td style="padding: 5px; border: 1px solid #cbd5e1;">${s.sectionName ? `Sec ${cleanSectionCode(s.sectionName)}` : "All"} &bull; Batch ${s.batch}</td>
                    <td style="padding: 5px; border: 1px solid #cbd5e1;"><b>${escapeHtml(s.todaySubjectName || s.masterSubjectName || "—")}</b> (${escapeHtml(s.todaySubjectCode || s.masterSubjectCode || "")})</td>
                    <td style="padding: 5px; border: 1px solid #cbd5e1;">${escapeHtml(s.masterFacultyName || "—")}</td>
                    <td style="padding: 5px; border: 1px solid #cbd5e1; font-weight: ${s.varianceType === "FACULTY_SUBSTITUTE" ? "bold" : "normal"}; color: ${s.varianceType === "FACULTY_SUBSTITUTE" ? "#b45309" : "#0f172a"};">
                      ${escapeHtml(s.todayFacultyName || "—")}
                    </td>
                    <td style="padding: 5px; border: 1px solid #cbd5e1;">${escapeHtml(s.varianceType === "UNCHANGED" ? "As Master" : s.varianceType === "FACULTY_SUBSTITUTE" ? "Faculty Substitute" : s.varianceType === "SUBJECT_SWAP" ? "Subject Swap" : "Sub & Swap")}</td>
                    <td style="padding: 5px; border: 1px solid #cbd5e1; text-align: center;">${s.isConducted ? "Yes ✓" : "Scheduled"}</td>
                    <td style="padding: 5px; border: 1px solid #cbd5e1; text-align: center; font-weight: bold;">${s.attendancePct != null ? `${s.attendancePct}%` : "Pending"}</td>
                  </tr>
                `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        `;
      });

      const htmlContent = `
        <div style="font-family: Arial, sans-serif; color: #0f172a; padding: 10px;">
          <div style="border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin-bottom: 12px;">
            <h2 style="margin: 0; font-size: 18px; color: #0f172a;">Subject Analysis & Delivery Report</h2>
            <p style="margin: 4px 0 0; font-size: 11px; color: #475569;">
              <strong>Scope:</strong> ${escapeHtml(selectedCohortTitle || "All Sections")} &bull; 
              <strong>Period:</strong> ${escapeHtml(dateRangeLabel)} &bull; 
              <strong>Academic Year:</strong> ${escapeHtml(academicYear || "Current")}
            </p>
          </div>

          <!-- 1. Executive Abstract -->
          <div style="margin-bottom: 14px; break-inside: avoid;">
            <h3 style="font-size: 12px; text-transform: uppercase; margin: 0 0 6px; color: #0f172a; border-bottom: 1px solid #cbd5e1; padding-bottom: 3px;">
              1. Executive Abstract & Workload Metrics
            </h3>
            <table style="width: 100%; border-collapse: collapse; font-size: 10px; margin-bottom: 8px;">
              <thead>
                <tr style="background-color: #0f172a; color: white;">
                  <th style="padding: 6px; border: 1px solid #64748b;">Total Subjects</th>
                  <th style="padding: 6px; border: 1px solid #64748b;">Master Quota</th>
                  <th style="padding: 6px; border: 1px solid #64748b;">Conducted</th>
                  <th style="padding: 6px; border: 1px solid #64748b;">Swapped Out</th>
                  <th style="padding: 6px; border: 1px solid #64748b;">Swapped In</th>
                  <th style="padding: 6px; border: 1px solid #64748b;">Total Changes</th>
                  <th style="padding: 6px; border: 1px solid #64748b;">Attendance Rate</th>
                </tr>
              </thead>
              <tbody>
                <tr style="text-align: center; font-weight: bold; background-color: #f8fafc;">
                  <td style="padding: 8px; border: 1px solid #cbd5e1; font-size: 13px; color: #15803d;">${subjectAnalytics.totalSubjects}</td>
                  <td style="padding: 8px; border: 1px solid #cbd5e1; font-size: 13px;">${subjectAnalytics.totalMasterQuota} p/wk</td>
                  <td style="padding: 8px; border: 1px solid #cbd5e1; font-size: 13px; color: #15803d;">${subjectAnalytics.totalConducted} held</td>
                  <td style="padding: 8px; border: 1px solid #cbd5e1; font-size: 13px; color: #be123c;">${subjectAnalytics.totalSwappedOut}</td>
                  <td style="padding: 8px; border: 1px solid #cbd5e1; font-size: 13px; color: #15803d;">${subjectAnalytics.totalSwappedIn}</td>
                  <td style="padding: 8px; border: 1px solid #cbd5e1; font-size: 13px; color: #b45309;">${subjectAnalytics.totalChanges}</td>
                  <td style="padding: 8px; border: 1px solid #cbd5e1; font-size: 13px; color: #1e40af;">${subjectAnalytics.avgAttendancePct != null ? `${subjectAnalytics.avgAttendancePct}%` : "Pending"}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- 2. Date-wise Data Breakdown -->
          <div>
            <h3 style="font-size: 12px; text-transform: uppercase; margin: 12px 0 4px; color: #0f172a; border-bottom: 1px solid #cbd5e1; padding-bottom: 3px;">
              2. Date-wise Timetable Delivery & Alteration Sessions (${dateRangeLabel})
            </h3>
            ${dateTablesHtml || `<p style="color: #64748b; font-size: 11px; padding: 12px 0;">No timetable sessions recorded in the selected range.</p>`}
          </div>
        </div>
      `;

      printHtml(htmlContent, {
        title: `Subject_Analysis_${dateMode === "range" ? `${startDate}_to_${endDate}` : getTodayDateString()}`,
        subtitle: `Curriculum delivery report (${dateRangeLabel})`,
      });
      return;
    }

    if (activeSection === "staff") {
      if (selectedStaffObj) {
        exportStaffModalPdf();
        return;
      }

      const facultiesList = filteredFaculties.length ? filteredFaculties : (data?.faculties ?? []);
      if (!facultiesList.length) {
        alert("No faculty data available to print.");
        return;
      }

      // Group comparisons by date for Date-wise breakdown
      const dateMap = new Map<string, typeof filteredComparisons>();
      filteredComparisons.forEach((c) => {
        const d = c.date || "Scheduled Plan";
        if (!dateMap.has(d)) dateMap.set(d, []);
        dateMap.get(d)!.push(c);
      });
      const sortedDates = Array.from(dateMap.keys()).sort();

      let dateTablesHtml = "";
      sortedDates.forEach((d) => {
        const sessions = dateMap.get(d)!;
        const dayName = sessions[0]?.dayOfWeek || "";
        dateTablesHtml += `
          <div style="margin-top: 14px; break-inside: avoid;">
            <div style="background-color: #f1f5f9; padding: 5px 8px; font-weight: bold; font-size: 11px; border: 1px solid #cbd5e1; border-bottom: none;">
              📅 Date: ${d} ${dayName ? `(${dayName})` : ""} &bull; ${sessions.length} Session(s)
            </div>
            <table style="width: 100%; border-collapse: collapse; font-size: 10px; margin-bottom: 8px;">
              <thead>
                <tr style="background-color: #334155; color: white;">
                  <th style="padding: 5px; border: 1px solid #94a3b8; text-align: left;">Slot & Time</th>
                  <th style="padding: 5px; border: 1px solid #94a3b8; text-align: left;">Class & Section</th>
                  <th style="padding: 5px; border: 1px solid #94a3b8; text-align: left;">Subject</th>
                  <th style="padding: 5px; border: 1px solid #94a3b8; text-align: left;">Faculty In Charge</th>
                  <th style="padding: 5px; border: 1px solid #94a3b8; text-align: left;">Action Role</th>
                  <th style="padding: 5px; border: 1px solid #94a3b8; text-align: center;">Conducted</th>
                  <th style="padding: 5px; border: 1px solid #94a3b8; text-align: center;">Turnout</th>
                </tr>
              </thead>
              <tbody>
                ${sessions
                  .map(
                    (s) => `
                  <tr>
                    <td style="padding: 5px; border: 1px solid #cbd5e1;">${s.slotLabel} (${s.time})</td>
                    <td style="padding: 5px; border: 1px solid #cbd5e1;">${s.sectionName ? `Sec ${cleanSectionCode(s.sectionName)}` : "All"} &bull; Batch ${s.batch}</td>
                    <td style="padding: 5px; border: 1px solid #cbd5e1;"><b>${escapeHtml(s.todaySubjectName || s.masterSubjectName || "—")}</b></td>
                    <td style="padding: 5px; border: 1px solid #cbd5e1; font-weight: bold;">${escapeHtml(s.todayFacultyName || s.masterFacultyName || "—")}</td>
                    <td style="padding: 5px; border: 1px solid #cbd5e1;">${escapeHtml(s.varianceType === "UNCHANGED" ? "As Master" : s.varianceType === "FACULTY_SUBSTITUTE" ? "Faculty Substitute" : s.varianceType === "SUBJECT_SWAP" ? "Subject Swap" : "Sub & Swap")}</td>
                    <td style="padding: 5px; border: 1px solid #cbd5e1; text-align: center;">${s.isConducted ? "Yes ✓" : "Scheduled"}</td>
                    <td style="padding: 5px; border: 1px solid #cbd5e1; text-align: center; font-weight: bold;">${s.attendancePct != null ? `${s.attendancePct}%` : "—"}</td>
                  </tr>
                `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        `;
      });

      const htmlContent = `
        <div style="font-family: Arial, sans-serif; color: #0f172a; padding: 10px;">
          <div style="border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin-bottom: 12px;">
            <h2 style="margin: 0; font-size: 18px; color: #0f172a;">Faculty Workload & Action Audit Report</h2>
            <p style="margin: 4px 0 0; font-size: 11px; color: #475569;">
              <strong>Scope:</strong> ${escapeHtml(selectedCohortTitle || "All Sections")} &bull; 
              <strong>Period:</strong> ${escapeHtml(dateRangeLabel)} &bull; 
              <strong>Academic Year:</strong> ${escapeHtml(academicYear || "Current")}
            </p>
          </div>

          <!-- 1. Executive Abstract -->
          <div style="margin-bottom: 14px; break-inside: avoid;">
            <h3 style="font-size: 12px; text-transform: uppercase; margin: 0 0 6px; color: #0f172a; border-bottom: 1px solid #cbd5e1; padding-bottom: 3px;">
              1. Executive Abstract & Workload Metrics
            </h3>
            <table style="width: 100%; border-collapse: collapse; font-size: 10px; margin-bottom: 8px;">
              <thead>
                <tr style="background-color: #0f172a; color: white;">
                  <th style="padding: 6px; border: 1px solid #64748b;">Total Staff</th>
                  <th style="padding: 6px; border: 1px solid #64748b;">Master Quota</th>
                  <th style="padding: 6px; border: 1px solid #64748b;">Conducted</th>
                  <th style="padding: 6px; border: 1px solid #64748b;">Relieved Away (-)</th>
                  <th style="padding: 6px; border: 1px solid #64748b;">Substitute Taken (+)</th>
                  <th style="padding: 6px; border: 1px solid #64748b;">Net Teaching Load</th>
                </tr>
              </thead>
              <tbody>
                <tr style="text-align: center; font-weight: bold; background-color: #f8fafc;">
                  <td style="padding: 8px; border: 1px solid #cbd5e1; font-size: 13px; color: #b45309;">${staffAnalytics.totalStaff}</td>
                  <td style="padding: 8px; border: 1px solid #cbd5e1; font-size: 13px;">${staffAnalytics.totalMasterQuota} p/wk</td>
                  <td style="padding: 8px; border: 1px solid #cbd5e1; font-size: 13px; color: #15803d;">${staffAnalytics.totalConducted} held</td>
                  <td style="padding: 8px; border: 1px solid #cbd5e1; font-size: 13px; color: #be123c;">${staffAnalytics.totalRelieved}</td>
                  <td style="padding: 8px; border: 1px solid #cbd5e1; font-size: 13px; color: #0284c7;">${staffAnalytics.totalSubstitute}</td>
                  <td style="padding: 8px; border: 1px solid #cbd5e1; font-size: 13px; color: #0f172a;">${staffAnalytics.totalNetLoad} sessions</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- 2. Date-wise Data Breakdown -->
          <div>
            <h3 style="font-size: 12px; text-transform: uppercase; margin: 12px 0 4px; color: #0f172a; border-bottom: 1px solid #cbd5e1; padding-bottom: 3px;">
              2. Date-wise Timetable Delivery & Substitution Actions (${dateRangeLabel})
            </h3>
            ${dateTablesHtml || `<p style="color: #64748b; font-size: 11px; padding: 12px 0;">No timetable sessions recorded in the selected range.</p>`}
          </div>
        </div>
      `;

      printHtml(htmlContent, {
        title: `Staff_Analytics_${dateMode === "range" ? `${startDate}_to_${endDate}` : getTodayDateString()}`,
        subtitle: `Faculty workload and audit report (${dateRangeLabel})`,
      });
      return;
    }

    if (printAreaRef.current) {
      printElement(printAreaRef.current, {
        title: "",
      });
    }
  };

  return (
    <div className="space-y-4">
      {/* 1. All-in-one Comprehensive Filter Toolbar */}
      <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs space-y-3">
        {/* Academic Filters Grid: Academic Year, College, Program, Branch, Class, Section, Year, Semester */}
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-8">
          {/* Academic Year */}
          <label className="text-[11px] font-medium text-slate-600">
            Academic Year
            <select
              value={academicYear}
              onChange={(e) => {
                setAcademicYear(e.target.value);
                setSelectedCollege(null);
                setSelectedCourse(null);
                setSelectedBranch(null);
                setSelectedClassKey(null);
                setSelectedBatch(null);
                setSelectedYear(null);
                setSelectedSemester(null);
                setSelectedSection(null);
              }}
              className="mt-1 block h-8.5 w-full rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-800 shadow-xs focus:border-navy-600 focus:outline-none"
            >
              {masters?.academicYears.map((item) => (
                <option key={item.id} value={item.label}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          {/* College */}
          <label className="text-[11px] font-medium text-slate-600">
            College
            <select
              value={selectedCollege ?? ""}
              onChange={(e) => {
                const val = e.target.value ? Number(e.target.value) : null;
                setSelectedCollege(val);
                setSelectedCourse(null);
                setSelectedBranch(null);
                setSelectedClassKey(null);
                setSelectedBatch(null);
                setSelectedYear(null);
                setSelectedSemester(null);
                setSelectedSection(null);
              }}
              className="mt-1 block h-8.5 w-full rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-800 shadow-xs focus:border-navy-600 focus:outline-none truncate"
            >
              <option value="">All Colleges</option>
              {masters?.colleges.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          {/* Program / Course */}
          <label className="text-[11px] font-medium text-slate-600">
            Program
            <select
              value={selectedCourse ?? ""}
              onChange={(e) => {
                const val = e.target.value ? Number(e.target.value) : null;
                setSelectedCourse(val);
                setSelectedBranch(null);
                setSelectedClassKey(null);
                setSelectedBatch(null);
                setSelectedYear(null);
                setSelectedSemester(null);
                setSelectedSection(null);
              }}
              className="mt-1 block h-8.5 w-full rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-800 shadow-xs focus:border-navy-600 focus:outline-none truncate"
            >
              <option value="">All Programs</option>
              {filterCourses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          {/* Branch */}
          <label className="text-[11px] font-medium text-slate-600">
            Branch
            <select
              value={selectedBranch ?? ""}
              onChange={(e) => {
                const val = e.target.value ? Number(e.target.value) : null;
                setSelectedBranch(val);
                setSelectedClassKey(null);
                setSelectedBatch(null);
                setSelectedYear(null);
                setSelectedSemester(null);
                setSelectedSection(null);
              }}
              className="mt-1 block h-8.5 w-full rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-800 shadow-xs focus:border-navy-600 focus:outline-none truncate"
            >
              <option value="">All Branches</option>
              {filterBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>

          {/* Class (Dynamic cascading: shows available classes / cohorts) */}
          <label className="text-[11px] font-medium text-slate-600">
            Class
            <select
              value={selectedClassKey ?? ""}
              onChange={(e) => handleClassChange(e.target.value || null)}
              className="mt-1 block h-8.5 w-full rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-800 shadow-xs focus:border-navy-600 focus:outline-none truncate"
            >
              <option value="">
                {availableClasses.length === 0 ? "All Classes" : `All Classes (${availableClasses.length})`}
              </option>
              {availableClasses.map((cls) => (
                <option key={cls.key} value={cls.key}>
                  {cls.label} {cls.sections.length > 0 ? `(${cls.sections.length} sec)` : ""}
                </option>
              ))}
            </select>
          </label>

          {/* Section (Dynamic: if selected class has 2 sections -> shows 2, if 4 -> shows 4) */}
          <label className="text-[11px] font-medium text-slate-600">
            Section
            <select
              value={selectedSection ?? ""}
              onChange={(e) => setSelectedSection(e.target.value || null)}
              disabled={availableSections.length === 0}
              className="mt-1 block h-8.5 w-full rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-800 shadow-xs focus:border-navy-600 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400"
            >
              <option value="">
                {availableSections.length === 0
                  ? "No Sections"
                  : `All Sections (${availableSections.length})`}
              </option>
              {availableSections.map((sec) => (
                <option key={sec} value={sec}>
                  Section {sec}
                </option>
              ))}
            </select>
          </label>

          {/* Year */}
          <label className="text-[11px] font-medium text-slate-600">
            Year
            <select
              value={selectedYear ?? ""}
              onChange={(e) => handleYearChange(e.target.value ? Number(e.target.value) : null)}
              className="mt-1 block h-8.5 w-full rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-800 shadow-xs focus:border-navy-600 focus:outline-none"
            >
              <option value="">All Years</option>
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  Year {y}
                </option>
              ))}
            </select>
          </label>

          {/* Semester */}
          <label className="text-[11px] font-medium text-slate-600">
            Semester
            <select
              value={selectedSemester ?? ""}
              onChange={(e) => handleSemesterChange(e.target.value ? Number(e.target.value) : null)}
              className="mt-1 block h-8.5 w-full rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-800 shadow-xs focus:border-navy-600 focus:outline-none"
            >
              <option value="">All Semesters</option>
              <option value="1">Sem 1</option>
              <option value="2">Sem 2</option>
            </select>
          </label>
        </div>

        {/* Row 2: Search on Left Side, Date Filter (Today / Range toggle + pickers) */}
        <div className="pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            {/* Search Input on the LEFT SIDE */}
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search staff, subject, period..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8.5 w-56 sm:w-64 rounded-md border border-slate-300 bg-white pl-8 pr-7 text-xs text-slate-800 placeholder-slate-400 focus:border-navy-700 focus:outline-none shadow-2xs"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Date Mode Toggle: Today vs Date Range */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100/90 p-0.5 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => {
                    setDateMode("today");
                    const t = getTodayDateString();
                    setStartDate(t);
                    setEndDate(t);
                  }}
                  className={cn(
                    "px-3 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer",
                    dateMode === "today"
                      ? "bg-white text-navy-900 shadow-xs font-bold"
                      : "text-slate-600 hover:text-navy-900",
                  )}
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => setDateMode("range")}
                  className={cn(
                    "px-3 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer",
                    dateMode === "range"
                      ? "bg-white text-navy-900 shadow-xs font-bold"
                      : "text-slate-600 hover:text-navy-900",
                  )}
                >
                  Date Range
                </button>
              </div>

              {dateMode === "today" ? (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 border border-blue-200/80">
                  <CalendarCheck className="h-3.5 w-3.5 text-blue-600" />
                  Today ({formatDisplayDate(getTodayDateString())})
                </span>
              ) : (
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">From:</span>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="h-8 rounded-md border border-slate-300 px-2 text-xs text-slate-800 bg-white shadow-2xs"
                  />
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">To:</span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="h-8 rounded-md border border-slate-300 px-2 text-xs text-slate-800 bg-white shadow-2xs"
                  />
                  {(startDate || endDate) && (
                    <button
                      type="button"
                      onClick={() => {
                        setStartDate("");
                        setEndDate("");
                      }}
                      className="text-xs text-rose-600 hover:underline cursor-pointer ml-1"
                    >
                      Clear
                    </button>
                  )}
                </div>
              )}
            </div>
            {/* Filter chips if staff or subject selected */}
            {selectedStaffObj && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800 border border-amber-200">
                Staff: {selectedStaffObj.facultyName}
                <button
                  type="button"
                  onClick={() => setSelectedStaffHrmsId(null)}
                  className="hover:text-amber-950 cursor-pointer ml-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            {selectedSubjectObj && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 border border-emerald-200">
                Subject: {selectedSubjectObj.subjectCode}
                <button
                  type="button"
                  onClick={() => setSelectedSubjectCode(null)}
                  className="hover:text-emerald-950 cursor-pointer ml-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
          </div>

          {/* Action Buttons: Excel, PDF, Reset on the RIGHT SIDE */}
          <div className="flex items-center gap-2 ml-auto">
            {loading && (
              <span className="text-[11px] text-slate-400 font-medium mr-1 animate-pulse">
                Refreshing...
              </span>
            )}
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50/60 px-3 text-xs font-semibold text-emerald-800 shadow-2xs hover:bg-emerald-100 transition-colors cursor-pointer"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
              Excel
            </button>
            <button
              type="button"
              onClick={handlePrintPdf}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-rose-300 bg-rose-50/60 px-3 text-xs font-semibold text-rose-700 shadow-2xs hover:bg-rose-100 transition-colors cursor-pointer"
            >
              <FileText className="h-3.5 w-3.5 text-rose-600" />
              PDF
            </button>
            <button
              type="button"
              onClick={handleResetFilters}
              disabled={!hasActiveFilters}
              className={cn(
                "inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-xs font-medium shadow-2xs transition-colors",
                hasActiveFilters
                  ? "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 hover:text-navy-900 cursor-pointer"
                  : "border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed",
              )}
            >
              <RotateCcw className="h-3.5 w-3.5 text-slate-500" />
              Reset
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="space-y-4">
        {/* 3. Executive KPI Metric Cards (Interactive & Section-Tailored) */}
        {activeSection === "subjects" ? (
          <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-6">
            {/* Card 1: Total Subjects (Replaces Master Class in Subject Analytics) */}
            <button
              type="button"
              onClick={() => {
                const el = document.getElementById("subject-analytics-table-container");
                el?.scrollIntoView({ behavior: "smooth" });
              }}
              className={cn(
                "rounded-xl border p-3.5 shadow-2xs text-left transition-all duration-200 cursor-pointer group hover:-translate-y-0.5 hover:shadow-md",
                "border-emerald-200 bg-emerald-50/50 hover:bg-emerald-50 hover:border-emerald-300",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                  Total Subjects
                </span>
                <BookOpen className="h-3.5 w-3.5 text-emerald-500 group-hover:text-emerald-700 transition-colors" />
              </div>
              <div className="mt-1">
                <span className="text-2xl font-extrabold text-emerald-950">
                  {subjectAnalytics.totalSubjects}
                </span>
              </div>
              <p className="mt-0.5 text-[10px] text-emerald-800/80 font-medium">
                {dateMode === "today" ? "Active subjects today" : "Subjects in filter scope"}
              </p>
              <p className="text-[9px] text-emerald-700/70 font-semibold">Excl. lunch & breaks · Incl. labs, CRT</p>
              <span className="mt-1 flex items-center gap-1 text-[10px] font-bold text-emerald-700 opacity-80 group-hover:opacity-100 group-hover:underline">
                View subject list <ChevronRight className="h-2.5 w-2.5" />
              </span>
            </button>

            {/* Card 2: Master Quota */}
            <button
              type="button"
              onClick={() => {
                setActiveKpiDrawer("master");
                setDrawerSearch("");
              }}
              className={cn(
                "rounded-xl border p-3.5 shadow-2xs text-left transition-all duration-200 cursor-pointer group hover:-translate-y-0.5 hover:shadow-md",
                activeKpiDrawer === "master"
                  ? "border-blue-400 bg-blue-100/70 ring-2 ring-blue-400"
                  : "border-blue-100 bg-blue-50/40 hover:bg-blue-50/80 hover:border-blue-200",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600">
                  Master Quota
                </span>
                <CalendarCheck className="h-3.5 w-3.5 text-blue-400 group-hover:text-blue-600 transition-colors" />
              </div>
              <div className="mt-1">
                <span className="text-2xl font-extrabold text-blue-900">
                  {subjectAnalytics.totalWeeklyQuota}
                </span>
              </div>
              <p className="mt-0.5 text-[10px] text-blue-700/80">Weekly lecture quota</p>
              <p className="text-[9px] text-blue-600/70 font-semibold">Total periods planned / wk</p>
              <span className="mt-1 flex items-center gap-1 text-[10px] font-bold text-blue-600 opacity-80 group-hover:opacity-100 group-hover:underline">
                View master plan <ChevronRight className="h-2.5 w-2.5" />
              </span>
            </button>

            {/* Card 3: Classes Conducted */}
            <button
              type="button"
              onClick={() => {
                setActiveKpiDrawer("conducted");
                setDrawerSearch("");
              }}
              className={cn(
                "rounded-xl border p-3.5 shadow-2xs text-left transition-all duration-200 cursor-pointer group hover:-translate-y-0.5 hover:shadow-md",
                activeKpiDrawer === "conducted"
                  ? "border-teal-400 bg-teal-100/70 ring-2 ring-teal-400"
                  : "border-teal-100 bg-teal-50/40 hover:bg-teal-50/80 hover:border-teal-200",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-teal-700">
                  Classes Conducted
                </span>
                <CheckCircle2 className="h-3.5 w-3.5 text-teal-500 group-hover:text-teal-700 transition-colors" />
              </div>
              <div className="mt-1">
                <span className="text-2xl font-extrabold text-teal-900">
                  {subjectAnalytics.totalConducted}
                </span>
              </div>
              <p className="mt-0.5 text-[10px] text-teal-700/80">Attended / held</p>
              <p className="text-[9px] text-teal-600/70 font-semibold">Attendance marked sessions</p>
              <span className="mt-1 flex items-center gap-1 text-[10px] font-bold text-teal-700 opacity-80 group-hover:opacity-100 group-hover:underline">
                View held classes <ChevronRight className="h-2.5 w-2.5" />
              </span>
            </button>

            {/* Card 4: Subjects Altered */}
            <button
              type="button"
              onClick={() => {
                setActiveKpiDrawer("changed");
                setDrawerSearch("");
              }}
              className={cn(
                "rounded-xl border p-3.5 shadow-2xs text-left transition-all duration-200 cursor-pointer group hover:-translate-y-0.5 hover:shadow-md",
                activeKpiDrawer === "changed"
                  ? "border-amber-400 bg-amber-100/70 ring-2 ring-amber-400"
                  : "border-amber-100 bg-amber-50/40 hover:bg-amber-50/80 hover:border-amber-200",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700">
                  Subjects Altered
                </span>
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500 group-hover:text-amber-700 transition-colors" />
              </div>
              <div className="mt-1">
                <span className="text-2xl font-extrabold text-amber-800">
                  {subjectAnalytics.alteredSubjectsCount}
                </span>
              </div>
              <p className="mt-0.5 text-[10px] text-amber-700/80">{subjectAnalytics.totalChanges} alterations recorded</p>
              <p className="text-[9px] text-amber-600/70 font-semibold">Altered from master plan</p>
              <span className="mt-1 flex items-center gap-1 text-[10px] font-bold text-amber-800 opacity-90 group-hover:opacity-100 group-hover:underline">
                View alterations <ChevronRight className="h-2.5 w-2.5" />
              </span>
            </button>

            {/* Card 5: Period Swaps */}
            <button
              type="button"
              onClick={() => {
                setActiveKpiDrawer("swapped");
                setDrawerSearch("");
              }}
              className={cn(
                "rounded-xl border p-3.5 shadow-2xs text-left transition-all duration-200 cursor-pointer group hover:-translate-y-0.5 hover:shadow-md",
                activeKpiDrawer === "swapped"
                  ? "border-purple-400 bg-purple-100/70 ring-2 ring-purple-400"
                  : "border-purple-100 bg-purple-50/40 hover:bg-purple-50/80 hover:border-purple-200",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-purple-700">
                  Period Swaps
                </span>
                <ArrowLeftRight className="h-3.5 w-3.5 text-purple-500 group-hover:text-purple-700 transition-colors" />
              </div>
              <div className="mt-1">
                <span className="text-2xl font-extrabold text-purple-800">
                  {subjectAnalytics.totalSwappedOut + subjectAnalytics.totalSwappedIn}
                </span>
              </div>
              <p className="mt-0.5 text-[10px] text-purple-700/80">
                {subjectAnalytics.totalSwappedOut} Out · {subjectAnalytics.totalSwappedIn} In
              </p>
              <p className="text-[9px] text-purple-600/70 font-semibold">Subject interchange instances</p>
              <span className="mt-1 flex items-center gap-1 text-[10px] font-bold text-purple-800 opacity-90 group-hover:opacity-100 group-hover:underline">
                View swaps <ChevronRight className="h-2.5 w-2.5" />
              </span>
            </button>

            {/* Card 6: Average Attendance */}
            <button
              type="button"
              onClick={() => {
                setActiveKpiDrawer("rate");
                setDrawerSearch("");
              }}
              className={cn(
                "rounded-xl border p-3.5 shadow-2xs text-left transition-all duration-200 cursor-pointer group hover:-translate-y-0.5 hover:shadow-md",
                activeKpiDrawer === "rate"
                  ? "border-indigo-400 bg-indigo-100/70 ring-2 ring-indigo-400"
                  : "border-indigo-100 bg-indigo-50/40 hover:bg-indigo-50/80 hover:border-indigo-200",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700">
                  Avg Attendance
                </span>
                <Percent className="h-3.5 w-3.5 text-indigo-500 group-hover:text-indigo-700 transition-colors" />
              </div>
              <div className="mt-1">
                <span className="text-2xl font-extrabold text-indigo-900">
                  {subjectAnalytics.avgAttendance > 0 ? `${subjectAnalytics.avgAttendance}%` : "—"}
                </span>
              </div>
              <p className="mt-0.5 text-[10px] text-indigo-700/80">Subject attendance rate</p>
              <p className="text-[9px] text-indigo-600/70 font-semibold">Across filtered subjects</p>
              <span className="mt-1 flex items-center gap-1 text-[10px] font-bold text-indigo-700 opacity-80 group-hover:opacity-100 group-hover:underline">
                View details <ChevronRight className="h-2.5 w-2.5" />
              </span>
            </button>
          </div>
        ) : activeSection === "staff" ? (
          <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-6">
            {/* Card 1: Total Faculty (Replaces Master Class in Staff Analytics) */}
            <button
              type="button"
              onClick={() => {
                const el = document.getElementById("staff-analytics-table-container");
                el?.scrollIntoView({ behavior: "smooth" });
              }}
              className={cn(
                "rounded-xl border p-3.5 shadow-2xs text-left transition-all duration-200 cursor-pointer group hover:-translate-y-0.5 hover:shadow-md",
                "border-amber-200 bg-amber-50/50 hover:bg-amber-50 hover:border-amber-300",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700">
                  Total Faculty
                </span>
                <Users className="h-3.5 w-3.5 text-amber-500 group-hover:text-amber-700 transition-colors" />
              </div>
              <div className="mt-1">
                <span className="text-2xl font-extrabold text-amber-950">
                  {staffAnalytics.totalStaff}
                </span>
              </div>
              <p className="mt-0.5 text-[10px] text-amber-800/80 font-medium">Faculty members in scope</p>
              <p className="text-[9px] text-amber-700/70 font-semibold">Filtered by department & class</p>
              <span className="mt-1 flex items-center gap-1 text-[10px] font-bold text-amber-800 opacity-80 group-hover:opacity-100 group-hover:underline">
                View faculty list <ChevronRight className="h-2.5 w-2.5" />
              </span>
            </button>

            {/* Card 2: Master Load */}
            <button
              type="button"
              onClick={() => {
                setActiveKpiDrawer("master");
                setDrawerSearch("");
              }}
              className={cn(
                "rounded-xl border p-3.5 shadow-2xs text-left transition-all duration-200 cursor-pointer group hover:-translate-y-0.5 hover:shadow-md",
                activeKpiDrawer === "master"
                  ? "border-blue-400 bg-blue-100/70 ring-2 ring-blue-400"
                  : "border-blue-100 bg-blue-50/40 hover:bg-blue-50/80 hover:border-blue-200",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600">
                  Master Load
                </span>
                <BookOpen className="h-3.5 w-3.5 text-blue-400 group-hover:text-blue-600 transition-colors" />
              </div>
              <div className="mt-1">
                <span className="text-2xl font-extrabold text-blue-900">
                  {staffAnalytics.totalAssignedLoad}
                </span>
              </div>
              <p className="mt-0.5 text-[10px] text-blue-700/80">Assigned periods / wk</p>
              <p className="text-[9px] text-blue-600/70 font-semibold">Baseline teaching allocation</p>
              <span className="mt-1 flex items-center gap-1 text-[10px] font-bold text-blue-600 opacity-80 group-hover:opacity-100 group-hover:underline">
                View master plan <ChevronRight className="h-2.5 w-2.5" />
              </span>
            </button>

            {/* Card 3: Classes Conducted */}
            <button
              type="button"
              onClick={() => {
                setActiveKpiDrawer("conducted");
                setDrawerSearch("");
              }}
              className={cn(
                "rounded-xl border p-3.5 shadow-2xs text-left transition-all duration-200 cursor-pointer group hover:-translate-y-0.5 hover:shadow-md",
                activeKpiDrawer === "conducted"
                  ? "border-emerald-400 bg-emerald-100/70 ring-2 ring-emerald-400"
                  : "border-emerald-100 bg-emerald-50/40 hover:bg-emerald-50/80 hover:border-emerald-200",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">
                  Classes Conducted
                </span>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 group-hover:text-emerald-600 transition-colors" />
              </div>
              <div className="mt-1">
                <span className="text-2xl font-extrabold text-emerald-800">
                  {staffAnalytics.totalConducted}
                </span>
              </div>
              <p className="mt-0.5 text-[10px] text-emerald-700/80">Sessions held by staff</p>
              <p className="text-[9px] text-emerald-600/70 font-semibold">Verified attendance posted</p>
              <span className="mt-1 flex items-center gap-1 text-[10px] font-bold text-emerald-700 opacity-80 group-hover:opacity-100 group-hover:underline">
                View held classes <ChevronRight className="h-2.5 w-2.5" />
              </span>
            </button>

            {/* Card 4: Relieved (Out) */}
            <button
              type="button"
              onClick={() => {
                setActiveKpiDrawer("substituted");
                setDrawerSearch("");
              }}
              className={cn(
                "rounded-xl border p-3.5 shadow-2xs text-left transition-all duration-200 cursor-pointer group hover:-translate-y-0.5 hover:shadow-md",
                activeKpiDrawer === "substituted"
                  ? "border-rose-400 bg-rose-100/70 ring-2 ring-rose-400"
                  : "border-rose-100 bg-rose-50/40 hover:bg-rose-50/80 hover:border-rose-200",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-rose-700">
                  Relieved (Out)
                </span>
                <AlertTriangle className="h-3.5 w-3.5 text-rose-500 group-hover:text-rose-700 transition-colors" />
              </div>
              <div className="mt-1">
                <span className="text-2xl font-extrabold text-rose-800">
                  {staffAnalytics.totalRelieved}
                </span>
              </div>
              <p className="mt-0.5 text-[10px] text-rose-700/80">Periods faculty was away</p>
              <p className="text-[9px] text-rose-600/70 font-semibold">Covered by substitute faculty</p>
              <span className="mt-1 flex items-center gap-1 text-[10px] font-bold text-rose-800 opacity-90 group-hover:opacity-100 group-hover:underline">
                View substitutions <ChevronRight className="h-2.5 w-2.5" />
              </span>
            </button>

            {/* Card 5: Substitutes Covered (In) */}
            <button
              type="button"
              onClick={() => {
                setActiveKpiDrawer("substituted");
                setDrawerSearch("");
              }}
              className={cn(
                "rounded-xl border p-3.5 shadow-2xs text-left transition-all duration-200 cursor-pointer group hover:-translate-y-0.5 hover:shadow-md",
                activeKpiDrawer === "substituted"
                  ? "border-sky-400 bg-sky-100/70 ring-2 ring-sky-400"
                  : "border-sky-100 bg-sky-50/40 hover:bg-sky-50/80 hover:border-sky-200",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-sky-700">
                  Substitutes (In)
                </span>
                <UserCheck className="h-3.5 w-3.5 text-sky-500 group-hover:text-sky-700 transition-colors" />
              </div>
              <div className="mt-1">
                <span className="text-2xl font-extrabold text-sky-800">
                  {staffAnalytics.totalSubstituteTaken}
                </span>
              </div>
              <p className="mt-0.5 text-[10px] text-sky-700/80">Relief duties covered</p>
              <p className="text-[9px] text-sky-600/70 font-semibold">Stepped in for colleagues</p>
              <span className="mt-1 flex items-center gap-1 text-[10px] font-bold text-sky-800 opacity-90 group-hover:opacity-100 group-hover:underline">
                View substitute classes <ChevronRight className="h-2.5 w-2.5" />
              </span>
            </button>

            {/* Card 6: Net Teaching Load */}
            <button
              type="button"
              onClick={() => {
                setActiveKpiDrawer("conducted");
                setDrawerSearch("");
              }}
              className={cn(
                "rounded-xl border p-3.5 shadow-2xs text-left transition-all duration-200 cursor-pointer group hover:-translate-y-0.5 hover:shadow-md",
                activeKpiDrawer === "conducted"
                  ? "border-indigo-400 bg-indigo-100/70 ring-2 ring-indigo-400"
                  : "border-indigo-100 bg-indigo-50/40 hover:bg-indigo-50/80 hover:border-indigo-200",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700">
                  Net Teaching Load
                </span>
                <CheckCircle2 className="h-3.5 w-3.5 text-indigo-500 group-hover:text-indigo-700 transition-colors" />
              </div>
              <div className="mt-1">
                <span className="text-2xl font-extrabold text-indigo-900">
                  {staffAnalytics.totalNetLoad}
                </span>
              </div>
              <p className="mt-0.5 text-[10px] text-indigo-700/80">{staffAnalytics.activeFacultyCount} active faculty members</p>
              <p className="text-[9px] text-indigo-600/70 font-semibold">Effective lecture load delivery</p>
              <span className="mt-1 flex items-center gap-1 text-[10px] font-bold text-indigo-700 opacity-80 group-hover:opacity-100 group-hover:underline">
                View load breakdown <ChevronRight className="h-2.5 w-2.5" />
              </span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-6">
            {/* Card 1: Master Lectures Assigned */}
            <button
              type="button"
              onClick={() => {
                setActiveKpiDrawer("master");
                setDrawerSearch("");
              }}
              className={cn(
                "rounded-xl border p-3.5 shadow-2xs text-left transition-all duration-200 cursor-pointer group hover:-translate-y-0.5 hover:shadow-md",
                activeKpiDrawer === "master"
                  ? "border-blue-400 bg-blue-100/70 ring-2 ring-blue-400"
                  : "border-blue-100 bg-blue-50/40 hover:bg-blue-50/80 hover:border-blue-200",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600">
                  Master Assigned
                </span>
                <BookOpen className="h-3.5 w-3.5 text-blue-400 group-hover:text-blue-600 transition-colors" />
              </div>
              <div className="mt-1">
                <span className="text-2xl font-extrabold text-blue-900">
                  {selectedSection
                    ? masterScheduledList.length
                    : (dateMode === "today" || (startDate && endDate)
                      ? (data?.summary?.totalMasterPeriodsScheduled ?? masterScheduledList.length)
                      : summary.totalMasterPeriods)}
                </span>
              </div>
              <p className="mt-0.5 text-[10px] text-blue-700/80">
                {dateMode === "today"
                  ? "Today's master classes"
                  : startDate && endDate
                    ? "Scheduled classes in range"
                    : "Weekly lecture quota"}
              </p>
              <p className="text-[9px] text-blue-600/70 font-semibold">Excl. lunch & normal break · Incl. CRT, Library</p>
              <span className="mt-1 flex items-center gap-1 text-[10px] font-bold text-blue-600 opacity-80 group-hover:opacity-100 group-hover:underline">
                View master schedule <ChevronRight className="h-2.5 w-2.5" />
              </span>
            </button>

            {/* Card 2: Conducted Classes */}
            <button
              type="button"
              onClick={() => {
                setActiveKpiDrawer("conducted");
                setDrawerSearch("");
              }}
              className={cn(
                "rounded-xl border p-3.5 shadow-2xs text-left transition-all duration-200 cursor-pointer group hover:-translate-y-0.5 hover:shadow-md",
                activeKpiDrawer === "conducted"
                  ? "border-emerald-400 bg-emerald-100/70 ring-2 ring-emerald-400"
                  : "border-emerald-100 bg-emerald-50/40 hover:bg-emerald-50/80 hover:border-emerald-200",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">
                  Classes Conducted
                </span>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 group-hover:text-emerald-600 transition-colors" />
              </div>
              <div className="mt-1">
                <span className="text-2xl font-extrabold text-emerald-800">
                  {summary.totalConductedSessions}
                </span>
              </div>
              <p className="mt-0.5 text-[10px] text-emerald-700/80">Attended / held</p>
              <span className="mt-1.5 flex items-center gap-1 text-[10px] font-bold text-emerald-700 opacity-80 group-hover:opacity-100 group-hover:underline">
                View held classes <ChevronRight className="h-2.5 w-2.5" />
              </span>
            </button>

            {/* Card 3: Classes Changed */}
            <button
              type="button"
              onClick={() => {
                setActiveKpiDrawer("changed");
                setDrawerSearch("");
              }}
              className={cn(
                "rounded-xl border p-3.5 shadow-2xs text-left transition-all duration-200 cursor-pointer group hover:-translate-y-0.5 hover:shadow-md",
                activeKpiDrawer === "changed"
                  ? "border-amber-400 bg-amber-100/70 ring-2 ring-amber-400"
                  : "border-amber-100 bg-amber-50/40 hover:bg-amber-50/80 hover:border-amber-200",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700">
                  Classes Changed
                </span>
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500 group-hover:text-amber-700 transition-colors" />
              </div>
              <div className="mt-1">
                <span className="text-2xl font-extrabold text-amber-800">
                  {summary.totalChangesRecorded}
                </span>
              </div>
              <p className="mt-0.5 text-[10px] text-amber-700/80">Altered from plan</p>
              <span className="mt-1.5 flex items-center gap-1 text-[10px] font-bold text-amber-800 opacity-90 group-hover:opacity-100 group-hover:underline">
                View changed subjects <ChevronRight className="h-2.5 w-2.5" />
              </span>
            </button>

            {/* Card 4: Faculty Substitutions */}
            <button
              type="button"
              onClick={() => {
                setActiveKpiDrawer("substituted");
                setDrawerSearch("");
              }}
              className={cn(
                "rounded-xl border p-3.5 shadow-2xs text-left transition-all duration-200 cursor-pointer group hover:-translate-y-0.5 hover:shadow-md",
                activeKpiDrawer === "substituted"
                  ? "border-sky-400 bg-sky-100/70 ring-2 ring-sky-400"
                  : "border-sky-100 bg-sky-50/40 hover:bg-sky-50/80 hover:border-sky-200",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-sky-700">
                  Faculty Substituted
                </span>
                <UserCheck className="h-3.5 w-3.5 text-sky-500 group-hover:text-sky-700 transition-colors" />
              </div>
              <div className="mt-1">
                <span className="text-2xl font-extrabold text-sky-800">
                  {summary.facultySubstitutionsCount}
                </span>
              </div>
              <p className="mt-0.5 text-[10px] text-sky-700/80">Relievers stepped in</p>
              <span className="mt-1.5 flex items-center gap-1 text-[10px] font-bold text-sky-800 opacity-90 group-hover:opacity-100 group-hover:underline">
                Who changed & stepped in <ChevronRight className="h-2.5 w-2.5" />
              </span>
            </button>

            {/* Card 5: Subject Swaps */}
            <button
              type="button"
              onClick={() => {
                setActiveKpiDrawer("swapped");
                setDrawerSearch("");
              }}
              className={cn(
                "rounded-xl border p-3.5 shadow-2xs text-left transition-all duration-200 cursor-pointer group hover:-translate-y-0.5 hover:shadow-md",
                activeKpiDrawer === "swapped"
                  ? "border-purple-400 bg-purple-100/70 ring-2 ring-purple-400"
                  : "border-purple-100 bg-purple-50/40 hover:bg-purple-50/80 hover:border-purple-200",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-purple-700">
                  Subject Swapped
                </span>
                <ArrowLeftRight className="h-3.5 w-3.5 text-purple-500 group-hover:text-purple-700 transition-colors" />
              </div>
              <div className="mt-1">
                <span className="text-2xl font-extrabold text-purple-800">
                  {summary.subjectSwapsCount}
                </span>
              </div>
              <p className="mt-0.5 text-[10px] text-purple-700/80">Subject exchange</p>
              <span className="mt-1.5 flex items-center gap-1 text-[10px] font-bold text-purple-800 opacity-90 group-hover:opacity-100 group-hover:underline">
                View swapped subjects <ChevronRight className="h-2.5 w-2.5" />
              </span>
            </button>

            {/* Card 6: Change Rate % */}
            <button
              type="button"
              onClick={() => {
                setActiveKpiDrawer("rate");
                setDrawerSearch("");
              }}
              className={cn(
                "rounded-xl border p-3.5 shadow-2xs text-left transition-all duration-200 cursor-pointer group hover:-translate-y-0.5 hover:shadow-md",
                activeKpiDrawer === "rate"
                  ? "border-rose-400 bg-rose-100/70 ring-2 ring-rose-400"
                  : "border-rose-100 bg-rose-50/40 hover:bg-rose-50/80 hover:border-rose-200",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-rose-600">
                  Change Rate %
                </span>
                <Percent className="h-3.5 w-3.5 text-rose-400 group-hover:text-rose-600 transition-colors" />
              </div>
              <div className="mt-1">
                <span className="text-2xl font-extrabold text-rose-700">
                  {summary.overallChangeRatePct}%
                </span>
              </div>
              <p className="mt-0.5 text-[10px] text-rose-700/80">Timetable variance</p>
              <span className="mt-1.5 flex items-center gap-1 text-[10px] font-bold text-rose-700 opacity-80 group-hover:opacity-100 group-hover:underline">
                View variance breakdown <ChevronRight className="h-2.5 w-2.5" />
              </span>
            </button>
          </div>
        )}

        {/* 4. Interactive Focus Drill-Down Card for Staff (in Master vs Today Comparison) */}
        {activeSection === "variation" && selectedStaffObj && (
          <div className="rounded-xl border-2 border-amber-300 bg-linear-to-r from-amber-50/70 to-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 pb-2.5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500 text-white font-bold">
                  <UserCheck className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-navy-950">{selectedStaffObj.facultyName}</h3>
                    <span className="rounded bg-amber-100 px-2 py-0.5 font-mono text-[11px] font-bold text-amber-900">
                      HRMS ID: {selectedStaffObj.hrmsId}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600">
                    Faculty Teaching & Substitution Analytics
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedStaffHrmsId(null)}
                className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:text-navy-900 cursor-pointer"
              >
                Clear Staff Filter
              </button>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-5">
              <div className="rounded-lg bg-white p-2.5 border border-amber-200 shadow-2xs">
                <span className="text-[10px] font-semibold text-slate-500 uppercase">Master Assigned</span>
                <p className="mt-1 text-lg font-bold text-navy-950">{selectedStaffObj.masterAssignedPeriods} <span className="text-xs font-normal text-slate-500">classes</span></p>
              </div>
              <div className="rounded-lg bg-white p-2.5 border border-emerald-200 shadow-2xs">
                <span className="text-[10px] font-semibold text-emerald-700 uppercase">Classes Conducted</span>
                <p className="mt-1 text-lg font-bold text-emerald-800">{selectedStaffObj.classesConducted} <span className="text-xs font-normal text-slate-500">attended</span></p>
              </div>
              <div className="rounded-lg bg-white p-2.5 border border-rose-200 shadow-2xs">
                <span className="text-[10px] font-semibold text-rose-700 uppercase">Relieved (Substituted Out)</span>
                <p className="mt-1 text-lg font-bold text-rose-700">{selectedStaffObj.relievedCount} <span className="text-xs font-normal text-slate-500">classes</span></p>
              </div>
              <div className="rounded-lg bg-white p-2.5 border border-sky-200 shadow-2xs">
                <span className="text-[10px] font-semibold text-sky-700 uppercase">Substitutions Taken (In)</span>
                <p className="mt-1 text-lg font-bold text-sky-800">{selectedStaffObj.substituteTakenCount} <span className="text-xs font-normal text-slate-500">classes</span></p>
              </div>
              <div className="rounded-lg bg-white p-2.5 border border-indigo-200 shadow-2xs">
                <span className="text-[10px] font-semibold text-indigo-700 uppercase">Net Teaching Load</span>
                <p className="mt-1 text-lg font-bold text-indigo-900">{selectedStaffObj.netTeachingCount} <span className="text-xs font-normal text-slate-500">total</span></p>
              </div>
            </div>

            {selectedStaffObj.subjects && selectedStaffObj.subjects.length > 0 && (
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs">
                <span className="font-semibold text-slate-600">Subjects:</span>
                {selectedStaffObj.subjects.map((sub, i) => (
                  <span key={i} className="rounded bg-amber-100/90 px-2 py-0.5 text-[11px] font-medium text-amber-900">
                    {sub}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 5. Interactive Focus Drill-Down Card for Subject (in Master vs Today Comparison) */}
        {activeSection === "variation" && selectedSubjectObj && (
          <div className="rounded-xl border-2 border-emerald-300 bg-linear-to-r from-emerald-50/70 to-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-200 pb-2.5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-white font-bold">
                  <BookOpen className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-navy-950">{selectedSubjectObj.subjectName}</h3>
                    <span className="rounded bg-emerald-100 px-2 py-0.5 font-mono text-[11px] font-bold text-emerald-900">
                      Code: {selectedSubjectObj.subjectCode}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600">
                    Subject Allotment & Timetable Alteration Report
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSubjectCode(null)}
                className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:text-navy-900 cursor-pointer"
              >
                Clear Subject Filter
              </button>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <div className="rounded-lg bg-white p-2.5 border border-emerald-200 shadow-2xs">
                <span className="text-[10px] font-semibold text-slate-500 uppercase">Master Quota</span>
                <p className="mt-1 text-lg font-bold text-navy-950">{selectedSubjectObj.masterWeeklyPeriods} <span className="text-xs font-normal text-slate-500">periods/wk</span></p>
              </div>
              <div className="rounded-lg bg-white p-2.5 border border-emerald-200 shadow-2xs">
                <span className="text-[10px] font-semibold text-emerald-700 uppercase">Classes Conducted</span>
                <p className="mt-1 text-lg font-bold text-emerald-800">{selectedSubjectObj.totalConducted} <span className="text-xs font-normal text-slate-500">attended</span></p>
              </div>
              <div className="rounded-lg bg-white p-2.5 border border-amber-200 shadow-2xs">
                <span className="text-[10px] font-semibold text-amber-700 uppercase">Times Changed</span>
                <p className="mt-1 text-lg font-bold text-amber-800">
                  {selectedSubjectObj.timesChanged}{" "}
                  <span className="text-[11px] font-normal text-slate-500">
                    ({selectedSubjectObj.timesSwappedOut} out / {selectedSubjectObj.timesSwappedIn} in)
                  </span>
                </p>
              </div>
              <div className="rounded-lg bg-white p-2.5 border border-indigo-200 shadow-2xs">
                <span className="text-[10px] font-semibold text-indigo-700 uppercase">Attendance %</span>
                <p className="mt-1 text-lg font-bold text-indigo-900">{selectedSubjectObj.attendancePct}%</p>
              </div>
            </div>

            {/* Assigned Faculty & Changed Faculty breakdown */}
            {(() => {
              const assigned = Array.from(subjectAssignedFacultyMap.get(selectedSubjectObj.subjectCode) ?? (selectedSubjectObj.facultyNames ?? []));
              const changed = Array.from(subjectChangedFacultyMap.get(selectedSubjectObj.subjectCode)?.values() ?? []);
              return (
                <div className="mt-2.5 pt-2 border-t border-emerald-100 space-y-1.5 text-xs">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold text-slate-700">Assigned Faculty (Master):</span>
                    {assigned.length > 0 ? (
                      assigned.map((name, i) => (
                        <span key={i} className="rounded bg-emerald-100/90 px-2 py-0.5 text-[11px] font-medium text-emerald-900">
                          {name}
                        </span>
                      ))
                    ) : (
                      <span className="text-slate-400 italic">Not Assigned</span>
                    )}
                  </div>
                  {changed.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-bold text-amber-900">Changed / Substitute Faculty:</span>
                      {changed.map((cf, i) => (
                        <span key={i} className="inline-flex items-center gap-1 rounded bg-amber-50 border border-amber-200 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500"></span>
                          {cf.facultyName}
                          {cf.originalFacultyName && cf.originalFacultyName !== cf.facultyName && (
                            <span className="text-[10px] font-normal text-amber-700">(sub for {cf.originalFacultyName})</span>
                          )}
                          {cf.count > 1 && (
                            <span className="rounded-full bg-amber-200 px-1 text-[9px] font-bold text-amber-900">×{cf.count}</span>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* 6. Section Comparison Header & Color Legend */}
        {activeSection === "variation" && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-navy-900">
              Master vs Today Timetable Comparison
            </h4>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-700">
              {comparisonsBySection.length} Cohort{comparisonsBySection.length !== 1 ? "s" : ""} / Section{comparisonsBySection.length !== 1 ? "s" : ""}
            </span>
            <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-bold text-blue-700 border border-blue-200">
              {filteredComparisons.length} Total Sessions
            </span>
          </div>

          {/* Color Legend */}
          <div className="flex flex-wrap items-center gap-3 text-[11px] font-medium text-slate-600">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
              As Master (Unchanged)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-500"></span>
              Faculty Substitute
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-sky-500"></span>
              Subject Swapped
            </span>
          </div>
        </div>

        {/* 7. Printable Section Comparison Tables Container (Exclusively matching Image 1 for PDF export) */}
        <div ref={printAreaRef} className="space-y-4">

            {filteredComparisons.length === 0 ? (
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white p-12 text-center text-xs text-slate-500 shadow-xs">
                No timetable sessions match the selected filters.
              </div>
            ) : (
              comparisonsBySection.map((secGroup) => (
                <div
                  key={secGroup.sectionKey}
                  className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs"
                >
                  {/* Distinct Section Header Banner */}
                  <div className="border-b border-slate-200 bg-linear-to-r from-slate-50 via-sky-50/20 to-slate-50 px-4 py-3 flex flex-wrap items-center justify-between gap-2.5">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-navy-900 text-white font-extrabold text-xs shadow-2xs">
                        {secGroup.sectionLetter === "Unassigned" ? "ALL" : secGroup.sectionLetter}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-bold text-navy-950">
                            {secGroup.sectionTitle}
                          </h4>
                          <span className="rounded bg-indigo-50 border border-indigo-200 px-2 py-0.5 text-[10px] font-bold text-indigo-700">
                            {secGroup.branchCode}
                          </span>
                          <span className="rounded bg-slate-200/80 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                            Batch {secGroup.batch}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500">
                          {secGroup.totalClasses} scheduled periods · Period sequence in order
                        </p>
                      </div>
                    </div>

                    {/* Section Quick Summary Stats */}
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                        {secGroup.conductedCount} / {secGroup.totalClasses} Conducted
                      </span>
                      {secGroup.substitutedCount > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800 border border-amber-200">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500"></span>
                          {secGroup.substitutedCount} Substituted
                        </span>
                      )}
                      {secGroup.swappedCount > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-800 border border-sky-200">
                          <span className="h-1.5 w-1.5 rounded-full bg-sky-500"></span>
                          {secGroup.swappedCount} Swapped
                        </span>
                      )}
                      {secGroup.substitutedCount === 0 && secGroup.swappedCount === 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-800 border border-emerald-200">
                          100% As Master
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Table of periods for this Section */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-100/70 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                          <th className="py-2.5 px-3">Slot & Time</th>
                          <th className="py-2.5 px-2">Date & Day</th>
                          <th className="py-2.5 px-2">Branch / Section</th>
                          <th className="py-2.5 px-3">Master Timetable (Assigned)</th>
                          <th className="py-2.5 px-3">Today Timetable (Conducted)</th>
                          <th className="py-2.5 px-2 text-center">Variation Status</th>
                          <th className="py-2.5 px-3">Variance Note</th>
                          <th className="py-2.5 px-3 text-center">Attendance %</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {secGroup.items.map((c) => {
                          const isUnchanged = c.varianceType === "UNCHANGED";
                          const isSubstitute = c.varianceType === "FACULTY_SUBSTITUTE" || c.varianceType === "BOTH";
                          const isSwap = c.varianceType === "SUBJECT_SWAP" || c.varianceType === "BOTH";

                          return (
                            <tr
                              key={c.id}
                              className={cn(
                                "hover:bg-slate-50/80 transition-colors",
                                !isUnchanged ? "bg-amber-50/20" : "",
                              )}
                            >
                              {/* Slot & Time */}
                              <td className="py-3 px-3 font-mono font-bold text-navy-950">
                                {c.slotLabel}
                                <p className="font-normal text-[10px] text-slate-500">{c.time}</p>
                              </td>

                              {/* Date & Day */}
                              <td className="py-3 px-2">
                                <span className="font-semibold text-slate-800">{c.date}</span>
                                <p className="text-[10px] text-slate-400 font-bold uppercase">{c.dayOfWeek}</p>
                              </td>

                              {/* Branch & Section */}
                              <td className="py-3 px-2">
                                <div className="flex flex-wrap items-center gap-1">
                                  <span className="rounded bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700">
                                    {getBranchBadge(c.branchId, c.branchCode)}
                                  </span>
                                  <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-bold text-sky-700 border border-sky-200">
                                    Sec {cleanSectionCode(c.sectionName) || "A"}
                                  </span>
                                </div>
                                <p className="text-[10px] text-slate-500 mt-0.5">Batch {c.batch}</p>
                              </td>

                              {/* Master Schedule (Assigned) */}
                              <td className="py-3 px-3">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <p className="font-bold text-navy-900">
                                    {c.masterSubjectName || c.masterSubjectCode || <span className="text-slate-400">Not Assigned</span>}
                                  </p>
                                  {(c.masterSubjectName?.toUpperCase() === "CRT" || c.masterSubjectCode?.toUpperCase() === "CRT") && (
                                    <span className="rounded bg-purple-100 text-purple-800 text-[9px] font-extrabold px-1.5 py-0.5 border border-purple-200">
                                      CRT
                                    </span>
                                  )}
                                  {(c.masterSubjectName?.toUpperCase() === "LIBRARY" || c.masterSubjectCode?.toUpperCase() === "LIBRARY") && (
                                    <span className="rounded bg-teal-100 text-teal-800 text-[9px] font-extrabold px-1.5 py-0.5 border border-teal-200">
                                      Library
                                    </span>
                                  )}
                                </div>
                                <p className="text-[10px] text-slate-500 mt-0.5">
                                  Faculty: <span className="font-medium text-slate-700">{c.masterFacultyName || "None"}</span>
                                </p>
                              </td>

                              {/* Today's Schedule (Actual) */}
                              <td className="py-3 px-3">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <p
                                    className={cn(
                                      "font-bold",
                                      isSwap ? "text-amber-800 underline decoration-amber-400" : "text-navy-900",
                                    )}
                                  >
                                    {c.todaySubjectName || c.todaySubjectCode || c.masterSubjectName}
                                  </p>
                                  {(c.todaySubjectName?.toUpperCase() === "CRT" || c.todaySubjectCode?.toUpperCase() === "CRT") && (
                                    <span className="rounded bg-purple-100 text-purple-800 text-[9px] font-extrabold px-1.5 py-0.5 border border-purple-200">
                                      CRT
                                    </span>
                                  )}
                                  {(c.todaySubjectName?.toUpperCase() === "LIBRARY" || c.todaySubjectCode?.toUpperCase() === "LIBRARY") && (
                                    <span className="rounded bg-teal-100 text-teal-800 text-[9px] font-extrabold px-1.5 py-0.5 border border-teal-200">
                                      Library
                                    </span>
                                  )}
                                </div>
                                <p
                                  className={cn(
                                    "text-[10px] mt-0.5",
                                    isSubstitute ? "text-sky-800 font-bold" : "text-slate-500",
                                  )}
                                >
                                  Faculty: <span className="font-medium">{c.todayFacultyName || c.masterFacultyName}</span>
                                </p>
                              </td>

                              {/* Variation Status */}
                              <td className="py-3 px-2 text-center">
                                {isUnchanged && (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                                    As Master
                                  </span>
                                )}
                                {c.varianceType === "FACULTY_SUBSTITUTE" && (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-[10px] font-bold text-amber-800 border border-amber-300">
                                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500"></span>
                                    Substitute
                                  </span>
                                )}
                                {c.varianceType === "SUBJECT_SWAP" && (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-0.5 text-[10px] font-bold text-sky-800 border border-sky-300">
                                    <span className="h-1.5 w-1.5 rounded-full bg-sky-500"></span>
                                    Swapped
                                  </span>
                                )}
                                {c.varianceType === "BOTH" && (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2.5 py-0.5 text-[10px] font-bold text-purple-800 border border-purple-300">
                                    <span className="h-1.5 w-1.5 rounded-full bg-purple-500"></span>
                                    Sub + Swap
                                  </span>
                                )}
                              </td>

                              {/* Variance Details */}
                              <td className="py-3 px-3 text-slate-600 text-[11px]">
                                {isSubstitute ? (
                                  <span className="text-amber-900 font-medium">
                                    {c.masterFacultyName?.split(" ")[0]} relieved → {c.todayFacultyName?.split(" ")[0]} covered
                                  </span>
                                ) : isSwap ? (
                                  <span className="text-sky-900 font-medium">
                                    Subject changed to {c.todaySubjectCode}
                                  </span>
                                ) : (
                                  <span className="text-slate-400 italic">Held as planned</span>
                                )}
                              </td>

                              {/* Attendance */}
                              <td className="py-3 px-3 text-center">
                                {c.isConducted && c.attendancePct != null ? (
                                  <span
                                    className={cn(
                                      "inline-block rounded-md px-2 py-0.5 text-xs font-bold",
                                      c.attendancePct >= 75
                                        ? "bg-emerald-100 text-emerald-800"
                                        : c.attendancePct >= 50
                                          ? "bg-amber-100 text-amber-800"
                                          : "bg-rose-100 text-rose-800",
                                    )}
                                  >
                                    {c.attendancePct}%
                                  </span>
                                ) : (
                                  <span className="text-[11px] text-slate-400 font-medium">Scheduled</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {/* 7. SUBJECT ANALYTICS REPORT */}
      {activeSection === "subjects" && (
        <div id="subject-analytics-table-container" ref={printAreaRef} className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-navy-900">
                Subject Delivery & Alteration Analytics
              </h4>
              <p className="text-[11px] text-slate-500">
                Class, section & subject-wise quota, conduction, faculty substitutions and attendance
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              {/* View Switcher: Class & Sec Wise (Default) vs Consolidated */}
              <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setSubjectViewMode("section-wise")}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer",
                    subjectViewMode === "section-wise"
                      ? "bg-white text-emerald-800 shadow-2xs font-bold"
                      : "text-slate-600 hover:text-slate-900",
                  )}
                >
                  Class & Sec Wise
                </button>
                <button
                  type="button"
                  onClick={() => setSubjectViewMode("consolidated")}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer",
                    subjectViewMode === "consolidated"
                      ? "bg-white text-emerald-800 shadow-2xs font-bold"
                      : "text-slate-600 hover:text-slate-900",
                  )}
                >
                  Consolidated
                </button>
              </div>

              <span className="text-xs font-semibold text-slate-600">
                {subjectViewMode === "section-wise"
                  ? `${comparisonsBySection.length} Cohort${comparisonsBySection.length !== 1 ? "s" : ""} / Section${comparisonsBySection.length !== 1 ? "s" : ""}`
                  : `${filteredSubjects.length} Subject${filteredSubjects.length !== 1 ? "s" : ""}`}
              </span>
            </div>
          </div>

          {/* Interactive In-Page Subject Focus Drill-Down Card */}
          {selectedSubjectObj && (
            <div className="rounded-xl border-2 border-emerald-400 bg-linear-to-r from-emerald-50/90 via-emerald-50/40 to-white p-4 shadow-sm animate-in fade-in">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-200 pb-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white font-bold shadow-xs">
                    <BookOpen className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-extrabold text-navy-950">{selectedSubjectObj.subjectName}</h3>
                      <span className="rounded-md bg-emerald-100 px-2.5 py-0.5 font-mono text-xs font-bold text-emerald-900 border border-emerald-200">
                        Code: {selectedSubjectObj.subjectCode}
                      </span>
                      <span className="rounded-full bg-emerald-600 text-white px-2 py-0.5 text-[10px] font-bold">
                        Direct Page Focus
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Subject Delivery, Timetable Allotment & Alteration Breakdown
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedSubjectCode(null)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-navy-900 transition-colors shadow-2xs cursor-pointer"
                >
                  ✕ Clear Subject Focus
                </button>
              </div>

              {/* Metric Highlights for this Subject */}
              <div className="mt-3.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <div className="rounded-lg bg-white p-3 border border-emerald-200 shadow-2xs">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Master Quota</span>
                  <p className="mt-1 text-xl font-extrabold text-navy-950">
                    {selectedSubjectObj.masterWeeklyPeriods}{" "}
                    <span className="text-xs font-normal text-slate-500">periods/wk</span>
                  </p>
                </div>
                <div className="rounded-lg bg-white p-3 border border-emerald-200 shadow-2xs">
                  <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Classes Conducted</span>
                  <p className="mt-1 text-xl font-extrabold text-emerald-800">
                    {selectedSubjectObj.totalConducted}{" "}
                    <span className="text-xs font-normal text-slate-500">attended</span>
                  </p>
                </div>
                <div className="rounded-lg bg-white p-3 border border-amber-200 shadow-2xs">
                  <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">Times Altered</span>
                  <p className="mt-1 text-xl font-extrabold text-amber-800">
                    {selectedSubjectObj.timesChanged}{" "}
                    <span className="text-xs font-normal text-slate-500">
                      ({selectedSubjectObj.timesSwappedOut} out / {selectedSubjectObj.timesSwappedIn} in)
                    </span>
                  </p>
                </div>
                <div className="rounded-lg bg-white p-3 border border-indigo-200 shadow-2xs">
                  <span className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider">Attendance %</span>
                  <p className="mt-1 text-xl font-extrabold text-indigo-900">
                    {selectedSubjectObj.attendancePct > 0 ? `${selectedSubjectObj.attendancePct}%` : "—"}
                  </p>
                </div>
              </div>

              {/* Assigned Faculty & Changed Faculty breakdown */}
              {(() => {
                const assigned = Array.from(subjectAssignedFacultyMap.get(selectedSubjectObj.subjectCode) ?? (selectedSubjectObj.facultyNames ?? []));
                const changed = Array.from(subjectChangedFacultyMap.get(selectedSubjectObj.subjectCode)?.values() ?? []);
                return (
                  <div className="mt-3 pt-2.5 border-t border-emerald-100 space-y-2 text-xs">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-bold text-slate-700">Assigned Faculty (Master Timetable):</span>
                      {assigned.length > 0 ? (
                        assigned.map((name, i) => (
                          <span
                            key={i}
                            className="rounded-md bg-white border border-emerald-200 px-2 py-0.5 text-xs font-semibold text-emerald-900 shadow-2xs"
                          >
                            {name}
                          </span>
                        ))
                      ) : (
                        <span className="text-slate-400 italic">Not Assigned</span>
                      )}
                    </div>
                    {changed.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-bold text-amber-900">Changed / Substitute Faculty:</span>
                        {changed.map((cf, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center gap-1 rounded-md bg-amber-50 border border-amber-200 px-2 py-0.5 text-xs font-bold text-amber-800 shadow-2xs"
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-500"></span>
                            {cf.facultyName}
                            {cf.originalFacultyName && cf.originalFacultyName !== cf.facultyName && (
                              <span className="text-[11px] font-normal text-amber-700">
                                (sub for {cf.originalFacultyName})
                              </span>
                            )}
                            {cf.count > 1 && (
                              <span className="rounded-full bg-amber-200 px-1.5 text-[10px] font-bold text-amber-900">
                                {cf.count} sessions
                              </span>
                            )}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-slate-600">
                        <span className="font-bold text-slate-700">Changed Faculty:</span>
                        <span className="text-emerald-700 font-medium">None (100% Conducted by Assigned Master Faculty)</span>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Drill-down Timetable Sessions Table for this Subject */}
              <div className="mt-3.5 pt-3 border-t border-emerald-200">
                <div className="flex items-center justify-between mb-2">
                  <h5 className="text-xs font-bold text-navy-950 uppercase tracking-wider">
                    Timetable Sessions & Delivery Records for {selectedSubjectObj.subjectCode}
                  </h5>
                  <span className="text-[11px] font-semibold text-slate-600">
                    {subjectSessions.length} Session{subjectSessions.length !== 1 ? "s" : ""} recorded
                  </span>
                </div>

                {subjectSessions.length === 0 ? (
                  <div className="rounded-lg bg-white p-4 text-center text-xs text-slate-500 border border-slate-200">
                    No scheduled comparison sessions found for {selectedSubjectObj.subjectName} in the current date filter.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-bold uppercase text-slate-600">
                          <th className="py-2 px-3">Date & Slot</th>
                          <th className="py-2 px-3">Section / Batch</th>
                          <th className="py-2 px-3">Assigned Faculty</th>
                          <th className="py-2 px-3">Actual / Substitute Faculty</th>
                          <th className="py-2 px-2 text-center">Status</th>
                          <th className="py-2 px-2 text-center">Attendance</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {subjectSessions.map((s) => (
                          <tr key={s.id} className="hover:bg-slate-50">
                            <td className="py-2 px-3">
                              <span className="font-semibold text-slate-800">{s.date}</span>
                              <span className="text-[10px] text-slate-500 block">{s.slotLabel} ({s.time})</span>
                            </td>
                            <td className="py-2 px-3">
                              <span className="font-medium text-slate-700">
                                {s.sectionName ? `Section ${cleanSectionCode(s.sectionName)}` : "All"} · Batch {s.batch}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-slate-700">
                              {s.masterFacultyName || "—"}
                            </td>
                            <td className="py-2 px-3">
                              {s.todayFacultyName && s.todayFacultyName !== s.masterFacultyName ? (
                                <span className="font-bold text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded text-[11px]">
                                  {s.todayFacultyName} (Substitute)
                                </span>
                              ) : (
                                <span className="text-slate-600">{s.todayFacultyName || s.masterFacultyName || "—"}</span>
                              )}
                            </td>
                            <td className="py-2 px-2 text-center">
                              {s.isConducted ? (
                                <span className="rounded bg-emerald-100 text-emerald-800 px-1.5 py-0.5 text-[10px] font-bold">
                                  Conducted
                                </span>
                              ) : (
                                <span className="rounded bg-slate-100 text-slate-600 px-1.5 py-0.5 text-[10px] font-medium">
                                  Scheduled
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-2 text-center font-bold text-slate-700">
                              {s.attendancePct != null ? `${s.attendancePct}%` : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {subjectViewMode === "section-wise" ? (
            <div className="space-y-4">
              {comparisonsBySection.length === 0 ? (
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white p-12 text-center text-xs text-slate-500 shadow-xs">
                  No timetable sessions or classes match the selected filters.
                </div>
              ) : (
                comparisonsBySection.map((secGroup) => {
                  const q = searchQuery.trim().toLowerCase();
                  const secSubjects = secGroup.cohortSubjects.filter((s) => {
                    if (!q) return true;
                    return (
                      s.subjectName.toLowerCase().includes(q) ||
                      s.subjectCode.toLowerCase().includes(q) ||
                      s.assignedFaculty.some((f) => f.toLowerCase().includes(q)) ||
                      s.changedFaculty.some((cf) => cf.facultyName.toLowerCase().includes(q))
                    );
                  });

                  if (q && secSubjects.length === 0) {
                    return null;
                  }

                  const secAvgAttendance = (() => {
                    const withAtt = secSubjects.filter((s) => s.totalConducted > 0 && s.effectiveAttendancePct != null && s.effectiveAttendancePct > 0);
                    if (withAtt.length === 0) return null;
                    return Math.round(
                      withAtt.reduce((acc, s) => acc + (s.effectiveAttendancePct ?? 0), 0) / withAtt.length,
                    );
                  })();

                  const secTotalChanges = secSubjects.reduce((acc, s) => acc + s.timesChanged, 0);
                  const secTotalConducted = secSubjects.reduce((acc, s) => acc + s.totalConducted, 0);

                  return (
                    <div
                      key={secGroup.sectionKey}
                      className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs"
                    >
                      {/* Distinct Section Header Banner */}
                      <div className="border-b border-slate-200 bg-linear-to-r from-slate-50 via-emerald-50/20 to-slate-50 px-4 py-3 flex flex-wrap items-center justify-between gap-2.5">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-700 text-white font-black text-sm shadow-2xs">
                            {secGroup.sectionLetter !== "Unassigned" ? secGroup.sectionLetter : "S"}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="text-sm font-bold text-navy-950">
                                {secGroup.sectionTitle}
                              </h4>
                              <span className="rounded bg-indigo-50 border border-indigo-200 px-2 py-0.5 text-[10px] font-bold text-indigo-700">
                                {secGroup.branchCode}
                              </span>
                              <span className="rounded bg-slate-200/80 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                                Batch {secGroup.batch}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-500">
                              {secSubjects.length} subjects registered · {secTotalConducted} classes conducted in period
                            </p>
                          </div>
                        </div>

                        {/* Section Summary Badges */}
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                            {secTotalConducted} Conducted
                          </span>
                          {secTotalChanges > 0 ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-[10px] font-bold text-amber-800 border border-amber-200">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-500"></span>
                              {secTotalChanges} Alterations
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800 border border-emerald-200">
                              100% As Master
                            </span>
                          )}
                          {secAvgAttendance != null ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-0.5 text-[10px] font-bold text-indigo-800 border border-indigo-200">
                              {secAvgAttendance}% Avg Attendance
                            </span>
                          ) : (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                              Attendance Pending
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Subjects Table for this Section */}
                      <div className="overflow-x-auto">
                        {secSubjects.length === 0 ? (
                          <div className="p-6 text-center text-xs text-slate-400">
                            No subjects recorded for this class & section in the selected timeframe.
                          </div>
                        ) : (
                          <table className="w-full text-left text-xs">
                            <thead>
                              <tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                                <th className="py-2.5 px-3">Subject Name & Code</th>
                                <th className="py-2.5 px-2 text-center">Master Quota</th>
                                <th className="py-2.5 px-2 text-center">Conducted</th>
                                <th className="py-2.5 px-3">Assigned Faculty</th>
                                <th className="py-2.5 px-3">Changed Faculty</th>
                                <th className="py-2.5 px-2 text-center">Swapped Out</th>
                                <th className="py-2.5 px-2 text-center">Swapped In</th>
                                <th className="py-2.5 px-2 text-center">Total Changes</th>
                                <th className="py-2.5 px-2 text-center">Attendance %</th>
                                <th className="py-2.5 px-3 text-right">Action</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {secSubjects.map((sub) => {
                                const isSelected = activeSubjectModal?.subjectCode === sub.subjectCode;

                                return (
                                  <tr
                                    key={sub.subjectCode}
                                    onClick={() => {
                                      openSubjectModal(sub, {
                                        cohortTitle: secGroup.sectionTitle,
                                        branchCode: secGroup.branchCode,
                                        batch: secGroup.batch,
                                        sectionLetter: secGroup.sectionLetter,
                                      });
                                    }}
                                    className={cn(
                                      "cursor-pointer hover:bg-slate-50/90 transition-colors group",
                                      isSelected
                                        ? "bg-emerald-50/70 border-l-4 border-l-emerald-600 font-medium"
                                        : "",
                                    )}
                                  >
                                    {/* 1. Subject Name & Code */}
                                    <td className="py-3 px-3">
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <p className="font-bold text-navy-900 group-hover:text-emerald-800 transition-colors">
                                          {sub.subjectName}
                                        </p>
                                        {isSelected && (
                                          <span className="rounded bg-emerald-600 text-white text-[9px] font-bold px-1.5 py-0.2 shadow-2xs">
                                            Viewing ✓
                                          </span>
                                        )}
                                      </div>
                                      <span className="font-mono text-[10px] text-slate-400 block mt-0.5">
                                        {sub.subjectCode}
                                      </span>
                                    </td>

                                    {/* 2. Master Quota */}
                                    <td className="py-3 px-2 text-center font-semibold text-slate-800">
                                      {sub.masterWeeklyPeriods > 0 ? sub.masterWeeklyPeriods : (sub.totalScheduled || "—")}
                                    </td>

                                    {/* 3. Conducted */}
                                    <td className="py-3 px-2 text-center font-bold text-emerald-700">
                                      {sub.totalConducted}
                                    </td>

                                    {/* 4. Assigned Faculty */}
                                    <td className="py-3 px-3 text-slate-600">
                                      {sub.assignedFaculty.length === 0 ? (
                                        <span className="text-slate-400 text-[11px] italic">Not Assigned</span>
                                      ) : (
                                        <div className="flex flex-wrap gap-1 max-w-xs">
                                          {sub.assignedFaculty.map((name, i) => (
                                            <button
                                              key={i}
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                openStaffModalByName(name);
                                              }}
                                              className="rounded bg-slate-100 hover:bg-slate-200 border border-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-800 transition-colors cursor-pointer"
                                              title={`Click to view ${name}'s details & action log`}
                                            >
                                              {name}
                                            </button>
                                          ))}
                                        </div>
                                      )}
                                    </td>

                                    {/* 5. Changed Faculty (DIRECTLY NEXT TO ASSIGNED FACULTY) */}
                                    <td className="py-3 px-3">
                                      {sub.changedFaculty.length === 0 ? (
                                        <span className="text-slate-400 text-[11px] italic">No Change (As Master)</span>
                                      ) : (
                                        <div className="flex flex-wrap gap-1 max-w-xs">
                                          {sub.changedFaculty.map((cf, idx) => (
                                            <button
                                              key={idx}
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                openStaffModalByName(cf.facultyName);
                                              }}
                                              className="inline-flex items-center gap-1 rounded bg-amber-50 hover:bg-amber-100 border border-amber-200 px-2 py-0.5 text-[11px] font-bold text-amber-800 shadow-2xs transition-colors cursor-pointer"
                                              title={
                                                cf.originalFacultyName
                                                  ? `Substituted for ${cf.originalFacultyName} (${cf.count} session${cf.count !== 1 ? "s" : ""}) - Click to view ${cf.facultyName}'s action log`
                                                  : `Substitute faculty (${cf.count} session${cf.count !== 1 ? "s" : ""}) - Click to view ${cf.facultyName}'s action log`
                                              }
                                            >
                                              <span className="h-1.5 w-1.5 rounded-full bg-amber-500"></span>
                                              {cf.facultyName}
                                              {cf.originalFacultyName && cf.originalFacultyName !== cf.facultyName && (
                                                <span className="text-[10px] font-normal text-amber-700">
                                                  (sub for {cf.originalFacultyName})
                                                </span>
                                              )}
                                              {cf.count > 1 && (
                                                <span className="rounded-full bg-amber-200 px-1 text-[9px] font-bold text-amber-900">
                                                  ×{cf.count}
                                                </span>
                                              )}
                                            </button>
                                          ))}
                                        </div>
                                      )}
                                    </td>

                                    {/* 6. Swapped Out */}
                                    <td className="py-3 px-2 text-center font-medium text-rose-600">
                                      {sub.timesSwappedOut > 0 ? sub.timesSwappedOut : 0}
                                    </td>

                                    {/* 7. Swapped In */}
                                    <td className="py-3 px-2 text-center font-medium text-emerald-600">
                                      {sub.timesSwappedIn > 0 ? sub.timesSwappedIn : 0}
                                    </td>

                                    {/* 8. Total Changes */}
                                    <td className="py-3 px-2 text-center font-bold">
                                      {sub.timesChanged > 0 ? (
                                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800 font-bold">
                                          {sub.timesChanged}
                                        </span>
                                      ) : (
                                        <span className="text-slate-400">0</span>
                                      )}
                                    </td>

                                    {/* 9. Attendance % */}
                                    <td className="py-3 px-2 text-center">
                                      <div className="flex flex-col items-center justify-center">
                                        {sub.effectiveAttendancePct != null && sub.effectiveAttendancePct > 0 ? (
                                          <span
                                            className={cn(
                                              "inline-block rounded-md px-2 py-0.5 text-xs font-bold shadow-2xs",
                                              sub.effectiveAttendancePct >= 75
                                                ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                                                : sub.effectiveAttendancePct >= 50
                                                  ? "bg-amber-100 text-amber-800 border border-amber-200"
                                                  : "bg-rose-100 text-rose-800 border border-rose-200",
                                            )}
                                          >
                                            {sub.effectiveAttendancePct}%
                                          </span>
                                        ) : sub.totalConducted > 0 && sub.turnoutPct != null ? (
                                          <span className="inline-block rounded-md px-2 py-0.5 text-xs font-bold bg-slate-100 text-slate-700">
                                            {sub.turnoutPct}%
                                          </span>
                                        ) : (
                                          <span className="text-slate-400 font-medium text-xs">—</span>
                                        )}

                                        {/* Explanatory subtext for accurate date range context */}
                                        {sub.totalScheduled > sub.totalConducted && sub.totalConducted > 0 && (
                                          <span className="text-[10px] text-slate-500 font-medium mt-0.5">
                                            {sub.totalConducted}/{sub.totalScheduled} held
                                            {sub.turnoutPct != null && ` (${sub.turnoutPct}% turnout)`}
                                          </span>
                                        )}
                                        {sub.totalScheduled <= sub.totalConducted && sub.totalConducted > 0 && sub.turnoutPct != null && (
                                          <span className="text-[10px] text-slate-500 font-medium mt-0.5">
                                            {sub.turnoutPct}% turnout
                                          </span>
                                        )}
                                        {sub.totalConducted === 0 && sub.totalScheduled > 0 && (
                                          <span className="text-[10px] text-slate-400 mt-0.5">
                                            0/{sub.totalScheduled} held
                                          </span>
                                        )}
                                      </div>
                                    </td>

                                    {/* 10. Action Button */}
                                    <td className="py-3 px-3 text-right">
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          openSubjectModal(sub, {
                                            cohortTitle: secGroup.sectionTitle,
                                            branchCode: secGroup.branchCode,
                                            batch: secGroup.batch,
                                            sectionLetter: secGroup.sectionLetter,
                                          });
                                        }}
                                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-[11px] px-2.5 py-1.5 shadow-xs transition-colors cursor-pointer"
                                        title="View subject details, faculty allotment & action history"
                                      >
                                        <Eye className="h-3.5 w-3.5" />
                                        <span>View Actions</span>
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          ) : (
            /* Consolidated Subjects Table */
            <div className="overflow-x-auto">
              {filteredSubjects.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  No subject records match the selected filters.
                </div>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                      <th className="py-2.5 px-3">Subject Name & Code</th>
                      <th className="py-2.5 px-2 text-center">Master Quota</th>
                      <th className="py-2.5 px-2 text-center">Conducted</th>
                      <th className="py-2.5 px-3">Assigned Faculty</th>
                      <th className="py-2.5 px-3">Changed Faculty</th>
                      <th className="py-2.5 px-2 text-center">Swapped Out</th>
                      <th className="py-2.5 px-2 text-center">Swapped In</th>
                      <th className="py-2.5 px-2 text-center">Total Changes</th>
                      <th className="py-2.5 px-2 text-center">Attendance %</th>
                      <th className="py-2.5 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredSubjects.map((sub) => {
                      const assigned = Array.from(subjectAssignedFacultyMap.get(sub.subjectCode) ?? (sub.facultyNames ?? []));
                      const changedList = Array.from(subjectChangedFacultyMap.get(sub.subjectCode)?.values() ?? []);
                      const isSelected = activeSubjectModal?.subjectCode === sub.subjectCode;

                      // Accurate date range attendance:
                      const turnout = sub.turnoutPct ?? sub.attendancePct ?? 100;
                      const scheduled = sub.totalScheduled || sub.totalConducted || 0;
                      const effectivePct =
                        sub.totalConducted > 0 && scheduled > 0
                          ? (dateMode === "range" && scheduled > sub.totalConducted
                              ? Math.round((sub.totalConducted / scheduled) * turnout)
                              : sub.attendancePct)
                          : (sub.totalConducted > 0 ? sub.attendancePct : 0);

                      return (
                        <tr
                          key={sub.subjectCode}
                          onClick={() => {
                            openSubjectModal(sub);
                          }}
                          className={cn(
                            "cursor-pointer hover:bg-slate-50/90 transition-colors group",
                            isSelected ? "bg-emerald-50/70 border-l-4 border-l-emerald-600 font-medium" : "",
                          )}
                        >
                          {/* 1. Subject Name & Code */}
                          <td className="py-3 px-3">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="font-bold text-navy-900 group-hover:text-emerald-800 transition-colors">
                                {sub.subjectName}
                              </p>
                              {isSelected && (
                                <span className="rounded bg-emerald-600 text-white text-[9px] font-bold px-1.5 py-0.2 shadow-2xs">
                                  Viewing ✓
                                </span>
                              )}
                            </div>
                            <span className="font-mono text-[10px] text-slate-400 block mt-0.5">{sub.subjectCode}</span>
                          </td>

                          {/* 2. Master Quota */}
                          <td className="py-3 px-2 text-center font-semibold text-slate-800">
                            {sub.masterWeeklyPeriods}
                          </td>

                          {/* 3. Conducted */}
                          <td className="py-3 px-2 text-center font-bold text-emerald-700">
                            {sub.totalConducted}
                          </td>

                          {/* 4. Assigned Faculty */}
                          <td className="py-3 px-3 text-slate-600">
                            {assigned.length === 0 ? (
                              <span className="text-slate-400 text-[11px] italic">Not Assigned</span>
                            ) : (
                              <div className="flex flex-wrap gap-1 max-w-xs">
                                {assigned.map((name, i) => (
                                  <button
                                    key={i}
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openStaffModalByName(name);
                                    }}
                                    className="rounded bg-slate-100 hover:bg-slate-200 border border-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-800 transition-colors cursor-pointer"
                                    title={`Click to view ${name}'s action log`}
                                  >
                                    {name}
                                  </button>
                                ))}
                              </div>
                            )}
                          </td>

                          {/* 5. Changed Faculty (DIRECTLY NEXT TO ASSIGNED FACULTY) */}
                          <td className="py-3 px-3">
                            {changedList.length === 0 ? (
                              <span className="text-slate-400 text-[11px] italic">No Change (As Master)</span>
                            ) : (
                              <div className="flex flex-wrap gap-1 max-w-xs">
                                {changedList.map((cf, idx) => (
                                  <button
                                    key={idx}
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openStaffModalByName(cf.facultyName);
                                    }}
                                    className="inline-flex items-center gap-1 rounded bg-amber-50 hover:bg-amber-100 border border-amber-200 px-2 py-0.5 text-[11px] font-bold text-amber-800 shadow-2xs transition-colors cursor-pointer"
                                    title={cf.originalFacultyName ? `Substituted for ${cf.originalFacultyName} (${cf.count} session${cf.count !== 1 ? "s" : ""}) - Click to view ${cf.facultyName}'s action log` : `Substitute faculty (${cf.count} session${cf.count !== 1 ? "s" : ""}) - Click to view ${cf.facultyName}'s action log`}
                                  >
                                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500"></span>
                                    {cf.facultyName}
                                    {cf.originalFacultyName && cf.originalFacultyName !== cf.facultyName && (
                                      <span className="text-[10px] font-normal text-amber-700">
                                        (sub for {cf.originalFacultyName})
                                      </span>
                                    )}
                                    {cf.count > 1 && (
                                      <span className="rounded-full bg-amber-200 px-1 text-[9px] font-bold text-amber-900">
                                        ×{cf.count}
                                      </span>
                                    )}
                                  </button>
                                ))}
                              </div>
                            )}
                          </td>

                          {/* 6. Swapped Out */}
                          <td className="py-3 px-2 text-center font-medium text-rose-600">
                            {sub.timesSwappedOut > 0 ? sub.timesSwappedOut : 0}
                          </td>

                          {/* 7. Swapped In */}
                          <td className="py-3 px-2 text-center font-medium text-emerald-600">
                            {sub.timesSwappedIn > 0 ? sub.timesSwappedIn : 0}
                          </td>

                          {/* 8. Total Changes */}
                          <td className="py-3 px-2 text-center font-bold">
                            {sub.timesChanged > 0 ? (
                              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800 font-bold">
                                {sub.timesChanged}
                              </span>
                            ) : (
                              <span className="text-slate-400">0</span>
                            )}
                          </td>

                          {/* 9. Attendance % */}
                          <td className="py-3 px-2 text-center font-bold text-slate-700">
                            <div className="flex flex-col items-center justify-center">
                              {effectivePct > 0 ? (
                                <span
                                  className={cn(
                                    "inline-block rounded-md px-2 py-0.5 text-xs font-bold shadow-2xs",
                                    effectivePct >= 75
                                      ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                                      : effectivePct >= 50
                                        ? "bg-amber-100 text-amber-800 border border-amber-200"
                                        : "bg-rose-100 text-rose-800 border border-rose-200",
                                  )}
                                >
                                  {effectivePct}%
                                </span>
                              ) : (
                                <span className="text-slate-400 font-medium text-xs">—</span>
                              )}

                              {scheduled > sub.totalConducted && sub.totalConducted > 0 && (
                                <span className="text-[10px] text-slate-500 font-medium mt-0.5">
                                  {sub.totalConducted}/{scheduled} held
                                  {turnout != null && ` (${turnout}% turnout)`}
                                </span>
                              )}
                              {scheduled <= sub.totalConducted && sub.totalConducted > 0 && (
                                <span className="text-[10px] text-slate-500 font-medium mt-0.5">
                                  {turnout}% turnout
                                </span>
                              )}
                              {sub.totalConducted === 0 && scheduled > 0 && (
                                <span className="text-[10px] text-slate-400 mt-0.5">
                                  0/{scheduled} held
                                </span>
                              )}
                            </div>
                          </td>

                          {/* 10. Action Pop-up Button */}
                          <td className="py-3 px-3 text-right">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openSubjectModal(sub);
                              }}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-[11px] px-2.5 py-1.5 shadow-xs transition-colors cursor-pointer"
                              title="View subject details, faculty allotment & action history"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              <span>View Actions</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}

      {/* 8. STAFF ANALYTICS REPORT */}
      {activeSection === "staff" && (
        <div id="staff-analytics-table-container" ref={printAreaRef} className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-navy-900">
                Faculty Teaching Load & Substitution Report
              </h4>
              <p className="text-[11px] text-slate-500">
                Classes assigned, attended, relief substitution given, and extra classes covered
              </p>
            </div>
            <span className="text-xs font-semibold text-slate-600">
              {filteredFaculties.length} Faculty
            </span>
          </div>

          {/* Interactive In-Page Staff Focus Drill-Down Card */}
          {selectedStaffObj && (
            <div className="rounded-xl border-2 border-amber-400 bg-linear-to-r from-amber-50/90 via-amber-50/40 to-white p-4 shadow-sm animate-in fade-in">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 pb-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500 text-white font-bold shadow-xs">
                    <UserCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-extrabold text-navy-950">{selectedStaffObj.facultyName}</h3>
                      <span className="rounded-md bg-amber-100 px-2.5 py-0.5 font-mono text-xs font-bold text-amber-900 border border-amber-200">
                        HRMS ID: {selectedStaffObj.hrmsId}
                      </span>
                      <span className="rounded-full bg-amber-500 text-white px-2 py-0.5 text-[10px] font-bold">
                        Direct Page Focus
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Faculty Teaching Load, Substitution & Schedule Breakdown
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedStaffHrmsId(null)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-navy-900 transition-colors shadow-2xs cursor-pointer"
                >
                  ✕ Clear Staff Focus
                </button>
              </div>

              {/* Metric Highlights for this Staff */}
              <div className="mt-3.5 grid grid-cols-2 gap-2.5 sm:grid-cols-5">
                <div className="rounded-lg bg-white p-3 border border-amber-200 shadow-2xs">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Master Assigned</span>
                  <p className="mt-1 text-xl font-extrabold text-navy-950">
                    {selectedStaffObj.masterAssignedPeriods}{" "}
                    <span className="text-xs font-normal text-slate-500">classes</span>
                  </p>
                </div>
                <div className="rounded-lg bg-white p-3 border border-emerald-200 shadow-2xs">
                  <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Classes Conducted</span>
                  <p className="mt-1 text-xl font-extrabold text-emerald-800">
                    {selectedStaffObj.classesConducted}{" "}
                    <span className="text-xs font-normal text-slate-500">attended</span>
                  </p>
                </div>
                <div className="rounded-lg bg-white p-3 border border-rose-200 shadow-2xs">
                  <span className="text-[10px] font-bold text-rose-700 uppercase tracking-wider">Relieved (Out)</span>
                  <p className="mt-1 text-xl font-extrabold text-rose-700">
                    {selectedStaffObj.relievedCount}{" "}
                    <span className="text-xs font-normal text-slate-500">classes</span>
                  </p>
                </div>
                <div className="rounded-lg bg-white p-3 border border-sky-200 shadow-2xs">
                  <span className="text-[10px] font-bold text-sky-700 uppercase tracking-wider">Substitutions (In)</span>
                  <p className="mt-1 text-xl font-extrabold text-sky-800">
                    {selectedStaffObj.substituteTakenCount}{" "}
                    <span className="text-xs font-normal text-slate-500">classes</span>
                  </p>
                </div>
                <div className="rounded-lg bg-white p-3 border border-indigo-200 shadow-2xs">
                  <span className="text-[10px] font-bold text-indigo-700 uppercase tracking-wider">Net Teaching Load</span>
                  <p className="mt-1 text-xl font-extrabold text-indigo-900">
                    {selectedStaffObj.netTeachingCount}{" "}
                    <span className="text-xs font-normal text-slate-500">total</span>
                  </p>
                </div>
              </div>

              {/* Assigned Subjects */}
              {selectedStaffObj.subjects && selectedStaffObj.subjects.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs pt-2.5 border-t border-amber-100">
                  <span className="font-bold text-slate-700">Assigned Subjects:</span>
                  {selectedStaffObj.subjects.map((sub, i) => (
                    <span
                      key={i}
                      className="rounded-md bg-white border border-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-900 shadow-2xs"
                    >
                      {sub}
                    </span>
                  ))}
                </div>
              )}

              {/* Drill-down Sessions Table for this Staff */}
              <div className="mt-3.5 pt-3 border-t border-amber-200">
                <div className="flex items-center justify-between mb-2">
                  <h5 className="text-xs font-bold text-navy-950 uppercase tracking-wider">
                    Teaching & Substitution Sessions for {selectedStaffObj.facultyName} (#{selectedStaffObj.hrmsId})
                  </h5>
                  <span className="text-[11px] font-semibold text-slate-600">
                    {staffSessions.length} Session{staffSessions.length !== 1 ? "s" : ""} recorded
                  </span>
                </div>

                {staffSessions.length === 0 ? (
                  <div className="rounded-lg bg-white p-4 text-center text-xs text-slate-500 border border-slate-200">
                    No teaching sessions found for {selectedStaffObj.facultyName} in the current date filter.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-bold uppercase text-slate-600">
                          <th className="py-2 px-3">Date & Slot</th>
                          <th className="py-2 px-3">Subject</th>
                          <th className="py-2 px-3">Section / Batch</th>
                          <th className="py-2 px-3">Teaching Role</th>
                          <th className="py-2 px-2 text-center">Status</th>
                          <th className="py-2 px-2 text-center">Attendance</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {staffSessions.map((s) => {
                          const isSubstituteIn = s.todayFacultyHrmsId === selectedStaffObj.hrmsId && s.masterFacultyHrmsId !== selectedStaffObj.hrmsId;
                          const isRelievedOut = s.masterFacultyHrmsId === selectedStaffObj.hrmsId && s.todayFacultyHrmsId !== selectedStaffObj.hrmsId;
                          return (
                            <tr key={s.id} className="hover:bg-slate-50">
                              <td className="py-2 px-3">
                                <span className="font-semibold text-slate-800">{s.date}</span>
                                <span className="text-[10px] text-slate-500 block">{s.slotLabel} ({s.time})</span>
                              </td>
                              <td className="py-2 px-3">
                                <p className="font-bold text-navy-900">{s.todaySubjectName || s.masterSubjectName}</p>
                                <span className="font-mono text-[10px] text-slate-400">{s.todaySubjectCode || s.masterSubjectCode}</span>
                              </td>
                              <td className="py-2 px-3 text-slate-700">
                                {s.sectionName ? `Section ${cleanSectionCode(s.sectionName)}` : "All"} · Batch {s.batch}
                              </td>
                              <td className="py-2 px-3">
                                {isSubstituteIn ? (
                                  <span className="inline-flex items-center gap-1 rounded bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-800">
                                    Substitute Taken (+) <span className="text-[9px] font-normal text-sky-700">for {s.masterFacultyName}</span>
                                  </span>
                                ) : isRelievedOut ? (
                                  <span className="inline-flex items-center gap-1 rounded bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800">
                                    Relieved Away (-) <span className="text-[9px] font-normal text-rose-700">covered by {s.todayFacultyName}</span>
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                                    Regular Assigned
                                  </span>
                                )}
                              </td>
                              <td className="py-2 px-2 text-center">
                                {s.isConducted ? (
                                  <span className="rounded bg-emerald-100 text-emerald-800 px-1.5 py-0.5 text-[10px] font-bold">
                                    Conducted
                                  </span>
                                ) : (
                                  <span className="rounded bg-slate-100 text-slate-600 px-1.5 py-0.5 text-[10px] font-medium">
                                    Scheduled
                                  </span>
                                )}
                              </td>
                              <td className="py-2 px-2 text-center font-bold text-slate-700">
                                {s.attendancePct != null ? `${s.attendancePct}%` : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            {filteredFaculties.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                No faculty records match the selected filters.
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-bold uppercase text-slate-600">
                    <th className="py-2.5 px-3">Faculty Name</th>
                    <th className="py-2.5 px-2">HRMS ID</th>
                    <th className="py-2.5 px-3">Assigned Subjects</th>
                    <th className="py-2.5 px-2 text-center">Master Quota</th>
                    <th className="py-2.5 px-2 text-center">Conducted</th>
                    <th className="py-2.5 px-2 text-center">Relieved (Out)</th>
                    <th className="py-2.5 px-2 text-center">Substitute (In)</th>
                    <th className="py-2.5 px-2 text-center">Net Load</th>
                    <th className="py-2.5 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredFaculties.map((f) => (
                    <tr
                      key={f.hrmsId}
                      onClick={() => {
                        setActiveStaffModal(f);
                        setStaffModalSearch("");
                      }}
                      className={cn(
                        "cursor-pointer hover:bg-amber-50/70 transition-colors group",
                        activeStaffModal?.hrmsId === f.hrmsId ? "bg-amber-50/90 border-l-4 border-l-amber-500 font-medium" : "",
                      )}
                    >
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2">
                          <div className="h-7 w-7 rounded-full bg-slate-100 border border-slate-300 flex items-center justify-center font-bold text-[10px] text-slate-700">
                            {f.facultyName.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-bold text-navy-900 group-hover:text-amber-900 transition-colors">{f.facultyName}</p>
                            {activeStaffModal?.hrmsId === f.hrmsId && (
                              <span className="rounded bg-amber-600 text-white text-[9px] font-bold px-1.5 py-0.2 shadow-2xs">
                                Viewing ✓
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-2 font-mono text-[11px] text-slate-500">#{f.hrmsId}</td>
                      <td className="py-3 px-3 text-slate-600">
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {f.subjects.map((sub, i) => (
                            <span key={i} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px]">
                              {sub}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-3 px-2 text-center font-semibold text-slate-800">
                        {f.masterAssignedPeriods}
                      </td>
                      <td className="py-3 px-2 text-center font-bold text-emerald-700">
                        {f.classesConducted}
                      </td>
                      <td className="py-3 px-2 text-center font-bold text-rose-600">
                        {f.relievedCount > 0 ? `-${f.relievedCount}` : "0"}
                      </td>
                      <td className="py-3 px-2 text-center font-bold text-sky-600">
                        {f.substituteTakenCount > 0 ? `+${f.substituteTakenCount}` : "0"}
                      </td>
                      <td className="py-3 px-2 text-center font-extrabold text-navy-950">
                        {f.netTeachingCount}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveStaffModal(f);
                            setStaffModalSearch("");
                          }}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-navy-900 hover:bg-navy-800 text-white font-semibold text-[11px] px-2.5 py-1.5 shadow-xs transition-colors cursor-pointer"
                          title={`View ${f.facultyName}'s full profile, workload, and action history`}
                        >
                          <Eye className="h-3.5 w-3.5" />
                          <span>View Actions</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* 9. CHANGE AUDIT LOG */}
      {activeSection === "audit" && (
        <div ref={printAreaRef} className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="border-b border-slate-100 pb-3 mb-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-navy-900">
              Official Timetable Alteration History
            </h4>
            <p className="text-[11px] text-slate-500">
              Audit trail of every approved faculty substitution, period swap, and alteration
            </p>
          </div>

          <div className="overflow-x-auto">
            {filteredRecentChanges.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                No timetable alterations recorded matching the filters.
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-bold uppercase text-slate-600">
                    <th className="py-2.5 px-3">Date & Slot</th>
                    <th className="py-2.5 px-2">Batch</th>
                    <th className="py-2.5 px-3">Master (Before)</th>
                    <th className="py-2.5 px-3">Actual (After)</th>
                    <th className="py-2.5 px-2 text-center">Type</th>
                    <th className="py-2.5 px-3">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredRecentChanges.map((change) => (
                    <tr key={change.id} className="hover:bg-slate-50">
                      <td className="py-3 px-3">
                        <p className="font-bold text-navy-900">{change.timetableDate}</p>
                        <p className="text-[10px] text-slate-500 font-mono">
                          {change.slotLabel} ({change.slotTime})
                        </p>
                      </td>
                      <td className="py-3 px-2">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-800">
                          Batch {change.batch} {change.sectionName ? `· Sec ${change.sectionName}` : ""}
                        </span>
                      </td>
                      <td className="py-3 px-3">
                        <p className="font-semibold text-slate-800">
                          {change.masterSubjectName || change.masterSubjectCode || "None"}
                        </p>
                        <p className="text-[10px] text-slate-500">
                          Faculty: {change.masterFacultyName || "None"}
                        </p>
                      </td>
                      <td className="py-3 px-3">
                        <p className="font-bold text-amber-900">
                          {change.newSubjectName || change.newSubjectCode || change.masterSubjectName}
                        </p>
                        <p className="text-[10px] text-sky-800 font-bold">
                          Faculty: {change.newFacultyName || change.masterFacultyName}
                        </p>
                      </td>
                      <td className="py-3 px-2 text-center">
                        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-bold text-amber-800">
                          {change.varianceType}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-slate-600 italic text-[11px]">
                        {change.remarks || "No remarks"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>

      {/* 11. Interactive KPI Drilldown Slide-Over Pop Card Drawer */}
      {activeKpiDrawer && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity duration-300 animate-in fade-in"
            onClick={() => setActiveKpiDrawer(null)}
          />

          {/* Side Drawer Card */}
          <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
            <div className="w-screen max-w-xl bg-white shadow-2xl border-l border-slate-200 flex flex-col transform transition-transform duration-300 ease-in-out animate-in slide-in-from-right">
              {/* Drawer Header */}
              <div
                className={cn(
                  "p-4 border-b flex items-start justify-between gap-3",
                  activeKpiDrawer === "substituted"
                    ? "bg-sky-50/80 border-sky-100"
                    : activeKpiDrawer === "changed"
                      ? "bg-amber-50/80 border-amber-100"
                      : activeKpiDrawer === "swapped"
                        ? "bg-purple-50/80 border-purple-100"
                        : activeKpiDrawer === "conducted"
                          ? "bg-emerald-50/80 border-emerald-100"
                          : activeKpiDrawer === "master"
                            ? "bg-blue-50/80 border-blue-100"
                            : "bg-rose-50/80 border-rose-100",
                )}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl font-bold shadow-xs",
                      activeKpiDrawer === "substituted"
                        ? "bg-sky-600 text-white"
                        : activeKpiDrawer === "changed"
                          ? "bg-amber-600 text-white"
                          : activeKpiDrawer === "swapped"
                            ? "bg-purple-600 text-white"
                            : activeKpiDrawer === "conducted"
                              ? "bg-emerald-600 text-white"
                              : activeKpiDrawer === "master"
                                ? "bg-blue-600 text-white"
                                : "bg-rose-600 text-white",
                    )}
                  >
                    {activeKpiDrawer === "substituted" && <UserCheck className="h-5 w-5" />}
                    {activeKpiDrawer === "changed" && <AlertTriangle className="h-5 w-5" />}
                    {activeKpiDrawer === "swapped" && <ArrowLeftRight className="h-5 w-5" />}
                    {activeKpiDrawer === "conducted" && <CheckCircle2 className="h-5 w-5" />}
                    {activeKpiDrawer === "master" && <BookOpen className="h-5 w-5" />}
                    {activeKpiDrawer === "rate" && <Percent className="h-5 w-5" />}
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-navy-950">
                        {activeKpiDrawer === "substituted" && "Faculty Substitutions"}
                        {activeKpiDrawer === "changed" && "Classes Changed / Altered"}
                        {activeKpiDrawer === "swapped" && "Subject Swapped"}
                        {activeKpiDrawer === "conducted" && "Conducted Classes"}
                        {activeKpiDrawer === "master" &&
                          (dateMode === "today" ? "Today's Master Schedule" : "Master Timetable Schedule")}
                        {activeKpiDrawer === "rate" && "Timetable Variance Rate"}
                      </h3>
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-0.5 text-[11px] font-bold border",
                          activeKpiDrawer === "substituted"
                            ? "bg-sky-100 text-sky-800 border-sky-200"
                            : activeKpiDrawer === "changed"
                              ? "bg-amber-100 text-amber-900 border-amber-200"
                              : activeKpiDrawer === "swapped"
                                ? "bg-purple-100 text-purple-900 border-purple-200"
                                : activeKpiDrawer === "conducted"
                                  ? "bg-emerald-100 text-emerald-900 border-emerald-200"
                                  : activeKpiDrawer === "master"
                                    ? "bg-blue-100 text-blue-900 border-blue-200"
                                    : "bg-rose-100 text-rose-900 border-rose-200",
                        )}
                      >
                        {activeKpiDrawer === "substituted" && `${filteredDrawerSubstitutions.length} record(s)`}
                        {activeKpiDrawer === "changed" && `${filteredDrawerChanges.length} record(s)`}
                        {activeKpiDrawer === "swapped" && `${filteredDrawerSwaps.length} record(s)`}
                        {activeKpiDrawer === "conducted" && `${filteredDrawerConducted.length} session(s)`}
                        {activeKpiDrawer === "master" && `${filteredDrawerMasterScheduled.length} scheduled period(s)`}
                        {activeKpiDrawer === "rate" && `${summary.overallChangeRatePct}% deviation`}
                      </span>
                    </div>

                    <p className="mt-0.5 text-xs text-slate-600">
                      {activeKpiDrawer === "substituted" &&
                        "Who was scheduled (relieved) vs who stepped in and took over the lecture"}
                      {activeKpiDrawer === "changed" &&
                        "Full comparison of original master lecture vs what was actually conducted"}
                      {activeKpiDrawer === "swapped" &&
                        "Periods where the master scheduled subject was exchanged for another subject"}
                      {activeKpiDrawer === "conducted" &&
                        "Sessions held with verified student attendance marked and counts"}
                      {activeKpiDrawer === "master" &&
                        "Teaching periods scheduled in master timetable (strictly excluding lunch & normal breaks)"}
                      {activeKpiDrawer === "rate" &&
                        "Breakdown of master plan stability, substitutions, and timetable variance"}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setActiveKpiDrawer(null)}
                  className="rounded-lg p-1.5 text-slate-400 hover:text-navy-950 hover:bg-slate-200/60 transition-colors cursor-pointer"
                  title="Close pop card (Esc)"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* In-Drawer Quick Search & Filter Bar */}
              {activeKpiDrawer !== "rate" && (
                <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                    <input
                      type="text"
                      value={drawerSearch}
                      onChange={(e) => setDrawerSearch(e.target.value)}
                      placeholder={
                        activeKpiDrawer === "substituted"
                          ? "Filter by relieved teacher, reliever, subject, slot..."
                          : activeKpiDrawer === "changed"
                            ? "Filter by subject, teacher, slot, section..."
                            : "Filter results..."
                      }
                      className="w-full rounded-lg border border-slate-200 bg-white pl-8.5 pr-8 py-1.5 text-xs text-navy-950 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    {drawerSearch && (
                      <button
                        type="button"
                        onClick={() => setDrawerSearch("")}
                        className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 cursor-pointer"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Scrollable Content Body */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50">
                {/* 1. FACULTY SUBSTITUTED DRILLDOWN */}
                {activeKpiDrawer === "substituted" && (
                  <>
                    {filteredDrawerSubstitutions.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
                        <UserCheck className="mx-auto h-8 w-8 text-slate-400 mb-2" />
                        <h4 className="text-sm font-bold text-navy-950">No Faculty Substitutions Found</h4>
                        <p className="mt-1 text-xs text-slate-500">
                          {drawerSearch
                            ? `No substitutions matching "${drawerSearch}".`
                            : "All scheduled teachers conducted their classes as planned with 0 substitutions."}
                        </p>
                        {drawerSearch && (
                          <button
                            type="button"
                            onClick={() => setDrawerSearch("")}
                            className="mt-3 text-xs font-semibold text-blue-600 hover:underline cursor-pointer"
                          >
                            Clear search filter
                          </button>
                        )}
                      </div>
                    ) : (
                      filteredDrawerSubstitutions.map((sub, idx) => (
                        <div
                          key={sub.id || idx}
                          className="rounded-xl border border-sky-100 bg-white p-3.5 shadow-xs hover:shadow-md transition-shadow space-y-3"
                        >
                          {/* Card Meta Badges */}
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700">
                                <Calendar className="h-3 w-3 text-slate-500" />
                                {formatDisplayDate(sub.date)}
                              </span>
                              <span className="inline-flex items-center gap-1 rounded bg-sky-50 px-2 py-0.5 text-[11px] font-bold text-sky-800">
                                <Clock className="h-3 w-3 text-sky-600" />
                                {sub.slotLabel} {sub.slotTime ? `(${sub.slotTime})` : ""}
                              </span>
                              <span className="rounded bg-indigo-50 border border-indigo-200 px-2 py-0.5 text-[11px] font-bold text-indigo-700">
                                {getBranchBadge(null, sub.branchCode)}
                              </span>
                              <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                                Batch {sub.batch} {sub.sectionName ? `· Sec ${cleanSectionCode(sub.sectionName)}` : ""}
                              </span>
                            </div>

                            <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-[10px] font-extrabold uppercase text-sky-900">
                              Faculty Substituted
                            </span>
                          </div>

                          {/* PROMINENT WHO CHANGED VS WHO TOOK OVER BOX */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 items-stretch bg-slate-50/80 p-3 rounded-lg border border-slate-200">
                            {/* Left: Relieved Faculty (Who was changed) */}
                            <div className="rounded-lg bg-rose-50/80 border border-rose-200 p-2.5">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-rose-700 flex items-center gap-1">
                                <UserX className="h-3 w-3 text-rose-600" />
                                Who Was Changed (Relieved)
                              </span>
                              <p className="mt-1 text-sm font-bold text-rose-950">
                                {sub.masterFacultyName}
                              </p>
                              <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-rose-800 font-mono">
                                {sub.masterFacultyHrmsId ? `HRMS #${sub.masterFacultyHrmsId}` : "Scheduled Staff"}
                              </div>
                              <p className="mt-1 text-[10px] text-rose-700/80 italic">
                                Scheduled in master plan
                              </p>
                            </div>

                            {/* Right: Reliever Faculty (Who took over the period) */}
                            <div className="rounded-lg bg-emerald-50/90 border border-emerald-200 p-2.5">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 flex items-center gap-1">
                                <UserCheck className="h-3 w-3 text-emerald-700" />
                                Who Took Over (Reliever)
                              </span>
                              <p className="mt-1 text-sm font-bold text-emerald-950">
                                {sub.newFacultyName}
                              </p>
                              <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-emerald-900 font-mono font-semibold">
                                {sub.newFacultyHrmsId ? `HRMS #${sub.newFacultyHrmsId}` : "Substitute Staff"}
                              </div>
                              <p className="mt-1 text-[10px] text-emerald-700 font-medium">
                                Stepped in & conducted period
                              </p>
                            </div>
                          </div>

                          {/* Subject & Details Row */}
                          <div className="space-y-1.5 text-xs text-slate-700 pt-1">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-slate-500">Subject:</span>
                              <span className="font-bold text-navy-900">
                                {sub.newSubjectName || sub.masterSubjectName}
                              </span>
                              {(sub.newSubjectCode || sub.masterSubjectCode) && (
                                <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
                                  {sub.newSubjectCode || sub.masterSubjectCode}
                                </span>
                              )}
                            </div>

                            {sub.remarks && (
                              <div className="flex items-start gap-1.5 bg-amber-50/70 border border-amber-200/70 p-2 rounded text-[11px] text-amber-900">
                                <Info className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                                <div>
                                  <span className="font-bold">Official Note / Reason: </span>
                                  <span>{sub.remarks}</span>
                                </div>
                              </div>
                            )}

                            {sub.changedByName && (
                              <p className="text-[10px] text-slate-400">
                                Authorized by: <span className="font-medium text-slate-600">{sub.changedByName}</span>
                              </p>
                            )}
                          </div>

                          {/* Quick Filter Action Button */}
                          <div className="pt-2 border-t border-slate-100 flex items-center justify-end gap-2">
                            {sub.newFacultyHrmsId && (
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedStaffHrmsId(sub.newFacultyHrmsId!);
                                  setActiveKpiDrawer(null);
                                }}
                                className="inline-flex items-center gap-1 rounded bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-800 hover:bg-sky-100 border border-sky-200 cursor-pointer"
                              >
                                Filter Report by {sub.newFacultyName}
                                <ArrowRight className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </>
                )}

                {/* 2. CLASSES CHANGED DRILLDOWN */}
                {activeKpiDrawer === "changed" && (
                  <>
                    {filteredDrawerChanges.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
                        <AlertTriangle className="mx-auto h-8 w-8 text-slate-400 mb-2" />
                        <h4 className="text-sm font-bold text-navy-950">No Changed Classes Found</h4>
                        <p className="mt-1 text-xs text-slate-500">
                          {drawerSearch
                            ? `No changed classes matching "${drawerSearch}".`
                            : "No timetable variances recorded for this view."}
                        </p>
                      </div>
                    ) : (
                      filteredDrawerChanges.map((change, idx) => (
                        <div
                          key={change.id || idx}
                          className="rounded-xl border border-amber-100 bg-white p-3.5 shadow-xs hover:shadow-md transition-shadow space-y-3"
                        >
                          {/* Header Badges */}
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700">
                                <Calendar className="h-3 w-3 text-slate-500" />
                                {formatDisplayDate(change.date)}
                              </span>
                              <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                                <Clock className="h-3 w-3 text-amber-600" />
                                {change.slotLabel} {change.slotTime ? `(${change.slotTime})` : ""}
                              </span>
                              <span className="rounded bg-indigo-50 border border-indigo-200 px-2 py-0.5 text-[11px] font-bold text-indigo-700">
                                {getBranchBadge(null, change.branchCode)}
                              </span>
                              <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                                Batch {change.batch} {change.sectionName ? `· Sec ${cleanSectionCode(change.sectionName)}` : ""}
                              </span>
                            </div>

                            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-bold text-amber-900 border border-amber-200">
                              {change.varianceType}
                            </span>
                          </div>

                          {/* Before & After Comparison */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 bg-slate-50/80 p-3 rounded-lg border border-slate-200">
                            {/* Master Plan */}
                            <div className="rounded-lg bg-slate-100/80 p-2.5 border border-slate-200">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600">
                                Master Plan (Scheduled)
                              </span>
                              <p className="mt-1 text-xs font-bold text-navy-950">
                                {change.masterSubjectName}
                              </p>
                              {change.masterSubjectCode && (
                                <p className="font-mono text-[10px] text-slate-500">{change.masterSubjectCode}</p>
                              )}
                              <p className="mt-1 text-[11px] text-slate-600">
                                Faculty: <span className="font-semibold">{change.masterFacultyName}</span>
                              </p>
                            </div>

                            {/* Actual / Changed */}
                            <div className="rounded-lg bg-amber-50/80 p-2.5 border border-amber-200">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800">
                                Actual Conducted (Altered)
                              </span>
                              <p className="mt-1 text-xs font-bold text-amber-950">
                                {change.newSubjectName}
                              </p>
                              {change.newSubjectCode && (
                                <p className="font-mono text-[10px] text-amber-800">{change.newSubjectCode}</p>
                              )}
                              <p className="mt-1 text-[11px] text-amber-900">
                                Faculty: <span className="font-semibold">{change.newFacultyName}</span>
                              </p>
                            </div>
                          </div>

                          {change.remarks && (
                            <div className="bg-amber-50/60 p-2 rounded text-[11px] text-amber-900 border border-amber-200/60">
                              <span className="font-semibold">Reason: </span>
                              {change.remarks}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </>
                )}

                {/* 3. SUBJECT SWAPPED DRILLDOWN */}
                {activeKpiDrawer === "swapped" && (
                  <>
                    {filteredDrawerSwaps.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
                        <ArrowLeftRight className="mx-auto h-8 w-8 text-slate-400 mb-2" />
                        <h4 className="text-sm font-bold text-navy-950">No Subject Swaps Found</h4>
                        <p className="mt-1 text-xs text-slate-500">
                          {drawerSearch
                            ? `No subject swaps matching "${drawerSearch}".`
                            : "All periods conducted their planned curriculum subjects without swaps."}
                        </p>
                      </div>
                    ) : (
                      filteredDrawerSwaps.map((swap, idx) => (
                        <div
                          key={swap.id || idx}
                          className="rounded-xl border border-purple-100 bg-white p-3.5 shadow-xs hover:shadow-md transition-shadow space-y-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700">
                                {formatDisplayDate(swap.date)}
                              </span>
                              <span className="rounded bg-purple-50 px-2 py-0.5 text-[11px] font-bold text-purple-800">
                                {swap.slotLabel} {swap.slotTime ? `(${swap.slotTime})` : ""}
                              </span>
                              <span className="rounded bg-indigo-50 border border-indigo-200 px-2 py-0.5 text-[11px] font-bold text-indigo-700">
                                {getBranchBadge(null, swap.branchCode)}
                              </span>
                              <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                                Batch {swap.batch} {swap.sectionName ? `· Sec ${cleanSectionCode(swap.sectionName)}` : ""}
                              </span>
                            </div>

                            <span className="rounded-full bg-purple-100 px-2.5 py-0.5 text-[10px] font-bold text-purple-900">
                              Subject Exchanged
                            </span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 bg-slate-50/80 p-3 rounded-lg border border-slate-200">
                            <div className="rounded-lg bg-slate-100 p-2.5 border border-slate-200">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600">
                                Master Subject (Replaced)
                              </span>
                              <p className="mt-1 text-xs font-bold text-navy-950">{swap.masterSubjectName}</p>
                              <p className="font-mono text-[10px] text-slate-500">{swap.masterSubjectCode}</p>
                            </div>

                            <div className="rounded-lg bg-purple-50 p-2.5 border border-purple-200">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-purple-800">
                                Swapped Subject (Taught)
                              </span>
                              <p className="mt-1 text-xs font-bold text-purple-950">{swap.newSubjectName}</p>
                              <p className="font-mono text-[10px] text-purple-800">{swap.newSubjectCode}</p>
                            </div>
                          </div>

                          <p className="text-xs text-slate-700">
                            Teacher: <span className="font-semibold text-navy-900">{swap.newFacultyName}</span>
                          </p>

                          {swap.remarks && (
                            <p className="text-[11px] italic text-slate-600 bg-slate-50 p-2 rounded">
                              &ldquo;{swap.remarks}&rdquo;
                            </p>
                          )}
                        </div>
                      ))
                    )}
                  </>
                )}

                {/* 4. CONDUCTED CLASSES DRILLDOWN */}
                {activeKpiDrawer === "conducted" && (
                  <>
                    {filteredDrawerConducted.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
                        <CheckCircle2 className="mx-auto h-8 w-8 text-slate-400 mb-2" />
                        <h4 className="text-sm font-bold text-navy-950">No Conducted Classes Recorded</h4>
                        <p className="mt-1 text-xs text-slate-500">
                          {drawerSearch
                            ? `No sessions matching "${drawerSearch}".`
                            : "Attendance has not been posted for classes in this date range yet."}
                        </p>
                      </div>
                    ) : (
                      filteredDrawerConducted.map((c) => (
                        <div
                          key={c.id}
                          className="rounded-xl border border-emerald-100 bg-white p-3.5 shadow-xs hover:shadow-md transition-shadow space-y-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <h4 className="text-xs font-bold text-navy-950">
                                {c.todaySubjectName || c.masterSubjectName}
                              </h4>
                              <p className="text-[11px] text-slate-500">
                                Faculty: <span className="font-semibold text-slate-700">{c.todayFacultyName || c.masterFacultyName}</span>
                              </p>
                            </div>

                            <div className="text-right">
                              <span
                                className={cn(
                                  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-extrabold",
                                  (c.attendancePct ?? 0) >= 75
                                    ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                                    : (c.attendancePct ?? 0) >= 60
                                      ? "bg-amber-100 text-amber-800 border border-amber-200"
                                      : "bg-rose-100 text-rose-800 border border-rose-200",
                                )}
                              >
                                {c.attendancePct != null ? `${c.attendancePct}% Attendance` : "Conducted"}
                              </span>
                              <p className="text-[10px] text-slate-500 mt-0.5 font-medium">
                                {c.presentCount} present · {c.absentCount} absent
                              </p>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px] text-slate-600 border-t border-slate-100">
                            <span className="rounded bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 font-bold text-indigo-700">
                              {getBranchBadge(c.branchId, c.branchCode)}
                            </span>
                            <span className="rounded bg-slate-100 px-1.5 py-0.5">{formatDisplayDate(c.date)}</span>
                            <span className="rounded bg-slate-100 px-1.5 py-0.5">{c.slotLabel} ({c.time})</span>
                            <span className="rounded bg-slate-100 px-1.5 py-0.5">Batch {c.batch}</span>
                            {c.sectionName && (
                              <span className="rounded bg-sky-50 px-1.5 py-0.5 text-sky-700 border border-sky-200 font-semibold">
                                Sec {cleanSectionCode(c.sectionName)}
                              </span>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </>
                )}

                {/* 5. MASTER ASSIGNED DRILLDOWN */}
                {activeKpiDrawer === "master" && (
                  <>
                    <div className="rounded-lg bg-blue-50/80 border border-blue-200 p-2.5 flex items-center justify-between text-xs text-blue-900">
                      <div className="flex items-center gap-2">
                        <BookOpen className="h-4 w-4 text-blue-600 shrink-0" />
                        <span>
                          Showing <strong>{filteredDrawerMasterScheduled.length}</strong> master scheduled classes for{" "}
                          <strong>{dateMode === "today" ? "Today" : "Selected Range"}</strong>
                        </span>
                      </div>
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-800 border border-blue-200">
                        Breaks Excluded
                      </span>
                    </div>

                    {filteredDrawerMasterScheduled.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
                        <BookOpen className="mx-auto h-8 w-8 text-slate-400 mb-2" />
                        <h4 className="text-sm font-bold text-navy-950">No Classes Scheduled in Master Timetable</h4>
                        <p className="mt-1 text-xs text-slate-500">
                          {drawerSearch
                            ? `No master scheduled classes matching "${drawerSearch}".`
                            : "No academic periods scheduled in the master timetable for this day (lunch & normal breaks are strictly excluded)."}
                        </p>
                      </div>
                    ) : (
                      filteredDrawerMasterScheduled.map((item) => (
                        <div
                          key={item.id}
                          className="rounded-xl border border-blue-200 bg-white p-3.5 shadow-xs hover:shadow-md transition-shadow space-y-2.5"
                        >
                          {/* Header Badges */}
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="rounded bg-indigo-50 border border-indigo-200 px-2 py-0.5 text-[11px] font-bold text-indigo-700">
                                {getBranchBadge(item.branchId, item.branchCode)}
                              </span>
                              <span className="inline-flex items-center gap-1 rounded bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-800 border border-blue-200">
                                <Clock className="h-3 w-3 text-blue-600" />
                                {item.slotLabel} {item.slotTime ? `(${item.slotTime})` : ""}
                              </span>
                              <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                                Batch {item.batch} {item.sectionName ? `· Sec ${cleanSectionCode(item.sectionName)}` : ""}
                              </span>
                            </div>
                            <span
                              className={cn(
                                "rounded-full px-2.5 py-0.5 text-[10px] font-bold border uppercase",
                                item.customLabel === "CRT"
                                  ? "bg-purple-100 text-purple-900 border-purple-200"
                                  : item.customLabel === "Library"
                                    ? "bg-teal-100 text-teal-900 border-teal-200"
                                    : item.entryType === "lab"
                                      ? "bg-emerald-100 text-emerald-900 border-emerald-200"
                                      : "bg-blue-100 text-blue-900 border-blue-200",
                              )}
                            >
                              {item.customLabel || (item.entryType === "lab" ? "Laboratory" : "Academic Class")}
                            </span>
                          </div>

                          {/* Subject & Assigned Faculty */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-slate-50/80 p-2.5 rounded-lg border border-slate-200">
                            <div>
                              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                Curriculum Subject
                              </span>
                              <p className="mt-0.5 text-xs font-bold text-navy-950">{item.subjectName}</p>
                              {item.subjectCode && (
                                <span className="font-mono text-[10px] font-semibold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">
                                  {item.subjectCode}
                                </span>
                              )}
                            </div>

                            <div>
                              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                Master Assigned Faculty
                              </span>
                              <p className="mt-0.5 text-xs font-bold text-navy-950 flex items-center gap-1">
                                <User className="h-3.5 w-3.5 text-blue-600" />
                                {item.facultyName}
                              </p>
                              {item.facultyHrmsId && (
                                <span className="font-mono text-[10px] text-slate-500">HRMS #{item.facultyHrmsId}</span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center justify-between text-[10px] text-slate-500 pt-0.5">
                            <span>Master Timetable Standard Plan</span>
                            <span className="font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">
                              ✓ Excludes lunch & normal break
                            </span>
                          </div>
                        </div>
                      ))
                    )}

                    {/* Weekly Subject Allotment Quota Breakdown */}
                    {filteredDrawerMaster.length > 0 && (
                      <div className="pt-3 border-t border-slate-200 space-y-2">
                        <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                          <span>Weekly Subject Quota Overview</span>
                          <span className="text-[10px] text-slate-500 font-normal">{filteredDrawerMaster.length} subject(s) in curriculum</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {filteredDrawerMaster.map((sub) => (
                            <div key={sub.subjectCode} className="rounded-lg bg-white border border-slate-200 p-2.5 text-xs">
                              <div className="flex items-center justify-between">
                                <span className="font-bold text-navy-900 truncate">{sub.subjectName}</span>
                                <span className="font-mono text-[10px] text-blue-700 font-bold bg-blue-50 px-1.5 py-0.5 rounded ml-1 shrink-0">
                                  {sub.masterWeeklyPeriods} p/wk
                                </span>
                              </div>
                              <p className="text-[10px] text-slate-500 mt-0.5 font-mono">{sub.subjectCode}</p>
                              {sub.facultyNames.length > 0 && (
                                <p className="text-[10px] text-slate-600 mt-1 truncate">
                                  Staff: {sub.facultyNames.join(", ")}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* 6. TIMETABLE CHANGE RATE & VARIANCE BREAKDOWN */}
                {activeKpiDrawer === "rate" && (
                  <div className="space-y-4">
                    <div className="rounded-xl bg-linear-to-br from-rose-50 to-white p-4 border border-rose-200 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-rose-700">
                            Timetable Variance Ratio
                          </span>
                          <h4 className="text-3xl font-extrabold text-rose-800 mt-1">
                            {summary.overallChangeRatePct}%
                          </h4>
                        </div>
                        <div className="text-right text-xs text-slate-600">
                          <p className="font-bold text-navy-950">{summary.totalChangesRecorded} Alterations</p>
                          <p className="text-[11px] text-slate-500">out of {summary.totalMasterPeriods * 15 || summary.totalScheduledSessions || 1} planned slots</p>
                        </div>
                      </div>

                      <div className="w-full bg-slate-200 h-2.5 rounded-full overflow-hidden">
                        <div
                          className="bg-rose-500 h-full rounded-full transition-all duration-500"
                          style={{ width: `${Math.min(100, summary.overallChangeRatePct)}%` }}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      <div className="rounded-lg bg-white p-3 border border-slate-200 shadow-2xs">
                        <span className="text-[10px] font-semibold text-slate-500 uppercase">Faculty Substitutions</span>
                        <p className="mt-1 text-xl font-bold text-sky-800">{summary.facultySubstitutionsCount}</p>
                        <p className="text-[10px] text-slate-500">Relievers deployed</p>
                      </div>

                      <div className="rounded-lg bg-white p-3 border border-slate-200 shadow-2xs">
                        <span className="text-[10px] font-semibold text-slate-500 uppercase">Subject Swaps</span>
                        <p className="mt-1 text-xl font-bold text-purple-800">{summary.subjectSwapsCount}</p>
                        <p className="text-[10px] text-slate-500">Curriculum exchanges</p>
                      </div>

                      <div className="rounded-lg bg-white p-3 border border-slate-200 shadow-2xs">
                        <span className="text-[10px] font-semibold text-slate-500 uppercase">Classes Conducted</span>
                        <p className="mt-1 text-xl font-bold text-emerald-800">{summary.totalConductedSessions}</p>
                        <p className="text-[10px] text-slate-500">Sessions held</p>
                      </div>

                      <div className="rounded-lg bg-white p-3 border border-slate-200 shadow-2xs">
                        <span className="text-[10px] font-semibold text-slate-500 uppercase">Avg Attendance</span>
                        <p className="mt-1 text-xl font-bold text-indigo-900">{summary.attendanceAvgPct}%</p>
                        <p className="text-[10px] text-slate-500">Student attendance</p>
                      </div>
                    </div>

                    <div className="rounded-lg bg-blue-50/70 p-3 border border-blue-200 text-xs text-blue-900 space-y-1">
                      <p className="font-bold flex items-center gap-1">
                        <Info className="h-3.5 w-3.5 text-blue-600" />
                        Understanding Timetable Stability
                      </p>
                      <p className="text-[11px] text-blue-800 leading-relaxed">
                        A low change rate (&lt; 15%) signifies strong timetable fidelity where master scheduled classes run as planned. Higher change rates indicate frequent faculty absences, relocations, or emergency adjustments.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Drawer Footer */}
              <div className="p-3 bg-white border-t border-slate-200 flex items-center justify-between">
                <p className="text-[11px] text-slate-500">
                  Press <kbd className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px] text-slate-700 border">Esc</kbd> or click outside to dismiss
                </p>
                <button
                  type="button"
                  onClick={() => setActiveKpiDrawer(null)}
                  className="rounded-lg bg-navy-950 px-3 py-1.5 text-xs font-bold text-white hover:bg-navy-900 cursor-pointer transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 11. STAFF PROFILE & ACTION LOG POP-UP MODAL */}
      {/* ========================================================================= */}
      {activeStaffModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
          onClick={() => setActiveStaffModal(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="relative w-full max-w-5xl h-[88vh] max-h-[900px] flex flex-col rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="shrink-0 bg-linear-to-r from-navy-950 via-slate-900 to-indigo-950 px-5 py-3.5 text-white flex items-center justify-between border-b border-white/10">
              <div className="flex items-center gap-3.5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-amber-300 border border-amber-400/30 text-base font-extrabold shadow-inner">
                  {activeStaffModal.facultyName.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base font-bold text-white tracking-tight">
                      {activeStaffModal.facultyName}
                    </h3>
                    <span className="rounded-full bg-amber-400/20 text-amber-300 border border-amber-400/30 text-[10px] font-bold px-2 py-0.5">
                      HRMS ID: #{activeStaffModal.hrmsId}
                    </span>
                    <span className="rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 text-[10px] font-bold px-2 py-0.5">
                      Active Faculty
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 mt-0.5">
                    Faculty Workload, Assigned Curriculum & Substitution Action Log
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={exportStaffModalExcel}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/40 bg-emerald-950/60 hover:bg-emerald-900/80 px-2.5 py-1.5 text-xs font-bold text-emerald-200 transition-colors cursor-pointer shadow-xs"
                  title="Export to Excel (.xls)"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="hidden sm:inline">Excel</span>
                </button>
                <button
                  type="button"
                  onClick={exportStaffModalPdf}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-rose-400/40 bg-rose-950/60 hover:bg-rose-900/80 px-2.5 py-1.5 text-xs font-bold text-rose-200 transition-colors cursor-pointer shadow-xs"
                  title="Print / Export to PDF"
                >
                  <FileText className="h-3.5 w-3.5 text-rose-400" />
                  <span className="hidden sm:inline">PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveStaffModal(null)}
                  className="rounded-lg bg-white/10 p-2 text-white/80 hover:bg-white/20 hover:text-white cursor-pointer transition-colors"
                  title="Close modal (Esc)"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Modal Body: Single smooth view, NO outer scrollbar */}
            <div className="flex-1 min-h-0 flex flex-col p-4 sm:p-5 gap-3 bg-slate-50/50 overflow-hidden">
              {/* Top Summary Cards (Fixed / Non-scrolling) */}
              <div className="shrink-0 space-y-2.5">
                {/* 5 Workload & Action Metric Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                  <div className="rounded-xl bg-white p-3 border border-slate-200 shadow-2xs">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                      Master Quota
                    </span>
                    <p className="text-2xl font-black text-slate-800 mt-1">
                      {activeStaffModal.masterAssignedPeriods}
                    </p>
                    <span className="text-[10px] text-slate-400">Scheduled p/wk</span>
                  </div>

                  <div className="rounded-xl bg-white p-3 border border-emerald-200 shadow-2xs">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 block">
                      Conducted
                    </span>
                    <p className="text-2xl font-black text-emerald-700 mt-1">
                      {activeStaffModal.classesConducted}
                    </p>
                    <span className="text-[10px] text-emerald-600">Sessions delivered</span>
                  </div>

                  <div className="rounded-xl bg-white p-3 border border-rose-200 shadow-2xs">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-rose-700 block">
                      Relieved (-)
                    </span>
                    <p className="text-2xl font-black text-rose-600 mt-1">
                      {activeStaffModal.relievedCount > 0 ? `-${activeStaffModal.relievedCount}` : 0}
                    </p>
                    <span className="text-[10px] text-rose-500">Covered by others</span>
                  </div>

                  <div className="rounded-xl bg-white p-3 border border-sky-200 shadow-2xs">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-sky-700 block">
                      Substitute (+)
                    </span>
                    <p className="text-2xl font-black text-sky-600 mt-1">
                      {activeStaffModal.substituteTakenCount > 0 ? `+${activeStaffModal.substituteTakenCount}` : 0}
                    </p>
                    <span className="text-[10px] text-sky-500">Taken for others</span>
                  </div>

                  <div className="rounded-xl bg-navy-950 p-3 text-white shadow-2xs sm:col-span-1 col-span-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300 block">
                      Net Teaching Load
                    </span>
                    <p className="text-2xl font-black text-amber-400 mt-1">
                      {activeStaffModal.netTeachingCount}
                    </p>
                    <span className="text-[10px] text-slate-300">Total sessions</span>
                  </div>
                </div>

                {/* Assigned Subjects & Quick Action Brief */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  <div className="rounded-xl bg-white p-3 border border-slate-200 shadow-2xs">
                    <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                      <BookOpen className="h-3.5 w-3.5 text-indigo-600" />
                      Assigned Subjects
                    </h4>
                    {activeStaffModal.subjects.length === 0 ? (
                      <p className="text-xs text-slate-400 italic">No formal subjects registered in master record.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {activeStaffModal.subjects.map((s, idx) => (
                          <span
                            key={idx}
                            className="rounded-md bg-indigo-50 border border-indigo-200 px-2.5 py-1 text-xs font-semibold text-indigo-900"
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl bg-white p-3 border border-slate-200 shadow-2xs">
                    <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                      <ArrowLeftRight className="h-3.5 w-3.5 text-amber-600" />
                      Action Profile Summary
                    </h4>
                    <div className="space-y-1 text-xs text-slate-600">
                      <div className="flex justify-between items-center py-0.5 border-b border-slate-100">
                        <span>Substitutions Covered for Colleagues:</span>
                        <span className="font-bold text-sky-700">{activeStaffModal.substituteTakenCount} sessions</span>
                      </div>
                      <div className="flex justify-between items-center py-0.5 border-b border-slate-100">
                        <span>Absence / Relief Covered by Colleagues:</span>
                        <span className="font-bold text-rose-700">{activeStaffModal.relievedCount} sessions</span>
                      </div>
                      <div className="flex justify-between items-center py-0.5">
                        <span>Timetable Variance Impact:</span>
                        <span className="font-bold text-slate-800">
                          {activeStaffModal.substituteTakenCount - activeStaffModal.relievedCount >= 0 ? "+" : ""}
                          {activeStaffModal.substituteTakenCount - activeStaffModal.relievedCount} net shift
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Timetable Sessions & Action History Log - Fills remaining height with single scrollbar */}
              <div className="flex-1 min-h-0 flex flex-col rounded-xl bg-white border border-slate-200 shadow-2xs overflow-hidden">
                <div className="shrink-0 p-3 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2.5">
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-navy-950 flex items-center gap-1.5">
                      <CalendarCheck className="h-4 w-4 text-emerald-600" />
                      Detailed Timetable Delivery & Substitution Actions
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      Showing {filteredModalStaffSessions.length} sessions involving {activeStaffModal.facultyName}
                    </p>
                  </div>

                  {/* Search inside modal + Action Buttons */}
                  <div className="flex items-center gap-2">
                    <div className="relative min-w-[180px] max-w-xs">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                      <input
                        type="text"
                        value={staffModalSearch}
                        onChange={(e) => setStaffModalSearch(e.target.value)}
                        placeholder="Filter subject, date, slot..."
                        className="w-full rounded-lg border border-slate-200 bg-white pl-8 pr-2.5 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-hidden"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={exportStaffModalExcel}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 px-2.5 py-1.5 text-xs font-bold cursor-pointer transition-colors shadow-2xs"
                      title="Download Excel spreadsheet (Abstract + Date-wise breakdown)"
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" />
                      <span className="hidden sm:inline">Excel</span>
                    </button>
                    <button
                      type="button"
                      onClick={exportStaffModalPdf}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-900 px-2.5 py-1.5 text-xs font-bold cursor-pointer transition-colors shadow-2xs"
                      title="Download / Print PDF (Abstract + Date-wise breakdown)"
                    >
                      <FileText className="h-3.5 w-3.5 text-rose-700" />
                      <span className="hidden sm:inline">PDF</span>
                    </button>
                  </div>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
                  {filteredModalStaffSessions.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-400">
                      No matching sessions found for this faculty member in the selected date range.
                    </div>
                  ) : (
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-100/70 text-[10px] font-bold uppercase tracking-wider text-slate-600 sticky top-0 z-10 backdrop-blur-xs">
                          <th className="py-2.5 px-3">Date & Slot</th>
                          <th className="py-2.5 px-3">Class & Section</th>
                          <th className="py-2.5 px-3">Subject</th>
                          <th className="py-2.5 px-3">Action Role / Status</th>
                          <th className="py-2.5 px-2 text-center">Conducted</th>
                          <th className="py-2.5 px-2 text-center">Turnout</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredModalStaffSessions.map((s, idx) => (
                          <tr key={idx} className="hover:bg-slate-50 transition-colors">
                            <td className="py-2.5 px-3">
                              <span className="font-semibold text-slate-900 block">{s.date}</span>
                              <span className="text-[10px] text-slate-500 font-mono">
                                {s.slotLabel} ({s.time})
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-slate-700">
                              <span className="font-medium text-slate-900 block">
                                {s.sectionName ? `Sec ${cleanSectionCode(s.sectionName)}` : "All Sections"}
                              </span>
                              <span className="text-[10px] text-slate-500">Batch {s.batch}</span>
                            </td>
                            <td className="py-2.5 px-3">
                              <p className="font-bold text-navy-900">
                                {s.todaySubjectName || s.masterSubjectName}
                              </p>
                              <span className="font-mono text-[10px] text-slate-400">
                                {s.todaySubjectCode || s.masterSubjectCode}
                              </span>
                            </td>
                            <td className="py-2.5 px-3">
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] border shadow-2xs",
                                  s.actionBadgeClass,
                                )}
                              >
                                {s.actionTitle}
                              </span>
                            </td>
                            <td className="py-2.5 px-2 text-center">
                              {s.isConducted ? (
                                <span className="rounded bg-emerald-100 text-emerald-800 px-1.5 py-0.5 text-[10px] font-bold">
                                  Yes ✓
                                </span>
                              ) : (
                                <span className="rounded bg-slate-100 text-slate-600 px-1.5 py-0.5 text-[10px] font-medium">
                                  Scheduled
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-2 text-center font-bold text-slate-800">
                              {s.attendancePct != null ? `${s.attendancePct}%` : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="shrink-0 px-4 py-2.5 bg-white border-t border-slate-200 flex items-center justify-between">
              <p className="text-[11px] text-slate-500 truncate mr-2">
                HRMS Registry record for <span className="font-semibold text-slate-700">{activeStaffModal.facultyName}</span>
              </p>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={exportStaffModalExcel}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 px-3 py-1.5 text-xs font-bold cursor-pointer transition-colors shadow-2xs"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" />
                  Excel
                </button>
                <button
                  type="button"
                  onClick={exportStaffModalPdf}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-900 px-3 py-1.5 text-xs font-bold cursor-pointer transition-colors shadow-2xs"
                >
                  <FileText className="h-3.5 w-3.5 text-rose-700" />
                  PDF
                </button>
                <button
                  type="button"
                  onClick={() => setActiveStaffModal(null)}
                  className="rounded-lg bg-navy-950 px-4 py-1.5 text-xs font-bold text-white hover:bg-navy-900 cursor-pointer transition-colors shadow-xs"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 12. SUBJECT DELIVERY & ALTERATION ACTION POP-UP MODAL */}
      {/* ========================================================================= */}
      {activeSubjectModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
          onClick={() => setActiveSubjectModal(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="relative w-full max-w-5xl h-[88vh] max-h-[900px] flex flex-col rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="shrink-0 bg-linear-to-r from-emerald-950 via-teal-950 to-slate-900 px-5 py-3.5 text-white flex items-center justify-between border-b border-white/10">
              <div className="flex items-center gap-3.5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 text-base font-extrabold shadow-inner">
                  <BookOpen className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base font-bold text-white tracking-tight">
                      {activeSubjectModal.subjectName}
                    </h3>
                    <span className="rounded-full bg-emerald-400/20 text-emerald-300 border border-emerald-400/30 text-[10px] font-bold px-2 py-0.5 font-mono">
                      {activeSubjectModal.subjectCode}
                    </span>
                    {activeSubjectModal.cohortTitle && (
                      <span className="rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-400/30 text-[10px] font-bold px-2 py-0.5">
                        {activeSubjectModal.cohortTitle}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-300 mt-0.5">
                    Curriculum Delivery, Faculty Allotment & Timetable Alteration History
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={exportSubjectModalExcel}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/40 bg-emerald-900/60 hover:bg-emerald-850 px-2.5 py-1.5 text-xs font-bold text-emerald-200 transition-colors cursor-pointer shadow-xs"
                  title="Export to Excel (.xls)"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="hidden sm:inline">Excel</span>
                </button>
                <button
                  type="button"
                  onClick={exportSubjectModalPdf}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-rose-400/40 bg-rose-950/60 hover:bg-rose-900/80 px-2.5 py-1.5 text-xs font-bold text-rose-200 transition-colors cursor-pointer shadow-xs"
                  title="Print / Export to PDF"
                >
                  <FileText className="h-3.5 w-3.5 text-rose-400" />
                  <span className="hidden sm:inline">PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSubjectModal(null)}
                  className="rounded-lg bg-white/10 p-2 text-white/80 hover:bg-white/20 hover:text-white cursor-pointer transition-colors"
                  title="Close modal (Esc)"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Modal Body: Single smooth view, NO outer scrollbar */}
            <div className="flex-1 min-h-0 flex flex-col p-4 sm:p-5 gap-3 bg-slate-50/50 overflow-hidden">
              {/* Top Summary Cards (Fixed / Non-scrolling) */}
              <div className="shrink-0 space-y-2.5">
                {/* 4 Key Metric Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className="rounded-xl bg-white p-3 border border-slate-200 shadow-2xs">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                      Master Quota
                    </span>
                    <p className="text-2xl font-black text-slate-800 mt-1">
                      {activeSubjectModal.masterWeeklyPeriods > 0 ? activeSubjectModal.masterWeeklyPeriods : (activeSubjectModal.totalScheduled || "—")}
                    </p>
                    <span className="text-[10px] text-slate-400">Periods / week</span>
                  </div>

                  <div className="rounded-xl bg-white p-3 border border-emerald-200 shadow-2xs">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 block">
                      Conducted Sessions
                    </span>
                    <p className="text-2xl font-black text-emerald-700 mt-1">
                      {activeSubjectModal.totalConducted}
                    </p>
                    <span className="text-[10px] text-emerald-600">Held in timeframe</span>
                  </div>

                  <div className="rounded-xl bg-white p-3 border border-amber-200 shadow-2xs">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 block">
                      Total Alterations
                    </span>
                    <p className="text-2xl font-black text-amber-700 mt-1">
                      {activeSubjectModal.timesChanged}
                    </p>
                    <span className="text-[10px] text-amber-600">
                      {activeSubjectModal.timesSwappedOut} swapped out · {activeSubjectModal.timesSwappedIn} swapped in
                    </span>
                  </div>

                  <div className="rounded-xl bg-white p-3 border border-indigo-200 shadow-2xs">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 block">
                      Attendance Rate
                    </span>
                    <p className="text-2xl font-black text-indigo-800 mt-1">
                      {activeSubjectModal.attendancePct != null && activeSubjectModal.attendancePct > 0
                        ? `${activeSubjectModal.attendancePct}%`
                        : activeSubjectModal.turnoutPct != null
                          ? `${activeSubjectModal.turnoutPct}%`
                          : "—"}
                    </p>
                    <span className="text-[10px] text-indigo-600">
                      {activeSubjectModal.totalConducted > 0 ? "Turnout average" : "Attendance pending"}
                    </span>
                  </div>
                </div>

                {/* Faculty Allotment & Action Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {/* Assigned Master Faculty */}
                  <div className="rounded-xl bg-white p-3 border border-slate-200 shadow-2xs">
                    <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <UserCheck className="h-3.5 w-3.5 text-emerald-600" />
                        Assigned Master Faculty
                      </span>
                      <span className="text-[10px] text-slate-400 font-normal">Click staff to view profile</span>
                    </h4>
                    {(activeSubjectModal.assignedFacultyNames ?? activeSubjectModal.facultyNames ?? []).length === 0 ? (
                      <p className="text-xs text-slate-400 italic">No faculty assigned in master schedule.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {(activeSubjectModal.assignedFacultyNames ?? activeSubjectModal.facultyNames ?? []).map((name, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => openStaffModalByName(name)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2.5 py-1 text-xs font-bold text-emerald-900 transition-colors cursor-pointer shadow-2xs"
                            title={`Click to view ${name}'s full profile & action history`}
                          >
                            <User className="h-3 w-3 text-emerald-600" />
                            <span>{name}</span>
                            <span className="rounded bg-emerald-200/80 px-1 text-[9px] text-emerald-900 font-bold">Assigned</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Changed / Substitute Faculty */}
                  <div className="rounded-xl bg-white p-3 border border-slate-200 shadow-2xs">
                    <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <ArrowLeftRight className="h-3.5 w-3.5 text-amber-600" />
                        Substitute & Reliever Faculty
                      </span>
                      <span className="text-[10px] text-slate-400 font-normal">Click staff to view profile</span>
                    </h4>
                    {(!activeSubjectModal.changedFaculties || activeSubjectModal.changedFaculties.length === 0) ? (
                      <p className="text-xs text-slate-400 italic">No faculty changes recorded. 100% fidelity to master timetable.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {activeSubjectModal.changedFaculties.map((cf, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => openStaffModalByName(cf.facultyName)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 border border-amber-200 px-2.5 py-1 text-xs font-bold text-amber-900 transition-colors cursor-pointer shadow-2xs"
                            title={
                              cf.originalFacultyName
                                ? `Stepped in for ${cf.originalFacultyName} (${cf.count} sessions) - Click to view profile`
                                : `Substitute faculty (${cf.count} sessions) - Click to view profile`
                            }
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-500"></span>
                            <span>{cf.facultyName}</span>
                            {cf.originalFacultyName && cf.originalFacultyName !== cf.facultyName && (
                              <span className="text-[10px] font-normal text-amber-700">
                                (sub for {cf.originalFacultyName})
                              </span>
                            )}
                            {cf.count > 1 && (
                              <span className="rounded-full bg-amber-200 px-1 text-[9px] font-bold text-amber-900">
                                ×{cf.count}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Delivery Log Table - Fills remaining height with single scrollbar */}
              <div className="flex-1 min-h-0 flex flex-col rounded-xl bg-white border border-slate-200 shadow-2xs overflow-hidden">
                <div className="shrink-0 p-3 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2.5">
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-navy-950 flex items-center gap-1.5">
                      <CalendarCheck className="h-4 w-4 text-emerald-600" />
                      Subject Timetable Delivery & Alteration Actions
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      Showing {filteredModalSubjectSessions.length} sessions held or planned for {activeSubjectModal.subjectName}
                    </p>
                  </div>

                  {/* Search inside modal + Action Buttons */}
                  <div className="flex items-center gap-2">
                    <div className="relative min-w-[180px] max-w-xs">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                      <input
                        type="text"
                        value={subjectModalSearch}
                        onChange={(e) => setSubjectModalSearch(e.target.value)}
                        placeholder="Filter by faculty, date, slot..."
                        className="w-full rounded-lg border border-slate-200 bg-white pl-8 pr-2.5 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-hidden"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={exportSubjectModalExcel}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 px-2.5 py-1.5 text-xs font-bold cursor-pointer transition-colors shadow-2xs"
                      title="Download Excel spreadsheet (Abstract + Date-wise breakdown)"
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" />
                      <span className="hidden sm:inline">Excel</span>
                    </button>
                    <button
                      type="button"
                      onClick={exportSubjectModalPdf}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-900 px-2.5 py-1.5 text-xs font-bold cursor-pointer transition-colors shadow-2xs"
                      title="Download / Print PDF (Abstract + Date-wise breakdown)"
                    >
                      <FileText className="h-3.5 w-3.5 text-rose-700" />
                      <span className="hidden sm:inline">PDF</span>
                    </button>
                  </div>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
                  {filteredModalSubjectSessions.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-400">
                      No matching sessions found for this subject in the selected date range.
                    </div>
                  ) : (
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-100/70 text-[10px] font-bold uppercase tracking-wider text-slate-600 sticky top-0 z-10 backdrop-blur-xs">
                          <th className="py-2.5 px-3">Date & Slot</th>
                          <th className="py-2.5 px-3">Class & Section</th>
                          <th className="py-2.5 px-3">Master Faculty</th>
                          <th className="py-2.5 px-3">Conducted Faculty</th>
                          <th className="py-2.5 px-3">Action Status</th>
                          <th className="py-2.5 px-2 text-center">Attendance Turnout</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredModalSubjectSessions.map((s, idx) => (
                          <tr key={idx} className="hover:bg-slate-50 transition-colors">
                            <td className="py-2.5 px-3">
                              <span className="font-semibold text-slate-900 block">{s.date}</span>
                              <span className="text-[10px] text-slate-500 font-mono">
                                {s.slotLabel} ({s.time})
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-slate-700">
                              <span className="font-medium text-slate-900 block">
                                {s.sectionName ? `Sec ${cleanSectionCode(s.sectionName)}` : "All"}
                              </span>
                              <span className="text-[10px] text-slate-500">Batch {s.batch}</span>
                            </td>
                            <td className="py-2.5 px-3">
                              {s.masterFacultyName ? (
                                <button
                                  type="button"
                                  onClick={() => openStaffModalByName(s.masterFacultyName!)}
                                  className="text-slate-700 hover:text-navy-950 font-medium hover:underline cursor-pointer"
                                  title="View staff profile"
                                >
                                  {s.masterFacultyName}
                                </button>
                              ) : (
                                <span className="text-slate-400 italic">None</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3">
                              {s.todayFacultyName ? (
                                <button
                                  type="button"
                                  onClick={() => openStaffModalByName(s.todayFacultyName!)}
                                  className={cn(
                                    "font-semibold hover:underline cursor-pointer",
                                    s.isSub ? "text-amber-800 font-bold" : "text-slate-800",
                                  )}
                                  title="View staff profile"
                                >
                                  {s.todayFacultyName}
                                </button>
                              ) : (
                                <span className="text-slate-400 italic">None</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3">
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] border shadow-2xs",
                                  s.actionBadgeClass,
                                )}
                              >
                                {s.actionTitle}
                              </span>
                            </td>
                            <td className="py-2.5 px-2 text-center font-bold text-slate-800">
                              {s.attendancePct != null ? (
                                <span
                                  className={cn(
                                    "inline-block rounded px-2 py-0.5 text-[10px] font-bold",
                                    s.attendancePct >= 75
                                      ? "bg-emerald-100 text-emerald-800"
                                      : "bg-amber-100 text-amber-800",
                                  )}
                                >
                                  {s.attendancePct}%
                                </span>
                              ) : (
                                <span className="text-slate-400 font-normal">Pending</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="shrink-0 px-4 py-2.5 bg-white border-t border-slate-200 flex items-center justify-between">
              <p className="text-[11px] text-slate-500 truncate mr-2">
                Curriculum session history for <span className="font-semibold text-slate-700">{activeSubjectModal.subjectName}</span>
              </p>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={exportSubjectModalExcel}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 px-3 py-1.5 text-xs font-bold cursor-pointer transition-colors shadow-2xs"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" />
                  Excel
                </button>
                <button
                  type="button"
                  onClick={exportSubjectModalPdf}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-900 px-3 py-1.5 text-xs font-bold cursor-pointer transition-colors shadow-2xs"
                >
                  <FileText className="h-3.5 w-3.5 text-rose-700" />
                  PDF
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSubjectModal(null)}
                  className="rounded-lg bg-emerald-800 px-4 py-1.5 text-xs font-bold text-white hover:bg-emerald-900 cursor-pointer transition-colors shadow-xs"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
