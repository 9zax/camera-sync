import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { AnimatePresence, motion } from "motion/react"
import {
  CalendarDays,
  Images,
  Loader2,
  LogOut,
  Plus,
  QrCode,
  ScanFace,
  Sparkles,
} from "lucide-react"
import { toast } from "sonner"
import { LogoMark } from "@/components/Logo"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { api, photoUrl, type AdminEvent, type PhotoList } from "@/lib/api"
import { formatEventDate } from "@/lib/format"

export default function AdminPage() {
  const statusQuery = useQuery({
    queryKey: ["auth-status"],
    queryFn: () => api.get<{ needs_setup: boolean }>("/api/auth/status"),
  })
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<{ username: string }>("/api/auth/me"),
    retry: false,
  })

  if (statusQuery.isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 className="size-7 animate-spin text-primary" />
      </div>
    )
  }

  if (statusQuery.data?.needs_setup) return <SetupCard />
  if (meQuery.isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 className="size-7 animate-spin text-primary" />
      </div>
    )
  }
  if (meQuery.isError || !meQuery.data) return <LoginCard />

  return <EventsView username={meQuery.data.username} />
}

// ---------- first run: create admin ----------

function SetupCard() {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const qc = useQueryClient()
  const setup = useMutation({
    mutationFn: () => api.post("/api/auth/setup", { username, password }),
    onSuccess: () => {
      toast.success("สร้างบัญชีผู้ดูแลสำเร็จ ยินดีต้อนรับ 🎉")
      void qc.invalidateQueries()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "สร้างบัญชีไม่สำเร็จ"),
  })
  return (
    <AuthShell
      title="ยินดีต้อนรับสู่ CameraSync"
      subtitle="การใช้งานครั้งแรก — สร้างบัญชีผู้ดูแล (ช่างภาพ) ก่อนเริ่มงานแรก"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          setup.mutate()
        }}
        className="space-y-4"
      >
        <div className="space-y-2">
          <Label htmlFor="su-username">ชื่อผู้ใช้</Label>
          <Input id="su-username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="studio-admin" required minLength={3} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="su-password">รหัสผ่าน</Label>
          <Input id="su-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="อย่างน้อย 6 ตัวอักษร" required minLength={6} />
        </div>
        <Button type="submit" disabled={setup.isPending} className="h-11 w-full rounded-full">
          {setup.isPending && <Loader2 className="mr-2 size-4 animate-spin" />} สร้างบัญชีและเริ่มใช้งาน
        </Button>
      </form>
    </AuthShell>
  )
}

function LoginCard() {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const qc = useQueryClient()
  const login = useMutation({
    mutationFn: () => api.post("/api/auth/login", { username, password }),
    onSuccess: () => {
      void qc.invalidateQueries()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "เข้าสู่ระบบไม่สำเร็จ"),
  })
  return (
    <AuthShell title="เข้าสู่ระบบ" subtitle="สำหรับช่างภาพ / สตูดิโอ — จัดการงาน อัปโหลดรูป และ QR">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          login.mutate()
        }}
        className="space-y-4"
      >
        <div className="space-y-2">
          <Label htmlFor="lg-username">ชื่อผู้ใช้</Label>
          <Input id="lg-username" value={username} onChange={(e) => setUsername(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lg-password">รหัสผ่าน</Label>
          <Input id="lg-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <Button type="submit" disabled={login.isPending} className="h-11 w-full rounded-full">
          {login.isPending && <Loader2 className="mr-2 size-4 animate-spin" />} เข้าสู่ระบบ
        </Button>
      </form>
    </AuthShell>
  )
}

function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-secondary/40 px-5">
      <Card className="w-full max-w-sm">
        <CardContent className="pt-8">
          <Link to="/" className="mb-6 flex items-center justify-center gap-2">
            <LogoMark size={34} />
            <span className="font-display text-xl font-semibold">CameraSync</span>
          </Link>
          <h1 className="text-center font-display text-xl font-semibold">{title}</h1>
          <p className="mb-6 mt-1.5 text-center text-sm text-muted-foreground">{subtitle}</p>
          {children}
        </CardContent>
      </Card>
    </div>
  )
}

// ---------- events overview ----------

