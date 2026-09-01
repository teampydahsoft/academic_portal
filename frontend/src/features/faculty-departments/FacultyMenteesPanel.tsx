"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { useAuth } from "@/components/auth/AuthProvider";
import { apiFetch } from "@/lib/api";
import { AssignMenteesDialog } from "./AssignMenteesDialog";
import {
  buildTeachingSections,
  normalizeSectionName,
  type FacultyAssignmentScope,
  type TeachingSection,
} from "./mentoring-section-utils";

type MenteeRow = {
  assignmentId: number;
  studentDbId: number;
  studentName: string;
  rollNo: string | null;
  admissionNo: string;
  branch: string;
  section: string;
  batch: string;
  year: number | null;
  semester: number | null;
  academicYearLabel: string;
  createdAt: string;
};

type Assignment = FacultyAssignmentScope & {
  planId?: number;
};

type SectionGroup = TeachingSection & {
  studentCount: number;
};

type Props = {
  staffLinkId: number;
  facultyName: string;
  assignments: Assignment[];
};

function sectionKeyFromMentee(row: MenteeRow): string {
  const section = normalizeSectionName(row.section) ?? "";
  return [row.branch, row.batch, section, row.year ?? "", row.semester ?? ""].join(":");
}

function groupMenteesBySection(mentees: MenteeRow[], teachingSections: TeachingSection[]): SectionGroup[] {
  const teachingByBranchSection = new Map<string, TeachingSection>();
  for (const section of teachingSections) {
    teachingByBranchSection.set(
      [
        section.branchName,
        section.batch,
        section.section,
        section.year ?? "",
        section.semester ?? "",
      ].join(":"),
      section,
    );
  }

  const counts = new Map<string, number>();
  for (const mentee of mentees) {
    const key = sectionKeyFromMentee(mentee);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const groups: SectionGroup[] = [];
  for (const [key, studentCount] of counts) {
    const teaching = teachingByBranchSection.get(key);
    if (teaching) {
      groups.push({ ...teaching, studentCount });
      continue;
    }

    const [branch, batch, section, yearRaw, semesterRaw] = key.split(":");
    const sectionLabel = section ? `Sec ${section}` : "All sections";
    groups.push({
      key: `assigned:${key}`,
      collegeId: 0,
      courseId: 0,
      branchId: 0,
      branchName: branch || "—",
      section: section || "",
      batch: batch || "—",
      year: yearRaw ? Number(yearRaw) : null,
      semester: semesterRaw ? Number(semesterRaw) : null,
      academicYear: mentees[0]?.academicYearLabel ?? "—",
      label: `${branch || "—"} · ${sectionLabel} · ${batch || "—"} · Y${yearRaw || "?"} S${semesterRaw || "?"}`,
      studentCount,
    });
  }

  return groups.sort((a, b) => a.label.localeCompare(b.label));
}

export function FacultyMenteesPanel({ staffLinkId, facultyName, assignments }: Props) {
  const { hasPermission } = useAuth();
  const canView = hasPermission("mentoring.view");
  const canAssign = hasPermission("mentoring.assign");

  const [mentees, setMentees] = useState<MenteeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [removingKey, setRemovingKey] = useState<string | null>(null);

  const teachingSections = useMemo(() => buildTeachingSections(assignments), [assignments]);
  const sectionGroups = useMemo(
    () => groupMenteesBySection(mentees, teachingSections),
    [mentees, teachingSections],
  );
  const assignedSectionKeys = useMemo(() => {
    const menteeGroupKeys = new Set(mentees.map(sectionKeyFromMentee));
    const keys = new Set<string>();
    for (const section of teachingSections) {
      const matchKey = [
        section.branchName,
        section.batch,
        section.section,
        section.year ?? "",
        section.semester ?? "",
      ].join(":");
      if (menteeGroupKeys.has(matchKey)) keys.add(section.key);
    }
    return keys;
  }, [mentees, teachingSections]);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch(`/mentoring/mentors/${staffLinkId}/mentees`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof body === "object" && body && "message" in body
            ? String((body as { message: string }).message)
            : "Failed to load mentees",
        );
      }
      setMentees((body as { data?: MenteeRow[] }).data ?? []);
    } catch (err) {
      setMentees([]);
      setError(err instanceof Error ? err.message : "Failed to load mentees");
    } finally {
      setLoading(false);
    }
  }, [canView, staffLinkId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function removeSection(group: SectionGroup) {
    if (group.collegeId <= 0 || group.branchId <= 0) {
      setError("Cannot remove this class automatically. Re-assign from mentoring dashboard.");
      return;
    }

    setRemovingKey(group.key);
    setError(null);
    try {
      const response = await apiFetch("/mentoring/assignments/unassign-sections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          facultyStaffLinkId: staffLinkId,
          sections: [
            {
              collegeId: group.collegeId,
              ...(group.courseId > 0 ? { courseId: group.courseId } : {}),
              branchId: group.branchId,
              batch: group.batch,
              year: group.year,
              semester: group.semester,
              section: group.section,
              academicYearLabel: group.academicYear,
            },
          ],
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((body as { message?: string }).message ?? "Failed to remove class");
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove class");
    } finally {
      setRemovingKey(null);
    }
  }

  if (!canView) return null;

  return (
    <Card className="mb-4 overflow-hidden">
      <div className="border-b border-border bg-slate-50/80 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-navy-900">Mentoring sections</h2>
            <p className="text-xs text-slate-500">
              Assign entire branch / year classes. All students in each class are included
              automatically.
            </p>
          </div>
          {canAssign ? (
            <Button
              size="sm"
              onClick={() => setAssignOpen(true)}
              disabled={teachingSections.length === 0}
            >
              Assign sections
            </Button>
          ) : null}
        </div>
      </div>

      <div className="p-4">
        {error ? (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-critical">
            {error}
          </div>
        ) : null}

        {loading ? (
          <p className="text-sm text-slate-500">Loading mentor sections…</p>
        ) : sectionGroups.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-4 py-6 text-center">
            <p className="text-sm font-medium text-navy-900">No mentor classes assigned yet</p>
            <p className="mt-1 text-xs text-slate-500">
              {teachingSections.length > 0
                ? "Click Assign sections to mentor entire classes from the published timetable."
                : "No published timetable classes were found for this faculty member."}
            </p>
            {canAssign && teachingSections.length > 0 ? (
              <Button size="sm" className="mt-3" onClick={() => setAssignOpen(true)}>
                Assign sections
              </Button>
            ) : null}
          </div>
        ) : (
          <>
            <div className="hidden md:block">
              <DataTable
                rows={sectionGroups}
                rowKey={(row) => row.key}
                emptyMessage="No sections"
                columns={[
                  { key: "section", header: "Class", render: (row) => row.label },
                  {
                    key: "batch",
                    header: "Batch",
                    render: (row) => row.batch || "—",
                  },
                  {
                    key: "year",
                    header: "Year / Sem",
                    render: (row) =>
                      row.year != null || row.semester != null
                        ? `${row.year ?? "—"} / ${row.semester ?? "—"}`
                        : "—",
                  },
                  {
                    key: "students",
                    header: "Students",
                    render: (row) => String(row.studentCount),
                  },
                  {
                    key: "actions",
                    header: "Actions",
                    render: (row) =>
                      canAssign ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={removingKey === row.key}
                          onClick={() => void removeSection(row)}
                        >
                          {removingKey === row.key ? "Removing…" : "Remove"}
                        </Button>
                      ) : null,
                  },
                ]}
              />
            </div>
            <div className="grid gap-2 md:hidden">
              {sectionGroups.map((row) => (
                <div key={row.key} className="rounded-md border border-border p-3 text-sm">
                  <p className="font-medium text-navy-900">{row.label}</p>
                  <p className="text-xs text-slate-500">
                    {row.studentCount} student{row.studentCount === 1 ? "" : "s"}
                  </p>
                  {canAssign ? (
                    <div className="mt-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={removingKey === row.key}
                        onClick={() => void removeSection(row)}
                      >
                        {removingKey === row.key ? "Removing…" : "Remove"}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <AssignMenteesDialog
        open={assignOpen}
        staffLinkId={staffLinkId}
        facultyName={facultyName}
        teachingSections={teachingSections}
        assignedSectionKeys={assignedSectionKeys}
        onClose={() => setAssignOpen(false)}
        onAssigned={() => void load()}
      />
    </Card>
  );
}
