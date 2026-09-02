import type { RequestAction, RequestStatus, WorkflowStep } from "./types";
import {
  formatRequestActionDisplay,
  formatRequestActionSubtitle,
  formatRequestDateTime,
} from "./utils";

type Props = {
  history: RequestAction[];
  workflowSteps: WorkflowStep[];
  currentStepOrder: number | null;
  status: RequestStatus;
};

function actionLabel(entry: RequestAction, workflowSteps: WorkflowStep[]) {
  return formatRequestActionDisplay(entry, workflowSteps);
}

function lifecycleSteps(
  status: RequestStatus,
  workflowSteps: WorkflowStep[],
  history: RequestAction[],
) {
  const base = [
    { key: "created", label: "Requester", done: true },
    { key: "submitted", label: "Submitted", done: false },
    { key: "pending", label: "Pending approval", done: false },
    { key: "closed", label: "Closed", done: false },
  ];

  const hasSubmitted = historyHas(history, ["submitted", "pending_approval", "approved", "rejected", "returned"]);
  const hasPending = historyHas(history, ["pending_approval"]) || status === "pending_approval";
  const isReturned = status === "returned" || historyHas(history, ["returned"]);
  const isRejected = status === "rejected";
  const isApproved = status === "approved";

  base[1]!.done = hasSubmitted;
  base[2]!.done = hasPending || isApproved || isRejected || isReturned;
  base[3]!.done = isApproved || isRejected || (isReturned && status !== "draft");
  base[3]!.label = isRejected ? "Rejected" : isReturned ? "Returned" : isApproved ? "Approved" : "Closed";

  return { base, workflowSteps, isReturned };
}

function historyHas(history: RequestAction[], actions: string[]) {
  return history.some((entry) => actions.includes(entry.action));
}

export function RequestTimeline({ history, workflowSteps, currentStepOrder, status }: Props) {
  const lifecycle = lifecycleSteps(status, workflowSteps, history);

  if (history.length === 0) {
    return <p className="text-sm text-slate-500">No activity yet.</p>;
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border bg-slate-50 p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Workflow progress
        </p>
        <ol className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          {lifecycle.base.map((step, index) => (
            <li key={step.key} className="flex items-center gap-2 text-sm">
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                  step.done ? "bg-brand-50 text-success" : "bg-white text-slate-400 ring-1 ring-border"
                }`}
              >
                {index + 1}
              </span>
              <span className={step.done ? "font-medium text-navy-900" : "text-slate-500"}>
                {step.label}
              </span>
              {index < lifecycle.base.length - 1 ? (
                <span className="hidden text-slate-300 sm:inline">↓</span>
              ) : null}
            </li>
          ))}
        </ol>
        {lifecycle.isReturned ? (
          <p className="mt-3 text-xs text-warning">
            Returned to requester for correction. Resubmit to continue the workflow.
          </p>
        ) : null}
      </div>

      {workflowSteps.length > 0 ? (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Configured approval steps
          </p>
          <ol className="flex flex-wrap gap-2">
            {workflowSteps.map((step) => {
              const done =
                currentStepOrder == null
                  ? history.some((entry) =>
                      ["approved", "rejected", "escalated"].includes(entry.action),
                    ) && step.stepOrder <= (workflowSteps.at(-1)?.stepOrder ?? 0)
                  : step.stepOrder < currentStepOrder ||
                    history.some((entry) => {
                      if (!["approved", "escalated", "rejected", "returned"].includes(entry.action)) {
                        return false;
                      }
                      if (entry.stepOrder === step.stepOrder) return true;
                      const meta = entry.metadata as { stepKey?: string; displayStage?: string } | null;
                      return meta?.stepKey === step.stepKey || meta?.displayStage === step.label;
                    });
              const active = step.stepOrder === currentStepOrder && status === "pending_approval";
              return (
                <li
                  key={step.id}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    active
                      ? "bg-amber-50 text-warning"
                      : done
                        ? "bg-brand-50 text-success"
                        : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {step.label}
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}

      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Activity timeline
        </p>
        <ul className="space-y-3">
          {history.map((entry) => (
            <li key={entry.id} className="relative border-l-2 border-brand-200 pl-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-sm font-medium text-navy-900">
                  {actionLabel(entry, workflowSteps)}
                </p>
                <p className="text-xs text-slate-500">{formatRequestDateTime(entry.createdAt)}</p>
              </div>
              <p className="text-xs text-slate-500">
                {formatRequestActionSubtitle(entry, workflowSteps)}
              </p>
              {entry.comment ? (
                <p className="mt-2 break-words rounded-md bg-white px-3 py-2 text-sm text-slate-700 ring-1 ring-border">
                  {entry.comment}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
