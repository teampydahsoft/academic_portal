"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";

export type RequestActionKind = "approve" | "reject" | "return" | "submit" | "cancel" | "escalate";

type Props = {
  open: boolean;
  kind: RequestActionKind;
  title: string;
  requestTitle: string;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: (comment: string) => void;
};

const config: Record<
  RequestActionKind,
  { confirmLabel: string; variant: "primary" | "danger" | "secondary"; commentRequired: boolean; commentLabel: string }
> = {
  approve: {
    confirmLabel: "Confirm approval",
    variant: "primary",
    commentRequired: false,
    commentLabel: "Approval comment (optional)",
  },
  reject: {
    confirmLabel: "Confirm rejection",
    variant: "danger",
    commentRequired: true,
    commentLabel: "Rejection reason (required)",
  },
  return: {
    confirmLabel: "Return to requester",
    variant: "secondary",
    commentRequired: true,
    commentLabel: "Return reason (required)",
  },
  submit: {
    confirmLabel: "Submit request",
    variant: "primary",
    commentRequired: false,
    commentLabel: "Submission note (optional)",
  },
  cancel: {
    confirmLabel: "Cancel request",
    variant: "secondary",
    commentRequired: false,
    commentLabel: "Cancellation note (optional)",
  },
  escalate: {
    confirmLabel: "Escalate request",
    variant: "secondary",
    commentRequired: false,
    commentLabel: "Escalation note (optional)",
  },
};

export function RequestActionDialog({
  open,
  kind,
  title,
  requestTitle,
  busy = false,
  error,
  onClose,
  onConfirm,
}: Props) {
  const [comment, setComment] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setComment("");
      setValidationError(null);
    }
  }, [open, kind]);

  if (!open) return null;

  const meta = config[kind];

  function handleConfirm() {
    const trimmed = comment.trim();
    if (meta.commentRequired && !trimmed) {
      setValidationError(`${meta.commentLabel.replace(" (required)", "")} is required.`);
      return;
    }
    setValidationError(null);
    onConfirm(trimmed);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-navy-900/40 p-4 sm:items-center">
      <button type="button" className="absolute inset-0" aria-label="Close dialog" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-lg border border-border bg-white p-4 shadow-xl">
        <h2 className="text-base font-semibold text-navy-900">{title}</h2>
        <p className="mt-1 break-words text-sm text-slate-600">{requestTitle}</p>

        <label className="mt-4 block text-sm">
          <span className="mb-1 block font-medium text-navy-900">{meta.commentLabel}</span>
          <textarea
            value={comment}
            onChange={(event) => {
              setComment(event.target.value);
              if (validationError) setValidationError(null);
            }}
            className="min-h-24 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-navy-800"
          />
        </label>

        {validationError ? <p className="mt-2 text-sm text-critical">{validationError}</p> : null}
        {error ? <p className="mt-2 text-sm text-critical">{error}</p> : null}

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button size="sm" variant="secondary" className="w-full sm:w-auto" disabled={busy} onClick={onClose}>
            Close
          </Button>
          <Button
            size="sm"
            variant={meta.variant === "danger" ? "danger" : meta.variant === "secondary" ? "secondary" : undefined}
            className="w-full sm:w-auto"
            disabled={busy}
            onClick={handleConfirm}
          >
            {busy ? "Processing…" : meta.confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
