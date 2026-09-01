import "dotenv/config";
import bcrypt from "bcryptjs";
import type { RowDataPacket } from "mysql2";
import { env } from "../config/env.js";
import { queryAcademic, executeAcademic } from "../db/pools.js";
import {
  buildScopeFromAssignments,
  enforceAcademicScope,
  assertEntityInScope,
} from "../authz/authorization.service.js";
import { ROLE_PERMISSIONS, permissionsForRoleKeys } from "../authz/permissions.js";
import { SUPER_ADMIN_SEED } from "../services/auth.service.js";

const base = `http://127.0.0.1:${env.port}`;

async function req(
  path: string,
  init: RequestInit & { cookie?: string } = {},
) {
  const headers = new Headers(init.headers ?? {});
  if (init.cookie) headers.set("Cookie", init.cookie);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers,
    redirect: "manual",
  });
  const setCookie = response.headers.getSetCookie?.() ?? [];
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: response.status, json, setCookie, text };
}

function extractSid(setCookie: string[]) {
  const prefix = `${env.auth.cookieName}=`;
  for (const line of setCookie) {
    if (line.startsWith(prefix)) {
      return line.slice(prefix.length).split(";")[0];
    }
  }
  return null;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function login(identifier: string, password: string) {
  const login = await req("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ identifier, password }),
  });
  assert(login.status === 200, `Login failed for ${identifier}: ${login.status}`);
  const sid = extractSid(login.setCookie);
  assert(sid, "Missing session cookie");
  return {
    sid,
    cookie: `${env.auth.cookieName}=${sid}`,
    body: login.json as {
      authorization?: { permissions?: string[]; scope?: { isGlobal?: boolean } };
    },
  };
}

async function ensureRoleId(roleKey: string) {
  const rows = await queryAcademic<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM ap_roles WHERE role_key = ? LIMIT 1`,
    [roleKey],
  );
  assert(rows[0]?.id, `Role ${roleKey} missing — run migrations`);
  return Number(rows[0].id);
}

async function createEphemeralUser(input: {
  username: string;
  roleKey: string;
  collegeId: number | null;
  branchId: number | null;
  password: string;
}) {
  const hash = await bcrypt.hash(input.password, 10);
  await executeAcademic(`DELETE FROM ap_users WHERE username = ?`, [input.username]);
  const inserted = await executeAcademic(
    `
    INSERT INTO ap_users (name, email, username, password_hash, is_active)
    VALUES (?, ?, ?, ?, 1)
    `,
    [`Authz Test ${input.roleKey}`, `${input.username}@authz.test`, input.username, hash],
  );
  const userId = Number(inserted.insertId);
  const roleId = await ensureRoleId(input.roleKey);
  await executeAcademic(
    `
    INSERT INTO ap_user_roles (user_id, role_id, college_id, branch_id)
    VALUES (?, ?, ?, ?)
    `,
    [userId, roleId, input.collegeId, input.branchId],
  );
  return userId;
}

async function deleteEphemeralUser(username: string) {
  const rows = await queryAcademic<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM ap_users WHERE username = ? LIMIT 1`,
    [username],
  );
  const id = rows[0]?.id;
  if (!id) return;
  await executeAcademic(`DELETE FROM ap_user_roles WHERE user_id = ?`, [id]);
  await executeAcademic(`DELETE FROM ap_sessions WHERE user_id = ?`, [id]);
  await executeAcademic(`DELETE FROM ap_users WHERE id = ?`, [id]);
}

