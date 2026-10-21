import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link, useParams } from "react-router-dom"
import { AnimatePresence, motion } from "motion/react"
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Expand,
  ImageOff,
  Loader2,
  Minimize,
  Pause,
  Play,
  Quote,
  Sparkles,
} from "lucide-react"
import { PinGate } from "@/components/PinGate"
import { LogoMark } from "@/components/Logo"
import {
  ApiError,
  api,
  listWishes,
  photoUrl,
  type EventInfo,
  type PhotoItem,
  type PhotoList,
  type WishItem,
} from "@/lib/api"
import { formatEventDate } from "@/lib/format"

const SLIDE_MS = 6500
const WISH_EVERY = 7

type Slide =
  | { kind: "photo"; key: string; photo: PhotoItem }
  | { kind: "wish"; key: string; wish: WishItem }

type WakeLockSentinelLike = { release: () => Promise<void> }

function tunnelPrefix(): string {
  const m = document.cookie.match(/(?:^|;\s*)cs_tunnel=([\w-]+)/)
  return m ? `/t/${m[1]}` : ""
}

export default function LiveWall() {
  const { slug: slugParam } = useParams<{ slug: string }>()
  const slug = (slugParam ?? "").toLowerCase()
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [isFull, setIsFull] = useState(false)
  const [showUi, setShowUi] = useState(true)
  const [fresh, setFresh] = useState(false)
  const hideTimer = useRef<number | undefined>(undefined)
  const prevCount = useRef(0)

  const infoQuery = useQuery({
    queryKey: ["guest-event", slug],
    queryFn: () => api.get<EventInfo>(`/api/g/${encodeURIComponent(slug)}/info`),
    refetchInterval: 60_000,
    retry: false,
  })
  const photosQuery = useQuery({
    queryKey: ["wall-photos", slug],
    queryFn: () => api.get<PhotoList>(`/api/g/${encodeURIComponent(slug)}/photos?limit=500`),
    refetchInterval: 5_000,
    retry: false,
  })
  const wishesQuery = useQuery({
    queryKey: ["wishes", slug],
    queryFn: () => listWishes(slug),
    enabled: !!infoQuery.data?.guestbook_enabled,
    refetchInterval: 30_000,
    retry: false,
  })

  const info = infoQuery.data
  const photos = photosQuery.data?.items ?? []
  const totalPhotos = photosQuery.data?.total ?? photos.length

  const couple = useMemo(() => {
    if (!info) return ""
    return [info.partner_a, info.partner_b].filter(Boolean).join(" ♥ ")
  }, [info])

  const slides = useMemo<Slide[]>(() => {
    const wishes = wishesQuery.data?.items ?? []
    const out: Slide[] = []
    photos.forEach((p, i) => {
      out.push({ kind: "photo", key: p.id, photo: p })
      if (wishes.length > 0 && (i + 1) % WISH_EVERY === 0) {
        const wish = wishes[Math.floor(i / WISH_EVERY) % wishes.length]
        out.push({ kind: "wish", key: `wish-${wish.id}-${i}`, wish })
      }
    })
    return out
  }, [photos, wishesQuery.data])

  const slide = slides[index]

  // live: a new photo jumps back to the newest frame and shows a short flash
  useEffect(() => {
    if (prevCount.current > 0 && photos.length > prevCount.current) {
      setIndex(0)
      setFresh(true)
      const t = window.setTimeout(() => setFresh(false), 3_500)
      prevCount.current = photos.length
      return () => window.clearTimeout(t)
    }
    prevCount.current = photos.length
  }, [photos.length])

  useEffect(() => {
    if (slides.length === 0) return
    if (index >= slides.length) setIndex(0)
  }, [slides.length, index])

  // autoplay
  useEffect(() => {
    if (paused || slides.length < 2) return
    const t = window.setTimeout(() => setIndex((i) => (i + 1) % slides.length), SLIDE_MS)
    return () => window.clearTimeout(t)
  }, [index, paused, slides.length])

  // preload the next frame so the crossfade never waits on the network
  useEffect(() => {
    if (slides.length < 2) return
    const next = slides[(index + 1) % slides.length]
    if (next?.kind === "photo") {
      const img = new Image()
      img.src = photoUrl(next.photo.id, "web")
    }
  }, [index, slides])

  const poke = useCallback(() => {
    setShowUi(true)
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setShowUi(false), 4000)
  }, [])

  useEffect(() => {
    poke()
    return () => window.clearTimeout(hideTimer.current)
  }, [poke])

  const next = useCallback(() => {
    if (slides.length === 0) return
    setIndex((i) => (i + 1) % slides.length)
    poke()
  }, [slides.length, poke])
  const prev = useCallback(() => {
    if (slides.length === 0) return
    setIndex((i) => (i - 1 + slides.length) % slides.length)
    poke()
  }, [slides.length, poke])

  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen()
      else await document.exitFullscreen()
    } catch {
      /* iOS / permission — ignore */
    }
  }, [])

  useEffect(() => {
    const onFs = () => setIsFull(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", onFs)
    return () => document.removeEventListener("fullscreenchange", onFs)
  }, [])

  // keep the venue display awake while the wall is on screen
  useEffect(() => {
    let lock: WakeLockSentinelLike | null = null
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> }
    }
    const acquire = async () => {
      if (!nav.wakeLock || document.visibilityState !== "visible") return
      try {
        lock = await nav.wakeLock.request("screen")
      } catch {
        /* battery saver / unsupported */
      }
    }
    void acquire()
    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      document.removeEventListener("visibilitychange", onVisible)
      void lock?.release().catch(() => {})
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault()
        setPaused((p) => !p)
        poke()
      } else if (e.key === "ArrowRight") {
        next()
      } else if (e.key === "ArrowLeft") {
        prev()
      } else if (e.key.toLowerCase() === "f") {
        void toggleFullscreen()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [next, prev, toggleFullscreen, poke])

  const needsPin = [photosQuery.error, infoQuery.error].some(
    (e) => e instanceof ApiError && e.status === 401,
  )
  if (needsPin) {
    return (
      <PinGate
        slug={slug}
        title={info?.title ?? "แกลเลอรีงานแต่ง"}
        onUnlocked={() => {
          void photosQuery.refetch()
          void infoQuery.refetch()
        }}
      />
    )
  }
  if (photosQuery.isError || infoQuery.isError) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <ImageOff className="size-10 text-muted-foreground" />
        <h1 className="font-display text-2xl font-semibold">เปิดจอใหญ่ไม่ได้</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          ลิงก์อาจพิมพ์ผิด หรืองานนี้ถูกปิดอยู่ — กลับไปที่แกลเลอรีแล้วลองอีกครั้งนะ
        </p>
        <Link
          to={`/e/${encodeURIComponent(slug)}`}
          className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border/70 px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> กลับแกลเลอรี
        </Link>
      </div>
    )
  }

  if (!info) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-lacquer-deep">
        <Loader2 className="size-7 animate-spin text-primary" />
      </div>
    )
  }

  const qrBase = `${window.location.origin}${tunnelPrefix()}`
  const qrSrc = `/api/g/${encodeURIComponent(slug)}/qr.png?base=${encodeURIComponent(qrBase)}`
  const galleryUrl = `${qrBase}/e/${slug}/`

  if (slides.length === 0) {
    return (
      <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-lacquer-deep px-6 text-center">
        <div className="pointer-events-none absolute inset-0 [background-image:radial-gradient(50%_40%_at_50%_20%,oklch(84%_0.19_80.46/0.08),transparent)]" />
        <motion.span
          className="mb-6 flex size-16 items-center justify-center rounded-2xl border border-[var(--rule)] bg-card/60"
          animate={{ y: [0, -6, 0] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
        >
          <ImageOff className="size-7 text-primary" />
        </motion.span>
        <p className="font-mono text-[10.5px] uppercase tracking-[0.3em] text-gold">Live Wall</p>
        <h1 className="mt-2 font-display text-3xl font-semibold sm:text-4xl">{info.title}</h1>
        {couple && <p className="mt-2 font-display text-lg italic text-primary">{couple}</p>}
        <p className="mt-3 max-w-sm text-sm text-muted-foreground">
          กำลังรอรูปแรกจากช่างภาพ — จอนี้จะอัปเดตเองอัตโนมัติเมื่อมีรูปใหม่เข้ามา
        </p>
        <img src={qrSrc} alt="QR แกลเลอรี" className="mt-8 w-44 rounded-xl bg-[oklch(97%_0.01_90)] p-3" />
        <p className="mt-3 text-xs text-muted-foreground">สแกนเพื่อเปิดแกลเลอรีบนมือถือ</p>
        <Link
          to={`/e/${encodeURIComponent(slug)}`}
          className="mt-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> กลับแกลเลอรี
        </Link>
      </div>
    )
  }

  return (
    <div
      className="relative min-h-dvh overflow-hidden bg-lacquer-deep text-white"
      onMouseMove={poke}
      onClick={poke}
    >
      {/* slides */}
      <AnimatePresence mode="sync">
        <motion.div
          key={slide?.key ?? "empty"}
          className="absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.1, ease: "easeInOut" }}
        >
          {slide?.kind === "photo" ? (
            <PhotoSlide photo={slide.photo} />
          ) : slide?.kind === "wish" ? (
            <WishSlide wish={slide.wish} />
          ) : null}
        </motion.div>
      </AnimatePresence>

      {/* cinematic grade */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_45%,transparent_35%,oklch(4%_0.004_95/0.65)_100%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-44 bg-gradient-to-b from-black/70 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-52 bg-gradient-to-t from-black/80 to-transparent" />

      {/* progress */}
      {!paused && slides.length > 1 && (
        <motion.div
          key={`progress-${index}`}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: SLIDE_MS / 1000, ease: "linear" }}
          className="absolute left-0 top-0 z-40 h-[3px] w-full origin-left bg-gold/80"
        />
      )}

      {/* header */}
      <header className="absolute inset-x-0 top-0 z-30 flex items-start justify-between gap-4 px-6 pb-10 pt-7 md:px-10 md:pt-9">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.32em] text-gold">
            <span className="size-1.5 animate-live-dot rounded-full bg-emerald-400" />
            Live Wall
            <span className="text-white/30">/</span>
            <span className="normal-case tracking-[0.14em] text-white/55">
              {totalPhotos.toLocaleString("th-TH")} รูปในงาน
            </span>
          </p>
          <h1 className="mt-2 truncate font-display text-2xl font-semibold sm:text-3xl md:text-4xl">
            {info.title}
          </h1>
          <p className="mt-1 truncate text-sm text-white/65">
            {couple}
            {info.event_date ? ` · ${formatEventDate(info.event_date)}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <AnimatePresence>
            {fresh && (
              <motion.span
                initial={{ opacity: 0, y: -8, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="hidden items-center gap-1.5 rounded-full border border-gold/30 bg-gold/15 px-3 py-1.5 text-xs font-medium text-gold backdrop-blur sm:inline-flex"
              >
                <Sparkles className="size-3.5" /> มีรูปใหม่
              </motion.span>
            )}
          </AnimatePresence>
          <Link
            to={`/e/${encodeURIComponent(slug)}`}
            title="กลับไปแกลเลอรี"
            className="hidden size-10 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/70 backdrop-blur transition-colors hover:bg-white/10 hover:text-white sm:flex"
          >
            <ArrowLeft className="size-4" />
          </Link>
        </div>
      </header>

      {/* QR — stays on screen all night */}
      <div className="absolute bottom-24 right-6 z-30 hidden w-[172px] flex-col items-center gap-2.5 rounded-2xl border border-white/12 bg-black/45 p-4 text-center backdrop-blur-md md:flex">
        <img
          src={qrSrc}
          alt="QR แกลเลอรี"
          className="w-full rounded-lg bg-[oklch(97%_0.01_90)] p-2"
        />
        <p className="text-[11.5px] font-medium leading-snug text-white/85">
          สแกนเพื่อดูรูปทั้งหมด
          <span className="mt-0.5 block truncate font-mono text-[9.5px] font-normal text-white/45">
            {galleryUrl.replace(/^https?:\/\//, "")}
          </span>
        </p>
      </div>

      {/* controls */}
      <AnimatePresence>
        {showUi && (
          <motion.footer
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 14 }}
            transition={{ duration: 0.25 }}
            className="absolute inset-x-0 bottom-0 z-30 flex flex-wrap items-center justify-between gap-4 px-6 pb-6 pt-16 md:px-10 md:pb-9"
          >
            <p className="flex items-center gap-2 text-xs text-white/45">
              <LogoMark size={14} />
              {paused ? "หยุดชั่วคราว — กดเล่นเพื่อไปต่อ" : "รูปใหม่ขึ้นจอเองระหว่างงาน"}
              <span className="hidden text-white/25 sm:inline">·</span>
              <span className="hidden font-mono text-[10px] tracking-wide text-white/30 sm:inline">
                Space เล่น/หยุด · ← → เลื่อน · F เต็มจอ
              </span>
            </p>
            <div className="flex items-center gap-2">
              <WallButton label="ก่อนหน้า" onClick={prev}>
                <ChevronLeft className="size-4" />
              </WallButton>
              <WallButton
                label={paused ? "เล่นต่อ" : "หยุดชั่วคราว"}
                onClick={() => {
                  setPaused((p) => !p)
                  poke()
                }}
                accent
              >
                {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
              </WallButton>
              <WallButton label="ถัดไป" onClick={next}>
                <ChevronRight className="size-4" />
              </WallButton>
              <WallButton label={isFull ? "ออกจากเต็มจอ" : "เต็มจอ"} onClick={() => void toggleFullscreen()}>
                {isFull ? <Minimize className="size-4" /> : <Expand className="size-4" />}
              </WallButton>
              <span className="ml-2 hidden font-mono text-[11px] tabular-nums text-white/35 sm:inline">
                {index + 1} / {slides.length}
              </span>
            </div>
          </motion.footer>
        )}
      </AnimatePresence>
    </div>
  )
}

function WallButton({
  children,
  label,
  onClick,
  accent,
}: {
  children: React.ReactNode
  label: string
  onClick: () => void
  accent?: boolean
}) {
  return (
    <motion.button
      onClick={onClick}
      title={label}
      aria-label={label}
      whileHover={{ scale: 1.06 }}
      whileTap={{ scale: 0.94 }}
      className={`flex size-10 items-center justify-center rounded-full border backdrop-blur transition-colors ${
        accent
          ? "border-gold/40 bg-gold/20 text-gold hover:bg-gold/30"
          : "border-white/15 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
      }`}
    >
      {children}
    </motion.button>
  )
}

function PhotoSlide({ photo }: { photo: PhotoItem }) {
  const src = photoUrl(photo.id, "web")
  return (
    <div className="absolute inset-0 bg-black">
      <motion.img
        src={src}
        alt=""
        aria-hidden
        initial={{ scale: 1.08, opacity: 0 }}
        animate={{ scale: 1.16, opacity: 0.4 }}
        transition={{ duration: 10, ease: "linear" }}
        className="absolute inset-0 h-full w-full scale-110 object-cover blur-3xl"
      />
      <motion.img
        src={src}
        alt="รูปงานแต่ง"
        initial={{ opacity: 0, scale: 1.04 }}
        animate={{ opacity: 1, scale: 1.1 }}
        transition={{ opacity: { duration: 1.1 }, scale: { duration: 11, ease: "linear" } }}
        className="absolute inset-0 h-full w-full object-contain"
        draggable={false}
      />
    </div>
  )
}

function WishSlide({ wish }: { wish: WishItem }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(80%_80%_at_50%_35%,oklch(18%_0.02_80/0.9),oklch(5%_0.004_95)_75%)]">
      <div className="max-w-4xl px-8 pb-16 pt-24 text-center md:px-16">
        <motion.div
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.25, duration: 0.7 }}
        >
          <Quote className="mx-auto size-9 text-gold/60" />
        </motion.div>
        <motion.p
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="mt-6 whitespace-pre-wrap font-display text-2xl leading-snug text-white/95 sm:text-3xl md:text-[2.7rem] md:leading-[1.28]"
        >
          {wish.message}
        </motion.p>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7, duration: 0.7 }}
          className="mt-8 font-mono text-[11px] uppercase tracking-[0.3em] text-gold"
        >
          คำอวยพรจาก {wish.guest_name}
        </motion.p>
      </div>
    </div>
  )
}
