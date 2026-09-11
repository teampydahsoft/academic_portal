"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import { useAcademicContext } from "@/components/layout/AcademicProvider";
import { useAuth } from "@/components/auth/AuthProvider";
import { apiFetch } from "@/lib/api";
import { isTeachingStaffOnly, isSuperAdminUser } from "@/lib/teaching-scope";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export type CommandCenterSummary = {
  activeStudents: number;
  sectionCount: number;
  timetablesPublished: { published: number; total: number };
  facultyCount: number;
  facultyExceptions: number;
  attendancePendingToday: number;
  averageAttendance: number;
  studentsBelowThreshold: number;
  openRiskCases: number;
  examReadiness: string;
  activeExams: number;
  classesToday: { scheduled: number; posted: number; pending: number };
  source?: {
    students: string;
    staff: string;
    exams: string;
    timetables: string;
  };
};

import type { AttendanceSessionCard } from "@/features/attendance-posting/AttendanceTodayView";
import type { WorkloadSummary } from "@/features/workload/StaffWorkloadView";
import { RequestDashboardCard } from "@/features/requests/RequestDashboardCard";
import { getTodayDayCode } from "@/features/my-timetable/utils";

function todayIso() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

type PendingItem = {
  id: string;
  priority: "Critical" | "High" | "Medium";
  issue: string;
  module: string;
  owner: string;
  href: string;
  status: string;
  meta?: string;
};

type AttendanceAnalytics = {
  overallAttendance: number;
  studentsBelowThreshold: number;
  bands: Array<{ label: string; total: number }>;
  sections: Array<{ section: string; attendance: number }>;
  today: { scheduled: number; posted: number; pending: number };
};

import {
  Users,
  UserCheck,
  GraduationCap,
  Search,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  BookOpen,
  Filter,
  Sparkles,
} from "lucide-react";

