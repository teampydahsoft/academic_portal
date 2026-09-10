"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useAcademicContext } from "@/components/layout/AcademicProvider";
import { apiFetch } from "@/lib/api";
import { StudentAvatar } from "@/features/students/StudentAvatar";
import { cn } from "@/lib/cn";
import {
  Calendar,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  GraduationCap,
  PieChart,
  Search,
  Users,
  TrendingUp,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Card } from "@/components/ui/Card";

export type AttendanceMark = "present" | "absent" | "od" | "leave";

export type DailySlot = {
  sessionId: number;
  slotLabel: string;
  startTime: string;
  endTime: string;
  time: string;
  subjectId: number | null;
  subjectCode: string | null;
  subjectName: string | null;
  facultyName: string | null;
  roomLabel: string | null;
  status: string;
  posted: boolean;
  postId: number | null;
  presentCount: number;
  absentCount: number;
  odCount: number;
  leaveCount: number;
};

export type DailyStudent = {
  id: string;
  studentDbId: number;
  name: string;
  pinNo: string | null;
  admissionNo: string;
  course: string | null;
  branch: string | null;
  year: number | null;
  semester: number | null;
  hasPhoto: boolean;
  slots: Record<
    number,
    {
      sessionId: number;
      status: AttendanceMark | "pending" | "unposted";
      remarks: string | null;
    }
  >;
  totalPresent: number;
  totalAbsent: number;
  totalOd: number;
  totalLeave: number;
  totalConducted: number;
  totalSlots: number;
  percentage: number | null;
};

export type DailyAttendanceData = {
  date: string;
  section: string | null;
  availableSections: string[];
  slots: DailySlot[];
  students: DailyStudent[];
  summary: {
    totalStudents: number;
    totalSlots: number;
    postedSlots: number;
    pendingSlots: number;
    totalPresentMarks: number;
    totalAbsentMarks: number;
    avgAttendancePct: number;
  };
};

export type WeeklySlot = {
  sessionId: number;
  slotLabel: string;
  startTime: string;
  endTime: string;
  time: string;
  subjectId: number | null;
  subjectCode: string | null;
  subjectName: string | null;
  facultyName: string | null;
  roomLabel: string | null;
  status: string;
  posted: boolean;
  postId: number | null;
  presentCount: number;
  absentCount: number;
  odCount: number;
  leaveCount: number;
};

export type WeeklyDay = {
  date: string;
  dayOfWeek: string;
  dayLabel: string;
  totalSlots: number;
  postedSlots: number;
  slots: WeeklySlot[];
};

export type WeeklyStudent = {
  id: string;
  studentDbId: number;
  name: string;
  pinNo: string | null;
  admissionNo: string;
  course: string | null;
  branch: string | null;
  year: number | null;
  semester: number | null;
  hasPhoto: boolean;
  days: Record<
    string,
    {
      date: string;
      dayOfWeek: string;
      totalSlots: number;
      presentCount: number;
      absentCount: number;
      odCount: number;
      leaveCount: number;
      percentage: number | null;
      slots: Record<
        number,
        {
          sessionId: number;
          slotLabel: string;
          subjectCode: string | null;
          status: AttendanceMark | "pending" | "unposted";
          remarks: string | null;
        }
      >;
    }
  >;
  totalPresent: number;
  totalAbsent: number;
  totalOd: number;
  totalLeave: number;
  totalConducted: number;
  totalSlots: number;
  percentage: number | null;
};

export type WeeklyAttendanceData = {
  startDate: string;
  endDate: string;
  weekLabel: string;
  section: string | null;
  availableSections: string[];
  days: WeeklyDay[];
  students: WeeklyStudent[];
  summary: {
    totalStudents: number;
    totalSlotsInWeek: number;
    postedSlotsInWeek: number;
    totalPresentMarks: number;
    totalAbsentMarks: number;
    avgAttendancePct: number;
  };
};

export type MonthlyStudent = {
  id: string;
  studentDbId: number;
  name: string;
  pinNo: string | null;
  admissionNo: string;
  course: string | null;
  branch: string | null;
  year: number | null;
  semester: number | null;
  hasPhoto: boolean;
  totalSlots: number;
  presentCount: number;
  absentCount: number;
  odCount: number;
  leaveCount: number;
  percentage: number;
  status: "good" | "warning" | "critical";
};

export type MonthlyAttendanceData = {
  month: number;
  year: number;
  monthName: string;
  students: MonthlyStudent[];
  daySummaries: Array<{
    date: string;
    dayOfWeek: string;
    totalSessions: number;
    postedSessions: number;
    presentCount: number;
    absentCount: number;
    avgPct: number;
  }>;
  summary: {
    totalStudents: number;
    totalSessionsConducted: number;
    avgAttendancePct: number;
    safeCount: number;
    warningCount: number;
    criticalCount: number;
  };
};

export type SemesterStudent = {
  id: string;
  studentDbId: number;
  name: string;
  pinNo: string | null;
  admissionNo: string;
  course: string | null;
  branch: string | null;
  year: number | null;
  semester: number | null;
  hasPhoto: boolean;
  totalClasses: number;
  presentCount: number;
  absentCount: number;
  odCount: number;
  leaveCount: number;
  percentage: number;
  eligibility: "Eligible" | "Condonation Required" | "Detained";
  subjectBreakdown: Array<{
    subjectCode: string;
    subjectName: string;
    total: number;
    present: number;
    percentage: number;
  }>;
};

export type SemesterAttendanceData = {
  semester: number | null;
  academicYear: string | null;
  students: SemesterStudent[];
  summary: {
    totalStudents: number;
    eligibleCount: number;
    condonationCount: number;
    detainedCount: number;
    avgAttendancePct: number;
    totalClassesConducted: number;
  };
  bands: Array<{ label: string; count: number; percentage: number }>;
};

export type OverviewAnalytics = {
  overallAttendance: number;
  studentsBelowThreshold: number;
  bands: { label: string; total: number }[];
  sections: { section: string; attendance: number }[];
  today?: { scheduled: number; posted: number; pending: number };
  source?: string;
};

type TabType = "today" | "week" | "month" | "semester" | "overview";

