import "dotenv/config";
import { env } from "../config/env.js";
import { seedSuperAdmin, SUPER_ADMIN_SEED } from "../services/auth.service.js";

async function main() {
  if (!SUPER_ADMIN_SEED.password) {
    throw new Error(
      "Refusing to seed Super Admin: set AP_SUPERADMIN_PASSWORD (required in production; optional in development with built-in bootstrap default).",
    );
  }
  if (env.nodeEnv === "production" && !process.env.AP_SUPERADMIN_PASSWORD?.trim()) {
    throw new Error(
      "Production bootstrap requires AP_SUPERADMIN_PASSWORD to be set explicitly.",
    );
  }

  const seeded = await seedSuperAdmin(SUPER_ADMIN_SEED.password);
  console.log("Seeded global Super Admin:");
  console.log({
    id: seeded.id,
    name: seeded.name,
    username: seeded.username,
    email: seeded.email,
    role: seeded.roleKey,
    passwordSource: process.env.AP_SUPERADMIN_PASSWORD
      ? "AP_SUPERADMIN_PASSWORD"
      : env.nodeEnv === "production"
        ? "required-env"
        : "development-bootstrap-default",
  });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
