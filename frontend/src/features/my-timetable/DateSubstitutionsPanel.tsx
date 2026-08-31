"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { apiFetch } from "@/lib/api";
import { useAcademicContext } from "@/components/layout/AcademicProvider";

type DatePeriod =
  | {
      kind: "substituted";
      subjectName: string | null;
      sectionName: string;
      startTime: string;
      endTime: string;
      slotLabel: string | null;
      replacementFacultyName: string | null;
    }
  | {
      kind: "substitution";
      subjectName: string | null;
      sectionName: string;
      startTime: string;
      endTime: string;
      slotLabel: string | null;
      originalFacultyName: string | null;
    };

export function DateSubstitutionsPanel({ sessionDate }: { sessionDate: string }) {
  const { filters } = useAcademicContext();
  const [periods, setPeriods] = useState<DatePeriod[]>([]);

  useEffect(() => {
    const params = new URLSearchParams({ date: sessionDate });
    if (filters.collegeId !== "all") params.set("collegeId", String(filters.collegeId));
    if (filters.branchId !== "all") params.set("branchId", String(filters.branchId));
    if (filters.batch !== "all") params.set("batch", String(filters.batch));
    if (filters.year !== "all") params.set("year", String(filters.year));
    if (filters.semester !== "all") params.set("semester", String(filters.semester));
    if (filters.section !== "all") params.set("section", String(filters.section));
    if (filters.academicYear) params.set("academicYear", filters.academicYear);

    void apiFetch(`/my-timetable/day?${params}`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) return;
        const next = (body as { periods?: DatePeriod[] }).periods ?? [];
        setPeriods(next.filter((p) => p.kind === "substituted" || p.kind === "substitution"));
      })
      .catch(() => undefined);
  }, [sessionDate, filters]);

  if (!periods.length) return null;

  return (
    <Card className="mb-4 border-amber-200 bg-amber-50/40">
      <p className="text-xs font-semibold uppercase tracking-wide text-warning">
        Date-specific substitutions ({sessionDate})
      </p>
      <ul className="mt-3 space-y-2">
        {periods.map((period, index) => (
          <li key={`${period.kind}-${index}`} className="rounded-md border border-border bg-white p-3 text-sm">
            <p className="font-medium text-navy-900">
              {period.kind === "substituted" ? "Substituted" : "Substitution"} •{" "}
              {period.subjectName ?? "Class"}
            </p>
            <p className="text-slate-600">
              {period.slotLabel ?? "Period"} ({period.startTime}–{period.endTime}) • {period.sectionName}
            </p>
            <p className="text-xs text-slate-500">
              {period.kind === "substituted"
                ? `Reassigned to ${period.replacementFacultyName ?? "—"}`
                : `Covering for ${period.originalFacultyName ?? "—"}`}
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
}
