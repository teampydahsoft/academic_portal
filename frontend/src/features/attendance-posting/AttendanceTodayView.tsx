"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAcademicContext } from "@/components/layout/AcademicProvider";
import { apiFetch } from "@/lib/api";
import { isTeachingStaffOnly } from "@/lib/teaching-scope";
import { useAuth } from "@/components/auth/AuthProvider";

export type AttendanceSessionCard = {
  id: number;
  date: string;
  startTime: string | null;
  endTime: string | null;
  slotLabel: string | null;
  subjectCode: string | null;
  subjectName: string | null;
  section: string | null;
  facultyName: string | null;
  roomLabel: string | null;
  sessionStatus: string;
  posted: boolean;
  presentCount: number;
  absentCount: number;
};

type ListResponse = {
  date: string;
  scheduled: number;
  posted: number;
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

export function AttendanceTodayView() {
  const { filters } = useAcademicContext();
  const { authorization } = useAuth();
  const teachingStaffOnly = isTeachingStaffOnly(authorization);
  const [date, setDate] = useState(todayIso);
  const [payload, setPayload] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    params.set("date", date);
    if (filters.collegeId !== "all") params.set("collegeId", String(filters.collegeId));
    if (filters.courseId !== "all") params.set("courseId", String(filters.courseId));
    if (filters.branchId !== "all") params.set("branchId", String(filters.branchId));
    if (filters.batch !== "all") params.set("batch", String(filters.batch));
    if (filters.year !== "all") params.set("year", String(filters.year));
    if (filters.semester !== "all") params.set("semester", String(filters.semester));
    if (filters.section !== "all") params.set("section", String(filters.section));
    if (filters.academicYear) params.set("academicYear", filters.academicYear);
    return params.toString();
  }, [date, filters]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await apiFetch(`/attendance/sessions?${query}`, {
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
  }, [query]);

  const sessions = payload?.data ?? [];

  return (
    <div>
      <PageHeader
        title="Attendance Posting"
        description={
          teachingStaffOnly
            ? "Your assigned class sessions for the selected date. Only subjects linked to your published timetable are shown."
            : "Class sessions from published Academic Portal timetables. Holidays come from Student Database. Roster comes from Student Database."
        }
        actions={
          <label className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">Date</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-9 rounded-md border border-border bg-white px-2 text-sm outline-none focus:border-navy-800"
            />
          </label>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card>
          <p className="text-xs text-slate-500">Sessions</p>
          <p className="text-2xl font-semibold text-navy-900">{sessions.length}</p>
        </Card>
        <Card>
          <p className="text-xs text-slate-500">Pending</p>
          <p className="text-2xl font-semibold text-warning">{payload?.scheduled ?? 0}</p>
        </Card>
        <Card>
          <p className="text-xs text-slate-500">Posted</p>
          <p className="text-2xl font-semibold text-success">{payload?.posted ?? 0}</p>
        </Card>
      </div>

      {error ? (
        <Card className="mb-4">
          <p className="text-sm font-medium text-navy-900">Unable to load sessions.</p>
          <p className="mt-1 text-sm text-critical">{error}</p>
        </Card>
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-500">Loading class sessions…</p>
      ) : null}

      {!loading && sessions.length === 0 && !error ? (
        <Card>
          <p className="text-sm text-navy-900">No class sessions for this date and filter set.</p>
          <p className="mt-1 text-sm text-slate-500">
            {teachingStaffOnly
              ? "You have no assigned classes for this date. If you expected a session, confirm your published timetable or contact your HOD."
              : "Publish a timetable for the selected college / course / branch / batch / semester, and confirm semester dates exist in Settings. Declared holidays are skipped."}
          </p>
        </Card>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sessions.map((item) => (
          <Card key={item.id} className="flex flex-col justify-between">
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  {item.startTime ?? "—"}
                  {item.endTime ? ` – ${item.endTime}` : ""}
                  {item.slotLabel ? ` • ${item.slotLabel}` : ""}
                </p>
                <StatusBadge status={item.posted ? "Posted" : "Pending"} />
              </div>
              <h3 className="text-lg font-semibold text-navy-900">
                {item.subjectName ?? "Untitled subject"}
              </h3>
              <p className="text-sm text-slate-600">
                {item.subjectCode ?? "—"} • Section {item.section ?? "—"}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {item.facultyName ?? "Faculty unassigned"}
                {item.roomLabel ? ` • ${item.roomLabel}` : ""}
              </p>
              {item.posted ? (
                <p className="mt-2 text-xs text-slate-500">
                  Present {item.presentCount} • Absent {item.absentCount}
                </p>
              ) : null}
            </div>
            <div className="mt-4">
              <Link href={`/attendance-posting/${item.id}`}>
                <Button className="w-full">{item.posted ? "Review / Edit" : "Post Attendance"}</Button>
              </Link>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
