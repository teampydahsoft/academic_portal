"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/components/auth/AuthProvider";
import { WorkflowStepDialog } from "./WorkflowStepDialog";
import { WorkflowStepTimeline } from "./WorkflowStepTimeline";
import type {
  ApproverRole,
  RequestTypeAdmin,
  WorkflowDetailResponse,
  WorkflowStepDraft,
} from "./types";
import { newClientId } from "./utils";

function stepsToDrafts(steps: WorkflowDetailResponse["steps"]): WorkflowStepDraft[] {
  return steps.map((step) => ({
    clientId: `step_${step.id}`,
    id: step.id,
    stepKey: step.stepKey,
    label: step.label,
    approverRoleKey: step.approverRoleKey ?? "",
    requiredPermission: step.requiredPermission ?? "request.approve",
    scopeMode: step.scopeMode,
    allowEscalate: step.allowEscalate,
    isFinal: step.isFinal,
  }));
}

export function RequestWorkflowsView() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("request.workflow.manage");

  const [types, setTypes] = useState<RequestTypeAdmin[]>([]);
  const [roles, setRoles] = useState<ApproverRole[]>([]);
  const [selectedTypeId, setSelectedTypeId] = useState<number | null>(null);
  const [workflowDetail, setWorkflowDetail] = useState<WorkflowDetailResponse | null>(null);
  const [draftSteps, setDraftSteps] = useState<WorkflowStepDraft[]>([]);
  const [savedSteps, setSavedSteps] = useState<WorkflowStepDraft[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadingWorkflow, setLoadingWorkflow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [stepDialogOpen, setStepDialogOpen] = useState(false);
  const [editingStepIndex, setEditingStepIndex] = useState<number | null>(null);
  const [stepDialogError, setStepDialogError] = useState<string | null>(null);

  const [showNewType, setShowNewType] = useState(false);
  const [newTypeKey, setNewTypeKey] = useState("");
  const [newTypeLabel, setNewTypeLabel] = useState("");
  const [newTypeDescription, setNewTypeDescription] = useState("");

  const selectedType = useMemo(
    () => types.find((type) => type.id === selectedTypeId) ?? null,
    [types, selectedTypeId],
  );

  const isDirty = useMemo(
    () => JSON.stringify(draftSteps) !== JSON.stringify(savedSteps),
    [draftSteps, savedSteps],
  );

  const loadTypes = useCallback(async () => {
    const res = await apiFetch("/request-workflows/types", { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(typeof body?.message === "string" ? body.message : "Failed to load request types");
    }
    return (body.data ?? []) as RequestTypeAdmin[];
  }, []);

  const loadRoles = useCallback(async () => {
    const res = await apiFetch("/request-workflows/approver-roles", { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(typeof body?.message === "string" ? body.message : "Failed to load roles");
    }
    return (body.data ?? []) as ApproverRole[];
  }, []);

  const loadWorkflow = useCallback(async (workflowId: number) => {
    const res = await apiFetch(`/request-workflows/workflows/${workflowId}`, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(typeof body?.message === "string" ? body.message : "Failed to load workflow");
    }
    return body as WorkflowDetailResponse;
  }, []);

  useEffect(() => {
    if (!canManage) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    async function init() {
      setLoading(true);
      setError(null);
      try {
        const [typeData, roleData] = await Promise.all([loadTypes(), loadRoles()]);
        if (cancelled) return;
        setTypes(typeData);
        setRoles(roleData);
        if (typeData.length) {
          setSelectedTypeId((current) => current ?? typeData[0]!.id);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load workflow administration");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void init();
    return () => {
      cancelled = true;
    };
  }, [canManage, loadRoles, loadTypes]);

  useEffect(() => {
    const activeWorkflowId = selectedType?.activeWorkflow?.id;
    if (!canManage || !activeWorkflowId) {
      setWorkflowDetail(null);
      setDraftSteps([]);
      setSavedSteps([]);
      return;
    }

    const workflowIdToLoad = activeWorkflowId;

    let cancelled = false;
    async function fetchWorkflow() {
      setLoadingWorkflow(true);
      setError(null);
      try {
        const detail = await loadWorkflow(workflowIdToLoad);
        if (cancelled) return;
        const drafts = stepsToDrafts(detail.steps);
        setWorkflowDetail(detail);
        setDraftSteps(drafts);
        setSavedSteps(drafts);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load workflow");
        }
      } finally {
        if (!cancelled) setLoadingWorkflow(false);
      }
    }
    void fetchWorkflow();
    return () => {
      cancelled = true;
    };
  }, [canManage, loadWorkflow, selectedType?.activeWorkflow?.id]);

  async function refreshTypes() {
    const typeData = await loadTypes();
    setTypes(typeData);
    if (!typeData.some((type) => type.id === selectedTypeId)) {
      setSelectedTypeId(typeData[0]?.id ?? null);
    }
  }

  async function handleCreateType() {
    if (!newTypeKey.trim() || !newTypeLabel.trim()) {
      setError("Type key and label are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch("/request-workflows/types", {
        method: "POST",
        body: JSON.stringify({
          typeKey: newTypeKey.trim(),
          label: newTypeLabel.trim(),
          description: newTypeDescription.trim() || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body?.message === "string" ? body.message : "Failed to create request type");
      }
      setShowNewType(false);
      setNewTypeKey("");
      setNewTypeLabel("");
      setNewTypeDescription("");
      await refreshTypes();
      setSelectedTypeId(body.id);
      setNotice("Request type created.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create request type");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleTypeActive() {
    if (!selectedType) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/request-workflows/types/${selectedType.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !selectedType.isActive }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body?.message === "string" ? body.message : "Failed to update request type");
      }
      await refreshTypes();
      setNotice(`Request type ${body.isActive ? "activated" : "deactivated"}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update request type");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleWorkflowActive() {
    if (!workflowDetail) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/request-workflows/workflows/${workflowDetail.workflow.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !workflowDetail.workflow.isActive }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body?.message === "string" ? body.message : "Failed to update workflow");
      }
      setWorkflowDetail(body);
      await refreshTypes();
      setNotice(`Workflow ${body.workflow.isActive ? "activated" : "deactivated"}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update workflow");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveWorkflow() {
    if (!workflowDetail) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch(`/request-workflows/workflows/${workflowDetail.workflow.id}/steps`, {
        method: "PUT",
        body: JSON.stringify({
          steps: draftSteps.map((step) => ({
            id: step.id ?? undefined,
            stepKey: step.stepKey,
            label: step.label,
            approverRoleKey: step.approverRoleKey,
            requiredPermission: step.requiredPermission,
            scopeMode: step.scopeMode,
            allowEscalate: step.allowEscalate,
          })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body?.message === "string" ? body.message : "Failed to save workflow");
      }
      const drafts = stepsToDrafts(body.steps);
      setWorkflowDetail(body);
      setDraftSteps(drafts);
      setSavedSteps(drafts);
      setNotice("Workflow saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save workflow");
    } finally {
      setSaving(false);
    }
  }

  function handleResetDraft() {
    setDraftSteps(savedSteps.map((step) => ({ ...step })));
    setNotice("Unsaved changes discarded.");
  }

  function handleAddStep(step: WorkflowStepDraft) {
    setDraftSteps((prev) => [...prev, { ...step, clientId: newClientId() }]);
    setStepDialogOpen(false);
    setEditingStepIndex(null);
    setStepDialogError(null);
  }

  function handleUpdateStep(step: WorkflowStepDraft) {
    if (editingStepIndex == null) return;
    setDraftSteps((prev) =>
      prev.map((item, index) => (index === editingStepIndex ? { ...item, ...step } : item)),
    );
    setStepDialogOpen(false);
    setEditingStepIndex(null);
    setStepDialogError(null);
  }

  function handleRemoveStep(index: number) {
    setDraftSteps((prev) => prev.filter((_, i) => i !== index));
  }

  function moveStep(index: number, direction: -1 | 1) {
    setDraftSteps((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item!);
      return next;
    });
  }

  if (!canManage) {
    return (
      <div className="rounded-md border border-border bg-white p-6 text-sm text-slate-600">
        You do not have permission to manage request workflows.
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Request Workflows"
        description="Configure request types and approval hierarchies using dynamic roles from the database."
        actions={
          <Link href="/settings" className="text-sm text-navy-800 hover:underline">
            ← Back to Settings
          </Link>
        }
      />

      {notice ? (
        <div className="mb-4 rounded-md border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-navy-900">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-critical">
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-500">Loading workflow administration…</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_1fr]">
          <Card className="h-fit">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="font-semibold text-navy-900">Request types</h2>
              <Button size="sm" variant="secondary" onClick={() => setShowNewType((v) => !v)}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                New
              </Button>
            </div>

            {showNewType ? (
              <div className="mb-4 space-y-2 rounded-lg border border-border bg-slate-50 p-3">
                <input
                  value={newTypeKey}
                  onChange={(e) => setNewTypeKey(e.target.value)}
                  placeholder="Type key"
                  className="h-9 w-full rounded-md border border-border px-3 text-sm"
                />
                <input
                  value={newTypeLabel}
                  onChange={(e) => setNewTypeLabel(e.target.value)}
                  placeholder="Display label"
                  className="h-9 w-full rounded-md border border-border px-3 text-sm"
                />
                <textarea
                  value={newTypeDescription}
                  onChange={(e) => setNewTypeDescription(e.target.value)}
                  placeholder="Description (optional)"
                  className="min-h-16 w-full rounded-md border border-border px-3 py-2 text-sm"
                />
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button size="sm" className="w-full sm:w-auto" disabled={saving} onClick={() => void handleCreateType()}>
                    Create type
                  </Button>
                  <Button size="sm" variant="secondary" className="w-full sm:w-auto" onClick={() => setShowNewType(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}

            <ul className="space-y-2">
              {types.map((type) => {
                const active = type.id === selectedTypeId;
                return (
                  <li key={type.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedTypeId(type.id)}
                      className={`w-full rounded-lg border px-3 py-3 text-left transition-colors ${
                        active
                          ? "border-navy-800 bg-brand-50"
                          : "border-border bg-white hover:border-navy-700/30"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-navy-900">{type.label}</p>
                          <p className="truncate text-xs text-slate-500">{type.typeKey}</p>
                        </div>
                        <StatusBadge status={type.isActive ? "active" : "inactive"} />
                      </div>
                      {type.activeWorkflow ? (
                        <p className="mt-2 text-xs text-slate-500">
                          {type.activeWorkflow.stepCount} step
                          {type.activeWorkflow.stepCount === 1 ? "" : "s"}
                        </p>
                      ) : (
                        <p className="mt-2 text-xs text-warning">No active workflow</p>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card>
            {!selectedType ? (
              <p className="text-sm text-slate-500">Select a request type to edit its workflow.</p>
            ) : loadingWorkflow ? (
              <p className="text-sm text-slate-500">Loading workflow…</p>
            ) : !workflowDetail ? (
              <div className="space-y-3">
                <h2 className="font-semibold text-navy-900">{selectedType.label}</h2>
                <p className="text-sm text-slate-600">
                  This request type does not have an active workflow yet.
                </p>
                <Button
                  size="sm"
                  disabled={saving}
                  onClick={async () => {
                    setSaving(true);
                    setError(null);
                    try {
                      const res = await apiFetch(`/request-workflows/types/${selectedType.id}/workflows`, {
                        method: "POST",
                        body: JSON.stringify({
                          label: `${selectedType.label} Workflow`,
                          workflowKey: "default",
                        }),
                      });
                      const body = await res.json().catch(() => ({}));
                      if (!res.ok) {
                        throw new Error(
                          typeof body?.message === "string" ? body.message : "Failed to create workflow",
                        );
                      }
                      setWorkflowDetail(body);
                      setDraftSteps([]);
                      setSavedSteps([]);
                      await refreshTypes();
                      setNotice("Workflow created. Add approval steps and save.");
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Failed to create workflow");
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  Create workflow
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="font-semibold text-navy-900">{selectedType.label}</h2>
                    <p className="text-sm text-slate-600">{workflowDetail.workflow.label}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <StatusBadge status={selectedType.isActive ? "active" : "inactive"} />
                      <StatusBadge
                        status={workflowDetail.workflow.isActive ? "active" : "inactive"}
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="w-full sm:w-auto"
                      disabled={saving}
                      onClick={() => void handleToggleTypeActive()}
                    >
                      {selectedType.isActive ? "Deactivate type" : "Activate type"}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="w-full sm:w-auto"
                      disabled={saving}
                      onClick={() => void handleToggleWorkflowActive()}
                    >
                      {workflowDetail.workflow.isActive ? "Deactivate workflow" : "Activate workflow"}
                    </Button>
                  </div>
                </div>

                {selectedType.description ? (
                  <p className="text-sm text-slate-600">{selectedType.description}</p>
                ) : null}

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <h3 className="font-semibold text-navy-900">Approval steps</h3>
                  <Button
                    size="sm"
                    className="w-full sm:w-auto"
                    onClick={() => {
                      setEditingStepIndex(null);
                      setStepDialogOpen(true);
                    }}
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    Add step
                  </Button>
                </div>

                <WorkflowStepTimeline
                  steps={draftSteps}
                  roles={roles}
                  onEdit={(index) => {
                    setEditingStepIndex(index);
                    setStepDialogOpen(true);
                  }}
                  onRemove={handleRemoveStep}
                  onMoveUp={(index) => moveStep(index, -1)}
                  onMoveDown={(index) => moveStep(index, 1)}
                />

                <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="w-full sm:w-auto"
                    disabled={!isDirty || saving}
                    onClick={handleResetDraft}
                  >
                    <RefreshCw className="mr-1 h-3.5 w-3.5" />
                    Cancel changes
                  </Button>
                  <Button
                    size="sm"
                    className="w-full sm:w-auto"
                    disabled={!isDirty || saving || draftSteps.length === 0}
                    onClick={() => void handleSaveWorkflow()}
                  >
                    {saving ? "Saving…" : "Save workflow"}
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      <WorkflowStepDialog
        open={stepDialogOpen}
        roles={roles}
        initial={editingStepIndex != null ? draftSteps[editingStepIndex] ?? null : null}
        busy={saving}
        error={stepDialogError}
        onClose={() => {
          setStepDialogOpen(false);
          setEditingStepIndex(null);
          setStepDialogError(null);
        }}
        onSave={(step) => {
          if (editingStepIndex != null) handleUpdateStep(step);
          else handleAddStep(step);
        }}
      />
    </div>
  );
}
