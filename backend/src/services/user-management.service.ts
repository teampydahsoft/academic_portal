import type { RowDataPacket } from "mysql2";
import { ObjectId } from "mongodb";
import { executeAcademic, getHrmsDb, queryAcademic, queryStudent } from "../db/pools.js";
import {
  invalidateAuthzCache,
  loadAuthzContext,
} from "../authz/authorization.service.js";
import { revokeAllSessionsForUser } from "./auth.service.js";
import { writeAuditLog } from "./audit.service.js";
import { assertAssignableRole, listManagedRoles } from "./role-management.service.js";
import {
  extractEmployeeEmail,
  extractHrmsStaffProfile,
  HRMS_EMPLOYEE_PROJECTION,
  loadHrmsOrgLookups,
} from "./hrms-staff.service.js";
import { mysqlDateTimeToIso } from "../lib/mysql-datetime.js";

export type UserListFilters = {
  q?: string;
  roleKey?: string;
  status?: "active" | "inactive" | "all";
  collegeId?: number;
  branchId?: number;
  limit?: number;
  offset?: number;
};

export type RoleAssignmentDto = {
  id: number;
  roleId: number;
  roleKey: string;
  label: string;
  collegeId: number | null;
  collegeName: string | null;
  branchId: number | null;
  branchName: string | null;
  createdAt: string | null;
};

export type ManagedUserListItem = {
  id: number;
  name: string;
  email: string | null;
  username: string;
  hrmsEmployeeId: string | null;
  isActive: boolean;
  isLocalBootstrap: boolean;
  roles: RoleAssignmentDto[];
  lastLoginAt: string | null;
};

export type ManagedUserDetail = ManagedUserListItem & {
  permissions: string[];
  createdAt: string | null;
  updatedAt: string | null;
};

export type HrmsCandidate = {
  /** Stable key for import/link — HRMS employee document ref (`employee:<oid>`). */
  hrmsUserId: string;
  name: string;
  email: string | null;
  employeeId: string | null;
  department?: string | null;
  designation?: string | null;
  isActive: boolean;
  alreadyLinked: boolean;
  /** False when inactive or already linked. HRMS login is NOT required to create portal access. */
  canLink: boolean;
  linkBlockReason?: string | null;
  /** Informational: whether a matching HRMS `users` login exists (password source for sign-in). */
  hasHrmsLogin?: boolean;
};

type ApUserRow = RowDataPacket & {
  id: number;
  name: string;
  email: string | null;
  username: string;
  hrms_employee_id: string | null;
  password_hash: string | null;
  is_active: number;
  created_at?: string | Date | null;
  updated_at?: string | Date | null;
  last_login_at?: string | Date | null;
};

type RoleRow = RowDataPacket & {
  assignment_id: number;
  user_id: number;
  role_id: number;
  role_key: string;
  label: string;
  college_id: number | null;
  branch_id: number | null;
  created_at: string | Date | null;
};

type HrmsUserDoc = {
  _id: ObjectId;
  email?: string | null;
  name?: string | null;
  username?: string | null;
  userName?: string | null;
  isActive?: boolean;
  employeeId?: string | number | null;
  employeeRef?: unknown;
};

function text(value: unknown): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function idFromValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "object") {
    const maybe = value as { toHexString?: () => string; toString?: () => string };
    if (typeof maybe.toHexString === "function") return maybe.toHexString();
    if (typeof maybe.toString === "function") {
      const asText = maybe.toString();
      if (/^[a-f0-9]{24}$/i.test(asText)) return asText;
    }
  }
  if (typeof value === "string" || typeof value === "number") {
    const t = String(value).trim();
    return t || null;
  }
  return null;
}

function iso(value: string | Date | null | undefined): string | null {
  return mysqlDateTimeToIso(value);
}

function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}

function isBootstrapSuperAdminUser(
  user: Pick<ManagedUserDetail, "isLocalBootstrap" | "roles">,
): boolean {
  return user.isLocalBootstrap && user.roles.some((r) => r.roleKey === "system_admin");
}

function assertBootstrapSuperAdminRolesLocked(
  user: Pick<ManagedUserDetail, "isLocalBootstrap" | "roles">,
): void {
  if (isBootstrapSuperAdminUser(user)) {
    fail(400, "Super Admin bootstrap role and scope cannot be changed");
  }
}

async function loadCollegeBranchMaps() {
  const [colleges, branches] = await Promise.all([
    queryStudent<(RowDataPacket & { id: number; name: string })[]>(
      `SELECT id, name FROM colleges`,
    ),
    queryStudent<(RowDataPacket & { id: number; name: string })[]>(
      `SELECT id, name FROM course_branches`,
    ),
  ]);
  const collegeById = new Map(colleges.map((c) => [Number(c.id), String(c.name)]));
  const branchById = new Map(branches.map((b) => [Number(b.id), String(b.name)]));
  return { collegeById, branchById };
}

