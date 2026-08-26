"use client";

import { useEffect, useState } from "react";
import { AcademicProvider } from "@/components/layout/AcademicProvider";
import { AcademicFilterBar } from "@/components/layout/AcademicFilterBar";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopHeader } from "@/components/layout/TopHeader";

const COLLAPSE_KEY = "ap.sidebar.collapsed";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(COLLAPSE_KEY);
      if (stored === "1") setCollapsed(true);
    } catch {
      /* ignore */
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  return (
    <AcademicProvider>
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar
          open={mobileOpen}
          collapsed={collapsed}
          onClose={() => setMobileOpen(false)}
          onToggleCollapsed={toggleCollapsed}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <TopHeader onMenuClick={() => setMobileOpen(true)} />
          <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
            <AcademicFilterBar title="Page filters" />
            {children}
          </main>
        </div>
      </div>
    </AcademicProvider>
  );
}
