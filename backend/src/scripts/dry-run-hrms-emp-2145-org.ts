/**
 * READ-ONLY: inspect emp 2145 division/department ID resolution vs embedded names.
 * Requires --dry-run.
 */
import "dotenv/config";
import { getHrmsDb } from "../db/pools.js";
import {
  extractHrmsStaffProfile,
  loadHrmsOrgLookups,
} from "../services/hrms-staff.service.js";

if (!process.argv.includes("--dry-run")) {
  console.error("ABORTED — must pass --dry-run");
  process.exit(1);
}

function oidHex(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "object") {
    const o = value as { toHexString?: () => string; toString?: () => string };
    if (typeof o.toHexString === "function") return o.toHexString();
    if (typeof o.toString === "function") {
      const t = o.toString();
      if (/^[a-f0-9]{24}$/i.test(t)) return t;
    }
  }
  const t = String(value).trim();
  return t || null;
}

async function main() {
  const db = await getHrmsDb();
  const lookups = await loadHrmsOrgLookups(db);

  const emp = await db.collection("employees").findOne({
    $or: [{ emp_no: "2145" }, { emp_no: 2145 }],
  });

  if (!emp) {
    console.log("Employee 2145 not found");
    return;
  }

  const doc = emp as Record<string, unknown>;
  const dynamic =
    doc.dynamicFields && typeof doc.dynamicFields === "object"
      ? (doc.dynamicFields as Record<string, unknown>)
      : {};

  const divisionId = oidHex(doc.division_id);
  const departmentId = oidHex(doc.department_id);
  const designationId = oidHex(doc.designation_id);

  console.log(
    JSON.stringify(
      {
        emp_no: doc.emp_no,
        employee_name: doc.employee_name,
        topLevel: {
          division_id: divisionId,
          department_id: departmentId,
          designation_id: designationId,
          employee_group_id: oidHex(doc.employee_group_id),
        },
        masterResolvedViaId: {
          division: divisionId ? lookups.divisions.get(divisionId) ?? "NOT_IN_MASTER" : null,
          department: departmentId
            ? lookups.departments.get(departmentId) ?? "NOT_IN_MASTER"
            : null,
          designation: designationId
            ? lookups.designations.get(designationId) ?? "NOT_IN_MASTER"
            : null,
        },
        embeddedDynamic: {
          division_name: dynamic.division_name ?? null,
          department_name: dynamic.department_name ?? null,
          designation_name: dynamic.designation_name ?? null,
          division: dynamic.division ?? null,
          department: dynamic.department ?? null,
        },
        currentExtractHrmsStaffProfile: extractHrmsStaffProfile(doc, lookups),
      },
      null,
      2,
    ),
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