function mapAssignment(
  row: RoleRow,
  collegeById: Map<number, string>,
  branchById: Map<number, string>,
): RoleAssignmentDto {
  const collegeId = row.college_id == null ? null : Number(row.college_id);
  const branchId = row.branch_id == null ? null : Number(row.branch_id);
  return {
    id: Number(row.assignment_id),
    roleId: Number(row.role_id),
    roleKey: String(row.role_key),
    label: String(row.label),
    collegeId,
    collegeName: collegeId == null ? null : collegeById.get(collegeId) ?? `College #${collegeId}`,
    branchId,
    branchName: branchId == null ? null : branchById.get(branchId) ?? `Branch #${branchId}`,
    createdAt: iso(row.created_at),
  };
}

async function loadAssignmentsForUsers(userIds: number[]) {
  if (!userIds.length) return new Map<number, RoleAssignmentDto[]>();
  const { collegeById, branchById } = await loadCollegeBranchMaps();
  const placeholders = userIds.map(() => "?").join(",");
  const rows = await queryAcademic<RoleRow[]>(
    `
    SELECT
      ur.id AS assignment_id,
      ur.user_id,
      ur.role_id,
      r.role_key,
      r.label,
      ur.college_id,
      ur.branch_id,
      ur.created_at
    FROM ap_user_roles ur
    INNER JOIN ap_roles r ON r.id = ur.role_id
    WHERE ur.user_id IN (${placeholders})
    ORDER BY r.role_key, ur.id
    `,
    userIds,
  );

  const map = new Map<number, RoleAssignmentDto[]>();
  for (const row of rows) {
    const userId = Number(row.user_id);
    const list = map.get(userId) ?? [];
    list.push(mapAssignment(row, collegeById, branchById));
    map.set(userId, list);
  }
  return map;
}

function mapListItem(row: ApUserRow, roles: RoleAssignmentDto[]): ManagedUserListItem {
  return {
    id: Number(row.id),
    name: String(row.name),
    email: text(row.email),
    username: String(row.username),
    hrmsEmployeeId: text(row.hrms_employee_id),
    isActive: Number(row.is_active) === 1,
    isLocalBootstrap: Boolean(text(row.password_hash)) && !text(row.hrms_employee_id),
    roles,
    lastLoginAt: iso(row.last_login_at),
  };
}

export async function listManagedUsers(filters: UserListFilters = {}) {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);
  const where: string[] = ["1=1"];
  const params: unknown[] = [];

  const q = text(filters.q);
  if (q) {
    const like = `%${q}%`;
    where.push(`(
      u.name LIKE ? OR u.email LIKE ? OR u.username LIKE ? OR u.hrms_employee_id LIKE ?
    )`);
    params.push(like, like, like, like);
  }

  if (filters.status === "active") {
    where.push("u.is_active = 1");
  } else if (filters.status === "inactive") {
    where.push("u.is_active = 0");
  }

  if (filters.roleKey) {
    where.push(`EXISTS (
      SELECT 1 FROM ap_user_roles ur2
      INNER JOIN ap_roles r2 ON r2.id = ur2.role_id
      WHERE ur2.user_id = u.id AND r2.role_key = ?
    )`);
    params.push(filters.roleKey);
  }

  if (filters.collegeId != null) {
    where.push(`EXISTS (
      SELECT 1 FROM ap_user_roles ur3
      WHERE ur3.user_id = u.id AND ur3.college_id = ?
    )`);
    params.push(filters.collegeId);
  }

  if (filters.branchId != null) {
    where.push(`EXISTS (
      SELECT 1 FROM ap_user_roles ur4
      WHERE ur4.user_id = u.id AND ur4.branch_id = ?
    )`);
    params.push(filters.branchId);
  }

  const whereSql = where.join(" AND ");

  const [countRows, rows] = await Promise.all([
    queryAcademic<(RowDataPacket & { total: number })[]>(
      `SELECT COUNT(*) AS total FROM ap_users u WHERE ${whereSql}`,
      params,
    ),
    queryAcademic<ApUserRow[]>(
      `
      SELECT
        u.id, u.name, u.email, u.username, u.hrms_employee_id, u.password_hash, u.is_active,
        u.created_at, u.updated_at,
        (
          SELECT MAX(COALESCE(s.last_seen_at, s.created_at))
          FROM ap_sessions s
          WHERE s.user_id = u.id
        ) AS last_login_at
      FROM ap_users u
      WHERE ${whereSql}
      ORDER BY u.name ASC, u.id ASC
      LIMIT ? OFFSET ?
      `,
      [...params, limit, offset],
    ),
  ]);

  const assignments = await loadAssignmentsForUsers(rows.map((r) => Number(r.id)));
  return {
    data: rows.map((row) => mapListItem(row, assignments.get(Number(row.id)) ?? [])),
    total: Number(countRows[0]?.total ?? 0),
    limit,
    offset,
  };
}

