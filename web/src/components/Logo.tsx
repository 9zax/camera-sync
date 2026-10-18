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
        <linearGradient id="cs-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#A0685F" />
          <stop offset="1" stopColor="#7E4E49" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="118" fill="url(#cs-bg)" />
      <circle cx="256" cy="252" r="122" fill="none" stroke="#FAF7F2" strokeWidth="24" />
      <circle cx="352" cy="180" r="26" fill="#E9C46A" />
      <path
        fill="#FAF7F2"
        d="M256 316 C 212 283 186 258 186 228 C 186 206 203 190 224 190 C 238 190 249 197 256 209 C 263 197 274 190 288 190 C 309 190 326 206 326 228 C 326 258 300 283 256 316 Z"
      />
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
