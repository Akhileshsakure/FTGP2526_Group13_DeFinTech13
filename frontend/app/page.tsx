"use client";
// app/page.tsx — Landing Page
// ================================================================
// Product pitch page. No wallet required to view.
// Clicking "Connect Wallet" triggers MetaMask.
// On successful connection → auto-redirects to /dashboard.
// ================================================================

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "../context/WalletContext";
import CryptoIcon from "../components/CryptoIcon";

const MARKETS = [
  { symbol: "ETH",  name: "Ether",           icon: "Ξ", supplyAPY: "1.82%", borrowAPY: "3.45%", color: "#6366f1", bg: "#eef2ff" },
  { symbol: "USDC", name: "USD Coin",         icon: "$", supplyAPY: "3.21%", borrowAPY: "5.88%", color: "#0ea5e9", bg: "#f0f9ff" },
  { symbol: "DAI",  name: "Dai Stablecoin",   icon: "◈", supplyAPY: "2.97%", borrowAPY: "5.12%", color: "#f59e0b", bg: "#fffbeb" },
];

const STEPS = [
  { number: "01", title: "Supply Assets",       desc: "Deposit ETH, USDC, or DAI into the protocol. Earn interest from the moment you supply.", color: "#10b981", bg: "#ecfdf5" },
  { number: "02", title: "Use as Collateral",   desc: "Enable your supplied assets as collateral. The Comptroller manages risk automatically.", color: "#6366f1", bg: "#eef2ff" },
  { number: "03", title: "Borrow & Repay",      desc: "Borrow any listed asset against your collateral. Repay anytime with accrued interest.",  color: "#f59e0b", bg: "#fffbeb" },
];

const s = {
  // layout
  page:     { fontFamily: "'DM Sans', system-ui, sans-serif", background: "#fafaf9", minHeight: "100vh" } as React.CSSProperties,
  wrap:     { maxWidth: 1080, margin: "0 auto", padding: "0 24px" } as React.CSSProperties,
  // nav
  nav:      { position: "sticky" as const, top: 0, zIndex: 40, background: "rgba(250,250,249,0.92)", backdropFilter: "blur(12px)", borderBottom: "1px solid #e7e5e4" },
  navInner: { maxWidth: 1080, margin: "0 auto", padding: "0 24px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" } as React.CSSProperties,
  // text
  eyebrow:  { fontSize: "0.75rem", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: "#a8a29e", marginBottom: 10 },
  h1:       { fontFamily: "'DM Serif Display', Georgia, serif", fontSize: "clamp(2.5rem, 6vw, 4rem)", lineHeight: 1.1, color: "#1c1917", marginBottom: 20, letterSpacing: "-0.02em" } as React.CSSProperties,
  h2:       { fontFamily: "'DM Serif Display', Georgia, serif", fontSize: "clamp(1.75rem, 4vw, 2.5rem)", color: "#1c1917", lineHeight: 1.2 } as React.CSSProperties,
  h3:       { fontFamily: "'DM Serif Display', Georgia, serif", fontSize: "1.25rem", color: "#1c1917", marginBottom: 10 } as React.CSSProperties,
  sub:      { fontSize: "1.125rem", color: "#78716c", lineHeight: 1.6, maxWidth: 520, margin: "0 auto 36px" } as React.CSSProperties,
  muted:    { fontSize: "0.8rem", color: "#a8a29e" } as React.CSSProperties,
  mono:     { fontFamily: "'DM Mono', monospace" },
  // cards
  card:     { background: "white", border: "1px solid #e7e5e4", borderRadius: 12, padding: "28px 24px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)", transition: "box-shadow 200ms, transform 200ms" } as React.CSSProperties,
  mcard:    { background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 12, padding: "24px", transition: "box-shadow 200ms, transform 200ms" } as React.CSSProperties,
};

