"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api";

type ComplaintType = {
  id?: number;
  name: string;
  enabled: boolean;
};

export function ComplaintTypesSettingsView() {
  const [types, setTypes] = useState<ComplaintType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await apiFetch("/settings/complaint-types");
        if (!res.ok) throw new Error("Failed to load complaint types");
        const data = await res.json();
        setTypes(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error loading");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  const addType = () => {
    setTypes([...types, { name: "", enabled: true }]);
    setSaveSuccess(false);
  };

  const updateType = (index: number, changes: Partial<ComplaintType>) => {
    const updated = [...types];
    updated[index] = { ...updated[index], ...changes };
    setTypes(updated);
    setSaveSuccess(false);
  };

  const removeType = (index: number) => {
    const updated = [...types];
    updated.splice(index, 1);
    setTypes(updated);
    setSaveSuccess(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaveSuccess(false);
    try {
      // Filter out empty names
      const validTypes = types.filter((t) => t.name.trim() !== "");
      const res = await apiFetch("/settings/complaint-types", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ types: validTypes }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Failed to save");
      }
      const data = await res.json();
      setTypes(data);
      setSaveSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error saving");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <PageHeader
          title="Mentoring Complaint Types"
          description="Manage the dynamic list of complaint/risk types available when creating a mentoring case."
          className="mb-0"
        />
        <Link href="/settings">
          <Button variant="ghost">Back to settings</Button>
        </Link>
      </div>

      <Card className="max-w-2xl">
        {error ? (
          <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-600">
            {error}
          </div>
        ) : null}

        {saveSuccess ? (
          <div className="mb-4 rounded-md bg-green-50 p-3 text-sm text-green-700">
            Successfully saved complaint types.
          </div>
        ) : null}

        {loading ? (
          <p className="text-sm text-slate-500">Loading...</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-3">
              {types.length === 0 ? (
                <p className="text-sm text-slate-500">No complaint types configured.</p>
              ) : null}
              {types.map((type, index) => (
                <div key={index} className="flex items-center gap-3">
                  <input
                    type="text"
                    value={type.name}
                    onChange={(e) => updateType(index, { name: e.target.value })}
                    placeholder="E.g. Disciplinary Issue"
                    className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-navy-500"
                  />
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={type.enabled}
                      onChange={(e) => updateType(index, { enabled: e.target.checked })}
                      className="rounded border-slate-300 text-navy-600 focus:ring-navy-500"
                    />
                    Enabled
                  </label>
                  <Button variant="ghost" size="sm" onClick={() => removeType(index)}>
                    Remove
                  </Button>
                </div>
              ))}
            </div>

            <div className="pt-2">
              <Button variant="secondary" size="sm" onClick={addType}>
                + Add complaint type
              </Button>
            </div>

            <div className="flex justify-end border-t border-slate-100 pt-4">
              <Button onClick={() => void handleSave()} disabled={saving}>
                {saving ? "Saving..." : "Save changes"}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
