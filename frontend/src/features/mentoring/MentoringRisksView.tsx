"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { DataTable } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterBar, FilterField } from "@/components/ui/FilterBar";
import { useAcademicContext } from "@/components/layout/AcademicProvider";
import { useAuth } from "@/components/auth/AuthProvider";
import { apiFetch } from "@/lib/api";
import { MentoringStudentCard } from "./MentoringStudentCard";
import type { MentoringDashboardResponse, MentoringListFilters } from "./types";
import { buildMentoringQuery, formatComplaintStatus } from "./utils";

const selectClassName =
  "h-11 sm:h-9 w-full rounded-md border border-border bg-white px-2 text-sm text-foreground outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600";

const DEFAULT_LOCAL_FILTERS: MentoringListFilters = {
  risk: "all",
  caseStatus: "all",
  mentorStaffLinkId: "all",
  onlyAtRisk: true,
};

export function MentoringRisksView() {
  const { filters } = useAcademicContext();
  const { hasPermission } = useAuth();
  const canView = hasPermission("mentoring.view", "students.view");

  const [localFilters, setLocalFilters] = useState<MentoringListFilters>(DEFAULT_LOCAL_FILTERS);
  const [payload, setPayload] = useState<MentoringDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const queryKey = useMemo(
    () => buildMentoringQuery({ ...filters, q: filters.q }, localFilters),
    [filters, localFilters],
  );

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch(`/mentoring/dashboard?${queryKey}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof body === "object" && body && "message" in body
            ? String((body as { message: string }).message)
            : `Failed to load mentoring dashboard (${response.status})`,
        );
      }
      setPayload(body as MentoringDashboardResponse);
    } catch (err) {
      setPayload(null);
      setError(err instanceof Error ? err.message : "Failed to load mentoring dashboard");
    } finally {
      setLoading(false);
    }
  }, [canView, queryKey]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!canView) {
    return (
      <EmptyState
        title="Mentoring & Risks unavailable"
        description="You do not have permission to view mentoring and risk management."
      />
    );
  }

  const summary = payload?.summary;
  const rows = payload?.data ?? [];

  return (
    <div>
      <PageHeader
        title="Mentoring & Risks"
        description="Attendance-risk students, mentor assignments, and complaints within your academic scope."
      />

      {error ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-critical">
          {error}
        </div>
      ) : null}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <StatCard label="Total Mentees" value={loading ? "…" : (summary?.totalMentees ?? 0)} tone="info" />
        <StatCard label="High Risk" value={loading ? "…" : (summary?.highRisk ?? 0)} tone="critical" />
        <StatCard label="Medium Risk" value={loading ? "…" : (summary?.mediumRisk ?? 0)} tone="warning" />
        <StatCard label="Open Complaints" value={loading ? "…" : (summary?.openCases ?? 0)} />
        <StatCard label="Follow-ups Due" value={loading ? "…" : (summary?.followUpsDue ?? 0)} tone="warning" />
        <StatCard label="Escalated" value={loading ? "…" : (summary?.escalated ?? 0)} tone="critical" />
      </div>

      <FilterBar className="mb-4">
        <FilterField label="Risk">
          <select
            className={selectClassName}
            value={localFilters.risk}
            onChange={(event) =>
              setLocalFilters((prev) => ({ ...prev, risk: event.target.value as MentoringListFilters["risk"] }))
            }
          >
            <option value="all">All levels</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>
        </FilterField>
        <FilterField label="Complaint status">
          <select
            className={selectClassName}
            value={localFilters.caseStatus}
            onChange={(event) =>
              setLocalFilters((prev) => ({
                ...prev,
                caseStatus: event.target.value as MentoringListFilters["caseStatus"],
              }))
            }
          >
            <option value="all">All</option>
            <option value="none">No active complaint</option>
            <option value="open">Open</option>
            <option value="monitoring">Monitoring</option>
            <option value="escalated">Escalated</option>
            <option value="resolved">Resolved</option>
          </select>
        </FilterField>
        <FilterField label="View">
          <select
            className={selectClassName}
            value={localFilters.onlyAtRisk ? "at-risk" : "all"}
            onChange={(event) =>
              setLocalFilters((prev) => ({ ...prev, onlyAtRisk: event.target.value === "at-risk" }))
            }
          >
            <option value="at-risk">At-risk only (default)</option>
            <option value="all">All students in scope</option>
          </select>
        </FilterField>
        <div className="flex items-end">
          <Button size="sm" variant="secondary" onClick={() => void load()} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </FilterBar>

      {payload?.truncated ? (
        <p className="mb-2 text-xs text-amber-700">
          Results may be truncated for large cohorts. Narrow college, branch, year, or section filters.
        </p>
      ) : null}

      {loading ? (
        <div className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-slate-500">
          Loading mentoring dashboard…
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No mentoring/risk records available"
          description="No students match the current academic scope and filters. Adjust filters or assign mentors to build your mentee list."
        />
      ) : (
        <>
          <div className="hidden md:block">
            <DataTable
              rows={rows}
              rowKey={(row) => row.id}
              emptyMessage="No mentoring/risk records available"
              columns={[
                { key: "name", header: "Student", render: (row) => row.name },
                {
                  key: "rollNo",
                  header: "Roll / Adm.",
                  render: (row) => row.rollNo || row.admissionNo || "—",
                },
                {
                  key: "section",
                  header: "Section",
                  render: (row) => [row.branch, row.section].filter(Boolean).join(" · ") || "—",
                },
                {
                  key: "attendance",
                  header: "Attendance",
                  render: (row) => `${row.attendance.toFixed(1)}%`,
                },
                {
                  key: "risk",
                  header: "Risk",
                  render: (row) => <StatusBadge status={row.risk} />,
                },
                {
                  key: "mentor",
                  header: "Mentor",
                  render: (row) => row.mentor?.name ?? <span className="text-slate-400">Not assigned</span>,
                },
                {
                  key: "complaint",
                  header: "Complaint",
                  render: (row) =>
                    row.activeCase ? (
                      <StatusBadge status={formatComplaintStatus(row.activeCase.status)} />
                    ) : (
                      <span className="text-slate-400">—</span>
                    ),
                },
                {
                  key: "actions",
                  header: "Actions",
                  render: (row) => (
                    <div className="flex flex-wrap gap-2">
                      <Link href={`/mentoring-risks/${row.id}`}>
                        <Button size="sm" variant="secondary">
                          Open
                        </Button>
                      </Link>
                      <Link href={`/students/${row.id}`}>
                        <Button size="sm" variant="ghost">
                          Profile
                        </Button>
                      </Link>
                    </div>
                  ),
                },
              ]}
            />
          </div>
          <div className="grid gap-3 md:hidden">
            {rows.map((row) => (
              <MentoringStudentCard key={row.id} row={row} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
