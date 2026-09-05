"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api";

type ComplaintType = {
  id: number;
  name: string;
  enabled: boolean;
};

type Props = {
  open: boolean;
  studentId: number;
  onClose: () => void;
  onCreated: () => void;
};

export function CreateComplaintDialog({ open, studentId, onClose, onCreated }: Props) {
  const [types, setTypes] = useState<ComplaintType[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(false);
  const [riskType, setRiskType] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let mounted = true;
    
    async function fetchTypes() {
      setLoadingTypes(true);
      try {
        const res = await apiFetch("/mentoring/complaint-types");
        if (!res.ok) throw new Error("Failed to load types");
        const data = await res.json();
        if (mounted) {
          const loadedTypes = Array.isArray(data.data) ? data.data : [];
          setTypes(loadedTypes);
          if (loadedTypes.length > 0 && !riskType) {
            setRiskType(loadedTypes[0].name);
          }
        }
      } catch (err) {
        // Soft error, types will just be empty or whatever
        console.error("Failed to load complaint types", err);
      } finally {
        if (mounted) setLoadingTypes(false);
      }
    }
    
    void fetchTypes();
    
    return () => {
      mounted = false;
    };
  }, [open, riskType]);

  // Reset state when closing
  useEffect(() => {
    if (!open) {
      setRiskType("");
      setNotes("");
      setError(null);
    }
  }, [open]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch("/mentoring/risk-cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentDbId: studentId,
          riskType: riskType.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((body as { message?: string }).message ?? "Failed to create complaint");
      }
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create complaint");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-lg rounded-lg border border-border bg-card shadow-xl">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-base font-semibold text-navy-900">Create complaint</h3>
        </div>
        <div className="space-y-3 p-4">
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Complaint Type</span>
            <select
              className="h-11 w-full rounded-md border border-border px-2 text-sm disabled:bg-slate-50 disabled:text-slate-500"
              value={riskType}
              onChange={(event) => setRiskType(event.target.value)}
              disabled={loadingTypes || types.length === 0}
            >
              {loadingTypes ? (
                <option value="">Loading types...</option>
              ) : types.length === 0 ? (
                <option value="">No types configured</option>
              ) : (
                <>
                  <option value="" disabled>Select a type...</option>
                  {types.map((t) => (
                    <option key={t.id} value={t.name}>
                      {t.name}
                    </option>
                  ))}
                </>
              )}
            </select>
            {types.length === 0 && !loadingTypes && (
              <p className="mt-1 text-xs text-amber-600">
                You can configure dynamic complaint types in Settings.
              </p>
            )}
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Description (Notes)</span>
            <textarea
              className="min-h-24 w-full rounded-md border border-border px-3 py-2 text-sm placeholder:text-slate-400"
              placeholder="Provide details about the complaint or risk..."
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
          {error ? <p className="text-sm text-critical">{error}</p> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || (!riskType && types.length > 0)}>
            {busy ? "Creating…" : "Create complaint"}
          </Button>
        </div>
      </div>
    </div>
  );
}
