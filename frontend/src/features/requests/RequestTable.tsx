"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import { RequestCard } from "./RequestCard";
import { formatRequestDate } from "./utils";
import type { RequestSummary } from "./types";

type Column<T> = {
  key: string;
  header: string;
  className?: string;
  render: (item: T) => ReactNode;
};

type Props = {
  items: RequestSummary[];
  showRequester?: boolean;
  renderActions?: (item: RequestSummary) => ReactNode;
};

export function RequestTable({ items, showRequester = false, renderActions }: Props) {
  const columns: Column<RequestSummary>[] = [
    {
      key: "subject",
      header: "Subject / Summary",
      render: (item) => (
        <div>
          <Link href={`/requests/${item.id}`} className="block break-words font-medium text-navy-900 hover:text-brand-700">
            {item.substitution?.subjectName ?? item.title}
          </Link>
          {item.substitution ? (
            <p className="mt-1 text-xs text-slate-500">
              {formatRequestDate(item.substitution.sessionDate)} • {item.substitution.sectionName}
            </p>
          ) : null}
        </div>
      ),
    },
    ...(showRequester
      ? [
          {
            key: "requester",
            header: "Requester",
            render: (item: RequestSummary) => (
              <span className="text-sm text-slate-600">{item.requesterName ?? "—"}</span>
            ),
          } as Column<RequestSummary>,
        ]
      : []),
    {
      key: "scope",
      header: "College / Branch",
      className: "hidden lg:table-cell",
      render: (item) => (
        <span className="text-sm text-slate-600">
          {[item.collegeName, item.branchName].filter(Boolean).join(" • ") || "—"}
        </span>
      ),
    },
    {
      key: "faculty",
      header: "Faculty",
      className: "hidden xl:table-cell",
      render: (item) =>
        item.substitution ? (
          <span className="text-sm text-slate-600">
            {item.substitution.originalFacultyName ?? "—"} →{" "}
            {item.substitution.replacementFacultyName ?? "—"}
          </span>
        ) : (
          <span className="text-sm text-slate-400">—</span>
        ),
    },
    {
      key: "submitted",
      header: "Submitted",
      render: (item) => (
        <span className="text-sm text-slate-600">
          {formatRequestDate(item.submittedAt ?? item.createdAt)}
        </span>
      ),
    },
    {
      key: "step",
      header: "Current step",
      className: "hidden xl:table-cell",
      render: (item) => (
        <span className="text-sm text-slate-600">{item.currentStepLabel ?? "—"}</span>
      ),
    },
    {
      key: "updated",
      header: "Updated",
      className: "hidden md:table-cell",
      render: (item) => (
        <span className="text-sm text-slate-600">{formatRequestDate(item.updatedAt)}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (item) => <StatusBadge status={item.status} />,
    },
  ];

  return (
    <>
      <div className="hidden rounded-lg border border-border bg-white md:block">
        <table className="w-full table-fixed text-left text-sm">
          <thead className="border-b border-border bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {columns.map((column) => (
                <th key={column.key} className={`px-4 py-3 font-medium ${column.className ?? ""}`}>
                  {column.header}
                </th>
              ))}
              {renderActions ? <th className="px-4 py-3 font-medium">Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b border-border last:border-0 hover:bg-slate-50/80">
                {columns.map((column) => (
                  <td key={column.key} className={`px-4 py-3 align-top ${column.className ?? ""}`}>
                    {column.render(item)}
                  </td>
                ))}
                {renderActions ? (
                  <td className="px-4 py-3 align-top">
                    <div className="flex flex-wrap gap-2">{renderActions(item)}</div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 md:hidden">
        {items.map((item) => (
          <RequestCard
            key={item.id}
            item={item}
            showRequester={showRequester}
            actions={
              renderActions ? (
                <div className="flex w-full flex-col gap-2">{renderActions(item)}</div>
              ) : (
                <Link href={`/requests/${item.id}`} className="w-full">
                  <Button size="sm" variant="secondary" className="w-full">
                    View
                  </Button>
                </Link>
              )
            }
          />
        ))}
      </div>
    </>
  );
}
