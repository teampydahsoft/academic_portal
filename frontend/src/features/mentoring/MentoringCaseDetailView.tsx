"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { DataTable } from "@/components/ui/DataTable";
import { apiFetch } from "@/lib/api";
import { InterventionDialog } from "./InterventionDialog";
import { InterventionTimeline } from "./InterventionTimeline";
import { MentorAssignDialog } from "./MentorAssignDialog";
import type { MentoringStudentDetail, RiskCaseStatus } from "./types";
import { formatComplaintStatus, formatDateTime } from "./utils";

type Props = { caseId: string };

export function MentoringCaseDetailView({ caseId }: Props) {
  const [detail, setDetail] = useState<MentoringStudentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [interventionOpen, setInterventionOpen] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch(`/mentoring/students/${encodeURIComponent(caseId)}`, {
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 404) {
        setDetail(null);
        return;
      }
      if (!response.ok) {
        throw new Error(
          typeof body === "object" && body && "message" in body
            ? String((body as { message: string }).message)
            : `Failed to load (${response.status})`,
        );
      }
      setDetail(body as MentoringStudentDetail);
    } catch (err) {
      setDetail(null);
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createCase() {
    if (!detail) return;
    setActionBusy(true);
    setActionError(null);
    try {
      const response = await apiFetch("/mentoring/risk-cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentDbId: Number(detail.student.id) }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((body as { message?: string }).message ?? "Unable to create complaint");
      }
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Unable to create complaint");
    } finally {
      setActionBusy(false);
    }
  }

  async function updateCaseStatus(status: RiskCaseStatus) {
    if (!detail?.activeCase) return;
    setActionBusy(true);
    setActionError(null);
    try {
      const response = await apiFetch(`/mentoring/risk-cases/${detail.activeCase.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((body as { message?: string }).message ?? "Unable to update complaint");
      }
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Unable to update complaint");
    } finally {
      setActionBusy(false);
    }
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="Student risk detail" description="Loading…" />
        <Card>
          <p className="text-sm text-slate-500">Loading student risk context…</p>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="Student risk detail" description="Unable to load." />
        <Card>
          <p className="text-sm text-critical">{error}</p>
        </Card>
      </div>
    );
  }

  if (!detail) {
    return (
      <div>
        <PageHeader title="Student risk detail" description="Student not found or not in scope." />
        <EmptyState
          title="Student not found"
          description="This student is not available in your mentoring scope."
          action={
            <Link href="/mentoring-risks">
              <Button variant="secondary">Back to Mentoring & Risks</Button>
            </Link>
          }
        />
      </div>
    );
  }

  const { student, attendance, mentor, activeCase, permissions } = detail;

  return (
    <div>
      <PageHeader
        title={student.name}
        description={[student.college, student.course, student.branch].filter(Boolean).join(" · ")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/mentoring-risks">
              <Button variant="ghost" size="sm">
                Back
              </Button>
            </Link>
            <Link href={`/students/${student.id}`}>
              <Button variant="secondary" size="sm">
                Student profile
              </Button>
            </Link>
          </div>
        }
      />

      {actionError ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-critical">
          {actionError}
        </div>
      ) : null}

      <Card className="mb-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <StatusBadge status={attendance.risk} />
          {activeCase ? <StatusBadge status={formatComplaintStatus(activeCase.status)} /> : null}
        </div>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Roll / Adm.</dt>
            <dd className="mt-0.5 font-medium text-navy-900">{student.rollNo || student.admissionNo}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Year / Sem</dt>
            <dd className="mt-0.5 font-medium text-navy-900">
              {student.year ?? "—"} / {student.semester ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Section</dt>
            <dd className="mt-0.5 font-medium text-navy-900">{student.section ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Current mentor</dt>
            <dd className="mt-0.5 font-medium text-navy-900">{mentor?.name ?? "Not assigned"}</dd>
          </div>
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          {permissions.canAssign ? (
            <Button size="sm" variant="secondary" onClick={() => setAssignOpen(true)} disabled={actionBusy}>
              {mentor ? "Change mentor" : "Assign mentor"}
            </Button>
          ) : null}
          {permissions.canManageCase && !activeCase ? (
            <Button size="sm" onClick={() => void createCase()} disabled={actionBusy}>
              Create complaint
            </Button>
          ) : null}
          {permissions.canManageCase && activeCase?.status === "open" ? (
            <Button size="sm" variant="secondary" onClick={() => void updateCaseStatus("monitoring")} disabled={actionBusy}>
              Start monitoring
            </Button>
          ) : null}
          {permissions.canEscalate && activeCase && activeCase.status !== "escalated" && activeCase.status !== "resolved" ? (
            <Button size="sm" variant="secondary" onClick={() => void updateCaseStatus("escalated")} disabled={actionBusy}>
              Escalate
            </Button>
          ) : null}
          {permissions.canManageCase && activeCase && activeCase.status !== "resolved" ? (
            <Button size="sm" onClick={() => void updateCaseStatus("resolved")} disabled={actionBusy}>
              Resolve complaint
            </Button>
          ) : null}
          {permissions.canIntervene && activeCase ? (
            <Button size="sm" variant="secondary" onClick={() => setInterventionOpen(true)} disabled={actionBusy}>
              Add intervention
            </Button>
          ) : null}
        </div>
      </Card>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-navy-900">Attendance overview</h2>
          <dl className="mb-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-slate-500">Semester attendance</dt>
              <dd className="text-lg font-semibold text-navy-900">{attendance.overall.toFixed(1)}%</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Present / Absent</dt>
              <dd className="font-medium text-navy-900">
                {attendance.present} / {attendance.absent}
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs text-slate-500">Risk reason</dt>
              <dd className="font-medium text-navy-900">{attendance.riskReason}</dd>
            </div>
            {attendance.period ? (
              <div className="col-span-2">
                <dt className="text-xs text-slate-500">Period</dt>
                <dd className="font-medium text-navy-900">{attendance.period.label}</dd>
              </div>
            ) : null}
          </dl>
          {attendance.subjects.length > 0 ? (
            <div className="hidden sm:block">
              <DataTable
                rows={attendance.subjects}
                rowKey={(row) => `${row.subjectCode ?? ""}-${row.subjectName}`}
                emptyMessage="No subject attendance"
                columns={[
                  { key: "subject", header: "Subject", render: (row) => row.subjectName },
                  {
                    key: "attendance",
                    header: "Attendance",
                    render: (row) => `${row.attendance.toFixed(1)}%`,
                  },
                  { key: "risk", header: "Risk", render: (row) => <StatusBadge status={row.risk} /> },
                ]}
              />
            </div>
          ) : (
            <p className="text-sm text-slate-500">Subject-wise attendance will appear when class attendance is posted.</p>
          )}
          {attendance.subjects.length > 0 ? (
            <div className="mt-3 space-y-2 sm:hidden">
              {attendance.subjects.map((row) => (
                <div key={`${row.subjectCode}-${row.subjectName}`} className="rounded-md border border-border px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-navy-900">{row.subjectName}</span>
                    <StatusBadge status={row.risk} />
                  </div>
                  <p className="text-xs text-slate-500">{row.attendance.toFixed(1)}% attendance</p>
                </div>
              ))}
            </div>
          ) : null}
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-semibold text-navy-900">Complaint</h2>
          {activeCase ? (
            <dl className="grid gap-3 text-sm">
              <div>
                <dt className="text-xs text-slate-500">Status</dt>
                <dd className="font-medium">{formatComplaintStatus(activeCase.status)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Opened</dt>
                <dd className="font-medium">{formatDateTime(activeCase.openedAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Severity</dt>
                <dd className="font-medium capitalize">{activeCase.severity}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Risk reason</dt>
                <dd className="font-medium">{activeCase.riskReason ?? attendance.riskReason}</dd>
              </div>
              {activeCase.escalatedAt ? (
                <div>
                  <dt className="text-xs text-slate-500">Escalated</dt>
                  <dd className="font-medium">{formatDateTime(activeCase.escalatedAt)}</dd>
                </div>
              ) : null}
            </dl>
          ) : (
            <p className="text-sm text-slate-500">No active complaint. Create one to start tracking interventions.</p>
          )}
        </Card>
      </div>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-navy-900">Intervention timeline</h2>
        <InterventionTimeline interventions={detail.interventions} caseEvents={detail.caseEvents} />
      </Card>

      <MentorAssignDialog
        open={assignOpen}
        studentId={Number(student.id)}
        studentName={student.name}
        onClose={() => setAssignOpen(false)}
        onAssigned={() => void load()}
      />

      {activeCase ? (
        <InterventionDialog
          open={interventionOpen}
          caseId={activeCase.id}
          onClose={() => setInterventionOpen(false)}
          onSaved={() => void load()}
        />
      ) : null}
    </div>
  );
}
