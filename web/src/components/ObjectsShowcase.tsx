import { useEffect, useMemo, useRef, useState } from "react"
import {
  AnimatePresence,
  motion,
  useAnimationFrame,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type MotionValue,
} from "motion/react"

/**
 * Hero gallery — the motion.dev "Gallery: Objects" experience as CameraSync's
 * first screen: a tilted, bulged, three-row catalogue of wedding photographs
 * that drifts slowly on its own, can be dragged forever, and opens a spec
 * sheet on click. The landing headline overlays it.
 *
 * Photos are hotlinked from Unsplash with graceful degradation: if Unsplash
 * removes one (404), the card falls back to a neighbouring photo from the
 * pool, then to an inky brand panel — never a broken-image icon.
 */

const CARD_W = 200
const CARD_H = 250
const GAP = 28
const BULGE = 90
const COLUMNS = 8
const DRIFT = 10 // px/s slow-motion auto move

// ---- verified Unsplash wedding photographs (free to use, hotlinked) ----
// One entry per card: NAMES.length === UNSPLASH.length, otherwise `photoIdx`
// wraps and the last row becomes a duplicate of the first.

const UNSPLASH = [
  "1519741497674-611481863552",
  "1465495976277-4387d4b0b4c6",
  "1522673607200-164d1b6ce486",
  "1520854221256-17451cc331bf",
  "1591604466107-ec97de577aff",
  "1606800052052-a08af7148866",
  "1583939003579-730e3918a45a",
  "1519225421980-715cb0215aed",
  "1510076857177-7470076d4098",
  "1529636798458-92182e662485",
  "1532712938310-34cb3982ef74",
  "1515934751635-c81c6bc9a2d8",
  "1537633552985-df8429e8048b",
  "1474552226712-ac0f0961a954",
  "1522057384400-681b421cfebc",
  "1550005809-91ad75fb315f",
  "1731603827045-75fea9c24e31",
  "1767201226872-6beb8f211e9c",
  "1614780484212-397fc21a6fa0",
  "1769540241663-920ac32da75f",
  "1759581620687-8e3d6691d64e",
  "1672289508233-f393cb329b0b",
  "1769251296969-a4c7aa0b4478",
  "1762319981432-609103ab4a75",
]

const NAMES: [string, string, string, string][] = [
  ["พิธีลงทะเบียน", "First look", "35mm", "แสงเช้า"],
  ["แหวนและช่อดอกไม้", "Detail", "85mm macro", "แสงนุ่ม"],
  ["พระอาทิตย์ตก", "Portrait", "50mm", "โฮมเรือง"],
  ["เดินลงแถว", "Processional", "24mm", "แสงธรรมชาติ"],
  ["พิธีจูนใจ", "Ceremony", "70mm", "แบ็กไลต์"],
  ["ของชำร่วย", "Detail", "60mm", "แสงไฟร้าน"],
  ["งานเลี้ยงค่ำ", "Reception", "35mm", "แสงเทียน"],
  ["คู่รักสีทอง", "Portrait", "85mm", "สตูดิโอ"],
  ["จัดดอกไม้", "Detail", "100mm macro", "แสงหน้าต่าง"],
  ["วอลซ์แรก", "Reception", "35mm", "สีทองอุ่น"],
  ["ถนนสีครีม", "Portrait", "85mm", "บ่ายเย็น"],
  ["เตรียมเจ้าสาว", "Preparation", "50mm", "หน้าต่างริมฝน"],
  ["คนในงาน", "Candid", "35mm", "แสงในสวน"],
  ["เชิญขึ้นเวที", "Speeches", "24mm", "แสงเวที"],
  ["ดอกไม้บนโต๊ะ", "Detail", "60mm", "แสงชาม"],
  ["กล่าวลา", "Farewell", "85mm", "ไฟสปาร์กเกลอร์"],
  ["ชุดไทยสีงาช้าง", "Portrait", "50mm", "สตูดิโอ"],
  ["บ้านไม้เก่า", "Location", "24mm", "แสงเช้า"],
  ["พาสปอร์ตรัก", "Detail", "100mm", "ขาวดำ"],
  ["รุ่งอรุณใหม่", "Portrait", "35mm", "น้ำเงินหม่น"],
  ["งานเลี้ยงกลางแจ้ง", "Reception", "24mm", "สตริงไฟ"],
  ["มือที่จับมือ", "Candid", "85mm", "แสงนุ่ม"],
  ["ของขวัญเล็ก ๆ", "Detail", "60mm", "แสงกระจก"],
  ["บทสรุปของคืน", "Finale", "35mm", "โบเก้ทอง"],
]

