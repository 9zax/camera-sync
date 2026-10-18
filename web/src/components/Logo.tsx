import { cn } from "@/lib/utils"

/** CameraSync brand mark (canonical: assets/logo.svg) — inline so it can
 *  scale to any size and inherit layout without a network fetch. */
export function LogoMark({
  size = 36,
  className,
}: {
  size?: number
  className?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      role="img"
      aria-label="CameraSync"
      className={cn("shrink-0", className)}
    >
      <defs>
        <linearGradient id="csBg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2B231B" />
          <stop offset="1" stopColor="#130F0B" />
        </linearGradient>
        <radialGradient id="csGlow" cx="0.3" cy="0.2" r="0.85">
          <stop offset="0" stopColor="#F0C97E" stopOpacity="0.3" />
          <stop offset="1" stopColor="#F0C97E" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="csGold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F6D488" />
          <stop offset="0.5" stopColor="#E2B15C" />
          <stop offset="1" stopColor="#B98A3F" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="118" fill="url(#csBg)" />
      <rect width="512" height="512" rx="118" fill="url(#csGlow)" />
      <circle cx="256" cy="256" r="128" fill="none" stroke="url(#csGold)" strokeWidth="26" strokeLinecap="round" strokeDasharray="94 40" strokeDashoffset="20" />
      <path
        fill="url(#csGold)"
        d="M256 312 C 214 280 190 256 190 228 C 190 206 207 191 227 191 C 240 191 251 198 256 208 C 261 198 272 191 285 191 C 305 191 322 206 322 228 C 322 256 298 280 256 312 Z"
      />
      <circle cx="347" cy="165" r="24" fill="#5FBDBD" />
    </svg>
  )
}

export function Logo({ size = 38, textClass }: { size?: number; textClass?: string }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark size={size} />
      <span className={cn("font-display text-xl font-semibold tracking-tight", textClass)}>
        CameraSync
      </span>
    </span>
  )
}
