import type { ScopeMode } from "./types";

export const SCOPE_MODE_OPTIONS: { value: ScopeMode; label: string; description: string }[] = [
  {
    value: "requester_scope",
    label: "Requester scope",
    description: "Approver must match the requester's college and branch scope.",
  },
  {
    value: "same_branch",
    label: "Same branch",
    description: "Approver must be assigned to the request's branch.",
  },
  {
    value: "same_college",
    label: "Same college",
    description: "Approver must be assigned to the request's college.",
  },
  {
    value: "global",
    label: "Global",
    description: "Approver must have a global-capable role assignment.",
  },
];

export function scopeModeLabel(mode: ScopeMode) {
  return SCOPE_MODE_OPTIONS.find((option) => option.value === mode)?.label ?? mode;
}

export function newClientId() {
  return `step_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
