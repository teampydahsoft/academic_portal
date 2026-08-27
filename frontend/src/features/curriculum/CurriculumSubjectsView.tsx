"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTable } from "@/components/ui/DataTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { Button } from "@/components/ui/Button";
import { FilterBar, FilterField } from "@/components/ui/FilterBar";
import {
  MobileDataCardHeader,
  MobileDataCardGrid,
  MobileDataCardField,
} from "@/components/ui/MobileDataCard";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";

type CurriculumSubject = {
  mappingId: number;
  regulationId: number;
  regulationCode: string;
  regulationName: string;
  collegeId: number | null;
  collegeName: string;
  courseId: number | null;
  courseName: string;
  branchId: number | null;
  branchName: string;
  batch: string;
  year: number | null;
  semester: number | null;
  sectionMode: string;
  sectionKey: string;
  subjectId: number;
  code: string;
  name: string;
  type: string;
  credits: number;
  status: string;
};

type CurriculumGroup = {
  key: string;
  regulationCode: string;
  regulationName: string;
  collegeName: string;
  courseName: string;
  branchName: string;
  batch: string;
  year: number | null;
  semester: number | null;
  subjects: CurriculumSubject[];
};

type CurriculumResponse = {
  source: string;
  summary: {
    mappingCount: number;
    subjectCount: number;
    regulationCount: number;
    groupCount: number;
  };
  groups: CurriculumGroup[];
  rows: CurriculumSubject[];
};

const selectClassName =
  "h-9 min-w-[140px] rounded-md border border-border bg-white px-2 text-sm text-foreground outline-none focus:border-navy-800";

const searchClassName =
  "h-9 w-full min-w-[200px] rounded-md border border-border bg-white px-3 text-sm text-foreground outline-none focus:border-navy-800";

function buildGroups(rows: CurriculumSubject[]): CurriculumGroup[] {
  const groupMap = new Map<string, CurriculumGroup>();
  for (const row of rows) {
    const key = [
      row.regulationId,
      row.collegeId,
      row.courseId,
      row.branchId,
      row.batch,
      row.year,
      row.semester,
    ].join(":");
    const existing = groupMap.get(key);
    if (existing) {
      existing.subjects.push(row);
    } else {
      groupMap.set(key, {
        key,
        regulationCode: row.regulationCode,
        regulationName: row.regulationName,
        collegeName: row.collegeName,
        courseName: row.courseName,
        branchName: row.branchName,
        batch: row.batch,
        year: row.year,
        semester: row.semester,
        subjects: [row],
      });
    }
  }
  return Array.from(groupMap.values());
}

function summarize(rows: CurriculumSubject[]) {
  return {
    mappingCount: rows.length,
    subjectCount: new Set(rows.map((r) => r.subjectId)).size,
    regulationCount: new Set(rows.map((r) => r.regulationId)).size,
    groupCount: buildGroups(rows).length,
  };
}

