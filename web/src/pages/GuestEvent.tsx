import { useEffect, useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link, useParams } from "react-router-dom"
import { AnimatePresence, motion, useAnimate, useAnimationFrame, useMotionValue, useReducedMotion, type Variants } from "motion/react"
import { CalendarDays, Heart, Images, Loader2, Lock, ScanFace, Sparkles } from "lucide-react"
import { LogoMark } from "@/components/Logo"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { GalleryGrid, GallerySkeleton } from "@/components/GalleryGrid"
import type { PhotoItem } from "@/lib/api"
import { Lightbox } from "@/components/Lightbox"
import { SelfieSearch } from "@/components/SelfieSearch"
import { api, type EventInfo, type PhotoList } from "@/lib/api"
import { formatEventDate } from "@/lib/format"

const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
}
const riseIn: Variants = {
  hidden: { opacity: 0, y: 22 },
  show: { opacity: 1, y: 0, transition: { duration: 0.65, ease: [0.16, 1, 0.3, 1] } },
}


/** Tilted slow-drifting cover — the event's own photos in three compact
 *  rows, same grammar as the homepage hero (motion.dev gallery style). */
function CoverRail({
  photos,
  onOpen,
}: {
  photos: PhotoItem[]
  onOpen: (index: number) => void
}) {
  const reduced = useReducedMotion()
  const W = 128
  const H = 160
  const GAP = 16
  const ROWS = 3

  const rows = useMemo(() => {
    const per = Math.ceil(photos.length / ROWS)
    const out: PhotoItem[][] = []
    for (let r = 0; r < ROWS; r++) {
      out.push(photos.slice(r * per, (r + 1) * per))
    }
    return out.filter((r) => r.length > 0)
  }, [photos])

  const rowLen = rows[0]?.length ?? 1
  const setWidth = Math.max(rowLen, 1) * (W + GAP)
  const x = useMotionValue(0)
  const dragging = useRef(false)

  useAnimationFrame((_, delta) => {
    if (reduced || dragging.current || photos.length < 3) return
    const d = Math.min(delta, 50) / 1000
    let v = x.get() - 8 * d
    if (v <= -setWidth) v += setWidth
    if (v > 0) v -= setWidth
    x.set(v)
  })
  const onDrag = () => {
    const v = x.get()
    if (v <= -setWidth) x.jump(v + setWidth)
    else if (v > 0) x.jump(v - setWidth)
  }

  if (photos.length < 3) return null
  return (
    <div className="relative overflow-hidden border-b border-[var(--rule)] bg-lacquer-deep/50 px-4 pb-16 pt-4 [mask-image:linear-gradient(to_bottom,black_92%,transparent)] [-webkit-mask-image:linear-gradient(to_bottom,black_92%,transparent)]">
      <div style={{ perspective: 1500 }} className="relative">
        <motion.div
          style={{ rotateX: reduced ? 0 : 14, rotateZ: reduced ? 0 : -5, transformOrigin: "top center" }}
          className="origin-top"
        >
          <motion.div
            className="flex cursor-grab flex-col items-center gap-4 active:cursor-grabbing"
            style={{ x: reduced ? 0 : x }}
            drag={reduced ? false : "x"}
            dragElastic={0.12}
            dragMomentum
            onDrag={onDrag}
            onDragStart={() => (dragging.current = true)}
            onDragEnd={() => setTimeout(() => (dragging.current = false), 2200)}
          >
            {rows.map((row, r) => (
              <div key={r} className="flex" style={{ gap: GAP }}>
                {[...row, ...row, ...row].map((p, c) => {
                  const canonical = r * rowLen + (c % row.length)
                  return (
                    <div key={c} style={{ marginLeft: r % 2 === 1 && c === 0 ? (W + GAP) / 2 : 0 }}>
                      <CoverCard
                        photoId={p.id}
                        ratio={p.width && p.height ? `${p.width} / ${p.height}` : "4 / 5"}
                        onOpen={() => onOpen(canonical)}
                      />
                    </div>
                  )
                })}
              </div>
            ))}
          </motion.div>
        </motion.div>
      </div>
      
    </div>
  )
}

