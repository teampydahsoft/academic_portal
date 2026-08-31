export type RequestStatus =
  | "draft"
  | "submitted"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "returned"
  | "cancelled";

export type SubstitutionSummary = {
  sessionDate: string;
  sectionName: string;
  subjectName: string | null;
  originalFacultyName: string | null;
  replacementFacultyName: string | null;
  slotLabel: string | null;
  startTime: string | null;
  endTime: string | null;
  reason: string;
  executionStatus: string;
};

export type RequestSummary = {
  id: number;
  requestTypeId: number;
  workflowId: number;
  requesterUserId: number;
  collegeId: number | null;
  branchId: number | null;
  title: string;
  body: string | null;
  status: RequestStatus;
  currentStepId: number | null;
  currentStepOrder: number | null;
  submittedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  typeKey: string | null;
  typeLabel: string | null;
  substitution?: SubstitutionSummary | null;
  requesterName: string | null;
  currentStepLabel: string | null;
  collegeName?: string | null;
  courseId?: number | null;
  courseName?: string | null;
  branchName?: string | null;
};

export type RequestAction = {
  id: number;
  requestId: number;
  actorUserId: number | null;
  actorName: string | null;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  stepId: number | null;
  stepOrder: number | null;
  comment: string | null;
  metadata: unknown;
  createdAt: string;
};

export type WorkflowStep = {
  id: number;
  stepOrder: number;
  stepKey: string;
  label: string;
  approverRoleKey: string | null;
  requiredPermission: string | null;
  scopeMode: string;
  allowEscalate: boolean;
  isFinal: boolean;
};

export type RequestDetailResponse = {
  request: RequestSummary;
  substitution?: SubstitutionSummary | null;
  workflowSteps: WorkflowStep[];
  currentStep: WorkflowStep | null;
  canEdit: boolean;
  canSubmit: boolean;
  canApprove: boolean;
  canReject: boolean;
  canReturn: boolean;
  canEscalate: boolean;
  canCancel: boolean;
  history: RequestAction[];
};

export type RequestType = {
  id: number;
  typeKey: string;
  label: string;
  description: string | null;
};
