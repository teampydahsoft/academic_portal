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
      <div className="flex h-dvh max-h-dvh overflow-hidden bg-background print:h-auto print:max-h-none print:overflow-visible print:bg-white">
        <div className="print:hidden h-full">
          <Sidebar
            open={mobileOpen}
            collapsed={collapsed}
            onClose={() => setMobileOpen(false)}
            onToggleCollapsed={toggleCollapsed}
          />
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col print:block print:min-h-full">
          <div className="print:hidden">
            <TopHeader onMenuClick={() => setMobileOpen(true)} />
          </div>
          <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-5 sm:py-5 print:block print:overflow-visible print:p-0">
            <div className="print:hidden">
              <AcademicFilterBar title="Page filters" />
            </div>
            {children}
          </main>
        </div>
      </div>
    </AcademicProvider>
  );
}
