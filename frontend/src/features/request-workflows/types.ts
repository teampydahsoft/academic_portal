export type ScopeMode =
  | "requester_scope"
  | "same_college"
  | "same_branch"
  | "global";

export type ApproverRole = {
  id: number;
  roleKey: string;
  label: string;
  description: string | null;
  isGlobalCapable: boolean;
};

export type WorkflowSummary = {
  id: number;
  workflowKey: string;
  label: string;
  isActive: boolean;
  stepCount: number;
};

export type RequestTypeAdmin = {
  id: number;
  typeKey: string;
  label: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  workflows: WorkflowSummary[];
  activeWorkflow: WorkflowSummary | null;
};

export type WorkflowStepAdmin = {
  id: number;
  workflowId: number;
  stepOrder: number;
  stepKey: string;
  label: string;
  approverRoleKey: string | null;
  approverRoleLabel?: string | null;
  requiredPermission: string | null;
  scopeMode: ScopeMode;
  allowEscalate: boolean;
  isFinal: boolean;
};

export type WorkflowStepDraft = {
  clientId: string;
  id?: number | null;
  stepKey?: string;
  label: string;
  approverRoleKey: string;
  requiredPermission: string;
  scopeMode: ScopeMode;
  allowEscalate: boolean;
  isFinal?: boolean;
};

export type WorkflowDetailResponse = {
  workflow: {
    id: number;
    requestTypeId: number;
    workflowKey: string;
    label: string;
    isActive: boolean;
    createdAt: string;
  };
  requestType: {
    id: number;
    typeKey: string;
    label: string;
    description: string | null;
    isActive: boolean;
    createdAt: string;
  } | null;
  steps: WorkflowStepAdmin[];
};
