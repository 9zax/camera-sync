import { useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate, useParams } from "react-router-dom"
import { AnimatePresence, motion } from "motion/react"
import {
  ArrowLeft,
  CheckCircle2,
  CloudUpload,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileWarning,
  KeyRound,
  Loader2,
  MessageSquareHeart,
  MonitorPlay,
  QrCode,
  ScanFace,
  Settings2,
  Star,
  Terminal,
  Trash2,
  UploadCloud,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  api,
  photoUrl,
  uploadFiles,
  type AdminEvent,
  type PhotoList,
  type WishItem,
  type WishList,
} from "@/lib/api"
import { timeAgo } from "@/lib/format"
import { EventTypePicker, ThemePicker } from "@/components/admin/DesignPickers"
import { getTemplate } from "@/lib/eventTemplates"

export default function EventDetail() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const eventQuery = useQuery({
    queryKey: ["event", id],
    queryFn: () => api.get<AdminEvent>(`/api/events/${id}`),
    refetchInterval: 4_000,
  })
  const ev = eventQuery.data

  if (eventQuery.isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 className="size-7 animate-spin text-primary" />
      </div>
    )
  }
  if (eventQuery.isError || !ev) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3">
        <p className="text-muted-foreground">ไม่พบงานนี้</p>
        <Button asChild variant="outline">
          <Link to="/admin">กลับไปรายการงาน</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="min-h-dvh pb-16">
      <header className="border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto max-w-6xl px-5 py-4">
          <Link to="/admin" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> งานทั้งหมด
          </Link>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="font-display text-2xl font-semibold">{ev.title}</h1>
              <a
                href={`/e/${ev.slug}/`}
                target="_blank"
                rel="noreferrer"
                className="mt-0.5 inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                /e/{ev.slug} <ExternalLink className="size-3.5" />
              </a>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="gap-1.5 rounded-full px-3 py-1 tabular-nums">
                <CheckCircle2 className="size-3.5 text-emerald-600" /> พร้อมชม{" "}
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={ev.ready}
                    initial={{ scale: 1.4 }}
                    animate={{ scale: 1 }}
                    className="inline-block font-semibold"
                  >
                    {ev.ready.toLocaleString("th-TH")}
                  </motion.span>
                </AnimatePresence>
              </Badge>
              {ev.pending > 0 && (
                <Badge variant="secondary" className="gap-1.5 rounded-full px-3 py-1">
                  <Loader2 className="size-3.5 animate-spin text-amber-600" /> กำลังประมวลผล {ev.pending}
                </Badge>
              )}
              {ev.face_enabled === 1 && (
                <Badge variant="secondary" className="gap-1.5 rounded-full px-3 py-1">
                  <ScanFace className="size-3.5 text-primary" /> หน้า {ev.faces_done.toLocaleString("th-TH")}
                </Badge>
              )}
              {ev.wishes > 0 && (
                <Badge variant="secondary" className="gap-1.5 rounded-full px-3 py-1">
                  <MessageSquareHeart className="size-3.5 text-primary" /> อวยพร {ev.wishes.toLocaleString("th-TH")}
                </Badge>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 pt-8">
        <Tabs defaultValue="photos">
          <TabsList className="mb-8">
            <TabsTrigger value="photos">
              <CloudUpload className="mr-2 size-4" /> รูปและการอัปโหลด
            </TabsTrigger>
            <TabsTrigger value="wishes">
              <MessageSquareHeart className="mr-2 size-4" /> คำอวยพร
            </TabsTrigger>
            <TabsTrigger value="share">
              <QrCode className="mr-2 size-4" /> แชร์ & QR
            </TabsTrigger>
            <TabsTrigger value="settings">
              <Settings2 className="mr-2 size-4" /> ตั้งค่า
            </TabsTrigger>
          </TabsList>

          <TabsContent value="photos" className="space-y-6">
            <Dropzone eventId={ev.id} />
            <AdminGallery eventId={ev.id} />
          </TabsContent>

          <TabsContent value="wishes">
            <WishesPanel ev={ev} />
          </TabsContent>

          <TabsContent value="share">
            <SharePanel ev={ev} />
          </TabsContent>

          <TabsContent value="settings">
            <SettingsPanel ev={ev} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}

// ---------- upload ----------

function Dropzone({ eventId }: { eventId: string }) {
  const qc = useQueryClient()
  const [dragOver, setDragOver] = useState(false)
  const [queue, setQueue] = useState<{ name: string; pct: number; done: boolean; error?: string }[]>([])
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const start = async (files: File[]) => {
    if (files.length === 0) return
    const imgs = files.filter((f) => /\.(jpe?g|png|webp)$/i.test(f.name))
    const skipped = files.length - imgs.length
    if (skipped > 0) toast.warning(`ข้าม ${skipped} ไฟล์ที่ไม่ใช่ jpg/png/webp`)
    if (imgs.length === 0) return
    setUploading(true)
    setQueue(imgs.map((f) => ({ name: f.name, pct: 0, done: false })))
    try {
      const res = await uploadFiles(eventId, imgs, (i, pct) =>
        setQueue((q) => q.map((item, idx) => (idx === i ? { ...item, pct } : item))),
      )
      setQueue((q) => q.map((item) => ({ ...item, done: true, pct: 100 })))
      toast.success(`อัปโหลด ${res.uploaded} รูป${res.duplicated ? ` (ข้ามซ้ำ ${res.duplicated})` : ""} — กำลังประมวลผลให้พร้อมชม`)
      void qc.invalidateQueries({ queryKey: ["event", eventId] })
      void qc.invalidateQueries({ queryKey: ["event-photos", eventId] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "อัปโหลดไม่สำเร็จ")
      setQueue((q) => q.map((x) => (x.done ? x : { ...x, error: "ล้มเหลว" })))
    } finally {
      setUploading(false)
    }
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <motion.div
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            void start(Array.from(e.dataTransfer.files))
          }}
          onClick={() => !uploading && inputRef.current?.click()}
          animate={{
            scale: dragOver ? 1.015 : 1,
            borderColor: dragOver ? "var(--primary)" : "var(--border)",
            backgroundColor: dragOver ? "color-mix(in oklab, var(--primary) 5%, transparent)" : "rgba(0,0,0,0)",
          }}
          transition={{ type: "spring", stiffness: 300, damping: 24 }}
          className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center"
        >
          <motion.div
            animate={dragOver ? { y: -6, scale: 1.15 } : { y: [0, -5, 0], scale: 1 }}
            transition={
              dragOver
                ? { type: "spring", stiffness: 300, damping: 18 }
                : { duration: 2.6, repeat: Infinity, ease: "easeInOut" }
            }
          >
            <UploadCloud className="mb-3 size-9 text-muted-foreground/70" />
          </motion.div>
          <p className="font-medium">ลากรูปมาวางที่นี่ หรือคลิกเพื่อเลือกไฟล์</p>
          <p className="mt-1 text-xs text-muted-foreground">รองรับ JPG / PNG / WebP — หลายร้อยรูปได้ในครั้งเดียว</p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".jpg,.jpeg,.png,.webp,image/*"
            className="hidden"
            onChange={(e) => {
              void start(Array.from(e.target.files ?? []))
              e.target.value = ""
            }}
          />
        </motion.div>
        {queue.length > 0 && (
          <div className="mt-4 max-h-56 space-y-2 overflow-y-auto">
            {queue.map((item, i) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                {item.done && !item.error ? (
                  <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
                ) : item.error ? (
                  <FileWarning className="size-4 shrink-0 text-destructive" />
                ) : (
                  <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
                )}
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{item.name}</span>
                {!item.done && !item.error && <span className="text-xs text-muted-foreground">{item.pct}%</span>}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function AdminGallery({ eventId }: { eventId: string }) {
  const qc = useQueryClient()
  const photosQuery = useQuery({
    queryKey: ["event-photos", eventId],
    queryFn: () => api.get<PhotoList>(`/api/events/${eventId}/photos?limit=500`),
    refetchInterval: 5_000,
  })
  const eventQuery = useQuery({
    queryKey: ["event", eventId],
    queryFn: () => api.get<AdminEvent>(`/api/events/${eventId}`),
  })
  const coverPhotoId = eventQuery.data?.cover_photo_id ?? null
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const del = useMutation({
    mutationFn: (pid: string) => api.del(`/api/photos/${pid}`),
    onSuccess: () => {
      toast.success("ลบรูปแล้ว")
      setPendingDelete(null)
      void qc.invalidateQueries({ queryKey: ["event-photos", eventId] })
      void qc.invalidateQueries({ queryKey: ["event", eventId] })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "ลบไม่สำเร็จ"),
  })
  const setCover = useMutation({
    mutationFn: (photoId: string | null) =>
      api.post<AdminEvent>(`/api/events/${eventId}/cover`, { photo_id: photoId }),
    onSuccess: (_e, photoId) => {
      toast.success(photoId ? "ตั้งเป็นภาพปกอัลบั้มแล้ว — การ์ดแชร์ลิงก์จะใช้รูปนี้" : "เอาภาพปกออกแล้ว (ใช้รูปใหม่สุดแทน)")
      void qc.invalidateQueries({ queryKey: ["event", eventId] })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "ตั้งภาพปกไม่สำเร็จ"),
  })

  const photos = photosQuery.data?.items ?? []

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold">
          รูปทั้งหมด {photosQuery.data ? `(${photosQuery.data.total.toLocaleString("th-TH")})` : ""}
        </h2>
      </div>
      <div className="masonry-3">
        <AnimatePresence mode="popLayout" initial={false}>
          {photos.map((p) => (
            <motion.div
              key={p.id}
              layout
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={{ type: "spring", stiffness: 280, damping: 26 }}
              className="group relative overflow-hidden rounded-xl bg-muted shadow-sm"
            >
              {p.status === "ready" ? (
                <img src={photoUrl(p.id, "thumb")} alt={p.filename} loading="lazy" className="w-full" style={{ aspectRatio: p.width && p.height ? `${p.width} / ${p.height}` : "4 / 5" }} />
              ) : (
                <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 text-muted-foreground">
                  {p.status === "failed" ? (
                    <FileWarning className="size-6 text-destructive" />
                  ) : (
                    <Loader2 className="size-6 animate-spin" />
                  )}
                  <span className="px-3 text-center text-xs">{p.status === "failed" ? p.filename : "กำลังประมวลผล…"}</span>
                </div>
              )}
              <motion.button
                onClick={() => setPendingDelete(p.id)}
                className="absolute right-2 top-2 hidden size-8 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur group-hover:flex"
                title="ลบรูป"
                whileHover={{ scale: 1.15, backgroundColor: "var(--destructive)" }}
                whileTap={{ scale: 0.9 }}
              >
                <Trash2 className="size-4" />
              </motion.button>
              {p.status === "ready" && (
                <motion.button
                  onClick={() => setCover.mutate(coverPhotoId === p.id ? null : p.id)}
                  disabled={setCover.isPending}
                  className={`absolute left-2 top-2 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium backdrop-blur transition-colors ${
                    coverPhotoId === p.id
                      ? "bg-[oklch(84%_0.19_80.46)] text-[oklch(7%_0.006_95)]"
                      : "hidden bg-black/60 text-white group-hover:flex"
                  }`}
                  title={coverPhotoId === p.id ? "เอารูปนี้ออกจากปกอัลบั้ม" : "ตั้งเป็นภาพปกอัลบั้ม (ใช้ในการ์ดแชร์ลิงก์)"}
                  whileTap={{ scale: 0.92 }}
                >
                  <Star className={`size-3.5 ${coverPhotoId === p.id ? "fill-current" : ""}`} />
                  {coverPhotoId === p.id ? "ภาพปกอัลบั้ม" : "ตั้งเป็นปก"}
                </motion.button>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <Dialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>ลบรูปนี้?</DialogTitle>
            <DialogDescription>ไฟล์ต้นฉบับและข้อมูลใบหน้าของรูปนี้จะถูกลบถาวร</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-start">
            <Button variant="destructive" onClick={() => pendingDelete && del.mutate(pendingDelete)} disabled={del.isPending}>
              {del.isPending && <Loader2 className="mr-2 size-4 animate-spin" />} ลบถาวร
            </Button>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              ยกเลิก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------- share / QR ----------

function SharePanel({ ev }: { ev: AdminEvent }) {
  const qc = useQueryClient()
  const origin = window.location.origin
  // When the admin opened this page through a tunnel (/t/<id>/…), share links
  // and the QR must keep the tunnel prefix so guests outside can reach them.
  const tunnelPrefix = (() => {
    const m = document.cookie.match(/(?:^|;\s*)cs_tunnel=([\w-]+)/)
    return m ? `/t/${m[1]}` : ""
  })()
  const guestUrl = `${origin}${tunnelPrefix}/e/${ev.slug}/`
  const agentCmd = `wedsync watch /path/to/photo-folder \\\n  --server ${origin} \\\n  --event ${ev.id} \\\n  --token ${ev.upload_token}`

  const [regenerating, setRegenerating] = useState(false)
  const regen = async () => {
    setRegenerating(true)
    try {
      await api.post(`/api/events/${ev.id}/token`)
      toast.success("สร้าง token ใหม่แล้ว (token เดิมใช้ไม่ได้ทันที)")
      void qc.invalidateQueries({ queryKey: ["event", ev.id] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "สร้างใหม่ไม่สำเร็จ")
    } finally {
      setRegenerating(false)
    }
  }

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`คัดลอก${label}แล้ว`)
    } catch {
      toast.error("คัดลอกไม่สำเร็จ")
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-display text-lg">
            <QrCode className="size-5 text-primary" /> QR สำหรับลูกค้า
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-center rounded-2xl bg-secondary/60 p-6">
            <img
              src={`/api/events/${ev.id}/qr.png?base=${encodeURIComponent(origin)}`}
              alt="QR code"
              className="w-64 rounded-xl bg-white p-3 shadow-sm"
            />
          </div>
          <div className="rounded-xl border border-border p-3">
            <div className="mb-1 text-xs text-muted-foreground">ลิงก์แกลเลอรี</div>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate text-sm">{guestUrl}</code>
              <Button size="icon" variant="ghost" onClick={() => copy(guestUrl, "ลิงก์")}>
                <Copy className="size-4" />
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            ปรินท์ QR ไปติดโต๊ะ/จอในงาน หรือส่งลิงก์ผ่านแชต
            {ev.pin ? ` (งานนี้ล็อกด้วย PIN: ${ev.pin})` : " (ตอนนี้เปิดสาธารณะ จะใส่ PIN ได้ที่แท็บตั้งค่า)"}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-display text-lg">
            <Terminal className="size-5 text-primary" /> Sync จากเครื่องช่างภาพ
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            รันคำสั่งนี้บนเครื่องที่เก็บรูป (สร้าง binary ด้วย <code className="rounded bg-muted px-1.5 py-0.5 text-xs">cargo build -p wedsync-agent</code>)
            แล้วระบบจะอัปโหลดรูปใหม่ทุกใบที่หล่นลงโฟลเดอร์นั้นโดยอัตโนมัติ:
          </p>
          <pre className="overflow-x-auto rounded-xl bg-foreground p-4 text-xs leading-relaxed text-background">
            <code>{agentCmd}</code>
          </pre>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="rounded-full" onClick={() => copy(agentCmd, "คำสั่ง")}>
              <Copy className="mr-2 size-3.5" /> คัดลอกคำสั่ง
            </Button>
            <Button variant="outline" size="sm" className="rounded-full" onClick={regen} disabled={regenerating}>
              {regenerating ? <Loader2 className="mr-2 size-3.5 animate-spin" /> : <KeyRound className="mr-2 size-3.5" />}
              สร้าง token ใหม่
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            token นี้ใช้อัปโหลดเข้างานนี้งานเดียว — เผลอรั่วก็กดสร้างใหม่ได้ทันที
          </p>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-display text-lg">
            <MonitorPlay className="size-5 text-primary" /> โหมดจอใหญ่ (Live Wall)
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <p className="max-w-xl text-sm text-muted-foreground">
            เปิดบนทีวี/โปรเจกเตอร์ในงาน — รูปใหม่ขึ้นจอเองทุกครั้งที่ช่างภาพอัปโหลด
            มีคำอวยพรคั่นเป็นระยะ, QR ให้แขกสแกน และกันจอดับให้อัตโนมัติ
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild className="rounded-full">
              <a href={`${guestUrl}wall`} target="_blank" rel="noreferrer">
                <MonitorPlay className="mr-2 size-4" /> เปิดจอใหญ่
              </a>
            </Button>
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => copy(`${guestUrl}wall`, "ลิงก์จอใหญ่")}
            >
              <Copy className="mr-2 size-4" /> คัดลอกลิงก์จอ
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ---------- guestbook ----------

function WishesPanel({ ev }: { ev: AdminEvent }) {
  const eventId = ev.id
  const qc = useQueryClient()
  const [pendingDelete, setPendingDelete] = useState<WishItem | null>(null)

  const wishesQuery = useQuery({
    queryKey: ["event-wishes", eventId],
    queryFn: () => api.get<WishList>(`/api/events/${eventId}/guestbook`),
    refetchInterval: 10_000,
  })
  const wishes = wishesQuery.data?.items ?? []
  const hiddenCount = wishes.filter((w) => w.hidden).length

  const flashEvent = () => {
    void qc.invalidateQueries({ queryKey: ["event-wishes", eventId] })
    void qc.invalidateQueries({ queryKey: ["event", eventId] })
  }

  const hide = useMutation({
    mutationFn: ({ id, hidden }: { id: string; hidden: boolean }) =>
      api.patch(`/api/events/${eventId}/guestbook/${id}`, { hidden }),
    onSuccess: (_data, vars) => {
      toast.success(vars.hidden ? "ซ่อนคำอวยพรแล้ว — จะไม่ขึ้นบนจอ" : "แสดงคำอวยพรอีกครั้งแล้ว")
      flashEvent()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "ทำรายการไม่สำเร็จ"),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/events/${eventId}/guestbook/${id}`),
    onSuccess: () => {
      toast.success("ลบคำอวยพรแล้ว")
      setPendingDelete(null)
      flashEvent()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "ลบไม่สำเร็จ"),
  })

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold">
            คำอวยพรจากแขก {wishesQuery.data ? `(${wishesQuery.data.total.toLocaleString("th-TH")})` : ""}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            ข้อความถูกเก็บในเครื่องคุณ — ซ่อนเพื่อไม่ให้ขึ้นแกลเลอรีและจอใหญ่
            {hiddenCount > 0 ? ` · ซ่อนอยู่ ${hiddenCount}` : ""}
          </p>
        </div>
        {ev.guestbook_enabled === 0 && (
          <Badge variant="secondary" className="gap-1.5 rounded-full px-3 py-1">
            <EyeOff className="size-3.5 text-muted-foreground" /> ปิดรับคำอวยพรอยู่ — เปิดได้ที่แท็บตั้งค่า
          </Badge>
        )}
      </div>

      {wishesQuery.isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : wishes.length === 0 ? (
        <div className="flex flex-col items-center rounded-3xl border border-dashed border-border py-16 text-center">
          <MessageSquareHeart className="mb-3 size-8 text-primary/70" />
          <h3 className="font-display text-lg font-semibold">ยังไม่มีคำอวยพร</h3>
          <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
            เมื่อแขกเขียนคำอวยพรจากแกลเลอรี ข้อความจะมาแสดงที่นี่และบนจอใหญ่
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <AnimatePresence initial={false}>
            {wishes.map((w) => (
              <motion.figure
                key={w.id}
                layout
                initial={{ opacity: 0, y: 16, scale: 0.97 }}
                animate={{ opacity: w.hidden ? 0.55 : 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ type: "spring", stiffness: 260, damping: 26 }}
                className={`relative overflow-hidden rounded-2xl border p-5 ${
                  w.hidden ? "border-dashed border-border bg-transparent" : "border-border/70 bg-card/60"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="size-1.5 rounded-full bg-gold" />
                    <span className="font-medium text-foreground/85">{w.guest_name}</span>
                    <span aria-hidden>·</span>
                    <span>{timeAgo(w.created_at)}</span>
                    {w.hidden ? (
                      <Badge variant="secondary" className="rounded-full px-2 py-0 text-[10px]">
                        ซ่อนอยู่
                      </Badge>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <motion.button
                      onClick={() => hide.mutate({ id: w.id, hidden: !w.hidden })}
                      disabled={hide.isPending}
                      title={w.hidden ? "แสดงคำอวยพร" : "ซ่อนคำอวยพร"}
                      className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
                      whileTap={{ scale: 0.9 }}
                    >
                      {w.hidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                    </motion.button>
                    <motion.button
                      onClick={() => setPendingDelete(w)}
                      title="ลบคำอวยพร"
                      className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      whileTap={{ scale: 0.9 }}
                    >
                      <Trash2 className="size-4" />
                    </motion.button>
                  </div>
                </div>
                <blockquote className="mt-3 whitespace-pre-wrap font-display text-[17px] leading-relaxed">
                  {w.message}
                </blockquote>
              </motion.figure>
            ))}
          </AnimatePresence>
        </div>
      )}

      <Dialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>ลบคำอวยพรนี้?</DialogTitle>
            <DialogDescription>
              ข้อความจาก {pendingDelete?.guest_name} จะถูกลบถาวร — ถ้าแค่อยากซ่อนจากจอ ให้กดปุ่มรูปตาแทน
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-start">
            <Button
              variant="destructive"
              onClick={() => pendingDelete && remove.mutate(pendingDelete.id)}
              disabled={remove.isPending}
            >
              {remove.isPending && <Loader2 className="mr-2 size-4 animate-spin" />} ลบถาวร
            </Button>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              ยกเลิก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------- settings ----------

function SettingsPanel({ ev }: { ev: AdminEvent }) {
  const qc = useQueryClient()
  const nav = useNavigate()
  const [form, setForm] = useState({
    title: ev.title,
    partner_a: ev.partner_a,
    partner_b: ev.partner_b,
    event_date: ev.event_date,
    slug: ev.slug,
    pin: ev.pin,
    face_enabled: ev.face_enabled === 1,
    guestbook_enabled: ev.guestbook_enabled === 1,
    event_type: ev.event_type,
    theme: ev.theme,
  })
  const tpl = getTemplate(form.event_type)
  const pickType = (v: string) =>
    setForm((f) => ({
      ...f,
      event_type: v,
      theme: f.theme === getTemplate(f.event_type).defaultTheme ? getTemplate(v).defaultTheme : f.theme,
    }))
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const dirty = useMemo(
    () =>
      form.title !== ev.title ||
      form.partner_a !== ev.partner_a ||
      form.partner_b !== ev.partner_b ||
      form.event_date !== ev.event_date ||
      form.slug !== ev.slug ||
      form.pin !== ev.pin ||
      form.face_enabled !== (ev.face_enabled === 1) ||
      form.guestbook_enabled !== (ev.guestbook_enabled === 1) ||
      form.event_type !== ev.event_type ||
      form.theme !== ev.theme,
    [form, ev],
  )

  const save = async () => {
    setSaving(true)
    try {
      await api.patch(`/api/events/${ev.id}`, form)
      toast.success("บันทึกการตั้งค่าแล้ว")
      void qc.invalidateQueries({ queryKey: ["event", ev.id] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ")
    } finally {
      setSaving(false)
    }
  }

  const deleteEvent = async () => {
    setDeleting(true)
    try {
      await api.del(`/api/events/${ev.id}`)
      toast.success(`ลบงาน "${ev.title}" แล้ว`)
      nav("/admin")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ลบไม่สำเร็จ")
      setDeleting(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-lg">ข้อมูลงาน</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>ชื่องาน</Label>
            <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          </div>
          <div className={`grid gap-3 ${tpl.solo ? "" : "sm:grid-cols-2"}`}>
            <div className="space-y-2">
              <Label>{tpl.nameA}</Label>
              <Input value={form.partner_a} onChange={(e) => setForm((f) => ({ ...f, partner_a: e.target.value }))} />
            </div>
            {!tpl.solo && (
              <div className="space-y-2">
                <Label>{tpl.nameB}</Label>
                <Input value={form.partner_b} onChange={(e) => setForm((f) => ({ ...f, partner_b: e.target.value }))} />
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>วันจัดงาน</Label>
              <Input type="date" value={form.event_date} onChange={(e) => setForm((f) => ({ ...f, event_date: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>PIN (เว้นว่าง = สาธารณะ)</Label>
              <Input value={form.pin} maxLength={12} onChange={(e) => setForm((f) => ({ ...f, pin: e.target.value }))} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>ลิงก์ (slug)</Label>
            <Input value={form.slug} onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value.toLowerCase() }))} />
          </div>
          <div className="flex items-center justify-between rounded-xl border border-border p-3.5">
            <div className="flex items-center gap-2.5">
              <ScanFace className="size-4.5 text-primary" />
              <div>
                <div className="text-sm font-medium">ค้นหาด้วยใบหน้า</div>
                <div className="text-xs text-muted-foreground">
                  {form.face_enabled ? "เปิด — ลูกค้าถ่ายเซลฟี่หารูปตัวเองได้" : "ปิด — ลบข้อมูลใบหน้าทั้งหมดของงานนี้"}
                </div>
              </div>
            </div>
            <Switch checked={form.face_enabled} onCheckedChange={(v) => setForm((f) => ({ ...f, face_enabled: v }))} />
          </div>
          <div className="flex items-center justify-between rounded-xl border border-border p-3.5">
            <div className="flex items-center gap-2.5">
              <MessageSquareHeart className="size-4.5 text-primary" />
              <div>
                <div className="text-sm font-medium">สมุดอวยพร</div>
                <div className="text-xs text-muted-foreground">
                  {form.guestbook_enabled
                    ? "เปิด — แขกฝากคำอวยพรได้ และข้อความขึ้นจอ Live Wall"
                    : "ปิด — ซ่อนแท็บคำอวยพรจากแขก (ข้อความเดิมยังอยู่ในระบบ)"}
                </div>
              </div>
            </div>
            <Switch
              checked={form.guestbook_enabled}
              onCheckedChange={(v) => setForm((f) => ({ ...f, guestbook_enabled: v }))}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={save} disabled={saving || !dirty} className="rounded-full">
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />} บันทึก
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="font-display text-lg">ธีมของแกลเลอรี</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <p className="text-sm font-medium">ประเภทงาน</p>
            <EventTypePicker value={form.event_type} onChange={pickType} />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">ธีม</p>
            <ThemePicker value={form.theme} onChange={(v) => setForm((f) => ({ ...f, theme: v }))} tpl={tpl} />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-lg">ดาวน์โหลด</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">ลูกค้าขอไฟล์ทั้งหมด — ดึง zip ไฟล์ต้นฉบับทั้งงาน</p>
            <Button asChild variant="outline" className="rounded-full">
              <a href={`/api/events/${ev.id}/download.zip`}>
                <Download className="mr-2 size-4" /> ดาวน์โหลดทั้งงาน (.zip)
              </a>
            </Button>
          </CardContent>
        </Card>

        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="font-display text-lg text-destructive">โซนอันตราย</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              ลบงานนี้พร้อมรูปทั้งหมด ({ev.total.toLocaleString("th-TH")} รูป) — การกระทำนี้ย้อนกลับไม่ได้
            </p>
            <Button variant="destructive" className="rounded-full" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="mr-2 size-4" /> ลบงานนี้ถาวร
            </Button>
          </CardContent>
        </Card>
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>ลบงาน "{ev.title}" ถาวร?</DialogTitle>
            <DialogDescription>
              รูป {ev.total.toLocaleString("th-TH")} ใบ ไฟล์ต้นฉบับ และข้อมูลใบหน้าทั้งหมดจะถูกลบ ย้อนกลับไม่ได้
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-start">
            <Button variant="destructive" onClick={deleteEvent} disabled={deleting}>
              {deleting && <Loader2 className="mr-2 size-4 animate-spin" />} {deleting ? "กำลังลบ…" : "ใช่ ลบเลย"}
            </Button>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              ยกเลิก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
