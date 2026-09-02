"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { useAuth } from "@/components/auth/AuthProvider";
import { isSuperAdminUser } from "@/lib/teaching-scope";
import { apiFetch } from "@/lib/api";
import { RequestActionPanel } from "./RequestActionPanel";
import { RequestDetailSkeleton } from "./RequestListSkeleton";
import { RequestScopeMeta } from "./RequestScopeMeta";
import { RequestTimeline } from "./RequestTimeline";
import { SubstitutionRequestSummary } from "./SubstitutionRequestSummary";
import { formatRequestDateTime } from "./utils";
import type { RequestDetailResponse } from "./types";

type Props = { requestId: string };

export function RequestDetailView({ requestId }: Props) {
  const searchParams = useSearchParams();
  const { authorization, hasPermission } = useAuth();
  const superAdminUser = isSuperAdminUser(authorization);
  const fromPending = searchParams.get("from") === "pending";
  const [detail, setDetail] = useState<RequestDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await apiFetch(`/requests/${encodeURIComponent(requestId)}`, {
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error("failed");
      const next = body as RequestDetailResponse;
      setDetail(next);
      setEditTitle(next.request.title);
      setEditBody(next.request.body ?? "");
    } catch {
      setDetail(null);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveDraft() {
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      const response = await apiFetch(`/requests/${encodeURIComponent(requestId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editTitle.trim(), body: editBody.trim() || undefined }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setActionError((body as { message?: string }).message ?? "Unable to save changes.");
        return;
      }
      setDetail(body as RequestDetailResponse);
      setNotice("Draft saved.");
    } finally {
      setBusy(false);
    }
  }

  async function runAction(path: string, comment?: string): Promise<boolean> {
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      const response = await apiFetch(`/requests/${encodeURIComponent(requestId)}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setActionError(
          (body as { message?: string }).message ?? "This action is not permitted for this request.",
        );
        return false;
      }
      const next = body as RequestDetailResponse;
      setDetail(next);
      setEditTitle(next.request.title);
      setEditBody(next.request.body ?? "");
      if (path === "submit") setNotice("Request submitted into the approval workflow.");
      if (path === "approve") setNotice("Request approved.");
      if (path === "reject") setNotice("Request rejected.");
      if (path === "return") setNotice("Request returned to the requester.");
      if (path === "cancel") setNotice("Request cancelled.");
      return true;
    } catch {
      setActionError("Unable to complete this action. Please try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="Request" />
        <RequestDetailSkeleton />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div>
        <PageHeader title="Request" />
        <EmptyState
          title="Unable to load request"
          description="This request may not exist or you may not have permission to view it."
          action={
            <Link href="/requests">
              <Button size="sm" variant="secondary">
                Back to requests
              </Button>
            </Link>
          }
        />
      </div>
    );
  }

  const { request } = detail;
  const backHref = fromPending
    ? "/requests/pending"
    : hasPermission("request.view") && !superAdminUser
      ? "/requests"
      : superAdminUser
        ? "/requests/pending"
        : "/dashboard";
  const backLabel =
    backHref === "/requests/pending"
      ? "Back to pending"
      : backHref === "/requests"
        ? "My requests"
        : "Back to dashboard";

  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        title={request.title}
        description={request.requesterName ?? "—"}
        actions={
          <Link href={backHref}>
            <Button size="sm" variant="secondary">
              {backLabel}
            </Button>
          </Link>
        }
      />

      {notice ? (
        <div className="rounded-md border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-success">
          {notice}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <div className="min-w-0 space-y-4">
          <Card>
            <h2 className="mb-3 text-sm font-semibold text-navy-900">Request details</h2>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <StatusBadge status={request.status} />
              {request.currentStepLabel ? (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-warning">
                  {request.currentStepLabel}
                </span>
              ) : null}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Requester</p>
                <p className="text-sm text-navy-900">{request.requesterName ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  College / Branch
                </p>
                <RequestScopeMeta request={request} />
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Submitted</p>
                <p className="text-sm text-navy-900">{formatRequestDateTime(request.submittedAt)}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Last updated</p>
                <p className="text-sm text-navy-900">{formatRequestDateTime(request.updatedAt)}</p>
              </div>
            </div>

            {detail.substitution ? (
              <div className="mt-4 border-t border-border pt-4">
                <SubstitutionRequestSummary detail={detail.substitution} />
              </div>
            ) : null}

            <div className="mt-4 border-t border-border pt-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                Description
              </p>
              {detail.canEdit ? (
                <div className="space-y-3">
                  <input
                    value={editTitle}
                    onChange={(event) => setEditTitle(event.target.value)}
                    className="h-11 w-full rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-navy-800"
                  />
                  <textarea
                    value={editBody}
                    onChange={(event) => setEditBody(event.target.value)}
                    className="min-h-32 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-navy-800"
                  />
                  <Button size="sm" disabled={busy || !editTitle.trim()} onClick={() => void saveDraft()}>
                    Save draft
                  </Button>
                </div>
              ) : request.body ? (
                <p className="whitespace-pre-wrap break-words text-sm text-slate-700">{request.body}</p>
              ) : (
                <p className="text-sm text-slate-400">No description provided.</p>
              )}
            </div>
          </Card>

          <RequestActionPanel detail={detail} busy={busy} error={actionError} onAction={runAction} />
        </div>

        <Card className="min-w-0 lg:max-h-[calc(100vh-10rem)] lg:overflow-y-auto">
          <h2 className="mb-3 text-sm font-semibold text-navy-900">Approval workflow</h2>
          <RequestTimeline
            history={detail.history}
            workflowSteps={detail.workflowSteps}
            currentStepOrder={request.currentStepOrder}
            status={request.status}
          />
        </Card>
      </div>
    </div>
  );
}
