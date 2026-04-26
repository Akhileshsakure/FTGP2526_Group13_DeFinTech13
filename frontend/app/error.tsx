"use client";
// app/error.tsx
// Next.js App Router error boundary — catches unhandled errors in the route tree.
// Must be a Client Component.

import { useEffect } from "react";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Log to console (swap for an error reporting service in production)
    console.error("[App Error]", error);
  }, [error]);

  return (
    <div className="fade-up max-w-md mx-auto mt-20 text-center px-4">
      <div className="text-4xl mb-4">⚠</div>
      <h2 className="font-display text-2xl text-stone-800 mb-2">Something went wrong</h2>
      <p className="text-stone-500 text-sm mb-2">
        {error.message ?? "An unexpected error occurred."}
      </p>
      {error.digest && (
        <p className="font-mono text-xs text-stone-400 mb-6">
          Error ID: {error.digest}
        </p>
      )}
      <div className="flex gap-3 justify-center">
        <button className="btn btn-primary" onClick={reset}>
          Try again
        </button>
        <a href="/" className="btn btn-outline">
          Go to Dashboard
        </a>
      </div>
    </div>
  );
}
