"use client";

import { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { useAcademicContext } from "@/components/layout/AcademicProvider";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";

type GridRow = {
  key: string;
  yearOfStudy: number;
  semesterNumber: number;
  yearSemLabel: string;
  session: string;
  semesterId: number | null;
  collegeScoped: boolean;
  startDate: string | null;
  endDate: string | null;
  status: "saved" | "missing";
};

type GridResponse = {
  source: string;
  collegeId: number;
  courseId: number;
  courseName: string;
  batch: string;
  note: string;
  rows: GridRow[];
};

function toInputDate(value: string | null): string {
  return value ?? "";
}

function isoToDisplay(iso: string | null): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

export function SemesterDatesView() {
  const { masters, filters, setFilters } = useAcademicContext();
  const [batches, setBatches] = useState<string[]>([]);
  const [grid, setGrid] = useState<GridResponse | null>(null);
  const [drafts, setDrafts] = useState<
    Record<string, { startDate: string; endDate: string }>
  >({});
  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const colleges = masters?.colleges ?? [];
  const courses = useMemo(() => {
    if (!masters) return [];
    if (filters.collegeId === "all") return masters.courses;
    return masters.courses.filter((c) => c.collegeId === filters.collegeId);
  }, [masters, filters.collegeId]);

  const branches = useMemo(() => {
    if (!masters || filters.courseId === "all") return [];
    return masters.branches.filter((b) => b.courseId === filters.courseId);
  }, [masters, filters.courseId]);

  const collegeId =
    filters.collegeId === "all" ? null : Number(filters.collegeId);
  const courseId = filters.courseId === "all" ? null : Number(filters.courseId);
  const batch = filters.batch === "all" ? "" : String(filters.batch);

  useEffect(() => {
    if (collegeId == null || courseId == null) {
      setBatches([]);
      return;
    }
    let cancelled = false;
    async function loadBatches() {
      try {
        const response = await apiFetch(`/semester-dates/batches?collegeId=${collegeId}&courseId=${courseId}`,
          { cache: "no-store" },
        );
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            typeof body?.message === "string"
              ? body.message
              : "Failed to load batches",
          );
        }
        if (!cancelled) {
          setBatches((body as { data: string[] }).data ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          setBatches([]);
          setError(err instanceof Error ? err.message : "Failed to load batches");
        }
      }
    }
    void loadBatches();
    return () => {
      cancelled = true;
    };
  }, [collegeId, courseId]);

  useEffect(() => {
    if (collegeId == null || courseId == null || !batch) {
      setGrid(null);
      setDrafts({});
      return;
    }
    let cancelled = false;
    async function loadGrid() {
      setLoading(true);
      setError(null);
      setMessage(null);
      try {
        const params = new URLSearchParams({
          collegeId: String(collegeId),
          courseId: String(courseId),
          batch,
        });
        const response = await apiFetch(`/semester-dates?${params}`, {
          cache: "no-store",
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            typeof body?.message === "string"
              ? body.message
              : "Failed to load semester dates",
          );
        }
        if (!cancelled) {
          const next = body as GridResponse;
          setGrid(next);
          const nextDrafts: Record<string, { startDate: string; endDate: string }> =
            {};
          for (const row of next.rows) {
            nextDrafts[row.key] = {
              startDate: toInputDate(row.startDate),
              endDate: toInputDate(row.endDate),
            };
          }
          setDrafts(nextDrafts);
        }
      } catch (err) {
        if (!cancelled) {
          setGrid(null);
          setError(
            err instanceof Error ? err.message : "Failed to load semester dates",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadGrid();
    return () => {
      cancelled = true;
    };
  }, [collegeId, courseId, batch]);

  async function saveRow(row: GridRow) {
    if (collegeId == null || courseId == null || !batch) return;
    const draft = drafts[row.key] ?? { startDate: "", endDate: "" };
    setSavingKey(row.key);
    setError(null);
    setMessage(null);
    try {
      const response = await apiFetch(`/semester-dates`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collegeId,
          courseId,
          batch,
          yearOfStudy: row.yearOfStudy,
          semesterNumber: row.semesterNumber,
          startDate: draft.startDate || null,
          endDate: draft.endDate || null,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof body?.message === "string" ? body.message : "Save failed",
        );
      }
      setMessage(`Saved Year-Sem ${row.yearSemLabel}`);
      setGrid((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          rows: prev.rows.map((item) =>
            item.key === row.key
              ? {
                  ...item,
                  startDate: draft.startDate || null,
                  endDate: draft.endDate || null,
                  status:
                    draft.startDate && draft.endDate ? "saved" : "missing",
                }
              : item,
          ),
        };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSavingKey(null);
    }
  }

  async function saveAll() {
    if (!grid) return;
    for (const row of grid.rows) {
      const draft = drafts[row.key];
      if (!draft) continue;
      const unchanged =
        (draft.startDate || null) === (row.startDate || null) &&
        (draft.endDate || null) === (row.endDate || null);
      if (unchanged) continue;
      await saveRow(row);
    }
  }

  const ready = collegeId != null && courseId != null && Boolean(batch);

  return (
    <div>
      <PageHeader
        title="Semester Dates"
        description="Academic start and end dates from student_database.semesters (college / program level — same source used for student attendance windows)."
      />

      <div className="mb-4 rounded-lg border border-border bg-card p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Selection filters
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-500">College</span>
            <select
              className="h-9 w-full rounded-md border border-border bg-white px-2 text-sm"
              value={filters.collegeId === "all" ? "all" : String(filters.collegeId)}
              onChange={(e) =>
                setFilters({
                  collegeId: e.target.value === "all" ? "all" : Number(e.target.value),
                  courseId: "all",
                  branchId: "all",
                  batch: "all",
                })
              }
            >
              <option value="all">Select college</option>
              {colleges.map((college) => (
                <option key={college.id} value={college.id}>
                  {college.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-500">
              Program / Course
            </span>
            <select
              className="h-9 w-full rounded-md border border-border bg-white px-2 text-sm"
              value={filters.courseId === "all" ? "all" : String(filters.courseId)}
              onChange={(e) =>
                setFilters({
                  courseId: e.target.value === "all" ? "all" : Number(e.target.value),
                  branchId: "all",
                  batch: "all",
                })
              }
              disabled={filters.collegeId === "all"}
            >
              <option value="all">Select course</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-500">Batch</span>
            <select
              className="h-9 w-full rounded-md border border-border bg-white px-2 text-sm"
              value={batch || "all"}
              onChange={(e) =>
                setFilters({ batch: e.target.value === "all" ? "all" : e.target.value })
              }
              disabled={!batches.length}
            >
              <option value="all">Select batch</option>
              {batches.map((item) => (
                <option key={item} value={item}>
                  Batch {item}
                </option>
              ))}
            </select>
          </label>
        </div>

        {branches.length > 0 ? (
          <div className="mt-3">
            <p className="mb-2 text-xs font-medium text-slate-500">Branch</p>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-navy-900 px-3 py-1 text-xs font-medium text-white">
                All Branches
              </span>
              {branches.map((branch) => (
                <span
                  key={branch.id}
                  className="rounded-full border border-border bg-white px-3 py-1 text-xs text-slate-600"
                >
                  {branch.code || branch.name}
                </span>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Choose All Branches to apply dates for the entire program. Dates are stored at
              college / program level in Student Database (not branch-specific).
            </p>
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="mb-4 rounded-lg border border-border bg-card p-4 text-sm text-critical">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="mb-4 rounded-lg border border-border bg-card p-4 text-sm text-success">
          {message}
        </div>
      ) : null}

      {!ready ? (
        <div className="rounded-lg border border-dashed border-border bg-card px-4 py-10 text-center text-sm text-slate-500">
          Select college, course, and batch to load semester dates.
        </div>
      ) : loading ? (
        <div className="rounded-lg border border-dashed border-border bg-card px-4 py-10 text-center text-sm text-slate-500">
          Loading semester dates…
        </div>
      ) : grid ? (
        <div className="rounded-lg border border-border bg-card">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <h2 className="text-base font-semibold text-navy-900">
                Semester Dates — Batch {grid.batch} · All Branches
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Years shown as Year-Sem (1-1, 1-2, 2-1, …). Start / end dates come from{" "}
                <span className="font-medium">{grid.source}</span>.
              </p>
            </div>
            <Button type="button" size="sm" onClick={() => void saveAll()}>
              Save All
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-border bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2.5 font-medium">Year-Sem</th>
                  <th className="px-3 py-2.5 font-medium">Session</th>
                  <th className="px-3 py-2.5 font-medium">Start date</th>
                  <th className="px-3 py-2.5 font-medium">End date</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {grid.rows.map((row) => {
                  const draft = drafts[row.key] ?? { startDate: "", endDate: "" };
                  const saved = Boolean(draft.startDate && draft.endDate);
                  return (
                    <tr key={row.key} className="border-b border-border last:border-0">
                      <td className="px-3 py-2.5">
                        <span className="inline-flex rounded bg-blue-50 px-2 py-0.5 text-xs font-semibold text-info">
                          {row.yearSemLabel}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-slate-700">{row.session}</td>
                      <td className="px-3 py-2.5">
                        <input
                          type="date"
                          className="h-9 rounded-md border border-border bg-white px-2 text-sm"
                          value={draft.startDate}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [row.key]: { ...draft, startDate: e.target.value },
                            }))
                          }
                        />
                        <p className="mt-1 text-[11px] text-slate-400">
                          {isoToDisplay(draft.startDate || null)}
                        </p>
                      </td>
                      <td className="px-3 py-2.5">
                        <input
                          type="date"
                          className="h-9 rounded-md border border-border bg-white px-2 text-sm"
                          value={draft.endDate}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [row.key]: { ...draft, endDate: e.target.value },
                            }))
                          }
                        />
                        <p className="mt-1 text-[11px] text-slate-400">
                          {isoToDisplay(draft.endDate || null)}
                        </p>
                      </td>
                      <td className="px-3 py-2.5">
                        {saved ? (
                          <span className="inline-flex items-center gap-1 text-sm font-medium text-success">
                            <Check className="h-4 w-4" />
                            Saved
                          </span>
                        ) : (
                          <span className="text-sm text-slate-400">Missing</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={savingKey === row.key}
                          onClick={() => void saveRow(row)}
                        >
                          {savingKey === row.key ? "Saving…" : "Update"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className={cn("border-t border-border px-4 py-3 text-xs text-slate-500")}>
            {grid.note}
          </p>
        </div>
      ) : null}
    </div>
  );
}
