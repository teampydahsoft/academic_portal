"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatCard } from "@/components/ui/StatCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { apiFetch } from "@/lib/api";
import {
  formatCredits,
  formatPoints,
  type ExamResultsResponse,
} from "@/features/results/result-types";

type Props = { examId: string };

function yearSem(year: number | null, semester: number | null) {
  if (year == null && semester == null) return "—";
  if (year != null && semester != null) return `Year ${year} · Semester ${semester}`;
  if (year != null) return `Year ${year}`;
  return `Semester ${semester}`;
}

export function ExamResultsView({ examId }: Props) {
  const [payload, setPayload] = useState<ExamResultsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await apiFetch(`/results/${encodeURIComponent(examId)}`, {
          cache: "no-store",
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            typeof body?.message === "string" ? body.message : "Failed to load exam results",
          );
        }
        if (!cancelled) setPayload(body as ExamResultsResponse);
      } catch (err) {
        if (!cancelled) {
          setPayload(null);
          setError(err instanceof Error ? err.message : "Failed to load exam results");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [examId]);

  if (loading) {
    return (
      <div>
        <PageHeader title="Exam results" description="Loading from EMS…" />
        <div className="rounded-lg border border-dashed border-border bg-card px-4 py-10 text-center text-sm text-slate-500">
          Loading examination results…
        </div>
      </div>
    );
  }

  if (error || !payload) {
    return (
      <div>
        <PageHeader
          title="Exam results"
          actions={
            <Link href="/results">
              <Button size="sm" variant="secondary">
                Back to results
              </Button>
            </Link>
          }
        />
        <Card>
          <p className="text-sm font-medium text-critical">Unable to load exam results</p>
          <p className="mt-1 text-sm text-slate-600">{error ?? "Not found"}</p>
        </Card>
      </div>
    );
  }

  const { exam, resultCount, summary, uploads, data } = payload;

  return (
    <div>
      <PageHeader
        title={exam.name}
        description="Results from EMS subject_results for this examination. Exam status is not result publication."
        actions={
          <div className="flex items-center gap-2">
            {exam.type ? <StatusBadge status={exam.type} /> : null}
            {exam.status ? <StatusBadge status={exam.status} /> : null}
            <Link href={`/examinations/${exam.id}`}>
              <Button size="sm" variant="secondary">
                Exam detail
              </Button>
            </Link>
            <Link href="/results">
              <Button size="sm" variant="secondary">
                Back
              </Button>
            </Link>
          </div>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Course / Branch</p>
          <p className="mt-1 text-sm font-semibold text-navy-900">
            {[exam.course, exam.branch].filter(Boolean).join(" · ") || "—"}
          </p>
        </Card>
        <Card className="py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Batch</p>
          <p className="mt-1 text-sm font-semibold text-navy-900">{exam.batch || "—"}</p>
        </Card>
        <Card className="py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Year / Semester</p>
          <p className="mt-1 text-sm font-semibold text-navy-900">
            {yearSem(exam.yearOfStudy, exam.semester)}
          </p>
        </Card>
        <Card className="py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Result rows</p>
          <p className="mt-1 text-sm font-semibold text-navy-900">{resultCount}</p>
        </Card>
      </div>

      {summary ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard label="Result rows" value={summary.totalRows} />
          <StatCard label="Students" value={summary.uniqueStudents} />
          <StatCard label="Passed" value={summary.passed} tone="success" />
          <StatCard label="Failed" value={summary.failed} tone="critical" />
          <StatCard label="Pass %" value={`${summary.passPercentage}%`} tone="info" />
        </div>
      ) : null}

      {uploads.length > 0 ? (
        <Card className="mb-4">
          <h2 className="text-sm font-semibold text-navy-900">Result uploads</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Upload metadata from EMS result_uploads (not the result source of truth).
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            {uploads.map((upload) => (
              <li key={upload.id} className="flex flex-wrap gap-x-3 gap-y-1 text-slate-700">
                <span className="font-medium text-navy-900">
                  {upload.fileName || `Upload #${upload.id}`}
                </span>
                <span>by {upload.uploadedBy || "—"}</span>
                <span>{upload.createdAt || "—"}</span>
                <span>
                  {upload.rowCount ?? 0} rows · {upload.studentCount ?? 0} students
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {resultCount === 0 ? (
        <EmptyState
          title="Results have not been uploaded for this examination."
          description="EMS subject_results has no rows for this exam yet. When results are uploaded in EMS, they will appear here automatically."
        />
      ) : (
        <DataTable
          columns={[
            {
              key: "student",
              header: "Student",
              render: (row) => row.studentName || row.student?.name || "—",
            },
            {
              key: "roll",
              header: "Roll Number",
              render: (row) => (
                <span className="font-mono text-xs">{row.studentRollNumber || "—"}</span>
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
              header: "Pass/Fail",
              render: (row) => <StatusBadge status={row.result} />,
            },
            {
              key: "attempt",
              header: "Attempt",
              render: (row) => String(row.attemptNumber ?? 1),
            },
            {
              key: "examType",
              header: "Exam Type",
              render: (row) =>
                row.examType ? <StatusBadge status={row.examType} /> : "—",
            },
          ]}
          rows={data}
          rowKey={(row) => String(row.id)}
          emptyMessage="Results have not been uploaded for this examination."
        />
      )}
    </div>
  );
}
