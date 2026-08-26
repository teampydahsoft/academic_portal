"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterBar, FilterField } from "@/components/ui/FilterBar";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAcademicContext } from "@/components/layout/AcademicProvider";
import { apiFetch } from "@/lib/api";
import {
  formatCredits,
  formatPoints,
  type ResultOptions,
  type ResultRow,
  type ResultsListResponse,
} from "@/features/results/result-types";

const selectClassName =
  "h-9 min-w-[140px] rounded-md border border-border bg-white px-2 text-sm text-foreground outline-none focus:border-navy-800";

const searchClassName =
  "h-9 w-full min-w-[180px] rounded-md border border-border bg-white px-3 text-sm text-foreground outline-none focus:border-navy-800";

export function ResultsView() {
  const { filters } = useAcademicContext();
  const [options, setOptions] = useState<ResultOptions | null>(null);
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [summary, setSummary] = useState<ResultsListResponse["summary"]>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [examId, setExamId] = useState("all");
  const [examType, setExamType] = useState("all");
  const [resultStatus, setResultStatus] = useState("all");
  const [studentDraft, setStudentDraft] = useState("");
  const [student, setStudent] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setStudent(studentDraft.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [studentDraft]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchDraft.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.collegeId !== "all") params.set("collegeId", String(filters.collegeId));
    if (filters.courseId !== "all") params.set("courseId", String(filters.courseId));
    if (filters.branchId !== "all") params.set("branchId", String(filters.branchId));
    if (filters.batch !== "all") params.set("batch", String(filters.batch));
    if (filters.year !== "all") params.set("year", String(filters.year));
    if (filters.semester !== "all") params.set("semester", String(filters.semester));
    if (examId !== "all") params.set("examId", examId);
    if (examType !== "all") params.set("examType", examType);
    if (resultStatus !== "all") params.set("resultStatus", resultStatus);
    if (student) params.set("student", student);
    if (search) params.set("q", search);
    return params.toString();
  }, [filters, examId, examType, resultStatus, student, search]);

  useEffect(() => {
    let cancelled = false;
    async function loadOptions() {
      try {
        const response = await apiFetch(`/results/options`, { cache: "no-store" });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || cancelled) return;
        setOptions(body as ResultOptions);
      } catch {
        if (!cancelled) setOptions(null);
      }
    }
    void loadOptions();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await apiFetch(`/results?${query}`, { cache: "no-store" });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            typeof body?.message === "string" ? body.message : "Failed to load results",
          );
        }
        const payload = body as ResultsListResponse;
        if (!cancelled) {
          setRows(payload.data ?? []);
          setSummary(payload.summary ?? null);
          setTotal(payload.total ?? 0);
        }
      } catch (err) {
        if (!cancelled) {
          setRows([]);
          setSummary(null);
          setTotal(0);
          setError(err instanceof Error ? err.message : "Failed to load results");
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

  const hasData = !loading && !error && total > 0;

  return (
    <div>
      <PageHeader
        title="Results"
        description="Read-only examination results from EMS subject_results. Grades, credits, and pass/fail — no numeric marks."
        actions={
          <span className="inline-flex items-center rounded-full border border-border bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
            Read-only · EMS
          </span>
        }
      />

      {hasData && summary ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard label="Result rows" value={summary.totalRows} />
          <StatCard label="Students" value={summary.uniqueStudents} />
          <StatCard label="Passed" value={summary.passed} tone="success" />
          <StatCard label="Failed" value={summary.failed} tone="critical" />
          <StatCard
            label="Pass %"
            value={`${summary.passPercentage}%`}
            tone={summary.passPercentage >= 50 ? "success" : "warning"}
          />
        </div>
      ) : null}

      {hasData && summary && summary.gradeDistribution.length > 0 ? (
        <Card className="mb-4">
          <h2 className="text-sm font-semibold text-navy-900">Grade distribution</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {summary.gradeDistribution.map((item) => (
              <span
                key={item.grade}
                className="inline-flex items-center gap-1.5 rounded border border-border bg-slate-50 px-2.5 py-1 text-xs text-slate-700"
              >
                <span className="font-semibold text-navy-900">{item.grade}</span>
                <span className="text-slate-500">{item.count}</span>
              </span>
            ))}
          </div>
        </Card>
      ) : null}

      <FilterBar>
        <FilterField label="Exam">
          <select className={selectClassName} value={examId} onChange={(e) => setExamId(e.target.value)}>
            <option value="all">All exams</option>
            {(options?.exams ?? []).map((exam) => (
              <option key={exam.id} value={exam.id}>
                {exam.name}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Exam type">
          <select
            className={selectClassName}
            value={examType}
            onChange={(e) => setExamType(e.target.value)}
          >
            <option value="all">All types</option>
            {(options?.examTypes ?? []).map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Result status">
          <select
            className={selectClassName}
            value={resultStatus}
            onChange={(e) => setResultStatus(e.target.value)}
          >
            <option value="all">All</option>
            {(options?.resultStatuses ?? []).map((status) => (
              <option key={status.value} value={status.value}>
                {status.label}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Student">
          <input
            type="search"
            value={studentDraft}
            onChange={(e) => setStudentDraft(e.target.value)}
            placeholder="Roll number or name"
            className={searchClassName}
            aria-label="Filter by student"
          />
        </FilterField>
        <FilterField label="Search">
          <input
            type="search"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="Subject, grade, exam"
            className={searchClassName}
            aria-label="Search results"
          />
        </FilterField>
      </FilterBar>
      <p className="mb-4 text-xs text-slate-500">
        College, course, branch, batch, year, and semester use the page filters and match EMS exams
        via exam_scopes. Result identity is roll number → pin_no; papers by subjectCode.
      </p>

      {loading ? (
        <div className="rounded-lg border border-dashed border-border bg-card px-4 py-10 text-center text-sm text-slate-500">
          Loading results from EMS…
        </div>
      ) : null}

      {error ? (
        <Card>
          <p className="text-sm font-medium text-critical">Unable to load results</p>
          <p className="mt-1 text-sm text-slate-600">{error}</p>
        </Card>
      ) : null}

      {!loading && !error && total === 0 ? (
        <EmptyState
          title="No examination results available"
          description="EMS subject_results has no rows for the current filters. Results will appear here automatically once they are uploaded in EMS."
        />
      ) : null}

      {!loading && !error && rows.length > 0 ? (
        <DataTable
          columns={[
            {
              key: "student",
              header: "Student",
              render: (row) => (
                <div>
                  <p className="font-medium text-navy-900">
                    {row.studentName || row.student?.name || "—"}
                  </p>
                  {row.student?.id ? (
                    <Link
                      href={`/students/${row.student.id}`}
                      className="text-xs text-slate-500 hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Profile
                    </Link>
                  ) : null}
                </div>
              ),
            },
            {
              key: "roll",
              header: "Roll Number",
              render: (row) => (
                <span className="font-mono text-xs">{row.studentRollNumber || "—"}</span>
              ),
            },
            {
              key: "exam",
              header: "Exam",
              render: (row) => (
                <div>
                  <Link
                    href={`/results/${row.examId}`}
                    className="font-medium text-navy-900 hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {row.examName || `Exam ${row.examId}`}
                  </Link>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {row.examType ? <StatusBadge status={row.examType} /> : null}
                  </div>
                </div>
              ),
            },
            {
              key: "subject",
              header: "Subject",
              render: (row) => (
                <div>
                  <p className="font-medium text-navy-900">{row.subjectName || "—"}</p>
                  <p className="font-mono text-xs text-slate-500">{row.subjectCode}</p>
                </div>
              ),
            },
            {
              key: "grade",
              header: "Grade",
              render: (row) => <span className="font-semibold">{row.grade || "—"}</span>,
            },
            {
              key: "points",
              header: "Grade Points",
              render: (row) => formatPoints(row.gradePoints),
            },
            {
              key: "credits",
              header: "Credits",
              render: (row) => formatCredits(row.credits),
            },
            {
              key: "result",
              header: "Result",
              render: (row) => <StatusBadge status={row.result} />,
            },
          ]}
          rows={rows}
          rowKey={(row) => String(row.id)}
          emptyMessage="No examination results available."
        />
      ) : null}

      {!loading && !error && rows.length > 0 ? (
        <p className="mt-2 text-xs text-slate-500">
          Showing {rows.length}
          {total > rows.length ? ` of ${total}` : ""} result row{total === 1 ? "" : "s"} from EMS
          subject_results.
        </p>
      ) : null}
    </div>
  );
}
