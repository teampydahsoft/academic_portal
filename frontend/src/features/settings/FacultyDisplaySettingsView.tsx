"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/components/auth/AuthProvider";

type FacultyGroupOption = {
  id: string;
  name: string;
  enabled: boolean;
  employeeCount: number;
  isTeachingDefault: boolean;
};

type FacultyDisplaySettings = {
  groups: FacultyGroupOption[];
  enabledCount: number;
  totalGroups: number;
  usingDefaults: boolean;
  description: string;
};

export function FacultyDisplaySettingsView() {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("settings.edit");
  const [settings, setSettings] = useState<FacultyDisplaySettings | null>(null);
  const [enabledIds, setEnabledIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  function applySettings(data: FacultyDisplaySettings) {
    setSettings(data);
    setEnabledIds(new Set(data.groups.filter((g) => g.enabled).map((g) => g.id)));
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch(`/settings/faculty-display`, {
          cache: "no-store",
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            typeof body?.message === "string" ? body.message : "Failed to load settings",
          );
        }
        if (!cancelled) applySettings(body as FacultyDisplaySettings);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load settings");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredGroups = useMemo(() => {
    if (!settings) return [];
    const q = search.trim().toLowerCase();
    if (!q) return settings.groups;
    return settings.groups.filter((g) => g.name.toLowerCase().includes(q));
  }, [settings, search]);

  const savedEnabledKey = useMemo(() => {
    if (!settings) return "";
    return settings.groups
      .filter((g) => g.enabled)
      .map((g) => g.id)
      .sort()
      .join(",");
  }, [settings]);

  const draftEnabledKey = useMemo(
    () => [...enabledIds].sort().join(","),
    [enabledIds],
  );

  const dirty = settings != null && draftEnabledKey !== savedEnabledKey;

  function toggle(id: string) {
    setEnabledIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectTeachingDefaults() {
    if (!settings) return;
    setEnabledIds(
      new Set(settings.groups.filter((g) => g.isTeachingDefault).map((g) => g.id)),
    );
  }

  function selectAll() {
    if (!settings) return;
    setEnabledIds(new Set(settings.groups.map((g) => g.id)));
  }

  function clearAll() {
    setEnabledIds(new Set());
  }

  async function save() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await apiFetch(`/settings/faculty-display`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabledGroupIds: [...enabledIds] }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof body?.message === "string" ? body.message : "Failed to save settings",
        );
      }
      applySettings(body as FacultyDisplaySettings);
      setMessage(
        "Saved. Faculty & Departments now shows employees from the enabled groups only.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Faculty & Departments Display"
        description="Choose which HRMS employee groups appear on Faculty & Departments."
        actions={
          <Link href="/settings">
            <Button size="sm" variant="secondary">
              Back to Settings
            </Button>
          </Link>
        }
      />

      {error && <p className="mb-3 text-sm text-critical">{error}</p>}
      {message && <p className="mb-3 text-sm text-emerald-700">{message}</p>}
      {loading && <p className="mb-3 text-sm text-slate-500">Loading employee groups from HRMS…</p>}

      {!loading && settings && (
        <>
          <Card className="mb-4">
            <p className="text-sm text-slate-600">{settings.description}</p>
            <p className="mt-2 text-sm text-navy-900">
              <span className="font-semibold">{enabledIds.size}</span> of{" "}
              <span className="font-semibold">{settings.totalGroups}</span> groups enabled
              {settings.usingDefaults && !dirty
                ? " (defaults: teaching groups — save to lock in)"
                : null}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={selectTeachingDefaults}>
                Teaching defaults
              </Button>
              <Button size="sm" variant="secondary" onClick={selectAll}>
                Enable all
              </Button>
              <Button size="sm" variant="secondary" onClick={clearAll}>
                Disable all
              </Button>
              <Button size="sm" disabled={!canEdit || !dirty || saving} onClick={() => void save()}>
                {saving ? "Saving…" : "Save"}
              </Button>
              {dirty && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={saving}
                  onClick={() =>
                    setEnabledIds(
                      new Set(settings.groups.filter((g) => g.enabled).map((g) => g.id)),
                    )
                  }
                >
                  Reset
                </Button>
              )}
            </div>
          </Card>

          <div className="mb-3">
            <input
              type="search"
              placeholder="Search employee groups…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-navy-900 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-navy-800"
            />
          </div>

          <DataTable
            rows={filteredGroups}
            rowKey={(r) => r.id}
            emptyMessage="No employee groups found in HRMS."
            columns={[
              {
                key: "enabled",
                header: "Enabled",
                render: (row) => (
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border text-navy-800 focus:ring-navy-800"
                    checked={enabledIds.has(row.id)}
                    onChange={() => toggle(row.id)}
                    aria-label={`Enable ${row.name}`}
                  />
                ),
              },
              {
                key: "name",
                header: "Employee group",
                render: (row) => (
                  <div>
                    <p className="font-medium text-navy-900">{row.name}</p>
                    {row.isTeachingDefault && (
                      <p className="text-xs text-slate-500">Teaching default</p>
                    )}
                  </div>
                ),
              },
              {
                key: "count",
                header: "Active employees",
                render: (row) => (
                  <span className="tabular-nums text-navy-900">{row.employeeCount}</span>
                ),
              },
            ]}
          />
        </>
      )}
    </div>
  );
}
