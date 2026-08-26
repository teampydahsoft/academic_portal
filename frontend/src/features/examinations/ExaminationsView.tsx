"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterBar, FilterField } from "@/components/ui/FilterBar";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAcademicContext } from "@/components/layout/AcademicProvider";
import { apiFetch } from "@/lib/api";
import {
  isoToDisplay,
  type ExaminationListItem,
  type ExaminationListResponse,
  type ExaminationOptions,
  type StudentExaminationsResponse,
} from "@/features/examinations/exam-types";

const selectClassName =
  "h-9 min-w-[140px] rounded-md border border-border bg-white px-2 text-sm text-foreground outline-none focus:border-navy-800";

const searchClassName =
  "h-9 w-full min-w-[200px] rounded-md border border-border bg-white px-3 text-sm text-foreground outline-none focus:border-navy-800";

function yearSem(row: ExaminationListItem) {
  if (row.yearOfStudy == null && row.semester == null) return "—";
  if (row.yearOfStudy != null && row.semester != null) {
    return `Y${row.yearOfStudy} · Sem ${row.semester}`;
  }
  if (row.yearOfStudy != null) return `Year ${row.yearOfStudy}`;
  return `Semester ${row.semester}`;
}

function dateRange(start: string | null, end: string | null) {
  if (!start && !end) return "—";
  if (start && end && start !== end) return `${isoToDisplay(start)} – ${isoToDisplay(end)}`;
  return isoToDisplay(start || end);
}

