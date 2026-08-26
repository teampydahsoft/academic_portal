"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { apiFetch } from "@/lib/api";
import {
  formatFee,
  isoToDisplay,
  type ExaminationDetailResponse,
} from "@/features/examinations/exam-types";

type Props = { examId: string };

function yearSem(year: number | null, semester: number | null) {
  if (year == null && semester == null) return "—";
  if (year != null && semester != null) return `Year ${year} · Semester ${semester}`;
  if (year != null) return `Year ${year}`;
  return `Semester ${semester}`;
}

export function ExaminationDetailView({ examId }: Props) {
  const [payload, setPayload] = useState<ExaminationDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"papers" | "scopes" | "applications">("papers");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await apiFetch(`/examinations/${encodeURIComponent(examId)}`, {
          cache: "no-store",
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            typeof body?.message === "string" ? body.message : "Failed to load examination",
          );
        }
        if (!cancelled) setPayload(body as ExaminationDetailResponse);
      } catch (err) {
        if (!cancelled) {
          setPayload(null);
          setError(err instanceof Error ? err.message : "Failed to load examination");
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
        <PageHeader title="Examination" description="Loading from EMS…" />
        <div className="rounded-lg border border-dashed border-border bg-card px-4 py-10 text-center text-sm text-slate-500">
          Loading examination…
        </div>
      </div>
    );
  }

  if (error || !payload) {
    return (
      <div>
        <PageHeader
          title="Examination"
          actions={
            <Link href="/examinations">
              <Button size="sm" variant="secondary">
                Back to examinations
              </Button>
            </Link>
          }
        />
        <Card>
          <p className="text-sm font-medium text-critical">Unable to load examination</p>
          <p className="mt-1 text-sm text-slate-600">{error ?? "Not found"}</p>
        </Card>
      </div>
    );
  }

  const { exam, scopes, subjects, applications } = payload;
  const facts = [
    { label: "Exam", value: exam.name },
    { label: "Type", value: exam.type || "—" },
    { label: "Status", value: exam.status || "—" },
    { label: "Regulation", value: exam.regulationCode || exam.regulationName || "—" },
    { label: "College", value: exam.college || "—" },
    { label: "Course", value: exam.course || "—" },
    { label: "Branch", value: exam.branch || "—" },
    { label: "Batch", value: exam.batch || "—" },
    { label: "Year / Semester", value: yearSem(exam.yearOfStudy, exam.semester) },
    {
      label: "Exam dates",
      value:
        exam.examinationStartDate || exam.examinationEndDate
          ? `${isoToDisplay(exam.examinationStartDate)} – ${isoToDisplay(exam.examinationEndDate)}`
          : "—",
    },
    {
      label: "Applications window",
      value:
        exam.applicationStartDate || exam.applicationEndDate
          ? `${isoToDisplay(exam.applicationStartDate)} – ${isoToDisplay(exam.applicationEndDate)}`
          : "—",
    },
    {
      label: "Package fee",
      value: formatFee(exam.packageFee),
    },
  ];

  return (
    <div>
      <PageHeader
        title={exam.name}
        description={`${exam.regulationName || exam.regulationCode || "EMS exam"} · Read-only from examination_portal.`}
        actions={
          <div className="flex items-center gap-2">
            {exam.status ? <StatusBadge status={exam.status} /> : null}
            {exam.type ? <StatusBadge status={exam.type} /> : null}
            <Link href={`/results/${exam.id}`}>
              <Button size="sm" variant="secondary">
                Results
              </Button>
            </Link>
            <Link href="/examinations">
              <Button size="sm" variant="secondary">
                Back
              </Button>
            </Link>
          </div>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {facts.map((fact) => (
          <Card key={fact.label} className="py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {fact.label}
            </p>
            <p className="mt-1 text-sm font-semibold text-navy-900">{fact.value}</p>
          </Card>
        ))}
      </div>

      {exam.instructions ? (
        <Card className="mb-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Instructions</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{exam.instructions}</p>
        </Card>
      ) : null}

      <div className="mb-3 flex flex-wrap gap-2">
        {(
          [
            ["papers", `Exam papers (${subjects.length})`],
            ["scopes", `Eligible scope (${scopes.length})`],
            ["applications", `Applications (${applications.length})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={
              tab === key
                ? "rounded-md bg-navy-900 px-3 py-1.5 text-sm font-medium text-white"
                : "rounded-md border border-border bg-card px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            }
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "papers" ? (
        subjects.length === 0 ? (
          <EmptyState
            title="No exam papers"
            description="No rows in EMS exam_subjects for this examination."
          />
        ) : (
          <DataTable
            rows={subjects}
            rowKey={(row) => String(row.id)}
            columns={[
              {
                key: "code",
                header: "Subject code",
                render: (row) => (
                  <span className="font-medium text-navy-900">{row.subjectCode || "—"}</span>
                ),
              },
              {
                key: "name",
                header: "Subject name",
                render: (row) => row.subjectName || "—",
              },
              {
                key: "type",
                header: "Type",
                render: (row) => (row.type ? <StatusBadge status={row.type} /> : "—"),
              },
              {
                key: "date",
                header: "Exam date",
                render: (row) => isoToDisplay(row.examDate),
              },
              {
                key: "fee",
                header: "Fee",
                render: (row) => formatFee(row.fee),
              },
              {
                key: "branch",
                header: "Branch",
                render: (row) => row.branch || "—",
              },
              {
                key: "session",
                header: "Session",
                render: (row) =>
                  [row.session, row.startTime && row.endTime ? `${row.startTime}–${row.endTime}` : null]
                    .filter(Boolean)
                    .join(" · ") || "—",
              },
            ]}
          />
        )
      ) : null}

      {tab === "scopes" ? (
        scopes.length === 0 ? (
          <EmptyState
            title="No exam scopes"
            description="No rows in EMS exam_scopes for this examination."
          />
        ) : (
          <DataTable
            rows={scopes}
            rowKey={(row) => String(row.id)}
            columns={[
              { key: "college", header: "College", render: (row) => row.college || "—" },
              { key: "course", header: "Course", render: (row) => row.course || "—" },
              { key: "branch", header: "Branch", render: (row) => row.branch || "—" },
              { key: "batch", header: "Batch", render: (row) => row.batch || "—" },
              {
                key: "year",
                header: "Year",
                render: (row) => (row.yearOfStudy != null ? String(row.yearOfStudy) : "—"),
              },
              {
                key: "semester",
                header: "Semester",
                render: (row) => (row.semester != null ? String(row.semester) : "—"),
              },
              { key: "section", header: "Section", render: (row) => row.section || "—" },
            ]}
          />
        )
      ) : null}

      {tab === "applications" ? (
        applications.length === 0 ? (
          <EmptyState
            title="No applications"
            description="No EMS exam_applications for this examination."
          />
        ) : (
          <DataTable
            rows={applications}
            rowKey={(row) => String(row.id)}
            columns={[
              {
                key: "roll",
                header: "Roll number",
                render: (row) => (
                  <span className="font-medium text-navy-900">{row.studentRollNumber || "—"}</span>
                ),
              },
              { key: "name", header: "Student", render: (row) => row.studentName || "—" },
              { key: "branch", header: "Branch", render: (row) => row.studentBranch || "—" },
              {
                key: "subjects",
                header: "Registered subjects",
                render: (row) => (
                  <span className="text-slate-600">
                    {row.selectedSubjects
                      .map((subject) => subject.subjectCode || subject.subjectName)
                      .filter(Boolean)
                      .join(", ") || "—"}
                  </span>
                ),
              },
              {
                key: "fee",
                header: "Fee status",
                render: (row) =>
                  row.feeStatus ? <StatusBadge status={row.feeStatus} /> : "—",
              },
              {
                key: "amount",
                header: "Amount",
                render: (row) => formatFee(row.totalAmount),
              },
              {
                key: "submitted",
                header: "Submitted",
                render: (row) => isoToDisplay(row.submittedAt),
              },
            ]}
          />
        )
      ) : null}
    </div>
  );
}
