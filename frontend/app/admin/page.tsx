"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import TxButton from "../../components/TxButton";
import Toast, { useToast } from "../../components/Toast";
import { useWallet } from "../../context/WalletContext";
import {
  adminSetCloseFactor,
  adminSetInterestRateParams,
  adminSetInterestRateStrategy,
  adminSetMarketCaps,
  adminSetMarketPause,
  adminSetMarketRiskParameters,
  adminSetPriceOracle,
  adminSetReserveFactor,
  fetchAdminProtocolState,
  fetchInterestRateParams,
  formatTokenSmart,
  getTransactionErrorMessage,
  type AdminMarketState,
  type AdminProtocolState,
  type InterestRateParams,
} from "../../lib/protocol";

type AdminAction =
  | "risk"
  | "caps"
  | "pause"
  | "closeFactor"
  | "oracle"
  | "reserveFactor"
  | "strategy"
  | "rateParams";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export default function AdminPage() {
  const { account, isConnected, isCorrectNetwork } = useWallet();
  const { toasts, addToast, removeToast } = useToast();
  const [state, setState] = useState<AdminProtocolState | null>(null);
  const [selectedMarketId, setSelectedMarketId] = useState("");
  const [rateParams, setRateParams] = useState<InterestRateParams | null>(null);
  const [loading, setLoading] = useState(true);
  const [txLoading, setTxLoading] = useState<AdminAction | null>(null);

  const [ltv, setLtv] = useState("");
  const [liquidationThreshold, setLiquidationThreshold] = useState("");
  const [liquidationBonus, setLiquidationBonus] = useState("");
  const [supplyCap, setSupplyCap] = useState("");
  const [borrowCap, setBorrowCap] = useState("");
  const [closeFactor, setCloseFactor] = useState("");
  const [oracleAddress, setOracleAddress] = useState("");
  const [reserveFactor, setReserveFactor] = useState("");
  const [strategyAddress, setStrategyAddress] = useState("");
  const [baseRate, setBaseRate] = useState("");
  const [multiplier, setMultiplier] = useState("");
  const [jumpMultiplier, setJumpMultiplier] = useState("");
  const [kink, setKink] = useState("");

  const loadState = useCallback(async () => {
    setLoading(true);
    try {
      const protocolState = await fetchAdminProtocolState();
      setState(protocolState);
      setOracleAddress(protocolState.oracle);
      setCloseFactor(formatPercentInput(protocolState.closeFactor));

      const firstMarket = protocolState.markets[0];
      if (firstMarket && !selectedMarketId) {
        setSelectedMarketId(firstMarket.market.id);
      }
    } catch (err: unknown) {
      addToast(getTransactionErrorMessage(err), "error");
      setState(null);
    } finally {
      setLoading(false);
    }
  }, [addToast, selectedMarketId]);

  useEffect(() => {
    loadState();
  }, [loadState]);

  const selectedMarket = useMemo(
    () => state?.markets.find((item) => item.market.id === selectedMarketId) ?? null,
    [state, selectedMarketId]
  );

  useEffect(() => {
    if (!selectedMarket) return;
    setLtv(formatPercentInput(selectedMarket.ltv));
    setLiquidationThreshold(formatPercentInput(selectedMarket.liquidationThreshold));
    setLiquidationBonus(formatPercentInput(selectedMarket.liquidationBonus));
    setSupplyCap(formatCapInput(selectedMarket.supplyCap, selectedMarket));
    setBorrowCap(formatCapInput(selectedMarket.borrowCap, selectedMarket));
    setReserveFactor(formatPercentInput(selectedMarket.reserveFactor));
    setStrategyAddress(selectedMarket.interestRateStrategy);
  }, [selectedMarket]);

  useEffect(() => {
    let cancelled = false;
    const loadParams = async () => {
      if (!strategyAddress || strategyAddress === ZERO_ADDRESS) {
        setRateParams(null);
        return;
      }
      try {
        const params = await fetchInterestRateParams(strategyAddress);
        if (cancelled) return;
        setRateParams(params);
        setBaseRate(formatPercentInput(params.baseRatePerYear));
        setMultiplier(formatPercentInput(params.multiplierPerYear));
        setJumpMultiplier(formatPercentInput(params.jumpMultiplierPerYear));
        setKink(formatPercentInput(params.kink));
      } catch {
        if (!cancelled) setRateParams(null);
      }
    };
    loadParams();
    return () => {
      cancelled = true;
    };
  }, [strategyAddress]);

  const isAdmin =
    Boolean(account && state?.admin) &&
    account!.toLowerCase() === state!.admin.toLowerCase();

  const runAdminTx = async (
    action: AdminAction,
    tx: () => Promise<{ hash?: string } | null>
  ) => {
    setTxLoading(action);
    try {
      addToast("Confirm transaction in MetaMask...", "pending");
      const receipt = await tx();
      addToast("Admin transaction confirmed.", "success", receipt?.hash);
      await loadState();
    } catch (err: unknown) {
      addToast(getTransactionErrorMessage(err), "error");
    } finally {
      setTxLoading(null);
    }
  };

  const disabled = !isConnected || !isCorrectNetwork || !isAdmin || loading;

  return (
    <div className="fade-up">
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          message={toast.message}
          type={toast.type}
          txHash={toast.txHash}
          onClose={() => removeToast(toast.id)}
        />
      ))}

      <div className="mb-6">
        <h1 className="font-display text-3xl text-stone-800 mb-1">Admin</h1>
        <p className="text-stone-500 text-sm">
          Configure on-chain risk controls, market caps, reserve settings and interest rates
        </p>
      </div>

      {!isConnected && (
        <Notice tone="amber" text="Connect the admin wallet before using this page." />
      )}
      {isConnected && !isCorrectNetwork && (
        <Notice tone="rose" text="Switch to Sepolia before sending admin transactions." />
      )}
      {isConnected && isCorrectNetwork && state && !isAdmin && (
        <Notice
          tone="rose"
          text="Access denied. This page is restricted to the on-chain Comptroller admin wallet."
        />
      )}

      {isConnected && isCorrectNetwork && state && !isAdmin && (
        <section className="card p-5 max-w-xl">
          <h2 className="font-display text-xl text-stone-800 mb-3">Admin Only</h2>
          <div className="space-y-3 text-sm text-stone-600">
            <p>
              The connected wallet cannot use protocol administration functions.
            </p>
            <AddressRow label="Required Admin" value={state.admin} />
            <AddressRow label="Connected Wallet" value={account ?? "-"} />
          </div>
        </section>
      )}

      {isAdmin && (
      <div className="grid lg:grid-cols-[260px_1fr] gap-4">
        <section className="card p-5 h-fit">
          <div className="stat-label mb-3">Protocol Admin</div>
          {loading ? (
            <div className="space-y-3">
              <div className="skeleton h-4 w-full" />
              <div className="skeleton h-4 w-2/3" />
            </div>
          ) : state ? (
            <div className="space-y-4">
              <AddressRow label="Comptroller" value={state.admin} />
              <AddressRow label="Pending Admin" value={state.pendingAdmin} />
              <AddressRow label="Oracle" value={state.oracle} />
              <div>
                <div className="stat-label mb-1">Close Factor</div>
                <div className="font-mono text-sm text-stone-700">{state.closeFactor.toFixed(2)}%</div>
              </div>
              <div>
                <label className="stat-label mb-2 block">Market</label>
                <select
                  className="input text-sm font-body"
                  value={selectedMarketId}
                  onChange={(event) => setSelectedMarketId(event.target.value)}
                >
                  {state.markets.map((item) => (
                    <option key={item.market.id} value={item.market.id}>
                      {item.market.symbol}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <div className="text-sm text-stone-500">Admin state could not be loaded.</div>
          )}
        </section>

        <section className="space-y-4">
          {selectedMarket && (
            <>
              <MarketStatus state={selectedMarket} />

              <div className="grid md:grid-cols-2 gap-4">
                <AdminPanel title="Risk Parameters">
                  <Field label="LTV (%)" value={ltv} onChange={setLtv} />
                  <Field
                    label="Liquidation Threshold (%)"
                    value={liquidationThreshold}
                    onChange={setLiquidationThreshold}
                  />
                  <Field
                    label="Liquidation Bonus (%)"
                    value={liquidationBonus}
                    onChange={setLiquidationBonus}
                  />
                  <TxButton
                    label="Update Risk Parameters"
                    loading={txLoading === "risk"}
                    disabled={disabled}
                    onClick={() =>
                      runAdminTx("risk", () =>
                        adminSetMarketRiskParameters(
                          selectedMarket.market,
                          ltv,
                          liquidationThreshold,
                          liquidationBonus
                        )
                      )
                    }
                  />
                </AdminPanel>

                <AdminPanel title="Market Caps">
                  <Field label="Supply Cap" value={supplyCap} onChange={setSupplyCap} />
                  <Field label="Borrow Cap" value={borrowCap} onChange={setBorrowCap} />
                  <p className="text-xs text-stone-500">Use MAX for an unlimited cap.</p>
                  <TxButton
                    label="Update Caps"
                    loading={txLoading === "caps"}
                    disabled={disabled}
                    onClick={() =>
                      runAdminTx("caps", () =>
                        adminSetMarketCaps(selectedMarket.market, supplyCap, borrowCap)
                      )
                    }
                  />
                </AdminPanel>

                <AdminPanel title="Emergency Pause">
                  <div className="flex items-center justify-between rounded border border-stone-200 p-3">
                    <div>
                      <div className="text-sm font-medium text-stone-700">Current Status</div>
                      <div className={selectedMarket.isPaused ? "text-rose-600" : "text-emerald-600"}>
                        {selectedMarket.isPaused ? "Paused" : "Active"}
                      </div>
                    </div>
                    <TxButton
                      label={selectedMarket.isPaused ? "Resume Market" : "Pause Market"}
                      variant={selectedMarket.isPaused ? "primary" : "danger"}
                      fullWidth={false}
                      loading={txLoading === "pause"}
                      disabled={disabled}
                      onClick={() =>
                        runAdminTx("pause", () =>
                          adminSetMarketPause(selectedMarket.market, !selectedMarket.isPaused)
                        )
                      }
                    />
                  </div>
                </AdminPanel>

                <AdminPanel title="Reserve And Strategy">
                  <Field label="Reserve Factor (%)" value={reserveFactor} onChange={setReserveFactor} />
                  <TxButton
                    label="Update Reserve Factor"
                    loading={txLoading === "reserveFactor"}
                    disabled={disabled}
                    onClick={() =>
                      runAdminTx("reserveFactor", () =>
                        adminSetReserveFactor(selectedMarket.market, reserveFactor)
                      )
                    }
                  />
                  <Field
                    label="Interest Strategy Address"
                    value={strategyAddress}
                    onChange={setStrategyAddress}
                    mono
                  />
                  <TxButton
                    label="Set Strategy For Market"
                    loading={txLoading === "strategy"}
                    disabled={disabled}
                    onClick={() =>
                      runAdminTx("strategy", () =>
                        adminSetInterestRateStrategy(selectedMarket.market, strategyAddress)
                      )
                    }
                  />
                </AdminPanel>

                <AdminPanel title="Interest Rate Parameters">
                  {rateParams && <AddressRow label="Strategy Owner" value={rateParams.owner} />}
                  <Field label="Base Rate Per Year (%)" value={baseRate} onChange={setBaseRate} />
                  <Field label="Multiplier Per Year (%)" value={multiplier} onChange={setMultiplier} />
                  <Field
                    label="Jump Multiplier Per Year (%)"
                    value={jumpMultiplier}
                    onChange={setJumpMultiplier}
                  />
                  <Field label="Kink (%)" value={kink} onChange={setKink} />
                  <TxButton
                    label="Update Interest Parameters"
                    loading={txLoading === "rateParams"}
                    disabled={disabled || !strategyAddress}
                    onClick={() =>
                      runAdminTx("rateParams", () =>
                        adminSetInterestRateParams(
                          strategyAddress,
                          baseRate,
                          multiplier,
                          jumpMultiplier,
                          kink
                        )
                      )
                    }
                  />
                </AdminPanel>

                <AdminPanel title="Global Settings">
                  <Field label="Close Factor (%)" value={closeFactor} onChange={setCloseFactor} />
                  <TxButton
                    label="Update Close Factor"
                    loading={txLoading === "closeFactor"}
                    disabled={disabled}
                    onClick={() =>
                      runAdminTx("closeFactor", () => adminSetCloseFactor(closeFactor))
                    }
                  />
                  <Field label="Oracle Address" value={oracleAddress} onChange={setOracleAddress} mono />
                  <TxButton
                    label="Set Price Oracle"
                    loading={txLoading === "oracle"}
                    disabled={disabled}
                    onClick={() => runAdminTx("oracle", () => adminSetPriceOracle(oracleAddress))}
                  />
                </AdminPanel>

              </div>
            </>
          )}
        </section>
      </div>
      )}
    </div>
  );
}

function AdminPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <h2 className="font-display text-lg text-stone-800 mb-4">{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  mono = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  mono?: boolean;
}) {
  return (
    <label className="block">
      <span className="stat-label mb-1 block">{label}</span>
      <input
        className={`input text-sm ${mono ? "font-mono" : "font-body"}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function AddressRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="stat-label mb-1">{label}</div>
      <div className="font-mono text-xs text-stone-700 break-all">{value}</div>
    </div>
  );
}

function MarketStatus({ state }: { state: AdminMarketState }) {
  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="font-display text-xl text-stone-800">{state.market.symbol}</h2>
          <p className="text-sm text-stone-500">{state.market.cTokenAddress}</p>
        </div>
        <span className={`badge ${state.isPaused ? "badge-red" : "badge-green"}`}>
          {state.isPaused ? "Paused" : "Active"}
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Metric label="LTV" value={`${state.ltv.toFixed(2)}%`} />
        <Metric label="Liquidation Threshold" value={`${state.liquidationThreshold.toFixed(2)}%`} />
        <Metric label="Reserve Factor" value={`${state.reserveFactor.toFixed(2)}%`} />
        <Metric label="Liquidation Bonus" value={`${state.liquidationBonus.toFixed(2)}%`} />
        <Metric label="Supply Cap" value={formatCapDisplay(state.supplyCap, state)} />
        <Metric label="Borrow Cap" value={formatCapDisplay(state.borrowCap, state)} />
        <Metric label="Listed" value={state.isListed ? "Yes" : "No"} />
        <Metric label="Strategy" value={shortAddress(state.interestRateStrategy)} />
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="stat-label mb-1">{label}</div>
      <div className="font-mono text-sm text-stone-700 break-words">{value}</div>
    </div>
  );
}

function Notice({ tone, text }: { tone: "amber" | "rose"; text: string }) {
  const classes =
    tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-rose-200 bg-rose-50 text-rose-700";
  return <div className={`card p-4 text-sm mb-4 ${classes}`}>{text}</div>;
}

function formatPercentInput(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2).replace(/\.?0+$/, "") : "";
}

function formatCapInput(value: bigint, state: AdminMarketState): string {
  if (value > 10n ** 40n) return "MAX";
  return formatUnitsForInput(value, state.market.decimals);
}

function formatCapDisplay(value: bigint, state: AdminMarketState): string {
  if (value > 10n ** 40n) return "Unlimited";
  return formatTokenSmart(
    Number(value) / 10 ** state.market.decimals,
    state.market.symbol,
    state.market.decimals <= 6 ? 2 : 4
  );
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatUnitsForInput(value: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = value % base;
  if (fraction === 0n) return whole.toString();
  const fractionText = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}.${fractionText}`;
}
