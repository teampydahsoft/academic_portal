import type { RequestStatus, RequestSummary } from "./types";

export function formatRequestDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatRequestDateTime(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function statusLabel(status: RequestStatus | string) {
  return status.replaceAll("_", " ");
}

export function isOpenStatus(status: RequestStatus) {
  return ["draft", "submitted", "pending_approval", "returned"].includes(status);
}

export function summarizeMine(items: RequestSummary[]) {
  return {
    pending: items.filter((item) =>
      ["submitted", "pending_approval"].includes(item.status),
    ).length,
    approved: items.filter((item) => item.status === "approved").length,
    returned: items.filter((item) => item.status === "returned").length,
    draft: items.filter((item) => item.status === "draft").length,
    rejected: items.filter((item) => item.status === "rejected").length,
  };
}