export async function getManagedUser(userId: number): Promise<ManagedUserDetail | null> {
  const rows = await queryAcademic<ApUserRow[]>(
    `
    SELECT
      u.id, u.name, u.email, u.username, u.hrms_employee_id, u.password_hash, u.is_active,
      u.created_at, u.updated_at,
      (
        SELECT MAX(COALESCE(s.last_seen_at, s.created_at))
        FROM ap_sessions s
        WHERE s.user_id = u.id
      ) AS last_login_at
    FROM ap_users u
    WHERE u.id = ?
    LIMIT 1
    `,
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  const assignments = await loadAssignmentsForUsers([userId]);
  const roles = assignments.get(userId) ?? [];
  const authz = await loadAuthzContext(userId);
  return {
    ...mapListItem(row, roles),
    permissions: authz.permissions,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export async function listApRoles() {
  const roles = await listManagedRoles(false);
  return roles.map((role) => ({
    id: role.id,
    roleKey: role.roleKey,
    label: role.label,
    description: role.description,
    isGlobalCapable: role.isGlobalCapable,
    isSystemRole: role.isSystemRole,
    isActive: role.isActive,
    permissions: role.permissions,
  }));
}

export async function validateRoleScope(input: {
  roleKey: string;
  collegeId: number | null;
  branchId: number | null;
}) {
  const meta = await assertAssignableRole(input.roleKey);
  const roleKey = meta.roleKey;
  const collegeId = input.collegeId;
  const branchId = input.branchId;

  if (branchId != null && collegeId == null) {
    fail(400, "branchId requires collegeId");
  }

  if (collegeId != null && !Number.isFinite(collegeId)) {
    fail(400, "Invalid collegeId");
  }
  if (branchId != null && !Number.isFinite(branchId)) {
    fail(400, "Invalid branchId");
  }

  if (meta.isGlobalCapable) {
    if (collegeId != null || branchId != null) {
      fail(
        400,
        `${roleKey} is a global-capable role and must be assigned with NULL college and NULL branch`,
      );
    }
    return { roleKey, collegeId: null as null, branchId: null as null };
  }

  if (collegeId == null) {
    fail(400, `${roleKey} requires a college scope`);
  }

  return { roleKey, collegeId, branchId };
}

async function getRoleId(roleKey: string) {
  const rows = await queryAcademic<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM ap_roles WHERE role_key = ? LIMIT 1`,
    [roleKey],
  );
  if (!rows[0]) fail(400, `Role ${roleKey} not found`);
  return Number(rows[0].id);
}

async function loadLinkedHrmsKeys() {
  const linked = await queryAcademic<
    (RowDataPacket & { hrms_employee_id: string | null; email: string | null; username: string })[]
  >(`SELECT hrms_employee_id, email, username FROM ap_users`);
  const linkedKeys = new Set<string>();
  for (const row of linked) {
    if (row.hrms_employee_id) linkedKeys.add(`emp:${row.hrms_employee_id}`);
    if (row.email) linkedKeys.add(`email:${String(row.email).toLowerCase()}`);
    if (row.username) linkedKeys.add(`user:${String(row.username).toLowerCase()}`);
  }
  return linkedKeys;
}

function employeeIdMatchFilters(query: string, exactOnly: boolean): Record<string, unknown>[] {
  if (exactOnly) {
    const filters: Record<string, unknown>[] = [
      { employeeId: query },
      { emp_no: query },
      { employeeCode: query },
      { empCode: query },
    ];
    const n = Number(query);
    if (Number.isFinite(n)) {
      filters.push({ employeeId: n }, { emp_no: n });
    }
    return filters;
  }

  const safe = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const filters: Record<string, unknown>[] = [
    { employeeId: query },
    { emp_no: query },
    { employeeCode: query },
    { empCode: query },
    { employeeId: { $regex: safe, $options: "i" } },
    { emp_no: { $regex: safe, $options: "i" } },
    { employeeCode: { $regex: safe, $options: "i" } },
  ];
  if (/^\d+$/.test(query)) {
    filters.push({ employeeId: Number(query) }, { emp_no: Number(query) });
  }
  return filters;
}

function candidateScore(query: string, candidate: HrmsCandidate): number {
  const q = query.toLowerCase();
  let score = 0;
  const emp = candidate.employeeId?.toLowerCase() ?? "";
  const name = candidate.name.toLowerCase();
  const email = candidate.email?.toLowerCase() ?? "";

  if (emp === q) score += 100;
  else if (emp.startsWith(q)) score += 60;
  else if (emp.includes(q)) score += 30;

  if (name === q) score += 80;
  else if (name.startsWith(q)) score += 50;
  else if (name.includes(q)) score += 25;

  if (email === q) score += 70;
  else if (email.includes(q)) score += 20;

  if (candidate.canLink) score += 10;
  if (candidate.alreadyLinked) score -= 50;
  return score;
}

function mapEmployeeCandidate(
  empDoc: Record<string, unknown>,
  profile: ReturnType<typeof extractHrmsStaffProfile>,
  linkedKeys: Set<string>,
  hasHrmsLogin: boolean,
): HrmsCandidate {
  const employeeId = profile.hrmsId;
  const email = extractEmployeeEmail(empDoc);
  const alreadyLinked =
    linkedKeys.has(`emp:${employeeId}`) ||
    (email ? linkedKeys.has(`email:${email}`) : false);

  let linkBlockReason: string | null = null;
  if (alreadyLinked) linkBlockReason = "Already linked to Academic Portal";
  else if (!profile.isActive) linkBlockReason = "Employee is inactive in HRMS";

  return {
    hrmsUserId: `employee:${String(empDoc._id)}`,
    name: profile.name,
    email,
    employeeId,
    department: profile.department !== "—" ? profile.department : null,
    designation: profile.designation !== "—" ? profile.designation : null,
    isActive: profile.isActive,
    alreadyLinked,
    canLink: !alreadyLinked && profile.isActive,
    linkBlockReason,
    hasHrmsLogin,
  };
}

/**
 * Search HRMS **employees** only (not the HRMS `users` collection).
 * HRMS login roles are unrelated — Academic Portal roles are assigned here.
 * Password for sign-in still comes from HRMS `users` when that login exists.
 */
export async function searchHrmsCandidates(q: string, limit = 20): Promise<HrmsCandidate[]> {
  const query = text(q);
  if (!query || query.length < 2) return [];

  const db = await getHrmsDb();
  const users = db.collection<HrmsUserDoc>("users");
  const employees = db.collection("employees");
  const safe = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const cap = Math.min(Math.max(limit, 1), 50);
  const numericOnly = /^\d+$/.test(query);

  const empOr: Record<string, unknown>[] = numericOnly
    ? employeeIdMatchFilters(query, true)
    : [
        { employee_name: { $regex: safe, $options: "i" } },
        { employeeName: { $regex: safe, $options: "i" } },
        { name: { $regex: safe, $options: "i" } },
        { fullName: { $regex: safe, $options: "i" } },
        { firstName: { $regex: safe, $options: "i" } },
        { lastName: { $regex: safe, $options: "i" } },
        { email: { $regex: safe, $options: "i" } },
        { official_email: { $regex: safe, $options: "i" } },
        { personal_email: { $regex: safe, $options: "i" } },
        ...employeeIdMatchFilters(query, false),
      ];
  if (ObjectId.isValid(query)) {
    empOr.push({ _id: new ObjectId(query) });
  }

  const [empDocs, linkedKeys, lookups] = await Promise.all([
    employees
      .find({ $or: empOr })
      .project(HRMS_EMPLOYEE_PROJECTION)
      .limit(cap)
      .toArray(),
    loadLinkedHrmsKeys(),
    loadHrmsOrgLookups(db),
  ]);

  // Optional: detect whether a matching HRMS login exists (for sign-in later).
  const loginOr: Record<string, unknown>[] = [];
  for (const raw of empDocs) {
    const empOid = raw._id as ObjectId | undefined;
    const empNo = text(raw.emp_no ?? raw.employeeId ?? raw.employeeCode ?? raw.empCode);
    const empEmail = extractEmployeeEmail(raw as Record<string, unknown>);
    if (empOid) loginOr.push({ employeeRef: empOid });
    if (empNo) {
      loginOr.push({ employeeId: empNo });
      if (/^\d+$/.test(empNo)) loginOr.push({ employeeId: Number(empNo) });
    }
    if (empEmail) {
      loginOr.push({
        email: {
          $regex: `^${empEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
          $options: "i",
        },
      });
    }
  }
  const loginUsers =
    loginOr.length > 0
      ? await users
          .find({ $or: loginOr })
          .project({ email: 1, employeeId: 1, employeeRef: 1 })
          .toArray()
      : [];

  const loginByEmpNo = new Set<string>();
  const loginByEmpRef = new Set<string>();
  const loginByEmail = new Set<string>();
  for (const user of loginUsers) {
    const empNo = text(user.employeeId);
    if (empNo) loginByEmpNo.add(empNo);
    const ref = idFromValue(user.employeeRef);
    if (ref) loginByEmpRef.add(ref);
    const userEmail = text(user.email)?.toLowerCase();
    if (userEmail) loginByEmail.add(userEmail);
  }

  const results: HrmsCandidate[] = [];
  for (const raw of empDocs) {
    const profile = extractHrmsStaffProfile(raw as Record<string, unknown>, lookups);
    const empNo = text(raw.emp_no ?? raw.employeeId ?? raw.employeeCode ?? raw.empCode);
    const empRef = idFromValue(raw._id);
    const empEmail = extractEmployeeEmail(raw as Record<string, unknown>);
    const usersLogin = Boolean(
      (empNo && loginByEmpNo.has(empNo)) ||
        (empRef && loginByEmpRef.has(empRef)) ||
        (empEmail && loginByEmail.has(empEmail)),
    );
    const empPassword = text(raw.password);
    const hasEmployeePassword = Boolean(empPassword && empPassword.startsWith("$2"));
    // Staff can sign in with employees.password and/or a matching users login.
    const hasHrmsLogin = usersLogin || hasEmployeePassword;
    results.push(
      mapEmployeeCandidate(raw as Record<string, unknown>, profile, linkedKeys, hasHrmsLogin),
    );
  }

  return results
    .sort((a, b) => candidateScore(query, b) - candidateScore(query, a))
    .slice(0, cap);
}