export function ExaminationsView() {
  const { filters } = useAcademicContext();
  const [options, setOptions] = useState<ExaminationOptions | null>(null);
  const [rows, setRows] = useState<ExaminationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [regulationId, setRegulationId] = useState("all");
  const [status, setStatus] = useState("all");
  const [type, setType] = useState("all");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [rollDraft, setRollDraft] = useState("");
  const [studentView, setStudentView] = useState<StudentExaminationsResponse | null>(null);
  const [studentError, setStudentError] = useState<string | null>(null);
  const [studentLoading, setStudentLoading] = useState(false);

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
    if (regulationId !== "all") params.set("regulationId", regulationId);
    if (status !== "all") params.set("status", status);
    if (type !== "all") params.set("type", type);
    if (search) params.set("q", search);
    return params.toString();
  }, [filters, regulationId, status, type, search]);

  useEffect(() => {
    let cancelled = false;
    async function loadOptions() {
      try {
        const response = await apiFetch(`/examinations/options`, { cache: "no-store" });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || cancelled) return;
        setOptions(body as ExaminationOptions);
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
        const response = await apiFetch(`/examinations?${query}`, { cache: "no-store" });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            typeof body?.message === "string" ? body.message : "Failed to load examinations",
          );
        }
        if (!cancelled) setRows((body as ExaminationListResponse).data ?? []);
      } catch (err) {
        if (!cancelled) {
          setRows([]);
          setError(err instanceof Error ? err.message : "Failed to load examinations");
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

  async function lookupStudent(event: React.FormEvent) {
    event.preventDefault();
    const rollNumber = rollDraft.trim();
    if (!rollNumber) return;
    setStudentLoading(true);
    setStudentError(null);
    try {
      const params = new URLSearchParams({ rollNumber });
      const response = await apiFetch(`/examinations/for-student?${params}`, {
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof body?.message === "string" ? body.message : "Student not found",
        );
      }
      setStudentView(body as StudentExaminationsResponse);
    } catch (err) {
      setStudentView(null);
      setStudentError(err instanceof Error ? err.message : "Student lookup failed");
    } finally {
      setStudentLoading(false);
    }
  }

  const publishedCount = rows.filter((row) => row.status?.toLowerCase() === "published").length;
  const applicationCount = rows.reduce((sum, row) => sum + row.applicationCount, 0);

  return (
    <div>
      <PageHeader
        title="Examinations"
        description="Read-only examinations from EMS. Regulations, exams, scopes, papers, and applications stay in examination_portal."
        actions={
          <span className="inline-flex items-center rounded-full border border-border bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
            Read-only · EMS
          </span>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Exams" value={loading ? "—" : rows.length} />
        <StatCard label="Published" value={loading ? "—" : publishedCount} tone="success" />
        <StatCard label="Applications" value={loading ? "—" : applicationCount} />
        <StatCard label="Source" value="EMS" tone="info" />
      </div>

      <FilterBar>
        <FilterField label="Search">
          <input
            type="search"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="Exam name, course, branch, regulation"
            className={searchClassName}
            aria-label="Search examinations"
          />
        </FilterField>
        <FilterField label="Regulation">
          <select
            className={selectClassName}
            value={regulationId}
            onChange={(e) => setRegulationId(e.target.value)}
          >
            <option value="all">All regulations</option>
            {(options?.regulations ?? []).map((regulation) => (
              <option key={regulation.id} value={regulation.id}>
                {regulation.code}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Exam status">
          <select
            className={selectClassName}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">All statuses</option>
            {(options?.statuses ?? []).map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Exam type">
          <select
            className={selectClassName}
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="all">All types</option>
            {(options?.types ?? []).map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </FilterField>
      </FilterBar>
      <p className="mb-4 text-xs text-slate-500">
        College, course, branch, batch, year, and semester use the page filters and match EMS
        exam_scopes via Student DB names/ids. Academic year is not an EMS exam field.
      </p>

      <Card className="mb-4">
        <h2 className="text-base font-semibold text-navy-900">Student exam view</h2>
        <p className="mt-1 text-xs text-slate-500">
          Resolve the student from Student DB, then show eligible EMS exams and registered subjects.
        </p>
        <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={lookupStudent}>
          <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs font-medium text-slate-500">
            Roll number
            <input
              value={rollDraft}
              onChange={(e) => setRollDraft(e.target.value)}
              placeholder="e.g. 256T1DAH18"
              className={searchClassName}
            />
          </label>
          <Button type="submit" size="sm" disabled={studentLoading || !rollDraft.trim()}>
            {studentLoading ? "Looking up…" : "Look up"}
          </Button>
        </form>
        {studentError ? <p className="mt-2 text-sm text-critical">{studentError}</p> : null}
        {studentView ? (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-slate-700">
              <span className="font-semibold text-navy-900">{studentView.student.name}</span>
              {" · "}
              {studentView.student.rollNumber || studentView.student.admissionNo}
              {" · "}
              {[studentView.student.course, studentView.student.branch, studentView.student.batch]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Eligible exams
                </p>
                {studentView.eligibleExams.length === 0 ? (
                  <p className="text-sm text-slate-500">No EMS exam scopes match this student.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {studentView.eligibleExams.map((exam) => (
                      <li key={exam.id}>
                        <Link href={`/examinations/${exam.id}`} className="text-navy-900 hover:underline">
                          {exam.name}
                        </Link>
                        <span className="text-slate-500">
                          {" "}
                          · {exam.type} · {exam.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Registered subjects
                </p>
                {studentView.applications.length === 0 ? (
                  <p className="text-sm text-slate-500">No EMS applications for this roll number.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {studentView.applications.map((application) => (
                      <li key={application.id}>
                        <Link
                          href={`/examinations/${application.examId}`}
                          className="font-medium text-navy-900 hover:underline"
                        >
                          {application.exam?.name ?? `Exam ${application.examId}`}
                        </Link>
                        <p className="text-xs text-slate-600">
                          {application.selectedSubjects
                            .map((subject) => subject.subjectCode || subject.subjectName)
                            .filter(Boolean)
                            .join(", ") || "No subjects listed"}
                          {application.feeStatus ? ` · ${application.feeStatus}` : ""}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </Card>

      {error ? (
        <Card>
          <p className="text-sm font-medium text-critical">Unable to load examinations</p>
          <p className="mt-1 text-sm text-slate-600">{error}</p>
        </Card>
      ) : null}

      {loading ? (
        <div className="rounded-lg border border-dashed border-border bg-card px-4 py-10 text-center text-sm text-slate-500">
          Loading examinations from EMS…
        </div>
      ) : null}

      {!loading && !error && rows.length === 0 ? (
        <EmptyState
          title="No examinations"
          description="No EMS exams match the current filters. Examinations are created in EMS, not here."
        />
      ) : null}

      {!loading && !error && rows.length > 0 ? (
        <DataTable
          rows={rows}
          rowKey={(row) => String(row.id)}
          columns={[
            {
              key: "exam",
              header: "Exam",
              render: (row) => (
                <div>
                  <Link
                    href={`/examinations/${row.id}`}
                    className="font-medium text-navy-900 hover:underline"
                  >
                    {row.name}
                  </Link>
                  <p className="text-xs text-slate-500">
                    {row.college || "—"} · {row.course || "—"} · {row.branch || "—"}
                  </p>
                </div>
              ),
            },
            {
              key: "type",
              header: "Type",
              render: (row) => (row.type ? <StatusBadge status={row.type} /> : "—"),
            },
            {
              key: "regulation",
              header: "Regulation",
              render: (row) => row.regulationCode || "—",
            },
            {
              key: "batch",
              header: "Batch",
              render: (row) => row.batch || "—",
            },
            {
              key: "yearSem",
              header: "Year / Sem",
              render: (row) => yearSem(row),
            },
            {
              key: "dates",
              header: "Exam dates",
              render: (row) => (
                <span className="text-slate-600">
                  {dateRange(row.examinationStartDate, row.examinationEndDate)}
                </span>
              ),
            },
            {
              key: "status",
              header: "Status",
              render: (row) => (row.status ? <StatusBadge status={row.status} /> : "—"),
            },
            {
              key: "papers",
              header: "Papers",
              render: (row) => row.subjectCount,
            },
            {
              key: "apps",
              header: "Applications",
              render: (row) => row.applicationCount,
            },
          ]}
        />
      ) : null}
    </div>
  );
}
