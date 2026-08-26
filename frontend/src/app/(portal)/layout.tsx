import { AppShell } from "@/components/layout/AppShell";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { PathPermissionGuard } from "@/components/auth/PathPermissionGuard";

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <RequireAuth>
        <AppShell>
          <PathPermissionGuard>{children}</PathPermissionGuard>
        </AppShell>
      </RequireAuth>
    </AuthProvider>
  );
}
