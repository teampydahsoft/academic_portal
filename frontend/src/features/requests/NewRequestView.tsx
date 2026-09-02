"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/components/auth/AuthProvider";
import { isSuperAdminUser } from "@/lib/teaching-scope";
import { EmptyState } from "@/components/ui/EmptyState";
import { SubstitutionRequestForm } from "./SubstitutionRequestForm";

export function NewRequestView() {
  const router = useRouter();
  const { hasPermission, authorization } = useAuth();
  const canCreate = hasPermission("request.create");
  const superAdminUser = isSuperAdminUser(authorization);

  if (!canCreate) {
    return (
      <EmptyState
        title="Unable to create requests"
        description="You do not have permission to create requests in the current scope."
        action={
          <Link href="/requests">
            <Button size="sm" variant="secondary">
              Back to requests
            </Button>
          </Link>
        }
      />
    );
  }

  return (
    <div className="min-w-0">
      <PageHeader
        title="Faculty substitution request"
        description="Raise a substitution request for approval through the configured workflow."
        actions={
          <Link href={superAdminUser ? "/requests/pending" : "/requests"}>
            <Button size="sm" variant="secondary">
              Cancel
            </Button>
          </Link>
        }
      />

      <SubstitutionRequestForm
        onCancel={() => router.push(superAdminUser ? "/requests/pending" : "/requests")}
      />
    </div>
  );
}
