"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAcademicContext } from "@/components/layout/AcademicProvider";
import { apiFetch } from "@/lib/api";
import type { MyTimetableResponse } from "./types";

export function useMyTimetable() {
  const { filters } = useAcademicContext();
  const [payload, setPayload] = useState<MyTimetableResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.collegeId !== "all") params.set("collegeId", String(filters.collegeId));
    if (filters.courseId !== "all") params.set("courseId", String(filters.courseId));
    if (filters.branchId !== "all") params.set("branchId", String(filters.branchId));
    if (filters.batch !== "all") params.set("batch", String(filters.batch));
    if (filters.year !== "all") params.set("year", String(filters.year));
    if (filters.semester !== "all") params.set("semester", String(filters.semester));
    if (filters.section !== "all") params.set("section", String(filters.section));
    if (filters.academicYear) params.set("academicYear", filters.academicYear);
    return params.toString();
  }, [filters]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await apiFetch(`/my-timetable${query ? `?${query}` : ""}`, {
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setPayload(null);
        setError(true);
        return;
      }
      setPayload(body as MyTimetableResponse);
    } catch {
      setPayload(null);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    payload,
    loading,
    error,
    reload: load,
  };
}
