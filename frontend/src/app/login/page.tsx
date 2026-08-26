import { Suspense } from "react";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { LoginForm } from "@/features/auth/LoginForm";

export default function LoginPage() {
  return (
    <AuthProvider>
      <Suspense
        fallback={
          <div className="flex h-full min-h-0 items-center justify-center bg-[#f6f1e8] text-sm text-slate-500">
            Loading…
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </AuthProvider>
  );
}
