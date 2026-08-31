import "dotenv/config";
import { queryAcademic } from "../db/pools.js";

async function main() {
  const subs = await queryAcademic(`
    SELECT r.id, r.status, d.execution_status, d.session_date, d.section_name,
           d.original_faculty_staff_link_id, d.replacement_faculty_staff_link_id
    FROM ap_requests r
    LEFT JOIN ap_faculty_substitution_details d ON d.request_id = r.id
    INNER JOIN ap_request_types t ON t.id = r.request_type_id
    WHERE t.type_key = 'faculty_substitution'
    ORDER BY r.id DESC LIMIT 10
  `);
  console.log("Substitution requests:", JSON.stringify(subs, null, 2));

  const overrides = await queryAcademic(`
    SELECT * FROM ap_class_session_substitutions ORDER BY id DESC LIMIT 5
  `);
  console.log("Overrides:", JSON.stringify(overrides, null, 2));

  const audits = await queryAcademic(`
    SELECT action, entity_type, entity_id, created_at
    FROM ap_audit_logs
    WHERE action LIKE 'faculty.substitution.%'
    ORDER BY id DESC LIMIT 10
  `);
  console.log("Substitution audits:", JSON.stringify(audits, null, 2));

  const admin = await queryAcademic(`
    SELECT id, username, password_hash IS NOT NULL AS has_local_password, hrms_employee_id
    FROM ap_users WHERE username = 'superadmin' LIMIT 1
  `);
  console.log("Superadmin:", admin);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
