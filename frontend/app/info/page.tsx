"use client";
// app/info/page.tsx — Protocol Info & FAQ
import { useState, useMemo } from "react";

interface FAQItem {
  question: string;
  answer: string;
}

const FAQ_ITEMS: FAQItem[] = [
  {
    question: "What is DeFinTech?",
    answer:
      "DeFinTech is a decentralised lending protocol deployed on the Ethereum Sepolia testnet. It allows users to supply crypto assets to earn interest or borrow assets against their collateral, all without a central intermediary.",
  },
  {
    question: "How does supplying work?",
    answer:
      "When you supply an asset, you deposit it into a liquidity pool and receive cTokens in return. These cTokens represent your share of the pool and automatically accrue interest over time. You can redeem your cTokens at any point to withdraw your underlying assets plus any earned interest.",
  },
  {
    question: "How does borrowing work?",
    answer:
      "To borrow, you first need to supply an asset and enable it as collateral. You can then borrow other assets up to a limit determined by your collateral value and the collateral factor. Interest accrues on your borrowed amount over time, and you must repay the principal plus interest to close the position.",
  },
  {
    question: "What is a collateral factor?",
    answer:
      "The collateral factor (also called Loan-to-Value or LTV) determines how much you can borrow against a supplied asset. For example, a 75% collateral factor on ETH means you can borrow up to 75% of your supplied ETH value. Higher collateral factors allow more borrowing but carry greater liquidation risk.",
  },
  {
    question: "What is the health factor?",
    answer:
      "The health factor measures the safety of your borrowing position. It is calculated as (Collateral Value x Liquidation Threshold) / Total Borrowed Value. A health factor above 1.0 means your position is safe. If it drops to 1.0 or below, your position becomes eligible for liquidation. Aim to keep it above 1.5 for a comfortable margin.",
  },
  {
    question: "What happens during liquidation?",
    answer:
      "When a borrower's health factor falls to 1.0 or below, any user can repay part of the borrower's debt and receive the borrower's collateral at a discount (the liquidation bonus). This mechanism protects the protocol from bad debt and keeps the system solvent.",
  },
  {
    question: "How are interest rates determined?",
    answer:
      "Interest rates are set by a Jump Rate model based on the utilisation rate of each market. When utilisation is low, rates are low to encourage borrowing. As utilisation increases toward the kink (target utilisation, typically 80%), rates rise gradually. Above the kink, rates increase sharply to incentivise repayments and new supply.",
  },
  {
    question: "What is the utilisation rate?",
    answer:
      "The utilisation rate is the percentage of supplied assets currently being borrowed. It is calculated as Total Borrows / (Total Cash + Total Borrows - Total Reserves). High utilisation means most supplied assets are being borrowed, which drives interest rates up.",
  },
  {
    question: "What wallet do I need?",
    answer:
      "You need a browser wallet that supports injected providers, such as MetaMask, Coinbase Wallet, or Rabby. The wallet must be connected to the Sepolia testnet. You will also need Sepolia ETH for gas fees, which you can obtain from a Sepolia faucet.",
  },
  {
    question: "Is this real money?",
    answer:
      "No. DeFinTech is deployed on the Sepolia testnet and uses testnet tokens with no real-world value. It is designed for educational purposes and protocol validation. Never send mainnet assets to testnet addresses.",
  },
  {
    question: "What are cTokens?",
    answer:
      "cTokens (e.g. cETH, cUSDC, cDAI) are ERC-20 tokens that represent your deposited balance in a market. Their exchange rate against the underlying asset increases over time as interest accrues. When you redeem cTokens, you receive the underlying asset at the current exchange rate.",
  },
  {
    question: "What is the close factor?",
    answer:
      "The close factor determines the maximum percentage of a borrower's debt that can be repaid in a single liquidation. It is set to 50%, meaning a liquidator can repay up to half of the outstanding debt per liquidation call.",
  },
];

