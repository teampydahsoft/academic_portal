"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { RequestActionDialog, type RequestActionKind } from "./RequestActionDialog";
import type { RequestDetailResponse } from "./types";

type Props = {
  detail: RequestDetailResponse;
  busy?: boolean;
  error?: string | null;
  onAction: (path: string, comment?: string) => Promise<boolean>;
  compact?: boolean;
};

export function RequestActionPanel({
  detail,
  busy = false,
  error = null,
  onAction,
  compact = false,
}: Props) {
  const [dialogKind, setDialogKind] = useState<RequestActionKind | null>(null);

  const hasActions =
    detail.canApprove ||
    detail.canReject ||
    detail.canReturn ||
    detail.canEscalate ||
    detail.canSubmit ||
    detail.canCancel;

  if (!hasActions) return null;

  async function confirmAction(comment: string) {
    if (!dialogKind) return;
    const ok = await onAction(dialogKind, comment || undefined);
    if (ok) setDialogKind(null);
  }

  const actionButtons: Array<{ kind: RequestActionKind; label: string; variant?: "danger" | "secondary" }> = [];
  if (detail.canSubmit) actionButtons.push({ kind: "submit", label: "Submit" });
  if (detail.canApprove) actionButtons.push({ kind: "approve", label: "Approve" });
  if (detail.canReject) actionButtons.push({ kind: "reject", label: "Reject", variant: "danger" });
  if (detail.canReturn) actionButtons.push({ kind: "return", label: "Return", variant: "secondary" });
  if (detail.canEscalate) actionButtons.push({ kind: "escalate", label: "Escalate", variant: "secondary" });
  if (detail.canCancel) actionButtons.push({ kind: "cancel", label: "Cancel", variant: "secondary" });

  const titles: Record<RequestActionKind, string> = {
    approve: "Confirm approval",
    reject: "Reject request",
    return: "Return for clarification",
    submit: "Submit request",
    cancel: "Cancel request",
    escalate: "Escalate request",
  };

  return (
    <>
      <Card>
        {!compact ? <h2 className="mb-3 text-sm font-semibold text-navy-900">Actions</h2> : null}
        <p className="mb-3 text-xs text-slate-500">
          Available actions are determined by the server based on your permissions and the current
          workflow step.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {actionButtons.map((button) => (
            <Button
              key={button.kind}
              size="sm"
              variant={button.variant}
              className="w-full sm:w-auto"
              disabled={busy}
              onClick={() => setDialogKind(button.kind)}
            >
              {button.label}
            </Button>
          ))}
        </div>
        {error ? <p className="mt-3 text-sm text-critical">{error}</p> : null}
      </Card>

      <RequestActionDialog
        open={dialogKind != null}
        kind={dialogKind ?? "approve"}
        title={dialogKind ? titles[dialogKind] : ""}
        requestTitle={detail.request.title}
        busy={busy}
        error={error}
        onClose={() => setDialogKind(null)}
        onConfirm={(comment) => void confirmAction(comment)}
      />
    </>
  );
}
