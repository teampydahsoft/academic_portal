/**
 * READ-ONLY HRMS inspection for employee_group id → name resolution.
 * Requires --dry-run. Performs zero mutations.
 */
import "dotenv/config";
import { getHrmsDb } from "../db/pools.js";

if (!process.argv.includes("--dry-run")) {
  console.error("ABORTED — must pass --dry-run");
  process.exit(1);
}

async function main() {
  const db = await getHrmsDb();
  const collections = await db.listCollections().toArray();
  const collectionNames = collections.map((c) => c.name).sort();

  console.log("=== HRMS COLLECTIONS ===");
  console.log(collectionNames.join("\n"));

  const groupLike = collectionNames.filter((n) =>
    /group|employe/i.test(n),
  );
  console.log("\n=== GROUP-LIKE COLLECTIONS ===");
  console.log(groupLike.length ? groupLike.join("\n") : "(none)");

  // Sample employee 111137 + a known teaching employee
  const samples = await db
    .collection("employees")
    .find({
      $or: [
        { emp_no: "111137" },
        { emp_no: "111200" },
        { emp_no: "21515" },
      ],
    })
    .project({
      emp_no: 1,
      employee_name: 1,
      employee_group: 1,
      employeeGroup: 1,
      group: 1,
      group_id: 1,
      groupId: 1,
      dynamicFields: 1,
    })
    .limit(10)
    .toArray();

  console.log("\n=== SAMPLE EMPLOYEES (group-related fields) ===");
  for (const raw of samples) {
    const doc = raw as Record<string, unknown>;
    const dynamic =
      doc.dynamicFields && typeof doc.dynamicFields === "object"
        ? (doc.dynamicFields as Record<string, unknown>)
        : {};
    console.log(
      JSON.stringify(
        {
          emp_no: doc.emp_no,
          employee_name: doc.employee_name,
          top_employee_group: doc.employee_group ?? null,
          top_employeeGroup: doc.employeeGroup ?? null,
          top_group: doc.group ?? null,
          top_group_id: doc.group_id ?? null,
          top_groupId: doc.groupId ?? null,
          dynamic_employee_group: dynamic.employee_group ?? null,
          dynamic_keys: Object.keys(dynamic).slice(0, 40),
        },
        null,
        2,
      ),
    );
  }

  // Inspect possible group master collections
  for (const name of groupLike) {
    const count = await db.collection(name).countDocuments();
    const sample = await db.collection(name).find({}).limit(5).toArray();
    console.log(`\n=== COLLECTION ${name} (count=${count}) ===`);
    console.log(JSON.stringify(sample, null, 2));
  }

  // Also try common names even if not in filter
  for (const name of [
    "employee_groups",
    "employeegroups",
    "employeeGroups",
    "groups",
    "staff_groups",
  ]) {
    if (groupLike.includes(name)) continue;
    try {
      const count = await db.collection(name).countDocuments();
      if (count === 0) continue;
      const sample = await db.collection(name).find({}).limit(5).toArray();
      console.log(`\n=== EXTRA COLLECTION ${name} (count=${count}) ===`);
      console.log(JSON.stringify(sample, null, 2));
    } catch {
      // ignore missing
    }
  }

  // Collect unique employee_group ids from employees.dynamicFields
  const employees = await db
    .collection("employees")
    .find({})
    .project({ emp_no: 1, employee_name: 1, dynamicFields: 1, employee_group: 1 })
    .limit(500)
    .toArray();

  const idCounts = new Map<string, { count: number; sampleEmp: string; raw: unknown }>();
  for (const raw of employees) {
    const doc = raw as Record<string, unknown>;
    const dynamic =
      doc.dynamicFields && typeof doc.dynamicFields === "object"
        ? (doc.dynamicFields as Record<string, unknown>)
        : {};

    const candidates = [
      doc.employee_group,
      dynamic.employee_group,
      dynamic.employee_group_id,
      dynamic.employeeGroupId,
    ];

    // allData nested
    let allData: Record<string, unknown> | null = null;
    if (dynamic.allData && typeof dynamic.allData === "object") {
      allData = dynamic.allData as Record<string, unknown>;
    } else if (typeof dynamic.allData === "string") {
      try {
        const parsed = JSON.parse(dynamic.allData);
        if (parsed && typeof parsed === "object") allData = parsed as Record<string, unknown>;
      } catch {
        // ignore
      }
    }
    if (allData) candidates.push(allData.employee_group, allData.employee_group_id);

    for (const c of candidates) {
      if (c == null) continue;
      let id: string | null = null;
      let label: unknown = c;
      if (typeof c === "string") {
        const trimmed = c.trim();
        if (trimmed.startsWith("{")) {
          try {
            const parsed = JSON.parse(trimmed) as Record<string, unknown>;
            id = String(parsed._id ?? parsed.id ?? "");
            label = parsed;
          } catch {
            id = trimmed;
          }
        } else {
          id = trimmed;
        }
      } else if (typeof c === "object") {
        const rec = c as Record<string, unknown>;
        id = String(rec._id ?? rec.id ?? "");
        label = rec;
      }
      if (!id) continue;
      const prev = idCounts.get(id);
      if (prev) prev.count += 1;
      else
        idCounts.set(id, {
          count: 1,
          sampleEmp: String(doc.emp_no ?? ""),
          raw: label,
        });
    }
  }

  console.log("\n=== UNIQUE employee_group REFERENCES FROM EMPLOYEES ===");
  console.log(
    JSON.stringify(
      Array.from(idCounts.entries()).map(([id, meta]) => ({
        id,
        count: meta.count,
        sampleEmp: meta.sampleEmp,
        raw: meta.raw,
      })),
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
