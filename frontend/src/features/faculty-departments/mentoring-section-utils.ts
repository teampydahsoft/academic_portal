export type FacultyAssignmentScope = {
  section: string | null;
  batch: string;
  year: number | null;
  semester: number | null;
  collegeId: number;
  courseId: number;
  branchId: number;
  branchName: string | null;
  academicYear: string;
  planId?: number;
};

export type TeachingSection = {
  key: string;
  collegeId: number;
  courseId: number;
  branchId: number;
  branchName: string;
  section: string;
  batch: string;
  year: number | null;
  semester: number | null;
  academicYear: string;
  label: string;
};

export function normalizeSectionName(section: string | null | undefined): string | null {
  const value = (section ?? "").trim();
  if (!value || value === "-" || value === "—" || value.toLowerCase() === "all") return null;
  return value;
}

export function sectionKeyFromAssignment(
  item: FacultyAssignmentScope,
): string | null {
  if (!item.batch?.trim()) return null;
  const section = normalizeSectionName(item.section);

  if (item.collegeId > 0 && item.branchId > 0) {
    return [
      item.collegeId,
      item.courseId || 0,
      item.branchId,
      item.batch.trim(),
      item.year ?? "",
      item.semester ?? "",
      section ?? "",
    ].join(":");
  }

  if (item.planId) {
    return `plan:${item.planId}:${section ?? ""}`;
  }

  return null;
}

export function buildTeachingSections(assignments: FacultyAssignmentScope[]): TeachingSection[] {
  const map = new Map<string, TeachingSection>();
  for (const item of assignments) {
    const key = sectionKeyFromAssignment(item);
    if (!key) continue;

    const sectionName = normalizeSectionName(item.section);
    const branchLabel = item.branchName?.trim() || "Branch";
    const sectionLabel = sectionName ? `Sec ${sectionName}` : "All sections";
    const label = `${branchLabel} · ${sectionLabel} · ${item.batch} · Y${item.year ?? "?"} S${item.semester ?? "?"}`;

    if (!map.has(key)) {
      map.set(key, {
        key,
        collegeId: item.collegeId,
        courseId: item.courseId,
        branchId: item.branchId,
        branchName: branchLabel,
        section: sectionName ?? "",
        batch: item.batch,
        year: item.year,
        semester: item.semester,
        academicYear: item.academicYear,
        label,
      });
    }
  }
  return Array.from(map.values());
}
