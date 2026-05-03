// components/CryptoIcon.tsx — Inline SVG crypto logos
interface CryptoIconProps {
  symbol: string;
  size?: number;
  className?: string;
}

export default function CryptoIcon({ symbol, size = 24, className = "" }: CryptoIconProps) {
  const s = symbol.toUpperCase();
  return (
    <span className={`inline-flex items-center justify-center shrink-0 ${className}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 32 32" width={size} height={size} fill="none" xmlns="http://www.w3.org/2000/svg">
        {ICONS[s] ?? <FallbackIcon letter={symbol[0] ?? "?"} />}
      </svg>
    </span>
  );
}

function FallbackIcon({ letter }: { letter: string }) {
  return (
    <>
      <circle cx="16" cy="16" r="16" fill="#d6d3d1" />
      <text x="16" y="21" textAnchor="middle" fontSize="14" fontWeight="700" fill="#57534e">{letter}</text>
    </>
  );
}

const ICONS: Record<string, React.ReactNode> = {
  ETH: (
    <>
      <circle cx="16" cy="16" r="16" fill="#627EEA" />
      <path d="M16.498 4v8.87l7.497 3.35L16.498 4z" fill="#fff" fillOpacity=".602" />
      <path d="M16.498 4L9 16.22l7.498-3.35V4z" fill="#fff" />
      <path d="M16.498 21.968v6.027L24 17.616l-7.502 4.352z" fill="#fff" fillOpacity=".602" />
      <path d="M16.498 27.995v-6.028L9 17.616l7.498 10.379z" fill="#fff" />
      <path d="M16.498 20.573l7.497-4.353-7.497-3.348v7.701z" fill="#fff" fillOpacity=".2" />
      <path d="M9 16.22l7.498 4.353v-7.701L9 16.22z" fill="#fff" fillOpacity=".602" />
    </>
  ),
  WETH: (
    <>
      <circle cx="16" cy="16" r="16" fill="#627EEA" />
      <path d="M16.498 4v8.87l7.497 3.35L16.498 4z" fill="#fff" fillOpacity=".602" />
      <path d="M16.498 4L9 16.22l7.498-3.35V4z" fill="#fff" />
      <path d="M16.498 21.968v6.027L24 17.616l-7.502 4.352z" fill="#fff" fillOpacity=".602" />
      <path d="M16.498 27.995v-6.028L9 17.616l7.498 10.379z" fill="#fff" />
      <path d="M16.498 20.573l7.497-4.353-7.497-3.348v7.701z" fill="#fff" fillOpacity=".2" />
      <path d="M9 16.22l7.498 4.353v-7.701L9 16.22z" fill="#fff" fillOpacity=".602" />
      <circle cx="24" cy="8" r="6" fill="#EC4899" />
      <text x="24" y="11" textAnchor="middle" fontSize="8" fontWeight="700" fill="#fff">W</text>
    </>
  ),
  USDC: (
    <>
      <circle cx="16" cy="16" r="16" fill="#2775CA" />
      <path d="M20.2 18.6c0-2.1-1.3-2.8-3.8-3.1-1.8-.3-2.2-.7-2.2-1.5s.7-1.3 1.8-1.3c1 0 1.6.4 1.9 1.2.1.1.2.2.3.2h.7c.2 0 .3-.1.3-.3v-.1c-.3-1.1-1.2-2-2.4-2.2v-1.3c0-.2-.1-.3-.3-.3h-.6c-.2 0-.3.1-.3.3v1.3c-1.6.2-2.7 1.3-2.7 2.7 0 2 1.2 2.7 3.7 3 1.7.3 2.3.7 2.3 1.6 0 .9-.8 1.5-2 1.5-1.5 0-2-.6-2.2-1.3-.1-.2-.2-.2-.3-.2h-.8c-.2 0-.3.1-.3.3v.1c.3 1.3 1.2 2.1 2.8 2.4v1.3c0 .2.1.3.3.3h.6c.2 0 .3-.1.3-.3v-1.3c1.7-.3 2.8-1.4 2.8-2.8z" fill="#fff" />
      <path d="M13.1 24.5c-4.5-1.6-6.8-6.5-5.3-11 .8-2.3 2.6-4 4.9-4.9.2-.1.3-.2.3-.4v-.6c0-.2-.1-.3-.3-.3h-.1c-5.2 1.6-8 7.1-6.4 12.2.9 3 3.3 5.3 6.3 6.3.2.1.4 0 .4-.2v-.6c.1-.3 0-.4-.2-.5h.4zm5.8-20c-.2-.1-.4 0-.4.2v.6c0 .2.1.4.3.4 4.5 1.6 6.8 6.5 5.3 11-.8 2.3-2.6 4-4.9 4.9-.2.1-.3.2-.3.4v.6c0 .2.1.3.3.3h.1c5.2-1.6 8-7.1 6.4-12.2-1-3-3.3-5.3-6.4-6.3h.4.1-.9z" fill="#fff" />
    </>
  ),
  DAI: (
    <>
      <circle cx="16" cy="16" r="16" fill="#F5AC37" />
      <path d="M17.2 9h4.3v1.4h-1.4l1.8 4.3h-2.4L17.7 11h-.5V9zm-2.4 0H10.5v1.4h1.4l-1.8 4.3h2.4L14.3 11h.5V9z" fill="#fff" />
      <path d="M9 15.7h14v1.6H9v-1.6zm0 3h14v1.6H9v-1.6z" fill="#fff" fillOpacity=".6" />
      <path d="M17.2 23h4.3v-1.4h-1.4l1.8-4.3h-2.4L17.7 21h-.5v2zm-2.4 0H10.5v-1.4h1.4l-1.8-4.3h2.4L14.3 21h.5v2z" fill="#fff" />
    </>
  ),
  WBTC: (
    <>
      <circle cx="16" cy="16" r="16" fill="#F09242" />
      <circle cx="16" cy="16" r="12.5" fill="#282138" />
      <path d="M20.8 13.7c.3-1.8-1.1-2.7-3-3.4l.6-2.5-1.5-.4-.6 2.4c-.4-.1-.8-.2-1.2-.3l.6-2.4-1.5-.4-.6 2.5c-.3-.1-.6-.1-1-.2l-2-.5-.4 1.6s1.1.3 1.1.3c.6.2.7.6.7 1l-.7 2.8c0 .1.1.1.1.1l-.1-.1-1 4c-.1.2-.3.5-.7.4 0 0-1.1-.3-1.1-.3L8 18.3l1.9.5c.4.1.7.2 1.1.3l-.6 2.5 1.5.4.6-2.5c.4.1.8.2 1.2.3l-.6 2.5 1.5.4.6-2.5c2.6.5 4.6.3 5.4-2.1.7-1.9 0-3-1.4-3.7 1-.2 1.8-1 2-2.4zM19 18.8c-.5 2-3.9.9-5 .7l.9-3.6c1.1.3 4.6.8 4.1 2.9zm.5-4.4c-.5 1.8-3.3.9-4.2.7l.8-3.2c1 .2 3.9.7 3.4 2.5z" fill="#F09242" />
    </>
  ),
  USDT: (
    <>
      <circle cx="16" cy="16" r="16" fill="#26A17B" />
      <path fillRule="evenodd" clipRule="evenodd" d="M17.9 17.2v-.1c-.1 0-1 .1-2 .1-.8 0-1.6 0-1.9-.1V17.2c-3.3-.2-5.7-.8-5.7-1.5 0-.8 2.4-1.4 5.7-1.5v2.4c.3 0 1.1.1 1.9.1 1 0 1.8-.1 2-.1v-2.4c3.3.2 5.7.8 5.7 1.5 0 .8-2.5 1.4-5.7 1.5zm0-3.3V11.7h4.5V8.7H9.7v3h4.5v2.2c-3.7.2-6.5 1-6.5 2 0 1 2.8 1.8 6.5 2v7.2h3.7V18c3.7-.2 6.5-1 6.5-2s-2.8-1.8-6.5-2z" fill="#fff" />
    </>
  ),
};
