"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useAuth } from "@/components/auth/AuthProvider";
import { apiFetch } from "@/lib/api";
import { RequestListFiltersBar } from "./RequestListFiltersBar";
import { RequestListSkeleton } from "./RequestListSkeleton";
import { RequestTable } from "./RequestTable";
import {
  DEFAULT_REQUEST_LIST_FILTERS,
  filterRequestSummaries,
  requestFilterOptions,
} from "./request-filters";
import { summarizeMine } from "./utils";
import type { RequestSummary } from "./types";

export function MyRequestsView() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("request.create");
  const canApprove = hasPermission("request.approve");

  const [items, setItems] = useState<RequestSummary[]>([]);
  const [filters, setFilters] = useState(DEFAULT_REQUEST_LIST_FILTERS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(false);
      try {
        const response = await apiFetch("/requests?filter=mine", { cache: "no-store" });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error("failed");
        if (!cancelled) setItems((body as { data: RequestSummary[] }).data ?? []);
      } catch {
        if (!cancelled) {
          setItems([]);
          setError(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filterOptions = useMemo(() => requestFilterOptions(items), [items]);
  const filteredItems = useMemo(
    () => filterRequestSummaries(items, filters),
    [items, filters],
  );
  const stats = summarizeMine(items);

  return (
    <div className="min-w-0">
      <PageHeader
        title="My Requests"
        description="Track requests you have submitted and their approval status."
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            {canApprove ? (
              <Link href="/requests/pending" className="w-full sm:w-auto">
                <Button size="sm" variant="secondary" className="w-full">
                  Pending requests
                </Button>
              </Link>
            ) : null}
            {canCreate ? (
              <Link href="/requests/new" className="w-full sm:w-auto">
                <Button size="sm" className="w-full">
                  Create request
                </Button>
              </Link>
            ) : null}
          </div>
        }
      />

      {!loading && !error && items.length > 0 ? (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-border bg-white px-3 py-2">
            <p className="text-xs text-slate-500">In progress</p>
            <p className="text-lg font-semibold text-navy-900">{stats.pending + stats.draft}</p>
          </div>
          <div className="rounded-lg border border-border bg-white px-3 py-2">
            <p className="text-xs text-slate-500">Approved</p>
            <p className="text-lg font-semibold text-success">{stats.approved}</p>
          </div>
          <div className="rounded-lg border border-border bg-white px-3 py-2">
            <p className="text-xs text-slate-500">Returned</p>
            <p className="text-lg font-semibold text-warning">{stats.returned}</p>
          </div>
          <div className="rounded-lg border border-border bg-white px-3 py-2">
            <p className="text-xs text-slate-500">Rejected</p>
            <p className="text-lg font-semibold text-critical">{stats.rejected}</p>
          </div>
        </div>
      ) : null}

      {loading ? (
        <RequestListSkeleton />
      ) : error ? (
        <EmptyState
          title="Unable to load requests"
          description="We couldn't retrieve your requests. Please try again."
        />
      ) : items.length === 0 ? (
        <EmptyState
          title="No requests found"
          description="Create a request to start the configured approval workflow."
          action={
            canCreate ? (
              <Link href="/requests/new">
                <Button size="sm">Create request</Button>
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          <RequestListFiltersBar
            filters={filters}
            onChange={setFilters}
            typeOptions={filterOptions.types}
            collegeOptions={filterOptions.colleges}
            branchOptions={filterOptions.branches}
          />
          {filteredItems.length === 0 ? (
            <EmptyState
              title="No requests match these filters"
              description="Try adjusting the filters or clear them to see all of your requests."
              action={
                <Button size="sm" variant="secondary" onClick={() => setFilters(DEFAULT_REQUEST_LIST_FILTERS)}>
                  Clear filters
                </Button>
              }
            />
          ) : (
        <RequestTable
          items={filteredItems}
          renderActions={(item) => (
            <Link href={`/requests/${item.id}`}>
              <Button size="sm" variant="secondary">
                View
              </Button>
            </Link>
          )}
        />
          )}
        </>
      )}
    </div>
  );
}
