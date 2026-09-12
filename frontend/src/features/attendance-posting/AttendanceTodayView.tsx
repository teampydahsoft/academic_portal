"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  Clock,
  Building2,
  BookOpen,
  Layers,
  CheckCircle2,
  AlertCircle,
  BarChart3,
  Filter,
  Search,
  ArrowRight,
  ShieldCheck,
} from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/components/auth/AuthProvider";
import { isTeachingStaffOnly, isSuperAdminUser } from "@/lib/teaching-scope";

export type AttendanceSessionCard = {
  id: number;
  date: string;
  startTime: string | null;
  endTime: string | null;
  slotLabel: string | null;
  subjectCode: string | null;
  subjectName: string | null;
  subjectTypeSnapshot?: string | null;
  section: string | null;
  collegeId?: number;
  collegeName?: string;
  courseId?: number;
  courseName?: string;
  branchId?: number;
  branchName?: string;
  facultyStaffLinkId?: number | null;
  facultyName: string | null;
  roomLabel: string | null;
  sessionStatus: string;
  posted: boolean;
  isMySession?: boolean;
  presentCount: number;
  absentCount: number;
};

export type AbstractBranch = {
  branchId: number;
  branchName: string;
  totalSessions: number;
  pending: number;
  posted: number;
  completionPct: number;
};

export type AbstractCollege = {
  collegeId: number;
  collegeName: string;
  totalSessions: number;
  pending: number;
  posted: number;
  completionPct: number;
  byBranch: AbstractBranch[];
};

export type AttendanceAbstract = {
  totalColleges: number;
  totalCourses: number;
  totalBranches: number;
  overallCompletionPct: number;
  byCollege: AbstractCollege[];
};

type ListResponse = {
  date: string;
  scheduled: number;
  posted: number;
  mySessionsCount?: number;
  currentStaffLinkId?: number | null;
  abstract?: AttendanceAbstract | null;
  data: AttendanceSessionCard[];
  generated?: { planCount: number; created: number } | null;
  source?: { sessions: string; holidays: string };
};

function todayIso() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function toIsoString(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getWeekInfo(weekOffset: number) {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday as start of week
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff + weekOffset * 7);
  monday.setHours(0, 0, 0, 0);

  const dayCodes = ["MON", "TUE", "WED", "THUR", "FRI", "SAT"];
  const fullLabels = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const today = todayIso();

  const days: Array<{
    code: string;
    fullLabel: string;
    dateIso: string;
    dayNum: number;
    monthShort: string;
    isToday: boolean;
    isFuture: boolean;
  }> = [];

  for (let i = 0; i < 6; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dateIso = toIsoString(d);
    days.push({
      code: dayCodes[i],
      fullLabel: fullLabels[i],
      dateIso,
      dayNum: d.getDate(),
      monthShort: d.toLocaleDateString("en-IN", { month: "short" }),
      isToday: dateIso === today,
      isFuture: dateIso > today,
    });
  }

  const start = days[0];
  const end = days[5];
  const rangeLabel = `${start.dayNum} ${start.monthShort} – ${end.dayNum} ${end.monthShort}, ${monday.getFullYear()}`;

  return { days, rangeLabel, mondayIso: start.dateIso };
}

