"use client";
// components/TxButton.tsx
// A button that shows pending/loading states during a transaction

interface TxButtonProps {
  label: string;
  pendingLabel?: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: "primary" | "danger" | "outline";
  fullWidth?: boolean;
}

export default function TxButton({
  label,
  pendingLabel = "Confirming…",
  onClick,
  disabled,
  loading,
  variant = "primary",
  fullWidth = true,
}: TxButtonProps) {
  const variantClass = {
    primary: "btn-primary",
    danger: "btn-danger",
    outline: "btn-outline",
  }[variant];

  return (
    <button
      className={`btn ${variantClass} ${fullWidth ? "w-full" : ""} text-base py-3`}
      onClick={onClick}
      disabled={disabled || loading}
    >
      {loading ? (
        <span className="flex items-center justify-center gap-2">
          <svg
            className="animate-spin"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          {pendingLabel}
        </span>
      ) : (
        label
      )}
    </button>
  );
}