function getTodayString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getMonday(d: Date) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const dayStr = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${dayStr}`;
}

export function AttendanceAnalyticsView() {
  const { filters, setFilters } = useAcademicContext();
  const [activeTab, setActiveTab] = useState<TabType>("today");

  // Date & Section Controls
  const [selectedDate, setSelectedDate] = useState<string>(getTodayString());
  const [selectedWeekStart, setSelectedWeekStart] = useState<string>(() => getMonday(new Date()));
  const [selectedSection, setSelectedSection] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Month & Semester Controls
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [selectedSemester, setSelectedSemester] = useState<number>(1);
  const [expandedStudentId, setExpandedStudentId] = useState<string | null>(null);

  // Derived Year & Semester Options
  const currentYearNum =
    filters.year !== "all" && typeof filters.year === "number" ? filters.year : null;

  const semesterOptions = useMemo(() => {
    if (currentYearNum) {
      return [
        { value: 1, label: `${currentYearNum}-1 (Sem 1)` },
        { value: 2, label: `${currentYearNum}-2 (Sem 2)` },
      ];
    }
    return [
      { value: 1, label: "Semester 1" },
      { value: 2, label: "Semester 2" },
      { value: 3, label: "Semester 3" },
      { value: 4, label: "Semester 4" },
      { value: 5, label: "Semester 5" },
      { value: 6, label: "Semester 6" },
      { value: 7, label: "Semester 7" },
      { value: 8, label: "Semester 8" },
    ];
  }, [currentYearNum]);

  const handleSemesterChange = (newSem: number) => {
    setSelectedSemester(newSem);
    setFilters({ semester: newSem });
  };

  // Tab Data States
  const [dailyData, setDailyData] = useState<DailyAttendanceData | null>(null);
  const [weeklyData, setWeeklyData] = useState<WeeklyAttendanceData | null>(null);
  const [monthlyData, setMonthlyData] = useState<MonthlyAttendanceData | null>(null);
  const [semesterData, setSemesterData] = useState<SemesterAttendanceData | null>(null);
  const [overviewData, setOverviewData] = useState<OverviewAnalytics | null>(null);

  // Loading & Error States
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Sync selectedSection when global filters.section changes
  useEffect(() => {
    if (filters.section && filters.section !== "all") {
      setSelectedSection(filters.section);
    }
  }, [filters.section]);

  // Sync selectedSemester when global filters.semester changes
  useEffect(() => {
    if (filters.semester && filters.semester !== "all" && typeof filters.semester === "number") {
      setSelectedSemester(filters.semester);
    }
  }, [filters.semester]);

  // Query String for global context filters - FULLY RESPECTING ALL PAGE FILTERS!
  const baseQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.collegeId !== "all") params.set("collegeId", String(filters.collegeId));
    if (filters.courseId !== "all") params.set("courseId", String(filters.courseId));
    if (filters.branchId !== "all") params.set("branchId", String(filters.branchId));
    if (filters.batch && filters.batch !== "all") params.set("batch", String(filters.batch));
    if (filters.year && filters.year !== "all") params.set("year", String(filters.year));
    if (filters.semester && filters.semester !== "all") params.set("semester", String(filters.semester));
    if (filters.academicYear && filters.academicYear !== "all") {
      params.set("academicYear", String(filters.academicYear));
    }
    const sec = selectedSection || (filters.section !== "all" ? filters.section : "");
    if (sec && sec !== "all") params.set("section", sec);
    return params;
  }, [
    filters.collegeId,
    filters.courseId,
    filters.branchId,
    filters.batch,
    filters.year,
    filters.semester,
    filters.academicYear,
    filters.section,
    selectedSection,
  ]);

  // Load Data based on activeTab
  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      setLoading(true);
      setError(null);
      try {
        if (activeTab === "today") {
          const params = new URLSearchParams(baseQuery);
          params.set("date", selectedDate);
          if (selectedSemester) {
            params.set("semester", String(selectedSemester));
          }
          const res = await apiFetch(`/attendance/analytics/daily?${params.toString()}`, {
            cache: "no-store",
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(body.message || "Failed to load day attendance sheet");
          if (!cancelled) {
            const data = body as DailyAttendanceData;
            setDailyData(data);
            if (!selectedSection && data.section) {
              setSelectedSection(data.section);
            }
          }
        } else if (activeTab === "week") {
          const params = new URLSearchParams(baseQuery);
          if (selectedWeekStart) {
            params.set("startDate", selectedWeekStart);
          }
          if (selectedSemester) {
            params.set("semester", String(selectedSemester));
          }
          const res = await apiFetch(`/attendance/analytics/week?${params.toString()}`, {
            cache: "no-store",
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(body.message || "Failed to load weekly attendance sheet");
          if (!cancelled) {
            const data = body as WeeklyAttendanceData;
            setWeeklyData(data);
            if (!selectedSection && data.section) {
              setSelectedSection(data.section);
            }
          }
        } else if (activeTab === "month") {
          const params = new URLSearchParams(baseQuery);
          params.set("month", String(selectedMonth));
          params.set("year", String(selectedYear));
          if (selectedSemester) {
            params.set("semester", String(selectedSemester));
          }
          const res = await apiFetch(`/attendance/analytics/monthly?${params.toString()}`, {
            cache: "no-store",
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(body.message || "Failed to load monthly attendance sheet");
          if (!cancelled) setMonthlyData(body as MonthlyAttendanceData);
        } else if (activeTab === "semester") {
          const params = new URLSearchParams(baseQuery);
          params.set("semester", String(selectedSemester));
          const res = await apiFetch(`/attendance/analytics/semester?${params.toString()}`, {
            cache: "no-store",
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(body.message || "Failed to load semester attendance sheet");
          if (!cancelled) setSemesterData(body as SemesterAttendanceData);
        } else if (activeTab === "overview") {
          const params = new URLSearchParams(baseQuery);
          if (selectedSemester) {
            params.set("semester", String(selectedSemester));
          }
          const res = await apiFetch(`/attendance/analytics?${params.toString()}`, {
            cache: "no-store",
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(body.message || "Failed to load attendance overview");
          if (!cancelled) setOverviewData(body as OverviewAnalytics);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load data");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadData();
    return () => {
      cancelled = true;
    };
  }, [
    activeTab,
    baseQuery,
    selectedDate,
    selectedWeekStart,
    selectedMonth,
    selectedYear,
    selectedSemester,
    selectedSection,
  ]);

  // Quick Date Jump Handlers
  const handleJumpDate = (offsetDays: number) => {
    const d = new Date(selectedDate);
    if (isNaN(d.getTime())) return;
    d.setDate(d.getDate() + offsetDays);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    setSelectedDate(`${y}-${m}-${day}`);
  };

  const handleSetToday = () => {
    setSelectedDate(getTodayString());
  };

  const handleSetYesterday = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    setSelectedDate(`${y}-${m}-${day}`);
  };

  // Quick Week Jump Handlers
  const handleJumpWeek = (offsetWeeks: number) => {
    const d = new Date(selectedWeekStart);
    if (isNaN(d.getTime())) return;
    d.setDate(d.getDate() + offsetWeeks * 7);
    setSelectedWeekStart(getMonday(d));
  };

  const handleSetThisWeek = () => {
    setSelectedWeekStart(getMonday(new Date()));
  };

  // Filtered Students for Today Tab
  const filteredDailyStudents = useMemo(() => {
    if (!dailyData?.students) return [];
    let list = dailyData.students;

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.admissionNo.toLowerCase().includes(q) ||
          (s.pinNo && s.pinNo.toLowerCase().includes(q)),
      );
    }

    if (statusFilter === "below75") {
      list = list.filter((s) => s.percentage !== null && s.percentage < 75);
    } else if (statusFilter === "present") {
      list = list.filter((s) => s.totalPresent > 0);
    } else if (statusFilter === "absent") {
      list = list.filter((s) => s.totalAbsent > 0);
    } else if (statusFilter === "perfect") {
      list = list.filter((s) => s.percentage === 100);
    }

    return list;
  }, [dailyData?.students, searchQuery, statusFilter]);

  // Filtered Students for Week Tab
  const filteredWeeklyStudents = useMemo(() => {
    if (!weeklyData?.students) return [];
    let list = weeklyData.students;

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.admissionNo.toLowerCase().includes(q) ||
          (s.pinNo && s.pinNo.toLowerCase().includes(q)),
      );
    }

    if (statusFilter === "below75") {
      list = list.filter((s) => s.percentage !== null && s.percentage < 75);
    } else if (statusFilter === "present") {
      list = list.filter((s) => s.totalPresent > 0);
    } else if (statusFilter === "absent") {
      list = list.filter((s) => s.totalAbsent > 0);
    } else if (statusFilter === "perfect") {
      list = list.filter((s) => s.percentage === 100);
    }

    return list;
  }, [weeklyData?.students, searchQuery, statusFilter]);

  // Filtered Students for Month Tab
  const filteredMonthlyStudents = useMemo(() => {
    if (!monthlyData?.students) return [];
    let list = monthlyData.students;

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.admissionNo.toLowerCase().includes(q) ||
          (s.pinNo && s.pinNo.toLowerCase().includes(q)),
      );
    }

    if (statusFilter === "safe") {
      list = list.filter((s) => s.percentage >= 75);
    } else if (statusFilter === "warning") {
      list = list.filter((s) => s.percentage >= 65 && s.percentage < 75);
    } else if (statusFilter === "critical") {
      list = list.filter((s) => s.percentage < 65);
    }

    return list;
  }, [monthlyData?.students, searchQuery, statusFilter]);

  // Filtered Students for Semester Tab
  const filteredSemesterStudents = useMemo(() => {
    if (!semesterData?.students) return [];
    let list = semesterData.students;

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.admissionNo.toLowerCase().includes(q) ||
          (s.pinNo && s.pinNo.toLowerCase().includes(q)),
      );
    }

    if (statusFilter === "eligible") {
      list = list.filter((s) => s.eligibility === "Eligible");
    } else if (statusFilter === "condonation") {
      list = list.filter((s) => s.eligibility === "Condonation Required");
    } else if (statusFilter === "detained") {
      list = list.filter((s) => s.eligibility === "Detained");
    }

    return list;
  }, [semesterData?.students, searchQuery, statusFilter]);

  // Export Table to CSV
  const handleExportCSV = () => {
    let csvContent = "";
    let fileName = `attendance_analytics_${activeTab}.csv`;

    if (activeTab === "today" && dailyData) {
      fileName = `daily_attendance_${selectedDate}_${dailyData.section || "section"}.csv`;
      const slotHeaders = dailyData.slots
        .map((s) => `"${s.slotLabel} (${s.time}) - ${s.subjectCode || "Class"}"`)
        .join(",");
      csvContent = `S.No,PIN Number,Admission No,Student Name,${slotHeaders},Total Present,Total Absent,Total Conducted,Percentage\n`;

      filteredDailyStudents.forEach((student, index) => {
        const slotMarks = dailyData.slots
          .map((slot) => {
            const st = student.slots[slot.sessionId]?.status || "pending";
            return st === "present"
              ? "P"
              : st === "absent"
                ? "A"
                : st === "od"
                  ? "OD"
                  : st === "leave"
                    ? "L"
                    : "-";
          })
          .join(",");

        const pin = (student.pinNo || student.admissionNo).replace(/"/g, '""');
        const name = student.name.replace(/"/g, '""');
        const pct = student.percentage !== null ? `${student.percentage}%` : "—";
        csvContent += `${index + 1},"${pin}","${student.admissionNo}","${name}",${slotMarks},${student.totalPresent},${student.totalAbsent},${student.totalConducted},"${pct}"\n`;
      });
    } else if (activeTab === "week" && weeklyData) {
      fileName = `weekly_attendance_${weeklyData.startDate}_to_${weeklyData.endDate}.csv`;
      const slotHeaders: string[] = [];
      weeklyData.days.forEach((day) => {
        if (day.slots.length === 0) {
          slotHeaders.push(`"${day.dayOfWeek} (${day.date})"`);
        } else {
          day.slots.forEach((s) => {
            slotHeaders.push(`"${day.dayOfWeek} ${s.slotLabel} - ${s.subjectCode || "Class"}"`);
          });
        }
      });
      csvContent = `S.No,PIN Number,Admission No,Student Name,${slotHeaders.join(",")},Total Present,Total Absent,Total Conducted,Percentage\n`;

      filteredWeeklyStudents.forEach((student, index) => {
        const slotValues: string[] = [];
        weeklyData.days.forEach((day) => {
          const studentDay = student.days[day.date];
          if (day.slots.length === 0) {
            slotValues.push(`"-"`);
          } else {
            day.slots.forEach((s) => {
              const mark = studentDay?.slots[s.sessionId]?.status || "pending";
              slotValues.push(
                mark === "present"
                  ? "P"
                  : mark === "absent"
                    ? "A"
                    : mark === "od"
                      ? "OD"
                      : mark === "leave"
                        ? "L"
                        : "-",
              );
            });
          }
        });
        const pin = (student.pinNo || student.admissionNo).replace(/"/g, '""');
        const name = student.name.replace(/"/g, '""');
        const pct = student.percentage !== null ? `${student.percentage}%` : "—";
        csvContent += `${index + 1},"${pin}","${student.admissionNo}","${name}",${slotValues.join(",")},${student.totalPresent},${student.totalAbsent},${student.totalConducted},"${pct}"\n`;
      });
    } else if (activeTab === "month" && monthlyData) {
      fileName = `monthly_attendance_${monthlyData.month}_${monthlyData.year}.csv`;
      csvContent = `S.No,PIN Number,Admission No,Student Name,Total Working Sessions,Total Present,Total Absent,OD,Leave,Percentage,Status\n`;

      filteredMonthlyStudents.forEach((s, idx) => {
        const pin = (s.pinNo || s.admissionNo).replace(/"/g, '""');
        const name = s.name.replace(/"/g, '""');
        csvContent += `${idx + 1},"${pin}","${s.admissionNo}","${name}",${s.totalSlots},${s.presentCount},${s.absentCount},${s.odCount},${s.leaveCount},"${s.percentage}%","${s.status}"\n`;
      });
    } else if (activeTab === "semester" && semesterData) {
      fileName = `semester_attendance_sem${selectedSemester}.csv`;
      csvContent = `S.No,PIN Number,Admission No,Student Name,Total Classes,Total Present,Total Absent,Percentage,Eligibility Status\n`;

      filteredSemesterStudents.forEach((s, idx) => {
        const pin = (s.pinNo || s.admissionNo).replace(/"/g, '""');
        const name = s.name.replace(/"/g, '""');
        csvContent += `${idx + 1},"${pin}","${s.admissionNo}","${name}",${s.totalClasses},${s.presentCount},${s.absentCount},"${s.percentage}%","${s.eligibility}"\n`;
      });
    }

    if (!csvContent) return;
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const sectionsList = dailyData?.availableSections || weeklyData?.availableSections || [];

  return (
    <div className="space-y-3 pb-8">
      {/* Compact Top Header Bar: Title + Tabs + Export */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-base font-bold text-navy-900 tracking-tight flex items-center gap-2">
            <span>Attendance Analytics</span>
          </h1>

          {/* Compact Pill Tabs */}
          <nav className="inline-flex items-center rounded-lg bg-slate-100 p-0.5" aria-label="Tabs">
            <button
              type="button"
              onClick={() => {
                setActiveTab("today");
                setStatusFilter("all");
              }}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-all",
                activeTab === "today"
                  ? "bg-white text-navy-900 shadow-2xs font-bold"
                  : "text-slate-600 hover:text-slate-900",
              )}
            >
              <Clock className="h-3.5 w-3.5" />
              <span>Today (Slots)</span>
              {dailyData?.slots && dailyData.slots.length > 0 && (
                <span className="rounded bg-navy-100 px-1.5 py-0.2 text-[10px] text-navy-800 font-bold">
                  {dailyData.slots.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab("week");
                setStatusFilter("all");
              }}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-all",
                activeTab === "week"
                  ? "bg-white text-navy-900 shadow-2xs font-bold"
                  : "text-slate-600 hover:text-slate-900",
              )}
            >
              <Calendar className="h-3.5 w-3.5" />
              <span>Week (Slots)</span>
              {weeklyData?.summary?.totalSlotsInWeek ? (
                <span className="rounded bg-navy-100 px-1.5 py-0.2 text-[10px] text-navy-800 font-bold">
                  {weeklyData.summary.totalSlotsInWeek}
                </span>
              ) : null}
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab("month");
                setStatusFilter("all");
              }}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-all",
                activeTab === "month"
                  ? "bg-white text-navy-900 shadow-2xs font-bold"
                  : "text-slate-600 hover:text-slate-900",
              )}
            >
              <CalendarDays className="h-3.5 w-3.5" />
              <span>Month</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab("semester");
                setStatusFilter("all");
              }}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-all",
                activeTab === "semester"
                  ? "bg-white text-navy-900 shadow-2xs font-bold"
                  : "text-slate-600 hover:text-slate-900",
              )}
            >
              <GraduationCap className="h-3.5 w-3.5" />
              <span>Semester Wise</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab("overview");
                setStatusFilter("all");
              }}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-all",
                activeTab === "overview"
                  ? "bg-white text-navy-900 shadow-2xs font-bold"
                  : "text-slate-600 hover:text-slate-900",
              )}
            >
              <PieChart className="h-3.5 w-3.5" />
              <span>Overview</span>
            </button>
          </nav>
        </div>

        {/* Action button */}
        <button
          type="button"
          onClick={handleExportCSV}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition-colors"
        >
          <Download className="h-3.5 w-3.5 text-slate-500" />
          <span>Export CSV</span>
        </button>
      </div>

      {/* Unified Compact Action Toolbar (Zero wasted vertical space) */}
      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-2xs flex flex-wrap items-center justify-between gap-2.5 text-xs">
        {/* Left Side: Date / Month / Semester Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {activeTab === "today" && (
            <>
              <div className="flex items-center rounded-md border border-slate-200 bg-slate-50 p-0.5">
                <button
                  type="button"
                  onClick={() => handleJumpDate(-1)}
                  className="rounded p-1 text-slate-600 hover:bg-white hover:text-slate-900"
                  title="Previous Day"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="bg-transparent px-1.5 py-0.5 text-xs font-semibold text-slate-800 outline-none cursor-pointer"
                />
                <button
                  type="button"
                  onClick={() => handleJumpDate(1)}
                  className="rounded p-1 text-slate-600 hover:bg-white hover:text-slate-900"
                  title="Next Day"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>

              <button
                type="button"
                onClick={handleSetToday}
                className={cn(
                  "rounded-md px-2 py-1 text-xs font-semibold transition-colors border",
                  selectedDate === getTodayString()
                    ? "border-navy-900 bg-navy-900 text-white"
                    : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100",
                )}
              >
                Today
              </button>
              <button
                type="button"
                onClick={handleSetYesterday}
                className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
              >
                Yesterday
              </button>

              {sectionsList.length > 0 && (
                <div className="flex items-center gap-1 ml-1 pl-2 border-l border-slate-200">
                  <span className="text-slate-500 font-medium">Sec:</span>
                  <select
                    value={selectedSection}
                    onChange={(e) => setSelectedSection(e.target.value)}
                    className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs font-semibold text-slate-800 outline-none hover:bg-white focus:bg-white cursor-pointer"
                  >
                    {sectionsList.map((sec) => (
                      <option key={sec} value={sec}>
                        {sec}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Quick Semester Shift on Today's attendance */}
              <div className="flex items-center gap-1 ml-1 pl-2 border-l border-slate-200">
                <span className="text-slate-500 font-medium">Sem:</span>
                <select
                  value={selectedSemester}
                  onChange={(e) => handleSemesterChange(Number(e.target.value))}
                  className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs font-semibold text-slate-800 outline-none hover:bg-white focus:bg-white cursor-pointer"
                >
                  {semesterOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {activeTab === "week" && (
            <>
              <div className="flex items-center rounded-md border border-slate-200 bg-slate-50 p-0.5">
                <button
                  type="button"
                  onClick={() => handleJumpWeek(-1)}
                  className="rounded p-1 text-slate-600 hover:bg-white hover:text-slate-900"
                  title="Previous Week"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <span className="px-2 py-0.5 text-xs font-semibold text-slate-800">
                  {weeklyData?.weekLabel || selectedWeekStart}
                </span>
                <button
                  type="button"
                  onClick={() => handleJumpWeek(1)}
                  className="rounded p-1 text-slate-600 hover:bg-white hover:text-slate-900"
                  title="Next Week"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>

              <button
                type="button"
                onClick={handleSetThisWeek}
                className={cn(
                  "rounded-md px-2 py-1 text-xs font-semibold transition-colors border",
                  selectedWeekStart === getMonday(new Date())
                    ? "border-navy-900 bg-navy-900 text-white"
                    : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100",
                )}
              >
                This Week
              </button>

              {sectionsList.length > 0 && (
                <div className="flex items-center gap-1 ml-1 pl-2 border-l border-slate-200">
                  <span className="text-slate-500 font-medium">Sec:</span>
                  <select
                    value={selectedSection}
                    onChange={(e) => setSelectedSection(e.target.value)}
                    className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs font-semibold text-slate-800 outline-none hover:bg-white focus:bg-white cursor-pointer"
                  >
                    {sectionsList.map((sec) => (
                      <option key={sec} value={sec}>
                        {sec}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Quick Semester Shift on Week view */}
              <div className="flex items-center gap-1 ml-1 pl-2 border-l border-slate-200">
                <span className="text-slate-500 font-medium">Sem:</span>
                <select
                  value={selectedSemester}
                  onChange={(e) => handleSemesterChange(Number(e.target.value))}
                  className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs font-semibold text-slate-800 outline-none hover:bg-white focus:bg-white cursor-pointer"
                >
                  {semesterOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {activeTab === "month" && (
            <>
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 font-medium">Month:</span>
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(Number(e.target.value))}
                  className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-800 outline-none hover:bg-white focus:bg-white cursor-pointer"
                >
                  {[
                    "January", "February", "March", "April", "May", "June",
                    "July", "August", "September", "October", "November", "December",
                  ].map((name, idx) => (
                    <option key={name} value={idx + 1}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 font-medium">Year:</span>
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(Number(e.target.value))}
                  className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-800 outline-none hover:bg-white focus:bg-white cursor-pointer"
                >
                  {[2024, 2025, 2026, 2027].map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>

              {/* Quick Semester Shift on Monthly view */}
              <div className="flex items-center gap-1 ml-1 pl-2 border-l border-slate-200">
                <span className="text-slate-500 font-medium">Sem:</span>
                <select
                  value={selectedSemester}
                  onChange={(e) => handleSemesterChange(Number(e.target.value))}
                  className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs font-semibold text-slate-800 outline-none hover:bg-white focus:bg-white cursor-pointer"
                >
                  {semesterOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {activeTab === "semester" && (
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500 font-medium">Semester:</span>
              <select
                value={selectedSemester}
                onChange={(e) => handleSemesterChange(Number(e.target.value))}
                className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-800 outline-none hover:bg-white focus:bg-white cursor-pointer"
              >
                {semesterOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Center: Sleek Inline Summary Chips (Replacing the huge stat boxes!) */}
        <div className="flex flex-wrap items-center gap-2">
          {activeTab === "today" && dailyData && (
            <>
              <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                <Users className="h-3 w-3 text-slate-500" />
                <span>{dailyData.summary.totalStudents} Students</span>
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-navy-50 px-2 py-0.5 text-xs font-semibold text-navy-800">
                <Clock className="h-3 w-3 text-navy-600" />
                <span>{dailyData.summary.postedSlots}/{dailyData.summary.totalSlots} Slots</span>
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-bold",
                  dailyData.summary.avgAttendancePct >= 75
                    ? "bg-emerald-50 text-emerald-800"
                    : "bg-amber-50 text-amber-800",
                )}
              >
                <TrendingUp className="h-3 w-3" />
                <span>{dailyData.summary.avgAttendancePct}% Avg</span>
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-600 border border-slate-200">
                <span className="text-emerald-700 font-bold">{dailyData.summary.totalPresentMarks}P</span>
                <span>/</span>
                <span className="text-rose-700 font-bold">{dailyData.summary.totalAbsentMarks}A</span>
              </span>
            </>
          )}

          {activeTab === "week" && weeklyData && (
            <>
              <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                <Users className="h-3 w-3 text-slate-500" />
                <span>{weeklyData.summary.totalStudents} Students</span>
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-navy-50 px-2 py-0.5 text-xs font-semibold text-navy-800">
                <Clock className="h-3 w-3 text-navy-600" />
                <span>{weeklyData.summary.postedSlotsInWeek}/{weeklyData.summary.totalSlotsInWeek} Slots</span>
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-bold",
                  weeklyData.summary.avgAttendancePct >= 75
                    ? "bg-emerald-50 text-emerald-800"
                    : "bg-amber-50 text-amber-800",
                )}
              >
                <TrendingUp className="h-3 w-3" />
                <span>{weeklyData.summary.avgAttendancePct}% Avg</span>
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-600 border border-slate-200">
                <span className="text-emerald-700 font-bold">{weeklyData.summary.totalPresentMarks}P</span>
                <span>/</span>
                <span className="text-rose-700 font-bold">{weeklyData.summary.totalAbsentMarks}A</span>
              </span>
            </>
          )}

          {activeTab === "month" && monthlyData && (
            <>
              <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                <Users className="h-3 w-3 text-slate-500" />
                <span>{monthlyData.summary.totalStudents} Students</span>
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-navy-50 px-2 py-0.5 text-xs font-semibold text-navy-800">
                <span>{monthlyData.summary.totalSessionsConducted} Sessions</span>
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-800">
                <span>{monthlyData.summary.avgAttendancePct}% Avg</span>
              </span>
            </>
          )}

          {activeTab === "semester" && semesterData && (
            <>
              <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                <Users className="h-3 w-3 text-slate-500" />
                <span>{semesterData.summary.totalStudents} Students</span>
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-800">
                <span>{semesterData.summary.eligibleCount} Eligible</span>
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-800">
                <span>{semesterData.summary.condonationCount} Condonation</span>
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-0.5 text-xs font-bold text-rose-800">
                <span>{semesterData.summary.detainedCount} Detained</span>
              </span>
            </>
          )}
        </div>

        {/* Right Side: Search & Quick Status Filters */}
        {activeTab !== "overview" && (
          <div className="flex items-center gap-2 ml-auto">
            <div className="relative w-40 sm:w-48">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400" />
              <input
                type="text"
                placeholder="Search PIN / Name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-md border border-slate-200 bg-slate-50 pl-7 pr-2 py-1 text-xs text-slate-800 placeholder-slate-400 outline-none focus:bg-white focus:border-navy-700"
              />
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setStatusFilter("all")}
                className={cn(
                  "rounded px-2 py-0.5 text-[11px] font-semibold transition-colors",
                  statusFilter === "all"
                    ? "bg-slate-800 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                )}
              >
                All
              </button>

              {(activeTab === "today" || activeTab === "week") && (
                <>
                  <button
                    type="button"
                    onClick={() => setStatusFilter("present")}
                    className={cn(
                      "rounded px-2 py-0.5 text-[11px] font-semibold transition-colors",
                      statusFilter === "present"
                        ? "bg-emerald-700 text-white"
                        : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
                    )}
                  >
                    Present
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusFilter("absent")}
                    className={cn(
                      "rounded px-2 py-0.5 text-[11px] font-semibold transition-colors",
                      statusFilter === "absent"
                        ? "bg-rose-700 text-white"
                        : "bg-rose-50 text-rose-700 hover:bg-rose-100",
                    )}
                  >
                    Absent
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusFilter("below75")}
                    className={cn(
                      "rounded px-2 py-0.5 text-[11px] font-semibold transition-colors",
                      statusFilter === "below75"
                        ? "bg-amber-700 text-white"
                        : "bg-amber-50 text-amber-700 hover:bg-amber-100",
                    )}
                  >
                    &lt;75%
                  </button>
                </>
              )}

              {activeTab === "month" && (
                <>
                  <button
                    type="button"
                    onClick={() => setStatusFilter("safe")}
                    className={cn(
                      "rounded px-2 py-0.5 text-[11px] font-semibold transition-colors",
                      statusFilter === "safe"
                        ? "bg-emerald-700 text-white"
                        : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
                    )}
                  >
                    Safe
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusFilter("critical")}
                    className={cn(
                      "rounded px-2 py-0.5 text-[11px] font-semibold transition-colors",
                      statusFilter === "critical"
                        ? "bg-rose-700 text-white"
                        : "bg-rose-50 text-rose-700 hover:bg-rose-100",
                    )}
                  >
                    Critical
                  </button>
                </>
              )}

              {activeTab === "semester" && (
                <>
                  <button
                    type="button"
                    onClick={() => setStatusFilter("eligible")}
                    className={cn(
                      "rounded px-2 py-0.5 text-[11px] font-semibold transition-colors",
                      statusFilter === "eligible"
                        ? "bg-emerald-700 text-white"
                        : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
                    )}
                  >
                    Eligible
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusFilter("detained")}
                    className={cn(
                      "rounded px-2 py-0.5 text-[11px] font-semibold transition-colors",
                      statusFilter === "detained"
                        ? "bg-rose-700 text-white"
                        : "bg-rose-50 text-rose-700 hover:bg-rose-100",
                    )}
                  >
                    Detained
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
          <span>{error}</span>
        </div>
      ) : null}

      {loading ? (
        <div className="flex flex-col items-center justify-center p-12 text-slate-400 space-y-2">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-navy-800 border-t-transparent" />
          <p className="text-xs font-medium">Loading attendance data…</p>
        </div>
      ) : (
        <>
          {/* ======================================================== */}
          {/* TAB 1: TODAY (DAY TIMETABLE SLOTS)                        */}
          {/* ======================================================== */}
          {activeTab === "today" && dailyData && (
            <div>
              {dailyData.slots.length === 0 ? (
                <Card className="p-8 text-center text-slate-500">
                  <Clock className="mx-auto h-8 w-8 text-slate-300 mb-2" />
                  <p className="font-semibold text-slate-700">No timetable slots scheduled for this date.</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Select a working class day or ensure timetable plans are published for this cohort.
                  </p>
                </Card>
              ) : (
                <div className="rounded-lg border border-slate-200 bg-white shadow-2xs overflow-hidden">
                  {/* Table Header Strip with integrated Legend */}
                  <div className="border-b border-slate-200 bg-slate-50/90 px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-navy-900 text-xs">
                        Day Timetable Slots & Student Attendance
                      </span>
                      {dailyData.section && (
                        <span className="inline-flex items-center rounded bg-navy-100 px-2 py-0.2 text-[11px] font-semibold text-navy-800">
                          Sec {dailyData.section}
                        </span>
                      )}
                      <span className="text-[11px] text-slate-500">({selectedDate})</span>
                    </div>

                    {/* Integrated Legend */}
                    <div className="flex items-center gap-2 text-[11px] font-medium text-slate-600">
                      <span className="inline-flex items-center gap-1">
                        <span className="inline-block w-3 h-3 rounded bg-emerald-100 border border-emerald-300 text-emerald-800 font-bold text-[8px] leading-none text-center pt-0.5">
                          P
                        </span>
                        <span>Present</span>
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="inline-block w-3 h-3 rounded bg-rose-100 border border-rose-300 text-rose-800 font-bold text-[8px] leading-none text-center pt-0.5">
                          A
                        </span>
                        <span>Absent</span>
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="inline-block w-3 h-3 rounded bg-purple-100 border border-purple-300 text-purple-800 font-bold text-[8px] leading-none text-center pt-0.5">
                          OD
                        </span>
                        <span>On Duty</span>
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="inline-block w-3 h-3 rounded bg-slate-100 border border-slate-300 text-slate-400 font-bold text-[8px] leading-none text-center pt-0.5">
                          –
                        </span>
                        <span>Pending</span>
                      </span>
                    </div>
                  </div>

                  {/* Day Timetable Slots Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-100/95 text-slate-700 font-semibold text-[11px] uppercase tracking-wider">
                          <th className="sticky left-0 z-20 bg-slate-100 px-2.5 py-2.5 w-10 text-center">#</th>
                          <th className="sticky left-10 z-20 bg-slate-100 px-2.5 py-2.5 w-48 min-w-[180px]">
                            Student (Photo & PIN)
                          </th>
                          <th className="px-2.5 py-2.5 min-w-[170px]">Student Name</th>

                          {/* Dynamic Slot Columns of the Day */}
                          {dailyData.slots.map((slot) => (
                            <th
                              key={slot.sessionId}
                              className="px-2 py-2 text-center min-w-[100px] border-l border-slate-200"
                            >
                              <div className="flex flex-col items-center">
                                <span className="font-bold text-navy-900 text-[11px]">{slot.slotLabel}</span>
                                <span className="text-[10px] text-slate-500 font-normal">{slot.time}</span>
                                <span
                                  className="text-[10px] font-semibold text-slate-700 truncate max-w-[90px] mt-0.5"
                                  title={`${slot.subjectCode || "Class"} - ${slot.subjectName || ""}`}
                                >
                                  {slot.subjectCode || "Class"}
                                </span>
                                {slot.posted ? (
                                  <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-emerald-700 mt-0.5">
                                    <CheckCircle2 className="h-2.5 w-2.5" />
                                    <span>{slot.presentCount}P / {slot.absentCount}A</span>
                                  </span>
                                ) : (
                                  <span className="text-[9px] text-slate-400 font-normal mt-0.5">
                                    Pending
                                  </span>
                                )}
                              </div>
                            </th>
                          ))}

                          {/* Summary Columns */}
                          <th className="px-2.5 py-2 text-center min-w-[70px] bg-emerald-50/50 text-emerald-900 border-l border-slate-200">
                            Present
                          </th>
                          <th className="px-2.5 py-2 text-center min-w-[70px] bg-rose-50/50 text-rose-900 border-l border-slate-200">
                            Absent
                          </th>
                          <th className="px-2.5 py-2 text-center min-w-[75px] bg-slate-100 border-l border-slate-200">
                            Day %
                          </th>
                        </tr>
                      </thead>

                      <tbody className="divide-y divide-slate-200 bg-white">
                        {filteredDailyStudents.length === 0 ? (
                          <tr>
                            <td
                              colSpan={6 + dailyData.slots.length}
                              className="px-4 py-8 text-center text-slate-400 font-medium"
                            >
                              No students found matching current filters.
                            </td>
                          </tr>
                        ) : (
                          filteredDailyStudents.map((student, index) => {
                            const displayPin =
                              student.pinNo && student.pinNo.trim()
                                ? student.pinNo.trim()
                                : student.admissionNo;

                            return (
                              <tr key={student.id} className="hover:bg-slate-50/80 transition-colors">
                                {/* S.No */}
                                <td className="sticky left-0 z-10 bg-white hover:bg-slate-50 px-2.5 py-1.5 text-center text-slate-400 font-bold">
                                  {index + 1}
                                </td>

                                {/* Photo + PIN Number */}
                                <td className="sticky left-10 z-10 bg-white hover:bg-slate-50 px-2.5 py-1.5">
                                  <div className="flex items-center gap-2">
                                    <StudentAvatar
                                      name={student.name}
                                      photo={null}
                                      studentId={student.id}
                                      hasPhoto={student.hasPhoto}
                                      size="sm"
                                    />
                                    <span className="font-bold text-navy-900 tracking-wide text-xs">
                                      {displayPin}
                                    </span>
                                  </div>
                                </td>

                                {/* Student Name */}
                                <td className="px-2.5 py-1.5 font-medium text-slate-800">
                                  <div className="truncate max-w-[190px]" title={student.name}>
                                    {student.name}
                                  </div>
                                  <div className="text-[10px] text-slate-400 truncate flex items-center gap-1.5">
                                    <span>{student.course} {student.branch ? `• ${student.branch}` : ""}</span>
                                    {student.year && student.semester && (
                                      <span className="inline-flex items-center rounded bg-slate-100 border border-slate-200 px-1 py-0.2 text-[9px] font-bold text-slate-600">
                                        {student.year}-{student.semester}
                                      </span>
                                    )}
                                  </div>
                                </td>

                                {/* Day Timetable Slots */}
                                {dailyData.slots.map((slot) => {
                                  const slotStatus =
                                    student.slots[slot.sessionId]?.status || "pending";

                                  return (
                                    <td
                                      key={slot.sessionId}
                                      className="px-2 py-1.5 text-center border-l border-slate-100"
                                    >
                                      {slotStatus === "present" ? (
                                        <span className="inline-flex items-center justify-center w-6 h-6 rounded font-bold text-xs bg-emerald-100 text-emerald-800 border border-emerald-300">
                                          P
                                        </span>
                                      ) : slotStatus === "absent" ? (
                                        <span className="inline-flex items-center justify-center w-6 h-6 rounded font-bold text-xs bg-rose-100 text-rose-800 border border-rose-300">
                                          A
                                        </span>
                                      ) : slotStatus === "od" ? (
                                        <span className="inline-flex items-center justify-center w-6 h-6 rounded font-bold text-[10px] bg-purple-100 text-purple-800 border border-purple-300">
                                          OD
                                        </span>
                                      ) : slotStatus === "leave" ? (
                                        <span className="inline-flex items-center justify-center w-6 h-6 rounded font-bold text-xs bg-sky-100 text-sky-800 border border-sky-300">
                                          L
                                        </span>
                                      ) : (
                                        <span className="inline-flex items-center justify-center w-6 h-6 rounded text-xs text-slate-300 font-bold bg-slate-50 border border-slate-200">
                                          –
                                        </span>
                                      )}
                                    </td>
                                  );
                                })}

                                {/* Total Present */}
                                <td className="px-2.5 py-1.5 text-center font-bold text-emerald-700 bg-emerald-50/20 border-l border-slate-100 text-xs">
                                  {student.totalPresent}
                                </td>

                                {/* Total Absent */}
                                <td className="px-2.5 py-1.5 text-center font-bold text-rose-700 bg-rose-50/20 border-l border-slate-100 text-xs">
                                  {student.totalAbsent}
                                </td>

                                {/* Day % */}
                                <td className="px-2.5 py-1.5 text-center border-l border-slate-100">
                                  {student.percentage !== null ? (
                                    <span
                                      className={cn(
                                        "inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-bold",
                                        student.percentage >= 75
                                          ? "bg-emerald-100 text-emerald-800"
                                          : student.percentage >= 65
                                            ? "bg-amber-100 text-amber-800"
                                            : "bg-rose-100 text-rose-800",
                                      )}
                                    >
                                      {student.percentage}%
                                    </span>
                                  ) : (
                                    <span className="text-slate-400 font-medium text-xs">—</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ======================================================== */}
          {/* TAB 2: WEEK (DAY SLOTS MATRIX)                           */}
          {/* ======================================================== */}
          {activeTab === "week" && weeklyData && (
            <div>
              {weeklyData.days.every((d) => d.slots.length === 0) ? (
                <Card className="p-8 text-center text-slate-500">
                  <Calendar className="mx-auto h-8 w-8 text-slate-300 mb-2" />
                  <p className="font-semibold text-slate-700">No timetable slots scheduled for this week.</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Select an active teaching week or ensure timetable plans are published for this cohort.
                  </p>
                </Card>
              ) : (
                <div className="rounded-lg border border-slate-200 bg-white shadow-2xs overflow-hidden">
                  {/* Table Header Strip with integrated Legend */}
                  <div className="border-b border-slate-200 bg-slate-50/90 px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-navy-900 text-xs">
                        Weekly Timetable Slots & Student Attendance
                      </span>
                      {weeklyData.section && (
                        <span className="inline-flex items-center rounded bg-navy-100 px-2 py-0.2 text-[11px] font-semibold text-navy-800">
                          Sec {weeklyData.section}
                        </span>
                      )}
                      <span className="text-[11px] text-slate-500">
                        ({weeklyData.weekLabel || `${weeklyData.startDate} to ${weeklyData.endDate}`})
                      </span>
                    </div>

                    {/* Integrated Legend */}
                    <div className="flex items-center gap-2 text-[11px] font-medium text-slate-600">
                      <span className="inline-flex items-center gap-1">
                        <span className="inline-block w-3 h-3 rounded bg-emerald-100 border border-emerald-300 text-emerald-800 font-bold text-[8px] leading-none text-center pt-0.5">
                          P
                        </span>
                        <span>Present</span>
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="inline-block w-3 h-3 rounded bg-rose-100 border border-rose-300 text-rose-800 font-bold text-[8px] leading-none text-center pt-0.5">
                          A
                        </span>
                        <span>Absent</span>
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="inline-block w-3 h-3 rounded bg-purple-100 border border-purple-300 text-purple-800 font-bold text-[8px] leading-none text-center pt-0.5">
                          OD
                        </span>
                        <span>On Duty</span>
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="inline-block w-3 h-3 rounded bg-sky-100 border border-sky-300 text-sky-800 font-bold text-[8px] leading-none text-center pt-0.5">
                          L
                        </span>
                        <span>Leave</span>
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="inline-block w-3 h-3 rounded bg-slate-100 border border-slate-300 text-slate-400 font-bold text-[8px] leading-none text-center pt-0.5">
                          –
                        </span>
                        <span>Pending</span>
                      </span>
                    </div>
                  </div>

                  {/* Weekly Slots Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-100/95 text-slate-700 font-semibold text-[11px] uppercase tracking-wider">
                          <th className="sticky left-0 z-20 bg-slate-100 px-2.5 py-2.5 w-10 text-center">#</th>
                          <th className="sticky left-10 z-20 bg-slate-100 px-2.5 py-2.5 w-48 min-w-[180px]">
                            Student (Photo & PIN)
                          </th>
                          <th className="px-2.5 py-2.5 min-w-[170px]">Student Name</th>

                          {/* Day Columns (Mon - Sat) */}
                          {weeklyData.days.map((day) => (
                            <th
                              key={day.date}
                              className="px-2 py-2 text-center min-w-[130px] border-l border-slate-200"
                            >
                              <div className="flex flex-col items-center">
                                <span className="font-bold text-navy-900 text-[11px]">
                                  {day.dayOfWeek}
                                </span>
                                <span className="text-[10px] text-slate-500 font-normal">
                                  {day.date.slice(5)} {day.slots.length > 0 ? `(${day.slots.length} slots)` : ""}
                                </span>
                              </div>
                            </th>
                          ))}

                          {/* Summary Columns */}
                          <th className="px-2.5 py-2 text-center min-w-[70px] bg-emerald-50/50 text-emerald-900 border-l border-slate-200">
                            Present
                          </th>
                          <th className="px-2.5 py-2 text-center min-w-[70px] bg-rose-50/50 text-rose-900 border-l border-slate-200">
                            Absent
                          </th>
                          <th className="px-2.5 py-2 text-center min-w-[80px] bg-slate-200/60 text-slate-900 border-l border-slate-200">
                            Week %
                          </th>
                        </tr>
                      </thead>

                      <tbody className="divide-y divide-slate-200">
                        {filteredWeeklyStudents.length === 0 ? (
                          <tr>
                            <td
                              colSpan={weeklyData.days.length + 6}
                              className="px-4 py-8 text-center text-slate-400 font-medium"
                            >
                              No students found matching current filters.
                            </td>
                          </tr>
                        ) : (
                          filteredWeeklyStudents.map((student, idx) => (
                            <tr
                              key={student.id}
                              className="hover:bg-slate-50/80 transition-colors group"
                            >
                              {/* S.No */}
                              <td className="sticky left-0 z-10 bg-white group-hover:bg-slate-50 px-2.5 py-1.5 text-center text-slate-400 font-medium text-[11px]">
                                {idx + 1}
                              </td>

                              {/* Student Photo & PIN */}
                              <td className="sticky left-10 z-10 bg-white group-hover:bg-slate-50 px-2.5 py-1.5 font-medium text-slate-900">
                                <div className="flex items-center gap-2">
                                  <StudentAvatar
                                    name={student.name}
                                    photo={null}
                                    studentId={student.id}
                                    hasPhoto={student.hasPhoto}
                                    size="sm"
                                  />
                                  <div className="min-w-0">
                                    <div className="font-bold text-navy-900 text-xs truncate">
                                      {student.pinNo || student.admissionNo}
                                    </div>
                                    <div className="text-[10px] text-slate-400 truncate">
                                      {student.admissionNo}
                                    </div>
                                  </div>
                                </div>
                              </td>

                              {/* Student Name */}
                              <td className="px-2.5 py-1.5 font-medium text-slate-800">
                                <div className="truncate max-w-[190px]" title={student.name}>
                                  {student.name}
                                </div>
                                <div className="text-[10px] text-slate-400 truncate flex items-center gap-1.5">
                                  <span>{student.course} {student.branch ? `• ${student.branch}` : ""}</span>
                                  {student.year && student.semester && (
                                    <span className="inline-flex items-center rounded bg-slate-100 border border-slate-200 px-1 py-0.2 text-[9px] font-bold text-slate-600">
                                      {student.year}-{student.semester}
                                    </span>
                                  )}
                                </div>
                              </td>

                              {/* Day Slots Matrix */}
                              {weeklyData.days.map((day) => {
                                const studentDay = student.days[day.date];
                                return (
                                  <td
                                    key={day.date}
                                    className="px-1.5 py-1.5 text-center border-l border-slate-100 align-middle"
                                  >
                                    {day.slots.length === 0 ? (
                                      <span className="text-[11px] text-slate-300 font-medium">—</span>
                                    ) : (
                                      <div className="flex flex-wrap items-center justify-center gap-1 max-w-[170px] mx-auto">
                                        {day.slots.map((slot) => {
                                          const mark = studentDay?.slots[slot.sessionId]?.status || "pending";
                                          return (
                                            <span
                                              key={slot.sessionId}
                                              title={`${day.dayOfWeek} ${slot.slotLabel} (${slot.time}): ${slot.subjectCode || slot.facultyName || "Class"} — ${mark.toUpperCase()}`}
                                              className={cn(
                                                "inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold border transition-transform hover:scale-110 cursor-help",
                                                mark === "present"
                                                  ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                                                  : mark === "absent"
                                                    ? "bg-rose-100 text-rose-800 border-rose-300"
                                                    : mark === "od"
                                                      ? "bg-purple-100 text-purple-800 border-purple-300"
                                                      : mark === "leave"
                                                        ? "bg-sky-100 text-sky-800 border-sky-300"
                                                        : "bg-slate-50 text-slate-300 border-slate-200",
                                              )}
                                            >
                                              {mark === "present"
                                                ? "P"
                                                : mark === "absent"
                                                  ? "A"
                                                  : mark === "od"
                                                    ? "OD"
                                                    : mark === "leave"
                                                      ? "L"
                                                      : "–"}
                                            </span>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </td>
                                );
                              })}

                              {/* Total Present */}
                              <td className="px-2.5 py-1.5 text-center font-bold text-emerald-700 bg-emerald-50/20 border-l border-slate-100 text-xs">
                                {student.totalPresent}
                              </td>

                              {/* Total Absent */}
                              <td className="px-2.5 py-1.5 text-center font-bold text-rose-700 bg-rose-50/20 border-l border-slate-100 text-xs">
                                {student.totalAbsent}
                              </td>

                              {/* Week % */}
                              <td className="px-2.5 py-1.5 text-center border-l border-slate-100">
                                {student.percentage !== null ? (
                                  <span
                                    className={cn(
                                      "inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-bold",
                                      student.percentage >= 75
                                        ? "bg-emerald-100 text-emerald-800"
                                        : student.percentage >= 65
                                          ? "bg-amber-100 text-amber-800"
                                          : "bg-rose-100 text-rose-800",
                                    )}
                                  >
                                    {student.percentage}%
                                  </span>
                                ) : (
                                  <span className="text-slate-400 font-medium text-xs">—</span>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ======================================================== */}
          {/* TAB 3: MONTHLY ATTENDANCE SHEET                           */}
          {/* ======================================================== */}
          {activeTab === "month" && monthlyData && (
            <div className="space-y-3">
              {/* Day Summaries Mini Strip */}
              {monthlyData.daySummaries.length > 0 && (
                <div className="rounded-lg border border-slate-200 bg-white p-2.5 shadow-2xs">
                  <div className="text-[11px] font-semibold text-slate-700 mb-1.5 flex items-center gap-1.5">
                    <Calendar className="h-3 w-3 text-navy-800" />
                    <span>Daily Attendance Trend ({monthlyData.monthName})</span>
                  </div>
                  <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
                    {monthlyData.daySummaries.map((day) => (
                      <div
                        key={day.date}
                        className={cn(
                          "flex flex-col items-center justify-center py-1 px-1.5 rounded border text-center shrink-0 min-w-[55px]",
                          day.postedSessions > 0
                            ? day.avgPct >= 75
                              ? "border-emerald-200 bg-emerald-50/50 text-emerald-900"
                              : "border-amber-200 bg-amber-50/50 text-amber-900"
                            : "border-slate-100 bg-slate-50 text-slate-400",
                        )}
                      >
                        <span className="text-[9px] font-semibold text-slate-500 uppercase">
                          {day.date.slice(8)} {day.dayOfWeek.slice(0, 3)}
                        </span>
                        <span className="text-[11px] font-bold mt-0.5">
                          {day.postedSessions > 0 ? `${day.avgPct}%` : "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Monthly Table */}
              <div className="rounded-lg border border-slate-200 bg-white shadow-2xs overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-100/90 text-slate-700 font-semibold text-[11px] uppercase tracking-wider">
                        <th className="px-2.5 py-2.5 w-10 text-center">#</th>
                        <th className="px-2.5 py-2.5 w-48">Photo & PIN Number</th>
                        <th className="px-2.5 py-2.5 min-w-[170px]">Student Name</th>
                        <th className="px-2.5 py-2.5 text-center">Conducted Slots</th>
                        <th className="px-2.5 py-2.5 text-center text-emerald-800">Total Present</th>
                        <th className="px-2.5 py-2.5 text-center text-rose-800">Total Absent</th>
                        <th className="px-2.5 py-2.5 text-center">OD / Leave</th>
                        <th className="px-2.5 py-2.5 text-center min-w-[130px]">Monthly %</th>
                        <th className="px-2.5 py-2.5 text-center min-w-[90px]">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {filteredMonthlyStudents.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="px-4 py-8 text-center text-slate-400 font-medium">
                            No students found matching current filters.
                          </td>
                        </tr>
                      ) : (
                        filteredMonthlyStudents.map((student, index) => {
                          const displayPin =
                            student.pinNo && student.pinNo.trim()
                              ? student.pinNo.trim()
                              : student.admissionNo;

                          return (
                            <tr key={student.id} className="hover:bg-slate-50/80 transition-colors">
                              <td className="px-2.5 py-1.5 text-center text-slate-400 font-bold">
                                {index + 1}
                              </td>

                              <td className="px-2.5 py-1.5">
                                <div className="flex items-center gap-2">
                                  <StudentAvatar
                                    name={student.name}
                                    photo={null}
                                    studentId={student.id}
                                    hasPhoto={student.hasPhoto}
                                    size="sm"
                                  />
                                  <span className="font-bold text-navy-900 tracking-wide text-xs">
                                    {displayPin}
                                  </span>
                                </div>
                              </td>

                              <td className="px-2.5 py-1.5 font-medium text-slate-800">
                                <div className="truncate max-w-[200px]" title={student.name}>
                                  {student.name}
                                </div>
                                <div className="text-[10px] text-slate-400 truncate flex items-center gap-1.5">
                                  <span>{student.course} {student.branch ? `• ${student.branch}` : ""}</span>
                                  {student.year && student.semester && (
                                    <span className="inline-flex items-center rounded bg-slate-100 border border-slate-200 px-1 py-0.2 text-[9px] font-bold text-slate-600">
                                      {student.year}-{student.semester}
                                    </span>
                                  )}
                                </div>
                              </td>

                              <td className="px-2.5 py-1.5 text-center font-semibold text-slate-600">
                                {student.totalSlots}
                              </td>

                              <td className="px-2.5 py-1.5 text-center font-bold text-emerald-700">
                                {student.presentCount}
                              </td>

                              <td className="px-2.5 py-1.5 text-center font-bold text-rose-700">
                                {student.absentCount}
                              </td>

                              <td className="px-2.5 py-1.5 text-center text-slate-500 font-medium">
                                {student.odCount} OD • {student.leaveCount} L
                              </td>

                              <td className="px-2.5 py-1.5 text-center">
                                <div className="flex items-center justify-center gap-1.5">
                                  <div className="w-14 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                                    <div
                                      className={cn(
                                        "h-full rounded-full transition-all",
                                        student.percentage >= 75
                                          ? "bg-emerald-600"
                                          : student.percentage >= 65
                                            ? "bg-amber-500"
                                            : "bg-rose-600",
                                      )}
                                      style={{ width: `${Math.min(100, student.percentage)}%` }}
                                    />
                                  </div>
                                  <span className="font-bold text-xs min-w-[32px] text-right">
                                    {student.percentage}%
                                  </span>
                                </div>
                              </td>

                              <td className="px-2.5 py-1.5 text-center">
                                {student.percentage >= 75 ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                    Safe
                                  </span>
                                ) : student.percentage >= 65 ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                                    Warning
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                                    Critical
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* TAB 3: SEMESTER WISE ATTENDANCE                           */}
          {/* ======================================================== */}
          {activeTab === "semester" && semesterData && (
            <div className="space-y-3">
              {/* Semester Table */}
              <div className="rounded-lg border border-slate-200 bg-white shadow-2xs overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-100/90 text-slate-700 font-semibold text-[11px] uppercase tracking-wider">
                        <th className="px-2.5 py-2.5 w-10 text-center">#</th>
                        <th className="px-2.5 py-2.5 w-48">Photo & PIN Number</th>
                        <th className="px-2.5 py-2.5 min-w-[170px]">Student Name</th>
                        <th className="px-2.5 py-2.5 text-center">Classes Conducted</th>
                        <th className="px-2.5 py-2.5 text-center text-emerald-800">Total Present</th>
                        <th className="px-2.5 py-2.5 text-center text-rose-800">Total Absent</th>
                        <th className="px-2.5 py-2.5 text-center min-w-[130px]">Semester %</th>
                        <th className="px-2.5 py-2.5 text-center min-w-[120px]">Eligibility Status</th>
                        <th className="px-2.5 py-2.5 text-center w-16">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {filteredSemesterStudents.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="px-4 py-8 text-center text-slate-400 font-medium">
                            No students found matching current filters.
                          </td>
                        </tr>
                      ) : (
                        filteredSemesterStudents.map((student, index) => {
                          const displayPin =
                            student.pinNo && student.pinNo.trim()
                              ? student.pinNo.trim()
                              : student.admissionNo;
                          const isExpanded = expandedStudentId === student.id;

                          return (
                            <Fragment key={student.id}>
                              <tr className="hover:bg-slate-50/80 transition-colors">
                                <td className="px-2.5 py-1.5 text-center text-slate-400 font-bold">
                                  {index + 1}
                                </td>

                                <td className="px-2.5 py-1.5">
                                  <div className="flex items-center gap-2">
                                    <StudentAvatar
                                      name={student.name}
                                      photo={null}
                                      studentId={student.id}
                                      hasPhoto={student.hasPhoto}
                                      size="sm"
                                    />
                                    <span className="font-bold text-navy-900 tracking-wide text-xs">
                                      {displayPin}
                                    </span>
                                  </div>
                                </td>

                                <td className="px-2.5 py-1.5 font-medium text-slate-800">
                                  <div className="truncate max-w-[200px]" title={student.name}>
                                    {student.name}
                                  </div>
                                  <div className="text-[10px] text-slate-400 truncate flex items-center gap-1.5">
                                    <span>{student.course} {student.branch ? `• ${student.branch}` : ""}</span>
                                    {student.year && student.semester && (
                                      <span className="inline-flex items-center rounded bg-slate-100 border border-slate-200 px-1 py-0.2 text-[9px] font-bold text-slate-600">
                                        {student.year}-{student.semester}
                                      </span>
                                    )}
                                  </div>
                                </td>

                                <td className="px-2.5 py-1.5 text-center font-semibold text-slate-600">
                                  {student.totalClasses}
                                </td>

                                <td className="px-2.5 py-1.5 text-center font-bold text-emerald-700">
                                  {student.presentCount}
                                </td>

                                <td className="px-2.5 py-1.5 text-center font-bold text-rose-700">
                                  {student.absentCount}
                                </td>

                                <td className="px-2.5 py-1.5 text-center">
                                  <div className="flex items-center justify-center gap-1.5">
                                    <div className="w-14 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                                      <div
                                        className={cn(
                                          "h-full rounded-full transition-all",
                                          student.percentage >= 75
                                            ? "bg-emerald-600"
                                            : student.percentage >= 65
                                              ? "bg-amber-500"
                                              : "bg-rose-600",
                                        )}
                                        style={{ width: `${Math.min(100, student.percentage)}%` }}
                                      />
                                    </div>
                                    <span className="font-bold text-xs min-w-[32px] text-right">
                                      {student.percentage}%
                                    </span>
                                  </div>
                                </td>

                                <td className="px-2.5 py-1.5 text-center">
                                  {student.eligibility === "Eligible" ? (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                      Eligible (≥75%)
                                    </span>
                                  ) : student.eligibility === "Condonation Required" ? (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                                      Condonation
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                                      Detained (&lt;65%)
                                    </span>
                                  )}
                                </td>

                                <td className="px-2.5 py-1.5 text-center">
                                  {student.subjectBreakdown.length > 0 ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setExpandedStudentId(isExpanded ? null : student.id)
                                      }
                                      className="rounded p-0.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                                      title="View Subject Breakdown"
                                    >
                                      {isExpanded ? (
                                        <ChevronUp className="h-3.5 w-3.5" />
                                      ) : (
                                        <ChevronDown className="h-3.5 w-3.5" />
                                      )}
                                    </button>
                                  ) : (
                                    <span className="text-slate-300 text-xs">—</span>
                                  )}
                                </td>
                              </tr>

                              {/* Expandable Subject Breakdown Row */}
                              {isExpanded && (
                                <tr className="bg-slate-50/70 border-y border-slate-200">
                                  <td colSpan={9} className="px-6 py-2.5">
                                    <div className="text-xs font-semibold text-navy-900 mb-1.5">
                                      Subject Breakdown:
                                    </div>
                                    <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
                                      {student.subjectBreakdown.map((sub) => (
                                        <div
                                          key={sub.subjectCode}
                                          className="rounded border border-slate-200 bg-white p-2 flex items-center justify-between"
                                        >
                                          <div>
                                            <div className="font-bold text-slate-800 text-xs">
                                              {sub.subjectCode}
                                            </div>
                                            <div
                                              className="text-[10px] text-slate-500 truncate max-w-[130px]"
                                              title={sub.subjectName}
                                            >
                                              {sub.subjectName}
                                            </div>
                                          </div>
                                          <div className="text-right">
                                            <span
                                              className={cn(
                                                "font-bold text-xs",
                                                sub.percentage >= 75
                                                  ? "text-emerald-700"
                                                  : sub.percentage >= 65
                                                    ? "text-amber-700"
                                                    : "text-rose-700",
                                              )}
                                            >
                                              {sub.percentage}%
                                            </span>
                                            <div className="text-[10px] text-slate-400">
                                              {sub.present}/{sub.total}
                                            </div>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* TAB 4: OVERVIEW / INSIGHTS                                */}
          {/* ======================================================== */}
          {activeTab === "overview" && overviewData && (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-4">
                <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-2xs">
                  <div className="text-slate-500 text-[11px] font-medium">Overall Attendance</div>
                  <div className="text-xl font-bold text-navy-900 mt-1">{overviewData.overallAttendance}%</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-2xs">
                  <div className="text-slate-500 text-[11px] font-medium">Below Threshold</div>
                  <div className="text-xl font-bold text-rose-700 mt-1">{overviewData.studentsBelowThreshold}</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-2xs">
                  <div className="text-slate-500 text-[11px] font-medium">Pending Posts Today</div>
                  <div className="text-xl font-bold text-amber-700 mt-1">{overviewData.today?.pending ?? 0}</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-2xs">
                  <div className="text-slate-500 text-[11px] font-medium">Completed Posts Today</div>
                  <div className="text-xl font-bold text-emerald-700 mt-1">{overviewData.today?.posted ?? 0}</div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Card className="p-3.5">
                  <h3 className="mb-2 text-xs font-semibold text-navy-900 uppercase tracking-wider">
                    Attendance Distribution Bands
                  </h3>
                  {overviewData.bands.length === 0 ? (
                    <p className="text-xs text-slate-400">No posted class-session attendance yet.</p>
                  ) : (
                    <div className="space-y-2 text-xs">
                      {overviewData.bands.map((band) => (
                        <div key={band.label}>
                          <div className="mb-1 flex justify-between text-[11px]">
                            <span className="font-medium text-slate-700">{band.label}</span>
                            <span className="font-bold text-slate-900">{band.total.toLocaleString()}</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-navy-800 transition-all"
                              style={{
                                width: `${Math.min(
                                  100,
                                  (band.total /
                                    Math.max(
                                      1,
                                      overviewData.bands.reduce((s, b) => s + b.total, 0),
                                    )) *
                                    100,
                                )}%`,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                <Card className="p-3.5">
                  <h3 className="mb-2 text-xs font-semibold text-navy-900 uppercase tracking-wider">
                    Section Snapshot
                  </h3>
                  {overviewData.sections.length === 0 ? (
                    <p className="text-xs text-slate-400">No section posts in the last 90 days.</p>
                  ) : (
                    <ul className="space-y-1.5 text-xs text-slate-700">
                      {overviewData.sections.map((row) => (
                        <li
                          key={row.section}
                          className="flex justify-between items-center py-1 border-b border-slate-100 last:border-b-0"
                        >
                          <span className="font-medium text-slate-800">Section {row.section}</span>
                          <span
                            className={cn(
                              "font-bold text-[11px] px-2 py-0.2 rounded",
                              row.attendance >= 75
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-rose-100 text-rose-800",
                            )}
                          >
                            {row.attendance}%
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
