import type { Db } from "mongodb";

type UnknownRecord = Record<string, unknown>;

export type HrmsStaffProfile = {
  hrmsId: string;
  name: string;
  division: string;
  department: string;
  designation: string;
  college: string;
  employeeGroup: string;
  employeeGroupId: string | null;
  isActive: boolean;
};

export type HrmsOrgLookups = {
  employeeGroups: Map<string, string>;
  divisions: Map<string, string>;
  departments: Map<string, string>;
  designations: Map<string, string>;
};

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" ? (value as UnknownRecord) : null;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function nestedDynamic(doc: UnknownRecord) {
  return asRecord(doc.dynamicFields) ?? {};
}

function allDataRecord(dynamic: UnknownRecord) {
  return asRecord(parseMaybeJson(dynamic.allData)) ?? {};
}

function nameFromRef(value: unknown): string | null {
  const parsed = parseMaybeJson(value);
  const record = asRecord(parsed);
  if (record && typeof record.name === "string" && record.name.trim()) {
    return record.name.trim();
  }
  return null;
}

function idFromValue(value: unknown): string | null {
  if (value == null) return null;

  // Mongo ObjectId (BSON) — must use toHexString/toString, not String()
  if (typeof value === "object") {
    const maybeOid = value as {
      toHexString?: () => string;
      toString?: () => string;
      _id?: unknown;
      id?: unknown;
    };
    if (typeof maybeOid.toHexString === "function") {
      return maybeOid.toHexString();
    }
    if (typeof maybeOid.toString === "function") {
      const asText = maybeOid.toString();
      // ObjectId.toString() => 24-char hex; avoid Object.prototype junk
      if (/^[a-f0-9]{24}$/i.test(asText)) return asText;
    }
    const nested = maybeOid._id ?? maybeOid.id;
    if (nested != null && nested !== value) return idFromValue(nested);
  }

  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim();
    if (!text) return null;
    if (text.startsWith("{")) {
      const parsed = parseMaybeJson(text);
      const record = asRecord(parsed);
      if (record) {
        const nested = record._id ?? record.id;
        return nested != null ? idFromValue(nested) : null;
      }
    }
    return text;
  }

  return null;
}

async function loadNameMap(db: Db, collectionName: string) {
  const rows = await db.collection(collectionName).find({}).project({ name: 1 }).toArray();
  const map = new Map<string, string>();
  for (const row of rows) {
    const id =
      row._id && typeof (row._id as { toHexString?: () => string }).toHexString === "function"
        ? (row._id as { toHexString: () => string }).toHexString()
        : String(row._id);
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (id && name) map.set(id, name);
  }
  return map;
}

/** All HRMS employee groups from the employeegroups master. */
export async function listHrmsEmployeeGroups(db: Db) {
  const rows = await db
    .collection("employeegroups")
    .find({})
    .project({ name: 1 })
    .toArray();

  const groups: { id: string; name: string }[] = [];
  for (const row of rows) {
    const id =
      row._id && typeof (row._id as { toHexString?: () => string }).toHexString === "function"
        ? (row._id as { toHexString: () => string }).toHexString()
        : String(row._id);
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (id && name) groups.push({ id, name });
  }
  return groups.sort((a, b) => a.name.localeCompare(b.name));
}

/** Shared projection for employee docs when resolving org masters.
 * Keep dynamicFields narrow — full blobs (esp. allData) dominate HRMS latency.
 */
