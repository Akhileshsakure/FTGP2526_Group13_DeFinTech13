// app/not-found.tsx
// Shown when Next.js can't match any route
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="fade-up max-w-md mx-auto mt-20 text-center px-4">
      <div className="font-display text-7xl text-stone-200 mb-4">404</div>
      <h2 className="font-display text-2xl text-stone-800 mb-2">Page not found</h2>
      <p className="text-stone-500 text-sm mb-8">
        The page you&apos;re looking for doesn&apos;t exist.
      </p>
      <Link href="/" className="btn btn-primary">
        Back to Dashboard
      </Link>
    </div>
  );
}
