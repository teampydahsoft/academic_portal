"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api";
import { INTERVENTION_TYPE_LABELS } from "./utils";
import type { InterventionType } from "./types";

type Props = {
  open: boolean;
  caseId: number;
  onClose: () => void;
  onSaved: () => void;
};

export function InterventionDialog({ open, caseId, onClose, onSaved }: Props) {
  const [actionType, setActionType] = useState<InterventionType>("counselling");
  const [notes, setNotes] = useState("");
  const [outcome, setOutcome] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch(`/mentoring/risk-cases/${caseId}/interventions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionType,
          notes: notes.trim() || undefined,
          outcome: outcome.trim() || undefined,
          followUpDate: followUpDate || null,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((body as { message?: string }).message ?? "Failed to save intervention");
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save intervention");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-lg rounded-lg border border-border bg-card shadow-xl">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-base font-semibold text-navy-900">Add intervention</h3>
        </div>
        <div className="space-y-3 p-4">
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Type</span>
            <select
              className="h-11 w-full rounded-md border border-border px-2 text-sm"
              value={actionType}
              onChange={(event) => setActionType(event.target.value as InterventionType)}
            >
              {Object.entries(INTERVENTION_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Notes</span>
            <textarea
              className="min-h-24 w-full rounded-md border border-border px-3 py-2 text-sm"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Outcome</span>
            <input
              className="h-11 w-full rounded-md border border-border px-3 text-sm"
              value={outcome}
              onChange={(event) => setOutcome(event.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Follow-up date</span>
            <input
              type="date"
              className="h-11 w-full rounded-md border border-border px-3 text-sm"
              value={followUpDate}
              onChange={(event) => setFollowUpDate(event.target.value)}
            />
          </label>
          {error ? <p className="text-sm text-critical">{error}</p> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? "Saving…" : "Save intervention"}
          </Button>
        </div>
      </div>
    </div>
  );
}