export const HRMS_EMPLOYEE_PROJECTION = {
  _id: 1,
  emp_no: 1,
  employeeId: 1,
  employeeCode: 1,
  empCode: 1,
  employee_name: 1,
  employeeName: 1,
  name: 1,
  fullName: 1,
  firstName: 1,
  lastName: 1,
  department: 1,
  departmentName: 1,
  department_id: 1,
  division: 1,
  divisionName: 1,
  division_id: 1,
  designation: 1,
  designationName: 1,
  designation_id: 1,
  employee_group: 1,
  employee_group_id: 1,
  employeeGroup: 1,
  groupName: 1,
  is_active: 1,
  email: 1,
  official_email: 1,
  personal_email: 1,
  // Presence-only for auth readiness checks (hash never returned to clients as-is;
  // search only inspects prefix via service layer).
  password: 1,
  "dynamicFields.email": 1,
  "dynamicFields.official_email": 1,
  "dynamicFields.personal_email": 1,
  "dynamicFields.department_id": 1,
  "dynamicFields.division_id": 1,
  "dynamicFields.designation_id": 1,
  "dynamicFields.employee_group_id": 1,
  "dynamicFields.department": 1,
  "dynamicFields.division": 1,
  "dynamicFields.designation": 1,
  "dynamicFields.employee_group": 1,
  "dynamicFields.department_name": 1,
  "dynamicFields.division_name": 1,
  "dynamicFields.designation_name": 1,
  "dynamicFields.college_name": 1,
  "dynamicFields.campus_name": 1,
} as const;

const ORG_LOOKUPS_TTL_MS = 5 * 60 * 1000;
let orgLookupsCache: { expiresAt: number; value: HrmsOrgLookups } | null = null;
let orgLookupsInflight: Promise<HrmsOrgLookups> | null = null;

/** Load HRMS master maps used to resolve employee *_id foreign keys. */
export async function loadHrmsOrgLookups(db: Db): Promise<HrmsOrgLookups> {
  if (orgLookupsCache && orgLookupsCache.expiresAt > Date.now()) {
    return orgLookupsCache.value;
  }
  if (orgLookupsInflight) return orgLookupsInflight;

  orgLookupsInflight = (async () => {
    const [employeeGroups, divisions, departments, designations] = await Promise.all([
      loadNameMap(db, "employeegroups"),
      loadNameMap(db, "divisions"),
      loadNameMap(db, "departments"),
      loadNameMap(db, "designations"),
    ]);
    const value = { employeeGroups, divisions, departments, designations };
    orgLookupsCache = { expiresAt: Date.now() + ORG_LOOKUPS_TTL_MS, value };
    return value;
  })().finally(() => {
    orgLookupsInflight = null;
  });

  return orgLookupsInflight;
}

export function invalidateHrmsOrgLookupsCache() {
  orgLookupsCache = null;
}

/** Best-effort email from an HRMS employee document (not the login `users` collection). */
export function extractEmployeeEmail(doc: UnknownRecord): string | null {
  const dynamic = nestedDynamic(doc);
  const allData = allDataRecord(dynamic);
  const candidates = [
    doc.email,
    doc.official_email,
    doc.personal_email,
    dynamic.email,
    dynamic.official_email,
    dynamic.personal_email,
    allData.email,
    allData.official_email,
    allData.personal_email,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return value.trim().toLowerCase();
    }
  }
  return null;
}

