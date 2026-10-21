import { useEffect, useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link, useParams } from "react-router-dom"
import { AnimatePresence, motion, useAnimationFrame, useMotionValue, useReducedMotion } from "motion/react"
import { Download, Heart, Images, Loader2, MessageSquareHeart, ScanFace, Sparkles } from "lucide-react"
import { LogoMark } from "@/components/Logo"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { GalleryGrid, GallerySkeleton } from "@/components/GalleryGrid"
import type { PhotoItem } from "@/lib/api"
import { Lightbox } from "@/components/Lightbox"
import { SelfieSearch } from "@/components/SelfieSearch"
import { Guestbook } from "@/components/Guestbook"
import { PinGate } from "@/components/PinGate"
import {
  api,
  downloadZip,
  listLikes,
  setLike,
  type EventInfo,
  type PhotoList,
} from "@/lib/api"
import { AlbumHero } from "@/components/guest/AlbumHero"
import { applyTheme, getTheme, resetTheme } from "@/lib/galleryThemes"
import { formatNames, getTemplate } from "@/lib/eventTemplates"

/** Stable per-device guest id for likes — randomUUID needs a secure context,
 * production guests come in over plain http, so fall back to Math.random. */
function makeGuestId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID()
    }
  } catch {
    /* insecure context */
  }
  return (
    "g-" +
    Array.from({ length: 20 }, () => Math.floor(Math.random() * 16).toString(16)).join("")
  )
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
      className="relative block shrink-0 cursor-grab overflow-hidden rounded-md bg-card p-1 ring-1 ring-border/60 outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
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
  const [likedOnly, setLikedOnly] = useState(false)
  const [likedIds, setLikedIds] = useState<Set<string>>(() => new Set())
  const [downloading, setDownloading] = useState(false)
  const [guestId] = useState(() => {
    try {
      const key = `cs-guest-id:${slug}`
      let id = localStorage.getItem(key)
      if (!id) {
        id = makeGuestId()
        localStorage.setItem(key, id)
      }
      return id
    } catch {
      return makeGuestId()
    }
  })

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

  // ---- likes (stored on the photographer's machine, one JSON per event) ----
  useEffect(() => {
    if (!info || needsPin) return
    let cancelled = false
    listLikes(slug, guestId)
      .then((r) => {
        if (!cancelled) setLikedIds(new Set(r.items))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [slug, guestId, needsPin, info])

  const toggleLike = (photoId: string) => {
    const next = !likedIds.has(photoId)
    const apply = (on: boolean) =>
      setLikedIds((prev) => {
        const s = new Set(prev)
        if (on) s.add(photoId)
        else s.delete(photoId)
        return s
      })
    apply(next)
    setLike(slug, guestId, photoId, next).catch(() => {
      apply(!next)
      toast.error("บันทึกหัวใจไม่สำเร็จ — ลองอีกครั้งนะ")
    })
  }

  const displayPhotos = useMemo(
    () => (likedOnly ? photos.filter((p) => likedIds.has(p.id)) : photos),
    [photos, likedOnly, likedIds],
  )

  const downloadFavorites = async () => {
    if (likedIds.size === 0 || downloading) return
    setDownloading(true)
    try {
      await downloadZip(
        `/api/g/${encodeURIComponent(slug)}/photos/download`,
        { photo_ids: [...likedIds] },
        `${slug}-favorites.zip`,
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ดาวน์โหลดไม่สำเร็จ")
    } finally {
      setDownloading(false)
    }
  }

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

  // the photographer's two design choices for this album: wording + look
  const theme = getTheme(info?.theme)
  const tpl = getTemplate(info?.event_type)

  useEffect(() => {
    if (!info) return
    applyTheme(theme)
    return () => resetTheme()
  }, [theme, info])

  const couple = useMemo(() => {
    if (!info) return ""
    return formatNames(tpl, info.partner_a, info.partner_b)
  }, [info, tpl])

  // album cover — the same photo the share card (OG) uses: the one the
  // photographer picked, falling back to the newest photo exactly like the
  // hub's /e/{slug}/cover.jpg
  const coverPhotoId = info?.cover_photo_id || photos[0]?.id

  const heroPhotos = useMemo(() => {
    if (!coverPhotoId || photos[0]?.id === coverPhotoId) return photos
    const cover = photos.find((p) => p.id === coverPhotoId)
    return cover ? [cover, ...photos.filter((p) => p.id !== coverPhotoId)] : photos
  }, [photos, coverPhotoId])

  const openFromHero = (photo: PhotoItem) => {
    const idx = photos.findIndex((p) => p.id === photo.id)
    if (idx >= 0) setLightboxIndex(idx)
  }

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
    return (
        <PinGate
          slug={slug}
          title={info.title}
          kicker={tpl.kicker}
          hint={tpl.pinHint}
          onUnlocked={() => setUnlocked(true)}
        />
      )
  }

  const live = (photosQuery.data && total > photos.length) || photosQuery.isFetching

  return (
    <div className="relative min-h-dvh pb-16">
      <div className="theme-texture" aria-hidden />
      {/* header — layout + wording come from the album's theme and template */}
      <AlbumHero
        theme={theme}
        tpl={tpl}
        info={info}
        couple={couple}
        total={total}
        live={live}
        photos={heroPhotos}
        onOpen={openFromHero}
      />

      <main className="mx-auto max-w-6xl px-4 pt-8 sm:px-5">
        <Tabs value={tab} onValueChange={setTab}>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25, duration: 0.4 }}
          >
            {/* base TabsList forces h-9 via this group variant; override with the same variant so pills (h-10) fit the track */}
            <TabsList
              className={`mx-auto mb-8 grid w-full rounded-full border border-border/70 bg-secondary/60 p-1 shadow-sm group-data-[orientation=horizontal]/tabs:h-auto ${
                info.guestbook_enabled ? "max-w-lg grid-cols-3" : "max-w-md grid-cols-2"
              }`}
            >
              <TabsTrigger value="gallery" className="h-10 rounded-full px-2 font-medium data-[state=active]:gold-glow data-[state=active]:border-[var(--rule-strong)]">
                <Images className="mr-1.5 size-4" /> แกลเลอรี
              </TabsTrigger>
              <TabsTrigger value="me" className="h-10 rounded-full px-2 font-medium data-[state=active]:gold-glow data-[state=active]:border-[var(--rule-strong)]" disabled={!info.face_enabled}>
                <ScanFace className="mr-1.5 size-4" /> หารูปตัวเอง
              </TabsTrigger>
              {info.guestbook_enabled && (
                <TabsTrigger value="wishes" className="h-10 rounded-full px-2 font-medium data-[state=active]:gold-glow data-[state=active]:border-[var(--rule-strong)]">
                  <MessageSquareHeart className="mr-1.5 size-4" /> {tpl.wishTab}
                </TabsTrigger>
              )}
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
                <div className="mb-6 flex flex-wrap items-center justify-center gap-2">
                  <motion.button
                    onClick={() => setLikedOnly((v) => !v)}
                    whileTap={{ scale: 0.96 }}
                    className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-all ${
                      likedOnly
                        ? "border-[var(--rule-strong)] bg-primary/15 text-foreground gold-glow"
                        : "border-border/70 bg-secondary/60 text-muted-foreground hover:text-foreground"
                    }`}
                    aria-pressed={likedOnly}
                  >
                    <Heart
                      className={`size-4 ${
                        likedOnly ? "fill-gold text-gold" : ""
                      }`}
                    />
                    รูปที่ฉันถูกใจ
                    {likedIds.size > 0 && (
                      <span className="font-mono text-xs text-muted-foreground">{likedIds.size}</span>
                    )}
                  </motion.button>
                  <motion.button
                    onClick={downloadFavorites}
                    disabled={likedIds.size === 0 || downloading}
                    whileTap={{ scale: 0.96 }}
                    title="ดาวน์โหลดรูปที่กดหัวใจไว้เป็นไฟล์ .zip"
                    className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-secondary/60 px-4 py-2 text-sm font-medium text-muted-foreground transition-all hover:text-foreground disabled:pointer-events-none disabled:opacity-45"
                  >
                    {downloading ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Download className="size-4" />
                    )}
                    ดาวน์โหลดที่ชอบ
                  </motion.button>
                </div>
                {!likedOnly && (
                  <div className="mb-8">
                    <CoverRail photos={photos.slice(0, 24)} onOpen={setLightboxIndex} />
                  </div>
                )}
                {photosQuery.isLoading ? (
                  <GallerySkeleton />
                ) : likedOnly && displayPhotos.length === 0 ? (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                    className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-border py-20 text-center"
                  >
                    <motion.span
                      className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/10"
                      animate={{ scale: [1, 1.12, 1] }}
                      transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                    >
                      <Heart className="size-7 text-primary" />
                    </motion.span>
                    <h3 className="font-display text-xl font-semibold">ยังไม่มีรูปที่ถูกใจ</h3>
                    <p className="mt-2 max-w-xs text-sm text-muted-foreground">
                      กดหัวใจไว้ที่รูปที่ชอบตอนดู รูปจะมาอยู่ที่นี่ให้ย้อนกลับมาดูได้ทีหลัง
                    </p>
                  </motion.div>
                ) : photos.length === 0 ? (
                  <EmptyGallery line={tpl.emptyLine} />
                ) : (
                  <GalleryGrid
                    photos={displayPhotos}
                    onOpen={setLightboxIndex}
                    likedIds={likedIds}
                    onToggleLike={toggleLike}
                    grid={theme.grid}
                  />
                )}
              </>
            ) : tab === "wishes" && info.guestbook_enabled ? (
              <Guestbook slug={slug} guestId={guestId} tpl={tpl} />
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
          <Sparkles className="size-3" /> {tpl.footerNote}
        </p>
      </footer>

      <Lightbox
        photos={displayPhotos}
        index={lightboxIndex}
        onClose={() => setLightboxIndex(null)}
        isLiked={(id) => likedIds.has(id)}
        onToggleLike={toggleLike}
      />
    </div>
  )
}

function EmptyGallery({ line }: { line?: string }) {
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
        {line ?? "ช่างภาพกำลังถ่ายและอัปโหลดอยู่ — พักดื่มน้ำแป๊บเดียว แล้วรีเฟรชดูได้เลย รูปจะขึ้นเอง"}
      </p>
    </motion.div>
  )
}
