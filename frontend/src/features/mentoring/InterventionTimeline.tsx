"use client";

import { StatusBadge } from "@/components/ui/StatusBadge";
import type { MentoringStudentDetail } from "./types";
import { formatComplaintStatus, formatDate, formatDateTime, formatInterventionType } from "./utils";

type Props = {
  interventions: MentoringStudentDetail["interventions"];
  caseEvents: MentoringStudentDetail["caseEvents"];
};

export function InterventionTimeline({ interventions, caseEvents }: Props) {
  const items = [
    ...caseEvents.map((event) => ({
      id: `event-${event.id}`,
      at: event.createdAt,
      title:
        event.eventType === "created"
          ? "Complaint opened"
          : event.newStatus
            ? `Status → ${formatComplaintStatus(event.newStatus)}`
            : event.eventType,
      subtitle: event.actorName ?? "System",
      notes: event.notes,
      kind: "event" as const,
    })),
    ...interventions.map((item) => ({
      id: `int-${item.id}`,
      at: item.actionAt,
      title: formatInterventionType(item.actionType),
      subtitle: item.actionByName ?? "Staff",
      notes: [item.notes, item.outcome ? `Outcome: ${item.outcome}` : null, item.followUpDate ? `Follow-up: ${formatDate(item.followUpDate)}` : null]
        .filter(Boolean)
        .join("\n"),
      kind: "intervention" as const,
    })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  if (items.length === 0) {
    return (
      <p className="text-sm text-slate-500">No interventions or complaint events recorded yet.</p>
    );
  }

  return (
    <ol className="space-y-4">
      {items.map((item) => (
        <li key={item.id} className="relative border-l-2 border-brand-200 pl-4">
          <div className="absolute -left-[5px] top-1 h-2 w-2 rounded-full bg-brand-600" />
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-navy-900">{item.title}</p>
            {item.kind === "intervention" ? <StatusBadge status="Open" /> : null}
          </div>
          <p className="text-xs text-slate-500">
            {formatDateTime(item.at)} · {item.subtitle}
          </p>
          {item.notes ? (
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{item.notes}</p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
