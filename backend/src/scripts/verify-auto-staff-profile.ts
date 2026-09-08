import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { executeAcademic, queryAcademic } from "../db/pools.js";
import { ensureStaffUserForSubjectAssignment } from "../services/user-management.service.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  console.log("=== Verifying Auto Staff User Profile Creation on Subject Assignment ===\n");

  const testHrmsId = "test_staff_emp_" + Date.now();
  const testName = "Prof. Auto Staff Test";
  const collegeId = 1;
  const branchId = 2;

  try {
    // 1. Direct call to ensureStaffUserForSubjectAssignment
    console.log(`1. Testing ensureStaffUserForSubjectAssignment for ${testHrmsId}...`);
    const result = await ensureStaffUserForSubjectAssignment({
      hrmsEmployeeId: testHrmsId,
      displayName: testName,
      collegeId,
      branchId,
      actorUserId: 1,
      ipAddress: "127.0.0.1",
    });

    assert(result != null, "Result should not be null");
    assert(result.userId > 0, "userId should be > 0");
    assert(result.staffLinkId > 0, "staffLinkId should be > 0");
    assert(result.hrmsEmployeeId === testHrmsId, "hrmsEmployeeId should match");
    console.log(`   -> Created user #${result.userId} and staff link #${result.staffLinkId}`);

    // 2. Verify ap_users record
    console.log("2. Verifying ap_users record in database...");
    const userRows = await queryAcademic<(RowDataPacket & { id: number; name: string; hrms_employee_id: string; is_active: number })[]>(
      `SELECT id, name, hrms_employee_id, is_active FROM ap_users WHERE id = ?`,
      [result.userId],
    );
    assert(userRows.length === 1, "User should exist in ap_users");
    assert(userRows[0].hrms_employee_id === testHrmsId, "hrms_employee_id should match");
    assert(userRows[0].name === testName, "name should match displayName");
    assert(userRows[0].is_active === 1, "user should be active");
    console.log("   -> ap_users verified: name, hrms_employee_id, is_active = 1");

    // 3. Verify ap_user_roles record
    console.log("3. Verifying ap_user_roles record for role 'staff'...");
    const roleRows = await queryAcademic<(RowDataPacket & { role_key: string; college_id: number; branch_id: number })[]>(
      `
      SELECT r.role_key, ur.college_id, ur.branch_id
      FROM ap_user_roles ur
      INNER JOIN ap_roles r ON r.id = ur.role_id
      WHERE ur.user_id = ?
      `,
      [result.userId],
    );
    assert(roleRows.length === 1, "Should have 1 role assignment");
    assert(roleRows[0].role_key === "staff", "Role should be 'staff'");
    assert(roleRows[0].college_id === collegeId, `college_id should be ${collegeId}`);
    assert(roleRows[0].branch_id === branchId, `branch_id should be ${branchId}`);
    console.log(`   -> ap_user_roles verified: role_key = 'staff', college_id = ${collegeId}, branch_id = ${branchId}`);

    // 4. Verify ap_staff_link record
    console.log("4. Verifying ap_staff_link record...");
    const linkRows = await queryAcademic<(RowDataPacket & { id: number; display_name: string })[]>(
      `SELECT id, display_name FROM ap_staff_link WHERE id = ?`,
      [result.staffLinkId],
    );
    assert(linkRows.length === 1, "Staff link should exist in ap_staff_link");
    assert(linkRows[0].display_name === testName, "display_name should match");
    console.log("   -> ap_staff_link verified");

    // 5. Test idempotency: calling again with same parameters
    console.log("5. Testing idempotency with same parameters...");
    const idempResult = await ensureStaffUserForSubjectAssignment({
      hrmsEmployeeId: testHrmsId,
      displayName: testName,
      collegeId,
      branchId,
    });
    assert(idempResult?.userId === result.userId, "User ID should remain identical");
    assert(idempResult?.staffLinkId === result.staffLinkId, "Staff link ID should remain identical");

    const totalUsersForEmp = await queryAcademic<(RowDataPacket & { c: number })[]>(
      `SELECT COUNT(*) AS c FROM ap_users WHERE hrms_employee_id = ?`,
      [testHrmsId],
    );
    assert(Number(totalUsersForEmp[0].c) === 1, "Should not duplicate ap_users rows");
    console.log("   -> Idempotency confirmed: no duplicate user or staff link created");

    // 6. Test scope addition: calling for another branch
    console.log("6. Testing scope addition for another branch (branchId: 3)...");
    const newBranchResult = await ensureStaffUserForSubjectAssignment({
      hrmsEmployeeId: testHrmsId,
      displayName: testName,
      collegeId,
      branchId: 3,
    });
    assert(newBranchResult?.userId === result.userId, "User ID should be the same");

    const allRoles = await queryAcademic<(RowDataPacket & { branch_id: number })[]>(
      `SELECT branch_id FROM ap_user_roles WHERE user_id = ? ORDER BY branch_id ASC`,
      [result.userId],
    );
    assert(allRoles.length === 2, "Should have 2 role scopes for the user");
    assert(allRoles.map(r => r.branch_id).includes(3), "New branch 3 should be added");
    console.log("   -> New branch scope successfully added to the staff user profile");

    // 7. Test resolution via facultyStaffLinkId
    console.log("7. Testing resolution via facultyStaffLinkId (without hrmsEmployeeId in input)...");
    const linkOnlyResult = await ensureStaffUserForSubjectAssignment({
      facultyStaffLinkId: result.staffLinkId,
      collegeId,
      branchId: 4,
    });
    assert(linkOnlyResult?.userId === result.userId, "Should resolve to the same user");
    console.log("   -> Resolution via facultyStaffLinkId succeeded");

    console.log("\nAll automatic staff user profile tests PASSED successfully!");
  } finally {
    // Cleanup test data
    console.log("\nCleaning up test records...");
    const users = await queryAcademic<(RowDataPacket & { id: number })[]>(
      `SELECT id FROM ap_users WHERE hrms_employee_id = ?`,
      [testHrmsId],
    );
    for (const u of users) {
      await executeAcademic(`DELETE FROM ap_user_roles WHERE user_id = ?`, [u.id]);
      await executeAcademic(`DELETE FROM ap_users WHERE id = ?`, [u.id]);
    }
    await executeAcademic(`DELETE FROM ap_staff_link WHERE hrms_employee_id = ?`, [testHrmsId]);
    console.log("Cleanup complete.");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Verification FAILED:", err);
  process.exit(1);
});