function FAQAccordion({ item }: { item: FAQItem }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-stone-200 rounded-lg overflow-hidden">
      <button
        type="button"
        className="w-full text-left px-5 py-4 flex items-center justify-between gap-4 hover:bg-stone-50 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <span className="font-medium text-sm text-stone-800">{item.question}</span>
        <span
          className={`text-stone-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>
      {open && (
        <div className="px-5 pb-4 text-sm text-stone-600 leading-relaxed border-t border-stone-100 pt-3">
          {item.answer}
        </div>
      )}
    </div>
  );
}

export default function InfoPage() {
  return (
    <div className="fade-up max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-display text-3xl text-stone-800 mb-2">Protocol Info</h1>
        <p className="text-stone-500 text-sm">
          Key parameters, interest rate mechanics, and answers to common questions about the DeFinTech lending protocol.
        </p>
      </div>

      {/* Protocol Parameters */}
      <section className="mb-8">
        <h2 className="font-display text-xl text-stone-800 mb-4">Protocol Parameters</h2>
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-stone-100">
              <ParamRow label="Network" value="Ethereum Sepolia Testnet (Chain ID 11155111)" />
              <ParamRow label="Close Factor" value="50% — maximum debt repayable per liquidation" />
              <ParamRow label="Interest Model" value="Jump Rate — low rates below kink, sharply rising above" />
              <ParamRow label="Base Rate" value="2% per year" />
              <ParamRow label="Multiplier" value="10% per year (applied linearly up to kink)" />
              <ParamRow label="Jump Multiplier" value="300% per year (applied above kink)" />
              <ParamRow label="Kink" value="80% utilisation — target rate inflection point" />
              <ParamRow label="Reserve Factor" value="10% — portion of interest retained by protocol" />
              <ParamRow label="Oracle" value="MockPriceOracle with admin-set prices" />
              <ParamRow label="Borrow Rate Max" value="0.05% per block — safety ceiling" />
            </tbody>
          </table>
        </div>
      </section>

      {/* Interest Rate Explainer with Chart */}
      <section className="mb-8">
        <h2 className="font-display text-xl text-stone-800 mb-4">How Interest Rates Work</h2>
        <div className="card p-5">
          <div className="space-y-5 text-sm text-stone-600 leading-relaxed">
            <p>
              The protocol uses a <strong className="text-stone-800">Jump Rate interest model</strong> that
              dynamically adjusts borrow and supply rates based on how much of the pool is being borrowed
              (the utilisation rate).
            </p>

            {/* Interactive Chart */}
            <JumpRateChart />

            <div className="grid sm:grid-cols-3 gap-3">
              <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3">
                <div className="font-medium text-emerald-800 mb-1">Low Utilisation</div>
                <div className="text-emerald-700 text-xs">
                  Below 80% — rates increase gradually. Borrowing is cheap, supply yields are modest.
                </div>
              </div>
              <div className="rounded-lg border border-amber-100 bg-amber-50 p-3">
                <div className="font-medium text-amber-800 mb-1">At the Kink (80%)</div>
                <div className="text-amber-700 text-xs">
                  The inflection point. Rates start rising sharply to discourage further borrowing and attract new supply.
                </div>
              </div>
              <div className="rounded-lg border border-rose-100 bg-rose-50 p-3">
                <div className="font-medium text-rose-800 mb-1">High Utilisation</div>
                <div className="text-rose-700 text-xs">
                  Above 80% — the jump multiplier kicks in, making borrowing expensive and supply very attractive.
                </div>
              </div>
            </div>
            <p>
              <strong className="text-stone-800">Supply APY</strong> is derived from the borrow rate: the more
              borrowers pay, the more suppliers earn, minus the protocol&apos;s reserve factor (10%).
            </p>
          </div>
        </div>
      </section>

      {/* Risk Parameters Explainer */}
      <section className="mb-8">
        <h2 className="font-display text-xl text-stone-800 mb-4">Risk Parameters Explained</h2>
        <div className="card p-5">
          <div className="grid sm:grid-cols-2 gap-4 text-sm">
            <div>
              <div className="font-medium text-stone-800 mb-1">Collateral Factor (LTV)</div>
              <p className="text-stone-600 text-xs leading-relaxed">
                The maximum percentage of your collateral value that you can borrow. ETH has a 75% LTV — if
                you supply $1,000 of ETH, you can borrow up to $750.
              </p>
            </div>
            <div>
              <div className="font-medium text-stone-800 mb-1">Liquidation Threshold</div>
              <p className="text-stone-600 text-xs leading-relaxed">
                The collateral ratio at which your position becomes liquidatable. It is slightly higher
                than the collateral factor, giving a small buffer before liquidation.
              </p>
            </div>
            <div>
              <div className="font-medium text-stone-800 mb-1">Liquidation Bonus</div>
              <p className="text-stone-600 text-xs leading-relaxed">
                The discount a liquidator receives on the collateral they seize. A 5% bonus means they
                get $105 of collateral for every $100 of debt they repay.
              </p>
            </div>
            <div>
              <div className="font-medium text-stone-800 mb-1">Health Factor</div>
              <p className="text-stone-600 text-xs leading-relaxed">
                Your position safety score. Above 1.0 is safe, at or below 1.0 triggers liquidation.
                We recommend keeping it above 1.5 for comfort.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="mb-8">
        <h2 className="font-display text-xl text-stone-800 mb-4">Frequently Asked Questions</h2>
        <div className="grid gap-2">
          {FAQ_ITEMS.map((item, index) => (
            <FAQAccordion key={index} item={item} />
          ))}
        </div>
      </section>

      {/* Useful Links */}
      <section className="mb-8">
        <h2 className="font-display text-xl text-stone-800 mb-4">Useful Links</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <a
            href="https://sepolia.etherscan.io"
            target="_blank"
            rel="noopener noreferrer"
            className="card p-4 hover:shadow-md transition-shadow group"
          >
            <div className="font-medium text-stone-800 mb-1 group-hover:text-emerald-700">
              Sepolia Etherscan
            </div>
            <div className="text-xs text-stone-500">
              View transactions, contract code, and on-chain state.
            </div>
          </a>
          <a
            href="https://sepoliafaucet.com"
            target="_blank"
            rel="noopener noreferrer"
            className="card p-4 hover:shadow-md transition-shadow group"
          >
            <div className="font-medium text-stone-800 mb-1 group-hover:text-emerald-700">
              Sepolia Faucet
            </div>
            <div className="text-xs text-stone-500">
              Get free Sepolia ETH for gas fees and testing.
            </div>
          </a>
          <a
            href="https://metamask.io"
            target="_blank"
            rel="noopener noreferrer"
            className="card p-4 hover:shadow-md transition-shadow group"
          >
            <div className="font-medium text-stone-800 mb-1 group-hover:text-emerald-700">
              MetaMask
            </div>
            <div className="text-xs text-stone-500">
              Popular browser wallet for interacting with Ethereum dApps.
            </div>
          </a>
          <a
            href="https://ethereum.org/en/developers/docs/smart-contracts/"
            target="_blank"
            rel="noopener noreferrer"
            className="card p-4 hover:shadow-md transition-shadow group"
          >
            <div className="font-medium text-stone-800 mb-1 group-hover:text-emerald-700">
              Smart Contracts — Ethereum Docs
            </div>
            <div className="text-xs text-stone-500">
              Learn about smart contracts and how DeFi protocols work.
            </div>
          </a>
        </div>
      </section>
    </div>
  );
}

// ── Jump Rate Chart (pure SVG, no external deps) ──────────────────────
const BASE_RATE = 0.02;
const MULTIPLIER = 0.10;
const JUMP_MULTIPLIER = 3.0;
const KINK = 0.80;
const RESERVE_FACTOR = 0.10;

function borrowRate(u: number): number {
  if (u <= KINK) {
    return BASE_RATE + MULTIPLIER * u;
  }
  const normalRate = BASE_RATE + MULTIPLIER * KINK;
  return normalRate + JUMP_MULTIPLIER * (u - KINK);
}

function supplyRate(u: number): number {
  return borrowRate(u) * u * (1 - RESERVE_FACTOR);
}

function JumpRateChart() {
  const [hover, setHover] = useState<number | null>(null);

  const STEPS = 200;
  const W = 600;
  const H = 280;
  const PAD = { top: 20, right: 20, bottom: 40, left: 55 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const maxRate = useMemo(() => {
    let m = 0;
    for (let i = 0; i <= STEPS; i++) {
      const u = i / STEPS;
      m = Math.max(m, borrowRate(u));
    }
    return Math.ceil(m * 100) / 100;
  }, []);

  const borrowPath = useMemo(() => {
    const pts: string[] = [];
    for (let i = 0; i <= STEPS; i++) {
      const u = i / STEPS;
      const x = PAD.left + u * plotW;
      const y = PAD.top + plotH - (borrowRate(u) / maxRate) * plotH;
      pts.push(`${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`);
    }
    return pts.join(" ");
  }, [maxRate, plotW, plotH]);

  const supplyPath = useMemo(() => {
    const pts: string[] = [];
    for (let i = 0; i <= STEPS; i++) {
      const u = i / STEPS;
      const x = PAD.left + u * plotW;
      const y = PAD.top + plotH - (supplyRate(u) / maxRate) * plotH;
      pts.push(`${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`);
    }
    return pts.join(" ");
  }, [maxRate, plotW, plotH]);

  const kinkX = PAD.left + KINK * plotW;

  const hoverU = hover !== null ? Math.max(0, Math.min(1, hover)) : null;
  const hoverX = hoverU !== null ? PAD.left + hoverU * plotW : null;
  const hoverBorrow = hoverU !== null ? borrowRate(hoverU) : null;
  const hoverSupply = hoverU !== null ? supplyRate(hoverU) : null;
  const hoverBorrowY = hoverBorrow !== null ? PAD.top + plotH - (hoverBorrow / maxRate) * plotH : null;
  const hoverSupplyY = hoverSupply !== null ? PAD.top + plotH - (hoverSupply / maxRate) * plotH : null;

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const svgX = (x / rect.width) * W;
    const u = (svgX - PAD.left) / plotW;
    if (u >= 0 && u <= 1) {
      setHover(u);
    } else {
      setHover(null);
    }
  }

  const yTicks = useMemo(() => {
    const ticks: number[] = [];
    const step = maxRate > 0.5 ? 0.1 : 0.05;
    for (let v = 0; v <= maxRate + 0.001; v += step) {
      ticks.push(Math.round(v * 1000) / 1000);
    }
    return ticks;
  }, [maxRate]);

  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 p-4">
      <div className="flex items-center gap-4 mb-3 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-0.5 rounded bg-amber-500" />
          <span className="text-stone-600">Borrow Rate</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-0.5 rounded bg-emerald-500" />
          <span className="text-stone-600">Supply Rate</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-px border-t border-dashed border-stone-400" style={{ width: 12 }} />
          <span className="text-stone-500">Kink (80%)</span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ maxHeight: 320 }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* Grid lines */}
        {yTicks.map((v) => {
          const y = PAD.top + plotH - (v / maxRate) * plotH;
          return (
            <g key={v}>
              <line x1={PAD.left} x2={PAD.left + plotW} y1={y} y2={y} stroke="#e7e5e4" strokeWidth={0.5} />
              <text x={PAD.left - 8} y={y + 3.5} textAnchor="end" className="fill-stone-400" fontSize={10}>
                {(v * 100).toFixed(0)}%
              </text>
            </g>
          );
        })}

        {/* X-axis ticks */}
        {[0, 20, 40, 60, 80, 100].map((pct) => {
          const x = PAD.left + (pct / 100) * plotW;
          return (
            <text key={pct} x={x} y={H - 8} textAnchor="middle" className="fill-stone-400" fontSize={10}>
              {pct}%
            </text>
          );
        })}

        {/* Axis labels */}
        <text x={PAD.left + plotW / 2} y={H} textAnchor="middle" className="fill-stone-500" fontSize={11} fontWeight={500}>
          Utilisation Rate
        </text>
        <text
          x={12}
          y={PAD.top + plotH / 2}
          textAnchor="middle"
          className="fill-stone-500"
          fontSize={11}
          fontWeight={500}
          transform={`rotate(-90, 12, ${PAD.top + plotH / 2})`}
        >
          Interest Rate
        </text>

        {/* Kink dashed line */}
        <line
          x1={kinkX} x2={kinkX}
          y1={PAD.top} y2={PAD.top + plotH}
          stroke="#a8a29e" strokeWidth={1} strokeDasharray="4,3"
        />

        {/* Supply rate curve */}
        <path d={supplyPath} fill="none" stroke="#10b981" strokeWidth={2.5} strokeLinecap="round" />

        {/* Borrow rate curve */}
        <path d={borrowPath} fill="none" stroke="#f59e0b" strokeWidth={2.5} strokeLinecap="round" />

        {/* Hover crosshair + dots */}
        {hoverX !== null && hoverBorrowY !== null && hoverSupplyY !== null && hoverU !== null && (
          <>
            <line x1={hoverX} x2={hoverX} y1={PAD.top} y2={PAD.top + plotH} stroke="#78716c" strokeWidth={0.5} strokeDasharray="3,2" />
            <circle cx={hoverX} cy={hoverBorrowY} r={4} fill="#f59e0b" stroke="white" strokeWidth={1.5} />
            <circle cx={hoverX} cy={hoverSupplyY} r={4} fill="#10b981" stroke="white" strokeWidth={1.5} />
          </>
        )}
      </svg>

      {/* Hover tooltip below chart */}
      <div className="h-6 mt-1 text-xs text-center text-stone-500">
        {hoverU !== null && hoverBorrow !== null && hoverSupply !== null ? (
          <span>
            Utilisation <strong className="text-stone-700">{(hoverU * 100).toFixed(1)}%</strong>
            {" — "}
            Borrow <strong className="text-amber-600">{(hoverBorrow * 100).toFixed(2)}%</strong>
            {" — "}
            Supply <strong className="text-emerald-600">{(hoverSupply * 100).toFixed(2)}%</strong>
          </span>
        ) : (
          <span className="text-stone-400">Hover over the chart to see rates at any utilisation level</span>
        )}
      </div>
    </div>
  );
}

function ParamRow({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td className="px-5 py-3 font-medium text-stone-800 whitespace-nowrap">{label}</td>
      <td className="px-5 py-3 text-stone-600">{value}</td>
    </tr>
  );
}
