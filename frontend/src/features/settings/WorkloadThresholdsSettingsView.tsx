"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/components/auth/AuthProvider";

type WorkloadThresholds = {
  minPeriodsPerWeek: number;
  maxPeriodsPerWeek: number;
  maxPeriodsPerDay: number;
  minHoursPerWeek: number | null;
  maxHoursPerWeek: number | null;
};

type SettingsPayload = {
  collegeId: number | null;
  thresholds: WorkloadThresholds;
  usingDefaults: boolean;
  colleges: Array<{ id: number; name: string; hasOverride: boolean }>;
  description: string;
};

const EMPTY_FORM: WorkloadThresholds = {
  minPeriodsPerWeek: 8,
  maxPeriodsPerWeek: 20,
  maxPeriodsPerDay: 5,
  minHoursPerWeek: 16,
  maxHoursPerWeek: null,
};

export function WorkloadThresholdsSettingsView() {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("settings.edit");

  const [collegeId, setCollegeId] = useState<string>("all");
  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [form, setForm] = useState<WorkloadThresholds>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const applySettings = useCallback((data: SettingsPayload) => {
    setSettings(data);
    setForm({ ...data.thresholds });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (collegeId !== "all") params.set("collegeId", collegeId);
      const res = await apiFetch(`/settings/workload-thresholds?${params.toString()}`, {
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof body?.message === "string" ? body.message : "Failed to load workload thresholds",
        );
      }
      applySettings(body as SettingsPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workload thresholds");
      setSettings(null);
    } finally {
      setLoading(false);
    }
  }, [applySettings, collegeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const savedKey = useMemo(
    () => (settings ? JSON.stringify(settings.thresholds) : ""),
    [settings],
  );
  const draftKey = useMemo(() => JSON.stringify(form), [form]);
  const dirty = settings != null && draftKey !== savedKey;

  function updateNumber(
    key: keyof Pick<
      WorkloadThresholds,
      "minPeriodsPerWeek" | "maxPeriodsPerWeek" | "maxPeriodsPerDay"
    >,
    value: string,
  ) {
    const parsed = Number(value);
    setForm((prev) => ({
      ...prev,
      [key]: Number.isFinite(parsed) ? parsed : 0,
    }));
  }

  function updateOptionalHours(
    key: "minHoursPerWeek" | "maxHoursPerWeek",
    value: string,
  ) {
    setForm((prev) => ({
      ...prev,
      [key]: value.trim() === "" ? null : Number(value),
    }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await apiFetch("/settings/workload-thresholds", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collegeId: collegeId === "all" ? null : Number(collegeId),
          ...form,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof body?.message === "string" ? body.message : "Failed to save workload thresholds",
        );
      }
      applySettings(body as SettingsPayload);
      setMessage("Workload thresholds saved. Staff Workload status will use these limits.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save workload thresholds");
    } finally {
      setSaving(false);
    }
  }

  const fieldClass =
    "h-10 w-full rounded-lg border border-border bg-white px-3 text-sm text-navy-900 outline-none focus:border-navy-700 focus:ring-2 focus:ring-navy-900/10";

  return (
    <div>
      <PageHeader
        title="Workload Thresholds"
        description="Configure minimum and maximum teaching load used for Underloaded / Balanced / Overloaded status."
        actions={
          <Link href="/settings">
            <Button size="sm" variant="secondary">
              Back to Settings
            </Button>
          </Link>
        }
      />

      {error ? <p className="mb-3 text-sm text-critical">{error}</p> : null}
      {message ? <p className="mb-3 text-sm text-emerald-700">{message}</p> : null}
      {loading ? <p className="mb-3 text-sm text-slate-500">Loading thresholds…</p> : null}

      {!loading && settings ? (
        <>
          <Card className="mb-4">
            <p className="text-sm text-slate-600">{settings.description}</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-navy-900">Scope</span>
                <select
                  className={fieldClass}
                  value={collegeId}
                  onChange={(event) => setCollegeId(event.target.value)}
                >
                  <option value="all">All colleges (global default)</option>
                  {settings.colleges.map((college) => (
                    <option key={college.id} value={String(college.id)}>
                      {college.name}
                      {college.hasOverride ? " · custom" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex items-end text-sm text-slate-600">
                {settings.usingDefaults ? (
                  <p>Using built-in defaults until you save custom values for this scope.</p>
                ) : (
                  <p>Custom thresholds are active for this scope.</p>
                )}
              </div>
            </div>
          </Card>

          <Card className="mb-4">
            <h3 className="mb-3 text-sm font-semibold text-navy-900">Period limits</h3>
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block text-sm">
                <span className="mb-1 block text-slate-600">Min periods / week</span>
                <input
                  type="number"
                  min={0}
                  className={fieldClass}
                  value={form.minPeriodsPerWeek}
                  disabled={!canEdit}
                  onChange={(event) => updateNumber("minPeriodsPerWeek", event.target.value)}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-slate-600">Max periods / week</span>
                <input
                  type="number"
                  min={0}
                  className={fieldClass}
                  value={form.maxPeriodsPerWeek}
                  disabled={!canEdit}
                  onChange={(event) => updateNumber("maxPeriodsPerWeek", event.target.value)}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-slate-600">Max periods / day</span>
                <input
                  type="number"
                  min={0}
                  className={fieldClass}
                  value={form.maxPeriodsPerDay}
                  disabled={!canEdit}
                  onChange={(event) => updateNumber("maxPeriodsPerDay", event.target.value)}
                />
              </label>
            </div>
          </Card>

          <Card className="mb-4">
            <h3 className="mb-1 text-sm font-semibold text-navy-900">Hour limits</h3>
            <p className="mb-3 text-xs text-slate-500">
              Optional. Faculty below min hours or above max hours are flagged even when period
              counts look balanced. Leave max hours blank for no upper hour limit.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1 block text-slate-600">Min hours / week</span>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  className={fieldClass}
                  value={form.minHoursPerWeek ?? ""}
                  disabled={!canEdit}
                  onChange={(event) => updateOptionalHours("minHoursPerWeek", event.target.value)}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-slate-600">Max hours / week</span>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  className={fieldClass}
                  value={form.maxHoursPerWeek ?? ""}
                  disabled={!canEdit}
                  placeholder="No limit"
                  onChange={(event) => updateOptionalHours("maxHoursPerWeek", event.target.value)}
                />
              </label>
            </div>
          </Card>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={!canEdit || !dirty || saving} onClick={() => void save()}>
              {saving ? "Saving…" : "Save thresholds"}
            </Button>
            {dirty ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={saving}
                onClick={() => settings && setForm({ ...settings.thresholds })}
              >
                Reset
              </Button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
