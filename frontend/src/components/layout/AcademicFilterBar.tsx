"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { FilterBar, FilterField } from "@/components/ui/FilterBar";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAcademicContext } from "@/components/layout/AcademicProvider";
import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api";

const selectClassName =
  "h-11 sm:h-9 w-full sm:w-auto sm:min-w-[140px] rounded-md border border-border bg-white px-2 text-sm text-foreground outline-none focus:border-navy-800";

const searchClassName =
  "h-11 sm:h-9 w-full sm:min-w-[220px] rounded-md border border-border bg-white px-3 text-sm text-foreground outline-none focus:border-navy-800";

const HIDDEN_ON = [
  "/",
  "/settings",
  "/faculty-departments",
  "/curriculum-subjects",
  "/academic-calendar",
  "/attendance-calendar",
  "/user-management",
];

type Props = {
  title?: string;
};

export function AcademicFilterBar({ title = "Filters" }: Props) {
  const pathname = usePathname();
  const { masters, loading, filters, setFilters, resetFilters, studentsListStats } =
    useAcademicContext();
  const { authorization } = useAuth();
  const [searchDraft, setSearchDraft] = useState(filters.q);
  const [studentStatuses, setStudentStatuses] = useState<string[]>([]);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const isDashboard = pathname === "/dashboard" || pathname.startsWith("/dashboard/");
  const hiddenOnPath = HIDDEN_ON.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
  
  // Hide filters on dashboard unconditionally
  const hidden = hiddenOnPath || isDashboard;
  const showSearch =
    pathname === "/students" || pathname.startsWith("/students/");
  const isTimetablesPage =
    pathname === "/timetables" || pathname.startsWith("/timetables/");

  useEffect(() => {
    setSearchDraft(filters.q);
  }, [filters.q]);

  useEffect(() => {
    if (!showSearch) return;
    let cancelled = false;
    async function loadStatuses() {
      try {
        const response = await apiFetch(`/students/statuses`, {
          cache: "no-store",
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || cancelled) return;
        const statuses = (body as { data?: string[] }).data ?? [];
        setStudentStatuses(statuses);
      } catch {
        if (!cancelled) setStudentStatuses([]);
      }
    }
    void loadStatuses();
    return () => {
      cancelled = true;
    };
  }, [showSearch]);

  // Students page: auto-select Regular when landing with All / empty status.
  useEffect(() => {
    if (!showSearch) return;
    if (filters.studentStatus !== "all" && Boolean(filters.studentStatus)) return;
    setFilters({ studentStatus: "Regular" });
    // Intentionally only when entering Students (showSearch flips true).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSearch]);

  useEffect(() => {
    if (!showSearch) return;
    const timer = window.setTimeout(() => {
      const next = searchDraft.trim();
      if (next !== filters.q) setFilters({ q: next });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchDraft, showSearch, filters.q, setFilters]);

  // Students list scoped by batch does not use Year / Semester filters.
  useEffect(() => {
    if (!showSearch || filters.batch === "all") return;
    if (filters.year === "all" && filters.semester === "all") return;
    setFilters({ year: "all", semester: "all" });
  }, [showSearch, filters.batch, filters.year, filters.semester, setFilters]);

  // Timetables: prefill Year + Semester from Regular students in the selected batch.
  useEffect(() => {
    if (!isTimetablesPage) return;
    if (
      filters.collegeId === "all" ||
      filters.courseId === "all" ||
      filters.branchId === "all" ||
      filters.batch === "all"
    ) {
      return;
    }

    const collegeId = Number(filters.collegeId);
    const courseId = Number(filters.courseId);
    const branchId = Number(filters.branchId);
    const batch = String(filters.batch);
    let cancelled = false;

    async function prefillYearSemester() {
      try {
        const params = new URLSearchParams({
          collegeId: String(collegeId),
          courseId: String(courseId),
          branchId: String(branchId),
          batch,
        });
        const response = await apiFetch(`/catalog/batch-progress?${params}`,
          { cache: "no-store" },
        );
        const body = await response.json().catch(() => ({}));
        if (!response.ok || cancelled) return;
        const data = (body as {
          data?: { year: number | null; semester: number | null };
        }).data;
        if (data?.year == null || data?.semester == null) return;
        setFilters({ year: data.year, semester: data.semester });
      } catch {
        // keep manual filters if lookup fails
      }
    }

    void prefillYearSemester();
    return () => {
      cancelled = true;
    };
  }, [
    isTimetablesPage,
    filters.collegeId,
    filters.courseId,
    filters.branchId,
    filters.batch,
    setFilters,
  ]);

  const coursesForCollege = useMemo(() => {
    if (!masters) return [];
    if (filters.collegeId === "all") return masters.courses;
    return masters.courses.filter((course) => course.collegeId === filters.collegeId);
  }, [masters, filters.collegeId]);

  const branchesForCourse = useMemo(() => {
    if (!masters) return [];
    if (filters.courseId === "all") {
      const allowed = new Set(coursesForCollege.map((c) => c.id));
      return masters.branches.filter((branch) => allowed.has(branch.courseId));
    }
    return masters.branches.filter((branch) => branch.courseId === filters.courseId);
  }, [masters, filters.courseId, coursesForCollege]);

  const selectedBranch =
    filters.branchId === "all"
      ? null
      : branchesForCourse.find((branch) => branch.id === filters.branchId) ?? null;

  const selectedCourse =
    filters.courseId === "all"
      ? null
      : coursesForCollege.find((course) => course.id === filters.courseId) ?? null;

  const batchesForBranch = useMemo(() => {
    if (!masters || !selectedBranch) return [];
    const values = new Set<string>();
    for (const row of masters.batches ?? []) {
      if (row.branchId === selectedBranch.id) values.add(row.batch);
    }
    return Array.from(values).sort((a, b) => b.localeCompare(a));
  }, [masters, selectedBranch]);

  const yearOptionsForCourse = useMemo(() => {
    if (selectedCourse?.yearOptions?.length) return selectedCourse.yearOptions;
    if (selectedCourse?.totalYears) {
      return Array.from({ length: selectedCourse.totalYears }, (_, i) => i + 1);
    }
    return masters?.yearOptions ?? [1, 2, 3, 4];
  }, [selectedCourse, masters?.yearOptions]);

  const semesterOptionsForCourse = useMemo(() => {
    if (
      selectedCourse?.yearSemesterConfig?.length &&
      filters.year !== "all"
    ) {
      const match = selectedCourse.yearSemesterConfig.find(
        (item) => item.year === filters.year,
      );
      if (match) {
        return Array.from({ length: match.semesters }, (_, i) => i + 1);
      }
    }
    const perYear = selectedCourse?.semestersPerYear ?? 2;
    return Array.from({ length: perYear }, (_, i) => i + 1);
  }, [selectedCourse, filters.year]);

  const sectionsForBranch = useMemo(() => {
    if (!masters || !selectedBranch) return [];
    const names = new Set<string>();
    for (const section of masters.sections) {
      if (section.branchId === selectedBranch.id) names.add(section.name);
    }
    return Array.from(names).sort();
  }, [masters, selectedBranch]);

  const showSectionFilter = Boolean(
    selectedBranch?.hasSections && sectionsForBranch.length > 0,
  );

  // On Students, batch already scopes the cohort — Year / Semester are redundant.
  const showYearSemesterFilters = !(
    showSearch && filters.batch !== "all"
  );

  if (hidden) return null;

  const stats = showSearch ? studentsListStats : null;

  return (
    <div className={showSearch ? "mb-2" : "mb-4"}>
      {stats ? (
        <div className="mb-2 grid w-full grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          <StatChip
            label="Total students"
            value={
              stats.loading && stats.total === 0
                ? "…"
                : stats.total.toLocaleString("en-IN")
            }
            hint={
              stats.loaded < stats.total
                ? `Showing ${stats.loaded.toLocaleString("en-IN")} of ${stats.total.toLocaleString("en-IN")}`
                : "In current filters"
            }
          />
          <StatChip
            label="Avg attendance"
            value={
              stats.loading && stats.avgAttendance == null
                ? "…"
                : stats.avgAttendance == null
                  ? "—"
                  : `${stats.avgAttendance}%`
            }
            hint="In current filters"
            tone="info"
          />
          <StatChip
            label="Below 75%"
            value={
              stats.loading && stats.total === 0
                ? "…"
                : stats.below75.toLocaleString("en-IN")
            }
            hint="Attendance under 75%"
            tone="warning"
          />
          <StatChip
            label="High risk"
            value={
              stats.loading && stats.total === 0
                ? "…"
                : stats.highRisk.toLocaleString("en-IN")
            }
            hint="Attendance under 65%"
            tone="critical"
          />
          <StatChip
            label="Medium risk"
            value={
              stats.loading && stats.total === 0
                ? "…"
                : stats.mediumRisk.toLocaleString("en-IN")
            }
            hint="Attendance 65–74%"
            tone="warning"
          />
          <StatChip
            label="Low risk"
            value={
              stats.loading && stats.total === 0
                ? "…"
                : stats.lowRisk.toLocaleString("en-IN")
            }
            hint="Attendance 75% and above"
            tone="success"
          />
        </div>
      ) : null}

      {!showSearch ? (
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {title}
          </p>
          <Button type="button" size="sm" variant="ghost" onClick={resetFilters}>
            Reset
          </Button>
        </div>
      ) : (
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {title}
        </p>
      )}

      {showSearch ? (
        <div className="mb-0 flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3 w-full">
            {/* Search Input & Mobile Filter Toggle row */}
            <div className="flex items-end gap-2 w-full sm:w-auto flex-1">
              <div className="flex-1 min-w-0">
                <FilterField label="Search">
                  <input
                    type="search"
                    value={searchDraft}
                    onChange={(e) => setSearchDraft(e.target.value)}
                    placeholder="Admission no, name, section"
                    className={searchClassName}
                    aria-label="Search students"
                  />
                </FilterField>
              </div>
              <Button
                type="button"
                variant="secondary"
                className="h-11 sm:hidden px-3"
                onClick={() => setMobileFiltersOpen(!mobileFiltersOpen)}
              >
                {mobileFiltersOpen ? "Hide Filters" : "Filters"}
              </Button>
            </div>

            {/* Rest of the filters - Grid on mobile, flex on desktop */}
            <div className={`w-full sm:w-auto flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3 ${mobileFiltersOpen ? "flex" : "hidden sm:flex"}`}>
              <div className="grid grid-cols-2 gap-3 w-full sm:flex sm:w-auto sm:flex-wrap sm:items-end">
                <FilterField label="Academic Year">
              <select
                className={selectClassName}
                value={filters.academicYear}
                disabled={loading || !masters}
                onChange={(e) => setFilters({ academicYear: e.target.value })}
              >
                {(masters?.academicYears ?? []).map((year) => (
                  <option key={year.id} value={year.label}>
                    {year.label}
                  </option>
                ))}
              </select>
            </FilterField>

            <FilterField label="College">
              <select
                className={selectClassName}
                value={filters.collegeId === "all" ? "all" : String(filters.collegeId)}
                disabled={loading || !masters}
                onChange={(e) =>
                  setFilters({
                    collegeId: e.target.value === "all" ? "all" : Number(e.target.value),
                  })
                }
              >
                <option value="all">All Colleges</option>
                {(masters?.colleges ?? []).map((college) => (
                  <option key={college.id} value={college.id}>
                    {college.name}
                  </option>
                ))}
              </select>
            </FilterField>

            <FilterField label="Course">
              <select
                className={selectClassName}
                value={filters.courseId === "all" ? "all" : String(filters.courseId)}
                disabled={loading || !masters}
                onChange={(e) =>
                  setFilters({
                    courseId: e.target.value === "all" ? "all" : Number(e.target.value),
                    year: "all",
                    semester: "all",
                  })
                }
              >
                <option value="all">All Courses</option>
                {coursesForCollege.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.name}
                  </option>
                ))}
              </select>
            </FilterField>

            <FilterField label="Branch">
              <select
                className={selectClassName}
                value={filters.branchId === "all" ? "all" : String(filters.branchId)}
                disabled={loading || !masters}
                onChange={(e) =>
                  setFilters({
                    branchId: e.target.value === "all" ? "all" : Number(e.target.value),
                  })
                }
              >
                <option value="all">All Branches</option>
                {branchesForCourse.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.hasSections
                      ? `${branch.name} (${branch.sectionCount} section${
                          branch.sectionCount === 1 ? "" : "s"
                        })`
                      : `${branch.name} (no section)`}
                  </option>
                ))}
              </select>
            </FilterField>

            <FilterField label="Batch">
              <select
                className={selectClassName}
                value={filters.batch === "all" ? "all" : filters.batch}
                disabled={loading || !masters || !selectedBranch}
                onChange={(e) => {
                  const nextBatch = e.target.value === "all" ? "all" : e.target.value;
                  setFilters({
                    batch: nextBatch,
                    ...(showSearch && nextBatch !== "all"
                      ? { year: "all" as const, semester: "all" as const }
                      : {}),
                  });
                }}
              >
                <option value="all">All Batches</option>
                {batchesForBranch.map((batch) => (
                  <option key={batch} value={batch}>
                    {batch}
                  </option>
                ))}
              </select>
            </FilterField>

            {showYearSemesterFilters ? (
              <>
                <FilterField label="Year">
                  <select
                    className={selectClassName}
                    value={filters.year === "all" ? "all" : String(filters.year)}
                    disabled={loading || !masters}
                    onChange={(e) =>
                      setFilters({
                        year: e.target.value === "all" ? "all" : Number(e.target.value),
                        semester: "all",
                      })
                    }
                  >
                    <option value="all">All Years</option>
                    {yearOptionsForCourse.map((year) => (
                      <option key={year} value={year}>
                        Year {year}
                      </option>
                    ))}
                  </select>
                </FilterField>

                <FilterField label="Semester">
                  <select
                    className={selectClassName}
                    value={filters.semester === "all" ? "all" : String(filters.semester)}
                    disabled={loading || !masters}
                    onChange={(e) =>
                      setFilters({
                        semester: e.target.value === "all" ? "all" : Number(e.target.value),
                      })
                    }
                  >
                    <option value="all">All Semesters</option>
                    {semesterOptionsForCourse.map((semester) => (
                      <option key={semester} value={semester}>
                        Semester {semester}
                      </option>
                    ))}
                  </select>
                </FilterField>
              </>
            ) : null}

            {showSectionFilter ? (
              <FilterField label="Section">
                <select
                  className={selectClassName}
                  value={filters.section}
                  disabled={loading || !masters}
                  onChange={(e) =>
                    setFilters({
                      section: e.target.value === "all" ? "all" : e.target.value,
                    })
                  }
                >
                  <option value="all">All Sections</option>
                  {sectionsForBranch.map((section) => (
                    <option key={section} value={section}>
                      {section}
                    </option>
                  ))}
                </select>
              </FilterField>
            ) : null}

                <FilterField label="Student Status">
                  <select
                    className={selectClassName}
                    value={filters.studentStatus === "all" ? "all" : filters.studentStatus}
                    onChange={(e) =>
                      setFilters({
                        studentStatus: e.target.value === "all" ? "all" : e.target.value,
                      })
                    }
                  >
                    <option value="all">All Statuses</option>
                    {studentStatuses.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </FilterField>
              </div>
              
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={resetFilters}
                className="mb-0 h-11 sm:h-9 shrink-0 px-4 w-full sm:w-auto mt-2 sm:mt-0"
              >
                Reset
              </Button>
            </div>
          </div>
        </div>
      ) : (
      <FilterBar className="mb-0 items-end">
        <FilterField label="Academic Year">
          <select
            className={selectClassName}
            value={filters.academicYear}
            disabled={loading || !masters}
            onChange={(e) => setFilters({ academicYear: e.target.value })}
          >
            {(masters?.academicYears ?? []).map((year) => (
              <option key={year.id} value={year.label}>
                {year.label}
              </option>
            ))}
          </select>
        </FilterField>

        <FilterField label="College">
          <select
            className={selectClassName}
            value={filters.collegeId === "all" ? "all" : String(filters.collegeId)}
            disabled={loading || !masters}
            onChange={(e) =>
              setFilters({
                collegeId: e.target.value === "all" ? "all" : Number(e.target.value),
              })
            }
          >
            <option value="all">All Colleges</option>
            {(masters?.colleges ?? []).map((college) => (
              <option key={college.id} value={college.id}>
                {college.name}
              </option>
            ))}
          </select>
        </FilterField>

        <FilterField label="Course">
          <select
            className={selectClassName}
            value={filters.courseId === "all" ? "all" : String(filters.courseId)}
            disabled={loading || !masters}
            onChange={(e) =>
              setFilters({
                courseId: e.target.value === "all" ? "all" : Number(e.target.value),
                year: "all",
                semester: "all",
              })
            }
          >
            <option value="all">All Courses</option>
            {coursesForCollege.map((course) => (
              <option key={course.id} value={course.id}>
                {course.name}
              </option>
            ))}
          </select>
        </FilterField>

        <FilterField label="Branch">
          <select
            className={selectClassName}
            value={filters.branchId === "all" ? "all" : String(filters.branchId)}
            disabled={loading || !masters}
            onChange={(e) =>
              setFilters({
                branchId: e.target.value === "all" ? "all" : Number(e.target.value),
              })
            }
          >
            <option value="all">All Branches</option>
            {branchesForCourse.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.hasSections
                  ? `${branch.name} (${branch.sectionCount} section${
                      branch.sectionCount === 1 ? "" : "s"
                    })`
                  : `${branch.name} (no section)`}
              </option>
            ))}
          </select>
        </FilterField>

        <FilterField label="Batch">
          <select
            className={selectClassName}
            value={filters.batch === "all" ? "all" : filters.batch}
            disabled={loading || !masters || !selectedBranch}
            onChange={(e) => {
              const nextBatch = e.target.value === "all" ? "all" : e.target.value;
              setFilters({
                batch: nextBatch,
              });
            }}
          >
            <option value="all">All Batches</option>
            {batchesForBranch.map((batch) => (
              <option key={batch} value={batch}>
                {batch}
              </option>
            ))}
          </select>
        </FilterField>

        {showYearSemesterFilters ? (
          <>
            <FilterField label="Year">
              <select
                className={selectClassName}
                value={filters.year === "all" ? "all" : String(filters.year)}
                disabled={loading || !masters}
                onChange={(e) =>
                  setFilters({
                    year: e.target.value === "all" ? "all" : Number(e.target.value),
                    semester: "all",
                  })
                }
              >
                <option value="all">All Years</option>
                {yearOptionsForCourse.map((year) => (
                  <option key={year} value={year}>
                    Year {year}
                  </option>
                ))}
              </select>
            </FilterField>

            <FilterField label="Semester">
              <select
                className={selectClassName}
                value={filters.semester === "all" ? "all" : String(filters.semester)}
                disabled={loading || !masters}
                onChange={(e) =>
                  setFilters({
                    semester: e.target.value === "all" ? "all" : Number(e.target.value),
                  })
                }
              >
                <option value="all">All Semesters</option>
                {semesterOptionsForCourse.map((semester) => (
                  <option key={semester} value={semester}>
                    Semester {semester}
                  </option>
                ))}
              </select>
            </FilterField>
          </>
        ) : null}

        {showSectionFilter ? (
          <FilterField label="Section">
            <select
              className={selectClassName}
              value={filters.section}
              disabled={loading || !masters}
              onChange={(e) =>
                setFilters({
                  section: e.target.value === "all" ? "all" : e.target.value,
                })
              }
            >
              <option value="all">All Sections</option>
              {sectionsForBranch.map((section) => (
                <option key={section} value={section}>
                  {section}
                </option>
              ))}
            </select>
          </FilterField>
        ) : null}
      </FilterBar>
      )}

      {selectedBranch && !showSectionFilter ? (
        <p className="mt-1 text-xs text-slate-500">
          Selected branch has no sections — filters apply at branch level.
        </p>
      ) : null}
      {selectedCourse?.totalYears && !showSearch ? (
        <p className="mt-1 text-xs text-slate-400">
          {selectedCourse.name}: {selectedCourse.totalYears} year
          {selectedCourse.totalYears === 1 ? "" : "s"}
          {selectedCourse.semestersPerYear
            ? ` · ${selectedCourse.semestersPerYear} semester${
                selectedCourse.semestersPerYear === 1 ? "" : "s"
              }/year`
            : ""}
        </p>
      ) : null}
    </div>
  );
}

function StatChip({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "info" | "success" | "warning" | "critical";
}) {
  const toneClass =
    tone === "info"
      ? "border-sky-200 bg-sky-50/60"
      : tone === "success"
        ? "border-green-200 bg-green-50/60"
        : tone === "warning"
          ? "border-amber-200 bg-amber-50/60"
          : tone === "critical"
            ? "border-red-200 bg-red-50/60"
            : "border-border bg-card";

  return (
    <div className={`w-full rounded-lg border px-3 py-2 shadow-sm ${toneClass}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums leading-tight text-navy-900">
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-[10px] leading-tight text-slate-500">{hint}</p> : null}
    </div>
  );
}
