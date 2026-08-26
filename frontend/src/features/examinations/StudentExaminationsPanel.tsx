"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { apiFetch } from "@/lib/api";
import type { StudentExaminationsResponse } from "@/features/examinations/exam-types";

type Props = { studentId: string };

export function StudentExaminationsPanel({ studentId }: Props) {
  const [payload, setPayload] = useState<StudentExaminationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ studentId });
        const response = await apiFetch(`/examinations/for-student?${params}`, {
          cache: "no-store",
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            typeof body?.message === "string" ? body.message : "Failed to load examinations",
          );
        }
        if (!cancelled) setPayload(body as StudentExaminationsResponse);
      } catch (err) {
        if (!cancelled) {
          setPayload(null);
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
  }, [studentId]);

  return (
    <Card className="mt-4">
      <h2 className="text-base font-semibold text-navy-900">Examinations</h2>
      <p className="mt-0.5 text-xs text-slate-500">
        Eligible exams from EMS exam_scopes. Registrations from EMS exam_applications (roll number).
      </p>
      {loading ? (
        <p className="mt-3 text-sm text-slate-500">Loading examinations…</p>
      ) : null}
      {error ? <p className="mt-3 text-sm text-critical">{error}</p> : null}
      {payload ? (
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Eligible exams
            </p>
            {payload.eligibleExams.length === 0 ? (
              <p className="text-sm text-slate-500">No matching EMS exam scopes.</p>
            ) : (
              <ul className="space-y-2">
                {payload.eligibleExams.map((exam) => (
                  <li key={exam.id} className="text-sm">
                    <Link href={`/examinations/${exam.id}`} className="font-medium text-navy-900 hover:underline">
                      {exam.name}
                    </Link>
                    <span className="ml-2 inline-flex gap-1">
                      {exam.type ? <StatusBadge status={exam.type} /> : null}
                      {exam.status ? <StatusBadge status={exam.status} /> : null}
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
            {payload.applications.length === 0 ? (
              <p className="text-sm text-slate-500">No EMS applications for this roll number.</p>
            ) : (
              <ul className="space-y-2">
                {payload.applications.map((application) => (
                  <li key={application.id} className="text-sm">
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
                        .join(", ") || "—"}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </Card>
  );
}
