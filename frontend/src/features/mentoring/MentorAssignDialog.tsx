"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api";
import type { StaffSearchResult } from "./types";

type Props = {
  open: boolean;
  studentId: number;
  studentName: string;
  onClose: () => void;
  onAssigned: () => void;
};

export function MentorAssignDialog({ open, studentId, studentName, onClose, onAssigned }: Props) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<StaffSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [assigning, setAssigning] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch(`/mentoring/staff-search?q=${encodeURIComponent(q)}`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error((body as { message?: string }).message ?? "Search failed");
      setResults((body as { data: StaffSearchResult[] }).data ?? []);
    } catch (err) {
      setResults([]);
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void runSearch(search), 300);
    return () => window.clearTimeout(timer);
  }, [open, search, runSearch]);

  async function assign(staffLinkId: number) {
    setAssigning(staffLinkId);
    setError(null);
    try {
      const response = await apiFetch("/mentoring/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentDbId: studentId, facultyStaffLinkId: staffLinkId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((body as { message?: string }).message ?? "Assignment failed");
      }
      onAssigned();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Assignment failed");
    } finally {
      setAssigning(null);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-lg rounded-lg border border-border bg-card shadow-xl">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-base font-semibold text-navy-900">Assign mentor</h3>
          <p className="text-sm text-slate-500">{studentName}</p>
        </div>
        <div className="space-y-3 p-4">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search staff by name or ID…"
            className="h-11 w-full rounded-md border border-border px-3 text-sm outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600"
            autoFocus
          />
          {error ? <p className="text-sm text-critical">{error}</p> : null}
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {loading ? (
              <p className="text-sm text-slate-500">Searching…</p>
            ) : results.length === 0 ? (
              <p className="text-sm text-slate-500">
                {search.trim().length < 2 ? "Type at least 2 characters to search." : "No staff found."}
              </p>
            ) : (
              results.map((row) => (
                <div
                  key={row.staffLinkId}
                  className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-navy-900">{row.name}</p>
                    <p className="truncate text-xs text-slate-500">
                      {[row.employeeCode, row.department].filter(Boolean).join(" · ") || row.hrmsEmployeeId}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => void assign(row.staffLinkId)}
                    disabled={assigning === row.staffLinkId}
                  >
                    {assigning === row.staffLinkId ? "Assigning…" : "Assign"}
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="flex justify-end border-t border-border px-4 py-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