export function CurriculumSubjectsView() {
  const [allRows, setAllRows] = useState<CurriculumSubject[]>([]);
  const [source, setSource] = useState("ems.subject_mapping_entries");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [view, setView] = useState<"groups" | "table">("groups");

  const [regulationId, setRegulationId] = useState<string>("all");
  const [collegeId, setCollegeId] = useState<string>("all");
  const [courseId, setCourseId] = useState<string>("all");
  const [branchId, setBranchId] = useState<string>("all");
  const [batch, setBatch] = useState<string>("all");
  const [year, setYear] = useState<string>("all");
  const [semester, setSemester] = useState<string>("all");
  const [subjectType, setSubjectType] = useState<string>("all");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchDraft.trim().toLowerCase()), 250);
    return () => clearTimeout(timer);
  }, [searchDraft]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        // Load full EMS curriculum once; page filters operate on this content.
        const response = await apiFetch(`/catalog/curriculum`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`Failed to load curriculum (${response.status})`);
        const payload = (await response.json()) as CurriculumResponse;
        if (cancelled) return;
        setAllRows(payload.rows ?? []);
        setSource(payload.source ?? "ems.subject_mapping_entries");
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load curriculum");
          setAllRows([]);
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

  // Cascading options derived from curriculum rows (not global Student DB masters)
  const regulationOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const row of allRows) {
      if (!map.has(row.regulationId)) {
        map.set(row.regulationId, row.regulationCode || String(row.regulationId));
      }
    }
    return [...map.entries()]
      .map(([id, code]) => ({ id: String(id), label: code }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [allRows]);

  const scopedForCollege = useMemo(() => {
    return allRows.filter((row) => {
      if (regulationId !== "all" && String(row.regulationId) !== regulationId) return false;
      return true;
    });
  }, [allRows, regulationId]);

  const collegeOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of scopedForCollege) {
      const key = row.collegeId != null ? String(row.collegeId) : `name:${row.collegeName}`;
      if (!map.has(key)) map.set(key, row.collegeName);
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, label: name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [scopedForCollege]);

  const scopedForCourse = useMemo(() => {
    return scopedForCollege.filter((row) => {
      if (collegeId === "all") return true;
      const key = row.collegeId != null ? String(row.collegeId) : `name:${row.collegeName}`;
      return key === collegeId;
    });
  }, [scopedForCollege, collegeId]);

  const courseOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of scopedForCourse) {
      const key = row.courseId != null ? String(row.courseId) : `name:${row.courseName}`;
      if (!map.has(key)) map.set(key, row.courseName);
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, label: name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [scopedForCourse]);

  const scopedForBranch = useMemo(() => {
    return scopedForCourse.filter((row) => {
      if (courseId === "all") return true;
      const key = row.courseId != null ? String(row.courseId) : `name:${row.courseName}`;
      return key === courseId;
    });
  }, [scopedForCourse, courseId]);

  const branchOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of scopedForBranch) {
      const key = row.branchId != null ? String(row.branchId) : `name:${row.branchName}`;
      if (!map.has(key)) map.set(key, row.branchName);
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, label: name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [scopedForBranch]);

  const scopedForBatch = useMemo(() => {
    return scopedForBranch.filter((row) => {
      if (branchId === "all") return true;
      const key = row.branchId != null ? String(row.branchId) : `name:${row.branchName}`;
      return key === branchId;
    });
  }, [scopedForBranch, branchId]);

  const batchOptions = useMemo(() => {
    return [...new Set(scopedForBatch.map((r) => r.batch).filter(Boolean))].sort();
  }, [scopedForBatch]);

  const scopedForYear = useMemo(() => {
    return scopedForBatch.filter((row) => (batch === "all" ? true : row.batch === batch));
  }, [scopedForBatch, batch]);

  const yearOptions = useMemo(() => {
    return [...new Set(scopedForYear.map((r) => r.year).filter((y): y is number => y != null))]
      .sort((a, b) => a - b)
      .map(String);
  }, [scopedForYear]);

  const scopedForSemester = useMemo(() => {
    return scopedForYear.filter((row) =>
      year === "all" ? true : String(row.year) === year,
    );
  }, [scopedForYear, year]);

  const semesterOptions = useMemo(() => {
    return [
      ...new Set(
        scopedForSemester.map((r) => r.semester).filter((s): s is number => s != null),
      ),
    ]
      .sort((a, b) => a - b)
      .map(String);
  }, [scopedForSemester]);

  const typeOptions = useMemo(() => {
    return [...new Set(allRows.map((r) => r.type).filter(Boolean))].sort();
  }, [allRows]);

  // Keep selections valid as cascade changes
  useEffect(() => {
    if (collegeId !== "all" && !collegeOptions.some((o) => o.id === collegeId)) {
      setCollegeId("all");
    }
  }, [collegeId, collegeOptions]);

  useEffect(() => {
    if (courseId !== "all" && !courseOptions.some((o) => o.id === courseId)) {
      setCourseId("all");
    }
  }, [courseId, courseOptions]);

  useEffect(() => {
    if (branchId !== "all" && !branchOptions.some((o) => o.id === branchId)) {
      setBranchId("all");
    }
  }, [branchId, branchOptions]);

  useEffect(() => {
    if (batch !== "all" && !batchOptions.includes(batch)) setBatch("all");
  }, [batch, batchOptions]);

  useEffect(() => {
    if (year !== "all" && !yearOptions.includes(year)) setYear("all");
  }, [year, yearOptions]);

  useEffect(() => {
    if (semester !== "all" && !semesterOptions.includes(semester)) setSemester("all");
  }, [semester, semesterOptions]);

  const filteredRows = useMemo(() => {
    return allRows.filter((row) => {
      if (regulationId !== "all" && String(row.regulationId) !== regulationId) return false;

      if (collegeId !== "all") {
        const key = row.collegeId != null ? String(row.collegeId) : `name:${row.collegeName}`;
        if (key !== collegeId) return false;
      }
      if (courseId !== "all") {
        const key = row.courseId != null ? String(row.courseId) : `name:${row.courseName}`;
        if (key !== courseId) return false;
      }
      if (branchId !== "all") {
        const key = row.branchId != null ? String(row.branchId) : `name:${row.branchName}`;
        if (key !== branchId) return false;
      }
      if (batch !== "all" && row.batch !== batch) return false;
      if (year !== "all" && String(row.year) !== year) return false;
      if (semester !== "all" && String(row.semester) !== semester) return false;
      if (subjectType !== "all" && row.type !== subjectType) return false;

      if (search) {
        const hay = [
          row.code,
          row.name,
          row.regulationCode,
          row.collegeName,
          row.courseName,
          row.branchName,
          row.batch,
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });
  }, [
    allRows,
    regulationId,
    collegeId,
    courseId,
    branchId,
    batch,
    year,
    semester,
    subjectType,
    search,
  ]);

  const groups = useMemo(() => buildGroups(filteredRows), [filteredRows]);
  const summary = useMemo(() => summarize(filteredRows), [filteredRows]);

  useEffect(() => {
    setExpanded(groups[0]?.key ?? null);
  }, [groups]);

  function resetFilters() {
    setRegulationId("all");
    setCollegeId("all");
    setCourseId("all");
    setBranchId("all");
    setBatch("all");
    setYear("all");
    setSemester("all");
    setSubjectType("all");
    setSearchDraft("");
    setSearch("");
  }

  const hasActiveFilters =
    regulationId !== "all" ||
    collegeId !== "all" ||
    courseId !== "all" ||
    branchId !== "all" ||
    batch !== "all" ||
    year !== "all" ||
    semester !== "all" ||
    subjectType !== "all" ||
    search !== "";

  return (
    <div>
      <PageHeader
        title="Curriculum & Subjects"
        description={`EMS curriculum map from ${source}. Filters below use values present in this curriculum data.`}
        actions={
          <div className="flex gap-2">
            <button
              type="button"
              className={cn(
                "h-9 rounded-md border px-3 text-sm",
                view === "groups"
                  ? "border-navy-900 bg-navy-900 text-white"
                  : "border-border bg-card text-slate-700",
              )}
              onClick={() => setView("groups")}
            >
              Grouped view
            </button>
            <button
              type="button"
              className={cn(
                "h-9 rounded-md border px-3 text-sm",
                view === "table"
                  ? "border-navy-900 bg-navy-900 text-white"
                  : "border-border bg-card text-slate-700",
              )}
              onClick={() => setView("table")}
            >
              Flat table
            </button>
          </div>
        }
      />

      <div className="mb-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Curriculum filters
          </p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!hasActiveFilters}
            onClick={resetFilters}
          >
            Reset
          </Button>
        </div>
        <FilterBar className="mb-0">
          <FilterField label="Search">
            <input
              type="search"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="Subject code, name, branch…"
              className={searchClassName}
              aria-label="Search curriculum"
            />
          </FilterField>
          <FilterField label="Regulation">
            <select
              className={selectClassName}
              value={regulationId}
              disabled={loading}
              onChange={(e) => {
                setRegulationId(e.target.value);
                setCollegeId("all");
                setCourseId("all");
                setBranchId("all");
                setBatch("all");
                setYear("all");
                setSemester("all");
              }}
            >
              <option value="all">All Regulations</option>
              {regulationOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="College">
            <select
              className={selectClassName}
              value={collegeId}
              disabled={loading}
              onChange={(e) => {
                setCollegeId(e.target.value);
                setCourseId("all");
                setBranchId("all");
                setBatch("all");
                setYear("all");
                setSemester("all");
              }}
            >
              <option value="all">All Colleges</option>
              {collegeOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Course">
            <select
              className={selectClassName}
              value={courseId}
              disabled={loading}
              onChange={(e) => {
                setCourseId(e.target.value);
                setBranchId("all");
                setBatch("all");
                setYear("all");
                setSemester("all");
              }}
            >
              <option value="all">All Courses</option>
              {courseOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Branch">
            <select
              className={selectClassName}
              value={branchId}
              disabled={loading}
              onChange={(e) => {
                setBranchId(e.target.value);
                setBatch("all");
                setYear("all");
                setSemester("all");
              }}
            >
              <option value="all">All Branches</option>
              {branchOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Batch">
            <select
              className={selectClassName}
              value={batch}
              disabled={loading}
              onChange={(e) => {
                setBatch(e.target.value);
                setYear("all");
                setSemester("all");
              }}
            >
              <option value="all">All Batches</option>
              {batchOptions.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Year">
            <select
              className={selectClassName}
              value={year}
              disabled={loading}
              onChange={(e) => {
                setYear(e.target.value);
                setSemester("all");
              }}
            >
              <option value="all">All Years</option>
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  Year {y}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Semester">
            <select
              className={selectClassName}
              value={semester}
              disabled={loading}
              onChange={(e) => setSemester(e.target.value)}
            >
              <option value="all">All Semesters</option>
              {semesterOptions.map((s) => (
                <option key={s} value={s}>
                  Sem {s}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Subject type">
            <select
              className={selectClassName}
              value={subjectType}
              disabled={loading}
              onChange={(e) => setSubjectType(e.target.value)}
            >
              <option value="all">All Types</option>
              {typeOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </FilterField>
        </FilterBar>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Mapped subjects" value={summary.subjectCount} />
        <StatCard label="Mapping rows" value={summary.mappingCount} />
        <StatCard label="Curriculum groups" value={summary.groupCount} />
        <StatCard label="Regulations" value={summary.regulationCount} />
      </div>

      {loading ? <p className="text-sm text-slate-500">Loading EMS curriculum…</p> : null}
      {error ? (
        <div className="rounded-md border border-critical/30 bg-red-50 p-3 text-sm text-critical">
          {error}
        </div>
      ) : null}

      {!loading && !error && filteredRows.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-600">
            No curriculum mappings match these filters.
            {allRows.length > 0
              ? " Try clearing filters to see all mapped curriculum."
              : " No subject mappings were returned from EMS."}
          </p>
        </Card>
      ) : null}

      {!loading && view === "groups" && groups.length > 0 ? (
        <div className="space-y-3">
          {groups.map((group) => {
            const open = expanded === group.key;
            return (
              <div
                key={group.key}
                className="overflow-hidden rounded-xl border border-border bg-card"
              >
                <button
                  type="button"
                  className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50"
                  onClick={() => setExpanded(open ? null : group.key)}
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-navy-900">
                      {group.courseName} · {group.branchName} · Batch {group.batch}
                    </p>
                    <p className="mt-0.5 text-sm text-slate-500">
                      {group.collegeName}
                      {" · "}
                      {group.regulationCode}
                      {group.year != null ? ` · Year ${group.year}` : ""}
                      {group.semester != null ? ` · Sem ${group.semester}` : ""}
                      {" · "}
                      {group.subjects.length} subject
                      {group.subjects.length === 1 ? "" : "s"}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">{group.regulationName}</p>
                  </div>
                  <span className="shrink-0 text-sm text-slate-500">{open ? "Hide" : "Show"}</span>
                </button>

                {open ? (
                  <div className="border-t border-border px-2 pb-3 pt-1">
                    <DataTable
                      rows={group.subjects}
                      rowKey={(row) => String(row.mappingId)}
                      mobileRender={(row) => (
                        <div className="flex flex-col gap-1">
                          <MobileDataCardHeader title={row.name} secondary={row.code} status={<StatusBadge status={row.status} />} />
                          <MobileDataCardGrid>
                            <MobileDataCardField label="Type" value={<span className="capitalize text-slate-700">{row.type}</span>} />
                            <MobileDataCardField label="Credits" value={row.credits} />
                          </MobileDataCardGrid>
                        </div>
                      )}
                      columns={[
                        { key: "code", header: "Code", render: (row) => row.code },
                        { key: "name", header: "Subject", render: (row) => row.name },
                        {
                          key: "type",
                          header: "Type",
                          render: (row) => (
                            <span className="capitalize text-slate-700">{row.type}</span>
                          ),
                        },
                        {
                          key: "credits",
                          header: "Credits",
                          render: (row) => row.credits,
                        },
                        {
                          key: "status",
                          header: "Status",
                          render: (row) => <StatusBadge status={row.status} />,
                        },
                      ]}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {!loading && view === "table" && filteredRows.length > 0 ? (
        <DataTable
          rows={filteredRows}
          rowKey={(row) => String(row.mappingId)}
          mobileRender={(row) => (
            <div className="flex flex-col gap-1">
              <MobileDataCardHeader title={row.name} secondary={row.code} status={<StatusBadge status={row.status} />} />
              <MobileDataCardGrid>
                <MobileDataCardField label="College/Course" value={`${row.collegeName} · ${row.courseName}`} />
                <MobileDataCardField label="Branch/Batch" value={`${row.branchName} · ${row.batch}`} />
                <MobileDataCardField label="Year/Sem" value={`Y${row.year ?? "—"} S${row.semester ?? "—"}`} />
                <MobileDataCardField label="Type/Credits" value={<span className="capitalize">{row.type} ({row.credits}cr)</span>} />
              </MobileDataCardGrid>
            </div>
          )}
          columns={[
            {
              key: "regulation",
              header: "Regulation",
              render: (row) => row.regulationCode,
            },
            { key: "college", header: "College", render: (row) => row.collegeName },
            { key: "course", header: "Course", render: (row) => row.courseName },
            { key: "branch", header: "Branch", render: (row) => row.branchName },
            { key: "batch", header: "Batch", render: (row) => row.batch },
            {
              key: "year",
              header: "Year",
              render: (row) => row.year ?? "—",
            },
            {
              key: "semester",
              header: "Sem",
              render: (row) => row.semester ?? "—",
            },
            { key: "code", header: "Code", render: (row) => row.code },
            { key: "name", header: "Subject", render: (row) => row.name },
            {
              key: "type",
              header: "Type",
              render: (row) => <span className="capitalize">{row.type}</span>,
            },
            { key: "credits", header: "Credits", render: (row) => row.credits },
            {
              key: "status",
              header: "Status",
              render: (row) => <StatusBadge status={row.status} />,
            },
          ]}
        />
      ) : null}
    </div>
  );
}
