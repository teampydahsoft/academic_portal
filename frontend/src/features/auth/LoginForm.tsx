"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/components/auth/AuthProvider";
import { PwaInstallPrompt } from "@/components/pwa/PwaInstallPrompt";
import { getPortalBranding } from "@/lib/portal-branding";

const REMEMBER_KEY = "ap_login_remember_identifier";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading, refresh } = useAuth();
  const branding = getPortalBranding();

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [forgotHint, setForgotHint] = useState(false);
  /** Avoid SSR/client auth-branch mismatch (loading resolves only on client). */
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(REMEMBER_KEY);
      if (saved) {
        setIdentifier(saved);
        setRememberMe(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!hydrated || loading || !user) return;
    const next = searchParams.get("next") || "/dashboard";
    router.replace(next.startsWith("/") ? next : "/dashboard");
  }, [hydrated, loading, user, router, searchParams]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setForgotHint(false);
    try {
      const response = await apiFetch("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof body?.message === "string" ? body.message : "Login failed",
        );
      }

      try {
        if (rememberMe) {
          window.localStorage.setItem(REMEMBER_KEY, identifier.trim());
        } else {
          window.localStorage.removeItem(REMEMBER_KEY);
        }
      } catch {
        /* ignore */
      }

      await refresh();
      const next = searchParams.get("next") || "/dashboard";
      router.replace(next.startsWith("/") ? next : "/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  // Same markup on server + first client paint; auth UI only after hydrate.
  if (!hydrated || loading || user) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center bg-[#f6f1e8] text-sm text-slate-500">
        {hydrated && user ? "Redirecting…" : "Loading…"}
      </div>
    );
  }

  const backHref = branding.collegeWebsite || "/";

  return (
    <div className="relative flex h-full min-h-0 items-center justify-center overflow-y-auto bg-[#f6f1e8] px-3 py-6 sm:px-6">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/illustrations/login-screen-background.png"
          alt=""
          className="login-bg-kenburns login-bg-ink absolute inset-0 h-full w-full object-cover object-left"
          draggable={false}
        />
        <div className="login-orb absolute -left-16 top-10 h-56 w-56 rounded-full bg-[#c4b49a]/22 blur-3xl" />
        <div className="login-orb-delay absolute bottom-8 right-[12%] h-40 w-40 rounded-full bg-[#d7c4a3]/18 blur-3xl" />
      </div>

      <PwaInstallPrompt />

      <div className="login-illust-enter relative my-auto grid w-full max-w-[1180px] overflow-hidden rounded-2xl border border-[#e6dccb] bg-white shadow-[0_12px_40px_rgba(15,28,46,0.10)] lg:min-h-[min(620px,calc(100vh-3rem))] lg:w-[90vw] lg:grid-cols-2">
        <Link
          href={backHref}
          className="absolute left-4 top-4 z-20 inline-flex h-9 w-9 items-center justify-center rounded-full text-navy-900/70 transition hover:bg-black/5 hover:text-navy-900 lg:text-white/80 lg:hover:bg-white/10 lg:hover:text-white"
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5" strokeWidth={1.75} />
        </Link>

        {/* Left: education illustration, same card as the form */}
        <div className="relative hidden items-center justify-center overflow-hidden bg-[#050505] px-4 py-5 lg:flex xl:px-5 xl:py-6">
          <div className="pointer-events-none absolute inset-0" aria-hidden>
            <div className="login-orb absolute -left-8 top-12 h-44 w-44 rounded-full bg-[#1e4a7a]/40 blur-2xl" />
            <div className="login-orb-delay absolute -right-6 bottom-16 h-36 w-36 rounded-full bg-[#0d6e6a]/35 blur-2xl" />
            <div className="login-glow absolute bottom-[18%] left-1/2 h-24 w-[70%] -translate-x-1/2 rounded-full bg-[#3b82c4]/25 blur-3xl" />
            <span className="login-spark absolute left-[18%] top-[22%] h-2 w-2 rounded-full bg-[#5ba3e0]/80 shadow-[0_0_10px_rgba(91,163,224,0.8)]" />
            <span className="login-spark-delay absolute right-[22%] top-[28%] h-1.5 w-1.5 rounded-full bg-[#7dd3c0]/70 shadow-[0_0_8px_rgba(125,211,192,0.7)]" />
            <span className="login-spark absolute right-[30%] bottom-[30%] h-1.5 w-1.5 rounded-full bg-[#f4c46a]/65 shadow-[0_0_8px_rgba(244,196,106,0.6)]" />
          </div>
          <div className="relative z-10 flex w-full max-w-[560px] items-center justify-center">
            <div className="login-illust-float w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/illustrations/login-education.png"
                alt="Students learning with analytics and education tools"
                className="mx-auto h-auto w-full max-h-[min(520px,calc(100vh-8rem))] select-none object-contain"
                draggable={false}
              />
            </div>
          </div>
        </div>

        {/* Right: login form */}
        <div className="flex flex-col justify-center bg-white px-6 py-10 sm:px-12 lg:px-14 xl:px-16">
          <div className="mx-auto w-full max-w-[360px]">
            <div className="flex flex-col items-center text-center">
              <div className="flex h-16 w-[180px] items-center justify-center sm:h-[72px] sm:w-[200px]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={branding.collegeLogo}
                  alt={`${branding.collegeName} logo`}
                  className="max-h-full max-w-full object-contain"
                />
              </div>
              <h1 className="mt-3 text-lg font-semibold tracking-tight text-navy-900 sm:text-xl">
                {branding.collegeName}
              </h1>
              <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                {branding.portalName}
              </p>
            </div>

            <form className="mt-8 space-y-4" onSubmit={onSubmit}>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-500">
                  Email / Employee ID
                </span>
                <input
                  autoComplete="username"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="HRMS email or employee id"
                  className="h-11 w-full rounded-lg border border-slate-200 bg-slate-50/80 px-3.5 text-sm text-navy-900 outline-none transition placeholder:text-slate-400 focus:border-navy-800 focus:bg-white focus:ring-2 focus:ring-navy-800/10"
                  required
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-500">
                  Password
                </span>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Your HRMS password"
                  className="h-11 w-full rounded-lg border border-slate-200 bg-slate-50/80 px-3.5 text-sm text-navy-900 outline-none transition placeholder:text-slate-400 focus:border-navy-800 focus:bg-white focus:ring-2 focus:ring-navy-800/10"
                  required
                />
              </label>

              <div className="flex items-center justify-between gap-3 pt-0.5">
                <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-navy-900 focus:ring-navy-800/30"
                  />
                  Remember me
                </label>
                <button
                  type="button"
                  className="text-xs font-medium text-navy-800 hover:underline"
                  onClick={() => setForgotHint(true)}
                >
                  Forgot Password?
                </button>
              </div>

              {forgotHint ? (
                <p className="text-xs text-slate-500">
                  Change or reset your password in HRMS. This portal always uses your current HRMS
                  password — it is never stored here. Contact your administrator if you need portal
                  access first.
                </p>
              ) : null}

              {error ? <p className="text-sm text-critical">{error}</p> : null}

              <button
                type="submit"
                disabled={submitting || !identifier || !password}
                className="mt-2 flex h-11 w-full items-center justify-center rounded-lg bg-navy-900 text-sm font-semibold text-white shadow-sm transition-colors duration-200 hover:bg-navy-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-white disabled:opacity-100 disabled:shadow-none disabled:hover:bg-slate-300"
              >
                {submitting ? "Signing in…" : "Sign In"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
