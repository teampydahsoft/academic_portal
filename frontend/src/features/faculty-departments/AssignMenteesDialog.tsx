"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api";
import type { TeachingSection } from "./mentoring-section-utils";

type Props = {
  open: boolean;
  staffLinkId: number;
  facultyName: string;
  teachingSections: TeachingSection[];
  assignedSectionKeys: Set<string>;
  onClose: () => void;
  onAssigned: () => void;
};

export function AssignMenteesDialog({
  open,
  staffLinkId,
  facultyName,
  teachingSections,
  assignedSectionKeys,
  onClose,
  onAssigned,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  const availableSections = useMemo(
    () => teachingSections.filter((section) => !assignedSectionKeys.has(section.key)),
    [assignedSectionKeys, teachingSections],
  );

  useEffect(() => {
    if (!open) {
      setSelected(new Set());
      setError(null);
      setResultMessage(null);
    }
  }, [open]);

  function toggleSection(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAllVisible() {
    if (selected.size === availableSections.length) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(availableSections.map((section) => section.key)));
  }

  async function assignSelected() {
    if (selected.size === 0) return;
    setAssigning(true);
    setError(null);
    setResultMessage(null);

    const sections = teachingSections
      .filter((section) => selected.has(section.key))
      .map((section) => ({
        collegeId: section.collegeId,
        ...(section.courseId > 0 ? { courseId: section.courseId } : {}),
        branchId: section.branchId,
        batch: section.batch,
        year: section.year,
        semester: section.semester,
        section: section.section,
        academicYearLabel: section.academicYear,
      }));

    try {
      const response = await apiFetch("/mentoring/assignments/by-sections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          facultyStaffLinkId: staffLinkId,
          sections,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((body as { message?: string }).message ?? "Assignment failed");
      }
      const payload = body as {
        assignedCount: number;
        skippedCount: number;
        sectionCount: number;
      };
      setResultMessage(
        `Assigned ${payload.assignedCount} student${payload.assignedCount === 1 ? "" : "s"} across ${payload.sectionCount} section${payload.sectionCount === 1 ? "" : "s"}` +
          (payload.skippedCount > 0 ? ` (${payload.skippedCount} already assigned)` : ""),
      );
      onAssigned();
      if (payload.skippedCount === 0) {
        onClose();
      } else {
        setSelected(new Set());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Assignment failed");
    } finally {
      setAssigning(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border border-border bg-card shadow-xl">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-base font-semibold text-navy-900">Assign mentor sections</h3>
          <p className="text-sm text-slate-500">
            Select branch / year classes from{" "}
            <span className="font-medium">{facultyName}</span>&apos;s timetable. All students in
            each class will be assigned as mentees.
          </p>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {error ? <p className="text-sm text-critical">{error}</p> : null}
          {resultMessage ? <p className="text-sm text-green-700">{resultMessage}</p> : null}

          {teachingSections.length === 0 ? (
            <p className="text-sm text-slate-500">
              No teaching classes found on published timetables for this faculty member.
            </p>
          ) : availableSections.length === 0 ? (
            <p className="text-sm text-slate-500">
              All teaching classes are already assigned to this mentor.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 text-sm">
                <button
                  type="button"
                  className="text-brand-700 hover:underline"
                  onClick={toggleAllVisible}
                >
                  {selected.size === availableSections.length ? "Clear all" : "Select all"}
                </button>
                <span className="text-slate-500">{selected.size} selected</span>
              </div>

              <div className="max-h-80 space-y-2 overflow-y-auto rounded-md border border-border">
                {availableSections.map((section) => (
                  <label
                    key={section.key}
                    className="flex cursor-pointer items-start gap-3 border-b border-border px-3 py-3 last:border-b-0 hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selected.has(section.key)}
                      onChange={() => toggleSection(section.key)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-navy-900">{section.label}</span>
                      <span className="block text-xs text-slate-500">
                        {section.academicYear} · All students in this class will be mentored
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <Button variant="secondary" onClick={onClose} disabled={assigning}>
            Cancel
          </Button>
          <Button
            onClick={() => void assignSelected()}
            disabled={assigning || selected.size === 0}
          >
            {assigning
              ? "Assigning…"
              : `Assign ${selected.size || ""} class${selected.size === 1 ? "" : "es"}`}
          </Button>
        </div>
      </div>
    </div>
  );
}

export type { TeachingSection };
