"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/components/auth/AuthProvider";
import { scopeAllowsBranch, scopeAllowsCollege } from "@/lib/teaching-scope";

export type AcademicMasters = {
  academicYears: { id: number; label: string; isActive: boolean }[];
  colleges: { id: number; name: string; code: string | null }[];
  courses: {
    id: number;
    name: string;
    code: string | null;
    collegeId: number;
    totalYears?: number;
    semestersPerYear?: number;
    yearSemesterConfig?: Array<{ year: number; semesters: number }>;
    yearOptions?: number[];
  }[];
  branches: {
    id: number;
    name: string;
    code: string | null;
    courseId: number;
    hasSections: boolean;
    sectionCount: number;
  }[];
  sections: {
    branchId: number;
    name: string;
    batch: string;
    studentCount: number;
    strength?: number | null;
  }[];
  batches: { branchId: number; batch: string }[];
  yearOptions: number[];
  semesterOptions: number[];
  defaults: {
    academicYear: string;
    collegeId: number | null;
    collegeName: string;
  };
};

export type AcademicFilters = {
  academicYear: string;
  collegeId: number | "all";
  courseId: number | "all";
  branchId: number | "all";
  batch: string | "all";
  year: number | "all";
  semester: number | "all";
  section: string | "all";
  studentStatus: string | "all";
  q: string;
};

export type StudentsListStats = {
  total: number;
  loaded: number;
  loading: boolean;
  loadingMore: boolean;
  avgAttendance: number | null;
  below75: number;
  highRisk: number;
  mediumRisk: number;
  lowRisk: number;
};

const STORAGE_KEY = "academic-portal-filters-v4";

const defaultFilters: AcademicFilters = {
  academicYear: "",
  collegeId: "all",
  courseId: "all",
  branchId: "all",
  batch: "all",
  year: "all",
  semester: "all",
  section: "all",
  studentStatus: "Regular",
  q: "",
};

type AcademicContextValue = {
  masters: AcademicMasters | null;
  loading: boolean;
  filters: AcademicFilters;
  setFilters: (next: Partial<AcademicFilters>) => void;
  resetFilters: () => void;
  studentsListStats: StudentsListStats | null;
  setStudentsListStats: (next: StudentsListStats | null) => void;
};

const AcademicContext = createContext<AcademicContextValue | null>(null);

function readStoredFilters(): AcademicFilters | null {
  if (typeof window === "undefined") return null;
  try {
    const raw =
      window.localStorage.getItem(STORAGE_KEY) ??
      window.localStorage.getItem("academic-portal-filters-v3") ??
      window.localStorage.getItem("academic-portal-filters-v2");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AcademicFilters>;
    const studentStatus =
      !parsed.studentStatus || parsed.studentStatus === "all"
        ? "Regular"
        : parsed.studentStatus;
    return { ...defaultFilters, ...parsed, studentStatus, q: "" };
  } catch {
    return null;
  }
}

