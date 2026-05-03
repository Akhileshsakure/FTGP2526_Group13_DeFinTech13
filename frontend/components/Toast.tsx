"use client";
// components/Toast.tsx
import { useEffect } from "react";

type ToastType = "success" | "error" | "pending";

interface ToastProps {
  message: string;
  type: ToastType;
  txHash?: string;
  onClose: () => void;
  duration?: number;
}

export default function Toast({
  message,
  type,
  txHash,
  onClose,
  duration = 6000,
}: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [onClose, duration]);

  const typeClass = {
    success: "toast-success",
    error: "toast-error",
    pending: "toast-pending",
  }[type];

  const icon = {
    success: "✓",
    error: "✕",
    pending: "⋯",
  }[type];

  return (
    <div className={`toast ${typeClass}`}>
      <div className="flex items-start gap-3">
        <span className="font-bold text-base mt-0.5">{icon}</span>
        <div className="flex-1">
          <p>{message}</p>
          {txHash && (
            <a
              href={`https://sepolia.etherscan.io/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs underline opacity-75 mt-1 inline-block"
            >
              View on Etherscan ↗
            </a>
          )}
        </div>
        <button
          onClick={onClose}
          className="opacity-60 hover:opacity-100 text-lg leading-none"
        >
          ×
        </button>
      </div>
    </div>
  );
}

// ── Hook to manage toasts ─────────────────────────────────────
import { useRef, useState, useCallback } from "react";

interface ToastState {
  id: number;
  message: string;
  type: ToastType;
  txHash?: string;
}

export function useToast() {
  const [toasts, setToasts] = useState<ToastState[]>([]);
  const nextId = useRef(0);

  const addToast = useCallback(
    (message: string, type: ToastType, txHash?: string) => {
      nextId.current += 1;
      const id = Date.now() * 1000 + nextId.current;
      setToasts((prev) => [...prev, { id, message, type, txHash }]);
    },
    []
  );

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, addToast, removeToast };
}
