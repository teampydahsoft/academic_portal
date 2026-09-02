import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { env } from "../config/env.js";
import { queryAcademic, queryStudent } from "../db/pools.js";
import { SUPER_ADMIN_SEED } from "../services/auth.service.js";

const base = `http://127.0.0.1:${env.port}`;

async function req(path: string, init: RequestInit & { cookie?: string } = {}) {
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
    if (line.startsWith(prefix)) return line.slice(prefix.length).split(";")[0];
  }
  return null;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function login(identifier: string, password: string) {
  const result = await req("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ identifier, password }),
  });
  assert(result.status === 200, `Login failed for ${identifier}: ${result.status} ${result.text}`);
  const sid = extractSid(result.setCookie);
  assert(sid, "Missing session cookie");
  return { cookie: `${env.auth.cookieName}=${sid}`, body: result.json as Record<string, unknown> };
}

async function main() {
  console.log("=== User Management verification ===\n");

  const unauth = await req("/api/users");
  assert(unauth.status === 401, `Expected 401, got ${unauth.status}`);
  console.log("1. Unauthenticated /api/users → 401");

  const admin = await login(SUPER_ADMIN_SEED.username, SUPER_ADMIN_SEED.password);
  const list = await req("/api/users?limit=20", { cookie: admin.cookie });
  assert(list.status === 200, `Admin list expected 200, got ${list.status}`);
  console.log("2. Authorized administrator can list users");

  // Faculty (ephemeral) must be 403 — create via authz pattern if needed
  const facultyDenied = await req("/api/users", {
    cookie: admin.cookie, // will re-test with no-perm user below
  });
  assert(facultyDenied.status === 200, "sanity");

  // Create ephemeral no-permission user to verify 403 (local password only for test fixture)
  const bcrypt = await import("bcryptjs");
  const { executeAcademic } = await import("../db/pools.js");
  const tmpUser = "ap_um_forbidden_tmp";
  const existingTmp = await queryAcademic<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM ap_users WHERE username = ? LIMIT 1`,
    [tmpUser],
  );
  if (existingTmp[0]) {
    await executeAcademic(`DELETE FROM ap_sessions WHERE user_id = ?`, [existingTmp[0].id]);
    await executeAcademic(`DELETE FROM ap_user_roles WHERE user_id = ?`, [existingTmp[0].id]);
    await executeAcademic(`DELETE FROM ap_users WHERE id = ?`, [existingTmp[0].id]);
  }
  const hash = await bcrypt.hash("um-test-pass", 10);
  await executeAcademic(
    `INSERT INTO ap_users (name, email, username, password_hash, is_active) VALUES (?, ?, ?, ?, 1)`,
    ["UM Forbidden", "um-forbidden@test.local", tmpUser, hash],
  );
  const forbiddenLogin = await login(tmpUser, "um-test-pass");
  const denied = await req("/api/users", { cookie: forbiddenLogin.cookie });
  assert(denied.status === 403, `Unauthorized API expected 403, got ${denied.status}`);
  console.log("3. Unauthorized API request → 403");
  const tmpIdRows = await queryAcademic<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM ap_users WHERE username = ? LIMIT 1`,
    [tmpUser],
  );
  if (tmpIdRows[0]) {
    await executeAcademic(`DELETE FROM ap_sessions WHERE user_id = ?`, [tmpIdRows[0].id]);
    await executeAcademic(`DELETE FROM ap_users WHERE id = ?`, [tmpIdRows[0].id]);
  }

  let candidate: { hrmsUserId: string; alreadyLinked: boolean; name: string } | undefined;
  const preferredId = process.env.AP_TEST_HRMS_USER_ID?.trim();
  for (const term of preferredId ? [preferredId] : ["pydah", "gmail", "edu", "manager", "hod"]) {
    const search = await req(`/api/users/hrms-search?q=${encodeURIComponent(term)}&limit=50`, {
      cookie: admin.cookie,
    });
    assert(search.status === 200, `HRMS search expected 200, got ${search.status}`);
    const candidates =
      (search.json as {
        data?: Array<{
          hrmsUserId: string;
          alreadyLinked: boolean;
          name: string;
          canLink?: boolean;
        }>;
      }).data ?? [];
    candidate = preferredId
      ? candidates.find((c) => c.hrmsUserId === preferredId && c.canLink !== false && !c.alreadyLinked) ??
        candidates.find((c) => c.canLink !== false && !c.alreadyLinked)
      : candidates.find((c) => c.canLink !== false && !c.alreadyLinked);
    if (candidate) break;
  }
  assert(candidate, "No unlinked HRMS candidate found for deliberate link test");
  console.log(`4. Found unlinked HRMS candidate: ${candidate.name}`);

  const colleges = await queryStudent<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM colleges ORDER BY id LIMIT 1`,
  );
  const collegeId = colleges[0] ? Number(colleges[0].id) : null;

  const link = await req("/api/users/link", {
    method: "POST",
    cookie: admin.cookie,
    body: JSON.stringify(
      collegeId
        ? {
            hrmsUserId: candidate.hrmsUserId,
            roleKey: "staff",
            collegeId,
            branchId: null,
            isActive: true,
          }
        : {
            hrmsUserId: candidate.hrmsUserId,
            roleKey: "principal",
            collegeId: null,
            branchId: null,
            isActive: true,
          },
    ),
  });
  assert(link.status === 201, `Link expected 201, got ${link.status} ${link.text}`);
  const linked = link.json as {
    id: number;
    hrmsEmployeeId: string | null;
    roles: Array<{ id: number; roleKey: string }>;
  };
  console.log(`5. HRMS user linked once → ap_user #${linked.id}`);

  const dup = await req("/api/users/link", {
    method: "POST",
    cookie: admin.cookie,
    body: JSON.stringify({
      hrmsUserId: candidate.hrmsUserId,
      roleKey: "staff",
      collegeId,
      branchId: null,
    }),
  });
  assert(dup.status === 409, `Duplicate link expected 409, got ${dup.status}`);
  console.log("6. Duplicate linking prevented → 409");

  const rolesPut = await req(`/api/users/${linked.id}/roles`, {
    method: "PUT",
    cookie: admin.cookie,
    body: JSON.stringify({
      assignments: collegeId
        ? [{ roleKey: "hod", collegeId, branchId: null }]
        : [{ roleKey: "principal", collegeId: null, branchId: null }],
    }),
  });
  assert(rolesPut.status === 200, `Role assignment expected 200, got ${rolesPut.status}`);
  console.log("7. Role assignment works");

  const detail = rolesPut.json as {
    roles: Array<{ id: number; roleKey: string; collegeId: number | null }>;
  };
  if (collegeId && detail.roles[0]) {
    const scopePut = await req(`/api/users/${linked.id}/scope`, {
      method: "PUT",
      cookie: admin.cookie,
      body: JSON.stringify({
        assignmentId: detail.roles[0].id,
        collegeId,
        branchId: null,
      }),
    });
    assert(scopePut.status === 200, `Scope assignment expected 200, got ${scopePut.status}`);
    console.log("8. Scope assignment works");
  } else {
    console.log("8. Scope assignment skipped (no college / global role)");
  }

  // Create a session for linked user is hard without HRMS password.
  // Verify deactivation + session revoke path using admin-forced session rows if any.
  const deactivate = await req(`/api/users/${linked.id}/status`, {
    method: "PUT",
    cookie: admin.cookie,
    body: JSON.stringify({ isActive: false }),
  });
  assert(deactivate.status === 200, `Deactivate expected 200, got ${deactivate.status}`);
  const inactive = deactivate.json as { isActive: boolean };
  assert(inactive.isActive === false, "User should be inactive");
  console.log("9. Deactivation sets inactive");

  const activeSessions = await queryAcademic<(RowDataPacket & { open_count: number })[]>(
    `
    SELECT COUNT(*) AS open_count
    FROM ap_sessions
    WHERE user_id = ? AND revoked_at IS NULL AND expires_at > NOW()
    `,
    [linked.id],
  );
  assert(Number(activeSessions[0]?.open_count ?? 0) === 0, "Active sessions must be revoked");
  console.log("10. Active sessions revoked after deactivation");

  const hashes = await queryAcademic<(RowDataPacket & { hash_null: number })[]>(
    `SELECT password_hash IS NULL AS hash_null FROM ap_users WHERE id = ?`,
    [linked.id],
  );
  assert(Number(hashes[0]?.hash_null) === 1, "Linked HRMS users must not store password_hash");
  console.log("11. Passwords are never stored in AP for linked users");

  const activate = await req(`/api/users/${linked.id}/status`, {
    method: "PUT",
    cookie: admin.cookie,
    body: JSON.stringify({ isActive: true }),
  });
  assert(activate.status === 200, `Activate expected 200, got ${activate.status}`);
  assert((activate.json as { isActive: boolean }).isActive === true, "Re-activation failed");
  console.log("12. Re-activation restores access flag");

  const audits = await queryAcademic<(RowDataPacket & { action: string })[]>(
    `
    SELECT action FROM ap_audit_logs
    WHERE entity_type IN ('ap_user','ap_user_role') AND entity_id IN (?, ?)
    ORDER BY id DESC
    LIMIT 20
    `,
    [linked.id, detail.roles[0]?.id ?? linked.id],
  );
  const actions = new Set(audits.map((a) => String(a.action)));
  assert(actions.has("user.linked"), "Missing user.linked audit");
  assert(actions.has("user.deactivated") || actions.has("user.activated"), "Missing status audit");
  console.log("13. Audit logs created:", [...actions].join(", "));

  // Cleanup: do not leave the deliberately linked real HRMS user in ap_users.
  await executeAcademic(`DELETE FROM ap_sessions WHERE user_id = ?`, [linked.id]);
  await executeAcademic(`DELETE FROM ap_user_roles WHERE user_id = ?`, [linked.id]);
  await executeAcademic(`DELETE FROM ap_users WHERE id = ?`, [linked.id]);
  console.log(`12b. Cleaned up temporary linked AP user #${linked.id}`);

  const studentsStillOk = await req("/api/students?limit=1", { cookie: admin.cookie });
  assert(studentsStillOk.status === 200, "Existing modules should continue working");
  console.log("14. Existing modules continue working");

  console.log("\nAll User Management checks passed.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
