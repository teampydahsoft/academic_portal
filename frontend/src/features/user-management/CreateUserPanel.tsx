"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, UserRound } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";
import { getRoleStyle } from "@/features/user-management/RoleBadge";
import type { ApRoleOption, HrmsCandidate, ManagedUser } from "@/features/user-management/types";

const fieldClass =
  "mt-1 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-navy-900 outline-none focus:border-navy-800 focus:ring-2 focus:ring-navy-800/10 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-600";

type Props = {
  roles: ApRoleOption[];
  colleges: Array<{ id: number; name: string }>;
  courses: Array<{ id: number; name: string; collegeId: number }>;
  branches: Array<{ id: number; name: string; courseId: number }>;
  canManage: boolean;
  onCreated: (user: ManagedUser) => Promise<void>;
};

type CourseScopeDraft = {
  /** all branches under this course */
  allBranches: boolean;
  branchIds: number[];
};

type CollegeScopeDraft = {
  /** whole college (all courses / all branches) → one assignment with branchId null */
  allCollege: boolean;
  /** courseId → selected course access */
  courses: Record<number, CourseScopeDraft>;
};

function coursesForCollege(
  courses: Array<{ id: number; name: string; collegeId: number }>,
  collegeId: number,
) {
  return courses.filter((c) => c.collegeId === collegeId);
}

function branchesForCourse(
  branches: Array<{ id: number; name: string; courseId: number }>,
  courseId: number,
) {
  return branches.filter((b) => b.courseId === courseId);
}

function collegeDraftReady(
  draft: CollegeScopeDraft,
  branches: Array<{ id: number; name: string; courseId: number }>,
): boolean {
  if (draft.allCollege) return true;
  const selectedCourseIds = Object.keys(draft.courses).map(Number);
  if (!selectedCourseIds.length) return false;
  return selectedCourseIds.every((courseId) => {
    const courseDraft = draft.courses[courseId];
    if (!courseDraft) return false;
    if (courseDraft.allBranches) {
      return branchesForCourse(branches, courseId).length > 0;
    }
    return courseDraft.branchIds.length > 0;
  });
}

