/**
 * READ-ONLY pre-production security audit probes.
 * Does not create users, mutate data, or change schema.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { env } from "../config/env.js";
import { queryAcademic } from "../db/pools.js";
import { SUPER_ADMIN_SEED } from "../services/auth.service.js";
import {
  buildScopeFromAssignments,
  enforceAcademicScope,
} from "../authz/authorization.service.js";
import { ROLE_PERMISSIONS } from "../authz/permissions.js";

const base = `http://127.0.0.1:${env.port}`;

async function req(path: string, init: RequestInit & { cookie?: string } = {}) {
  const headers = new Headers(init.headers ?? {});
  if (init.cookie) headers.set("Cookie", init.cookie);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(`${base}${path}`, { ...init, headers, redirect: "manual" });
  const setCookie = response.headers.getSetCookie?.() ?? [];
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: response.status, json, setCookie, headers: response.headers, text };
}

function extractSid(setCookie: string[]) {
  const prefix = `${env.auth.cookieName}=`;
  for (const line of setCookie) {
    if (line.startsWith(prefix)) return line.slice(prefix.length).split(";")[0];
  }
  return null;
}

function cookieFlags(setCookie: string[]) {
  const line = setCookie.find((l) => l.startsWith(`${env.auth.cookieName}=`)) ?? "";
  return {
    httpOnly: /httponly/i.test(line),
    secure: /secure/i.test(line),
    sameSite: /samesite=([^;]+)/i.exec(line)?.[1] ?? null,
    hasExpires: /expires=/i.test(line) || /max-age=/i.test(line),
  };
}

async function main() {
  const findings: Array<{ sev: string; id: string; detail: string }> = [];
  const note = (sev: string, id: string, detail: string) => findings.push({ sev, id, detail });

  console.log("=== READ-ONLY security audit probes ===\n");
  console.log("Config (no secrets):", {
    nodeEnv: env.nodeEnv,
    corsOrigin: env.corsOrigin,
    cookieName: env.auth.cookieName,
    sessionTtlHours: env.auth.sessionTtlHours,
    secureCookies: env.auth.secureCookies,
    academicDbHost: env.academicDb.host,
    academicDbName: env.academicDb.database,
    academicSsl: env.academicDb.ssl,
    studentSsl: env.studentDb.ssl,
    examSsl: env.examDb.ssl,
    hrmsConfigured: Boolean(env.hrmsMongoUrl),
    superAdminPasswordConfigured: Boolean(SUPER_ADMIN_SEED.password),
  });

  if (env.nodeEnv === "production" && !env.auth.secureCookies) {
    note("CRITICAL", "cookie-secure", "Production with AP_SESSION_SECURE not true");
  }

  // --- Public / unauth ---
  const publicOk = [
    ["GET /", await req("/")],
    ["GET /api/health", await req("/api/health")],
  ] as const;
  for (const [label, r] of publicOk) {
    console.log(label, r.status);
    if (r.status !== 200) note("HIGH", "public-endpoint", `${label} expected 200 got ${r.status}`);
  }

  const sensitiveUnauth = [
    "/api/students?limit=1",
    "/api/students/1/photo",
    "/api/faculty?page=1",
    "/api/examinations",
    "/api/examinations/1/applications",
    "/api/results",
    "/api/results/student/TEST",
    "/api/users",
    "/api/timetables/planner",
    "/api/attendance/today",
    "/api/workload/summary",
    "/api/settings/faculty-display",
    "/api/auth/me",
    "/api/me",
  ];
  for (const path of sensitiveUnauth) {
    const r = await req(path);
    const ok = r.status === 401;
    console.log(`UNAUTH ${path}`, r.status, ok ? "OK" : "FAIL");
    if (!ok) note("CRITICAL", "unauth-leak", `${path} returned ${r.status} (expected 401)`);
  }

  const unauthWrite = await req("/api/timetables/draft", { method: "POST", body: "{}" });
  console.log("UNAUTH POST /api/timetables/draft", unauthWrite.status);
  if (unauthWrite.status !== 401) {
    note("CRITICAL", "unauth-write", `timetable draft write returned ${unauthWrite.status}`);
  }

  // --- Login cookie ---
  if (!SUPER_ADMIN_SEED.password) {
    note("CRITICAL", "login", "Super admin bootstrap password not configured");
    console.log(JSON.stringify(findings, null, 2));
    process.exit(1);
  }
  const login = await req("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      identifier: SUPER_ADMIN_SEED.username,
      password: SUPER_ADMIN_SEED.password,
    }),
  });
  console.log("LOGIN superadmin", login.status);
  if (login.status !== 200) {
    note("CRITICAL", "login", "Super admin login failed — cannot continue authenticated probes");
    console.log(JSON.stringify(findings, null, 2));
    process.exit(1);
  }
  const sid = extractSid(login.setCookie);
  const flags = cookieFlags(login.setCookie);
  console.log("Cookie flags", flags);
  if (!flags.httpOnly) note("CRITICAL", "cookie-httponly", "Session cookie missing HttpOnly");
  if (env.nodeEnv === "production" && !env.auth.secureCookies) {
    note("CRITICAL", "cookie-secure", "Production with AP_SESSION_SECURE not true");
  } else if (!flags.secure && env.auth.secureCookies) {
    note("HIGH", "cookie-secure-flag", "secureCookies true but Set-Cookie missing Secure (check proxy/HTTPS)");
  } else if (!env.auth.secureCookies) {
    note(
      "MEDIUM",
      "cookie-secure-dev",
      "AP_SESSION_SECURE is false — acceptable for local HTTP; must be true on HTTPS production",
    );
  }

  const cookie = `${env.auth.cookieName}=${sid}`;
  const me = await req("/api/auth/me", { cookie });
  console.log("/api/auth/me", me.status);
  const meBody = me.json as {
    user?: { id?: number; name?: string };
    authorization?: { permissions?: string[]; scope?: { isGlobal?: boolean } };
  };
  if (!meBody.authorization?.permissions?.length) {
    note("CRITICAL", "me-authz", "/me missing authorization.permissions");
  }
  if (meBody.authorization?.scope?.isGlobal !== true) {
    note("HIGH", "superadmin-scope", "Super admin /me scope.isGlobal is not true");
  }

  // Authenticated module reads (smoke)
  const moduleGets = [
    "/api/command-center/summary",
    "/api/students?limit=1",
    "/api/faculty?page=1&pageSize=5",
    "/api/catalog/masters",
    "/api/workload/summary",
    "/api/attendance/today?generate=false",
    "/api/examinations?limit=5",
    "/api/results?limit=5",
    "/api/users?limit=5",
    "/api/settings/faculty-display",
    "/api/academic-dates/attendance-calendar/month",
  ];
  for (const path of moduleGets) {
    const r = await req(path, { cookie });
    console.log(`AUTH GET ${path}`, r.status);
    if (r.status >= 500) note("HIGH", "module-500", `${path} → ${r.status}`);
    if (r.status === 401 || r.status === 403) {
      note("HIGH", "module-denied", `Super admin denied ${path} → ${r.status}`);
    }
  }

  // Permission denial without creating users: matrix invariants
  if (ROLE_PERMISSIONS.faculty.includes("timetable.publish")) {
    note("CRITICAL", "matrix", "Faculty has timetable.publish");
  }
  if (ROLE_PERMISSIONS.auditor.includes("attendance.post")) {
    note("CRITICAL", "matrix", "Auditor has attendance.post");
  }

  // Scope unit checks (no DB write)
  try {
    enforceAcademicScope(
      {
        userId: 0,
        roles: [],
        roleKeys: ["hod"],
        permissions: ROLE_PERMISSIONS.hod,
        scope: buildScopeFromAssignments([
          { roleKey: "hod", label: "HOD", collegeId: 1, branchId: 57 },
        ]),
      },
      { collegeId: 1, branchId: 58 },
    );
    note("CRITICAL", "scope-unit", "Branch bypass not denied");
  } catch (e) {
    const status = Number((e as { status?: number }).status);
    console.log("Scope branch bypass", status === 403 ? "DENIED OK" : status);
  }

  // Logout
  const logout = await req("/api/auth/logout", { method: "POST", cookie });
  console.log("LOGOUT", logout.status);
  const afterLogout = await req("/api/students?limit=1", { cookie });
  console.log("After logout students", afterLogout.status);
  if (afterLogout.status !== 401) {
    note("CRITICAL", "logout", "Session still valid after logout");
  }

  // DB read-only inventory
  const users = await queryAcademic<
    (RowDataPacket & {
      id: number;
      username: string;
      hrms_employee_id: string | null;
      password_hash_present: number;
      is_active: number;
    })[]
  >(
    `
    SELECT id, username, hrms_employee_id,
           (password_hash IS NOT NULL AND password_hash <> '') AS password_hash_present,
           is_active
    FROM ap_users
    ORDER BY id
    `,
  );
  console.log("\nap_users inventory (read-only):");
  for (const u of users) {
    console.log(
      `  #${u.id} ${u.username} active=${u.is_active} hrms=${u.hrms_employee_id ?? "—"} localHash=${u.password_hash_present}`,
    );
  }
  const systemUser = users.find((u) => u.username === "academic_portal");
  if (systemUser) {
    note(
      "MEDIUM",
      "system-user",
      `System user academic_portal exists (id=${systemUser.id}); reserved for background/jobs only — interactive attendance posts use req.authUser.id`,
    );
  }
  const localHashUsers = users.filter((u) => Number(u.password_hash_present) === 1);
  if (localHashUsers.length > 1) {
    note(
      "HIGH",
      "extra-local-passwords",
      `More than one ap_users row has password_hash: ${localHashUsers.map((u) => u.username).join(", ")}`,
    );
  }
  const linked = users.filter((u) => u.hrms_employee_id);
  console.log(`Linked HRMS profiles: ${linked.length}`);

  const auditCount = await queryAcademic<(RowDataPacket & { c: number })[]>(
    `SELECT COUNT(*) AS c FROM ap_audit_logs`,
  );
  console.log("ap_audit_logs rows:", auditCount[0]?.c);

  const tables = await queryAcademic<(RowDataPacket & { t: string })[]>(
    `SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name`,
  );
  console.log(
    "AP tables:",
    tables.map((t) => t.t).join(", "),
  );

  const critical = findings.filter((f) => f.sev === "CRITICAL");
  const high = findings.filter((f) => f.sev === "HIGH");

  console.log("\n=== Probe findings (runtime) ===");
  for (const f of findings) {
    console.log(`[${f.sev}] ${f.id}: ${f.detail}`);
  }
  console.log(`\nRuntime finding count: ${findings.length}`);
  console.log(`CRITICAL: ${critical.length}  HIGH: ${high.length}`);
  if (critical.length === 0) {
    console.log("\nVERDICT: READY FOR USER ONBOARDING");
  } else {
    console.log("\nVERDICT: NOT READY — CRITICAL ISSUES");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
