/**
 * READ-ONLY onboarding readiness discovery.
 * Does not create, link, update, or delete any records.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { getHrmsDb, queryAcademic, queryStudent } from "../db/pools.js";
import {
  extractHrmsStaffProfile,
  loadHrmsOrgLookups,
  HRMS_EMPLOYEE_PROJECTION,
} from "../services/hrms-staff.service.js";
import { GLOBAL_SCOPE_ROLES } from "../authz/permissions.js";
import { SUPER_ADMIN_SEED } from "../services/auth.service.js";
import { buildScopeFromAssignments } from "../authz/authorization.service.js";

function text(value: unknown): string | null {
  if (value == null) return null;
  const t = String(value).trim();
  return t || null;
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

type RoleKey =
  | "system_admin"
  | "management"
  | "academic_admin"
  | "principal"
  | "hod"
  | "faculty"
  | "exam_cell"
  | "auditor";

type Recommendation = {
  hrmsUserId: string;
  name: string;
  employeeId: string | null;
  email: string | null;
  department: string | null;
  designation: string | null;
  employeeGroup: string | null;
  collegeName: string | null;
  collegeId: number | null;
  collegeReliable: boolean;
  branchReliable: boolean;
  recommendedRole: RoleKey | null;
  recommendationReason: string;
  confidence: "high" | "medium" | "low" | "none";
  needsManualReview: boolean;
  needsManualScope: boolean;
  alreadyLinked: boolean;
  apUserId: number | null;
};

function recommendRole(input: {
  designation: string;
  department: string;
  employeeGroup: string;
  name: string;
  email: string | null;
}): { role: RoleKey | null; reason: string; confidence: "high" | "medium" | "low" | "none" } {
  const des = input.designation.toLowerCase();
  const dept = input.department.toLowerCase();
  const group = input.employeeGroup.toLowerCase();
  const blob = `${des} ${dept} ${group} ${input.name}`.toLowerCase();

  // Conservatively skip non-teaching unless designation is clearly academic leadership.
  const teaching =
    group.includes("teach") && !group.includes("non teach") && !group.includes("non-teach");

  // Exact-ish leadership titles — high confidence only when unambiguous.
  if (/\b(system\s*admin|it\s*admin|software)\b/.test(blob) && /admin|developer|engineer/.test(des)) {
    return {
      role: null,
      reason: "IT/system titles must not auto-map to system_admin; keep bootstrap Super Admin only",
      confidence: "none",
    };
  }

  if (/\b(principal|dean|director)\b/.test(des) && !/vice\s*principal|asst|assistant|deputy/.test(des)) {
    return { role: "principal", reason: `Designation matches principal/dean/director: ${input.designation}`, confidence: "high" };
  }
  if (/\b(vice\s*principal|deputy\s*principal)\b/.test(des)) {
    return {
      role: "principal",
      reason: `Vice/Deputy Principal — confirm whether principal role is appropriate: ${input.designation}`,
      confidence: "medium",
    };
  }

  if (/\b(hod|head of (the )?department|head of dept|dept\.?\s*head)\b/.test(des) || /^h\.?o\.?d\.?$/i.test(input.designation.trim())) {
    return { role: "hod", reason: `Designation matches HOD: ${input.designation}`, confidence: "high" };
  }

  if (/\b(exam\s*cell|controller of examination|coe|examination)\b/.test(blob)) {
    return { role: "exam_cell", reason: `Exam/COE related designation or department: ${input.designation} / ${input.department}`, confidence: "medium" };
  }

  if (/\b(academic\s*admin|dean academics|dean of academics|academic director)\b/.test(blob)) {
    return { role: "academic_admin", reason: `Academic administration title: ${input.designation}`, confidence: "medium" };
  }

  if (/\b(management|chairman|chairperson|secretary|correspondent|trustee|ceo|cfo)\b/.test(des)) {
    return { role: "management", reason: `Management-level designation: ${input.designation}`, confidence: "medium" };
  }

  if (/\b(auditor|internal audit|compliance)\b/.test(blob)) {
    return { role: "auditor", reason: `Audit/compliance related: ${input.designation}`, confidence: "medium" };
  }

  // Faculty: teaching group + common academic designations
  if (
    teaching &&
    /\b(professor|assoc\.?\s*prof|assistant professor|asst\.?\s*prof|lecturer|faculty|teacher|instructor)\b/.test(
      des,
    )
  ) {
    return { role: "faculty", reason: `Teaching group + academic designation: ${input.designation}`, confidence: "high" };
  }

  if (teaching && des && des !== "—") {
    return {
      role: "faculty",
      reason: `Teaching employee group; designation unclear for leadership — faculty candidate only: ${input.designation}`,
      confidence: "low",
    };
  }

  return {
    role: null,
    reason: "No reliable role signal from designation/department/group — manual review required",
    confidence: "none",
  };
}

async function main() {
  const db = await getHrmsDb();
  const lookups = await loadHrmsOrgLookups(db);

  const colleges = await queryStudent<(RowDataPacket & { id: number; name: string })[]>(
    `SELECT id, name FROM colleges ORDER BY id`,
  );
  const collegeByName = new Map(
    colleges.map((c) => [String(c.name).trim().toLowerCase(), Number(c.id)]),
  );

  const apUsers = await queryAcademic<
    (RowDataPacket & {
      id: number;
      name: string;
      email: string | null;
      username: string;
      hrms_employee_id: string | null;
      password_hash: string | null;
      is_active: number;
      created_at: string | Date | null;
    })[]
  >(
    `
    SELECT id, name, email, username, hrms_employee_id, password_hash, is_active, created_at
    FROM ap_users
    ORDER BY id
    `,
  );

  const apRoles = await queryAcademic<
    (RowDataPacket & {
      user_id: number;
      role_key: string;
      label: string;
      college_id: number | null;
      branch_id: number | null;
    })[]
  >(
    `
    SELECT ur.user_id, r.role_key, r.label, ur.college_id, ur.branch_id
    FROM ap_user_roles ur
    INNER JOIN ap_roles r ON r.id = ur.role_id
    ORDER BY ur.user_id, r.role_key
    `,
  );

  const rolesByUser = new Map<number, typeof apRoles>();
  for (const row of apRoles) {
    const list = rolesByUser.get(Number(row.user_id)) ?? [];
    list.push(row);
    rolesByUser.set(Number(row.user_id), list);
  }

  const hrmsUsers = await db
    .collection("users")
    .find({})
    .project({
      email: 1,
      name: 1,
      employeeId: 1,
      employeeRef: 1,
      isActive: 1,
      username: 1,
      userName: 1,
    })
    .limit(5000)
    .toArray();

  const employees = await db
    .collection("employees")
    .find({})
    .project(HRMS_EMPLOYEE_PROJECTION)
    .limit(5000)
    .toArray();

  const empById = new Map<string, ReturnType<typeof extractHrmsStaffProfile>>();
  for (const raw of employees) {
    const profile = extractHrmsStaffProfile(raw as Record<string, unknown>, lookups);
    empById.set(profile.hrmsId, profile);
    const oid = idFromValue((raw as { _id?: unknown })._id);
    if (oid) empById.set(oid, profile);
  }

  // Index AP users for linking checks
  const apByEmp = new Map<string, (typeof apUsers)[0]>();
  const apByEmail = new Map<string, (typeof apUsers)[0]>();
  const apByUsername = new Map<string, (typeof apUsers)[0]>();
  for (const u of apUsers) {
    if (u.hrms_employee_id) apByEmp.set(String(u.hrms_employee_id), u);
    if (u.email) apByEmail.set(String(u.email).toLowerCase(), u);
    if (u.username) apByUsername.set(String(u.username).toLowerCase(), u);
  }

  const recommendations: Recommendation[] = [];
  const conflicts: Array<{ kind: string; detail: string }> = [];

  let hrmsActive = 0;
  let hrmsInactive = 0;

  for (const user of hrmsUsers) {
    const hrmsUserId = String(user._id);
    const email = text(user.email)?.toLowerCase() ?? null;
    const name = text(user.name) || email || hrmsUserId;
    const employeeRef = idFromValue(user.employeeRef);
    const empNo = text(user.employeeId);
    const linkKey = employeeRef || empNo || hrmsUserId;
    const isActive = user.isActive !== false;
    if (isActive) hrmsActive += 1;
    else hrmsInactive += 1;

    const profile =
      (empNo && empById.get(empNo)) ||
      (employeeRef && empById.get(employeeRef)) ||
      empById.get(hrmsUserId) ||
      null;

    const department = profile?.department && profile.department !== "—" ? profile.department : null;
    const designation = profile?.designation && profile.designation !== "—" ? profile.designation : null;
    const employeeGroup =
      profile?.employeeGroup && profile.employeeGroup !== "—" ? profile.employeeGroup : null;
    const collegeName = profile?.college && profile.college !== "—" ? profile.college : null;
    const collegeId = collegeName ? collegeByName.get(collegeName.toLowerCase()) ?? null : null;
    const collegeReliable = Boolean(collegeName && collegeId != null);

    const rec = recommendRole({
      designation: designation ?? "",
      department: department ?? "",
      employeeGroup: employeeGroup ?? "",
      name,
      email,
    });

    const linked =
      apByEmp.get(linkKey) ||
      (email ? apByEmail.get(email) : undefined) ||
      (email ? apByUsername.get(email) : undefined) ||
      null;

    // Conflict: email matches one AP user, emp id another
    const byEmp = apByEmp.get(linkKey);
    const byEmail = email ? apByEmail.get(email) : undefined;
    if (byEmp && byEmail && Number(byEmp.id) !== Number(byEmail.id)) {
      conflicts.push({
        kind: "duplicate_identity",
        detail: `HRMS ${name} (${email ?? "no-email"}) emp=${linkKey} maps to AP #${byEmp.id} by emp and #${byEmail.id} by email`,
      });
    }

    const refinedNeedsManualScope =
      rec.role == null
        ? true
        : GLOBAL_SCOPE_ROLES.includes(rec.role as (typeof GLOBAL_SCOPE_ROLES)[number])
          ? false
          : !collegeReliable || rec.role === "hod"; // HOD always needs branch; faculty/principal/exam_cell college-only if college reliable

    recommendations.push({
      hrmsUserId,
      name,
      employeeId: empNo || employeeRef,
      email,
      department,
      designation,
      employeeGroup,
      collegeName,
      collegeId,
      collegeReliable,
      branchReliable: false,
      recommendedRole: rec.role,
      recommendationReason: rec.reason,
      confidence: rec.confidence,
      needsManualReview: rec.confidence === "none" || rec.confidence === "low" || !profile,
      needsManualScope: refinedNeedsManualScope,
      alreadyLinked: Boolean(linked),
      apUserId: linked ? Number(linked.id) : null,
    });
  }

  // Super admin check
  const superRows = apUsers.filter(
    (u) =>
      u.username === SUPER_ADMIN_SEED.username ||
      (u.email && u.email.toLowerCase() === SUPER_ADMIN_SEED.email.toLowerCase()),
  );
  const superAdmin = superRows[0] ?? null;
  let superStatus = {
    exists: false,
    active: false,
    globalScope: false,
    correctRole: false,
    userId: null as number | null,
    username: SUPER_ADMIN_SEED.username,
    roles: [] as string[],
  };
  if (superAdmin) {
    const assignments = (rolesByUser.get(Number(superAdmin.id)) ?? []).map((r) => ({
      roleKey: String(r.role_key),
      label: String(r.label),
      collegeId: r.college_id == null ? null : Number(r.college_id),
      branchId: r.branch_id == null ? null : Number(r.branch_id),
    }));
    const scope = buildScopeFromAssignments(assignments);
    superStatus = {
      exists: true,
      active: Number(superAdmin.is_active) === 1,
      globalScope: scope.isGlobal,
      correctRole: assignments.some((a) => a.roleKey === "system_admin" && a.collegeId == null && a.branchId == null),
      userId: Number(superAdmin.id),
      username: superAdmin.username,
      roles: assignments.map((a) => `${a.roleKey}@${a.collegeId ?? "global"}/${a.branchId ?? "all"}`),
    };
  }

  const linkedAp = apUsers.filter((u) => u.hrms_employee_id);
  const unlinkedAp = apUsers.filter((u) => !u.hrms_employee_id);
  const inactiveAp = apUsers.filter((u) => Number(u.is_active) !== 1);

  const testLike = apUsers.filter((u) => {
    const un = String(u.username).toLowerCase();
    const em = String(u.email ?? "").toLowerCase();
    return (
      un.includes("authz") ||
      un.includes("sectest") ||
      un.includes("_tmp") ||
      un.startsWith("ap_sec_") ||
      un.startsWith("ap_authz_") ||
      em.includes("@authz.test") ||
      em.includes("@sectest.local") ||
      un === "academic_portal"
    );
  });

  // Also flag leftover linked HRMS accounts that look like early onboarding experiments
  const reviewAp = apUsers.map((u) => {
    const roles = rolesByUser.get(Number(u.id)) ?? [];
    return {
      id: Number(u.id),
      name: u.name,
      username: u.username,
      email: u.email,
      hrmsEmployeeId: u.hrms_employee_id,
      isActive: Number(u.is_active) === 1,
      hasLocalPassword: Boolean(u.password_hash),
      roles: roles.map((r) => ({
        roleKey: r.role_key,
        collegeId: r.college_id,
        branchId: r.branch_id,
      })),
      flags: [
        ...(Number(u.is_active) !== 1 ? ["inactive"] : []),
        ...(u.password_hash && u.username !== SUPER_ADMIN_SEED.username ? ["unexpected_local_password"] : []),
        ...(!u.hrms_employee_id && u.username !== SUPER_ADMIN_SEED.username && u.username !== "academic_portal"
          ? ["unlinked_local_account"]
          : []),
        ...(testLike.some((t) => Number(t.id) === Number(u.id)) ? ["dev_test_pattern"] : []),
      ],
    };
  });

  const byRole: Record<string, Recommendation[]> = {
    system_admin: [],
    management: [],
    academic_admin: [],
    principal: [],
    hod: [],
    faculty: [],
    exam_cell: [],
    auditor: [],
  };
  for (const r of recommendations) {
    if (r.recommendedRole && (r.confidence === "high" || r.confidence === "medium")) {
      // Only recommend unlinked active HRMS users for onboarding groups
      if (!r.alreadyLinked && (hrmsUsers.find((u) => String(u._id) === r.hrmsUserId)?.isActive !== false)) {
        byRole[r.recommendedRole].push(r);
      }
    }
  }

  const manualReview = recommendations.filter(
    (r) =>
      !r.alreadyLinked &&
      (r.needsManualReview || r.confidence === "none" || r.confidence === "low"),
  );
  const manualScope = recommendations.filter(
    (r) =>
      !r.alreadyLinked &&
      r.recommendedRole &&
      (r.confidence === "high" || r.confidence === "medium") &&
      r.needsManualScope,
  );

  // User management readiness (code-path inventory — no execution)
  const umReadiness = {
    searchHrmsCandidates: true,
    linkHrmsUser: true,
    assignReplaceRoles: true,
    activateDeactivate: true,
    auditLogging: true,
    loginUsesHrmsPassword: true,
    notes: [
      "Administrator links via User Management UI/API: search HRMS → link → assign role + college/branch → activate.",
      "Linked users authenticate with HRMS password; AP stores no HRMS password copy.",
      "This discovery did not execute any link/assign/activate operations.",
    ],
  };

  const report = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    hrms: {
      totalUsers: hrmsUsers.length,
      activeUsers: hrmsActive,
      inactiveUsers: hrmsInactive,
      employeesIndexed: employees.length,
    },
    ap: {
      total: apUsers.length,
      linked: linkedAp.length,
      unlinked: unlinkedAp.length,
      inactive: inactiveAp.length,
      users: reviewAp,
    },
    conflicts,
    superAdmin: superStatus,
    recommendedGroups: Object.fromEntries(
      Object.entries(byRole).map(([role, list]) => [
        role,
        list
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((r) => ({
            name: r.name,
            employeeId: r.employeeId,
            email: r.email,
            department: r.department,
            designation: r.designation,
            collegeName: r.collegeName,
            collegeId: r.collegeId,
            collegeReliable: r.collegeReliable,
            confidence: r.confidence,
            reason: r.recommendationReason,
            needsManualScope: r.needsManualScope,
          })),
      ]),
    ),
    lowConfidenceFaculty: recommendations
      .filter((r) => r.recommendedRole === "faculty" && r.confidence === "low" && !r.alreadyLinked)
      .map((r) => ({
        name: r.name,
        employeeId: r.employeeId,
        email: r.email,
        designation: r.designation,
        department: r.department,
        reason: r.recommendationReason,
      })),
    manualReviewSample: manualReview.slice(0, 40).map((r) => ({
      name: r.name,
      employeeId: r.employeeId,
      email: r.email,
      designation: r.designation,
      department: r.department,
      reason: r.recommendationReason,
    })),
    manualReviewCount: manualReview.length,
    manualScope: manualScope.map((r) => ({
      name: r.name,
      employeeId: r.employeeId,
      email: r.email,
      recommendedRole: r.recommendedRole,
      collegeName: r.collegeName,
      collegeReliable: r.collegeReliable,
      note:
        r.recommendedRole === "hod"
          ? "NEEDS MANUAL SCOPE ASSIGNMENT (college and branch)"
          : !r.collegeReliable
            ? "NEEDS MANUAL SCOPE ASSIGNMENT (college unreliable/missing)"
            : "NEEDS MANUAL SCOPE ASSIGNMENT",
    })),
    developmentTestAccounts: reviewAp.filter((u) => u.flags.length > 0),
    umReadiness,
    recommendedOnboardingOrder: [
      "1. Confirm Super Admin (already present) — keep as sole system_admin bootstrap",
      "2. Link 1–2 academic_admin or management (global or multi-college) if titles are unambiguous",
      "3. Link Principals per college (college scope only)",
      "4. Link Exam Cell for colleges that run examinations",
      "5. Link HODs with explicit college + branch (always manual branch)",
      "6. Link Faculty in controlled batches after college scope confirmed",
      "7. Link Auditor last (read-only global) if needed",
      "8. Do not bulk-import; verify each login after link",
    ],
    collegeNameMapCoverage: {
      studentColleges: colleges.map((c) => ({ id: Number(c.id), name: c.name })),
      hrmsCollegeNamesSeen: [
        ...new Set(
          recommendations
            .map((r) => r.collegeName)
            .filter((n): n is string => Boolean(n)),
        ),
      ].sort(),
      unmatchedHrmsCollegeNames: [
        ...new Set(
          recommendations
            .filter((r) => r.collegeName && !r.collegeReliable)
            .map((r) => r.collegeName as string),
        ),
      ].sort(),
    },
  };

  console.log(JSON.stringify(report, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
