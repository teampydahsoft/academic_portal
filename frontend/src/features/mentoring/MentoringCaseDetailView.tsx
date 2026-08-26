"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { apiFetch } from "@/lib/api";
import type { StudentDetail } from "@/features/students/student-types";

type Props = { caseId: string };

export function MentoringCaseDetailView({ caseId }: Props) {
  const [student, setStudent] = useState<StudentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      setStudent(null);
      try {
        const response = await apiFetch(`/students/${encodeURIComponent(caseId)}`, {
          cache: "no-store",
        });
        const body = await response.json().catch(() => ({}));
        if (response.status === 404) {
          if (!cancelled) setStudent(null);
          return;
        }
        if (!response.ok) {
          throw new Error(
            typeof body === "object" && body && "message" in body
              ? String((body as { message: string }).message)
              : `Failed to load student (${response.status})`,
          );
        }
        if (!cancelled) setStudent(body as StudentDetail);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  if (loading) {
    return (
      <div>
        <PageHeader title="Risk case" description="Loading…" />
        <Card>
          <p className="text-sm text-slate-500">Loading student risk context…</p>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="Risk case" description="Unable to load case context." />
        <Card>
          <p className="text-sm text-critical">{error}</p>
        </Card>
      </div>
    );
  }

  if (!student) {
    return (
      <div>
        <PageHeader
          title="Mentoring case"
          description="Formal mentoring case records are not available yet."
        />
        <EmptyState
          title="No mentoring case found"
          description="There is no formal risk-case or mentor-assignment record for this reference. Attendance-risk students are listed on Mentoring & Risks and open from the student register."
          action={
            <Link href="/mentoring-risks">
              <Button variant="secondary">Back to Mentoring & Risks</Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={student.name}
        description="Attendance-risk context from the student register. Formal intervention timelines are not available yet."
        actions={
          <Link href={`/students/${student.id}`}>
            <Button variant="secondary">Open student profile</Button>
          </Link>
        }
      />
      <Card className="mb-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <StatusBadge status={student.risk} />
          <StatusBadge status="Open" />
          <span className="text-xs text-slate-500">Category: Attendance risk</span>
        </div>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Roll / Adm.</dt>
            <dd className="mt-0.5 font-medium text-navy-900">
              {student.rollNo || student.admissionNo || "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Section</dt>
            <dd className="mt-0.5 font-medium text-navy-900">
              {[student.branch, student.section].filter(Boolean).join(" · ") || "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Attendance</dt>
            <dd className="mt-0.5 font-medium text-navy-900">
              {Number(student.attendance ?? 0).toFixed(1)}%
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Present / Absent</dt>
            <dd className="mt-0.5 font-medium text-navy-900">
              {student.present} / {student.absent}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Assigned mentor</dt>
            <dd className="mt-0.5 text-slate-500">Not available yet</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Period</dt>
            <dd className="mt-0.5 font-medium text-navy-900">
              {student.attendancePeriod?.label || "—"}
            </dd>
          </div>
        </dl>
      </Card>
      <EmptyState
        title="Intervention timeline not available"
        description="Mentor assignments and intervention actions require the mentoring case API, which is not connected yet."
        action={
          <Link href="/mentoring-risks">
            <Button variant="secondary">Back to list</Button>
          </Link>
        }
      />
    </div>
  );
}
