"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useAcademicContext } from "@/components/layout/AcademicProvider";
import { useAuth } from "@/components/auth/AuthProvider";
import { EmptyState } from "@/components/ui/EmptyState";
import { apiFetch } from "@/lib/api";
import { SubstitutionRequestForm } from "./SubstitutionRequestForm";
import { RequestScopeMeta } from "./RequestScopeMeta";
import type { RequestType } from "./types";

export function NewRequestView() {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("request.create");
  const { filters, masters } = useAcademicContext();
  const colleges = masters?.colleges ?? [];
  const courses = masters?.courses ?? [];
  const branches = masters?.branches ?? [];
  const [types, setTypes] = useState<RequestType[]>([]);
  const [typeKey, setTypeKey] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState<"draft" | "submit" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedType = types.find((type) => type.typeKey === typeKey) ?? null;
  const isSubstitution = typeKey === "faculty_substitution";

  const scopePreview = useMemo(() => {
    const collegeId = filters.collegeId !== "all" ? Number(filters.collegeId) : null;
    const branchId = filters.branchId !== "all" ? Number(filters.branchId) : null;
    const college = colleges.find((item) => item.id === collegeId);
    const branch = branches.find((item) => item.id === branchId);
    const course =
      branch != null ? courses.find((item) => item.id === branch.courseId) : undefined;
    return {
      collegeId,
      branchId,
      collegeName: college?.name ?? null,
      courseName: course?.name ?? null,
      branchName: branch?.name ?? null,
    };
  }, [filters, colleges, courses, branches]);

  useEffect(() => {
    void apiFetch("/requests/types", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) return;
        const data = (payload as { data: RequestType[] }).data ?? [];
        setTypes(data);
        if (data[0]) setTypeKey(data[0].typeKey);
      })
      .catch(() => undefined);
  }, []);

  async function createRequest(submitAfterCreate: boolean) {
    setBusy(submitAfterCreate ? "submit" : "draft");
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        typeKey,
        title: title.trim(),
        body: body.trim() || undefined,
      };
      if (scopePreview.collegeId != null) payload.collegeId = scopePreview.collegeId;
      if (scopePreview.branchId != null) payload.branchId = scopePreview.branchId;

      const response = await apiFetch("/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(
          (result as { message?: string }).message ??
            "Unable to create request. Check your scope and try again.",
        );
        return;
      }

      const id = (result as { request: { id: number } }).request.id;
      if (submitAfterCreate) {
        const submitResponse = await apiFetch(`/requests/${id}/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        if (!submitResponse.ok) {
          router.push(`/requests/${id}`);
          return;
        }
      }
      router.push(`/requests/${id}`);
    } catch {
      setError("Unable to create request.");
    } finally {
      setBusy(null);
    }
  }

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
        title="Create request"
        description="Submit a request into the configured approval workflow."
        actions={
          <Link href="/requests">
            <Button size="sm" variant="secondary">
              Cancel
            </Button>
          </Link>
        }
      />

      {isSubstitution ? (
        <SubstitutionRequestForm onCancel={() => router.push("/requests")} />
      ) : (
      <Card className="max-w-2xl">
        <div className="space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-navy-900">Request type</span>
            <select
              value={typeKey}
              onChange={(event) => setTypeKey(event.target.value)}
              className="h-11 w-full rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-navy-800"
            >
              {types.map((type) => (
                <option key={type.typeKey} value={type.typeKey}>
                  {type.label}
                </option>
              ))}
            </select>
            {selectedType?.description ? (
              <p className="mt-2 text-xs text-slate-500">{selectedType.description}</p>
            ) : null}
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-navy-900">Subject / title</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Brief summary of your request"
              className="h-11 w-full rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-navy-800"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-navy-900">Description</span>
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Provide details for the approver"
              className="min-h-32 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-navy-800"
            />
          </label>

          <div className="rounded-md border border-border bg-slate-50 px-3 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Academic context
            </p>
            <div className="mt-1">
              <RequestScopeMeta request={scopePreview} />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Scope is taken from your session and academic filters. Approvers are resolved
              automatically from the workflow configuration.
            </p>
          </div>

          {error ? <p className="text-sm text-critical">{error}</p> : null}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              size="sm"
              variant="secondary"
              className="w-full sm:w-auto"
              disabled={busy != null || !title.trim() || !typeKey}
              onClick={() => void createRequest(false)}
            >
              {busy === "draft" ? "Saving…" : "Save draft"}
            </Button>
            <Button
              size="sm"
              className="w-full sm:w-auto"
              disabled={busy != null || !title.trim() || !typeKey}
              onClick={() => void createRequest(true)}
            >
              {busy === "submit" ? "Submitting…" : "Submit"}
            </Button>
          </div>
        </div>
      </Card>
      )}
    </div>
  );
}
