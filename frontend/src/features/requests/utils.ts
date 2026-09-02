import { formatIndianDate, formatIndianDateTime } from "@/lib/datetime";
import type { RequestAction, RequestStatus, RequestSummary, WorkflowStep } from "./types";

export function formatRequestDate(value: string | null) {
  return formatIndianDate(value);
}

export function formatRequestDateTime(value: string | null) {
  return formatIndianDateTime(value);
}

export function statusLabel(status: RequestStatus | string) {
  return status.replaceAll("_", " ");
}

export function isOpenStatus(status: RequestStatus) {
  return ["draft", "submitted", "pending_approval", "returned"].includes(status);
}

export function summarizeMine(items: RequestSummary[]) {
  return {
    pending: items.filter((item) =>
      ["submitted", "pending_approval"].includes(item.status),
    ).length,
    approved: items.filter((item) => item.status === "approved").length,
    returned: items.filter((item) => item.status === "returned").length,
    draft: items.filter((item) => item.status === "draft").length,
    rejected: items.filter((item) => item.status === "rejected").length,
  };
}

type ActionMetadata = {
  displayLabel?: string;
  displayStage?: string;
  stepLabel?: string;
  stepKey?: string;
  nextStepLabel?: string;
  supervisorOverride?: boolean;
  approverRoleLabel?: string;
};

function readActionMetadata(entry: RequestAction): ActionMetadata | null {
  if (!entry.metadata || typeof entry.metadata !== "object") return null;
  return entry.metadata as ActionMetadata;
}

function actionVerb(action: string) {
  switch (action) {
    case "approved":
      return "Approved";
    case "escalated":
      return "Escalated";
    case "rejected":
      return "Rejected";
    case "returned":
      return "Returned";
    case "submitted":
      return "Submitted";
    case "created":
      return "Created";
    case "cancelled":
      return "Cancelled";
    case "pending_approval":
      return "Pending approval";
    default:
      return action.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

function resolveActionStage(
  entry: RequestAction,
  meta: ActionMetadata | null,
  workflowSteps?: WorkflowStep[],
) {
  if (meta?.displayStage) return meta.displayStage;
  if (meta?.stepLabel) return meta.stepLabel;
  if (entry.stepOrder != null && workflowSteps?.length) {
    const step = workflowSteps.find((item) => item.stepOrder === entry.stepOrder);
    if (step) {
      // Legacy rows stored the next workflow step on intermediate approvals.
      if (
        entry.action === "approved" &&
        entry.toStatus === "pending_approval" &&
        !meta?.stepLabel
      ) {
        const prior = workflowSteps.find((item) => item.stepOrder === step.stepOrder - 1);
        if (prior) return prior.label;
      }
      return step.label;
    }
  }
  return null;
}

export function formatRequestActionDisplay(
  entry: RequestAction,
  workflowSteps?: WorkflowStep[],
) {
  const meta = readActionMetadata(entry);
  if (meta?.displayLabel) return meta.displayLabel;

  const verb = actionVerb(entry.action);
  const stage = resolveActionStage(entry, meta, workflowSteps);

  if (entry.action === "pending_approval") {
    return stage ? `Pending — ${stage}` : verb;
  }

  if (["approved", "escalated", "rejected", "returned"].includes(entry.action)) {
    if (meta?.supervisorOverride) {
      return stage ? `${verb} by Super Admin — ${stage}` : `${verb} by Super Admin`;
    }
    return stage ? `${verb} — ${stage}` : verb;
  }

  return verb;
}

export function formatRequestActionSubtitle(
  entry: RequestAction,
  workflowSteps?: WorkflowStep[],
) {
  const meta = readActionMetadata(entry);
  const actor = entry.actorName ?? "System";
  const stage = resolveActionStage(entry, meta, workflowSteps);

  if (entry.action === "approved" || entry.action === "escalated") {
    const parts = [actor];
    if (meta?.supervisorOverride && meta.approverRoleLabel) {
      parts.push(meta.approverRoleLabel);
    }
    if (entry.toStatus === "approved") {
      parts.push("Workflow completed");
    } else if (meta?.nextStepLabel) {
      parts.push(`Forwarded to ${meta.nextStepLabel}`);
    } else if (stage) {
      parts.push(stage);
    }
    return parts.join(" • ");
  }

  if (entry.action === "rejected" || entry.action === "returned") {
    const parts = [actor];
    if (stage) parts.push(stage);
    return parts.join(" • ");
  }

  if (entry.action === "pending_approval") {
    return stage ? `${actor} • Awaiting ${stage}` : `${actor} • awaiting approval`;
  }

  const parts: string[] = [actor];
  if (stage && !["submitted", "created", "cancelled"].includes(entry.action)) {
    parts.push(stage);
  } else if (entry.toStatus) {
    parts.push(entry.toStatus.replaceAll("_", " "));
  }

  return parts.join(" • ");
}