function Btn({ label, onClick, size = "md", dark = false, disabled = false }: {
  label: string; onClick: () => void; size?: "sm" | "md" | "lg"; dark?: boolean; disabled?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const pad = size === "lg" ? "14px 32px" : size === "sm" ? "8px 18px" : "13px 30px";
  const fs  = size === "lg" ? "1rem" : size === "sm" ? "0.875rem" : "0.9375rem";
  const bg  = dark ? (hover ? "#292524" : "#1c1917") : (hover ? "#059669" : "#10b981");
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: pad, borderRadius: 10, background: bg, color: "white", border: "none",
        fontFamily: "'DM Sans', sans-serif", fontWeight: size === "lg" ? 600 : 500,
        fontSize: fs, cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.7 : 1, transition: "background 150ms, transform 150ms",
        transform: hover && !disabled ? "translateY(-1px)" : "translateY(0)",
        boxShadow: !dark && size === "lg" ? "0 4px 14px rgba(16,185,129,0.3)" : "none",
      }}
    >
      {label}
    </button>
  );
}

function HoverCard({ children, style }: { children: React.ReactNode; style: React.CSSProperties }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...style,
        boxShadow: hover ? "0 8px 24px rgba(0,0,0,0.08)" : "0 1px 3px rgba(0,0,0,0.04)",
        transform: hover ? "translateY(-2px)" : "translateY(0)",
      }}
    >
      {children}
    </div>
  );
}

