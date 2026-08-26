"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { DataTable } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useAcademicContext } from "@/components/layout/AcademicProvider";
import { apiFetch } from "@/lib/api";
import type { StudentListRow } from "@/features/students/student-types";
import type { CommandCenterSummary } from "@/features/command-center/CommandCenterView";

type RiskFilter = "all" | "High" | "Medium";

const PAGE_SIZE = 100;
const MAX_PAGES = 10;

function buildStudentsQuery(
  filters: ReturnType<typeof useAcademicContext>["filters"],
  offset: number,
) {
  const params = new URLSearchParams();
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String(offset));
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.collegeId !== "all") params.set("collegeId", String(filters.collegeId));
  if (filters.courseId !== "all") params.set("courseId", String(filters.courseId));
  if (filters.branchId !== "all") params.set("branchId", String(filters.branchId));
  if (filters.batch !== "all") params.set("batch", String(filters.batch));
  if (filters.year !== "all") params.set("year", String(filters.year));
  if (filters.semester !== "all") params.set("semester", String(filters.semester));
  if (filters.section !== "all") params.set("section", String(filters.section));
  if (filters.studentStatus !== "all") {
    params.set("status", String(filters.studentStatus));
  }
  return params.toString();
}

function isAtRisk(row: StudentListRow) {
  return row.risk === "High" || row.risk === "Medium";
}

export function MentoringRisksView() {
  const { filters } = useAcademicContext();
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("all");
  const [rows, setRows] = useState<StudentListRow[]>([]);
  const [scannedTotal, setScannedTotal] = useState(0);
  const [belowThreshold, setBelowThreshold] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  const filterKey = useMemo(
    () => buildStudentsQuery(filters, 0),
    [filters],
  );

  const summaryQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.collegeId !== "all") params.set("collegeId", String(filters.collegeId));
    if (filters.courseId !== "all") params.set("courseId", String(filters.courseId));
    if (filters.branchId !== "all") params.set("branchId", String(filters.branchId));
    if (filters.section !== "all") params.set("section", filters.section);
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }, [filters.collegeId, filters.courseId, filters.branchId, filters.section]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setRows([]);
    setTruncated(false);
    try {
      const summaryRes = await apiFetch(`/command-center/summary${summaryQuery}`, {
        cache: "no-store",
      });
      if (summaryRes.ok) {
        const summary = (await summaryRes.json()) as CommandCenterSummary;
        setBelowThreshold(Number(summary.openRiskCases ?? summary.studentsBelowThreshold ?? 0));
      } else {
        setBelowThreshold(null);
      }

      const atRisk: StudentListRow[] = [];
      let offset = 0;
      let total = 0;
      let pages = 0;

      while (pages < MAX_PAGES) {
        const response = await apiFetch(`/students?${buildStudentsQuery(filters, offset)}`, {
          cache: "no-store",
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            typeof body === "object" && body && "message" in body
              ? String((body as { message: string }).message)
              : `Failed to load students (${response.status})`,
          );
        }
        const payload = body as { data?: StudentListRow[]; total?: number };
        const pageRows = payload.data ?? [];
        total = Number(payload.total ?? pageRows.length);
        atRisk.push(...pageRows.filter(isAtRisk));
        offset += pageRows.length;
        pages += 1;
        if (pageRows.length === 0 || offset >= total) break;
      }

      setRows(atRisk);
      setScannedTotal(total);
      setTruncated(offset < total);
    } catch (err) {
      setRows([]);
      setError(err instanceof Error ? err.message : "Failed to load risk students");
    } finally {
      setLoading(false);
    }
  }, [filters, summaryQuery]);

  useEffect(() => {
    void load();
  }, [load, filterKey]);

  const visible = useMemo(() => {
    if (riskFilter === "all") return rows;
    return rows.filter((row) => row.risk === riskFilter);
  }, [rows, riskFilter]);

  const highCount = rows.filter((r) => r.risk === "High").length;
  const mediumCount = rows.filter((r) => r.risk === "Medium").length;

  return (
    <div>
      <PageHeader
        title="Mentoring & Risks"
        description="Attendance-risk students from the live student register. Formal mentoring case assignments are not configured yet."
      />

      {error ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-critical">
          {error}
        </div>
      ) : null}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Below 75% (scope)"
          value={loading ? "…" : (belowThreshold ?? "—").toLocaleString()}
          hint="Command Center · last 90 days"
          tone="warning"
        />
        <StatCard
          label="High risk listed"
          value={loading ? "…" : highCount}
          hint="Attendance under 65%"
          tone="critical"
        />
        <StatCard
          label="Medium risk listed"
          value={loading ? "…" : mediumCount}
          hint="Attendance 65–74%"
          tone="info"
        />
        <StatCard
          label="Register scanned"
          value={loading ? "…" : `${Math.min(scannedTotal, PAGE_SIZE * MAX_PAGES).toLocaleString()} / ${scannedTotal.toLocaleString()}`}
          hint={truncated ? "Partial scan — refine filters" : "Within current filters"}
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {([
          ["all", "All at-risk"],
          ["High", "High"],
          ["Medium", "Medium"],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setRiskFilter(value)}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
              riskFilter === value
                ? "bg-brand-600 text-white"
                : "border border-border bg-card text-slate-700 hover:bg-slate-50"
            }`}
          >
            {label}
          </button>
        ))}
        <Button size="sm" variant="secondary" onClick={() => void load()} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      {loading ? (
        <div className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-slate-500">
          Loading attendance-risk students…
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          title="No mentoring/risk records available"
          description="No High or Medium attendance-risk students were found in the current academic scope. Formal mentor assignments and intervention cases are not available yet."
        />
      ) : (
        <>
          {truncated ? (
            <p className="mb-2 text-xs text-amber-700">
              Showing at-risk students from the first {PAGE_SIZE * MAX_PAGES} register rows.
              Narrow college/branch/year filters to scan a smaller cohort.
            </p>
          ) : null}
          <DataTable
            rows={visible}
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
                render: (row) =>
                  [row.branch, row.section].filter(Boolean).join(" · ") || "—",
              },
              {
                key: "riskType",
                header: "Category",
                render: () => "Attendance risk",
              },
              {
                key: "attendance",
                header: "Attendance",
                render: (row) => `${Number(row.attendance ?? 0).toFixed(1)}%`,
              },
              {
                key: "level",
                header: "Risk level",
                render: (row) => <StatusBadge status={row.risk} />,
              },
              {
                key: "status",
                header: "Status",
                render: () => <StatusBadge status="Open" />,
              },
              {
                key: "mentor",
                header: "Assigned mentor",
                render: () => (
                  <span className="text-slate-400">Not assigned</span>
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
        </>
      )}
    </div>
  );
}
