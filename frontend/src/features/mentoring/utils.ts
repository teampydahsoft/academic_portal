import type { InterventionType, RiskCaseStatus } from "./types";

export const INTERVENTION_TYPE_LABELS: Record<InterventionType, string> = {
  counselling: "Counselling",
  parent_communication: "Parent communication",
  academic_support: "Academic support",
  attendance_follow_up: "Attendance follow-up",
  other: "Other",
};

export const COMPLAINT_STATUS_LABELS: Record<RiskCaseStatus, string> = {
  open: "Open",
  monitoring: "Monitoring",
  resolved: "Resolved",
  escalated: "Escalated",
};

/** @deprecated Use formatComplaintStatus */
export const CASE_STATUS_LABELS = COMPLAINT_STATUS_LABELS;

export function formatComplaintStatus(status: RiskCaseStatus | string): string {
  return COMPLAINT_STATUS_LABELS[status as RiskCaseStatus] ?? status;
}

/** @deprecated Use formatComplaintStatus */
export const formatCaseStatus = formatComplaintStatus;

export function formatInterventionType(type: InterventionType | string): string {
  return INTERVENTION_TYPE_LABELS[type as InterventionType] ?? type;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function buildMentoringQuery(
  academicFilters: {
    collegeId: number | "all";
    courseId: number | "all";
    branchId: number | "all";
    batch: string | number | "all";
    year: number | "all";
    semester: number | "all";
    section: string | number | "all";
    q?: string;
  },
  localFilters: {
    risk: string;
    caseStatus: string;
    mentorStaffLinkId: number | "all";
    onlyAtRisk: boolean;
  },
) {
  const params = new URLSearchParams();
  const q = academicFilters.q?.trim();
  if (q) params.set("q", q);
  if (academicFilters.collegeId !== "all") params.set("collegeId", String(academicFilters.collegeId));
  if (academicFilters.courseId !== "all") params.set("courseId", String(academicFilters.courseId));
  if (academicFilters.branchId !== "all") params.set("branchId", String(academicFilters.branchId));
  if (academicFilters.batch !== "all") params.set("batch", String(academicFilters.batch));
  if (academicFilters.year !== "all") params.set("year", String(academicFilters.year));
  if (academicFilters.semester !== "all") params.set("semester", String(academicFilters.semester));
  if (academicFilters.section !== "all") params.set("section", String(academicFilters.section));
  if (localFilters.risk !== "all") params.set("risk", localFilters.risk);
  if (localFilters.caseStatus !== "all") params.set("caseStatus", localFilters.caseStatus);
  if (localFilters.mentorStaffLinkId !== "all") {
    params.set("mentorStaffLinkId", String(localFilters.mentorStaffLinkId));
  }
  if (!localFilters.onlyAtRisk) params.set("onlyAtRisk", "false");
  return params.toString();
}
