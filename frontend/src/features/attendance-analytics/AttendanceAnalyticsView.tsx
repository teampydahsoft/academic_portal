"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { Card } from "@/components/ui/Card";
import { useAcademicContext } from "@/components/layout/AcademicProvider";
import { apiFetch } from "@/lib/api";

export type AttendanceAnalytics = {
  overallAttendance: number;
  studentsBelowThreshold: number;
  bands: { label: string; total: number }[];
  sections: { section: string; attendance: number }[];
  today?: { scheduled: number; posted: number; pending: number };
  source?: string;
};

export function AttendanceAnalyticsView() {
  const { filters } = useAcademicContext();
  const [analytics, setAnalytics] = useState<AttendanceAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.collegeId !== "all") params.set("collegeId", String(filters.collegeId));
    if (filters.courseId !== "all") params.set("courseId", String(filters.courseId));
    if (filters.branchId !== "all") params.set("branchId", String(filters.branchId));
    if (filters.section !== "all") params.set("section", String(filters.section));
    return params.toString();
  }, [filters.collegeId, filters.courseId, filters.branchId, filters.section]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await apiFetch(`/attendance/analytics${query ? `?${query}` : ""}`,
          { cache: "no-store" },
        );
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            typeof body === "object" && body && "message" in body
              ? String((body as { message: string }).message)
              : "Failed to load analytics",
          );
        }
        if (!cancelled) setAnalytics(body as AttendanceAnalytics);
      } catch (err) {
        if (!cancelled) {
          setAnalytics(null);
          setError(err instanceof Error ? err.message : "Failed to load analytics");
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

  const data = analytics ?? {
    overallAttendance: 0,
    studentsBelowThreshold: 0,
    bands: [],
    sections: [],
    today: { scheduled: 0, posted: 0, pending: 0 },
  };

  return (
    <div>
      <PageHeader
        title="Attendance Analytics & Progress"
        description={
          data.source ||
          "Calculated from Academic Portal class-session attendance posts (last 90 days)."
        }
      />

      {error ? <p className="mb-3 text-sm text-critical">{error}</p> : null}
      {loading ? <p className="mb-3 text-sm text-slate-500">Loading analytics…</p> : null}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Overall Attendance"
          value={`${data.overallAttendance}%`}
          tone="success"
        />
        <StatCard
          label="Below Threshold"
          value={data.studentsBelowThreshold.toLocaleString()}
          tone="critical"
        />
        <StatCard label="Pending today" value={data.today?.pending ?? 0} tone="warning" />
        <StatCard label="Posted today" value={data.today?.posted ?? 0} tone="success" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <h3 className="mb-3 text-base font-semibold text-navy-900">
            Attendance Distribution
          </h3>
          {data.bands.length === 0 ? (
            <p className="text-sm text-slate-500">No posted class-session attendance yet.</p>
          ) : (
            <div className="space-y-3 text-sm">
              {data.bands.map((band) => (
                <div key={band.label}>
                  <div className="mb-1 flex justify-between">
                    <span>{band.label}</span>
                    <span>{band.total.toLocaleString()}</span>
                  </div>
                  <div className="h-2 rounded bg-slate-100">
                    <div
                      className="h-2 rounded bg-navy-800"
                      style={{
                        width: `${Math.min(
                          100,
                          (band.total /
                            Math.max(
                              1,
                              data.bands.reduce((s, b) => s + b.total, 0),
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
        <Card>
          <h3 className="mb-3 text-base font-semibold text-navy-900">Section Snapshot</h3>
          {data.sections.length === 0 ? (
            <p className="text-sm text-slate-500">No section posts in the last 90 days.</p>
          ) : (
            <ul className="space-y-2 text-sm text-slate-700">
              {data.sections.map((row) => (
                <li key={row.section} className="flex justify-between gap-3">
                  <span>{row.section}</span>
                  <span>{row.attendance}%</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
