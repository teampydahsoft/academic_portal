"use client";

import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import Link from "next/link";
import { Button } from "@/components/ui/Button";

/**
 * Dedicated alerts API (`ap_alerts`) is defined in schema but not exposed by the backend.
 * Do not invent notifications — show an honest empty state.
 */
export function AlertsView() {
  return (
    <div>
      <PageHeader
        title="Alerts"
        description="Operational notifications for attendance, timetable, workload, and mentoring. A live alerts feed is not connected yet."
      />
      <EmptyState
        title="No alerts at this time"
        description="There is no alerts API wired to this portal yet. Check Pending & Exceptions for actionable items derived from live modules, or the Command Center for scope-level signals."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Link href="/pending-exceptions">
              <Button size="sm" variant="secondary">
                Pending & Exceptions
              </Button>
            </Link>
            <Link href="/command-center">
              <Button size="sm" variant="ghost">
                Command Center
              </Button>
            </Link>
          </div>
        }
      />
    </div>
  );
}
