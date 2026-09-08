import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { executeAcademic, queryAcademic } from "../db/pools.js";
import {
  ensureStaffUserForSubjectAssignment,
  syncStaffUserRolesForTimetableChanges,
  syncAllTimetableStaffUsers,
} from "../services/user-management.service.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function runTest() {
  console.log("=== Verifying Timetable Changes -> User Management Sync ===\n");

  const ts = Date.now();
  const hrmsIdA = `sync_fac_a_${ts}`;
  const hrmsIdB = `sync_fac_b_${ts}`;
  const collegeId = 1;
  const branchId = 2;

  let userAId = 0;
  let userBId = 0;
  let linkAId = 0;
  let linkBId = 0;
  let planId = 0;

  try {
    // 1. Create staff profile for Faculty A as if assigned to a timetable
    console.log("Step 1: Assigning Faculty A...");
    const staffA = await ensureStaffUserForSubjectAssignment({
      hrmsEmployeeId: hrmsIdA,
      displayName: "Faculty A Timetable Test",
      collegeId,
      branchId,
      actorUserId: 1,
    });
    assert(staffA != null, "Staff A should be created");
    userAId = staffA.userId;
    linkAId = staffA.staffLinkId;

    // Verify Faculty A is active with staff role
    const rolesA = await queryAcademic<(RowDataPacket & { role_key: string })[]>(
      `SELECT r.role_key FROM ap_user_roles ur INNER JOIN ap_roles r ON r.id = ur.role_id WHERE ur.user_id = ?`,
      [userAId],
    );
    assert(rolesA.length === 1 && rolesA[0].role_key === "staff", "Faculty A should have staff role");
    console.log(`   -> Faculty A (User #${userAId}, Link #${linkAId}) created with staff role.`);

    // 2. Create a mock timetable plan with Faculty A assigned
    console.log("Step 2: Creating mock timetable plan with Faculty A assigned...");
    const planResult = await executeAcademic(
      `
      INSERT INTO ap_timetable_plans
        (academic_year_label, college_id, course_id, branch_id, batch, year_of_study, semester_number, section_name, status, version_no)
      VALUES
        ('2025-2026', ?, 1, ?, '2025', 1, 1, 'TEST-SYNC', 'draft', 1)
      `,
      [collegeId, branchId],
    );
    planId = Number(planResult.insertId);

    await executeAcademic(
      `
      INSERT INTO ap_timetable_entries
        (plan_id, day_of_week, period_slot_id, timing_slot_id, entry_type, faculty_staff_link_id)
      VALUES
        (?, 'MON', 1, 1, 'theory', ?)
      `,
      [planId, linkAId],
    );
    console.log(`   -> Plan #${planId} created with Faculty A assigned to MON slot 1.`);

    // 3. Now simulate timetable change: Faculty A is replaced by Faculty B
    console.log("Step 3: Simulating timetable change - replacing Faculty A with Faculty B...");
    const staffB = await ensureStaffUserForSubjectAssignment({
      hrmsEmployeeId: hrmsIdB,
      displayName: "Faculty B Timetable Test",
      collegeId,
      branchId,
      actorUserId: 1,
    });
    assert(staffB != null, "Staff B should be created");
    userBId = staffB.userId;
    linkBId = staffB.staffLinkId;

    // Update timetable entry to Faculty B
    await executeAcademic(
      `UPDATE ap_timetable_entries SET faculty_staff_link_id = ? WHERE plan_id = ?`,
      [linkBId, planId],
    );

    // Call syncStaffUserRolesForTimetableChanges for Faculty A (the candidate removed faculty)
    console.log("Step 4: Triggering syncStaffUserRolesForTimetableChanges for removed Faculty A...");
    const syncResult = await syncStaffUserRolesForTimetableChanges({
      collegeId,
      branchId,
      candidateStaffLinkIds: [linkAId],
      actorUserId: 1,
    });

    assert(syncResult.removedScopesCount === 1, "Should have removed 1 scope for Faculty A");
    assert(syncResult.deactivatedUsersCount === 1, "Faculty A should be deactivated since 0 roles remain");
    console.log(`   -> Sync removed scope and deactivated user!`);

    // 4. Verify in DB that Faculty A has 0 roles and is_active = 0
    console.log("Step 5: Verifying Faculty A database state...");
    const userARows = await queryAcademic<(RowDataPacket & { is_active: number })[]>(
      `SELECT is_active FROM ap_users WHERE id = ?`,
      [userAId],
    );
    assert(userARows[0].is_active === 0, "Faculty A is_active must be 0");

    const remainingRolesA = await queryAcademic<RowDataPacket[]>(
      `SELECT * FROM ap_user_roles WHERE user_id = ?`,
      [userAId],
    );
    assert(remainingRolesA.length === 0, "Faculty A must have 0 roles in ap_user_roles");
    console.log("   -> Verified: Faculty A has 0 roles and is_active = 0.");

    // 5. Verify Faculty B is active with staff role
    console.log("Step 6: Verifying Faculty B database state...");
    const userBRows = await queryAcademic<(RowDataPacket & { is_active: number })[]>(
      `SELECT is_active FROM ap_users WHERE id = ?`,
      [userBId],
    );
    assert(userBRows[0].is_active === 1, "Faculty B is_active must be 1");

    const remainingRolesB = await queryAcademic<RowDataPacket[]>(
      `SELECT * FROM ap_user_roles WHERE user_id = ?`,
      [userBId],
    );
    assert(remainingRolesB.length === 1, "Faculty B must have 1 role");
    console.log("   -> Verified: Faculty B has 1 role and is_active = 1.");

    // 6. Test re-activation: Faculty A is assigned a class again
    console.log("Step 7: Testing future re-assignment of Faculty A...");
    const reactivatedA = await ensureStaffUserForSubjectAssignment({
      hrmsEmployeeId: hrmsIdA,
      collegeId,
      branchId,
    });
    assert(reactivatedA?.userId === userAId, "Should be same user ID");

    const reactivatedUserRows = await queryAcademic<(RowDataPacket & { is_active: number })[]>(
      `SELECT is_active FROM ap_users WHERE id = ?`,
      [userAId],
    );
    assert(reactivatedUserRows[0].is_active === 1, "Faculty A should be reactivated (is_active = 1)");
    console.log("   -> Verified: Faculty A was automatically re-activated when assigned again!");

    // 7. Test syncAllTimetableStaffUsers full sweep
    console.log("Step 8: Testing syncAllTimetableStaffUsers full reconciliation sweep...");
    const fullSweep = await syncAllTimetableStaffUsers({ actorUserId: 1 });
    console.log("   -> Sweep results:", fullSweep);
    assert(fullSweep.activeTeachingAssignments >= 0, "Sweep should return active assignments count");

    console.log("\n>>> ALL TIMETABLE CHANGE USER MANAGEMENT SYNC TESTS PASSED! <<<");
  } finally {
    // Cleanup test data
    console.log("\nCleaning up test artifacts...");
    if (planId) {
      await executeAcademic(`DELETE FROM ap_timetable_entries WHERE plan_id = ?`, [planId]);
      await executeAcademic(`DELETE FROM ap_timetable_plans WHERE id = ?`, [planId]);
    }
    if (userAId) {
      await executeAcademic(`DELETE FROM ap_user_roles WHERE user_id = ?`, [userAId]);
      await executeAcademic(`DELETE FROM ap_users WHERE id = ?`, [userAId]);
    }
    if (userBId) {
      await executeAcademic(`DELETE FROM ap_user_roles WHERE user_id = ?`, [userBId]);
      await executeAcademic(`DELETE FROM ap_users WHERE id = ?`, [userBId]);
    }
    if (linkAId) {
      await executeAcademic(`DELETE FROM ap_staff_link WHERE id = ?`, [linkAId]);
    }
    if (linkBId) {
      await executeAcademic(`DELETE FROM ap_staff_link WHERE id = ?`, [linkBId]);
    }
    console.log("Cleanup complete.");
  }
}

runTest().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
