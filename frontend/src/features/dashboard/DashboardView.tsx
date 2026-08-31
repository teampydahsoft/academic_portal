"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import { useAcademicContext } from "@/components/layout/AcademicProvider";
import { useAuth } from "@/components/auth/AuthProvider";
import { apiFetch } from "@/lib/api";
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

export function DashboardView() {
  const { user, authorization, hasAnyPermission, hasPermission } = useAuth();
  const { filters } = useAcademicContext();

  const canDashboard = hasAnyPermission("dashboard.view");
  const canAttendance = hasAnyPermission("attendance.view", "attendance.post");
  const canWorkload = hasAnyPermission("workload.view");
  const canExams = hasAnyPermission("examinations.view");
  const canStudents = hasAnyPermission("students.view");
  const canFaculty = hasAnyPermission("faculty.view");
  const canTimetable = hasAnyPermission("timetable.view");
  const canRequests = hasAnyPermission("request.view");
  const canRequestCreate = hasPermission("request.create");
  const canRequestApprove = hasPermission("request.approve");

  const [summary, setSummary] = useState<CommandCenterSummary | null>(null);
  const [attendance, setAttendance] = useState<AttendanceAnalytics | null>(null);
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

        if (canAttendance) {
          reqs.push(
            apiFetch(`/attendance/analytics${qs ? `?${qs}` : ""}`)
              .then((res) => (res.ok ? res.json() : null))
              .then((data: AttendanceAnalytics | null) => {
                if (cancelled || !data) return;
                setAttendance(data);
              })
              .catch(() => {})
          );

          const attParams = new URLSearchParams(scopeParams);
          attParams.set("date", todayIso());
          reqs.push(
            apiFetch(`/attendance/sessions?${attParams}`)
              .then((res) => (res.ok ? res.json() : null))
              .then((data: { data?: AttendanceSessionCard[] } | null) => {
                if (cancelled || !data?.data) return;
                const sessions = data.data.filter(
                  (s) => !s.posted && s.sessionStatus !== "cancelled"
                );
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

        if (canWorkload) {
          reqs.push(
            apiFetch(`/workload/summary${qs ? `?${qs}` : ""}`)
              .then((res) => (res.ok ? res.json() : null))
              .then((data: WorkloadSummary | null) => {
                if (cancelled || !data) return;
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
  }, [canDashboard, canAttendance, canWorkload, canTimetable, scopeParams]);

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
    if (roleLabels.some((r) => r.includes("faculty"))) {
      return "Here's what's happening in your classes today.";
    }
    
    return "Here's what's happening in your organization today.";
  }, [authorization]);

  if (loading && !summary && !attendance) {
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
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        {/* LEFT COLUMN: Operations & Health */}
        <div className="xl:col-span-2 space-y-6">
          
          {/* SECTION D — ATTENDANCE HEALTH */}
          {canAttendance ? (
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

          {/* SECTION E & F — ACADEMIC OPERATIONS & EXAMS */}
          <div className="grid gap-6 sm:grid-cols-2">
            {canTimetable ? (
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

            {canExams ? (
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
          {(canStudents || canWorkload) && (
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
              {canTimetable && (
                <Link href="/timetables">
                  <Button variant="secondary" className="w-full justify-start text-sm bg-slate-50 hover:bg-slate-100 border-0">
                    Manage Timetable
                  </Button>
                </Link>
              )}
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
                    My Requests
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
