"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { ApproverRole, ScopeMode, WorkflowStepDraft } from "./types";
import { SCOPE_MODE_OPTIONS } from "./utils";

type Props = {
  open: boolean;
  roles: ApproverRole[];
  initial?: WorkflowStepDraft | null;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSave: (step: WorkflowStepDraft) => void;
};

const emptyStep = (): WorkflowStepDraft => ({
  clientId: `new_${Date.now()}`,
  label: "",
  approverRoleKey: "",
  requiredPermission: "request.approve",
  scopeMode: "same_college",
  allowEscalate: false,
});

export function WorkflowStepDialog({
  open,
  roles,
  initial,
  busy = false,
  error,
  onClose,
  onSave,
}: Props) {
  const [draft, setDraft] = useState<WorkflowStepDraft>(emptyStep());
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(initial ? { ...initial } : emptyStep());
      setValidationError(null);
    }
  }, [open, initial]);

  if (!open) return null;

  function handleSave() {
    if (!draft.label.trim()) {
      setValidationError("Step label is required.");
      return;
    }
    if (!draft.approverRoleKey) {
      setValidationError("Select an approver role.");
      return;
    }
    setValidationError(null);
    onSave({ ...draft, label: draft.label.trim() });
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-navy-900/40 p-4 sm:items-center">
      <button type="button" className="absolute inset-0" aria-label="Close dialog" onClick={onClose} />
      <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-white p-4 shadow-xl">
        <h2 className="text-base font-semibold text-navy-900">
          {initial ? "Edit approval step" : "Add approval step"}
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Choose a dynamic role from Roles &amp; Permissions. No role names are hardcoded.
        </p>

        <div className="mt-4 space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-navy-900">Step label</span>
            <input
              value={draft.label}
              onChange={(event) => setDraft((prev) => ({ ...prev, label: event.target.value }))}
              className="h-9 w-full rounded-md border border-border px-3 text-sm outline-none focus:border-navy-800"
              placeholder="e.g. Department review"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-navy-900">Approver role</span>
            <select
              value={draft.approverRoleKey}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, approverRoleKey: event.target.value }))
              }
              className="h-9 w-full rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-navy-800"
            >
              <option value="">Select role…</option>
              {roles.map((role) => (
                <option key={role.roleKey} value={role.roleKey}>
                  {role.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-navy-900">Approver type (scope)</span>
            <select
              value={draft.scopeMode}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  scopeMode: event.target.value as ScopeMode,
                }))
              }
              className="h-9 w-full rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-navy-800"
            >
              {SCOPE_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              {SCOPE_MODE_OPTIONS.find((o) => o.value === draft.scopeMode)?.description}
            </p>
          </label>

          <label className="flex items-center gap-2 text-sm text-navy-900">
            <input
              type="checkbox"
              checked={draft.allowEscalate}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, allowEscalate: event.target.checked }))
              }
              className="rounded border-border"
            />
            Allow escalate to skip this step
          </label>
        </div>

        {validationError ? <p className="mt-3 text-sm text-critical">{validationError}</p> : null}
        {error ? <p className="mt-3 text-sm text-critical">{error}</p> : null}

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button size="sm" variant="secondary" className="w-full sm:w-auto" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" className="w-full sm:w-auto" disabled={busy} onClick={handleSave}>
            {busy ? "Saving…" : initial ? "Update step" : "Add step"}
          </Button>
        </div>
      </div>
    </div>
  );
}