export function DashboardView() {
  const { user, authorization, hasAnyPermission, hasPermission } = useAuth();
  const { filters } = useAcademicContext();
  const teachingStaffOnly = isTeachingStaffOnly(authorization);
  const superAdminUser = isSuperAdminUser(authorization);

  const canDashboard = hasAnyPermission("dashboard.view") && !teachingStaffOnly;
  const canAttendance = hasAnyPermission("attendance.view", "attendance.post");
  const canAttendanceAnalytics =
    hasAnyPermission("attendance_analytics.view") && !teachingStaffOnly;
  const canWorkload = hasAnyPermission("workload.view") && !teachingStaffOnly;
  const canExams = hasAnyPermission("examinations.view");
  const canStudents = hasAnyPermission("students.view");
  const canFaculty = hasAnyPermission("faculty.view");
  const canTimetable = hasAnyPermission("timetable.view");
  const canRequests = hasAnyPermission("request.view");
  const canRequestCreate = hasPermission("request.create");
  const canRequestApprove = hasPermission("request.approve");

  const [summary, setSummary] = useState<CommandCenterSummary | null>(null);
  const [attendance, setAttendance] = useState<AttendanceAnalytics | null>(null);
  const [workloadData, setWorkloadData] = useState<WorkloadSummary | null>(null);
  const [todaySessions, setTodaySessions] = useState<AttendanceSessionCard[]>([]);
  const [facultySearch, setFacultySearch] = useState("");
  const [selectedDept, setSelectedDept] = useState("all");
  const [expandedFacultyId, setExpandedFacultyId] = useState<string | null>(null);

  const [myTimetableSummary, setMyTimetableSummary] = useState<{
    periodsThisWeek: number;
    subjects: number;
    sections: number;
    classesToday: number;
  } | null>(null);
  const [myClassesToday, setMyClassesToday] = useState<{
    scheduled: number;
    posted: number;
    pending: number;
  } | null>(null);
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const scopeParams = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.collegeId !== "all") params.set("collegeId", String(filters.collegeId));
    if (filters.courseId !== "all") params.set("courseId", String(filters.courseId));
    if (filters.branchId !== "all") params.set("branchId", String(filters.branchId));
    if (filters.batch !== "all") params.set("batch", String(filters.batch));
    if (filters.year !== "all") params.set("year", String(filters.year));
    if (filters.semester !== "all") params.set("semester", String(filters.semester));
    if (filters.section !== "all") params.set("section", String(filters.section));
    if (filters.academicYear) params.set("academicYear", filters.academicYear);
    return params;
  }, [filters]);

  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      setLoading(true);
      setError(null);
      const nextPending: PendingItem[] = [];

      try {
        const qs = scopeParams.toString();
        const reqs: Promise<void>[] = [];

        if (canDashboard) {
          reqs.push(
            apiFetch(`/command-center/summary${qs ? `?${qs}` : ""}`)
              .then((res) => (res.ok ? res.json() : null))
              .then((data: CommandCenterSummary | null) => {
                if (cancelled || !data) return;
                setSummary(data);

                const published = data.timetablesPublished?.published ?? 0;
                const total = data.timetablesPublished?.total ?? 0;
                const unpublished = Math.max(0, total - published);
                if (unpublished > 0 && canTimetable) {
                  nextPending.push({
                    id: "timetable-coverage",
                    priority: unpublished >= 3 ? "High" : "Medium",
                    issue: `${unpublished} section timetable(s) not published`,
                    module: "Timetables",
                    owner: "Academic Admin",
                    href: "/timetables",
                    status: "Pending",
                    meta: `${published}/${total} published`,
                  });
                }
              })
              .catch(() => {})
          );
        }

        if (canAttendanceAnalytics) {
          reqs.push(
            apiFetch(`/attendance/analytics${qs ? `?${qs}` : ""}`)
              .then((res) => (res.ok ? res.json() : null))
              .then((data: AttendanceAnalytics | null) => {
                if (cancelled || !data) return;
                setAttendance(data);
              })
              .catch(() => {})
          );
        }

        if (canAttendance) {
          const attParams = new URLSearchParams(scopeParams);
          attParams.set("date", todayIso());
          reqs.push(
            apiFetch(`/attendance/sessions?${attParams}`)
              .then((res) => (res.ok ? res.json() : null))
              .then((data: { data?: AttendanceSessionCard[]; scheduled?: number; posted?: number } | null) => {
                if (cancelled || !data?.data) return;
                setTodaySessions(data.data);
                const sessions = data.data.filter(
                  (s) => !s.posted && s.sessionStatus !== "cancelled"
                );
                if (teachingStaffOnly) {
                  const scheduled = data.scheduled ?? data.data.length;
                  const posted =
                    data.posted ??
                    data.data.filter((s) => s.posted).length;
                  setMyClassesToday({
                    scheduled,
                    posted,
                    pending: Math.max(0, scheduled - posted),
                  });
                }
                for (const session of sessions) {
                  const subject = session.subjectCode || session.subjectName || "Class session";
                  nextPending.push({
                    id: `att-${session.id}`,
                    priority: "Critical",
                    issue: `Attendance not posted: ${subject}`,
                    module: "Attendance",
                    owner: session.facultyName || "Faculty",
                    href: `/attendance-posting/${session.id}`,
                    status: "Pending",
                    meta: session.slotLabel ?? undefined,
                  });
                }
              })
              .catch(() => {})
          );
        }

        if (teachingStaffOnly && hasAnyPermission("my_timetable.view")) {
          reqs.push(
            apiFetch(`/my-timetable${qs ? `?${qs}` : ""}`)
              .then((res) => (res.ok ? res.json() : null))
              .then(
                (data: {
                  summary?: {
                    periodsThisWeek: number;
                    subjects: number;
                    sections: number;
                  } | null;
                  weekDays?: Array<{ classCount: number; dayOfWeek: string }>;
                } | null) => {
                  if (cancelled || !data?.summary) return;
                  const todayCode = getTodayDayCode();
                  const classesToday =
                    todayCode === "SUN"
                      ? 0
                      : data.weekDays?.find((day) => day.dayOfWeek === todayCode)?.classCount ?? 0;
                  setMyTimetableSummary({
                    periodsThisWeek: data.summary.periodsThisWeek,
                    subjects: data.summary.subjects,
                    sections: data.summary.sections,
                    classesToday,
                  });
                },
              )
              .catch(() => {})
          );
        }

        if (canWorkload || canDashboard) {
          reqs.push(
            apiFetch(`/workload/summary${qs ? `?${qs}` : ""}`)
              .then((res) => (res.ok ? res.json() : null))
              .then((data: WorkloadSummary | null) => {
                if (cancelled || !data) return;
                setWorkloadData(data);
                const list = (data.faculty ?? []).filter((f) => f.status === "Overloaded");
                for (const faculty of list.slice(0, 10)) {
                  nextPending.push({
                    id: `wl-${faculty.id}`,
                    priority: "High",
                    issue: `Faculty overloaded: ${faculty.name}`,
                    module: "Workload",
                    owner: faculty.department || "HOD",
                    href: `/staff-workload/${encodeURIComponent(faculty.id)}`,
                    status: "Warning",
                    meta: `${faculty.periodsPerWeek} periods/wk`,
                  });
                }
              })
              .catch(() => {})
          );
        }

        await Promise.allSettled(reqs);

        if (!cancelled) {
          nextPending.sort((a, b) => {
            const ranks = { Critical: 0, High: 1, Medium: 2 };
            return ranks[a.priority] - ranks[b.priority];
          });
          setPendingItems(nextPending);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError("Unable to load dashboard data");
          setLoading(false);
        }
      }
    }
    void loadData();
    return () => {
      cancelled = true;
    };
  }, [canDashboard, canAttendance, canAttendanceAnalytics, canWorkload, canTimetable, scopeParams, teachingStaffOnly, hasAnyPermission]);

  const filteredFacultyList = useMemo(() => {
    if (!workloadData?.faculty) return [];
    return workloadData.faculty.filter((f) => {
      if (selectedDept !== "all" && f.department !== selectedDept) return false;
      if (facultySearch.trim()) {
        const q = facultySearch.toLowerCase();
        return (
          f.name.toLowerCase().includes(q) ||
          f.code.toLowerCase().includes(q) ||
          f.department.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [workloadData, selectedDept, facultySearch]);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good Morning";
    if (hour < 18) return "Good Afternoon";
    return "Good Evening";
  }, []);

  const subtitle = useMemo(() => {
    if (!authorization?.roles?.length) return "Here's what's happening in your organization today.";
    
    const roleLabels = authorization.roles.map((r) => r.label.toLowerCase());
    if (roleLabels.some((r) => r.includes("hod") || r.includes("head"))) {
      return "Here's what's happening in your branch today.";
    }
    if (roleLabels.some((r) => r.includes("principal") || r.includes("director"))) {
      return "Here's what's happening in your college today.";
    }
    if (roleLabels.some((r) => r.includes("staff") || r.includes("faculty"))) {
      return "Here's what's happening in your classes today.";
    }
    
    return "Here's what's happening in your organization today.";
  }, [authorization]);

  if (loading && !summary && !attendance && !myTimetableSummary) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-slate-500">
        Loading dashboard...
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      {/* SECTION A — HEADER */}
      <div>
        <h1 className="text-2xl font-bold text-navy-900 tracking-tight">
          {greeting}, {user?.name || "User"} 👋
        </h1>
        <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
        {error ? (
          <p className="mt-2 text-sm text-red-600">{error}</p>
        ) : null}
      </div>

      {/* SECTION C — KPI SUMMARY CARDS */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {teachingStaffOnly ? (
          <>
            {hasAnyPermission("my_timetable.view") ? (
              <>
                <StatCard
                  label="Classes Today"
                  value={myTimetableSummary?.classesToday ?? myClassesToday?.scheduled ?? "—"}
                  hint="From your published timetable"
                  tone="info"
                />
                <StatCard
                  label="Periods This Week"
                  value={myTimetableSummary?.periodsThisWeek ?? "—"}
                  hint="Assigned teaching load"
                  tone="info"
                />
                <StatCard
                  label="Subjects"
                  value={myTimetableSummary?.subjects ?? "—"}
                  hint="Assigned subjects"
                  tone="info"
                />
                <StatCard
                  label="Sections"
                  value={myTimetableSummary?.sections ?? "—"}
                  hint="Assigned sections"
                  tone="info"
                />
              </>
            ) : null}
            {canAttendance ? (
              <>
                <StatCard
                  label="Today's Sessions"
                  value={myClassesToday?.scheduled ?? "—"}
                  hint="Your assigned classes"
                />
                <StatCard
                  label="Posted"
                  value={myClassesToday?.posted ?? "—"}
                  tone="success"
                  hint="Attendance taken"
                />
                <StatCard
                  label="Pending"
                  value={myClassesToday?.pending ?? "—"}
                  tone="warning"
                  hint="Awaiting submission"
                />
              </>
            ) : null}
          </>
        ) : (
          <>
        {canStudents ? (
          <StatCard
            label="Active Students"
            value={summary?.activeStudents.toLocaleString() || "—"}
            hint="Enrolled in active programs"
            tone="info"
          />
        ) : null}
        {canFaculty ? (
          <StatCard
            label="Total Faculty"
            value={summary?.facultyCount.toLocaleString() || "—"}
            hint="Active HRMS records"
            tone="info"
          />
        ) : null}
        {canAttendance ? (
          <StatCard
            label="Average Attendance"
            value={attendance ? `${attendance.overallAttendance}%` : summary ? `${summary.averageAttendance}%` : "—"}
            hint="Last 90 days"
            tone={
              (attendance?.overallAttendance || summary?.averageAttendance || 0) >= 75
                ? "success"
                : "critical"
            }
          />
        ) : null}
        {canTimetable ? (
          <StatCard
            label="Active Sections"
            value={summary?.sectionCount.toLocaleString() || "—"}
            hint="Configured curriculum branches"
            tone="info"
          />
        ) : null}
          </>
        )}
      </div>

      {/* DYNAMIC ROLE-BASED ANALYTICS PANELS */}

      {/* SUPERADMIN & ADMIN: FACULTY & CLASS ATTENDANCE OVERSIGHT TABLE */}
      {!teachingStaffOnly && (canFaculty || canWorkload || superAdminUser) ? (
        <Card>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4 pb-3 border-b border-border">
            <div>
              <h2 className="text-base font-bold text-navy-900 flex items-center gap-2">
                <Users className="h-5 w-5 text-brand-600" />
                Faculty Class & Student Attendance Analytics
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Complete overview of faculty members, assigned class loads, session posting status, and student attendance rates.
              </p>
            </div>

            {/* Filter & Search Controls */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search faculty or dept..."
                  value={facultySearch}
                  onChange={(e) => setFacultySearch(e.target.value)}
                  className="h-8.5 w-44 sm:w-52 rounded-md border border-border bg-white pl-8 pr-3 text-xs outline-none focus:border-brand-600"
                />
              </div>
              {workloadData?.filterOptions?.departments?.length ? (
                <select
                  value={selectedDept}
                  onChange={(e) => setSelectedDept(e.target.value)}
                  className="h-8.5 rounded-md border border-border bg-white px-2.5 text-xs outline-none focus:border-brand-600"
                >
                  <option value="all">All Departments</option>
                  {workloadData.filterOptions.departments.map((dept) => (
                    <option key={dept} value={dept}>
                      {dept}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          </div>

          {filteredFacultyList.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-500">
              No faculty records found matching the current criteria.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 border-b border-border">
                    <th className="px-3 py-2.5">Faculty Member</th>
                    <th className="px-3 py-2.5">Department</th>
                    <th className="px-3 py-2.5">Assigned Class Load</th>
                    <th className="px-3 py-2.5 text-center">Today's Sessions</th>
                    <th className="px-3 py-2.5 text-center">Student Attendance</th>
                    <th className="px-3 py-2.5 text-right">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredFacultyList.slice(0, 10).map((f) => {
                    const fSessions = todaySessions.filter(
                      (s) => s.facultyName === f.name
                    );
                    const schedCount = fSessions.length;
                    const postedCount = fSessions.filter((s) => s.posted).length;
                    const isExpanded = expandedFacultyId === f.id;

                    const totalPresent = fSessions.reduce((sum, s) => sum + (s.presentCount ?? 0), 0);
                    const totalAbsent = fSessions.reduce((sum, s) => sum + (s.absentCount ?? 0), 0);
                    const totalEnrolled = totalPresent + totalAbsent;
                    const attendanceRate = totalEnrolled > 0 ? Math.round((totalPresent / totalEnrolled) * 100) : null;
                    const subjectsCount = (f as { subjects?: number }).subjects ?? 1;
                    const sectionsCount = (f as { sections?: number }).sections ?? 1;

                    return (
                      <Fragment key={f.id}>
                        <tr className="hover:bg-slate-50/70 transition-colors">
                          <td className="px-3 py-2.5 font-medium text-navy-900">
                            <div className="flex items-center gap-2">
                              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700 text-xs font-semibold">
                                {f.name.charAt(0)}
                              </div>
                              <div>
                                <p className="font-semibold text-slate-800">{f.name}</p>
                                <p className="text-[10px] text-slate-400 font-mono">{f.code || f.division}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-slate-600">{f.department}</td>
                          <td className="px-3 py-2.5 text-slate-600">
                            <span className="font-semibold text-navy-900">{f.periodsPerWeek}</span> periods/wk
                            <span className="text-[10px] text-slate-400 block">({subjectsCount} subjects · {sectionsCount} sections)</span>
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            {schedCount > 0 ? (
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${postedCount === schedCount ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                                {postedCount} / {schedCount} Posted
                              </span>
                            ) : (
                              <span className="text-slate-400 text-[10px]">No sessions today</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            {attendanceRate !== null ? (
                              <div className="inline-flex items-center gap-1.5">
                                <div className="w-16 bg-slate-200 h-2 rounded-full overflow-hidden">
                                  <div className={`h-full ${attendanceRate >= 75 ? "bg-emerald-500" : "bg-amber-500"}`} style={{ width: `${attendanceRate}%` }} />
                                </div>
                                <span className="font-bold text-slate-700">{attendanceRate}%</span>
                              </div>
                            ) : (
                              <span className="text-slate-400 text-[10px]">No data</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs"
                              onClick={() => setExpandedFacultyId(isExpanded ? null : f.id)}
                            >
                              {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                              Classes
                            </Button>
                          </td>
                        </tr>

                        {/* Expandable Class Sessions Details */}
                        {isExpanded && (
                          <tr className="bg-slate-50/90">
                            <td colSpan={6} className="px-4 py-3">
                              <div className="rounded-lg border border-border bg-white p-3 space-y-2">
                                <h4 className="text-xs font-semibold text-navy-900 uppercase tracking-wider flex items-center gap-1.5">
                                  <BookOpen className="h-3.5 w-3.5 text-brand-600" />
                                  Classes Assigned & Sessions Today for {f.name}
                                </h4>
                                {fSessions.length === 0 ? (
                                  <p className="text-xs text-slate-500 italic">No class sessions scheduled today for this faculty in the published timetable.</p>
                                ) : (
                                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                    {fSessions.map((s) => (
                                      <div key={s.id} className="rounded-md border border-border p-2.5 bg-slate-50/50 text-xs">
                                        <div className="flex justify-between items-start mb-1">
                                          <span className="font-bold text-navy-900">{s.subjectName || s.subjectCode}</span>
                                          <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${s.posted ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                                            {s.posted ? "Posted" : "Pending"}
                                          </span>
                                        </div>
                                        <p className="text-[11px] text-slate-500 mb-1">{s.section || "Section"} · {s.slotLabel || s.startTime}</p>
                                        {s.posted ? (
                                          <div className="flex justify-between items-center text-[11px] text-slate-600 pt-1 border-t border-border/50">
                                            <span>Present: <strong>{s.presentCount ?? 0}</strong></span>
                                            <span>Absent: <strong>{s.absentCount ?? 0}</strong></span>
                                          </div>
                                        ) : (
                                          <p className="text-[10px] text-amber-700 pt-1 border-t border-border/50">Attendance pending submission</p>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {/* FACULTY PERSONAL CLASS & STUDENT ATTENDANCE OVERVIEW */}
      {teachingStaffOnly && (
        <Card>
          <div className="mb-4 pb-3 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-navy-900 flex items-center gap-2">
                <GraduationCap className="h-5 w-5 text-brand-600" />
                My Assigned Classes & Student Attendance
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                View all class sections assigned to you, required student counts, and today's attendance performance.
              </p>
            </div>
            <Link href="/attendance-posting">
              <Button size="sm" variant="secondary">
                Post Attendance
              </Button>
            </Link>
          </div>

          {todaySessions.length === 0 ? (
            <div className="py-6 text-center text-sm text-slate-500">
              No class sessions scheduled for you today. View your full timetable under My Timetable.
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {todaySessions.map((session) => {
                const present = session.presentCount ?? 0;
                const absent = session.absentCount ?? 0;
                const totalEnrolled = present + absent;
                const pct = totalEnrolled > 0 ? Math.round((present / totalEnrolled) * 100) : null;

                return (
                  <div key={session.id} className="rounded-xl border border-border bg-white p-4 shadow-sm space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-bold text-navy-900 text-sm">{session.subjectName || session.subjectCode}</h3>
                        <p className="text-xs text-slate-500">{session.section || "Class Section"} · Room {session.roomLabel || "N/A"}</p>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${session.posted ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                        {session.posted ? "Posted" : "Pending"}
                      </span>
                    </div>

                    <div className="rounded-lg bg-slate-50 p-2.5 space-y-1.5 border border-slate-100 text-xs">
                      <div className="flex justify-between items-center text-slate-600">
                        <span>Slot & Time:</span>
                        <span className="font-semibold text-slate-800">{session.slotLabel || `${session.startTime} - ${session.endTime}`}</span>
                      </div>
                      <div className="flex justify-between items-center text-slate-600">
                        <span>Students Required:</span>
                        <span className="font-bold text-navy-900">{totalEnrolled > 0 ? `${totalEnrolled} Students` : "Enrolled Class"}</span>
                      </div>
                      {session.posted && (
                        <>
                          <div className="flex justify-between items-center text-slate-600">
                            <span>Attended Class:</span>
                            <span className="font-bold text-emerald-700">{present} Present ({pct}%)</span>
                          </div>
                          <div className="flex justify-between items-center text-slate-600">
                            <span>Absent Students:</span>
                            <span className="font-bold text-rose-600">{absent} Absent</span>
                          </div>
                        </>
                      )}
                    </div>

                    <div className="flex justify-end pt-1">
                      <Link href={`/attendance-posting/${session.id}`} className="w-full">
                        <Button size="sm" variant={session.posted ? "secondary" : "primary"} className="w-full text-xs">
                          {session.posted ? "Edit Attendance" : "Take Attendance"}
                        </Button>
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        {/* LEFT COLUMN: Operations & Health */}
        <div className="xl:col-span-2 space-y-6">
          
          {/* SECTION D — ATTENDANCE HEALTH */}
          {canAttendance && !teachingStaffOnly ? (
            <Card>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-base font-semibold text-navy-900">Attendance Health</h2>
                <Link href="/attendance-analytics">
                  <Button variant="secondary" size="sm">View Analytics</Button>
                </Link>
              </div>
              <div className="grid gap-4 sm:grid-cols-3 mb-6">
                <StatCard
                  label="Today's Sessions"
                  value={attendance?.today.scheduled || summary?.classesToday.scheduled || 0}
                  hint="Scheduled classes"
                />
                <StatCard
                  label="Posted"
                  value={attendance?.today.posted || summary?.classesToday.posted || 0}
                  tone="success"
                  hint="Attendance taken"
                />
                <StatCard
                  label="Pending"
                  value={attendance?.today.pending || summary?.classesToday.pending || 0}
                  tone="warning"
                  hint="Awaiting submission"
                />
              </div>

              {attendance?.bands && attendance.bands.length > 0 && (
                <div>
                  <h3 className="mb-4 text-sm font-medium text-slate-700">Attendance Distribution (Last 90 days)</h3>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={attendance.bands} layout="vertical" margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                        <XAxis type="number" hide />
                        <YAxis dataKey="label" type="category" width={80} tick={{ fontSize: 12 }} />
                        <Tooltip cursor={{ fill: 'transparent' }} contentStyle={{ borderRadius: '6px' }} />
                        <Bar 
                          dataKey="total" 
                          fill="#0FAF83" 
                          radius={[0, 4, 4, 0]}
                          barSize={24}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </Card>
          ) : null}

          {canAttendance && teachingStaffOnly ? (
            <Card>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-base font-semibold text-navy-900">My Attendance Today</h2>
                <Link href="/attendance-posting">
                  <Button variant="secondary" size="sm">Post Attendance</Button>
                </Link>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <StatCard
                  label="Today's Sessions"
                  value={myClassesToday?.scheduled ?? 0}
                  hint="Your assigned classes"
                />
                <StatCard
                  label="Posted"
                  value={myClassesToday?.posted ?? 0}
                  tone="success"
                  hint="Attendance taken"
                />
                <StatCard
                  label="Pending"
                  value={myClassesToday?.pending ?? 0}
                  tone="warning"
                  hint="Awaiting submission"
                />
              </div>
            </Card>
          ) : null}

          {/* SECTION E & F — ACADEMIC OPERATIONS & EXAMS */}
          <div className="grid gap-6 sm:grid-cols-2">
            {canTimetable && !teachingStaffOnly ? (
              <Card>
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-base font-semibold text-navy-900">Academic Operations</h2>
                  <Link href="/timetables">
                    <Button variant="secondary" size="sm">Timetables</Button>
                  </Link>
                </div>
                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-slate-500 mb-1">Published Timetables</p>
                    <p className="text-2xl font-semibold text-navy-900">
                      {summary?.timetablesPublished.published || 0} <span className="text-lg text-slate-400 font-normal">/ {summary?.timetablesPublished.total || 0}</span>
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500 mb-1">Today&apos;s Classes Remaining</p>
                    <p className="text-2xl font-semibold text-warning">
                      {summary?.classesToday.pending || 0}
                    </p>
                  </div>
                </div>
              </Card>
            ) : null}

            {hasAnyPermission("my_timetable.view") && teachingStaffOnly ? (
              <Card>
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-base font-semibold text-navy-900">My Timetable</h2>
                  <Link href="/my-timetable">
                    <Button variant="secondary" size="sm">View Timetable</Button>
                  </Link>
                </div>
                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-slate-500 mb-1">Periods This Week</p>
                    <p className="text-2xl font-semibold text-navy-900">
                      {myTimetableSummary?.periodsThisWeek ?? "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500 mb-1">Classes Today</p>
                    <p className="text-2xl font-semibold text-navy-900">
                      {myTimetableSummary?.classesToday ?? "—"}
                    </p>
                  </div>
                </div>
              </Card>
            ) : null}

            {canExams && !teachingStaffOnly ? (
              <Card>
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-base font-semibold text-navy-900">Examinations</h2>
                  <Link href="/examinations">
                    <Button variant="secondary" size="sm">View Exams</Button>
                  </Link>
                </div>
                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-slate-500 mb-1">Active Exams</p>
                    <p className="text-2xl font-semibold text-navy-900">{summary?.activeExams || 0}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500 mb-1">Status</p>
                    <p className="text-sm font-medium text-slate-700">{summary?.examReadiness || "No active exams"}</p>
                  </div>
                </div>
              </Card>
            ) : null}
          </div>

        </div>

        {/* RIGHT COLUMN: Attention & Quick Actions */}
        <div className="space-y-6">
          {canRequests ? (
            <RequestDashboardCard
              canView={canRequests}
              canCreate={canRequestCreate}
              canApprove={canRequestApprove}
              superAdminUser={superAdminUser}
            />
          ) : null}

          {/* SECTION I — REQUIRES YOUR ATTENTION */}
          <Card className="border-l-4 border-l-amber-500">
            <h2 className="mb-4 text-base font-semibold text-navy-900 flex items-center gap-2">
              Requires Your Attention
              {pendingItems.length > 0 && (
                <span className="bg-amber-100 text-amber-800 text-xs font-bold px-2 py-0.5 rounded-full">
                  {pendingItems.length}
                </span>
              )}
            </h2>
            
            {pendingItems.length === 0 ? (
              <div className="py-6 text-center text-sm text-slate-500">
                You&apos;re all caught up!
              </div>
            ) : (
              <ul className="space-y-3">
                {pendingItems.slice(0, 5).map((item) => (
                  <li key={item.id} className="rounded-md border border-border p-3 bg-white">
                    <div className="flex justify-between items-start mb-1">
                      <StatusBadge status={item.priority} />
                      <span className="text-xs text-slate-400">{item.module}</span>
                    </div>
                    <p className="text-sm font-medium text-navy-900 leading-tight mb-2">
                      {item.issue}
                    </p>
                    <div className="flex justify-between items-center mt-2">
                      <span className="text-xs text-slate-500">{item.meta || item.owner}</span>
                      <Link href={item.href}>
                        <Button size="sm" variant="secondary" className="h-7 text-xs">
                          Action
                        </Button>
                      </Link>
                    </div>
                  </li>
                ))}
                {pendingItems.length > 5 && (
                  <div className="pt-2 text-center">
                    <Link href="/pending-exceptions" className="text-sm text-brand-600 hover:underline font-medium">
                      View all {pendingItems.length} items
                    </Link>
                  </div>
                )}
              </ul>
            )}
          </Card>

          {/* SECTION G & H — STUDENT & STAFF RISKS */}
          {(canStudents || canWorkload) && !teachingStaffOnly && (
            <Card>
              <h2 className="mb-4 text-base font-semibold text-navy-900">Health & Risk Indicators</h2>
              <div className="space-y-4">
                {canStudents && (
                  <div className="flex items-center justify-between p-3 bg-slate-50 rounded-md border border-slate-100">
                    <div>
                      <p className="text-sm font-medium text-navy-900">Attendance Risk</p>
                      <p className="text-xs text-slate-500">Below 75% threshold</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-lg font-bold ${(summary?.studentsBelowThreshold || 0) > 0 ? "text-critical" : "text-slate-700"}`}>
                        {summary?.studentsBelowThreshold || 0}
                      </p>
                    </div>
                  </div>
                )}
                {canStudents && hasPermission("students.view") && (
                  <div className="flex items-center justify-between p-3 bg-slate-50 rounded-md border border-slate-100">
                    <div>
                      <p className="text-sm font-medium text-navy-900">Open Risk Cases</p>
                      <p className="text-xs text-slate-500">Mentoring required</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-warning">
                        {summary?.openRiskCases || 0}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* SECTION J — QUICK ACTIONS */}
          <Card>
            <h2 className="mb-4 text-base font-semibold text-navy-900">Quick Actions</h2>
            <div className="grid grid-cols-2 gap-2">
              {canAttendance && (
                <Link href="/attendance-posting">
                  <Button variant="secondary" className="w-full justify-start text-sm bg-slate-50 hover:bg-slate-100 border-0">
                    Post Attendance
                  </Button>
                </Link>
              )}
              {canStudents && (
                <Link href="/students">
                  <Button variant="secondary" className="w-full justify-start text-sm bg-slate-50 hover:bg-slate-100 border-0">
                    View Students
                  </Button>
                </Link>
              )}
              {hasAnyPermission("my_timetable.view") && teachingStaffOnly ? (
                <Link href="/my-timetable">
                  <Button variant="secondary" className="w-full justify-start text-sm bg-slate-50 hover:bg-slate-100 border-0">
                    My Timetable
                  </Button>
                </Link>
              ) : null}
              {canTimetable && !teachingStaffOnly ? (
                <Link href="/timetables">
                  <Button variant="secondary" className="w-full justify-start text-sm bg-slate-50 hover:bg-slate-100 border-0">
                    Manage Timetable
                  </Button>
                </Link>
              ) : null}
              {canFaculty && (
                <Link href="/faculty-departments">
                  <Button variant="secondary" className="w-full justify-start text-sm bg-slate-50 hover:bg-slate-100 border-0">
                    View Faculty
                  </Button>
                </Link>
              )}
              {canExams && (
                <Link href="/examinations">
                  <Button variant="secondary" className="w-full justify-start text-sm bg-slate-50 hover:bg-slate-100 border-0">
                    View Exams
                  </Button>
                </Link>
              )}
              {hasAnyPermission("results.view") && (
                <Link href="/results">
                  <Button variant="secondary" className="w-full justify-start text-sm bg-slate-50 hover:bg-slate-100 border-0">
                    View Results
                  </Button>
                </Link>
              )}
              {canRequests && (
                <Link href="/requests">
                  <Button variant="secondary" className="w-full justify-start text-sm bg-slate-50 hover:bg-slate-100 border-0">
                    {superAdminUser ? "All Requests" : "My Requests"}
                  </Button>
                </Link>
              )}
              {canRequestApprove && (
                <Link href="/requests/pending">
                  <Button variant="secondary" className="w-full justify-start text-sm bg-slate-50 hover:bg-slate-100 border-0">
                    Pending Requests
                  </Button>
                </Link>
              )}
              {hasAnyPermission("user_management.view") && (
                <Link href="/user-management">
                  <Button variant="secondary" className="w-full justify-start text-sm bg-slate-50 hover:bg-slate-100 border-0">
                    Manage Users
                  </Button>
                </Link>
              )}
            </div>
          </Card>

        </div>
      </div>
    </div>
  );
}
