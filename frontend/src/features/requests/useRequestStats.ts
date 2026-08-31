"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { summarizeMine } from "./utils";
import type { RequestSummary } from "./types";

export type RequestStats = {
  mine: ReturnType<typeof summarizeMine>;
  pendingApproval: number;
};

export function useRequestStats(enabled: { mine: boolean; pending: boolean }) {
  const [stats, setStats] = useState<RequestStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const reload = useCallback(async () => {
    if (!enabled.mine && !enabled.pending) {
      setStats(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(false);
    try {
      const [mineResponse, pendingResponse] = await Promise.all([
        enabled.mine
          ? apiFetch("/requests?filter=mine", { cache: "no-store" })
          : Promise.resolve(null),
        enabled.pending
          ? apiFetch("/requests/pending", { cache: "no-store" })
          : Promise.resolve(null),
      ]);

      let mineItems: RequestSummary[] = [];
      if (mineResponse) {
        if (!mineResponse.ok) throw new Error("mine failed");
        const body = await mineResponse.json();
        mineItems = (body as { data: RequestSummary[] }).data ?? [];
      }

      let pendingCount = 0;
      if (pendingResponse) {
        if (!pendingResponse.ok) throw new Error("pending failed");
        const body = await pendingResponse.json();
        pendingCount = ((body as { data: RequestSummary[] }).data ?? []).length;
      }

      setStats({
        mine: summarizeMine(mineItems),
        pendingApproval: pendingCount,
      });
    } catch {
      setStats(null);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [enabled.mine, enabled.pending]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { stats, loading, error, reload };
}