type Item = { id: string; name: string; cat: string; lens: string; light: string; photoIdx: number }

const ITEMS: Item[] = NAMES.map(([name, cat, lens, light], i) => ({
  id: `cs-${i}`,
  name,
  cat,
  lens,
  light,
  photoIdx: i % UNSPLASH.length,
}))

const code = (i: number) => `CS26—${String(i + 1).padStart(2, "0")}`
const src = (idx: number, w = 520) =>
  `https://images.unsplash.com/photo-${UNSPLASH[idx % UNSPLASH.length]}?q=80&w=${w}&auto=format&fit=crop`

function GalleryCard({
  item,
  index,
  scrollX,
  centerOffset,
  onOpen,
  dimmed,
}: {
  item: Item
  index: number
  scrollX: MotionValue<number>
  centerOffset: number
  onOpen: () => void
  dimmed: boolean
}) {
  // fallback chain: photo → neighbour photo (Unsplash deletes images over
  // time) → brand panel. Never a broken-image icon.
  const [tier, setTier] = useState(0) // 0 primary, 1 neighbour, 2 panel
  const neighbour = (item.photoIdx + 5) % UNSPLASH.length

  // cylindrical bulge — cards bow toward the viewer near the viewport centre
  const z = useTransform(scrollX, (sx) => {
    const d = Math.abs(centerOffset + sx)
    return Math.max(0, BULGE * (1 - d / 950))
  })
  const scale = useTransform(z, [0, BULGE], [0.955, 1.035])

  // distinguish click from drag on the shared surface
  const down = useRef<{ x: number; y: number } | null>(null)

  return (
    <motion.button
      onPointerDown={(e) => (down.current = { x: e.clientX, y: e.clientY })}
      onClick={(e) => {
        const d = down.current
        if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) return // was a drag
        onOpen()
      }}
      className="group relative block shrink-0 cursor-grab overflow-hidden rounded-md bg-card p-1.5 text-left ring-1 ring-[oklch(78%_0_0/0.16)] outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
      style={{ width: CARD_W, height: CARD_H, z, scale }}
      animate={{ opacity: dimmed ? 0.25 : 1 }}
      whileHover={{ scale: 1.05 }}
      transition={{ type: "spring", stiffness: 260, damping: 26 }}
    >
      {tier < 2 ? (
        <img
          src={tier === 0 ? src(item.photoIdx) : src(neighbour)}
          alt={`${item.name} — ${item.cat}`}
          draggable={false}
          loading="lazy"
          onError={() => setTier((t) => t + 1)}
          className="pointer-events-none h-full w-full select-none rounded-sm object-cover"
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center rounded-sm bg-secondary">
          <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">CAMERASYNC</span>
        </span>
      )}
      <span className="pointer-events-none absolute left-3 top-2.5 font-mono text-[9.5px] tracking-[0.18em] text-gold drop-shadow-[0_1px_2px_rgba(0,0,0,.9)]">
        {code(index)}
      </span>
    </motion.button>
  )
}

/** inspection layer — big photo + spec sheet (the "Detail" of the original) */
function SpecLayer({
  item,
  index,
  onClose,
}: {
  item: Item
  index: number
  onClose: () => void
}) {
  const [tier, setTier] = useState(0)
  const neighbour = (item.photoIdx + 5) % UNSPLASH.length

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        className="absolute inset-0 bg-lacquer-deep/85 backdrop-blur-sm"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />
      <motion.div
        className="relative z-10 flex max-h-[88dvh] w-full max-w-3xl flex-col gap-6 overflow-y-auto rounded-lg border border-[var(--rule-strong)] bg-card p-5 sm:flex-row sm:p-6"
        initial={{ opacity: 0, y: 30, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 18, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 280, damping: 28 }}
      >
        <motion.img
          src={tier === 0 ? src(item.photoIdx, 900) : src(neighbour, 900)}
          alt={item.name}
          onError={() => setTier(1)}
          className="max-h-[50dvh] w-full rounded-sm border border-[var(--rule)] object-cover sm:w-[52%]"
          initial={{ opacity: 0, scale: 1.04 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.05, duration: 0.4 }}
        />
        <motion.div
          className="flex flex-1 flex-col"
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ type: "spring", stiffness: 300, damping: 28, delay: 0.08 }}
        >
          <p className="flex items-center justify-between font-mono text-[10.5px] tracking-[0.18em] text-gold">
            {code(index)}
            <span className="text-muted-foreground">
              {String(index + 1).padStart(2, "0")} / {String(ITEMS.length).padStart(2, "0")}
            </span>
          </p>
          <h3 className="mt-3 font-display text-2xl font-light text-foreground">{item.name}</h3>
          <dl className="mt-5 space-y-3 border-t border-[var(--rule)] pt-4 text-[13px]">
            {[
              ["หมวด", item.cat],
              ["เลนส์", item.lens],
              ["แสง", item.light],
              ["สถานะ", "ขึ้นเว็บทันทีที่ถ่ายเสร็จ"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4">
                <dt className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-muted-foreground">{k}</dt>
                <dd className="text-right text-foreground">{v}</dd>
              </div>
            ))}
          </dl>
          <button
            onClick={onClose}
            className="mt-6 self-start border-b border-gold font-mono text-[11px] uppercase tracking-[0.18em] text-gold transition-opacity hover:opacity-75"
          >
            Close · ปิด
          </button>
        </motion.div>
      </motion.div>
    </motion.div>
  )
}

