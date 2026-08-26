"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { apiFetch } from "@/lib/api";
import {
  formatCredits,
  formatPoints,
  type StudentResultsResponse,
} from "@/features/results/result-types";

type Props = {
  rollNumber: string | null;
};

function yearSem(year: number | null, semester: number | null) {
  if (year == null && semester == null) return null;
  if (year != null && semester != null) return `Y${year} · Sem ${semester}`;
  if (year != null) return `Year ${year}`;
  return `Semester ${semester}`;
}

export function StudentResultsPanel({ rollNumber }: Props) {
  const [payload, setPayload] = useState<StudentResultsResponse | null>(null);
  const [loading, setLoading] = useState(Boolean(rollNumber));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!rollNumber?.trim()) {
        setPayload(null);
        setLoading(false);
        setError(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const response = await apiFetch(`/results/student/${encodeURIComponent(rollNumber.trim())}`,
          { cache: "no-store" },
        );
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            typeof body?.message === "string" ? body.message : "Failed to load results",
          );
        }
        if (!cancelled) setPayload(body as StudentResultsResponse);
      } catch (err) {
        if (!cancelled) {
          setPayload(null);
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
  }, [rollNumber]);

  return (
    <Card className="mt-4">
      <h2 className="text-base font-semibold text-navy-900">Results</h2>
      <p className="mt-0.5 text-xs text-slate-500">
        EMS subject_results matched by roll number (pin_no). Grades and pass/fail only — no numeric
        marks.
      </p>

      {!rollNumber?.trim() ? (
        <p className="mt-3 text-sm text-slate-500">
          No examination results available. This student has no roll number (pin_no) to match EMS
          results.
        </p>
      ) : null}

      {loading ? <p className="mt-3 text-sm text-slate-500">Loading results…</p> : null}
      {error ? <p className="mt-3 text-sm text-critical">{error}</p> : null}

      {!loading && !error && payload && payload.resultCount === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No examination results available.</p>
      ) : null}

      {!loading && !error && payload && payload.resultCount > 0 ? (
        <div className="mt-3 space-y-4">
          {payload.summary ? (
            <p className="text-xs text-slate-600">
              {payload.summary.totalRows} subject result
              {payload.summary.totalRows === 1 ? "" : "s"} · Passed {payload.summary.passed} · Failed{" "}
              {payload.summary.failed}
              {payload.summary.totalRows
                ? ` · Pass ${payload.summary.passPercentage}%`
                : ""}
            </p>
          ) : null}

          {payload.examinations.map((exam) => (
            <div key={exam.examId} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/results/${exam.examId}`}
                  className="font-medium text-navy-900 hover:underline"
                >
                  {exam.examName || `Exam ${exam.examId}`}
                </Link>
                {exam.examType ? <StatusBadge status={exam.examType} /> : null}
                {yearSem(exam.yearOfStudy, exam.semester) ? (
                  <span className="text-xs text-slate-500">
                    {yearSem(exam.yearOfStudy, exam.semester)}
                  </span>
                ) : null}
              </div>

              <div className="mt-2 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="py-1.5 pr-3 font-medium">Subject</th>
                      <th className="py-1.5 pr-3 font-medium">Grade</th>
                      <th className="py-1.5 pr-3 font-medium">Points</th>
                      <th className="py-1.5 pr-3 font-medium">Credits</th>
                      <th className="py-1.5 font-medium">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {exam.subjects.map((subject) => (
                      <tr key={subject.id} className="border-t border-border">
                        <td className="py-1.5 pr-3">
                          <p className="font-medium text-navy-900">
                            {subject.subjectName || "—"}
                          </p>
                          <p className="font-mono text-xs text-slate-500">{subject.subjectCode}</p>
                        </td>
                        <td className="py-1.5 pr-3 font-semibold">{subject.grade || "—"}</td>
                        <td className="py-1.5 pr-3">{formatPoints(subject.gradePoints)}</td>
                        <td className="py-1.5 pr-3">{formatCredits(subject.credits)}</td>
                        <td className="py-1.5">
                          <StatusBadge status={subject.result} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
