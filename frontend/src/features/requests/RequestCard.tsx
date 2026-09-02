import type { ReactNode } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { RequestScopeMeta } from "./RequestScopeMeta";
import { formatRequestDate } from "./utils";
import type { RequestSummary } from "./types";

type Props = {
  item: RequestSummary;
  showRequester?: boolean;
  actions?: ReactNode;
};

export function RequestCard({ item, showRequester = false, actions }: Props) {
  return (
    <Card className="transition-colors hover:border-brand-200">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <Link href={`/requests/${item.id}`} className="block">
            <h2 className="break-words text-base font-semibold text-navy-900 hover:text-brand-700">
              {item.substitution?.subjectName ?? item.title}
            </h2>
          </Link>
          {item.substitution ? (
            <p className="mt-1 text-xs text-slate-500">
              {formatRequestDate(item.substitution.sessionDate)}
              {item.substitution.sectionName ? ` • Section ${item.substitution.sectionName}` : ""}
            </p>
          ) : null}
          {showRequester && item.requesterName ? (
            <p className="mt-1 text-sm text-slate-600">Requester: {item.requesterName}</p>
          ) : null}
          <div className="mt-2">
            <RequestScopeMeta request={item} compact />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
            {item.currentStepLabel ? <span>Step: {item.currentStepLabel}</span> : null}
            <span>Submitted: {formatRequestDate(item.submittedAt ?? item.createdAt)}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
          <StatusBadge status={item.status} />
          {actions}
        </div>
      </div>
    </Card>
  );
}
