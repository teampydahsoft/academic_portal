"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

export type AuthUser = {
  id: number;
  name: string;
  email: string | null;
  username: string;
  hrmsEmployeeId: string | null;
  hrmsUserId: string;
};

export type AuthRole = {
  roleKey: string;
  label: string;
  collegeId: number | null;
  branchId: number | null;
};

export type AuthScope = {
  isGlobal: boolean;
  collegeIds: number[] | null;
  branchIds: number[] | null;
};

export type Authorization = {
  roles: AuthRole[];
  permissions: string[];
  scope: AuthScope;
};

type AuthContextValue = {
  user: AuthUser | null;
  authorization: Authorization | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (...permissions: string[]) => boolean;
  hasAnyPermission: (...permissions: string[]) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const EMPTY_AUTHZ: Authorization = {
  roles: [],
  permissions: [],
  scope: { isGlobal: false, collegeIds: [], branchIds: [] },
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authorization, setAuthorization] = useState<Authorization | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const refresh = useCallback(async () => {
    try {
      const response = await apiFetch("/auth/me");
      if (response.status === 401) {
        setUser(null);
        setAuthorization(null);
        return;
      }
      if (!response.ok) {
        setUser(null);
        setAuthorization(null);
        return;
      }
      const body = (await response.json()) as {
        user: AuthUser;
        authorization?: Authorization;
      };
      setUser(body.user);
      setAuthorization(body.authorization ?? EMPTY_AUTHZ);
    } catch {
      setUser(null);
      setAuthorization(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      await refresh();
      if (!cancelled) setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } finally {
      setUser(null);
      setAuthorization(null);
      router.replace("/login");
    }
  }, [router]);

  const hasAnyPermission = useCallback(
    (...permissions: string[]) => {
      if (!authorization?.permissions?.length) return false;
      return permissions.some((p) => authorization.permissions.includes(p));
    },
    [authorization],
  );

  const hasPermission = useCallback(
    (...permissions: string[]) => {
      if (!authorization?.permissions?.length) return false;
      return permissions.every((p) => authorization.permissions.includes(p));
    },
    [authorization],
  );

  const value = useMemo(
    () => ({
      user,
      authorization,
      loading,
      refresh,
      logout,
      hasPermission,
      hasAnyPermission,
    }),
    [user, authorization, loading, refresh, logout, hasPermission, hasAnyPermission],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