async function findHrmsEmployeeByKey(key: string): Promise<Record<string, unknown> | null> {
  const db = await getHrmsDb();
  const employees = db.collection("employees");
  const trimmed = key.trim();
  if (!trimmed) return null;

  const oidText = trimmed.startsWith("employee:") ? trimmed.slice("employee:".length) : trimmed;
  if (ObjectId.isValid(oidText)) {
    const byId = await employees.findOne(
      { _id: new ObjectId(oidText) },
      { projection: HRMS_EMPLOYEE_PROJECTION },
    );
    if (byId) return byId as Record<string, unknown>;
  }

  const empFilters = employeeIdMatchFilters(trimmed, /^\d+$/.test(trimmed));
  const byEmpNo = await employees.findOne(
    { $or: empFilters },
    { projection: HRMS_EMPLOYEE_PROJECTION },
  );
  return (byEmpNo as Record<string, unknown> | null) ?? null;
}

export async function linkHrmsUser(input: {
  hrmsUserId: string;
  roleKey: string;
  /** Single-scope (legacy) — used when `scopes` is omitted. */
  collegeId?: number | null;
  branchId?: number | null;
  /**
   * Multi-scope: one role assignment per college/branch pair.
   * Use `{ collegeId, branchId: null }` for all branches in that college.
   * Global roles must pass a single `{ collegeId: null, branchId: null }`.
   */
  scopes?: Array<{ collegeId?: number | null; branchId?: number | null }>;
  isActive?: boolean;
  actorUserId: number;
  ipAddress?: string | null;
}) {
  const rawScopes =
    Array.isArray(input.scopes) && input.scopes.length > 0
      ? input.scopes
      : [{ collegeId: input.collegeId ?? null, branchId: input.branchId ?? null }];

  const validatedScopes = [];
  for (const raw of rawScopes) {
    validatedScopes.push(
      await validateRoleScope({
        roleKey: input.roleKey,
        collegeId: raw.collegeId ?? null,
        branchId: raw.branchId ?? null,
      }),
    );
  }

  // Deduplicate identical college/branch pairs
  const uniqueScopes = new Map<string, (typeof validatedScopes)[number]>();
  for (const scope of validatedScopes) {
    uniqueScopes.set(`${scope.collegeId ?? "null"}:${scope.branchId ?? "null"}`, scope);
  }
  const scopes = [...uniqueScopes.values()];
  if (!scopes.length) fail(400, "At least one access scope is required");

  // For non-global roles, prevent mixing "all branches" with specific branches for the same college
  const byCollege = new Map<number, Array<number | null>>();
  for (const scope of scopes) {
    if (scope.collegeId == null) continue;
    const list = byCollege.get(scope.collegeId) ?? [];
    list.push(scope.branchId);
    byCollege.set(scope.collegeId, list);
  }
  for (const [collegeId, branchIds] of byCollege) {
    const hasAll = branchIds.some((b) => b == null);
    const hasSpecific = branchIds.some((b) => b != null);
    if (hasAll && hasSpecific) {
      fail(
        400,
        `College #${collegeId}: choose either all branches or specific branches, not both`,
      );
    }
  }

  const primary = scopes[0]!;

  // Identity from HRMS employees collection (not HRMS users / HRMS roles).
  const empDoc = await findHrmsEmployeeByKey(input.hrmsUserId);
  if (!empDoc) fail(404, "HRMS employee not found");

  const db = await getHrmsDb();
  const lookups = await loadHrmsOrgLookups(db);
  const profile = extractHrmsStaffProfile(empDoc, lookups);
  if (!profile.isActive) fail(400, "Employee is inactive in HRMS");

  const email = extractEmployeeEmail(empDoc);
  const name = profile.name;
  const hrmsEmployeeId = profile.hrmsId;
  const username = email || `emp_${hrmsEmployeeId}`;

  const existing = await queryAcademic<ApUserRow[]>(
    `
    SELECT id, name, email, username, hrms_employee_id, password_hash, is_active
    FROM ap_users
    WHERE username = ?
       OR (? IS NOT NULL AND email = ?)
       OR (hrms_employee_id IS NOT NULL AND hrms_employee_id = ?)
    LIMIT 1
    `,
    [username, email, email, hrmsEmployeeId],
  );
  if (existing[0]) {
    fail(409, "This HRMS employee is already linked to an Academic Portal account");
  }

  const isActive = input.isActive === false ? 0 : 1;
  const inserted = await executeAcademic(
    `
    INSERT INTO ap_users (name, email, username, password_hash, hrms_employee_id, is_active)
    VALUES (?, ?, ?, NULL, ?, ?)
    `,
    [name, email, username, hrmsEmployeeId, isActive],
  );
  const userId = Number(inserted.insertId);
  const roleId = await getRoleId(primary.roleKey);

  for (const scope of scopes) {
    await executeAcademic(
      `
      INSERT INTO ap_user_roles (user_id, role_id, college_id, branch_id)
      VALUES (?, ?, ?, ?)
      `,
      [userId, roleId, scope.collegeId, scope.branchId],
    );
  }

  await writeAuditLog({
    actorUserId: input.actorUserId,
    action: "user.linked",
    entityType: "ap_user",
    entityId: userId,
    newValue: {
      hrmsEmployeeKey: `employee:${String(empDoc._id)}`,
      hrmsEmployeeId,
      name,
      email,
      roleKey: primary.roleKey,
      scopes: scopes.map((s) => ({ collegeId: s.collegeId, branchId: s.branchId })),
      isActive: isActive === 1,
    },
    ipAddress: input.ipAddress,
  });

  await writeAuditLog({
    actorUserId: input.actorUserId,
    action: "role.assigned",
    entityType: "ap_user",
    entityId: userId,
    newValue: {
      roleKey: primary.roleKey,
      scopes: scopes.map((s) => ({ collegeId: s.collegeId, branchId: s.branchId })),
    },
    ipAddress: input.ipAddress,
  });

  invalidateAuthzCache({ userId });
  return getManagedUser(userId);
}

