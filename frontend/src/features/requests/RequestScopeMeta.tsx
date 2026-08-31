import type { RequestSummary } from "./types";

type Props = {
  request: Pick<
    RequestSummary,
    "collegeName" | "courseName" | "branchName" | "collegeId" | "branchId"
  >;
  compact?: boolean;
};

export function RequestScopeMeta({ request, compact = false }: Props) {
  const parts = [
    request.collegeName ?? (request.collegeId != null ? `College ${request.collegeId}` : null),
    request.courseName,
    request.branchName ?? (request.branchId != null ? `Branch ${request.branchId}` : null),
  ].filter(Boolean);

  if (parts.length === 0) {
    return <span className="text-xs text-slate-400">No academic scope</span>;
  }

  return (
    <p className={compact ? "text-xs text-slate-500" : "text-sm text-slate-600"}>
      {parts.join(" • ")}
    </p>
  );
}
