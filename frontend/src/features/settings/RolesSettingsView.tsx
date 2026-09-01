"use client";

import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/components/auth/AuthProvider";
import { RolesPermissionsPanel } from "@/features/user-management/RolesPermissionsPanel";

export function RolesSettingsView() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("roles.manage");

  return (
    <div>
      <PageHeader
        title="Roles & Permissions"
        description="Define Academic Portal roles and their permission matrix. User assignments are managed from User Management."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/user-management">
              <Button size="sm" variant="secondary">
                User Management
              </Button>
            </Link>
            <Link href="/settings">
              <Button size="sm" variant="secondary">
                Back to Settings
              </Button>
            </Link>
          </div>
        }
      />

      {!canManage ? (
        <p className="mb-4 text-sm text-slate-600">
          You have read-only access. Contact an administrator with{" "}
          <span className="font-medium">Manage Roles & Permissions</span> permission to create roles or change
          permissions.
        </p>
      ) : null}

      <RolesPermissionsPanel canManage={canManage} />
    </div>
  );
}