export default function LandingPage() {
  const router = useRouter();
  const { isConnected, isCorrectNetwork, connect, switchNetwork, isConnecting } = useWallet();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 50);
    return () => clearTimeout(t);
  }, []);

  // Auto-redirect once wallet connected + on correct network
  useEffect(() => {
    if (isConnected && isCorrectNetwork) {
      router.push("/dashboard");
    }
  }, [isConnected, isCorrectNetwork, router]);

  const handleConnect = async () => {
    if (!isConnected) await connect();
    else if (!isCorrectNetwork) await switchNetwork();
  };

  const btnLabel = isConnecting ? "Connecting…"
    : !isConnected      ? "Connect Wallet →"
    : !isCorrectNetwork ? "Switch to Sepolia"
    : "Enter App →";

  return (
    <div style={{ ...s.page, opacity: visible ? 1 : 0, transition: "opacity 400ms ease" }}>

      {/* ── NAV ───────────────────────────────────────────────── */}
      <nav style={s.nav}>
        <div style={s.navInner}>
          <div style={{ fontFamily: "'DM Serif Display', Georgia, serif", fontSize: "1.25rem", color: "#1c1917", display: "flex", alignItems: "center", gap: 8 }}>
            DeFinTech
            <span style={{ fontSize: "0.65rem", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", padding: "2px 7px", borderRadius: 4, background: "#f5f5f4", color: "#78716c", fontFamily: "'DM Sans', sans-serif" }}>
              Sepolia
            </span>
          </div>
          <Btn label={btnLabel} onClick={handleConnect} size="sm" disabled={isConnecting} />
        </div>
      </nav>

      {/* ── HERO ──────────────────────────────────────────────── */}
      <section style={{ background: "linear-gradient(160deg, #f0fdf4 0%, #fafaf9 50%, #eff6ff 100%)", borderBottom: "1px solid #e7e5e4", padding: "80px 24px 72px", textAlign: "center" }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          {/* Live badge */}
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 14px", borderRadius: 99, background: "#dcfce7", border: "1px solid #bbf7d0", color: "#15803d", fontSize: "0.8rem", fontWeight: 600, letterSpacing: "0.04em", marginBottom: 28 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981", display: "inline-block" }} />
            Live on Sepolia Testnet
          </div>

          <h1 style={s.h1}>
            Lend, Borrow &{" "}
            <span style={{ color: "#10b981", fontStyle: "italic" }}>Earn</span>
            <br />on DeFi Protocol
          </h1>

          <p style={s.sub}>
            A decentralised lending protocol built on Ethereum. Supply assets,
            borrow against collateral, and earn interest — all non-custodial.
          </p>

          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <Btn label={btnLabel} onClick={handleConnect} size="lg" disabled={isConnecting} />
            <a
              href="https://sepolia.etherscan.io" target="_blank" rel="noopener noreferrer"
              style={{ padding: "14px 32px", borderRadius: 10, background: "white", color: "#44403c", border: "1px solid #e7e5e4", fontFamily: "'DM Sans', sans-serif", fontWeight: 500, fontSize: "1rem", cursor: "pointer", textDecoration: "none" }}
            >
              View on Etherscan ↗
            </a>
          </div>
          <p style={{ marginTop: 16, ...s.muted }}>Requires MetaMask · Sepolia ETH needed for gas</p>
        </div>
      </section>

      {/* ── STATS BAR ─────────────────────────────────────────── */}
      <section style={{ borderBottom: "1px solid #e7e5e4", background: "white" }}>
        <div style={{ ...s.wrap, display: "grid", gridTemplateColumns: "repeat(3,1fr)" }}>
          {[
            { label: "Markets",           value: "3" },
            { label: "Supported Assets",  value: "ETH · USDC · DAI" },
            { label: "Network",           value: "Ethereum Sepolia" },
          ].map((stat, i) => (
            <div key={i} style={{ padding: "28px 24px", textAlign: "center", borderRight: i < 2 ? "1px solid #e7e5e4" : "none" }}>
              <div style={{ fontFamily: "'DM Serif Display', Georgia, serif", fontSize: "1.75rem", color: "#1c1917", marginBottom: 4 }}>{stat.value}</div>
              <div style={s.eyebrow}>{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── HOW IT WORKS ──────────────────────────────────────── */}
      <section style={{ padding: "72px 24px", background: "#fafaf9" }}>
        <div style={s.wrap}>
          <div style={{ textAlign: "center", marginBottom: 48 }}>
            <div style={s.eyebrow}>How it works</div>
            <h2 style={s.h2}>Three steps to get started</h2>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px,1fr))", gap: 20 }}>
            {STEPS.map((step) => (
              <HoverCard key={step.number} style={s.card}>
                <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 40, height: 40, borderRadius: 10, background: step.bg, color: step.color, fontFamily: "'DM Mono', monospace", fontSize: "0.875rem", fontWeight: 500, marginBottom: 16 }}>
                  {step.number}
                </div>
                <h3 style={s.h3}>{step.title}</h3>
                <p style={{ fontSize: "0.9rem", color: "#78716c", lineHeight: 1.6 }}>{step.desc}</p>
              </HoverCard>
            ))}
          </div>
        </div>
      </section>

      {/* ── MARKETS PREVIEW ───────────────────────────────────── */}
      <section style={{ padding: "72px 24px", background: "white", borderTop: "1px solid #e7e5e4", borderBottom: "1px solid #e7e5e4" }}>
        <div style={s.wrap}>
          <div style={{ textAlign: "center", marginBottom: 48 }}>
            <div style={s.eyebrow}>Markets</div>
            <h2 style={s.h2}>Supported assets</h2>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px,1fr))", gap: 16 }}>
            {MARKETS.map((m) => (
              <HoverCard key={m.symbol} style={s.mcard}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
                  <div style={{ width: 42, height: 42, borderRadius: "50%", background: m.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <CryptoIcon symbol={m.symbol} size={28} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, color: "#1c1917" }}>{m.symbol}</div>
                    <div style={{ fontSize: "0.8rem", color: "#a8a29e" }}>{m.name}</div>
                  </div>
                </div>
                <div style={{ borderTop: "1px solid #e7e5e4", paddingTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <div style={s.eyebrow}>Supply APY</div>
                    <div style={{ fontSize: "1.25rem", fontWeight: 600, color: "#10b981" }}>{m.supplyAPY}</div>
                  </div>
                  <div>
                    <div style={s.eyebrow}>Borrow APY</div>
                    <div style={{ fontSize: "1.25rem", fontWeight: 600, color: "#f59e0b" }}>{m.borrowAPY}</div>
                  </div>
                </div>
              </HoverCard>
            ))}
          </div>
          <div style={{ textAlign: "center", marginTop: 40 }}>
            <Btn label={isConnecting ? "Connecting…" : "Start using the protocol →"} onClick={handleConnect} dark disabled={isConnecting} />
          </div>
        </div>
      </section>

      {/* ── FOOTER ────────────────────────────────────────────── */}
      <footer style={{ padding: "32px 24px", background: "#fafaf9", borderTop: "1px solid #e7e5e4" }}>
        <div style={{ ...s.wrap, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div style={{ fontFamily: "'DM Serif Display', Georgia, serif", fontSize: "1.1rem", color: "#1c1917" }}>DeFinTech</div>
          <div style={{ ...s.muted, textAlign: "center" }}>SEMTM0029 Financial Technology · Group 13 · Sepolia Testnet</div>
          <div style={{ ...s.muted, ...s.mono }}>Built with Next.js + ethers.js</div>
        </div>
      </footer>

    </div>
  );
}
