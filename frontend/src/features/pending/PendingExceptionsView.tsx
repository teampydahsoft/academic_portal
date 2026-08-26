"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useAcademicContext } from "@/components/layout/AcademicProvider";
import { useAuth } from "@/components/auth/AuthProvider";
import { apiFetch } from "@/lib/api";
import type { AttendanceSessionCard } from "@/features/attendance-posting/AttendanceTodayView";
import type { WorkloadSummary } from "@/features/workload/StaffWorkloadView";
import type { CommandCenterSummary } from "@/features/command-center/CommandCenterView";

type Priority = "Critical" | "High" | "Medium";

type PendingItem = {
  id: string;
  priority: Priority;
  issue: string;
  module: string;
  owner: string;
  href: string;
  status: string;
  meta?: string;
};

function todayIso() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function priorityRank(p: Priority) {
  if (p === "Critical") return 0;
  if (p === "High") return 1;
  return 2;
}

export function PendingExceptionsView() {
  const { filters } = useAcademicContext();
  const { hasAnyPermission } = useAuth();
  const canAttendance = hasAnyPermission("attendance.view", "attendance.post");
  const canWorkload = hasAnyPermission("workload.view");
  const canDashboard = hasAnyPermission("dashboard.view");

  const [items, setItems] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<"all" | Priority>("all");

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
    async function load() {
      setLoading(true);
      setWarnings([]);
      const next: PendingItem[] = [];
      const notes: string[] = [];

      if (canDashboard) {
        try {
          const ccParams = new URLSearchParams();
          if (filters.collegeId !== "all") ccParams.set("collegeId", String(filters.collegeId));
          if (filters.courseId !== "all") ccParams.set("courseId", String(filters.courseId));
          if (filters.branchId !== "all") ccParams.set("branchId", String(filters.branchId));
          if (filters.section !== "all") ccParams.set("section", filters.section);
          const qs = ccParams.toString();
          const response = await apiFetch(`/command-center/summary${qs ? `?${qs}` : ""}`, {
            cache: "no-store",
          });
          if (response.ok) {
            const summary = (await response.json()) as CommandCenterSummary;
            const published = summary.timetablesPublished?.published ?? 0;
            const total = summary.timetablesPublished?.total ?? 0;
            const unpublished = Math.max(0, total - published);
            if (unpublished > 0) {
              next.push({
                id: "timetable-coverage",
                priority: unpublished >= 3 ? "High" : "Medium",
                issue: `${unpublished} section timetable(s) not published (${published}/${total} published)`,
                module: "Timetables",
                owner: "Academic Admin",
                href: "/timetables",
                status: "Open",
                meta: "From Command Center coverage",
              });
            }
            if (summary.studentsBelowThreshold > 0) {
              next.push({
                id: "attendance-risk-cohort",
                priority: summary.studentsBelowThreshold >= 50 ? "High" : "Medium",
                issue: `${summary.studentsBelowThreshold.toLocaleString()} students below 75% attendance`,
                module: "Mentoring & Risks",
                owner: "Academic staff",
                href: "/mentoring-risks",
                status: "Open",
                meta: "Last 90 days · Command Center",
              });
            }
          } else {
            notes.push(`Command Center unavailable (${response.status})`);
          }
        } catch {
          notes.push("Command Center could not be loaded");
        }
      }

      if (canAttendance) {
        try {
          const params = new URLSearchParams(scopeParams);
          params.set("date", todayIso());
          const response = await apiFetch(`/attendance/sessions?${params}`, {
            cache: "no-store",
          });
          const body = await response.json().catch(() => ({}));
          if (!response.ok) {
            notes.push(
              typeof body === "object" && body && "message" in body
                ? String((body as { message: string }).message)
                : `Attendance sessions unavailable (${response.status})`,
            );
          } else {
            const sessions = ((body as { data?: AttendanceSessionCard[] }).data ?? []).filter(
              (s) => !s.posted && s.sessionStatus !== "cancelled",
            );
            for (const session of sessions) {
              const subject =
                session.subjectCode || session.subjectName || "Class session";
              next.push({
                id: `att-${session.id}`,
                priority: "Critical",
                issue: `Attendance not posted — ${subject}${session.section ? ` · ${session.section}` : ""}${session.slotLabel ? ` · ${session.slotLabel}` : ""}`,
                module: "Attendance Posting",
                owner: session.facultyName || "Faculty",
                href: `/attendance-posting/${session.id}`,
                status: "Open",
                meta: session.date,
              });
            }
          }
        } catch {
          notes.push("Attendance sessions could not be loaded");
        }
      }

      if (canWorkload) {
        try {
          const qs = scopeParams.toString();
          const response = await apiFetch(`/workload/summary${qs ? `?${qs}` : ""}`, {
            cache: "no-store",
          });
          const body = await response.json().catch(() => ({}));
          if (!response.ok) {
            notes.push(`Workload summary unavailable (${response.status})`);
          } else {
            const summary = body as WorkloadSummary;
            const list = (summary.faculty ?? []).filter((f) => f.status === "Overloaded");
            for (const faculty of list.slice(0, 25)) {
              next.push({
                id: `wl-${faculty.id}`,
                priority: "High",
                issue: `Faculty overload — ${faculty.name} (${faculty.periodsPerWeek} periods/week)`,
                module: "Staff Workload",
                owner: faculty.department || "HOD",
                href: `/staff-workload/${encodeURIComponent(faculty.id)}`,
                status: "Open",
                meta: faculty.code || faculty.hrmsEmployeeId,
              });
            }
          }
        } catch {
          notes.push("Workload summary could not be loaded");
        }
      }

      next.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
      if (!cancelled) {
        setItems(next);
        setWarnings(notes);
        setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [
    canAttendance,
    canWorkload,
    canDashboard,
    scopeParams,
    filters.collegeId,
    filters.courseId,
    filters.branchId,
    filters.section,
  ]);

  const visible = useMemo(() => {
    if (priorityFilter === "all") return items;
    return items.filter((item) => item.priority === priorityFilter);
  }, [items, priorityFilter]);

  const groups = useMemo(() => {
    const order: Priority[] = ["Critical", "High", "Medium"];
    return order
      .map((priority) => ({
        priority,
        items: visible.filter((item) => item.priority === priority),
      }))
      .filter((g) => g.items.length > 0);
  }, [visible]);

  return (
    <div>
      <PageHeader
        title="Pending & Exceptions"
        description="Operational queue derived from live attendance posting, timetable coverage, workload, and attendance-risk signals. Formal exception tickets are not configured yet."
      />

      {warnings.length > 0 ? (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {warnings.join(" · ")}
        </div>
      ) : null}

      <div className="mb-3 flex flex-wrap gap-2">
        {(["all", "Critical", "High", "Medium"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setPriorityFilter(tab)}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
              priorityFilter === tab
                ? "bg-brand-600 text-white"
                : "border border-border bg-card text-slate-700 hover:bg-slate-50"
            }`}
          >
            {tab === "all" ? `All (${items.length})` : tab}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-slate-500">
          Loading pending items…
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          title="No pending exceptions"
          description={
            canAttendance || canWorkload || canDashboard
              ? "Nothing actionable was found in the current academic scope from available data sources."
              : "You do not have permission to view attendance, workload, or dashboard exception sources."
          }
        />
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <Card key={group.priority}>
              <h3 className="mb-3 text-base font-semibold text-navy-900">{group.priority}</h3>
              <ul className="space-y-3">
                {group.items.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <StatusBadge status={item.priority} />
                        <StatusBadge status={item.status} />
                        {item.meta ? (
                          <span className="text-xs text-slate-500">{item.meta}</span>
                        ) : null}
                      </div>
                      <p className="text-sm font-medium text-navy-900">{item.issue}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        Module: {item.module} · Owner: {item.owner}
                      </p>
                    </div>
                    <Link href={item.href}>
                      <Button size="sm" variant="secondary">
                        Open
                      </Button>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
