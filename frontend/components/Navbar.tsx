"use client";
// components/Navbar.tsx
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "../context/WalletContext";

export default function Navbar() {
  const { account, shortAccount, isConnected, isCorrectNetwork, isConnecting, connect, switchNetwork } =
    useWallet();
  const pathname = usePathname();
  const isLanding = pathname === "/";

  if (isLanding) return null;

  const navLinks = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/markets", label: "Markets" },
    { href: "/supply", label: "Supply" },
    { href: "/borrow", label: "Borrow" },
    { href: "/transactions", label: "Transactions" },
  ];

  return (
    <nav className="bg-white border-b border-stone-200 sticky top-0 z-40">
      <div className="max-w-5xl mx-auto px-4">
        <div className="flex items-center justify-between h-14">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <span className="font-display text-xl text-stone-800">DeFinTech</span>
            <span className="badge badge-stone hidden sm:inline-flex">Sepolia</span>
          </Link>

          {/* Nav links */}
          <div className="hidden sm:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  pathname === link.href
                    ? "bg-stone-100 text-stone-900"
                    : "text-stone-500 hover:text-stone-800 hover:bg-stone-50"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Wallet button */}
          <div className="flex items-center gap-2">
            {!isConnected ? (
              <button
                className="btn btn-primary text-sm py-2 px-4"
                onClick={connect}
                disabled={isConnecting}
              >
                {isConnecting ? (
                  <span className="flex items-center gap-1.5">
                    <SpinIcon />
                    Connecting…
                  </span>
                ) : (
                  "Connect Wallet"
                )}
              </button>
            ) : !isCorrectNetwork ? (
              <button
                className="btn btn-danger text-sm py-2 px-4"
                onClick={switchNetwork}
              >
                Switch to Sepolia
              </button>
            ) : (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-stone-50 border border-stone-200">
                <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>
                <span className="font-mono text-sm text-stone-700">{shortAccount}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile nav */}
      <div className="sm:hidden flex gap-0.5 px-2 pb-2">
        {navLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`flex-1 text-center py-1.5 rounded text-xs font-medium transition-colors ${
              pathname === link.href
                ? "bg-stone-100 text-stone-900"
                : "text-stone-500"
            }`}
          >
            {link.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

function SpinIcon() {
  return (
    <svg
      className="animate-spin"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}