export function extractHrmsStaffProfile(
  doc: UnknownRecord,
  lookups?: HrmsOrgLookups,
): HrmsStaffProfile {
  const dynamic = nestedDynamic(doc);
  const allData = allDataRecord(dynamic);

  const hrmsId = String(
    doc.emp_no ?? doc.employeeId ?? doc.employeeCode ?? doc.empCode ?? doc._id,
  );

  const first = typeof doc.firstName === "string" ? doc.firstName.trim() : "";
  const last = typeof doc.lastName === "string" ? doc.lastName.trim() : "";
  const name =
    (typeof doc.employee_name === "string" && doc.employee_name.trim()) ||
    (typeof doc.employeeName === "string" && doc.employeeName.trim()) ||
    (typeof doc.name === "string" && doc.name.trim()) ||
    (typeof doc.fullName === "string" && doc.fullName.trim()) ||
    `${first} ${last}`.trim() ||
    `Employee ${hrmsId}`;

  const divisionId =
    idFromValue(doc.division_id) ||
    idFromValue(dynamic.division_id) ||
    idFromValue(allData.division_id) ||
    idFromValue(dynamic.division) ||
    idFromValue(allData.division);
  const departmentId =
    idFromValue(doc.department_id) ||
    idFromValue(dynamic.department_id) ||
    idFromValue(allData.department_id) ||
    idFromValue(dynamic.department) ||
    idFromValue(allData.department);
  const designationId =
    idFromValue(doc.designation_id) ||
    idFromValue(dynamic.designation_id) ||
    idFromValue(allData.designation_id) ||
    idFromValue(dynamic.designation) ||
    idFromValue(allData.designation);
  const employeeGroupId =
    idFromValue(doc.employee_group_id) ||
    idFromValue(dynamic.employee_group_id) ||
    idFromValue(allData.employee_group_id) ||
    idFromValue(doc.employee_group) ||
    idFromValue(dynamic.employee_group) ||
    idFromValue(allData.employee_group);

  // Prefer master names via top-level *_id — embedded dynamicFields refs are often stale.
  const division =
    (divisionId && lookups?.divisions.get(divisionId)) ||
    (typeof dynamic.division_name === "string" && dynamic.division_name.trim()) ||
    nameFromRef(doc.division) ||
    nameFromRef(dynamic.division) ||
    nameFromRef(allData.division_id) ||
    nameFromRef(allData.division) ||
    (typeof doc.divisionName === "string" && doc.divisionName.trim()) ||
    (typeof doc.division === "string" && doc.division.trim()) ||
    "—";

  const department =
    (departmentId && lookups?.departments.get(departmentId)) ||
    (typeof dynamic.department_name === "string" && dynamic.department_name.trim()) ||
    nameFromRef(doc.department) ||
    nameFromRef(dynamic.department) ||
    nameFromRef(allData.department_id) ||
    nameFromRef(allData.department) ||
    (typeof doc.departmentName === "string" && doc.departmentName.trim()) ||
    (typeof doc.department === "string" && doc.department.trim()) ||
    "—";

  const designation =
    (designationId && lookups?.designations.get(designationId)) ||
    (typeof dynamic.designation_name === "string" && dynamic.designation_name.trim()) ||
    nameFromRef(doc.designation) ||
    nameFromRef(dynamic.designation) ||
    nameFromRef(allData.designation_id) ||
    nameFromRef(allData.designation) ||
    (typeof doc.designationName === "string" && doc.designationName.trim()) ||
    (typeof doc.designation === "string" && doc.designation.trim()) ||
    "—";

  const employeeGroup =
    (employeeGroupId && lookups?.employeeGroups.get(employeeGroupId)) ||
    nameFromRef(doc.employee_group) ||
    nameFromRef(dynamic.employee_group) ||
    nameFromRef(allData.employee_group) ||
    (typeof doc.groupName === "string" && doc.groupName.trim()) ||
    (typeof doc.employeeGroup === "string" && doc.employeeGroup.trim()) ||
    (typeof doc.employee_group === "string" && doc.employee_group.trim()) ||
    "—";

  const college =
    (typeof dynamic.college_name === "string" && dynamic.college_name.trim()) ||
    (typeof dynamic.campus_name === "string" && dynamic.campus_name.trim()) ||
    (typeof doc.collegeName === "string" && doc.collegeName.trim()) ||
    "—";

  const isActive =
    doc.is_active === true ||
    doc.is_active === 1 ||
    doc.is_active == null ||
    doc.is_active === undefined;

  return {
    hrmsId,
    name,
    division,
    department,
    designation,
    college,
    employeeGroup,
    employeeGroupId,
    isActive,
  };
}

export function isTeachingGroup(groupName: string) {
  const normalized = (groupName ?? "").trim().toUpperCase();
  if (normalized.includes("NON TEACH") || normalized.includes("NON-TEACH")) {
    return false;
  }
  return (
    normalized.includes("TEACH") ||
    normalized.includes("SELECTION") ||
    normalized.includes("FACULTY") ||
    normalized.includes("PROFESSOR") ||
    normalized.includes("LECTURER")
  );
}