export function CreateUserPanel(props: Props) {
  const creatableRoles = useMemo(
    () => props.roles.filter((r) => r.roleKey !== "super_admin" && r.isActive !== false),
    [props.roles],
  );

  const [importOpen, setImportOpen] = useState(false);
  const [selected, setSelected] = useState<HrmsCandidate | null>(null);
  const [roleKey, setRoleKey] = useState(creatableRoles[0]?.roleKey ?? "staff");
  const [collegeScopes, setCollegeScopes] = useState<Record<number, CollegeScopeDraft>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!creatableRoles.some((r) => r.roleKey === roleKey) && creatableRoles[0]) {
      setRoleKey(creatableRoles[0].roleKey);
    }
  }, [creatableRoles, roleKey]);

  const selectedRole = creatableRoles.find((r) => r.roleKey === roleKey) ?? null;
  const isGlobal = Boolean(selectedRole?.isGlobalCapable);
  const selectedCollegeIds = useMemo(
    () =>
      Object.keys(collegeScopes)
        .map(Number)
        .filter((id) => Number.isFinite(id))
        .sort((a, b) => a - b),
    [collegeScopes],
  );

  const scopesPayload = useMemo(() => {
    if (isGlobal) return [{ collegeId: null as number | null, branchId: null as number | null }];
    const scopes: Array<{ collegeId: number; branchId: number | null }> = [];
    for (const collegeId of selectedCollegeIds) {
      const draft = collegeScopes[collegeId];
      if (!draft) continue;
      if (draft.allCollege) {
        scopes.push({ collegeId, branchId: null });
        continue;
      }
      for (const [courseIdText, courseDraft] of Object.entries(draft.courses)) {
        const courseId = Number(courseIdText);
        const courseBranches = branchesForCourse(props.branches, courseId);
        if (courseDraft.allBranches) {
          for (const branch of courseBranches) {
            scopes.push({ collegeId, branchId: branch.id });
          }
        } else {
          for (const branchId of courseDraft.branchIds) {
            scopes.push({ collegeId, branchId });
          }
        }
      }
    }
    // Deduplicate
    const seen = new Set<string>();
    return scopes.filter((s) => {
      const key = `${s.collegeId}:${s.branchId ?? "null"}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [isGlobal, selectedCollegeIds, collegeScopes, props.branches]);

  const scopeReady =
    isGlobal ||
    (scopesPayload.length > 0 &&
      selectedCollegeIds.every((id) => {
        const draft = collegeScopes[id];
        return draft
          ? collegeDraftReady(draft, props.branches)
          : false;
      }));

  const canSubmit =
    props.canManage &&
    Boolean(selected?.canLink) &&
    Boolean(roleKey) &&
    scopeReady &&
    !busy;

  function reset() {
    setSelected(null);
    setRoleKey(creatableRoles[0]?.roleKey ?? "staff");
    setCollegeScopes({});
    setError(null);
  }

  function toggleCollege(collegeId: number) {
    setCollegeScopes((prev) => {
      if (prev[collegeId]) {
        const next = { ...prev };
        delete next[collegeId];
        return next;
      }
      return {
        ...prev,
        [collegeId]: { allCollege: true, courses: {} },
      };
    });
    setError(null);
  }

  function setCollegeMode(collegeId: number, allCollege: boolean) {
    setCollegeScopes((prev) => {
      const current = prev[collegeId];
      if (!current) return prev;
      return {
        ...prev,
        [collegeId]: allCollege
          ? { allCollege: true, courses: {} }
          : { allCollege: false, courses: current.courses },
      };
    });
    setError(null);
  }

  function toggleCourse(collegeId: number, courseId: number) {
    setCollegeScopes((prev) => {
      const current = prev[collegeId];
      if (!current) return prev;
      const courses = { ...current.courses };
      if (courses[courseId]) {
        delete courses[courseId];
      } else {
        courses[courseId] = { allBranches: true, branchIds: [] };
      }
      return {
        ...prev,
        [collegeId]: { allCollege: false, courses },
      };
    });
    setError(null);
  }

  function setCourseBranchMode(collegeId: number, courseId: number, allBranches: boolean) {
    setCollegeScopes((prev) => {
      const current = prev[collegeId];
      const course = current?.courses[courseId];
      if (!current || !course) return prev;
      return {
        ...prev,
        [collegeId]: {
          allCollege: false,
          courses: {
            ...current.courses,
            [courseId]: allBranches
              ? { allBranches: true, branchIds: [] }
              : { allBranches: false, branchIds: course.branchIds },
          },
        },
      };
    });
    setError(null);
  }

  function toggleBranch(collegeId: number, courseId: number, branchId: number) {
    setCollegeScopes((prev) => {
      const current = prev[collegeId];
      const course = current?.courses[courseId];
      if (!current || !course) return prev;
      const has = course.branchIds.includes(branchId);
      const branchIds = has
        ? course.branchIds.filter((id) => id !== branchId)
        : [...course.branchIds, branchId];
      return {
        ...prev,
        [collegeId]: {
          allCollege: false,
          courses: {
            ...current.courses,
            [courseId]: { allBranches: false, branchIds },
          },
        },
      };
    });
    setError(null);
  }

  async function submit() {
    if (!selected?.canLink) {
      setError(
        selected?.linkBlockReason ||
          "Import an HRMS employee first (from the employees directory).",
      );
      return;
    }
    if (!isGlobal && selectedCollegeIds.length === 0) {
      setError("Select at least one college for this role’s access scope.");
      return;
    }
    if (!scopeReady) {
      setError(
        "For each college: choose whole college, or select courses and then branches under those courses.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch("/users/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hrmsUserId: selected.hrmsUserId,
          roleKey,
          scopes: scopesPayload,
          isActive: true,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.message || "Failed to create user");
      reset();
      await props.onCreated(body as ManagedUser);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setBusy(false);
    }
  }

  if (!props.canManage) {
    return (
      <div className="rounded-lg border border-border bg-white p-6 text-sm text-slate-600">
        You do not have permission to create portal users.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 rounded-md border border-blue-100 bg-blue-50/70 px-3 py-2.5 text-xs leading-relaxed text-slate-700">
        Same order as Student DB: <strong className="font-medium text-navy-900">Import HRMS employee</strong>{" "}
        (from the employees directory — not HRMS login roles) → assign an{" "}
        <strong className="font-medium text-navy-900">Academic Portal role</strong> → grant access by
        college → course → branch → Create User. Sign-in password still comes from HRMS when their
        login exists.
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* 1 · User Information */}
        <section className="rounded-xl border border-sky-200 bg-sky-50/40 p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-600 text-xs font-bold text-white">
                1
              </span>
              <h3 className="text-sm font-semibold text-navy-900">User Information</h3>
            </div>
            <Button
              type="button"
              className="!h-8 !bg-violet-700 !px-3 !text-xs hover:!bg-violet-800"
              onClick={() => setImportOpen(true)}
            >
              <Search className="mr-1.5 h-3.5 w-3.5" />
              Import HRMS employee
            </Button>
          </div>

          <label className="mb-3 block text-xs font-medium text-slate-600">
            Full Name *
            <input className={fieldClass} value={selected?.name ?? ""} disabled placeholder="Import from HRMS" />
          </label>
          <label className="mb-3 block text-xs font-medium text-slate-600">
            Email Address *
            <input
              className={fieldClass}
              value={selected?.email ?? ""}
              disabled
              placeholder="Import from HRMS"
            />
          </label>
          <label className="mb-3 block text-xs font-medium text-slate-600">
            Username *
            <input
              className={fieldClass}
              value={selected?.email || selected?.employeeId || ""}
              disabled
              placeholder="From HRMS login"
            />
          </label>
          <label className="mb-3 block text-xs font-medium text-slate-600">
            Employee ID
            <input
              className={fieldClass}
              value={selected?.employeeId ?? ""}
              disabled
              placeholder="From HRMS"
            />
          </label>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Password *
            <input
              className={fieldClass}
              type="password"
              value={selected ? "••••••••" : ""}
              disabled
              placeholder="HRMS password (not stored here)"
            />
          </label>
          <p className="text-[11px] leading-relaxed text-slate-500">
            We import staff from the HRMS <strong className="font-medium">employees</strong> directory.
            Portal roles are assigned here (HRMS roles are separate). At sign-in we verify the password
            live from HRMS login when it exists — never stored in Academic Portal.
          </p>

          {selected && !selected.canLink ? (
            <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
              {selected.linkBlockReason || "This employee cannot be added yet."}
            </p>
          ) : null}
          {selected?.canLink ? (
            <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-xs text-emerald-900">
              Imported employee {selected.name}
              {selected.department ? ` · ${selected.department}` : ""}. Assign an Academic Portal role
              and scope next.
              {selected.hasHrmsLogin === false
                ? " Note: no HRMS password found on this employee yet — they need a password in HRMS before they can sign in."
                : " They can sign in with their HRMS employee password (email or employee id)."}
            </p>
          ) : null}
        </section>

        {/* 2 · Role Selection */}
        <section className="rounded-xl border border-violet-200 bg-violet-50/40 p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-700 text-xs font-bold text-white">
              2
            </span>
            <h3 className="text-sm font-semibold text-navy-900">Role Selection</h3>
          </div>
          <div className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
            {creatableRoles.map((role) => {
              const active = role.roleKey === roleKey;
              const style = getRoleStyle(role.roleKey);
              return (
                <button
                  key={role.roleKey}
                  type="button"
                  onClick={() => {
                    setRoleKey(role.roleKey);
                    if (role.isGlobalCapable) {
                      setCollegeScopes({});
                    }
                    setError(null);
                  }}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition",
                    active
                      ? cn(style.cardActive, style.border)
                      : "border-slate-200 bg-white/80 hover:border-slate-300",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                      active ? cn(style.iconBg, style.iconText) : "bg-slate-100 text-slate-500",
                    )}
                  >
                    <UserRound className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-navy-900">{role.label}</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">
                      {role.description ||
                        (role.isGlobalCapable
                          ? "Global role — no college/branch required."
                          : "College-scoped access for this portal.")}
                    </span>
                  </span>
                </button>
              );
            })}
            {creatableRoles.length === 0 ? (
              <p className="text-sm text-slate-500">No assignable roles available.</p>
            ) : null}
          </div>
        </section>

        {/* 3 · Access Scope */}
        <section className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-700 text-xs font-bold text-white">
              3
            </span>
            <h3 className="text-sm font-semibold text-navy-900">Access Scope</h3>
          </div>

          {isGlobal ? (
            <div className="rounded-lg border border-emerald-200 bg-white px-3 py-4 text-sm text-slate-600">
              This role is assigned <strong className="font-medium text-navy-900">globally</strong> — no
              college / course / branch selection needed.
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-slate-600">
                Select college(s), then courses, then branches — access is granted individually at each
                level.
              </p>
              <div className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
                {props.colleges.map((college) => {
                  const checked = Boolean(collegeScopes[college.id]);
                  const draft = collegeScopes[college.id];
                  const collegeCourses = coursesForCollege(props.courses, college.id);
                  return (
                    <div
                      key={college.id}
                      className={`rounded-lg border bg-white px-3 py-2.5 ${
                        checked ? "border-emerald-400 ring-1 ring-emerald-200" : "border-slate-200"
                      }`}
                    >
                      <label className="flex cursor-pointer items-start gap-2">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600/30"
                          checked={checked}
                          onChange={() => toggleCollege(college.id)}
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-navy-900">
                            {college.name}
                          </span>
                          <span className="text-[11px] text-slate-500">
                            {collegeCourses.length
                              ? `${collegeCourses.length} course${collegeCourses.length === 1 ? "" : "s"}`
                              : "No courses listed"}
                          </span>
                        </span>
                      </label>

                      {checked && draft ? (
                        <div className="mt-2.5 space-y-2 border-t border-slate-100 pt-2.5 pl-6">
                          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700">
                            <input
                              type="radio"
                              name={`college-mode-${college.id}`}
                              checked={draft.allCollege}
                              onChange={() => setCollegeMode(college.id, true)}
                              className="h-3.5 w-3.5 border-slate-300 text-emerald-700 focus:ring-emerald-600/30"
                            />
                            Entire college (all courses &amp; branches)
                          </label>
                          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700">
                            <input
                              type="radio"
                              name={`college-mode-${college.id}`}
                              checked={!draft.allCollege}
                              onChange={() => setCollegeMode(college.id, false)}
                              className="h-3.5 w-3.5 border-slate-300 text-emerald-700 focus:ring-emerald-600/30"
                            />
                            Specific courses
                          </label>

                          {!draft.allCollege ? (
                            collegeCourses.length === 0 ? (
                              <p className="text-[11px] text-amber-800">
                                No courses for this college. Use “Entire college” or add courses in
                                masters first.
                              </p>
                            ) : (
                              <div className="space-y-2">
                                {collegeCourses.map((course) => {
                                  const courseChecked = Boolean(draft.courses[course.id]);
                                  const courseDraft = draft.courses[course.id];
                                  const courseBranches = branchesForCourse(
                                    props.branches,
                                    course.id,
                                  );
                                  return (
                                    <div
                                      key={course.id}
                                      className={`rounded-md border px-2.5 py-2 ${
                                        courseChecked
                                          ? "border-emerald-300 bg-emerald-50/40"
                                          : "border-slate-100 bg-slate-50/60"
                                      }`}
                                    >
                                      <label className="flex cursor-pointer items-start gap-2">
                                        <input
                                          type="checkbox"
                                          className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600/30"
                                          checked={courseChecked}
                                          onChange={() => toggleCourse(college.id, course.id)}
                                        />
                                        <span className="min-w-0">
                                          <span className="block text-xs font-semibold text-navy-900">
                                            {course.name}
                                          </span>
                                          <span className="text-[10px] text-slate-500">
                                            {courseBranches.length
                                              ? `${courseBranches.length} branch${courseBranches.length === 1 ? "" : "es"}`
                                              : "No branches"}
                                          </span>
                                        </span>
                                      </label>

                                      {courseChecked && courseDraft ? (
                                        <div className="mt-2 space-y-1.5 border-t border-slate-200/80 pt-2 pl-5">
                                          <label className="flex cursor-pointer items-center gap-2 text-[11px] text-slate-700">
                                            <input
                                              type="radio"
                                              name={`course-branch-mode-${college.id}-${course.id}`}
                                              checked={courseDraft.allBranches}
                                              onChange={() =>
                                                setCourseBranchMode(college.id, course.id, true)
                                              }
                                              className="h-3 w-3 border-slate-300 text-emerald-700 focus:ring-emerald-600/30"
                                            />
                                            All branches in this course
                                          </label>
                                          <label className="flex cursor-pointer items-center gap-2 text-[11px] text-slate-700">
                                            <input
                                              type="radio"
                                              name={`course-branch-mode-${college.id}-${course.id}`}
                                              checked={!courseDraft.allBranches}
                                              onChange={() =>
                                                setCourseBranchMode(college.id, course.id, false)
                                              }
                                              className="h-3 w-3 border-slate-300 text-emerald-700 focus:ring-emerald-600/30"
                                            />
                                            Specific branches
                                          </label>
                                          {!courseDraft.allBranches ? (
                                            courseBranches.length === 0 ? (
                                              <p className="text-[10px] text-amber-800">
                                                No branches under this course.
                                              </p>
                                            ) : (
                                              <div className="max-h-28 space-y-1 overflow-y-auto rounded border border-slate-100 bg-white p-1.5">
                                                {courseBranches.map((branch) => (
                                                  <label
                                                    key={branch.id}
                                                    className="flex cursor-pointer items-center gap-2 text-[11px] text-slate-700"
                                                  >
                                                    <input
                                                      type="checkbox"
                                                      className="h-3 w-3 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600/30"
                                                      checked={courseDraft.branchIds.includes(
                                                        branch.id,
                                                      )}
                                                      onChange={() =>
                                                        toggleBranch(
                                                          college.id,
                                                          course.id,
                                                          branch.id,
                                                        )
                                                      }
                                                    />
                                                    {branch.name}
                                                  </label>
                                                ))}
                                              </div>
                                            )
                                          ) : null}
                                        </div>
                                      ) : null}
                                    </div>
                                  );
                                })}
                              </div>
                            )
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {props.colleges.length === 0 ? (
                  <p className="text-sm text-slate-500">No colleges available in academic masters.</p>
                ) : null}
              </div>
              {selectedCollegeIds.length > 0 ? (
                <p className="text-[11px] text-slate-500">
                  {selectedCollegeIds.length} college
                  {selectedCollegeIds.length === 1 ? "" : "s"} · {scopesPayload.length} access
                  assignment{scopesPayload.length === 1 ? "" : "s"}
                </p>
              ) : (
                <p className="text-xs text-slate-500">
                  Select a college, then courses, then branches.
                </p>
              )}
            </div>
          )}
        </section>
      </div>

      {error ? <p className="mt-4 text-sm text-critical">{error}</p> : null}

      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={reset} disabled={busy}>
          Reset
        </Button>
        <Button type="button" disabled={!canSubmit} onClick={() => void submit()}>
          {busy ? "Creating…" : "Create User"}
        </Button>
      </div>

      {importOpen ? (
        <HrmsImportModal
          onClose={() => setImportOpen(false)}
          onPick={(candidate) => {
            setSelected(candidate);
            setImportOpen(false);
            setError(null);
          }}
        />
      ) : null}
    </div>
  );
}

function HrmsImportModal(props: {
  onClose: () => void;
  onPick: (candidate: HrmsCandidate) => void;
}) {
  const [q, setQ] = useState("");
  const [candidates, setCandidates] = useState<HrmsCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchSeq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setCandidates([]);
      return;
    }
    const seq = ++searchSeq.current;
    const handle = window.setTimeout(async () => {
      setSearching(true);
      setError(null);
      try {
        const response = await apiFetch(`/users/hrms-search?q=${encodeURIComponent(term)}`);
        const body = await response.json().catch(() => ({}));
        if (seq !== searchSeq.current) return;
        if (!response.ok) throw new Error(body?.message || "Search failed");
        setCandidates((body.data ?? []) as HrmsCandidate[]);
      } catch (err) {
        if (seq !== searchSeq.current) return;
        setCandidates([]);
        setError(err instanceof Error ? err.message : "Search failed");
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 350);
    return () => window.clearTimeout(handle);
  }, [q]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div
        className="absolute inset-0"
        onClick={props.onClose}
        onKeyDown={(e) => e.key === "Escape" && props.onClose()}
        role="presentation"
      />
      <div className="relative z-10 flex max-h-[min(80vh,560px)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-navy-900">Import HRMS employee</h3>
            <p className="text-xs text-slate-500">
              Search the HRMS employees directory (not HRMS login/users roles).
            </p>
          </div>
          <button type="button" className="text-sm text-slate-500 hover:text-navy-900" onClick={props.onClose}>
            Close
          </button>
        </div>
        <div className="border-b border-border px-4 py-3">
          <input
            autoFocus
            className={fieldClass}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name, email, or employee id…"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {searching ? <p className="p-4 text-sm text-slate-500">Searching HRMS…</p> : null}
          {!searching && q.trim().length < 2 ? (
            <p className="p-4 text-sm text-slate-500">Type at least 2 characters to search.</p>
          ) : null}
          {!searching && q.trim().length >= 2 && candidates.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">No HRMS employees matched.</p>
          ) : null}
          {error ? <p className="px-4 py-2 text-sm text-critical">{error}</p> : null}
          {candidates.map((c) => (
            <button
              key={c.hrmsUserId}
              type="button"
              onClick={() => props.onPick(c)}
              className="flex w-full items-start justify-between gap-2 border-b border-border px-4 py-3 text-left text-sm last:border-0 hover:bg-slate-50"
            >
              <span className="min-w-0">
                <span className="font-medium text-navy-900">{c.name}</span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  {c.email || "No email"} · Emp {c.employeeId || "—"}
                  {c.department ? ` · ${c.department}` : ""}
                </span>
                {!c.canLink && c.linkBlockReason ? (
                  <span className="mt-1 block text-xs text-amber-800">{c.linkBlockReason}</span>
                ) : null}
              </span>
              {c.alreadyLinked ? (
                <span className="shrink-0 text-xs text-slate-500">Linked</span>
              ) : !c.canLink ? (
                <span className="shrink-0 text-xs font-medium text-amber-800">Blocked</span>
              ) : c.hasHrmsLogin === false ? (
                <span className="shrink-0 text-xs font-medium text-slate-500">Employee</span>
              ) : (
                <span className="shrink-0 text-xs font-medium text-violet-700">Import</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
