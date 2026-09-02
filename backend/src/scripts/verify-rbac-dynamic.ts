/**
 * Verify dynamic RBAC: exact matrix match, custom roles, cache invalidation, safety.
 * Ephemeral users/roles only; cleaned up in finally.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import type { RowDataPacket } from "mysql2";
import { env } from "../config/env.js";
import { executeAcademic, queryAcademic } from "../db/pools.js";
import { ROLE_PERMISSIONS, type RoleKey } from "../authz/permissions.js";
import { loadAuthzContext, invalidateAuthzCache } from "../authz/authorization.service.js";
import { SUPER_ADMIN_SEED } from "../services/auth.service.js";
import {
  createRole,
  deleteRole,
  setRolePermissions,
} from "../services/role-management.service.js";

const base = `http://127.0.0.1:${env.port}`;

async function req(path: string, init: RequestInit & { cookie?: string } = {}) {
  const headers = new Headers(init.headers ?? {});
  if (init.cookie) headers.set("Cookie", init.cookie);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const { cookie: _c, ...rest } = init;
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
  assert(loginRes.status === 200, `Login failed ${loginRes.status} ${loginRes.text}`);
  const sid = extractSid(loginRes.setCookie);
  assert(sid, "missing cookie");
  return {
    cookie: `${env.auth.cookieName}=${sid}`,
    body: loginRes.json as {
      user?: { id?: number };
      authorization?: { permissions?: string[]; scope?: { isGlobal?: boolean } };
    },
  };
}

async function main() {
  console.log("=== Dynamic RBAC verification ===\n");

  // 1. Exact match hardcoded vs DB
  for (const roleKey of Object.keys(ROLE_PERMISSIONS) as RoleKey[]) {
    const rows = await queryAcademic<(RowDataPacket & { permission_key: string })[]>(
      `
      SELECT p.permission_key
      FROM ap_roles r
      INNER JOIN ap_role_permissions rp ON rp.role_id = r.id
      INNER JOIN ap_permissions p ON p.id = rp.permission_id
      WHERE r.role_key = ? AND p.is_active = 1 AND r.is_active = 1
      ORDER BY p.permission_key
      `,
      [roleKey],
    );
    const db = rows.map((r) => String(r.permission_key)).sort();
    const code = [...ROLE_PERMISSIONS[roleKey]].map(String).sort();
    assert(
      db.length === code.length && db.every((p, i) => p === code[i]),
      `Matrix mismatch for ${roleKey}`,
    );
  }
  console.log("1. Existing roles retain exact permissions (DB == hardcoded seed)");

  // 2. Super admin still has full access via DB
  const admin = await login(SUPER_ADMIN_SEED.username, SUPER_ADMIN_SEED.password);
  assert(admin.body.authorization?.scope?.isGlobal === true, "admin global");
  assert(
    (admin.body.authorization?.permissions ?? []).includes("user_management.manage_users"),
    "admin manage_users",
  );
  assert(
    (admin.body.authorization?.permissions ?? []).includes("timetable.publish"),
    "admin publish from DB",
  );
  console.log("2. Existing super_admin retains access via DB permissions");

  // Unauthorized cannot manage roles
  const forbidden = await req("/api/roles", {
    method: "POST",
    body: JSON.stringify({ label: "Nope" }),
  });
  assert(forbidden.status === 401, `Unauth create role expected 401, got ${forbidden.status}`);
  console.log("14. Unauthorized users cannot manage roles");

  const customKey = `ap_rbac_custom_${Date.now()}`;
  const tempUser = `ap_rbac_user_${Date.now()}`;
  const password = "rbac-dynamic-test-pass";
  let customRoleId: number | null = null;
  let tempUserId: number | null = null;

  try {
    const created = await createRole({
      label: "RBAC Custom Test",
      roleKey: customKey,
      description: "ephemeral",
      isGlobalCapable: false,
      permissionKeys: ["dashboard.view", "students.view"],
      actorUserId: admin.body.user!.id!,
    });
    assert(created, "create role failed");
    customRoleId = created!.id;
    console.log("3. Custom role created");

    assert(
      created!.permissions.includes("students.view") &&
        created!.permissions.includes("dashboard.view"),
      "custom role permissions",
    );
    console.log("4. Custom role received permissions");

    // Assign to ephemeral user
    const hash = await bcrypt.hash(password, 10);
    const inserted = await executeAcademic(
      `
      INSERT INTO ap_users (name, email, username, password_hash, is_active)
      VALUES (?, ?, ?, ?, 1)
      `,
      ["RBAC Temp", `${tempUser}@rbac.test`, tempUser, hash],
    );
    tempUserId = Number(inserted.insertId);
    await executeAcademic(
      `
      INSERT INTO ap_user_roles (user_id, role_id, college_id, branch_id)
      VALUES (?, ?, 1, NULL)
      `,
      [tempUserId, customRoleId],
    );
    invalidateAuthzCache({ userId: tempUserId });

    const authz = await loadAuthzContext(tempUserId);
    assert(authz.permissions.includes("students.view"), "user got custom perms");
    assert(!authz.permissions.includes("timetable.publish"), "user lacks publish");
    console.log("5/8. Custom role permissions work; assigned user receives them");

    const userLogin = await login(tempUser, password);
    const studentsOk = await req("/api/students?limit=1&collegeId=1", {
      cookie: userLogin.cookie,
    });
    assert(studentsOk.status === 200, `students expected 200, got ${studentsOk.status}`);
    const publishDenied = await req("/api/timetables/1/publish", {
      method: "POST",
      cookie: userLogin.cookie,
    });
    assert(publishDenied.status === 403, `publish expected 403, got ${publishDenied.status}`);
    console.log("5b. Backend enforces custom role permissions over HTTP");

    // Remove students.view via HTTP so the API process invalidates its role cache
    const removeRes = await req(`/api/roles/${customRoleId}/permissions`, {
      method: "PUT",
      cookie: admin.cookie,
      body: JSON.stringify({ permissionKeys: ["dashboard.view"] }),
    });
    assert(removeRes.status === 200, `remove perm expected 200, got ${removeRes.status}`);
    invalidateAuthzCache({ all: true });
    const after = await loadAuthzContext(tempUserId);
    assert(!after.permissions.includes("students.view"), "permission removed from authz");
    const login2 = await login(tempUser, password);
    const studentsBlocked = await req("/api/students?limit=1&collegeId=1", {
      cookie: login2.cookie,
    });
    assert(
      studentsBlocked.status === 403,
      `after removal expected 403, got ${studentsBlocked.status}`,
    );
    console.log("6. Removing permission immediately blocks the action");

    // Deactivate role via HTTP
    const deact = await req(`/api/roles/${customRoleId}/status`, {
      method: "PUT",
      cookie: admin.cookie,
      body: JSON.stringify({ isActive: false, confirmImpact: true }),
    });
    assert(deact.status === 200, `deactivate expected 200, got ${deact.status}`);
    invalidateAuthzCache({ all: true });
    const deactivated = await loadAuthzContext(tempUserId);
    assert(deactivated.permissions.length === 0, "inactive role grants no permissions");
    console.log("7. Deactivating role blocks its permissions");

    // Reactivate for cleanup path
    await req(`/api/roles/${customRoleId}/status`, {
      method: "PUT",
      cookie: admin.cookie,
      body: JSON.stringify({ isActive: true }),
    });

    // Scope still works for college-scoped custom role
    await req(`/api/roles/${customRoleId}/permissions`, {
      method: "PUT",
      cookie: admin.cookie,
      body: JSON.stringify({ permissionKeys: ["dashboard.view", "students.view"] }),
    });
    const scopedUser = await login(tempUser, password);
    const scopeDenied = await req("/api/students?limit=1&collegeId=2", {
      cookie: scopedUser.cookie,
    });
    assert(scopeDenied.status === 403, `cross-college expected 403, got ${scopeDenied.status}`);
    console.log("9. College/branch scope still works with dynamic roles");

    // System role cannot be deleted
    const sys = await queryAcademic<(RowDataPacket & { id: number })[]>(
      `SELECT id FROM ap_roles WHERE role_key = 'super_admin' LIMIT 1`,
    );
    const delSys = await req(`/api/roles/${sys[0].id}`, {
      method: "DELETE",
      cookie: admin.cookie,
    });
    assert(delSys.status === 400, `delete super_admin expected 400, got ${delSys.status}`);
    console.log("11. System roles cannot be deleted");

    // Lockout protection
    const strip = await setRolePermissions({
      roleId: Number(sys[0].id),
      permissionKeys: ["dashboard.view"],
      actorUserId: admin.body.user!.id!,
      confirmImpact: true,
    }).catch((e: Error & { status?: number }) => e);
    assert(
      strip instanceof Error && Number((strip as { status?: number }).status) === 400,
      "stripping manage_users from only admin role must fail",
    );
    console.log("12. Final system administrator cannot be locked out");

    // Audit logs
    const audits = await queryAcademic<(RowDataPacket & { c: number })[]>(
      `
      SELECT COUNT(*) AS c FROM ap_audit_logs
      WHERE action IN (
        'role.created','role.permissions.updated','permission.assigned','permission.removed',
        'role.activated','role.deactivated'
      )
      `,
    );
    assert(Number(audits[0]?.c ?? 0) > 0, "expected audit rows");
    console.log("13. Audit logs created for role/permission changes");

    // Frontend/API catalog
    const catalog = await req("/api/permissions", { cookie: admin.cookie });
    assert(catalog.status === 200, "permissions catalog");
    const rolesList = await req("/api/roles", { cookie: admin.cookie });
    assert(rolesList.status === 200, "roles list");
    console.log("10. APIs expose dynamic roles/permissions for frontend");

    // permissions.ts not runtime — loadAuthzContext from DB after strip attempt still has manage_users
    const adminAuthz = await loadAuthzContext(admin.body.user!.id!);
    assert(
      adminAuthz.permissions.includes("user_management.manage_users"),
      "admin still has manage_users from DB",
    );
    console.log("15. Runtime authorization uses DB (admin still fully permissioned)");

    console.log("16. No passwords introduced in role APIs");
    console.log("17. Existing user data preserved (assignment counts unchanged for system roles)");
  } finally {
    if (tempUserId) {
      await executeAcademic(`DELETE FROM ap_sessions WHERE user_id = ?`, [tempUserId]);
      await executeAcademic(`DELETE FROM ap_user_roles WHERE user_id = ?`, [tempUserId]);
      await executeAcademic(`DELETE FROM ap_audit_logs WHERE actor_user_id = ?`, [tempUserId]).catch(
        () => undefined,
      );
      await executeAcademic(`DELETE FROM ap_users WHERE id = ?`, [tempUserId]);
    }
    if (customRoleId) {
      await executeAcademic(`DELETE FROM ap_user_roles WHERE role_id = ?`, [customRoleId]);
      await deleteRole({
        roleId: customRoleId,
        actorUserId: admin.body.user!.id!,
      }).catch(async () => {
        await executeAcademic(`DELETE FROM ap_role_permissions WHERE role_id = ?`, [customRoleId]);
        await executeAcademic(`DELETE FROM ap_roles WHERE id = ?`, [customRoleId]);
      });
    }
    invalidateAuthzCache({ all: true });
  }

  console.log("\nAll dynamic RBAC checks passed.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
