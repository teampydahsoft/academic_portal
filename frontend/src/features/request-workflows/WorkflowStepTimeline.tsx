"use client";

import { ChevronDown, ChevronUp, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { ApproverRole, WorkflowStepDraft } from "./types";
import { scopeModeLabel } from "./utils";

type Props = {
  steps: WorkflowStepDraft[];
  roles: ApproverRole[];
  onEdit: (index: number) => void;
  onRemove: (index: number) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
};

export function WorkflowStepTimeline({
  steps,
  roles,
  onEdit,
  onRemove,
  onMoveUp,
  onMoveDown,
}: Props) {
  const roleLabel = (roleKey: string) =>
    roles.find((role) => role.roleKey === roleKey)?.label ?? roleKey;

  if (steps.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-slate-50 p-6 text-center text-sm text-slate-500">
        No approval steps yet. Add at least one step to activate this workflow.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-slate-50 p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Workflow preview
        </p>
        <ol className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {steps.map((step, index) => (
            <li key={step.clientId} className="flex items-center gap-2 text-sm">
              <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-navy-900">
                {roleLabel(step.approverRoleKey)}
              </span>
              {index < steps.length - 1 ? (
                <span className="hidden text-slate-300 sm:inline">→</span>
              ) : null}
            </li>
          ))}
        </ol>
      </div>

      <ol className="space-y-3">
        {steps.map((step, index) => (
          <li
            key={step.clientId}
            className="rounded-lg border border-border bg-white p-4 shadow-sm"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy-900 text-xs font-semibold text-white">
                    {index + 1}
                  </span>
                  <h3 className="font-semibold text-navy-900">{step.label}</h3>
                  {index === steps.length - 1 ? (
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-success">
                      Final
                    </span>
                  ) : null}
                </div>
                <dl className="mt-2 grid gap-1 text-sm text-slate-600 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-400">Role</dt>
                    <dd>{roleLabel(step.approverRoleKey)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-400">Approver type</dt>
                    <dd>{scopeModeLabel(step.scopeMode)}</dd>
                  </div>
                </dl>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Move step up"
                  disabled={index === 0}
                  onClick={() => onMoveUp(index)}
                >
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Move step down"
                  disabled={index === steps.length - 1}
                  onClick={() => onMoveDown(index)}
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="secondary" onClick={() => onEdit(index)}>
                  <Pencil className="mr-1 h-3.5 w-3.5" />
                  Edit
                </Button>
                <Button size="sm" variant="danger" onClick={() => onRemove(index)}>
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                  Remove
                </Button>
              </div>
            </div>
            {index < steps.length - 1 ? (
              <div className="mt-3 flex justify-center text-slate-300">
                <ChevronDown className="h-4 w-4" />
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