function EventsView({ username }: { username: string }) {
  const qc = useQueryClient()
  const eventsQuery = useQuery({
    queryKey: ["events"],
    queryFn: () => api.get<AdminEvent[]>("/api/events"),
    refetchInterval: 10_000,
  })
  const logout = useMutation({
    mutationFn: () => api.post("/api/auth/logout"),
    onSuccess: () => void qc.invalidateQueries(),
  })

  return (
    <div className="min-h-dvh">
      <header className="border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link to="/admin" className="flex items-center gap-2.5">
            <LogoMark size={34} />
            <div className="leading-tight">
              <div className="font-display text-lg font-semibold">CameraSync</div>
              <div className="-mt-0.5 text-[11px] text-muted-foreground">สวัสดี {username}</div>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            <CreateEventDialog />
            <Button variant="ghost" size="icon" onClick={() => logout.mutate()} title="ออกจากระบบ">
              <LogOut className="size-4.5" />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-10">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="font-display text-2xl font-semibold">งานทั้งหมด</h1>
            <p className="mt-1 text-sm text-muted-foreground">หนึ่งงาน = หนึ่ง drive รูป พร้อม QR และ face search ของตัวเอง</p>
          </div>
        </div>

        {eventsQuery.isLoading ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="animate-pulse">
                <CardContent className="pt-5">
                  <div className="mb-4 h-36 rounded-xl bg-muted" />
                  <div className="h-5 w-2/3 rounded bg-muted" />
                  <div className="mt-2 h-4 w-1/3 rounded bg-muted" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : !eventsQuery.data || eventsQuery.data.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
            className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-border py-20 text-center"
          >
            <span className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/10">
              <Sparkles className="size-7 text-primary" />
            </span>
            <h3 className="font-display text-xl font-semibold">ยังไม่มีงาน — สร้างงานแรกเลย</h3>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">
              ตั้งชื่องาน วันแต่ง แล้วเราจะสร้างลิงก์ + QR + upload token ให้พร้อมใช้ทันที
            </p>
            <div className="mt-6">
              <CreateEventDialog />
            </div>
          </motion.div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {eventsQuery.data.map((ev, i) => (
              <EventCard key={ev.id} event={ev} index={i} />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

function EventCard({ event, index = 0 }: { event: AdminEvent; index?: number }) {
  const qc = useQueryClient()
  const photosQuery = useQuery({
    queryKey: ["event-cover", event.id],
    queryFn: () => api.get<PhotoList>(`/api/events/${event.id}/photos?status=ready&limit=1`),
  })
  const [qrOpen, setQrOpen] = useState(false)
  const toggle = useMutation({
    mutationFn: () => api.post(`/api/events/${event.id}/enabled`, { enabled: event.enabled === 0 }),
    onSuccess: () => {
      toast.success(event.enabled === 0 ? "เปิดใช้งานลิงก์แล้ว" : "พักลิงก์แล้ว — ลูกค้าจะเห็นว่าปิดชั่วคราว")
      void qc.invalidateQueries({ queryKey: ["events"] })
    },
    onError: (e) => toast.error(String(e)),
  })
  const remove = useMutation({
    mutationFn: () => api.del(`/api/events/${event.id}`),
    onSuccess: () => {
      toast.success("ลบงานเรียบร้อย")
      void qc.invalidateQueries({ queryKey: ["events"] })
    },
    onError: (e) => toast.error(String(e)),
  })
  const cover = photosQuery.data?.items?.[0]
  const couple = [event.partner_a, event.partner_b].filter(Boolean).join(" ♥ ")
  const offline = event.enabled === 0
  const qrSrc = `/api/events/${event.id}/qr.png?base=${encodeURIComponent(window.location.origin)}`
  return (
    <motion.div
      initial={{ opacity: 0, y: 26 }}
      animate={{ opacity: 1, y: 0, scale: offline ? 0.97 : 1 }}
      transition={{ duration: 0.5, delay: index * 0.07, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -5 }}
      className={offline ? "opacity-70" : undefined}
    >
      <Card className="h-full overflow-hidden transition-shadow hover:shadow-lg">
        <Link to={`/admin/events/${event.id}`} className="group block">
          <div className="relative h-40 overflow-hidden bg-gradient-to-br from-secondary to-muted">
            {cover ? (
              <motion.img
                src={photoUrl(cover.id, "thumb")}
                alt=""
                className="h-full w-full object-cover opacity-90"
                whileHover={{ scale: 1.06 }}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground/50">
                <Images className="size-8" />
              </div>
            )}
            <AnimatePresence>
              {event.pending > 0 && (
                <motion.span
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="absolute right-2 top-2 flex items-center gap-1.5 rounded-full bg-black/65 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur"
                >
                  <Loader2 className="size-3 animate-spin" /> กำลังประมวลผล {event.pending}
                </motion.span>
              )}
            </AnimatePresence>
            {offline && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="absolute left-2 top-2 rounded-full bg-patina/90 px-2.5 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-lacquer-deep backdrop-blur"
              >
                ออฟไลน์ — พักลิงก์ชั่วคราว
              </motion.span>
            )}
          </div>
          <CardContent className="pt-4">
            <h3 className="truncate font-display text-lg font-semibold group-hover:text-primary">{event.title}</h3>
            {couple && <p className="-mt-0.5 truncate text-sm text-primary">{couple}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {event.event_date && (
                <span className="flex items-center gap-1">
                  <CalendarDays className="size-3.5" /> {formatEventDate(event.event_date)}
                </span>
              )}
              <span className="flex items-center gap-1 tabular-nums">
                <Images className="size-3.5" /> {event.ready.toLocaleString("th-TH")}/{event.total.toLocaleString("th-TH")} รูป
              </span>
              {event.face_enabled === 1 && (
                <span className="flex items-center gap-1 tabular-nums">
                  <ScanFace className="size-3.5" /> face {event.faces_done.toLocaleString("th-TH")}
                </span>
              )}
            </div>
          </CardContent>
        </Link>
        <div className="flex items-center gap-1.5 px-5 pb-4 pt-1">
          <Button variant="outline" size="sm" className="h-8 gap-1.5 rounded-md px-2.5 text-xs" onClick={() => setQrOpen(true)}>
            <QrCode className="size-3.5" /> QR
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 rounded-md px-2.5 text-xs"
            disabled={toggle.isPending}
            onClick={() => toggle.mutate()}
          >
            {offline ? "เปิดใช้งานลิงก์" : "พักลิงก์"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-8 gap-1 rounded-md px-2.5 text-xs text-destructive hover:text-destructive"
            disabled={remove.isPending}
            onClick={() => {
              if (confirm(`ลบงาน "${event.title}" ? ลิงก์ลูกค้าจะใช้ไม่ได้ทันที`)) remove.mutate()
            }}
          >
            ลบ
          </Button>
        </div>
      </Card>

      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>QR — {event.title}</DialogTitle>
            <DialogDescription className="break-all font-mono text-[11px]">
              {window.location.origin}/e/{event.slug}
            </DialogDescription>
          </DialogHeader>
          <motion.img
            src={qrSrc}
            alt="QR"
            className="mx-auto w-56 rounded-xl border border-border"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 24 }}
          />
          <a href={qrSrc} download={`CameraSync-${event.slug}-qr.png`}>
            <Button className="w-full">ดาวน์โหลด QR</Button>
          </a>
        </DialogContent>
      </Dialog>
    </motion.div>
  )
}

function CreateEventDialog() {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    title: "",
    partner_a: "",
    partner_b: "",
    event_date: "",
    pin: "",
    face_enabled: true,
  })
  const qc = useQueryClient()
  const create = useMutation({
    mutationFn: () =>
      api.post<AdminEvent>("/api/events", {
        ...form,
        title: form.title.trim(),
      }),
    onSuccess: (ev) => {
      toast.success(`สร้างงาน "${ev.title}" แล้ว`)
      setOpen(false)
      setForm({ title: "", partner_a: "", partner_b: "", event_date: "", pin: "", face_enabled: true })
      void qc.invalidateQueries({ queryKey: ["events"] })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "สร้างงานไม่สำเร็จ"),
  })
  const set = (k: keyof typeof form) => (v: string | boolean) => setForm((f) => ({ ...f, [k]: v }))

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="rounded-full">
          <Plus className="mr-2 size-4" /> สร้างงานใหม่
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">สร้างงานใหม่</DialogTitle>
          <DialogDescription>ระบบจะสร้างลิงก์สาธารณะ + QR + upload token ให้อัตโนมัติ</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate()
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="ev-title">ชื่องาน *</Label>
            <Input id="ev-title" value={form.title} onChange={(e) => set("title")(e.target.value)} placeholder="งานแต่งภูมิ & ใบหมี" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="ev-a">คู่สมรส A</Label>
              <Input id="ev-a" value={form.partner_a} onChange={(e) => set("partner_a")(e.target.value)} placeholder="ภูมิ" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ev-b">คู่สมรส B</Label>
              <Input id="ev-b" value={form.partner_b} onChange={(e) => set("partner_b")(e.target.value)} placeholder="ใบหมี" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="ev-date">วันจัดงาน</Label>
              <Input id="ev-date" type="date" value={form.event_date} onChange={(e) => set("event_date")(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ev-pin">PIN (ไม่บังคับ)</Label>
              <Input id="ev-pin" value={form.pin} onChange={(e) => set("pin")(e.target.value)} placeholder="เช่น 1208" maxLength={12} />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-border p-3.5">
            <div className="flex items-center gap-2.5">
              <ScanFace className="size-4.5 text-primary" />
              <div>
                <div className="text-sm font-medium">เปิดค้นหาด้วยใบหน้า</div>
                <div className="text-xs text-muted-foreground">ลูกค้าถ่ายเซลฟี่หารูปตัวเองได้</div>
              </div>
            </div>
            <Switch checked={form.face_enabled} onCheckedChange={(v) => set("face_enabled")(v)} />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              ยกเลิก
            </Button>
            <Button type="submit" disabled={create.isPending || !form.title.trim()} className="rounded-full">
              {create.isPending && <Loader2 className="mr-2 size-4 animate-spin" />} สร้างงาน
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
