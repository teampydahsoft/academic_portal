import type { RequestStatus, RequestSummary } from "./types";

export type RequestListFilters = {
  typeKey: string;
  status: string;
  sessionDate: string;
  collegeId: string;
  branchId: string;
};

export const DEFAULT_REQUEST_LIST_FILTERS: RequestListFilters = {
  typeKey: "all",
  status: "all",
  sessionDate: "",
  collegeId: "all",
  branchId: "all",
};

export function filterRequestSummaries(
  items: RequestSummary[],
  filters: RequestListFilters,
): RequestSummary[] {
  return items.filter((item) => {
    if (filters.typeKey !== "all" && item.typeKey !== filters.typeKey) return false;
    if (filters.status !== "all" && item.status !== filters.status) return false;
    if (filters.collegeId !== "all" && String(item.collegeId ?? "") !== filters.collegeId) {
      return false;
    }
    if (filters.branchId !== "all" && String(item.branchId ?? "") !== filters.branchId) {
      return false;
    }
    if (filters.sessionDate) {
      const sessionDate = item.substitution?.sessionDate?.slice(0, 10);
      if (sessionDate !== filters.sessionDate) return false;
    }
    return true;
  });
}

export function requestFilterOptions(items: RequestSummary[]) {
  const typeKeys = new Map<string, string>();
  const colleges = new Map<number, string>();
  const branches = new Map<number, string>();

  for (const item of items) {
    if (item.typeKey) {
      typeKeys.set(item.typeKey, item.typeLabel ?? item.typeKey);
    }
    if (item.collegeId != null) {
      colleges.set(item.collegeId, item.collegeName ?? `College ${item.collegeId}`);
    }
    if (item.branchId != null) {
      branches.set(item.branchId, item.branchName ?? `Branch ${item.branchId}`);
    }
  }

  return {
    types: Array.from(typeKeys.entries())
      .map(([typeKey, label]) => ({ typeKey, label }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    colleges: Array.from(colleges.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    branches: Array.from(branches.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export const REQUEST_STATUS_OPTIONS: { value: RequestStatus | "all"; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Submitted" },
  { value: "pending_approval", label: "Pending approval" },
  { value: "approved", label: "Approved" },
  { value: "returned", label: "Returned" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" },
];