function CoverCard({
  photoId,
  ratio,
  onOpen,
}: {
  photoId: string
  ratio: string
  onOpen: () => void
}) {
  const down = useRef<{ x: number; y: number } | null>(null)
  return (
    <motion.button
      onPointerDown={(e) => (down.current = { x: e.clientX, y: e.clientY })}
      onClick={(e) => {
        const d = down.current
        if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) return
        onOpen()
      }}
      className="relative block shrink-0 cursor-grab overflow-hidden rounded-md bg-card p-1 ring-1 ring-[oklch(78% 0 0/0.16)] outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
      style={{ width: 128, height: 160 }}
      whileHover={{ scale: 1.06 }}
      transition={{ type: "spring", stiffness: 260, damping: 24 }}
    >
      <img
        src={`/api/photos/${photoId}/file?variant=thumb`}
        alt=""
        draggable={false}
        loading="lazy"
        className="pointer-events-none h-full w-full select-none rounded-sm object-cover"
        style={{ aspectRatio: ratio }}
      />
    </motion.button>
  )
}

export default function GuestEvent() {
  const { slug: slugParam } = useParams<{ slug: string }>()
  const slug = (slugParam ?? "").toLowerCase()
  const [unlocked, setUnlocked] = useState(false)
  const [tab, setTab] = useState("gallery")
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [newPhotos, setNewPhotos] = useState(0)

  const infoQuery = useQuery({
    queryKey: ["guest-event", slug],
    queryFn: () => api.get<EventInfo>(`/api/g/${encodeURIComponent(slug)}/info`),
    refetchInterval: 30_000,
    retry: false,
  })

  const needsPin = infoQuery.data?.pin_required && !unlocked

  const photosQuery = useQuery({
    queryKey: ["guest-photos", slug],
    queryFn: () => api.get<PhotoList>(`/api/g/${encodeURIComponent(slug)}/photos?limit=500`),
    enabled: !!infoQuery.data && !needsPin,
    refetchInterval: 8_000,
  })

  const info = infoQuery.data
  const photos = photosQuery.data?.items ?? []
  const total = photosQuery.data?.total ?? info?.photo_count ?? 0
  const loadingMore = photosQuery.isFetching && !photosQuery.data

  // live "new photos" pill when the total grows between polls
  const prevTotal = useRef<number | null>(null)
  useEffect(() => {
    if (prevTotal.current !== null && total > prevTotal.current) {
      setNewPhotos((n) => n + (total - prevTotal.current!))
    }
    prevTotal.current = total
  }, [total])
  useEffect(() => {
    if (!newPhotos) return
    const t = setTimeout(() => setNewPhotos(0), 6_000)
    return () => clearTimeout(t)
  }, [newPhotos])

  useEffect(() => {
    document.title = info ? `${info.title} — CameraSync` : "CameraSync"
  }, [info])

  const couple = useMemo(() => {
    if (!info) return ""
    const names = [info.partner_a, info.partner_b].filter(Boolean)
    return names.join(" ♥ ")
  }, [info])

  if (infoQuery.isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 className="size-7 animate-spin text-primary" />
      </div>
    )
  }
  if (infoQuery.isError || !info) {
    return (
      <motion.div
        className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center"
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.35 }}
      >
        <span className="flex size-14 items-center justify-center rounded-2xl bg-muted">
          <Images className="size-7 text-muted-foreground" />
        </span>
        <h1 className="font-display text-2xl font-semibold">ไม่พบงานนี้</h1>
        <p className="text-sm text-muted-foreground">ลิงก์อาจพิมพ์ผิด หรืองานถูกปิดไปแล้ว</p>
        <Button asChild variant="outline" className="rounded-full">
          <Link to="/">กลับหน้าแรก</Link>
        </Button>
      </motion.div>
    )
  }

  if (needsPin) {
    return <PinGate slug={slug} title={info.title} onUnlocked={() => setUnlocked(true)} />
  }

  const live = (photosQuery.data && total > photos.length) || photosQuery.isFetching

  return (
    <div className="min-h-dvh pb-16">
      {/* header */}
      <header className="relative overflow-hidden border-b border-border/60 bg-gradient-to-b from-secondary/70 to-background">
        <div
          className="pointer-events-none absolute inset-0 [background-image:radial-gradient(42%_60%_at_50%_0%,oklch(84%_0.19_80.46/0.06),transparent),radial-gradient(22%_30%_at_88%_12%,oklch(70%_0.12_188/0.07),transparent)]"
          aria-hidden
        />
        <Heart
          className="pointer-events-none absolute -right-6 top-8 size-44 rotate-12 text-primary/[0.05]"
          aria-hidden
        />
        <motion.div
          className="relative mx-auto max-w-6xl px-5 pb-8 pt-12 text-center"
          variants={stagger}
          initial="hidden"
          animate="show"
        >
          <motion.p variants={riseIn} className="mb-3 inline-flex items-center gap-3 font-mono text-[10.5px] font-medium uppercase tracking-[0.22em] text-gold">
            <span className="h-px w-7 bg-gold/60" /> Wedding Gallery <span className="h-px w-7 bg-gold/60" />
          </motion.p>
          <motion.h1 variants={riseIn} className="font-display text-4xl font-semibold tracking-tight sm:text-[3.4rem] sm:leading-[1.1]">
            {info.title}
          </motion.h1>
          {couple && (
            <motion.p variants={riseIn} className="mt-3 font-display text-xl italic text-primary sm:text-2xl">
              {couple}
            </motion.p>
          )}
          {info.event_date && (
            <motion.p variants={riseIn} className="mt-3 flex items-center justify-center gap-1.5 text-[13px] text-muted-foreground">
              <CalendarDays className="size-4 text-gold" /> {formatEventDate(info.event_date)}
            </motion.p>
          )}
          <motion.div variants={riseIn} className="mt-5 flex flex-wrap items-center justify-center gap-2.5 text-sm">
            <span className="flex items-center gap-1.5 rounded-full border border-border/70 bg-card px-3.5 py-1.5 shadow-sm">
              <Images className="size-4 text-primary" />
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={total}
                  initial={{ scale: 1.45, opacity: 0.4 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.6, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 380, damping: 22 }}
                  className="inline-block font-semibold tabular-nums"
                >
                  {total.toLocaleString("th-TH")}
                </motion.span>
              </AnimatePresence>
              รูป
            </span>
            <AnimatePresence>
              {live && (
                <motion.span
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="flex items-center gap-1.5 rounded-full bg-card px-3.5 py-1.5 shadow-sm"
                >
                  <span className="size-2 animate-live-dot rounded-full bg-emerald-500" /> อัปเดตสด
                </motion.span>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-8 sm:px-5">
        <Tabs value={tab} onValueChange={setTab}>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25, duration: 0.4 }}
          >
            {/* base TabsList forces h-9 via this group variant; override with the same variant so pills (h-10) fit the track */}
            <TabsList className="mx-auto mb-8 grid w-full max-w-md grid-cols-2 rounded-full border border-border/70 bg-secondary/60 p-1 shadow-sm group-data-[orientation=horizontal]/tabs:h-auto">
              <TabsTrigger value="gallery" className="h-10 rounded-full font-medium data-[state=active]:shadow-[0_10px_26px_-10px_oklch(84%_0.19_80.46/0.28)] data-[state=active]:border-[var(--rule-strong)]">
                <Images className="mr-2 size-4" /> แกลเลอรี
              </TabsTrigger>
              <TabsTrigger value="me" className="h-10 rounded-full font-medium data-[state=active]:shadow-[0_10px_26px_-10px_oklch(84%_0.19_80.46/0.28)] data-[state=active]:border-[var(--rule-strong)]" disabled={!info.face_enabled}>
                <ScanFace className="mr-2 size-4" /> หารูปตัวเอง
              </TabsTrigger>
            </TabsList>
          </motion.div>
        </Tabs>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            initial={{ opacity: 0, x: tab === "gallery" ? -28 : 28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: tab === "gallery" ? 28 : -28 }}
            transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
          >
            {tab === "gallery" ? (
              <>
                <div className="mb-8">
                  <CoverRail photos={photos.slice(0, 24)} onOpen={setLightboxIndex} />
                </div>
                {photosQuery.isLoading ? (
                  <GallerySkeleton />
                ) : photos.length === 0 ? (
                  <EmptyGallery />
                ) : (
                  <GalleryGrid photos={photos} onOpen={setLightboxIndex} />
                )}
              </>
            ) : info.face_enabled ? (
              <SelfieSearch slug={slug} />
            ) : (
              <Card className="mx-auto max-w-md">
                <CardContent className="items-center py-10 text-center">
                  <ScanFace className="mx-auto mb-3 size-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    งานนี้ปิดการใช้งานการค้นหาด้วยใบหน้า — เลื่อนดูแกลเลอรีได้เลยนะ
                  </p>
                </CardContent>
              </Card>
            )}
          </motion.div>
        </AnimatePresence>

        {loadingMore && photos.length > 0 && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 inline size-4 animate-spin" /> กำลังโหลดรูปเพิ่ม…
          </div>
        )}
      </main>

      {/* live new-photos pill */}
      <AnimatePresence>
        {newPhotos > 0 && (
          <motion.button
            initial={{ y: 90, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 90, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 26 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => {
              setNewPhotos(0)
              window.scrollTo({ top: 0, behavior: "smooth" })
            }}
            className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full bg-foreground px-5 py-3 text-sm font-medium text-background shadow-xl"
          >
            <motion.span
              animate={{ rotate: [0, -12, 12, -8, 8, 0] }}
              transition={{ duration: 0.7, repeat: Infinity, repeatDelay: 2.2 }}
            >
              <Sparkles className="size-4 text-primary" />
            </motion.span>
            มีรูปใหม่ +{newPhotos} รูป — กดดู
          </motion.button>
        )}
      </AnimatePresence>

      <footer className="mt-14 border-t border-border/60 py-8 text-center text-xs text-muted-foreground">
        <p className="flex items-center justify-center gap-1.5">
          <Heart className="size-3.5 text-primary" /> บริการโดย
          <Link to="/" className="inline-flex items-center gap-1 font-medium text-foreground">
            <LogoMark size={16} /> CameraSync
          </Link>
        </p>
        <p className="mt-2 flex items-center justify-center gap-1">
          <Sparkles className="size-3" /> มีรูปใหม่เพิ่มเรื่อย ๆ ระหว่างงาน — เข้ามาดูใหม่ได้เลย
        </p>
      </footer>

      <AnimatePresence>
        {lightboxIndex !== null && (
          <Lightbox
            photos={photos}
            index={lightboxIndex}
            onClose={() => setLightboxIndex(null)}
            onNavigate={setLightboxIndex}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function EmptyGallery() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-border py-20 text-center"
    >
      <motion.span
        className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/10"
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
      >
        <Images className="size-7 text-primary" />
      </motion.span>
      <h3 className="font-display text-xl font-semibold">ยังไม่มีรูปในแกลเลอรี</h3>
      <p className="mt-2 max-w-xs text-sm text-muted-foreground">
        ช่างภาพกำลังถ่ายและอัปโหลดอยู่ — พักดื่มน้ำแป๊บเดียว แล้วรีเฟรชดูได้เลย รูปจะขึ้นเอง
      </p>
    </motion.div>
  )
}

function PinGate({
  slug,
  title,
  onUnlocked,
}: {
  slug: string
  title: string
  onUnlocked: () => void
}) {
  const [pin, setPin] = useState("")
  const [loading, setLoading] = useState(false)
  const [scope, animate] = useAnimate()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pin.trim()) return
    setLoading(true)
    try {
      await api.post(`/api/g/${encodeURIComponent(slug)}/unlock`, { pin })
      toast.success("ปลดล็อกสำเร็จ")
      onUnlocked()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "PIN ไม่ถูกต้อง")
      void animate(
        scope.current,
        { x: [0, -14, 14, -9, 9, -4, 0] },
        { duration: 0.5, ease: "easeInOut" },
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-5">
      <motion.div
        ref={scope}
        initial={{ opacity: 0, y: 28, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 220, damping: 24 }}
        className="w-full max-w-sm"
      >
        <Card>
          <CardContent className="pt-8 text-center">
            <motion.span
              className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/10"
              animate={{ scale: [1, 1.06, 1] }}
              transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
            >
              <Lock className="size-6 text-primary" />
            </motion.span>
            <h1 className="font-display text-xl font-semibold">{title}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              งานนี้ตั้งรหัส PIN กันคนนอก — ใส่รหัสที่ได้จากคู่สมรสหรือโต๊ะลงทะเบียน
            </p>
            <form onSubmit={submit} className="mt-6 space-y-3">
              <Input
                type="text"
                inputMode="numeric"
                autoFocus
                placeholder="PIN"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                className="h-12 text-center text-lg tracking-[0.4em]"
              />
              <Button type="submit" disabled={loading} className="h-11 w-full rounded-full">
                {loading ? <Loader2 className="size-4 animate-spin" /> : "เข้าชมแกลเลอรี"}
              </Button>
            </form>
            <Separator className="my-6" />
            <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">
              ← CameraSync
            </Link>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}
