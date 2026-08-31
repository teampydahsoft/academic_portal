import { formatRequestDate } from "./utils";

type SubstitutionDetail = {
  sessionDate: string;
  slotLabel: string | null;
  startTime: string | null;
  endTime: string | null;
  sectionName: string;
  subjectName: string | null;
  originalFacultyName: string | null;
  replacementFacultyName: string | null;
  reason: string;
  executionStatus: string;
};

export function SubstitutionRequestSummary({ detail }: { detail: SubstitutionDetail }) {
  return (
    <div className="rounded-lg border border-border bg-slate-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Faculty substitution
      </p>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-slate-500">Date</dt>
          <dd className="font-medium text-navy-900">{formatRequestDate(detail.sessionDate)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Period</dt>
          <dd className="font-medium text-navy-900">
            {detail.slotLabel ?? "—"}
            {detail.startTime && detail.endTime ? ` (${detail.startTime}–${detail.endTime})` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Class</dt>
          <dd className="font-medium text-navy-900">{detail.sectionName}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Subject</dt>
          <dd className="font-medium text-navy-900">{detail.subjectName ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Original faculty</dt>
          <dd className="font-medium text-navy-900">{detail.originalFacultyName ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Replacement faculty</dt>
          <dd className="font-medium text-navy-900">{detail.replacementFacultyName ?? "—"}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-slate-500">Reason</dt>
          <dd className="mt-1 whitespace-pre-wrap text-navy-900">{detail.reason}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Application status</dt>
          <dd className="font-medium capitalize text-navy-900">{detail.executionStatus}</dd>
        </div>
      </dl>
    </div>
  );
}
