"use client";

import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useRequestStats } from "./useRequestStats";

type Props = {
  canView: boolean;
  canCreate: boolean;
  canApprove: boolean;
};

export function RequestDashboardCard({ canView, canCreate, canApprove }: Props) {
  const { stats, loading, error } = useRequestStats({
    mine: canView,
    pending: canApprove,
  });

  if (!canView) return null;

  return (
    <Card>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-navy-900">Requests</h2>
          <p className="text-xs text-slate-500">Live counts from your request workflow</p>
        </div>
        <Link href="/requests">
          <Button size="sm" variant="secondary">
            Open
          </Button>
        </Link>
      </div>

      {loading ? (
        <div className="grid animate-pulse grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-16 rounded-md bg-slate-100" />
          ))}
        </div>
      ) : error || !stats ? (
        <p className="text-sm text-slate-500">Request summary is unavailable right now.</p>
      ) : (
        <div className="space-y-4">
          {(canCreate || canView) && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-md border border-border bg-slate-50 p-3">
                <p className="text-xs text-slate-500">My pending</p>
                <p className="text-xl font-semibold text-navy-900">{stats.mine.pending}</p>
              </div>
              <div className="rounded-md border border-border bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Approved</p>
                <p className="text-xl font-semibold text-success">{stats.mine.approved}</p>
              </div>
              <div className="rounded-md border border-border bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Returned</p>
                <p className="text-xl font-semibold text-warning">{stats.mine.returned}</p>
              </div>
            </div>
          )}

          {canApprove ? (
            <div className="flex items-center justify-between rounded-md border border-amber-100 bg-amber-50 px-3 py-3">
              <div>
                <p className="text-sm font-medium text-navy-900">Pending your approval</p>
                <p className="text-xs text-slate-600">Requests in your current approval scope</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-semibold text-warning">{stats.pendingApproval}</p>
                <Link href="/requests/pending" className="text-xs font-medium text-brand-700 hover:underline">
                  Review inbox
                </Link>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}
