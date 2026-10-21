import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { createWallRenderer } from "@/lib/wallGL"
import { easeInOut, pickTransition } from "@/lib/wallTransitions"

/**
 * Live Wall demo for the landing page: the projector wall itself, running on
 * stock photographs. Same renderer and transition set as `/e/{slug}/wall`, so
 * what moves here is what moves at the wedding.
 *
 * Unsplash photos are hotlinked (free to use). They are loaded with
 * `crossOrigin="anonymous"` because WebGL may only sample a CORS-enabled image.
 */

const SLIDE_MS = 5200

const PHOTOS = [
  "1519741497674-611481863552",
  "1520854221256-17451cc331bf",
  "1537633552985-df8429e8048b",
  "1465495976277-4387d4b0b4c6",
  "1759581620687-8e3d6691d64e",
  "1529636798458-92182e662485",
]

const url = (id: string) => `https://images.unsplash.com/photo-${id}?q=80&w=1600&auto=format`

type Plan = {
  fromId: string | null
  fromStart: number
  toId: string | null
  toStart: number
  transition: ReturnType<typeof pickTransition> | null
}

export function WallDemo() {
  const reduced = useReducedMotion()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const [glActive, setGlActive] = useState(false)
  const [domIndex, setDomIndex] = useState(0)

  useEffect(() => {
    if (reduced) return
    const t = window.setInterval(() => setDomIndex((i) => (i + 1) % PHOTOS.length), SLIDE_MS)
    return () => window.clearInterval(t)
  }, [reduced])

  useEffect(() => {
    const canvas = canvasRef.current
    const frame = frameRef.current
    if (!canvas || !frame) return
    const handle = createWallRenderer(canvas)
    if (!handle) return // no WebGL — the <img> crossfade below takes over
    setGlActive(true)

    const images = new Map<string, HTMLImageElement>()
    const load = (id: string) => {
      let img = images.get(id)
      if (!img) {
        img = new Image()
        img.crossOrigin = "anonymous"
        img.src = url(id)
        images.set(id, img)
      }
      return img
    }

    const plan: Plan = { fromId: null, fromStart: 0, toId: null, toStart: 0, transition: null }
    let lastFx: string | null = null
    let slot = 0

    // paused time is subtracted from the clock so a slide never resumes mid-wipe
    let offset = 0
    let hiddenAt = 0
    const now = () => performance.now() - offset

    const advance = () => {
      const next = (slot + 1) % PHOTOS.length
      const img = load(PHOTOS[next])
      if (!img.complete || !img.naturalWidth) return // still decoding — try next frame
      plan.fromId = plan.toId
      plan.fromStart = plan.toStart
      plan.toId = PHOTOS[next]
      plan.toStart = now()
      plan.transition = plan.fromId ? pickTransition(lastFx) : null
      if (plan.transition) lastFx = plan.transition.name
      slot = next
    }
    load(PHOTOS[0])
    advance()

    let raf = 0
    let still = 0
    let onScreen = true

    // reduced motion: one still frame, no loop — but the wall still shows a photo
    if (reduced) {
      still = window.setInterval(() => {
        const img = load(PHOTOS[0])
        if (!handle.prepare(PHOTOS[0], img)) return
        handle.render(null, PHOTOS[0], 0, 0, 0, null)
        window.clearInterval(still)
      }, 200)
      return () => {
        window.clearInterval(still)
        handle.dispose()
      }
    }

    const loop = (raw: number) => {
      raf = requestAnimationFrame(loop)
      if (!onScreen) return
      const t = raw - offset
      // the first photo is still decoding when the wall mounts — retry every
      // frame instead of waiting for a slide that can never be scheduled
      if (!plan.toId) advance()
      if (!plan.toId) return
      const toImg = load(plan.toId)
      if (!handle.prepare(plan.toId, toImg)) return
      if (plan.fromId) handle.prepare(plan.fromId, load(plan.fromId))
      const duration = plan.transition?.durationMs ?? 0
      const progress = duration ? Math.min(1, easeInOut((t - plan.toStart) / duration)) : 1
      const drift = (since: number) => Math.min(1, (t - since) / SLIDE_MS)
      handle.render(
        plan.fromId,
        plan.toId,
        progress >= 1 ? 0 : progress,
        drift(plan.fromStart),
        drift(plan.toStart),
        plan.transition,
      )
      if (progress >= 1) plan.fromId = null
      handle.prune([plan.toId, plan.fromId])
      if (t - plan.toStart >= SLIDE_MS) advance()
    }
    raf = requestAnimationFrame(loop)

    const stop = () => {
      cancelAnimationFrame(raf)
      handle.dispose()
    }
    const onResize = () => handle.resize()
    window.addEventListener("resize", onResize)

    const watcher = new IntersectionObserver(
      ([entry]) => {
        const visible = entry.isIntersecting
        if (visible === onScreen) return
        onScreen = visible
        if (visible) {
          offset += performance.now() - hiddenAt
        } else {
          hiddenAt = performance.now()
        }
      },
      { threshold: 0.15 },
    )
    watcher.observe(frame)

    return () => {
      stop()
      watcher.disconnect()
      window.removeEventListener("resize", onResize)
    }
  }, [reduced])

  return (
    <div
      ref={frameRef}
      className="relative aspect-video overflow-hidden rounded-lg border border-[var(--rule-strong)] bg-lacquer-deep shadow-[0_40px_120px_-40px_oklch(2%_0.004_95/0.9)]"
    >
      {/* laid out from the first paint — a display:none canvas has no size to
          upload textures into, and the wall would start at 2x2 pixels */}
      <canvas ref={canvasRef} aria-hidden className="absolute inset-0 h-full w-full" />
      {!glActive && (
        <AnimatePresence mode="sync">
          <motion.img
            key={domIndex}
            src={url(PHOTOS[domIndex])}
            alt=""
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.6, ease: "easeInOut" }}
            className="absolute inset-0 size-full object-cover"
          />
        </AnimatePresence>
      )}

      {/* the wall's own scrims — a bright photo would otherwise swallow the type */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/80 via-black/35 to-transparent" aria-hidden />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black/85 via-black/40 to-transparent" aria-hidden />

      {/* the wall's own chrome, exactly as it appears on the projector */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-5 sm:p-7">
        <div>
          <div className="flex items-center gap-2.5 font-mono text-[10px] uppercase tracking-[0.24em] text-gold drop-shadow-[0_1px_10px_oklch(0%_0_0/0.95)]">
            <motion.span
              className="size-1.5 rounded-full bg-gold"
              animate={reduced ? undefined : { opacity: [1, 0.25, 1] }}
              transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
            />
            Live Wall
            <span className="text-foreground/45">· {PHOTOS.length} รูปในงาน</span>
          </div>
          <div className="mt-2 font-display text-2xl font-light tracking-tight text-foreground drop-shadow-[0_2px_18px_oklch(4%_0.004_95/0.9)] sm:text-4xl">
            สายฝน <span className="text-gold/80">×</span> ธนกร
          </div>
        </div>
        <div className="hidden rounded-md border border-[var(--rule)] bg-lacquer-deep/70 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground backdrop-blur-sm sm:block">
          12 พ.ย. 2569
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-5 sm:p-7">
        <p className="max-w-[22rem] text-[11.5px] leading-relaxed text-foreground/70 drop-shadow-[0_1px_10px_oklch(0%_0_0/0.95)]">
          ภาพตัวอย่างจาก Unsplash · เรนเดอร์บนเครื่องคุณด้วย WebGL
        </p>
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-foreground/55 drop-shadow-[0_1px_10px_oklch(0%_0_0/0.95)]">
          11 transitions
        </div>
      </div>
      <div
        className="pointer-events-none absolute inset-0 rounded-lg ring-1 ring-inset ring-foreground/5"
        aria-hidden
      />
    </div>
  )
}
