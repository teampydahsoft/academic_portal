/**
 * READ-ONLY: resolve employee_group_id via employeegroups master.
 * Requires --dry-run.
 */
import "dotenv/config";
import { getHrmsDb } from "../db/pools.js";

if (!process.argv.includes("--dry-run")) {
  console.error("ABORTED — must pass --dry-run");
  process.exit(1);
}

async function main() {
  const db = await getHrmsDb();

  const groups = await db.collection("employeegroups").find({}).toArray();
  console.log("=== employeegroups MASTER ===");
  console.log(
    JSON.stringify(
      groups.map((g) => ({
        id: String(g._id),
        name: g.name,
        code: g.code,
        isActive: g.isActive,
      })),
      null,
      2,
    ),
  );

  const groupMap = new Map(
    groups.map((g) => [String(g._id), String(g.name ?? "")]),
  );

  const emp = await db.collection("employees").findOne({
    $or: [{ emp_no: "111137" }, { emp_no: 111137 }],
  });

  if (!emp) {
    console.log("\n111137 not found");
    return;
  }

  const doc = emp as Record<string, unknown>;
  console.log("\n=== 111137 TOP-LEVEL ORG IDS ===");
  console.log(
    JSON.stringify(
      {
        emp_no: doc.emp_no,
        employee_name: doc.employee_name,
        employee_group_id: doc.employee_group_id ?? null,
        division_id: doc.division_id ?? null,
        department_id: doc.department_id ?? null,
        designation_id: doc.designation_id ?? null,
        resolvedGroup: doc.employee_group_id
          ? groupMap.get(String(doc.employee_group_id)) ?? "NOT_IN_MASTER"
          : null,
      },
      null,
      2,
    ),
  );

  // Count how many active employees have employee_group_id vs only embedded name
  const active = await db
    .collection("employees")
    .find({
      $or: [{ is_active: true }, { is_active: { $exists: false } }],
    })
    .project({
      emp_no: 1,
      employee_name: 1,
      employee_group_id: 1,
      division_id: 1,
      department_id: 1,
      designation_id: 1,
      dynamicFields: 1,
    })
    .limit(2000)
    .toArray();

  let withTopId = 0;
  let withEmbedded = 0;
  let withNeither = 0;
  let teachingViaId = 0;
  const missingIds: string[] = [];

  for (const raw of active) {
    const row = raw as Record<string, unknown>;
    const topId = row.employee_group_id ? String(row.employee_group_id) : "";
    const dynamic =
      row.dynamicFields && typeof row.dynamicFields === "object"
        ? (row.dynamicFields as Record<string, unknown>)
        : {};
    const embedded = dynamic.employee_group;
    const hasEmbedded =
      embedded != null &&
      ((typeof embedded === "object" &&
        typeof (embedded as Record<string, unknown>).name === "string") ||
        typeof embedded === "string");

    if (topId) withTopId += 1;
    if (hasEmbedded) withEmbedded += 1;
    if (!topId && !hasEmbedded) {
      withNeither += 1;
      missingIds.push(String(row.emp_no));
    }

    const nameFromId = topId ? groupMap.get(topId) ?? "" : "";
    if (/TEACH/i.test(nameFromId) && !/NON TEACH/i.test(nameFromId)) {
      teachingViaId += 1;
    }
  }

  console.log("\n=== ACTIVE EMPLOYEE GROUP COVERAGE ===");
  console.log(
    JSON.stringify(
      {
        activeCount: active.length,
        withTopLevelEmployeeGroupId: withTopId,
        withEmbeddedEmployeeGroup: withEmbedded,
        withNeither,
        teachingResolvedViaEmployeeGroupId: teachingViaId,
        sampleMissingGroup: missingIds.slice(0, 20),
      },
      null,
      2,
    ),
  );

  // Also check divisions/departments masters for id resolution
  const divisions = await db.collection("divisions").find({}).limit(5).toArray();
  const departments = await db.collection("departments").find({}).limit(5).toArray();
  console.log("\n=== divisions sample ===");
  console.log(
    JSON.stringify(
      divisions.map((d) => ({ id: String(d._id), name: d.name, code: d.code })),
      null,
      2,
    ),
  );
  console.log("\n=== departments sample ===");
  console.log(
    JSON.stringify(
      departments.map((d) => ({ id: String(d._id), name: d.name, code: d.code })),
      null,
      2,
    ),
  );

  console.log("\nINSERT=0 UPDATE=0 DELETE=0 DDL=0");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
