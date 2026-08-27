import { useCallback, useMemo, useState, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api";
import type { ManagedUser, PermissionCatalogItem } from "@/features/user-management/types";
import {
  PERMISSION_MATRIX_MODULES,
  PERMISSION_PRESENTATION,
  allMatrixPermissionKeys,
  type MatrixModuleDef,
} from "@/features/user-management/permission-matrix";

type Props = {
  user: ManagedUser;
  onClose: () => void;
  onSaved: (user: ManagedUser) => void;
};

function groupModules(modules: MatrixModuleDef[]) {
  const groups: { title: string; items: MatrixModuleDef[] }[] = [];
  for (const mod of modules) {
    const existing = groups.find((g) => g.title === mod.group);
    if (existing) existing.items.push(mod);
    else groups.push({ title: mod.group, items: [mod] });
  }
  return groups;
}

export function UserPermissionsModal({ user, onClose, onSaved }: Props) {
  const [catalog, setCatalog] = useState<PermissionCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initialDirect = useMemo(() => new Set(user.directPermissions ?? []), [user.directPermissions]);
  const initialRevoked = useMemo(() => new Set(user.revokedPermissions ?? []), [user.revokedPermissions]);
  const rolePerms = useMemo(() => new Set(user.rolePermissions ?? []), [user.rolePermissions]);
  
  const [draftDirect, setDraftDirect] = useState<Set<string>>(initialDirect);
  const [draftRevoked, setDraftRevoked] = useState<Set<string>>(initialRevoked);

  const navGroups = useMemo(() => groupModules(PERMISSION_MATRIX_MODULES), []);
  const dirty = 
    Array.from(draftDirect).sort().join(",") !== Array.from(initialDirect).sort().join(",") ||
    Array.from(draftRevoked).sort().join(",") !== Array.from(initialRevoked).sort().join(",");

  const loadCatalog = useCallback(async () => {
    try {
      const res = await apiFetch("/permissions", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || "Failed to load permissions");
      setCatalog(body.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  async function save() {
    if (!dirty) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/users/${user.id}/permissions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          permissions: Array.from(draftDirect),
          revokedPermissions: Array.from(draftRevoked)
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || "Failed to save direct permissions");
      onSaved(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
      setBusy(false);
    }
  }

  function togglePermission(key: string, fromRole: boolean) {
    if (fromRole) {
      setDraftRevoked((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    } else {
      setDraftDirect((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    }
  }

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
        <div className="flex w-full max-w-4xl flex-col rounded-2xl bg-white shadow-2xl p-8 items-center justify-center">
          <p className="text-sm text-slate-500">Loading permissions...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="flex max-h-full w-full max-w-5xl flex-col rounded-2xl bg-slate-50 shadow-2xl">
        <div className="flex items-center justify-between border-b border-border bg-white px-6 py-4 rounded-t-2xl">
          <div>
            <h2 className="text-lg font-bold text-navy-900">Direct Permissions</h2>
            <p className="text-sm text-slate-500 mt-1">
              Add explicit permissions for <strong className="font-medium text-navy-800">{user.name}</strong>.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={save} disabled={!dirty || busy}>
              {busy ? "Saving..." : "Save changes"}
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6 flex flex-col gap-6">
          {error && (
            <div className="rounded-lg bg-red-50 p-4 text-sm text-red-600">
              {error}
            </div>
          )}

          <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4 text-sm text-blue-800">
            <p>
              Permissions inherited from the user&apos;s roles are marked with <span className="text-[10px] font-normal uppercase tracking-wider text-slate-400 border border-slate-200 px-1 py-0.5 rounded bg-white">Inherited</span>.
            </p>
            <p className="mt-1">
              You can grant new permissions by checking them, or revoke inherited ones by unchecking them.
            </p>
          </div>

          <div className="flex flex-col gap-8">
            {navGroups.map((g) => (
              <div key={g.title}>
                <h3 className="mb-4 text-lg font-bold text-navy-900">{g.title}</h3>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {g.items.map((mod) => (
                    <div
                      key={mod.href}
                      className="flex flex-col rounded-xl border border-border bg-white overflow-hidden shadow-sm"
                    >
                      <div className="border-b border-slate-100 bg-slate-50/50 px-4 py-3">
                        <p className="font-semibold text-navy-900">{mod.label}</p>
                        {mod.accessNote && <p className="text-xs text-slate-500 mt-0.5">{mod.accessNote}</p>}
                      </div>
                      <div className="p-4 flex flex-col gap-3">
                        {mod.permissions.map((p) => {
                          const fromRole = rolePerms.has(p.key);
                          const isDirect = draftDirect.has(p.key);
                          const isRevoked = draftRevoked.has(p.key);
                          const presentation = PERMISSION_PRESENTATION[p.key];
                          const fallbackName = p.key.split(".").pop() || p.key;

                          const checked = (fromRole && !isRevoked) || isDirect;

                          return (
                            <label
                              key={p.key}
                              className={`flex items-start gap-3 rounded-lg p-2 transition-colors cursor-pointer hover:bg-slate-50`}
                            >
                              <div className="pt-0.5">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600 disabled:opacity-50 cursor-inherit"
                                  checked={checked}
                                  disabled={busy}
                                  onChange={() => togglePermission(p.key, fromRole)}
                                />
                              </div>
                              <div className="flex-1 min-w-0 text-sm">
                                <p className={`font-medium ${fromRole && !isRevoked ? "text-slate-600" : "text-slate-900"}`}>
                                  {presentation?.label || fallbackName}
                                  {fromRole && <span className="ml-2 text-[10px] font-normal uppercase tracking-wider text-slate-400 border border-slate-200 px-1 py-0.5 rounded">Inherited</span>}
                                </p>
                                {(presentation?.description || p.kind === "write") && (
                                  <p className="text-xs text-slate-500 mt-0.5 leading-snug">
                                    {presentation?.description || (p.kind === "write" ? "Allows modifying data" : "")}
                                  </p>
                                )}
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
