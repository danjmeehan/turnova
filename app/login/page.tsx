import { Suspense } from "react";
import Link from "next/link";
import { RunnerLogo } from "@/components/RunnerLogo";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-base-100 px-4 py-8">
      <div className="card bit-box w-full max-w-sm bg-base-200">
        <div className="card-body">
          <div className="mb-1 flex items-center gap-2.5">
            <RunnerLogo className="size-10 shrink-0 text-primary" />
            <h1 className="font-pixel text-base text-primary sm:text-lg">
              Turnova
            </h1>
          </div>
          <p className="mt-1 mb-5 text-sm text-base-content/80">
            Private coach — enter the app password.
          </p>
          <Suspense
            fallback={
              <div className="flex justify-center py-6">
                <span className="loading loading-spinner loading-md text-primary" />
              </div>
            }
          >
            <LoginForm />
          </Suspense>
          <p className="mt-4 text-center text-sm">
            <Link href="/help" className="link link-hover text-base-content/70">
              How Turnova works
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
