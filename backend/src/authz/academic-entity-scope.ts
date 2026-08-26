import type { RowDataPacket } from "mysql2";
import { queryExam, queryStudent } from "../db/pools.js";
import {
  assertEntityInScope,
  type AuthzContext,
} from "./authorization.service.js";

type ExamScopeRow = RowDataPacket & {
  college: string | null;
  branchId: number | null;
  branch: string | null;
};

type ExamHeaderRow = RowDataPacket & {
  id: number;
  college: string | null;
};

function text(value: unknown): string | null {
  if (value == null) return null;
  const t = String(value).trim();
  return t ? t : null;
}

function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}

async function collegeNameToIdMap() {
  const rows = await queryStudent<(RowDataPacket & { id: number; name: string })[]>(
    `SELECT id, name FROM colleges`,
  );
  const byName = new Map<string, number>();
  for (const row of rows) {
    const name = text(row.name);
    if (!name) continue;
    byName.set(name.toLowerCase(), Number(row.id));
  }
  return byName;
}

async function resolveCollegeIdByName(name: string | null | undefined): Promise<number | null> {
  const normalized = text(name)?.toLowerCase();
  if (!normalized) return null;
  const map = await collegeNameToIdMap();
  return map.get(normalized) ?? null;
}

/**
 * Resolve EMS exam scope rows (+ header fallback) into Academic Portal college/branch IDs.
 */
export async function resolveExamAcademicScopes(examId: number): Promise<{
  examId: number;
  found: boolean;
  entities: Array<{ collegeId: number | null; branchId: number | null; collegeName: string | null }>;
}> {
  const exams = await queryExam<ExamHeaderRow[]>(
    `SELECT id, college FROM exams WHERE id = ? LIMIT 1`,
    [examId],
  );
  if (!exams[0]) {
    return { examId, found: false, entities: [] };
  }

  const scopes = await queryExam<ExamScopeRow[]>(
    `
    SELECT college, branchId, branch
    FROM exam_scopes
    WHERE examId = ?
    `,
    [examId],
  );

  const nameMap = await collegeNameToIdMap();
  const entities: Array<{
    collegeId: number | null;
    branchId: number | null;
    collegeName: string | null;
  }> = [];

  if (scopes.length) {
    for (const scope of scopes) {
      const collegeName = text(scope.college);
      const collegeId = collegeName ? nameMap.get(collegeName.toLowerCase()) ?? null : null;
      entities.push({
        collegeId,
        branchId: scope.branchId == null ? null : Number(scope.branchId),
        collegeName,
      });
    }
  } else {
    const collegeName = text(exams[0].college);
    entities.push({
      collegeId: collegeName ? nameMap.get(collegeName.toLowerCase()) ?? null : null,
      branchId: null,
      collegeName,
    });
  }

  return { examId, found: true, entities };
}

/**
 * Allow access when the exam is in-scope for ANY resolved EMS scope row.
 * Fail closed when no college can be resolved for a non-global user.
 */
export async function assertExamAccessible(authz: AuthzContext, examId: number) {
  if (authz.scope.isGlobal) return;

  const resolved = await resolveExamAcademicScopes(examId);
  if (!resolved.found) fail(404, "Examination not found");

  const allowedColleges = authz.scope.collegeIds ?? [];
  if (!allowedColleges.length) fail(403, "No academic scope assigned");

  const branchRestricted = authz.scope.branchIds != null;
  const allowedBranches = authz.scope.branchIds ?? [];

  let matched = false;
  let sawResolvableCollege = false;

  for (const entity of resolved.entities) {
    if (entity.collegeId == null) continue;
    sawResolvableCollege = true;
    if (!allowedColleges.includes(entity.collegeId)) continue;

    if (branchRestricted) {
      // College-wide EMS scopes (null branch) are visible to branch-scoped users in that college.
      if (entity.branchId != null && !allowedBranches.includes(entity.branchId)) continue;
    }
    matched = true;
    break;
  }

  if (!sawResolvableCollege) {
    fail(403, "Forbidden: examination college scope could not be resolved");
  }
  if (!matched) {
    fail(403, "Forbidden for this college scope");
  }
}

export async function resolveStudentScopeByRoll(rollNumber: string) {
  const roll = text(rollNumber);
  if (!roll) return null;
  const rows = await queryStudent<
    (RowDataPacket & {
      id: number;
      college_id: number | null;
      branch_id: number | null;
      pin_no: string | null;
    })[]
  >(
    `
    SELECT id, college_id, branch_id, pin_no
    FROM students
    WHERE TRIM(pin_no) = ?
       OR TRIM(admission_number) = ?
       OR TRIM(IFNULL(admission_no, '')) = ?
    LIMIT 1
    `,
    [roll, roll, roll],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    studentId: Number(row.id),
    collegeId: row.college_id == null ? null : Number(row.college_id),
    branchId: row.branch_id == null ? null : Number(row.branch_id),
    roll: text(row.pin_no) ?? roll,
  };
}

export async function assertStudentRollAccessible(authz: AuthzContext, rollNumber: string) {
  const student = await resolveStudentScopeByRoll(rollNumber);
  if (!student) fail(404, "Student not found");
  assertEntityInScope(authz, {
    collegeId: student.collegeId,
    branchId: student.branchId,
  });
  return student;
}

export async function assertCollegeNamesInScope(
  authz: AuthzContext,
  collegeNames: string[],
) {
  if (authz.scope.isGlobal) return;

  const allowed = authz.scope.collegeIds ?? [];
  if (!allowed.length) fail(403, "No academic scope assigned");

  const cleaned = collegeNames.map((n) => text(n)).filter((n): n is string => Boolean(n));
  if (!cleaned.length) {
    fail(403, "Scoped users must target specific colleges within their scope");
  }

  const map = await collegeNameToIdMap();
  for (const name of cleaned) {
    const id = map.get(name.toLowerCase());
    if (id == null || !allowed.includes(id)) {
      fail(403, `Forbidden for college target: ${name}`);
    }
  }
}

export async function allowedCollegeNames(authz: AuthzContext): Promise<string[] | null> {
  if (authz.scope.isGlobal) return null;
  const ids = authz.scope.collegeIds ?? [];
  if (!ids.length) return [];
  const rows = await queryStudent<(RowDataPacket & { id: number; name: string })[]>(
    `SELECT id, name FROM colleges WHERE id IN (${ids.map(() => "?").join(",")})`,
    ids,
  );
  return rows.map((r) => String(r.name).trim()).filter(Boolean);
}

export { resolveCollegeIdByName };
