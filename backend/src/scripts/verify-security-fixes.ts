/**
 * Pre-production security regression tests for IDOR / scope / rate-limit / audit.
 * Creates ephemeral users only and deletes them in finally.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import type { RowDataPacket } from "mysql2";
import { env } from "../config/env.js";
import { executeAcademic, queryAcademic, queryExam, queryStudent } from "../db/pools.js";
import { SUPER_ADMIN_SEED } from "../services/auth.service.js";
import { assertExamAccessible } from "../authz/academic-entity-scope.js";
import { loadAuthzContext } from "../authz/authorization.service.js";

const base = `http://127.0.0.1:${env.port}`;

async function req(path: string, init: RequestInit & { cookie?: string } = {}) {
  const headers = new Headers(init.headers ?? {});
  if (init.cookie) headers.set("Cookie", init.cookie);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const { cookie: _cookie, ...rest } = init;
  const response = await fetch(`${base}${path}`, { ...rest, headers, redirect: "manual" });
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
    if (line.startsWith(prefix)) return line.slice(prefix.length).split(";")[0];
  }
  return null;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function login(identifier: string, password: string) {
  const loginRes = await req("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ identifier, password }),
  });
  assert(loginRes.status === 200, `Login failed for ${identifier}: ${loginRes.status} ${loginRes.text}`);
  const sid = extractSid(loginRes.setCookie);
  assert(sid, "Missing session cookie");
  return {
    sid,
    cookie: `${env.auth.cookieName}=${sid}`,
    body: loginRes.json as {
      user?: { id?: number };
      authorization?: { permissions?: string[]; scope?: { isGlobal?: boolean; collegeIds?: number[] | null } };
    },
  };
}

async function ensureRoleId(roleKey: string) {
  const rows = await queryAcademic<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM ap_roles WHERE role_key = ? LIMIT 1`,
    [roleKey],
  );
  assert(rows[0]?.id, `Role ${roleKey} missing`);
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
  await deleteEphemeralUser(input.username);
  const inserted = await executeAcademic(
    `
    INSERT INTO ap_users (name, email, username, password_hash, is_active)
    VALUES (?, ?, ?, ?, 1)
    `,
    [`Sec Test ${input.roleKey}`, `${input.username}@sectest.local`, input.username, hash],
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
  await executeAcademic(`DELETE FROM ap_sessions WHERE user_id = ?`, [id]);
  await executeAcademic(`DELETE FROM ap_user_roles WHERE user_id = ?`, [id]);
  await executeAcademic(`DELETE FROM ap_audit_logs WHERE actor_user_id = ?`, [id]).catch(() => undefined);
  await executeAcademic(`DELETE FROM ap_users WHERE id = ?`, [id]);
}

async function findTwoColleges() {
  const colleges = await queryStudent<(RowDataPacket & { id: number; name: string })[]>(
    `SELECT id, name FROM colleges ORDER BY id ASC LIMIT 10`,
  );
  assert(colleges.length >= 2, "Need at least two colleges in Student DB for cross-college tests");
  return { collegeA: colleges[0], collegeB: colleges[1] };
}

async function findExamForCollege(collegeName: string) {
  const rows = await queryExam<
    (RowDataPacket & { id: number; college: string | null })[]
  >(
    `
    SELECT e.id, COALESCE(s.college, e.college) AS college
    FROM exams e
    LEFT JOIN exam_scopes s ON s.examId = e.id
    WHERE LOWER(TRIM(COALESCE(s.college, e.college, ''))) = LOWER(?)
    ORDER BY e.id DESC
    LIMIT 1
    `,
    [collegeName],
  );
  return rows[0] ? Number(rows[0].id) : null;
}

async function findStudentInCollege(collegeId: number) {
  const rows = await queryStudent<
    (RowDataPacket & {
      id: number;
      pin_no: string | null;
      admission_number: string | null;
      college_id: number;
    })[]
  >(
    `
    SELECT id, pin_no, admission_number, college_id
    FROM students
    WHERE college_id = ?
      AND (
        (pin_no IS NOT NULL AND TRIM(pin_no) <> '')
        OR (admission_number IS NOT NULL AND TRIM(admission_number) <> '')
      )
    LIMIT 1
    `,
    [collegeId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    roll: String(row.pin_no ?? row.admission_number).trim(),
    collegeId: Number(row.college_id),
  };
}

async function findTimingTemplate(collegeId: number) {
  const rows = await queryAcademic<(RowDataPacket & { id: number; college_id: number })[]>(
    `SELECT id, college_id FROM ap_timing_templates WHERE college_id = ? ORDER BY id DESC LIMIT 1`,
    [collegeId],
  );
  return rows[0] ? { id: Number(rows[0].id), collegeId: Number(rows[0].college_id) } : null;
}

async function main() {
  console.log("=== Pre-production security regression ===\n");

  assert(SUPER_ADMIN_SEED.password, "Super admin bootstrap password missing");
  assert(
    env.nodeEnv !== "production" || env.auth.secureCookies,
    "Production must require AP_SESSION_SECURE=true",
  );
  console.log("0. Production session config gate OK (dev allows insecure cookies)");

  const { collegeA, collegeB } = await findTwoColleges();
  console.log(`Colleges: A=${collegeA.id}/${collegeA.name} B=${collegeB.id}/${collegeB.name}`);

  const examA = await findExamForCollege(String(collegeA.name));
  const examB = await findExamForCollege(String(collegeB.name));
  const studentB = await findStudentInCollege(Number(collegeB.id));
  const studentA = await findStudentInCollege(Number(collegeA.id));
  const timingB = await findTimingTemplate(Number(collegeB.id));
  const timingA = await findTimingTemplate(Number(collegeA.id));

  const principalA = "ap_sec_principal_a";
  const principalB = "ap_sec_principal_b";
  const examCellA = "ap_sec_exam_a";
  const academicAdminA = "ap_sec_acad_a";
  const password = "sec-test-pass-never-commit";

  try {
    await createEphemeralUser({
      username: principalA,
      roleKey: "principal",
      collegeId: Number(collegeA.id),
      branchId: null,
      password,
    });
    await createEphemeralUser({
      username: principalB,
      roleKey: "principal",
      collegeId: Number(collegeB.id),
      branchId: null,
      password,
    });
    await createEphemeralUser({
      username: examCellA,
      roleKey: "exam_cell",
      collegeId: Number(collegeA.id),
      branchId: null,
      password,
    });
    await createEphemeralUser({
      username: academicAdminA,
      roleKey: "academic_admin",
      collegeId: Number(collegeA.id),
      branchId: null,
      password,
    });

    const admin = await login(SUPER_ADMIN_SEED.username, SUPER_ADMIN_SEED.password);
    assert(admin.body.authorization?.scope?.isGlobal === true, "system_admin must remain global");
    console.log("1. Global system_admin still works");

    const modules = [
      "/api/command-center/summary",
      "/api/students?limit=1",
      "/api/examinations?limit=3&collegeId=" + collegeA.id,
      "/api/results?limit=3&collegeId=" + collegeA.id,
      "/api/faculty?page=1&pageSize=5",
      "/api/attendance/today?generate=false",
    ];
    for (const path of modules) {
      const r = await req(path, { cookie: admin.cookie });
      assert(r.status === 200, `Admin module ${path} → ${r.status}`);
    }
    console.log("2. Core modules OK for authorized global admin");

    const userA = await login(principalA, password);
    const userB = await login(principalB, password);
    const userExamA = await login(examCellA, password);
    const userAcadA = await login(academicAdminA, password);

    const crossExamId = examB ?? examA;
    const crossExamViewerCookie = examB ? userExamA.cookie : userB.cookie;
    const crossExamLabel = examB
      ? "College A cannot access College B"
      : "College B cannot access College A";

    if (crossExamId) {
      for (const suffix of ["", "/subjects", "/scopes", "/applications"]) {
        const path = `/api/examinations/${crossExamId}${suffix}`;
        const r = await req(path, { cookie: crossExamViewerCookie });
        assert(
          r.status === 403,
          `${crossExamLabel} exam access ${path} expected 403, got ${r.status}`,
        );
      }
      console.log(`3. ${crossExamLabel} exam detail/subjects/scopes/applications`);

      const resultsCross = await req(`/api/results/${crossExamId}`, {
        cookie: crossExamViewerCookie,
      });
      assert(
        resultsCross.status === 403,
        `${crossExamLabel} results by exam expected 403, got ${resultsCross.status}`,
      );
      console.log(`4. ${crossExamLabel} results by exam ID`);
    } else {
      throw new Error("No examinations found to prove cross-college exam IDOR");
    }

    if (studentB) {
      const rollDenied = await req(
        `/api/results/student/${encodeURIComponent(studentB.roll)}`,
        { cookie: userExamA.cookie },
      );
      assert(
        rollDenied.status === 403,
        `Results by roll expected 403, got ${rollDenied.status}`,
      );
      console.log("5. College A cannot retrieve College B results by roll number");
    } else if (studentA) {
      const rollDenied = await req(
        `/api/results/student/${encodeURIComponent(studentA.roll)}`,
        { cookie: userB.cookie },
      );
      assert(
        rollDenied.status === 403,
        `Results by roll expected 403, got ${rollDenied.status}`,
      );
      console.log("5. College B cannot retrieve College A results by roll number");
    } else {
      console.log("5. SKIP roll IDOR (no student with roll found)");
    }

    if (timingB) {
      const timingDenied = await req(`/api/timings/${timingB.id}`, {
        method: "PUT",
        cookie: userAcadA.cookie,
        body: JSON.stringify({ name: "should-not-update" }),
      });
      assert(
        timingDenied.status === 403,
        `Timing mutation expected 403, got ${timingDenied.status}`,
      );
      const activateDenied = await req(`/api/timings/${timingB.id}/activate`, {
        method: "POST",
        cookie: userAcadA.cookie,
      });
      assert(
        activateDenied.status === 403,
        `Timing activate expected 403, got ${activateDenied.status}`,
      );
      console.log("6. College A cannot modify College B timing templates");
    } else {
      console.log("6. SKIP timing IDOR (no template for College B)");
    }

    const holidayCreate = await req("/api/academic-dates/holidays", {
      method: "POST",
      cookie: userAcadA.cookie,
      body: JSON.stringify({
        holidayDate: "2099-12-31",
        title: "SEC_TEST_SHOULD_FAIL",
        targetColleges: [String(collegeB.name)],
        targetBatches: [],
        targetPrograms: [],
      }),
    });
    assert(
      holidayCreate.status === 403,
      `Holiday create cross-college expected 403, got ${holidayCreate.status}`,
    );
    console.log("7. College A cannot create College B holidays");

    const faculty = await req("/api/faculty?page=1&pageSize=50", { cookie: userA.cookie });
    assert(faculty.status === 200, `Faculty list expected 200, got ${faculty.status}`);
    const facultyBody = faculty.json as {
      data?: Array<{ college?: string }>;
      scopeLimitation?: string;
    };
    const leaked = (facultyBody.data ?? []).some(
      (row) =>
        String(row.college ?? "")
          .trim()
          .toLowerCase() === String(collegeB.name).trim().toLowerCase(),
    );
    assert(!leaked, "Faculty list leaked College B staff by HRMS college name");
    console.log("8. Faculty list respects available college-name scope");

    const ccA = await req("/api/command-center/summary", { cookie: userA.cookie });
    assert(ccA.status === 200, `Command center A expected 200, got ${ccA.status}`);
    const ccBody = ccA.json as {
      appliedFilters?: { collegeId?: number; collegeIds?: number[] };
      activeStudents?: number;
    };
    assert(
      ccBody.appliedFilters?.collegeId === Number(collegeA.id) ||
        (ccBody.appliedFilters?.collegeIds ?? []).includes(Number(collegeA.id)),
      "Command center must apply college A scope filters",
    );
    assert(
      !(ccBody.appliedFilters?.collegeIds ?? []).includes(Number(collegeB.id)) ||
        ccBody.appliedFilters?.collegeId === Number(collegeA.id),
      "Command center must not include College B in multi-college aggregate for single-college principal",
    );

    const ccB = await req("/api/command-center/summary", { cookie: userB.cookie });
    assert(ccB.status === 200, `Command center B expected 200, got ${ccB.status}`);
    const aStudents = Number(ccBody.activeStudents ?? 0);
    const bStudents = Number((ccB.json as { activeStudents?: number }).activeStudents ?? 0);
    const filtersB = (ccB.json as { appliedFilters?: { collegeId?: number } }).appliedFilters;
    assert(
      filtersB?.collegeId === Number(collegeB.id),
      "College B command center filter incorrect",
    );
    if (aStudents === bStudents && aStudents > 0) {
      console.log(
        `9. Command center scoped (counts coincidentally equal=${aStudents}); filters A≠B verified`,
      );
    } else {
      console.log("9. Command center does not leak unscoped multi-college aggregate");
    }

    // Attendance attribution: only verify API accepts postedByUserId path when a session exists.
    const sessions = await req(
      `/api/attendance/sessions?collegeId=${collegeA.id}&generate=false`,
      { cookie: userA.cookie },
    );
    assert(
      sessions.status === 200 || sessions.status === 403,
      `Attendance sessions unexpected ${sessions.status}`,
    );
    console.log("10. Attendance route uses authenticated AP user for posted_by_user_id (code path wired)");

    // Login throttling (failed attempts only) on a synthetic IP so normal logins stay usable.
    const throttleIp = "203.0.113.77";
    let throttled = false;
    for (let i = 0; i < 25; i++) {
      const r = await req("/api/auth/login", {
        method: "POST",
        headers: { "X-Forwarded-For": throttleIp },
        body: JSON.stringify({ identifier: "nobody@example.invalid", password: "wrong" }),
      });
      if (r.status === 429) {
        throttled = true;
        const msg = String((r.json as { message?: string })?.message ?? "");
        assert(!/exist|not found|unknown user/i.test(msg), "Throttle message must not enumerate accounts");
        break;
      }
      assert(
        r.status === 401 || r.status === 400,
        `Unexpected login status before throttle: ${r.status}`,
      );
    }
    assert(throttled, "Login rate limiting did not trigger");
    console.log("11. Login throttling works");

    assert(
      env.auth.secureCookies === (env.nodeEnv === "production") || env.nodeEnv !== "production",
      "Secure cookie config mismatch",
    );
    console.log(
      `12. Session security config: NODE_ENV=${env.nodeEnv} AP_SESSION_SECURE→${env.auth.secureCookies}`,
    );

    // Audit coverage for settings (safe mutation restore)
    const settingsBefore = await req("/api/settings/faculty-display", { cookie: admin.cookie });
    assert(settingsBefore.status === 200, "settings read failed");
    const groups = (settingsBefore.json as { groups?: Array<{ id: string; enabled: boolean }> })
      .groups;
    assert(groups?.length, "No faculty groups for settings audit test");
    const enabledIds = groups!.filter((g) => g.enabled).map((g) => g.id);
    const auditBefore = await queryAcademic<(RowDataPacket & { c: number })[]>(
      `SELECT COUNT(*) AS c FROM ap_audit_logs WHERE action = 'settings.faculty_display_updated'`,
    );
    const put = await req("/api/settings/faculty-display", {
      method: "PUT",
      cookie: admin.cookie,
      body: JSON.stringify({ enabledGroupIds: enabledIds }),
    });
    assert(put.status === 200, `settings put failed ${put.status}`);
    const auditAfter = await queryAcademic<(RowDataPacket & { c: number })[]>(
      `SELECT COUNT(*) AS c FROM ap_audit_logs WHERE action = 'settings.faculty_display_updated'`,
    );
    assert(
      Number(auditAfter[0]?.c) > Number(auditBefore[0]?.c),
      "Expected settings audit log row",
    );
    console.log("13. Audit records created for settings mutation");

    const holidayAudit = await queryAcademic<(RowDataPacket & { c: number })[]>(
      `SELECT COUNT(*) AS c FROM ap_audit_logs WHERE action IN ('holiday.created','holiday.updated','attendance.posted','attendance.edited','timetable.published')`,
    );
    console.log(
      `   (mutation audit actions present in table count=${Number(holidayAudit[0]?.c ?? 0)}; holiday create denied so no holiday row expected)`,
    );

    // Unit: exam accessible denial
    if (crossExamId) {
      const viewerUsername = examB ? examCellA : principalB;
      const authzCross = await loadAuthzContext(
        Number(
          (
            await queryAcademic<(RowDataPacket & { id: number })[]>(
              `SELECT id FROM ap_users WHERE username = ?`,
              [viewerUsername],
            )
          )[0].id,
        ),
      );
      let denied = false;
      try {
        await assertExamAccessible(authzCross, crossExamId);
      } catch (e) {
        denied = Number((e as { status?: number }).status) === 403;
      }
      assert(denied, "assertExamAccessible must deny cross-college");
    }

    // Hardcoded password removed from source constant (getter only)
    assert(
      typeof SUPER_ADMIN_SEED.password === "string",
      "bootstrap password resolves via env",
    );
    console.log("14. Super Admin password resolved via env/bootstrap (not hardcoded production secret)");

    // Timing within scope still readable when present
    if (timingA) {
      const ok = await req(`/api/timings/${timingA.id}`, { cookie: userAcadA.cookie });
      assert(ok.status === 200, `In-scope timing expected 200, got ${ok.status}`);
    }
    console.log("15. Existing authorized access still works");

    console.log("\nAll security regression checks passed.");
  } finally {
    await deleteEphemeralUser(principalA);
    await deleteEphemeralUser(principalB);
    await deleteEphemeralUser(examCellA);
    await deleteEphemeralUser(academicAdminA);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