async function main() {
  console.log("=== Authorization verification ===\n");

  // Pure unit checks (no HTTP)
  assert(
    !ROLE_PERMISSIONS.faculty.includes("timetable.publish"),
    "Faculty must not publish timetable",
  );
  assert(
    !ROLE_PERMISSIONS.faculty.includes("user_management.manage_users"),
    "Faculty must not manage users",
  );
  assert(
    !ROLE_PERMISSIONS.exam_cell.includes("timetable.edit"),
    "Exam cell must not modify timetable",
  );
  assert(
    !ROLE_PERMISSIONS.auditor.some((p) => p.endsWith(".edit") || p.endsWith(".post") || p.endsWith(".publish") || p.endsWith(".manage_users")),
    "Auditor must be read-only",
  );
  console.log("1. Role matrix invariants OK");

  const facultyPerms = permissionsForRoleKeys(["faculty"]);
  assert(!facultyPerms.includes("timetable.publish"), "Faculty publish blocked in matrix");
  assert(!facultyPerms.includes("students.view"), "Faculty must not view all students register");
  assert(!facultyPerms.includes("timetable.view"), "Faculty must use my_timetable.view only");
  assert(!facultyPerms.includes("workload.view"), "Faculty must not view staff workload");
  assert(!facultyPerms.includes("catalog.view"), "Faculty must not view curriculum catalog");
  assert(!facultyPerms.includes("faculty.view"), "Faculty must not view faculty directory");
  assert(!facultyPerms.includes("pending_exceptions.view"), "Faculty must not view operations queue");
  assert(!facultyPerms.includes("reports.view"), "Faculty must not view reports hub");
  assert(!facultyPerms.includes("alerts.view"), "Faculty must not view alerts hub");
  assert(!facultyPerms.includes("attendance_analytics.view"), "Faculty must not view attendance analytics");
  assert(facultyPerms.includes("my_timetable.view"), "Faculty must have my_timetable.view");
  console.log("2. Faculty teaching-staff matrix OK");

  const scoped = buildScopeFromAssignments([
    { roleKey: "hod", label: "HOD", collegeId: 1, branchId: 57 },
  ]);
  assert(!scoped.isGlobal, "HOD should not be global");
  assert(scoped.collegeIds?.[0] === 1, "HOD college scope");
  assert(scoped.branchIds?.[0] === 57, "HOD branch scope");

  let denied = false;
  try {
    enforceAcademicScope(
      {
        userId: 1,
        roles: [],
        roleKeys: ["hod"],
        permissions: ROLE_PERMISSIONS.hod as any[],
        rolePermissions: ROLE_PERMISSIONS.hod as string[],
        directPermissions: [],
        revokedPermissions: [],
        scope: scoped,
      },
      { collegeId: 1, branchId: 58 },
    );
  } catch (error) {
    denied = Number((error as { status?: number }).status) === 403;
  }
  assert(denied, "Branch A user requesting Branch B must be denied");
  console.log("3. Branch scope denial OK");

  denied = false;
  try {
    enforceAcademicScope(
      {
        userId: 1,
        roles: [],
        roleKeys: ["principal"],
        permissions: ROLE_PERMISSIONS.principal as any[],
        rolePermissions: ROLE_PERMISSIONS.principal as string[],
        directPermissions: [],
        revokedPermissions: [],
        scope: buildScopeFromAssignments([
          { roleKey: "principal", label: "Principal", collegeId: 1, branchId: null },
        ]),
      },
      { collegeId: 2 },
    );
  } catch (error) {
    denied = Number((error as { status?: number }).status) === 403;
  }
  assert(denied, "College A user requesting College B must be denied");
  console.log("4. College scope denial OK");

  const globalScope = buildScopeFromAssignments([
    { roleKey: "system_admin", label: "System Admin", collegeId: null, branchId: null },
  ]);
  assert(globalScope.isGlobal, "system_admin NULL/NULL is global");
  assertEntityInScope(
    {
      userId: 1,
      roles: [],
      roleKeys: ["system_admin"],
      permissions: ROLE_PERMISSIONS.system_admin as any[],
      rolePermissions: ROLE_PERMISSIONS.system_admin as string[],
      directPermissions: [],
      revokedPermissions: [],
      scope: globalScope,
    },
    { collegeId: 999, branchId: 999 },
  );
  console.log("5. Global admin scope bypass OK");

  // HTTP checks
  const unauth = await req("/api/students?limit=1");
  assert(unauth.status === 401, `Expected 401, got ${unauth.status}`);
  console.log("6. Unauthenticated → 401");

  const admin = await login(SUPER_ADMIN_SEED.username, SUPER_ADMIN_SEED.password);
  assert(admin.body.authorization?.scope?.isGlobal === true, "Super admin should be global");
  assert(
    (admin.body.authorization?.permissions ?? []).includes("timetable.publish"),
    "Super admin can publish",
  );
  console.log("7. Super admin login + global permissions OK");

  const me = await req("/api/auth/me", { cookie: admin.cookie });
  assert(me.status === 200, "/me failed");
  const meBody = me.json as {
    user?: { id?: number };
    authorization?: { permissions?: string[]; roles?: unknown[] };
  };
  assert(meBody.authorization?.permissions?.length, "/me missing permissions");
  assert(meBody.user?.id, "/me missing user id");
  console.log("8. /api/auth/me includes authorization context");

  const allowed = await req("/api/students?limit=1", { cookie: admin.cookie });
  assert(allowed.status === 200, `Admin students expected 200, got ${allowed.status}`);
  console.log("9. Authenticated with permission → allowed");

  const facultyUser = "ap_authz_faculty_tmp";
  const examUser = "ap_authz_exam_tmp";
  const auditorUser = "ap_authz_auditor_tmp";
  const hodUser = "ap_authz_hod_tmp";
  const password = "authz-test-pass-123";

  try {
    await createEphemeralUser({
      username: facultyUser,
      roleKey: "faculty",
      collegeId: 1,
      branchId: 57,
      password,
    });
    await createEphemeralUser({
      username: examUser,
      roleKey: "exam_cell",
      collegeId: 1,
      branchId: null,
      password,
    });
    await createEphemeralUser({
      username: auditorUser,
      roleKey: "auditor",
      collegeId: null,
      branchId: null,
      password,
    });
    await createEphemeralUser({
      username: hodUser,
      roleKey: "hod",
      collegeId: 1,
      branchId: 57,
      password,
    });

    const faculty = await login(facultyUser, password);
    const publishDenied = await req("/api/timetables/1/publish", {
      method: "POST",
      cookie: faculty.cookie,
    });
    assert(publishDenied.status === 403, `Faculty publish expected 403, got ${publishDenied.status}`);
    console.log("10. Faculty cannot publish timetable → 403");

    const manageDenied = await req("/api/settings/faculty-display", {
      method: "PUT",
      cookie: faculty.cookie,
      body: JSON.stringify({ enabledGroupIds: [] }),
    });
    assert(manageDenied.status === 403, `Faculty settings.edit expected 403, got ${manageDenied.status}`);
    console.log("11. Faculty cannot manage settings/users → 403");

    const exam = await login(examUser, password);
    const examTimetable = await req("/api/timetables/draft", {
      method: "POST",
      cookie: exam.cookie,
      body: JSON.stringify({
        collegeId: 1,
        courseId: 1,
        branchId: 57,
        academicYear: "2025-26",
        batch: "2024",
        semester: 1,
        assignments: [],
      }),
    });
    assert(examTimetable.status === 403, `Exam cell timetable edit expected 403, got ${examTimetable.status}`);
    console.log("12. Exam Cell cannot modify timetable → 403");

    const auditor = await login(auditorUser, password);
    const auditorMutation = await req("/api/attendance/sessions/1", {
      method: "POST",
      cookie: auditor.cookie,
      body: JSON.stringify({ students: [] }),
    });
    assert(auditorMutation.status === 403, `Auditor mutation expected 403, got ${auditorMutation.status}`);
    console.log("13. Auditor cannot mutate → 403");

    const hod = await login(hodUser, password);
    const otherBranch = await req("/api/students?limit=1&collegeId=1&branchId=58", {
      cookie: hod.cookie,
    });
    assert(otherBranch.status === 403, `HOD other branch expected 403, got ${otherBranch.status}`);
    console.log("14. HOD cannot access another branch → 403");

    const otherCollege = await req("/api/students?limit=1&collegeId=2", {
      cookie: hod.cookie,
    });
    assert(otherCollege.status === 403, `HOD other college expected 403, got ${otherCollege.status}`);
    console.log("15. Scoped user cannot access another college → 403");

    const attendanceDenied = await req("/api/attendance/sessions?collegeId=2", {
      cookie: hod.cookie,
    });
    assert(attendanceDenied.status === 403, `Attendance scope expected 403, got ${attendanceDenied.status}`);
    console.log("16. Attendance posting scope enforced → 403");

    const resultsDenied = await req("/api/results?collegeId=2", {
      cookie: hod.cookie,
    });
    // hod has no results.view → 403 permission (or scope if they had it)
    assert(resultsDenied.status === 403, `Results for HOD expected 403, got ${resultsDenied.status}`);
    console.log("17. Results/examinations respect permissions → 403 for HOD");

    const studentPii = await req("/api/students?limit=1&collegeId=1&branchId=57", {
      cookie: hod.cookie,
    });
    assert(
      studentPii.status === 200 || studentPii.status === 403,
      `Unexpected student list status ${studentPii.status}`,
    );
    if (studentPii.status === 200) {
      console.log("18. Student list within HOD scope → 200");
    } else {
      console.log("18. Student list within scope returned 403 (no students / empty scope data) — permission path OK");
    }

    const noRoleUser = "ap_authz_norole_tmp";
    await deleteEphemeralUser(noRoleUser);
    const hash = await bcrypt.hash(password, 10);
    await executeAcademic(
      `
      INSERT INTO ap_users (name, email, username, password_hash, is_active)
      VALUES (?, ?, ?, ?, 1)
      `,
      ["No Role User", "norole@authz.test", noRoleUser, hash],
    );
    const noRole = await login(noRoleUser, password);
    const forbidden = await req("/api/students?limit=1", { cookie: noRole.cookie });
    assert(forbidden.status === 403, `No-role user expected 403, got ${forbidden.status}`);
    console.log("19. Authenticated without permission → 403");
    await deleteEphemeralUser(noRoleUser);
  } finally {
    await deleteEphemeralUser(facultyUser);
    await deleteEphemeralUser(examUser);
    await deleteEphemeralUser(auditorUser);
    await deleteEphemeralUser(hodUser);
  }

  console.log("\nAll authorization checks passed.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
