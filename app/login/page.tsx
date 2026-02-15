"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { signInWithGoogle } from "@/lib/auth";
import { useAuth } from "@/app/providers";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextPath = searchParams.get("next") || "/bookingRoom";

  useEffect(() => {
    if (!loading && user) {
      router.replace(nextPath);
    }
  }, [loading, user, router, nextPath]);

  async function onGoogleSignIn() {
    setError(null);
    setSubmitting(true);
    try {
      await signInWithGoogle();
      router.replace(nextPath);
    } catch (e) {
      setError("Đăng nhập thất bại. Vui lòng thử lại.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-10 shadow-sm">
        <div className="flex flex-col items-center gap-4">
          <Image
            src="/google.svg"
            alt="Google"
            width={64}
            height={64}
            priority
          />
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-950">
            Đăng nhập
          </h1>
          <p className="text-center text-zinc-600">
            Sử dụng tài khoản Google của bạn để tiếp tục
          </p>
        </div>

        <div className="mt-8">
          <button
            type="button"
            onClick={onGoogleSignIn}
            disabled={submitting || loading}
            className="flex h-12 w-full items-center justify-center gap-3 rounded-xl bg-[#1d4ed8] px-4 font-semibold text-white transition-colors hover:bg-[#1e40af] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-white/10">
              <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden="true">
                <path
                  fill="#FFC107"
                  d="M43.611 20.083H42V20H24v8h11.303C33.854 32.657 29.287 36 24 36c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.047 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
                />
                <path
                  fill="#FF3D00"
                  d="M6.306 14.691l6.571 4.819C14.655 16.108 19.01 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.047 6.053 29.268 4 24 4c-7.682 0-14.344 4.328-17.694 10.691z"
                />
                <path
                  fill="#4CAF50"
                  d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.266 0-9.82-3.319-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
                />
                <path
                  fill="#1976D2"
                  d="M43.611 20.083H42V20H24v8h11.303c-.697 1.997-1.94 3.705-3.544 4.955l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
                />
              </svg>
            </span>
            <span>Đăng nhập với Google</span>
          </button>

          <p className="mt-6 text-center text-sm text-zinc-500">
            Bằng cách đăng nhập, bạn đồng ý với{" "}
            <a href="#" className="font-medium text-zinc-700 hover:underline">
              Điều khoản dịch vụ
            </a>{" "}
            và{" "}
            <a href="#" className="font-medium text-zinc-700 hover:underline">
              Chính sách bảo mật
            </a>{" "}
            của chúng tôi.
          </p>

          {error ? (
            <p className="mt-4 text-center text-sm font-medium text-red-600">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
