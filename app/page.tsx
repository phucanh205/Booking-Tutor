import Link from "next/link";
import Image from "next/image";

import {
  LandingHeaderActions,
  LandingHeroActions,
} from "@/app/_components/LandingActions";

export default function Home() {
  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-20 border-b border-zinc-100 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg bg-[#1d4ed8]">
              <Image
                src="/favicon.ico"
                alt="Booking Tutor"
                width={36}
                height={36}
                priority
              />
            </div>
            <span className="text-sm font-semibold tracking-tight text-zinc-950">
              Booking Tutor
            </span>
          </Link>

          <nav className="hidden items-center gap-6 text-sm font-medium text-zinc-700 md:flex">
            <Link href="#home" className="hover:text-zinc-950">
              Home
            </Link>
            <Link href="#features" className="hover:text-zinc-950">
              Features
            </Link>
            <Link href="#about" className="hover:text-zinc-950">
              About
            </Link>
          </nav>

          <LandingHeaderActions />
        </div>
      </header>

      <main id="home" className="scroll-mt-24">
        <section className="bg-gradient-to-b from-white to-zinc-50">
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-6 py-16 md:grid-cols-2 md:items-center">
            <div>
              <h1 className="text-4xl font-semibold tracking-tight text-zinc-950 md:text-5xl">
                Simplify Tutor Scheduling and Lesson Management
              </h1>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-zinc-600">
                A centralized platform for managing tutor availability, lesson
                bookings, and learning schedules.
              </p>

              <LandingHeroActions />
              <p className="mt-4 text-sm text-zinc-500">
                No setup fees. Sign in with Google to start.
              </p>
            </div>

            <div className="relative">
              <div className="relative overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-sm">
                <div className="relative aspect-[16/10] w-full">
                  <Image
                    src="/Screenshot 2026-06-18 142045.png"
                    alt="Booking Tutor dashboard preview"
                    fill
                    priority
                    sizes="(min-width: 768px) 50vw, 100vw"
                    className="object-contain"
                  />
                </div>
              </div>

              <div className="pointer-events-none absolute -right-6 -top-8 hidden h-24 w-24 rounded-full bg-[#1d4ed8]/10 blur-2xl md:block" />
            </div>
          </div>
        </section>

        <section id="features" className="scroll-mt-24 bg-zinc-50">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <div className="text-center">
              <p className="text-xs font-semibold tracking-widest text-[#1d4ed8]">
                PLATFORM FEATURES
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-950">
                Everything You Need to Manage Tutoring
              </h2>
              <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-zinc-600">
                Built for institutions, independent tutors, and learners who
                value organized, efficient scheduling.
              </p>
            </div>

            <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
                <div className="text-sm font-semibold text-zinc-950">
                  Booking Management
                </div>
                <div className="mt-2 text-sm text-zinc-600">
                  Create, reschedule, and approve lesson bookings with real-time
                  status updates.
                </div>
              </div>
              <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
                <div className="text-sm font-semibold text-zinc-950">
                  Schedule Tracking
                </div>
                <div className="mt-2 text-sm text-zinc-600">
                  Visualize tutor and student schedules with an intuitive
                  calendar interface.
                </div>
              </div>
              <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
                <div className="text-sm font-semibold text-zinc-950">
                  User Management
                </div>
                <div className="mt-2 text-sm text-zinc-600">
                  Manage classes and members with role-based access controls.
                </div>
              </div>
              <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm md:col-span-1">
                <div className="text-sm font-semibold text-zinc-950">
                  Attendance Checking
                </div>
                <div className="mt-2 text-sm text-zinc-600">
                  Track student attendance and keep logs for each session.
                </div>
              </div>
              <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm md:col-span-2">
                <div className="text-sm font-semibold text-zinc-950">
                  Secure Authentication
                </div>
                <div className="mt-2 text-sm text-zinc-600">
                  Sign in with Google and keep classrooms protected with member
                  permissions.
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-white">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <div className="text-center">
              <p className="text-xs font-semibold tracking-widest text-[#1d4ed8]">
                WORKFLOW
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-950">
                How It Works
              </h2>
              <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-zinc-600">
                Get up and running in four simple steps.
              </p>
            </div>

            <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-4">
              {[
                {
                  step: "01",
                  title: "Create Account",
                  desc: "Sign in in seconds using your Google account.",
                },
                {
                  step: "02",
                  title: "Manage Schedule",
                  desc: "Set tutor availability and recurring lesson slots.",
                },
                {
                  step: "03",
                  title: "Book Sessions",
                  desc: "Students request slots and receive confirmations.",
                },
                {
                  step: "04",
                  title: "Track Progress",
                  desc: "Monitor booking history and attendance over time.",
                },
              ].map((it) => (
                <div
                  key={it.step}
                  className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#1d4ed8]/20 bg-[#1d4ed8]/10 text-xs font-semibold text-[#1d4ed8]">
                    {it.step}
                  </div>
                  <div className="mt-4 text-sm font-semibold text-zinc-950">
                    {it.title}
                  </div>
                  <div className="mt-2 text-sm text-zinc-600">{it.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="about" className="scroll-mt-24 bg-zinc-50">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <div className="text-center">
              <p className="text-xs font-semibold tracking-widest text-[#1d4ed8]">
                BY THE NUMBERS
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-950">
                Platform Impact at a Glance
              </h2>
              <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-zinc-600">
                Quick metrics highlighting the platform’s value. (You can later
                wire these to real stats.)
              </p>
            </div>

            <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-4">
              {[
                { value: "12,400+", label: "Active Users" },
                { value: "84,300+", label: "Total Bookings" },
                { value: "67,100+", label: "Completed Sessions" },
                { value: "1,800+", label: "Tutor Accounts" },
              ].map((it) => (
                <div
                  key={it.label}
                  className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"
                >
                  <div className="text-2xl font-semibold text-zinc-950">
                    {it.value}
                  </div>
                  <div className="mt-1 text-sm text-zinc-600">{it.label}</div>
                </div>
              ))}
            </div>

            <div className="mt-12 rounded-3xl bg-[#1d4ed8] px-6 py-12 text-center text-white md:px-12">
              <h3 className="text-2xl font-semibold tracking-tight md:text-3xl">
                Ready to Manage Learning More Efficiently?
              </h3>
              <p className="mx-auto mt-4 max-w-2xl text-sm text-white/80">
                Join tutors and students already using Booking Tutor to
                streamline their scheduling workflows.
              </p>
              <div className="mt-8 flex justify-center">
                <Link
                  href="/login?next=%2Frooms"
                  className="inline-flex h-12 items-center justify-center rounded-xl bg-white px-5 text-sm font-semibold text-[#1d4ed8] transition-colors hover:bg-zinc-100"
                >
                  Login with Google
                </Link>
              </div>
              <p className="mt-3 text-xs text-white/70">
                No setup fees. Free account available.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-gradient-to-b from-zinc-950 via-zinc-950 to-zinc-900 text-zinc-200">
        <div className="mx-auto w-full px-6 py-12 sm:px-8 md:px-12 lg:px-16 xl:px-20 2xl:px-24">
          <div className="mx-auto max-w-[1600px] grid grid-cols-1 gap-10 md:grid-cols-2 lg:grid-cols-4 lg:gap-6 xl:gap-8">
            <div>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg bg-[#1d4ed8] shadow-lg shadow-blue-500/20">
                  <Image
                    src="/favicon.ico"
                    alt="Booking Tutor"
                    width={40}
                    height={40}
                  />
                </div>
                <div className="text-base font-semibold tracking-tight text-white">
                  Booking Tutor
                </div>
              </div>
              <p className="mt-5 text-sm leading-relaxed text-zinc-400">
                A centralized platform for managing tutor availability, lesson
                bookings, and learning schedules.
              </p>
              <div className="mt-6 flex gap-3">
                <a
                  href="#"
                  className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/5 text-zinc-400 transition-all hover:bg-[#1d4ed8] hover:text-white"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    aria-hidden="true"
                    fill="currentColor"
                  >
                    <path d="M12 2C6.477 2 2 6.587 2 12.254c0 4.53 2.865 8.372 6.839 9.729.5.096.682-.22.682-.49 0-.24-.009-.877-.014-1.722-2.782.622-3.369-1.37-3.369-1.37-.455-1.185-1.11-1.5-1.11-1.5-.907-.63.069-.617.069-.617 1.003.072 1.53 1.056 1.53 1.056.892 1.565 2.341 1.113 2.91.851.091-.664.349-1.114.635-1.37-2.22-.263-4.555-1.14-4.555-5.072 0-1.12.39-2.036 1.03-2.754-.103-.262-.447-1.32.098-2.75 0 0 .84-.275 2.75 1.052A9.35 9.35 0 0 1 12 7.07c.85.004 1.705.118 2.504.345 1.909-1.327 2.748-1.052 2.748-1.052.546 1.43.202 2.488.1 2.75.64.718 1.028 1.634 1.028 2.754 0 3.943-2.338 4.806-4.566 5.064.359.317.679.944.679 1.903 0 1.374-.012 2.48-.012 2.818 0 .272.18.59.688.49C19.138 20.622 22 16.78 22 12.254 22 6.587 17.523 2 12 2Z" />
                  </svg>
                </a>
                <a
                  href="#"
                  className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/5 text-zinc-400 transition-all hover:bg-[#1d4ed8] hover:text-white"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    aria-hidden="true"
                    fill="currentColor"
                  >
                    <path d="M14 3h7v7h-2V6.414l-9.293 9.293-1.414-1.414L17.586 5H14V3ZM5 5h6v2H7v10h10v-4h2v6H5V5Z" />
                  </svg>
                </a>
              </div>
            </div>

            <div>
              <div className="text-sm font-semibold text-white">
                Navigation
              </div>
              <div className="mt-5 space-y-3 text-sm leading-relaxed text-zinc-400">
                <Link
                  href="#features"
                  className="flex items-center gap-2 transition-colors hover:text-white"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    aria-hidden="true"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                  </svg>
                  <span>Features</span>
                </Link>
                <Link
                  href="#about"
                  className="flex items-center gap-2 transition-colors hover:text-white"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    aria-hidden="true"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 16v-4M12 8h.01" />
                  </svg>
                  <span>About</span>
                </Link>
                <Link
                  href="/login?next=%2Frooms"
                  className="flex items-center gap-2 transition-colors hover:text-white"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    aria-hidden="true"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" />
                  </svg>
                  <span>Login</span>
                </Link>
              </div>
            </div>

            <div>
              <div className="text-sm font-semibold text-white">Resources</div>
              <div className="mt-5 space-y-3 text-sm leading-relaxed text-zinc-400">
                <a
                  href="#"
                  className="flex items-center gap-2 transition-colors hover:text-white"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    aria-hidden="true"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M12 2C6.477 2 2 6.587 2 12.254c0 4.53 2.865 8.372 6.839 9.729.5.096.682-.22.682-.49 0-.24-.009-.877-.014-1.722-2.782.622-3.369-1.37-3.369-1.37-.455-1.185-1.11-1.5-1.11-1.5-.907-.63.069-.617.069-.617 1.003.072 1.53 1.056 1.53 1.056.892 1.565 2.341 1.113 2.91.851.091-.664.349-1.114.635-1.37-2.22-.263-4.555-1.14-4.555-5.072 0-1.12.39-2.036 1.03-2.754-.103-.262-.447-1.32.098-2.75 0 0 .84-.275 2.75 1.052A9.35 9.35 0 0 1 12 7.07c.85.004 1.705.118 2.504.345 1.909-1.327 2.748-1.052 2.748-1.052.546 1.43.202 2.488.1 2.75.64.718 1.028 1.634 1.028 2.754 0 3.943-2.338 4.806-4.566 5.064.359.317.679.944.679 1.903 0 1.374-.012 2.48-.012 2.818 0 .272.18.59.688.49C19.138 20.622 22 16.78 22 12.254 22 6.587 17.523 2 12 2Z" />
                  </svg>
                  <span>GitHub Repository</span>
                </a>
                <a
                  href="#"
                  className="flex items-center gap-2 transition-colors hover:text-white"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    aria-hidden="true"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M14 3h7v7h-2V6.414l-9.293 9.293-1.414-1.414L17.586 5H14V3ZM5 5h6v2H7v10h10v-4h2v6H5V5Z" />
                  </svg>
                  <span>Live Demo</span>
                </a>
                <a
                  href="#"
                  className="flex items-center gap-2 transition-colors hover:text-white"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    aria-hidden="true"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M9 12 2 12M2 12 5 9M2 12 5 15M22 12 9 12M9 12 12 9M9 12 12 15" />
                  </svg>
                  <span>Documentation</span>
                </a>
              </div>
            </div>

            <div>
              <div className="text-sm font-semibold text-white">Contact</div>
              <div className="mt-5 space-y-3 text-sm leading-relaxed text-zinc-400">
                <a
                  href="mailto:support@bookingtutor.com"
                  className="flex items-center gap-2 transition-colors hover:text-white"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    aria-hidden="true"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M3 8l7.89 5.26a2 2 0 0 0 2.22 0L21 8M5 19h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2z" />
                  </svg>
                  <span>phucanh18032005@gmail.com</span>
                </a>
                <a
                  href="#"
                  className="flex items-center gap-2 transition-colors hover:text-white"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    aria-hidden="true"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01" />
                  </svg>
                  <span>FAQ</span>
                </a>
                <a
                  href="#"
                  className="flex items-center gap-2 transition-colors hover:text-white"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    aria-hidden="true"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  <span>Feedback</span>
                </a>
              </div>
            </div>
          </div>

          <div className="mt-12 border-t border-white/10 pt-6">
            <div className="flex flex-col gap-4 text-xs text-zinc-500 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-2">
                <span>© {new Date().getFullYear()} Booking Tutor.</span>
                <span className="hidden md:inline">•</span>
                <span>Built by phucanhh205</span>
              </div>
              <div className="flex items-center gap-4">
                <a href="#" className="hover:text-zinc-300 transition-colors">
                  Privacy Policy
                </a>
                <a href="#" className="hover:text-zinc-300 transition-colors">
                  Terms of Service
                </a>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