export async function replaceUserRoles(input: {
  userId: number;
  assignments: Array<{ roleKey: string; collegeId: number | null; branchId: number | null }>;
  actorUserId: number;
  ipAddress?: string | null;
}) {
  const existing = await getManagedUser(input.userId);
  if (!existing) fail(404, "User not found");
  assertBootstrapSuperAdminRolesLocked(existing);

  const normalized = await Promise.all(
    input.assignments.map((a) =>
      validateRoleScope({
        roleKey: a.roleKey,
        collegeId: a.collegeId,
        branchId: a.branchId,
      }),
    ),
  );

  // Deduplicate identical role+scope tuples
  const seen = new Set<string>();
  const unique = normalized.filter((a) => {
    const key = `${a.roleKey}:${a.collegeId ?? "null"}:${a.branchId ?? "null"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Same college cannot mix "all branches" with specific branches for the same role
  const byRoleCollege = new Map<string, Array<number | null>>();
  for (const a of unique) {
    if (a.collegeId == null) continue;
    const key = `${a.roleKey}:${a.collegeId}`;
    const list = byRoleCollege.get(key) ?? [];
    list.push(a.branchId);
    byRoleCollege.set(key, list);
  }
  for (const [key, branchIds] of byRoleCollege) {
    const hasAll = branchIds.some((b) => b == null);
    const hasSpecific = branchIds.some((b) => b != null);
    if (hasAll && hasSpecific) {
      fail(
        400,
        `${key}: choose either all branches or specific branches for a college, not both`,
      );
    }
  }

  await executeAcademic(`DELETE FROM ap_user_roles WHERE user_id = ?`, [input.userId]);
  for (const assignment of unique) {
    const roleId = await getRoleId(assignment.roleKey);
    await executeAcademic(
      `
      INSERT INTO ap_user_roles (user_id, role_id, college_id, branch_id)
      VALUES (?, ?, ?, ?)
      `,
      [input.userId, roleId, assignment.collegeId, assignment.branchId],
    );
  }

  const revoked = await revokeAllSessionsForUser(input.userId);
  invalidateAuthzCache({ userId: input.userId });
  await writeAuditLog({
    actorUserId: input.actorUserId,
    action: "roles.replaced",
    entityType: "ap_user",
    entityId: input.userId,
    oldValue: {
      roles: existing.roles.map((r) => ({
        roleKey: r.roleKey,
        collegeId: r.collegeId,
        branchId: r.branchId,
      })),
    },
    newValue: {
      roles: unique,
      sessionsRevoked: revoked,
    },
    ipAddress: input.ipAddress,
  });
  if (revoked > 0) {
    await writeAuditLog({
      actorUserId: input.actorUserId,
      action: "sessions.revoked",
      entityType: "ap_user",
      entityId: input.userId,
      newValue: { count: revoked, reason: "roles.replaced" },
      ipAddress: input.ipAddress,
    });
  }

  return getManagedUser(input.userId);
}

export async function updateUserAssignmentScope(input: {
  userId: number;
  assignmentId: number;
  collegeId: number | null;
  branchId: number | null;
  actorUserId: number;
  ipAddress?: string | null;
}) {
  const rows = await queryAcademic<
    (RowDataPacket & {
      id: number;
      user_id: number;
      role_key: string;
      college_id: number | null;
      branch_id: number | null;
    })[]
  >(
    `
    SELECT ur.id, ur.user_id, r.role_key, ur.college_id, ur.branch_id
    FROM ap_user_roles ur
    INNER JOIN ap_roles r ON r.id = ur.role_id
    WHERE ur.id = ? AND ur.user_id = ?
    LIMIT 1
    `,
    [input.assignmentId, input.userId],
  );
  const row = rows[0];
  if (!row) fail(404, "Role assignment not found");

  const existing = await getManagedUser(input.userId);
  if (!existing) fail(404, "User not found");
  assertBootstrapSuperAdminRolesLocked(existing);

  const scope = await validateRoleScope({
    roleKey: String(row.role_key),
    collegeId: input.collegeId,
    branchId: input.branchId,
  });

  await executeAcademic(
    `
    UPDATE ap_user_roles
    SET college_id = ?, branch_id = ?
    WHERE id = ? AND user_id = ?
    `,
    [scope.collegeId, scope.branchId, input.assignmentId, input.userId],
  );

  const revoked = await revokeAllSessionsForUser(input.userId);
  invalidateAuthzCache({ userId: input.userId });
  await writeAuditLog({
    actorUserId: input.actorUserId,
    action: "scope.changed",
    entityType: "ap_user_role",
    entityId: input.assignmentId,
    oldValue: {
      userId: input.userId,
      roleKey: row.role_key,
      collegeId: row.college_id,
      branchId: row.branch_id,
    },
    newValue: {
      userId: input.userId,
      roleKey: scope.roleKey,
      collegeId: scope.collegeId,
      branchId: scope.branchId,
      sessionsRevoked: revoked,
    },
    ipAddress: input.ipAddress,
  });
  if (revoked > 0) {
    await writeAuditLog({
      actorUserId: input.actorUserId,
      action: "sessions.revoked",
      entityType: "ap_user",
      entityId: input.userId,
      newValue: { count: revoked, reason: "scope.changed" },
      ipAddress: input.ipAddress,
    });
  }

  return getManagedUser(input.userId);
}

export async function setUserActiveStatus(input: {
  userId: number;
  isActive: boolean;
  actorUserId: number;
  ipAddress?: string | null;
}) {
  const existing = await getManagedUser(input.userId);
  if (!existing) fail(404, "User not found");

  if (input.userId === input.actorUserId && !input.isActive) {
    fail(400, "You cannot deactivate your own account");
  }
  if (!input.isActive && isBootstrapSuperAdminUser(existing)) {
    fail(400, "Super Admin bootstrap account cannot be deactivated");
  }

  await executeAcademic(
    `UPDATE ap_users SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [input.isActive ? 1 : 0, input.userId],
  );

  let revoked = 0;
  if (!input.isActive) {
    revoked = await revokeAllSessionsForUser(input.userId);
  }
  invalidateAuthzCache({ userId: input.userId });

  await writeAuditLog({
    actorUserId: input.actorUserId,
    action: input.isActive ? "user.activated" : "user.deactivated",
    entityType: "ap_user",
    entityId: input.userId,
    oldValue: { isActive: existing.isActive },
    newValue: { isActive: input.isActive, sessionsRevoked: revoked },
    ipAddress: input.ipAddress,
  });

  if (revoked > 0) {
    await writeAuditLog({
      actorUserId: input.actorUserId,
      action: "sessions.revoked",
      entityType: "ap_user",
      entityId: input.userId,
      newValue: { count: revoked, reason: "user.deactivated" },
      ipAddress: input.ipAddress,
    });
  }

  return getManagedUser(input.userId);
}

/**
 * Update display/login profile fields.
 * - Local bootstrap (Super Admin): name, email, username, optional password
 * - HRMS-linked: display name only (identity/password stay in HRMS)
 */
export async function updateManagedUserProfile(input: {
  userId: number;
  actorUserId: number;
  name?: string;
  email?: string | null;
  username?: string;
  currentPassword?: string;
  newPassword?: string;
  ipAddress?: string | null;
}) {
  const existing = await getManagedUser(input.userId);
  if (!existing) fail(404, "User not found");

  const isSelf = input.userId === input.actorUserId;
  const canManage = await actorHasManageUsers(input.actorUserId);
  if (!isSelf && !canManage) {
    fail(403, "Not allowed to update this user profile");
  }

  const rows = await queryAcademic<(RowDataPacket & { password_hash: string | null })[]>(
    `SELECT password_hash FROM ap_users WHERE id = ? LIMIT 1`,
    [input.userId],
  );
  const passwordHash = text(rows[0]?.password_hash);
  const isLocalBootstrap = existing.isLocalBootstrap;

  const nextName =
    input.name !== undefined ? String(input.name).trim() : existing.name;
  if (!nextName) fail(400, "Name is required");

  let nextEmail = existing.email;
  let nextUsername = existing.username;
  let nextPasswordHash: string | null | undefined;

  if (isLocalBootstrap) {
    if (input.email !== undefined) {
      const email = String(input.email ?? "").trim().toLowerCase();
      nextEmail = email || null;
    }
    if (input.username !== undefined) {
      nextUsername = String(input.username).trim();
      if (!nextUsername) fail(400, "Username is required");
    }

    if (input.newPassword !== undefined && input.newPassword !== "") {
      if (!isSelf) {
        fail(400, "Only the account owner can change the bootstrap password");
      }
      if (!input.currentPassword) {
        fail(400, "currentPassword is required to set a new password");
      }
      if (!passwordHash) fail(400, "Account has no local password");
      const bcrypt = await import("bcryptjs");
      const ok = await bcrypt.compare(input.currentPassword, passwordHash);
      if (!ok) fail(400, "Current password is incorrect");
      if (String(input.newPassword).length < 8) {
        fail(400, "New password must be at least 8 characters");
      }
      nextPasswordHash = await bcrypt.hash(String(input.newPassword), 12);
    }
  } else if (
    input.email !== undefined ||
    input.username !== undefined ||
    (input.newPassword !== undefined && input.newPassword !== "")
  ) {
    fail(400, "HRMS-linked identity/password cannot be edited here; update in HRMS");
  }

  const dup = await queryAcademic<(RowDataPacket & { id: number })[]>(
    `
    SELECT id FROM ap_users
    WHERE id <> ?
      AND (
        LOWER(username) = LOWER(?)
        OR (? IS NOT NULL AND LOWER(COALESCE(email, '')) = LOWER(?))
      )
    LIMIT 1
    `,
    [input.userId, nextUsername, nextEmail, nextEmail],
  );
  if (dup[0]) fail(409, "Username or email already in use");

  if (nextPasswordHash) {
    await executeAcademic(
      `
      UPDATE ap_users
      SET name = ?, email = ?, username = ?, password_hash = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [nextName, nextEmail, nextUsername, nextPasswordHash, input.userId],
    );
  } else {
    await executeAcademic(
      `
      UPDATE ap_users
      SET name = ?, email = ?, username = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [nextName, nextEmail, nextUsername, input.userId],
    );
  }

  await writeAuditLog({
    actorUserId: input.actorUserId,
    action: "user.profile_updated",
    entityType: "ap_user",
    entityId: input.userId,
    oldValue: {
      name: existing.name,
      email: existing.email,
      username: existing.username,
      passwordChanged: false,
    },
    newValue: {
      name: nextName,
      email: nextEmail,
      username: nextUsername,
      passwordChanged: Boolean(nextPasswordHash),
    },
    ipAddress: input.ipAddress,
  });

  return getManagedUser(input.userId);
}

async function actorHasManageUsers(actorUserId: number): Promise<boolean> {
  const authz = await loadAuthzContext(actorUserId);
  return authz.permissions.includes("user_management.manage_users");
}

export async function deleteManagedUser(input: {
  userId: number;
  actorUserId: number;
  ipAddress?: string | null;
}) {
  const existing = await getManagedUser(input.userId);
  if (!existing) fail(404, "User not found");
  if (input.userId === input.actorUserId) {
    fail(400, "You cannot delete your own account");
  }
  if (existing.isLocalBootstrap) {
    fail(400, "Local Super Admin bootstrap cannot be deleted");
  }

  await revokeAllSessionsForUser(input.userId);
  await executeAcademic(`DELETE FROM ap_user_roles WHERE user_id = ?`, [input.userId]);
  await executeAcademic(`DELETE FROM ap_users WHERE id = ?`, [input.userId]);
  invalidateAuthzCache({ userId: input.userId });

  await writeAuditLog({
    actorUserId: input.actorUserId,
    action: "user.deleted",
    entityType: "ap_user",
    entityId: input.userId,
    oldValue: {
      name: existing.name,
      email: existing.email,
      username: existing.username,
      hrmsEmployeeId: existing.hrmsEmployeeId,
    },
    newValue: null,
    ipAddress: input.ipAddress,
  });

  return { deleted: true, id: input.userId };
}