export function AcademicProvider({ children }: { children: React.ReactNode }) {
  const { authorization } = useAuth();
  const [masters, setMasters] = useState<AcademicMasters | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFiltersState] = useState<AcademicFilters>(defaultFilters);
  const [studentsListStats, setStudentsListStats] =
    useState<StudentsListStats | null>(null);

  useEffect(() => {
    const stored = readStoredFilters();
    if (stored) setFiltersState(stored);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await apiFetch(`/catalog/masters`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Failed to load masters");
        const data = (await response.json()) as AcademicMasters;
        if (cancelled) return;

        const scopedColleges = (data.colleges ?? []).filter((college) =>
          scopeAllowsCollege(authorization, college.id),
        );
        const allowedCollegeIds = new Set(scopedColleges.map((college) => college.id));
        const scopedCourses = (data.courses ?? []).filter((course) =>
          allowedCollegeIds.has(course.collegeId),
        );
        const allowedCourseIds = new Set(scopedCourses.map((course) => course.id));
        const scopedBranches = (data.branches ?? []).filter(
          (branch) =>
            allowedCourseIds.has(branch.courseId) &&
            scopeAllowsBranch(authorization, branch.id),
        );
        const allowedBranchIds = new Set(scopedBranches.map((branch) => branch.id));
        const scopedBatches = (data.batches ?? []).filter((row) =>
          allowedBranchIds.has(row.branchId),
        );
        const scopedSections = (data.sections ?? []).filter((section) =>
          allowedBranchIds.has(section.branchId),
        );

        setMasters({
          ...data,
          colleges: scopedColleges,
          courses: scopedCourses,
          branches: scopedBranches,
          batches: scopedBatches,
          sections: scopedSections,
          yearOptions: data.yearOptions ?? [1, 2, 3, 4],
          semesterOptions: data.semesterOptions ?? [1, 2],
        });
        setFiltersState((prev) => {
          const defaultYear =
            data.defaults?.academicYear ||
            data.academicYears.find((y) => y.isActive)?.label ||
            data.academicYears[0]?.label ||
            "";

          // If the stored/previous academic year is empty, invalid, or an old bugged value (e.g. 2002-2003, 2001-2002),
          // or is not found in the valid academic years list, use the current academic year default.
          const isInvalidPrevYear =
            !prev.academicYear ||
            prev.academicYear === "2002-2003" ||
            prev.academicYear === "2001-2002" ||
            !data.academicYears.some((y) => y.label === prev.academicYear);

          const academicYear = isInvalidPrevYear ? defaultYear : prev.academicYear;

          let collegeId = prev.collegeId;
          if (!authorization?.scope?.isGlobal && scopedColleges.length === 1) {
            collegeId = scopedColleges[0]!.id;
          } else if (
            collegeId !== "all" &&
            !scopedColleges.some((college) => college.id === collegeId)
          ) {
            collegeId = scopedColleges.length === 1 ? scopedColleges[0]!.id : "all";
          }

          let branchId = prev.branchId;
          if (
            branchId !== "all" &&
            !scopedBranches.some((branch) => branch.id === branchId)
          ) {
            branchId = "all";
          }

          return { ...prev, academicYear, collegeId, branchId };
        });
      } catch {
        if (!cancelled) setMasters(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [authorization]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const { q: _q, ...persistable } = filters;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable));
  }, [filters]);

  const setFilters = useCallback((next: Partial<AcademicFilters>) => {
    setFiltersState((prev) => {
      const merged = { ...prev, ...next };

      if (next.collegeId !== undefined && next.collegeId !== prev.collegeId) {
        merged.courseId = "all";
        merged.branchId = "all";
        merged.batch = "all";
        merged.section = "all";
      }
      if (next.courseId !== undefined && next.courseId !== prev.courseId) {
        merged.branchId = "all";
        merged.batch = "all";
        merged.section = "all";
      }
      if (next.branchId !== undefined && next.branchId !== prev.branchId) {
        merged.batch = "all";
        merged.section = "all";
      }

      return merged;
    });
  }, []);

  const resetFilters = useCallback(() => {
    setFiltersState((_prev) => {
      const defaultYear =
        masters?.defaults?.academicYear ||
        masters?.academicYears.find((y) => y.isActive)?.label ||
        "2026-2027";
      let collegeId: number | "all" = "all";
      if (!authorization?.scope?.isGlobal && masters?.colleges.length === 1) {
        collegeId = masters.colleges[0]!.id;
      }
      return {
        ...defaultFilters,
        academicYear: defaultYear,
        collegeId,
      };
    });
  }, [masters, authorization]);

  const value = useMemo(
    () => ({
      masters,
      loading,
      filters,
      setFilters,
      resetFilters,
      studentsListStats,
      setStudentsListStats,
    }),
    [masters, loading, filters, setFilters, resetFilters, studentsListStats],
  );

  return (
    <AcademicContext.Provider value={value}>{children}</AcademicContext.Provider>
  );
}

export function useAcademicContext() {
  const ctx = useContext(AcademicContext);
  if (!ctx) {
    throw new Error("useAcademicContext must be used within AcademicProvider");
  }
  return ctx;
}
