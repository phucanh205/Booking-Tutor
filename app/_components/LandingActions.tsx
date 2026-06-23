"use client";

import Link from "next/link";

import { useAuth } from "@/app/providers";

function ButtonLink({
  href,
  variant,
  children,
}: {
  href: string;
  variant: "primary" | "secondary";
  children: React.ReactNode;
}) {
  const base =
    "inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-semibold transition-colors";
  const styles =
    variant === "primary"
      ? "bg-[#1d4ed8] text-white hover:bg-[#1e40af]"
      : "border border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50";

  return (
    <Link href={href} className={`${base} ${styles}`}>
      {children}
    </Link>
  );
}

export function LandingHeaderActions() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center gap-2">
        <div className="h-10 w-20 rounded-lg bg-zinc-100" />
        <div className="h-10 w-24 rounded-lg bg-zinc-100" />
      </div>
    );
  }

  if (user) {
    return (
      <div className="flex items-center gap-2">
        <ButtonLink href="/rooms" variant="primary">
          Dashboard
        </ButtonLink>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <ButtonLink href="/login?next=%2Frooms" variant="secondary">
        Login
      </ButtonLink>
      <ButtonLink href="/login?next=%2Frooms" variant="primary">
        Sign Up
      </ButtonLink>
    </div>
  );
}

export function LandingHeroActions() {
  const { user, loading } = useAuth();

  const href = user ? "/rooms" : "/login?next=%2Frooms";
  const label = user ? "Open Dashboard" : "Get Started";

  return (
    <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
      <Link
        href={href}
        className="inline-flex h-12 items-center justify-center rounded-xl bg-[#1d4ed8] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#1e40af] disabled:opacity-60"
        aria-disabled={loading}
      >
        {label}
      </Link>
      <Link
        href="#features"
        className="inline-flex h-12 items-center justify-center rounded-xl border border-zinc-200 bg-white px-5 text-sm font-semibold text-zinc-900 transition-colors hover:bg-zinc-50"
      >
        Explore Features
      </Link>
    </div>
  );
}

