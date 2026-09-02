"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useAuth } from "@/components/auth/AuthProvider";
import { isSuperAdminUser } from "@/lib/teaching-scope";
import { apiFetch } from "@/lib/api";
import { RequestActionPanel } from "./RequestActionPanel";
import { RequestListSkeleton } from "./RequestListSkeleton";
import { RequestTable } from "./RequestTable";
import type { RequestDetailResponse, RequestSummary } from "./types";

export function PendingRequestsView() {
  const { hasPermission, authorization } = useAuth();
  const canApprove = hasPermission("request.approve");
  const canView = hasPermission("request.view");
  const canCreate = hasPermission("request.create");
  const superAdminUser = isSuperAdminUser(authorization);

  const [items, setItems] = useState<RequestSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [detail, setDetail] = useState<RequestDetailResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await apiFetch("/requests/pending", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error("failed");
      setItems((body as { data: RequestSummary[] }).data ?? []);
    } catch {
      setItems([]);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  async function openDetail(requestId: number) {
    setActiveId(requestId);
    setDetail(null);
    setActionError(null);
    try {
      const response = await apiFetch(`/requests/${requestId}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error("failed");
      setDetail(body as RequestDetailResponse);
    } catch {
      setActiveId(null);
    }
  }

  async function runAction(path: string, comment?: string): Promise<boolean> {
    if (!activeId) return false;
    setBusy(true);
    setActionError(null);
    try {
      const response = await apiFetch(`/requests/${activeId}/${path}`, {
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
      setActiveId(null);
      setDetail(null);
      await loadList();
      return true;
    } catch {
      setActionError("Unable to complete this action. Please try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const headerActions = (
    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
      {canView ? (
        <Link href="/requests" className="w-full sm:w-auto">
          <Button size="sm" variant="secondary" className="w-full">
            {superAdminUser ? "All requests" : "My requests"}
          </Button>
        </Link>
      ) : (
        <Link href="/dashboard" className="w-full sm:w-auto">
          <Button size="sm" variant="secondary" className="w-full">
            Back to dashboard
          </Button>
        </Link>
      )}
      {canCreate ? (
        <Link href="/requests/new" className="w-full sm:w-auto">
          <Button size="sm" className="w-full">
            Create request
          </Button>
        </Link>
      ) : null}
    </div>
  );

  if (!canApprove) {
    return (
      <EmptyState
        title="Approval inbox unavailable"
        description="You do not have permission to approve requests in the current scope."
        action={
          canView ? (
            <Link href="/requests">
              <Button size="sm" variant="secondary">
                Back to my requests
              </Button>
            </Link>
          ) : (
            <Link href="/dashboard">
              <Button size="sm" variant="secondary">
                Back to dashboard
              </Button>
            </Link>
          )
        }
      />
    );
  }

  return (
    <div className="min-w-0">
      <PageHeader
        title={superAdminUser ? "All Pending Requests" : "Pending Requests"}
        description={
          superAdminUser
            ? "Institute-wide requests awaiting approval. As Super Admin you can approve, reject, return, or escalate any pending request."
            : "Requests awaiting your action based on the configured workflow and your scope."
        }
        actions={headerActions}
      />

      {loading ? (
        <RequestListSkeleton />
      ) : error ? (
        <EmptyState
          title="Unable to load pending requests"
          description="We couldn't retrieve your approval inbox. Please try again."
        />
      ) : items.length === 0 ? (
        <EmptyState
          title={
            superAdminUser
              ? "No requests are currently pending approval"
              : "No requests are currently pending your approval"
          }
          description={
            superAdminUser
              ? "When staff submit requests that enter the approval workflow, they will appear here."
              : "When a request matches your permissions and scope, it will appear here."
          }
        />
      ) : (
        <RequestTable
          items={items}
          showRequester
          renderActions={(item) => (
            <>
              <Link href={`/requests/${item.id}?from=pending`}>
                <Button size="sm" variant="secondary" className="w-full sm:w-auto">
                  View
                </Button>
              </Link>
              <Button size="sm" className="w-full sm:w-auto" onClick={() => void openDetail(item.id)}>
                Review
              </Button>
            </>
          )}
        />
      )}

      {activeId && detail ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy-900/40 p-4 sm:items-center">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-white p-4 shadow-xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="break-words text-base font-semibold text-navy-900">
                  {detail.request.title}
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  {detail.request.requesterName ?? "—"}
                </p>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setActiveId(null)}>
                Close
              </Button>
            </div>
            <RequestActionPanel
              detail={detail}
              busy={busy}
              error={actionError}
              onAction={runAction}
              compact
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