export function AttendanceTodayView() {
  const { authorization } = useAuth();
  const isSuperAdmin = isSuperAdminUser(authorization);
  const teachingStaffOnly = isTeachingStaffOnly(authorization);

  const [weekOffset, setWeekOffset] = useState(0);
  const [date, setDate] = useState(todayIso);
  const [viewScope, setViewScope] = useState<"mine" | "all">("mine");
  const [hasInitializedScope, setHasInitializedScope] = useState(false);
  const [selectedBranchId, setSelectedBranchId] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "posted">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [payload, setPayload] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const weekInfo = useMemo(() => getWeekInfo(weekOffset), [weekOffset]);
  const isCurrentWeek = weekOffset === 0;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await apiFetch(`/attendance/sessions?date=${date}`, {
          cache: "no-store",
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            typeof body === "object" && body && "message" in body
              ? String((body as { message: string }).message)
              : `Failed to load class sessions (${response.status})`,
          );
        }
        if (!cancelled) setPayload(body as ListResponse);
      } catch (err) {
        if (!cancelled) {
          setPayload(null);
          setError(err instanceof Error ? err.message : "Failed to load class sessions");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [date]);

  // Automatically default to "mine" if user has personal teaching slots, or "all" if user has no assigned slots
  useEffect(() => {
    if (payload && !hasInitializedScope) {
      if (!teachingStaffOnly && payload.mySessionsCount === 0) {
        setViewScope("all");
      } else {
        setViewScope("mine");
      }
      setHasInitializedScope(true);
    }
  }, [payload, hasInitializedScope, teachingStaffOnly]);

  const handlePrevWeek = () => {
    const nextOffset = weekOffset - 1;
    setWeekOffset(nextOffset);
    const info = getWeekInfo(nextOffset);
    setDate(info.days[0].dateIso);
  };

  const handleNextWeek = () => {
    if (weekOffset >= 0) return;
    const nextOffset = weekOffset + 1;
    setWeekOffset(nextOffset);
    const info = getWeekInfo(nextOffset);
    const today = todayIso();
    const validDay = info.days.find((d) => !d.isFuture) ?? info.days[0];
    setDate(validDay.dateIso > today ? today : validDay.dateIso);
  };

  const handleToday = () => {
    setWeekOffset(0);
    setDate(todayIso());
  };

  const selectedDayInfo = useMemo(() => {
    const found = weekInfo.days.find((d) => d.dateIso === date);
    if (found) return found;
    const parsed = new Date(date);
    return {
      code: "",
      fullLabel: parsed.toLocaleDateString("en-IN", { weekday: "long" }),
      dateIso: date,
      dayNum: parsed.getDate(),
      monthShort: parsed.toLocaleDateString("en-IN", { month: "short" }),
      isToday: date === todayIso(),
      isFuture: date > todayIso(),
    };
  }, [date, weekInfo.days]);

  const allSessions = payload?.data ?? [];
  const mySessions = useMemo(() => allSessions.filter((s) => s.isMySession), [allSessions]);
  const mySessionsCount = payload?.mySessionsCount ?? mySessions.length;

  // Available branch filter options if sessions span multiple branches
  const branchOptions = useMemo(() => {
    const map = new Map<number, string>();
    const pool = !teachingStaffOnly && viewScope === "mine" ? mySessions : allSessions;
    pool.forEach((s) => {
      if (s.branchId != null) {
        map.set(s.branchId, s.branchName || `Branch ${s.branchId}`);
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [allSessions, mySessions, teachingStaffOnly, viewScope]);

  // Filter sessions by scope, branch, status, and search query
  const filteredSessions = useMemo(() => {
    return allSessions.filter((item) => {
      if (!teachingStaffOnly && viewScope === "mine" && !item.isMySession) {
        return false;
      }
      if (selectedBranchId !== "all" && String(item.branchId) !== selectedBranchId) {
        return false;
      }
      if (statusFilter === "pending" && item.posted) {
        return false;
      }
      if (statusFilter === "posted" && !item.posted) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const sub = (item.subjectName || "").toLowerCase();
        const code = (item.subjectCode || "").toLowerCase();
        const sec = (item.section || "").toLowerCase();
        const fac = (item.facultyName || "").toLowerCase();
        const room = (item.roomLabel || "").toLowerCase();
        if (!sub.includes(q) && !code.includes(q) && !sec.includes(q) && !fac.includes(q) && !room.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [allSessions, teachingStaffOnly, viewScope, selectedBranchId, statusFilter, searchQuery]);

  const displayedScopeSessions = useMemo(() => {
    if (!teachingStaffOnly && viewScope === "mine") return mySessions;
    return allSessions;
  }, [allSessions, mySessions, teachingStaffOnly, viewScope]);

  const totalPending = useMemo(() => displayedScopeSessions.filter((s) => !s.posted).length, [displayedScopeSessions]);
  const totalPosted = useMemo(() => displayedScopeSessions.filter((s) => s.posted).length, [displayedScopeSessions]);

  const abstract = payload?.abstract;

  return (
    <div className="space-y-3 sm:space-y-4">
      <PageHeader
        title="Attendance Posting"
        description={
          isSuperAdmin
            ? "Super Admin Institute-Wide Attendance Oversight and Abstract Reports."
            : teachingStaffOnly
              ? "Your assigned class time slots organized week-wise for attendance submission."
              : "Post attendance for your assigned class slots or oversee department session attendance."
        }
        actions={
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            <span>Jump to Date</span>
            <input
              type="date"
              value={date}
              max={todayIso()}
              onChange={(e) => {
                const val = e.target.value;
                if (val && val <= todayIso()) {
                  setDate(val);
                }
              }}
              className="h-8 rounded-md border border-border bg-white px-2 text-xs outline-none focus:border-navy-800"
            />
          </label>
        }
      />

      {/* SUPER ADMIN OVERSIGHT NOTICE & BANNER */}
      {isSuperAdmin ? (
        <div className="space-y-3">
          <div className="flex items-start gap-3 rounded-xl border border-navy-200 bg-navy-50/70 p-3.5 sm:p-4 text-navy-900 shadow-xs">
            <ShieldCheck className="h-5 w-5 text-navy-800 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold text-navy-900">
                Super Admin Oversight Access
              </h3>
              <p className="mt-0.5 text-xs text-slate-600 leading-relaxed">
                Attendance marking and submission is reserved for assigned teaching faculty, Heads of Department (HOD), Vice Principals, and Principals. Super administrators have institute-wide analytical oversight.
              </p>
              <div className="mt-2.5">
                <Link href="/attendance-analytics">
                  <Button size="sm" variant="primary" className="text-xs h-7 sm:h-8">
                    <span>Open Attendance Analytics</span>
                    <ArrowRight className="h-3.5 w-3.5 ml-1" />
                  </Button>
                </Link>
              </div>
            </div>
          </div>

          {/* Abstract Metrics Cards for Super Admin */}
          {abstract ? (
            <div className="space-y-3 rounded-xl border border-border bg-white p-3.5 sm:p-4 shadow-sm text-navy-900">
              <div className="flex items-center justify-between gap-2 border-b border-border pb-2.5">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-navy-50 border border-navy-200 px-2 py-0.5 text-[10px] sm:text-xs font-bold uppercase tracking-wider text-navy-800">
                    Institute Overview
                  </span>
                  <h3 className="text-xs sm:text-sm font-bold text-navy-900 flex items-center gap-1.5">
                    <BarChart3 className="h-4 w-4 text-navy-800" />
                    <span>Institution Attendance Abstract</span>
                  </h3>
                </div>
                <span className="text-[11px] font-medium text-slate-500">
                  {selectedDayInfo.fullLabel}, {selectedDayInfo.dayNum} {selectedDayInfo.monthShort}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <div className="rounded-lg border border-border/80 bg-slate-50/70 p-2.5 sm:p-3">
                  <p className="text-[10px] sm:text-xs font-semibold text-slate-600 flex items-center gap-1">
                    <Building2 className="h-3.5 w-3.5 text-navy-700" />
                    <span>Colleges</span>
                  </p>
                  <p className="mt-1 text-base sm:text-xl font-extrabold text-navy-900">
                    {abstract.totalColleges}
                  </p>
                </div>
                <div className="rounded-lg border border-border/80 bg-slate-50/70 p-2.5 sm:p-3">
                  <p className="text-[10px] sm:text-xs font-semibold text-slate-600 flex items-center gap-1">
                    <BookOpen className="h-3.5 w-3.5 text-indigo-600" />
                    <span>Courses / Branches</span>
                  </p>
                  <p className="mt-1 text-base sm:text-xl font-extrabold text-navy-900">
                    {abstract.totalCourses} <span className="text-xs font-normal text-slate-500">/ {abstract.totalBranches}</span>
                  </p>
                </div>
                <div className="rounded-lg border border-border/80 bg-slate-50/70 p-2.5 sm:p-3">
                  <p className="text-[10px] sm:text-xs font-semibold text-slate-600 flex items-center gap-1">
                    <Layers className="h-3.5 w-3.5 text-amber-600" />
                    <span>Scheduled Sessions</span>
                  </p>
                  <p className="mt-1 text-base sm:text-xl font-extrabold text-navy-900">
                    {allSessions.length}
                  </p>
                </div>
                <div className="rounded-lg border border-border/80 bg-slate-50/70 p-2.5 sm:p-3">
                  <p className="text-[10px] sm:text-xs font-semibold text-slate-600 flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    <span>Completion Rate</span>
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-base sm:text-xl font-extrabold text-emerald-600">
                      {abstract.overallCompletionPct}%
                    </span>
                    <div className="h-2 flex-1 rounded-full bg-slate-200 overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 transition-all duration-300"
                        style={{ width: `${abstract.overallCompletionPct}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {abstract.byCollege.length > 0 ? (
                <div className="mt-3 rounded-lg border border-border bg-white p-3 shadow-xs">
                  <p className="mb-2.5 text-xs sm:text-sm font-bold text-navy-900 flex items-center gap-1.5">
                    <Building2 className="h-4 w-4 text-navy-800" />
                    <span>College-Wise Abstract Breakdown</span>
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-border bg-slate-50/80 text-[11px] font-bold text-slate-700">
                          <th className="py-2 px-2.5 font-semibold">College Name</th>
                          <th className="py-2 px-2.5 text-center font-semibold">Total Sessions</th>
                          <th className="py-2 px-2.5 text-center font-semibold">Pending</th>
                          <th className="py-2 px-2.5 text-center font-semibold">Posted</th>
                          <th className="py-2 px-2.5 text-right font-semibold">Completion Rate</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {abstract.byCollege.map((col) => (
                          <tr key={col.collegeId} className="hover:bg-slate-50/60 transition-colors">
                            <td className="py-2.5 px-2.5 font-semibold text-navy-900">
                              {col.collegeName}
                            </td>
                            <td className="py-2.5 px-2.5 text-center font-bold text-slate-800">
                              {col.totalSessions}
                            </td>
                            <td className="py-2.5 px-2.5 text-center text-amber-700 font-semibold">
                              {col.pending}
                            </td>
                            <td className="py-2.5 px-2.5 text-center text-emerald-700 font-semibold">
                              {col.posted}
                            </td>
                            <td className="py-2.5 px-2.5 text-right">
                              <span
                                className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-bold ${
                                  col.completionPct === 100
                                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                    : col.completionPct > 0
                                      ? "bg-amber-50 text-amber-700 border border-amber-200"
                                      : "bg-rose-50 text-rose-700 border border-rose-200"
                                }`}
                              >
                                {col.completionPct}%
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        /* ACADEMIC POSTING VIEW (Staff, HOD, Vice Principal, Principal) */
        <>
          {/* Week Navigation Header */}
          <nav className="flex items-center justify-between gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 shadow-sm text-xs sm:px-4 sm:py-3">
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={handlePrevWeek}
                aria-label="Previous week"
                className="h-7 px-2 text-[11px] sm:h-8 sm:px-3 sm:text-xs"
              >
                <ChevronLeft className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">Previous week</span>
                <span className="sm:hidden">Prev</span>
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={handleNextWeek}
                disabled={weekOffset >= 0}
                aria-label="Next week"
                className="h-7 px-2 text-[11px] sm:h-8 sm:px-3 sm:text-xs"
              >
                <span className="hidden sm:inline">Next week</span>
                <span className="sm:hidden">Next</span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0" />
              </Button>
            </div>

            <div className="flex items-center gap-1 text-center font-semibold text-navy-900 text-xs sm:text-sm truncate">
              <Calendar className="h-3.5 w-3.5 text-navy-800 shrink-0 hidden sm:inline" />
              <span className="truncate">{weekInfo.rangeLabel}</span>
            </div>

            <div className="flex justify-end shrink-0">
              <Button
                type="button"
                size="sm"
                variant={isCurrentWeek && date === todayIso() ? "primary" : "secondary"}
                onClick={handleToday}
                aria-label="Current week"
                className="h-7 px-2 text-[11px] sm:h-8 sm:px-3 sm:text-xs"
              >
                Today
              </Button>
            </div>
          </nav>

          {/* Day Tabs Bar */}
          <div className="grid grid-cols-6 gap-1 sm:gap-2">
            {weekInfo.days.map((day) => {
              const isSelected = day.dateIso === date;
              return (
                <button
                  key={day.dateIso}
                  type="button"
                  disabled={day.isFuture}
                  onClick={() => setDate(day.dateIso)}
                  className={`flex flex-col items-center justify-center rounded-md border py-1 px-0.5 text-center transition-all ${
                    isSelected
                      ? "border-navy-800 bg-navy-800 text-white shadow-sm"
                      : day.isFuture
                        ? "cursor-not-allowed border-dashed border-border bg-slate-50 text-slate-400 opacity-50"
                        : "border-border bg-white text-navy-900 hover:border-navy-600 hover:bg-slate-50"
                  }`}
                >
                  <span
                    className={`text-[9px] sm:text-xs font-bold uppercase tracking-tight ${
                      isSelected ? "text-slate-200" : "text-slate-500"
                    }`}
                  >
                    {day.code}
                  </span>
                  <span className="text-sm sm:text-lg font-extrabold leading-tight">
                    {day.dayNum}
                  </span>
                  <span
                    className={`text-[8px] sm:text-[11px] ${
                      isSelected ? "text-slate-200" : "text-slate-500"
                    }`}
                  >
                    {day.monthShort}
                  </span>
                  {day.isToday ? (
                    <span
                      className={`mt-0.5 rounded px-1 text-[7px] sm:text-[10px] font-bold ${
                        isSelected
                          ? "bg-white text-navy-900"
                          : "bg-navy-800 text-white"
                      }`}
                    >
                      Today
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {/* Selected Day Header & Summary Statistics */}
          <div className="flex flex-col gap-1 border-b border-border pb-1.5 pt-0.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-navy-800 shrink-0" />
              <h2 className="text-xs sm:text-base font-bold text-navy-900 flex items-center gap-1.5 truncate">
                <span>
                  {selectedDayInfo.fullLabel}, {selectedDayInfo.dayNum} {selectedDayInfo.monthShort}
                </span>
                {selectedDayInfo.isToday ? (
                  <span className="rounded bg-navy-100 px-1.5 py-0.2 text-[9px] sm:text-xs font-semibold text-navy-800 shrink-0">
                    Today
                  </span>
                ) : null}
              </h2>
            </div>

            <div className="flex items-center gap-3 text-[10px] sm:text-xs font-medium text-slate-600">
              <div>
                Total Scheduled:{" "}
                <span className="font-bold text-navy-900">
                  {displayedScopeSessions.length}
                </span>
              </div>
              <div>
                Pending: <span className="font-bold text-warning">{totalPending}</span>
              </div>
              <div>
                Posted: <span className="font-bold text-success">{totalPosted}</span>
              </div>
            </div>
          </div>

          {/* Filter Bar: Scope, Branch, Status, Search (Useful for leadership and multi-class faculty) */}
          {allSessions.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-white p-2 text-xs shadow-xs">
              <div className="flex flex-wrap items-center gap-1.5">
                {/* Scope Switcher for Leadership / HODs: My Attendance vs All Department Slots */}
                {!teachingStaffOnly ? (
                  <div className="flex items-center gap-1 border-r border-border pr-2 mr-1">
                    <span className="text-[11px] text-slate-500 font-semibold">Scope:</span>
                    <button
                      type="button"
                      onClick={() => setViewScope("mine")}
                      className={`rounded px-2.5 py-1 text-[11px] font-bold transition-all flex items-center gap-1.5 ${
                        viewScope === "mine"
                          ? "bg-navy-800 text-white shadow-xs"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      <span>My Attendance</span>
                      <span
                        className={`rounded-full px-1.5 py-0.2 text-[10px] ${
                          viewScope === "mine"
                            ? "bg-white/20 text-white font-extrabold"
                            : "bg-slate-200 text-slate-700 font-semibold"
                        }`}
                      >
                        {mySessionsCount}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewScope("all")}
                      className={`rounded px-2.5 py-1 text-[11px] font-bold transition-all flex items-center gap-1.5 ${
                        viewScope === "all"
                          ? "bg-navy-800 text-white shadow-xs"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      <span>All Department Slots</span>
                      <span
                        className={`rounded-full px-1.5 py-0.2 text-[10px] ${
                          viewScope === "all"
                            ? "bg-white/20 text-white font-extrabold"
                            : "bg-slate-200 text-slate-700 font-semibold"
                        }`}
                      >
                        {allSessions.length}
                      </span>
                    </button>
                  </div>
                ) : null}

                {/* Branch options filter if more than 1 branch */}
                {branchOptions.length > 1 ? (
                  <div className="flex items-center gap-1 border-r border-border pr-2 mr-1">
                    <span className="text-[11px] text-slate-500 font-semibold">Branch:</span>
                    <button
                      type="button"
                      onClick={() => setSelectedBranchId("all")}
                      className={`rounded px-2 py-0.5 text-[11px] font-semibold transition-all ${
                        selectedBranchId === "all"
                          ? "bg-navy-800 text-white"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      All ({displayedScopeSessions.length})
                    </button>
                    {branchOptions.map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => setSelectedBranchId(String(b.id))}
                        className={`rounded px-2 py-0.5 text-[11px] font-semibold transition-all ${
                          selectedBranchId === String(b.id)
                            ? "bg-navy-800 text-white"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                      >
                        {b.name}
                      </button>
                    ))}
                  </div>
                ) : null}

                {/* Status Filter Pills */}
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setStatusFilter("all")}
                    className={`rounded px-2 py-0.5 text-[11px] font-semibold transition-all ${
                      statusFilter === "all"
                        ? "bg-slate-800 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    All ({displayedScopeSessions.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusFilter("pending")}
                    className={`rounded px-2 py-0.5 text-[11px] font-semibold transition-all ${
                      statusFilter === "pending"
                        ? "bg-amber-600 text-white"
                        : "bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200"
                    }`}
                  >
                    Pending ({totalPending})
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusFilter("posted")}
                    className={`rounded px-2 py-0.5 text-[11px] font-semibold transition-all ${
                      statusFilter === "posted"
                        ? "bg-emerald-600 text-white"
                        : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200"
                    }`}
                  >
                    Posted ({totalPosted})
                  </button>
                </div>
              </div>

              {/* Quick Search */}
              <div className="relative min-w-[180px] sm:min-w-[220px]">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filter subject, faculty, section…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-7 w-full rounded-md border border-border bg-slate-50/70 pl-7 pr-2 text-xs outline-none focus:border-navy-800 focus:bg-white"
                />
              </div>
            </div>
          ) : null}

          {/* Error Banner */}
          {error ? (
            <Card className="border-critical/30 bg-critical/5 p-3">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-critical shrink-0" />
                <p className="text-xs font-medium text-navy-900">Unable to load class sessions</p>
              </div>
              <p className="mt-1 text-xs text-critical">{error}</p>
            </Card>
          ) : null}

          {/* Loading State */}
          {loading ? (
            <div className="py-8 text-center text-xs text-slate-500">
              Loading class periods for {selectedDayInfo.fullLabel}…
            </div>
          ) : null}

          {/* Empty State when no sessions exist on that date */}
          {!loading && filteredSessions.length === 0 && !error ? (
            <Card className="py-8 px-4 text-center">
              <Calendar className="mx-auto h-7 w-7 text-slate-400" />
              <p className="mt-2 text-sm font-bold text-navy-900">
                {!teachingStaffOnly && viewScope === "mine"
                  ? "No personal teaching slots scheduled for this date."
                  : `No class sessions scheduled for ${selectedDayInfo.fullLabel}.`}
              </p>
              <div className="mt-1 text-xs text-slate-500 max-w-md mx-auto">
                {!teachingStaffOnly && viewScope === "mine" ? (
                  <>
                    <p>You have no personal slots assigned to teach on {selectedDayInfo.fullLabel}.</p>
                    {allSessions.length > 0 ? (
                      <div className="mt-2.5">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => setViewScope("all")}
                          className="text-xs h-7.5 px-3"
                        >
                          <span>Switch to All Department Slots ({allSessions.length})</span>
                        </Button>
                      </div>
                    ) : null}
                  </>
                ) : allSessions.length > 0 ? (
                  "No sessions matched your active branch, status, or search filters. Clear filters to view all sessions."
                ) : (
                  "There are no active timetable periods for this date in your assigned department or scope. If a timetable was recently created, please ensure it has been published under Timetables."
                )}
              </div>
            </Card>
          ) : null}

          {/* Sessions Grid */}
          <div className="grid gap-2 sm:gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filteredSessions.map((item) => (
              <Card
                key={item.id}
                className={`flex flex-col justify-between border-l-4 p-2.5 sm:p-4 hover:shadow-md transition-shadow ${
                  item.isMySession ? "border-l-indigo-600 bg-white" : "border-l-navy-800"
                }`}
              >
                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-1.5 border-b border-border/50 pb-1.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="inline-flex items-center gap-1 text-[10px] sm:text-xs font-semibold text-navy-800 bg-navy-50 px-1.5 py-0.5 rounded">
                        <Clock className="h-3 w-3" />
                        {item.startTime ?? "—"}
                        {item.endTime ? `–${item.endTime}` : ""}
                        {item.slotLabel ? ` • ${item.slotLabel}` : ""}
                      </span>
                      {item.isMySession ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded">
                          ★ My Slot
                        </span>
                      ) : null}
                      {item.subjectTypeSnapshot ? (
                        <span
                          className={`inline-flex items-center text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                            item.subjectTypeSnapshot.toLowerCase() === "lab"
                              ? "bg-purple-50 text-purple-700 border border-purple-200"
                              : "bg-sky-50 text-sky-700 border border-sky-200"
                          }`}
                        >
                          {item.subjectTypeSnapshot}
                        </span>
                      ) : null}
                    </div>
                    <StatusBadge status={item.posted ? "Posted" : "Pending"} />
                  </div>

                  <h3 className="text-xs sm:text-base font-bold text-navy-900 leading-snug">
                    {item.subjectName ?? "Untitled subject"}
                  </h3>
                  <p className="text-[10px] sm:text-xs font-medium text-slate-600 mt-0.5">
                    {item.subjectCode ?? "—"}
                    {item.section ? ` • Section ${item.section}` : ""}
                    {item.branchName ? ` • ${item.branchName}` : ""}
                  </p>
                  <p className="mt-1 text-[10px] sm:text-xs text-slate-500">
                    <span className="font-semibold text-slate-700">Faculty:</span>{" "}
                    {item.facultyName ? (
                      item.isMySession ? (
                        <span className="font-semibold text-navy-900">
                          {item.facultyName} <span className="text-indigo-600 font-bold">(You)</span>
                        </span>
                      ) : (
                        item.facultyName
                      )
                    ) : (
                      "Faculty unassigned"
                    )}
                    {item.roomLabel ? ` • Room: ${item.roomLabel}` : ""}
                  </p>

                  {item.posted ? (
                    <div className="mt-2 rounded bg-emerald-50 p-1.5 text-[10px] sm:text-xs text-emerald-800 font-medium flex items-center justify-between">
                      <span>Present: <strong className="text-emerald-900">{item.presentCount}</strong></span>
                      <span>Absent: <strong className="text-rose-700">{item.absentCount}</strong></span>
                    </div>
                  ) : null}
                </div>

                <div className="mt-3">
                  <Link href={`/attendance-posting/${item.id}`}>
                    <Button
                      className="w-full h-7 sm:h-9 text-xs font-semibold"
                      variant={item.posted ? "secondary" : "primary"}
                    >
                      {item.posted
                        ? "Review / Edit Attendance"
                        : item.isMySession
                          ? "Post Attendance"
                          : "Post Attendance (Dept / Substitute)"}
                    </Button>
                  </Link>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
