"use client";

import Link from "next/link";
import TransactionHistoryPanel from "../../components/TransactionHistoryPanel";

export default function TransactionsPage() {
  return (
    <div className="fade-up">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl text-stone-800 mb-1">Transaction History</h1>
          <p className="text-stone-500 text-sm">Transactions now live on the Dashboard.</p>
        </div>
        <Link href="/dashboard" className="btn btn-primary text-sm py-2 px-4 w-fit">
          Dashboard
        </Link>
      </div>
      <TransactionHistoryPanel />
    </div>
  );
}
