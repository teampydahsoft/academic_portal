import "dotenv/config";
import { executeAcademic } from "../db/pools.js";

async function main() {
  console.log("Adding mode column to ap_user_permissions...");
  await executeAcademic(`
    ALTER TABLE ap_user_permissions 
    ADD COLUMN mode ENUM('grant', 'revoke') NOT NULL DEFAULT 'grant'
  `);
  console.log("Migration complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