export function ObjectsShowcase() {
  const reduced = useReducedMotion()
  const [open, setOpen] = useState<{ item: Item; index: number } | null>(null)

  const rows = useMemo(() => {
    const out: Item[][] = []
    for (let i = 0; i < ITEMS.length; i += COLUMNS) out.push(ITEMS.slice(i, i + COLUMNS))
    return out.slice(0, 3) // exactly three rows
  }, [])

  const setWidth = COLUMNS * (CARD_W + GAP)
  const x = useMotionValue(-setWidth / 3)
  const dragging = useRef(false)
  const hoverSlow = useRef(false)

  // slow-motion auto drift + infinite wrap; drag writes the same value
  useAnimationFrame((_, delta) => {
    if (reduced || dragging.current) return
    const d = Math.min(delta, 50) / 1000
    let v = x.get() - DRIFT * (hoverSlow.current ? 0.15 : 1) * d
    if (v <= -setWidth) v += setWidth
    if (v > 0) v -= setWidth
    x.set(v)
  })

  const onDrag = () => {
    const v = x.get()
    if (v <= -setWidth) x.jump(v + setWidth)
    else if (v > 0) x.jump(v - setWidth)
  }

  return (
    <section className="relative h-[100svh] min-h-[640px] overflow-hidden border-b border-[var(--rule)] bg-lacquer-deep">
      {/* tilted, bulged plane — auto-drifts slowly, drag to browse */}
      <div style={{ perspective: 1600 }} className="absolute inset-0 flex items-center">
        <motion.div
          className="w-full"
          style={{ rotateX: reduced ? 0 : 26, rotateZ: reduced ? 0 : -7, scale: 1.04 }}
        >
          <motion.div
            className="flex cursor-grab flex-col items-center gap-7 active:cursor-grabbing"
            style={{ x: reduced ? 0 : x }}
            drag={reduced ? false : "x"}
            dragElastic={0.1}
            dragMomentum
            onDrag={onDrag}
            onDragStart={() => (dragging.current = true)}
            onDragEnd={() => {
              // let momentum settle before the drift resumes
              setTimeout(() => (dragging.current = false), 2200)
            }}
            onHoverStart={() => (hoverSlow.current = true)}
            onHoverEnd={() => (hoverSlow.current = false)}
          >
            {rows.map((row, r) => (
              <div key={r} className="flex" style={{ gap: GAP }}>
                {[...row, ...row, ...row].map((it, c) => {
                  const canonical = r * COLUMNS + (c % row.length)
                  const copy = Math.floor(c / row.length)
                  const cardCenter = c * (CARD_W + GAP) + CARD_W / 2 - copy * setWidth - setWidth
                  return (
                    <div key={c} style={{ marginLeft: r % 2 === 1 && c === 0 ? (CARD_W + GAP) / 2 : 0 }}>
                      <GalleryCard
                        item={it}
                        index={canonical}
                        scrollX={x}
                        centerOffset={cardCenter}
                        onOpen={() => setOpen({ item: it, index: canonical })}
                        dimmed={open !== null}
                      />
                    </div>
                  )
                })}
              </div>
            ))}
          </motion.div>
        </motion.div>
      </div>

      {/* readability scrim for the overlaid headline */}
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(58%_46%_at_50%_40%,oklch(4%_0.004_95/0.62),transparent_75%)]"
        aria-hidden
      />

      <AnimatePresence>
        {open && <SpecLayer key={open.item.id} item={open.item} index={open.index} onClose={() => setOpen(null)} />}
      </AnimatePresence>
    </section>
  )
}
