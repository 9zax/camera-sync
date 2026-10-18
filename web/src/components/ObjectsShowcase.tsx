import { useRef, useState } from "react"
import {
  AnimatePresence,
  motion,
  useAnimationFrame,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  useVelocity,
} from "motion/react"

/**
 * "Objects" showcase for the landing page — a tilted, infinitely drifting
 * catalogue of photo cards in the spirit of motion.dev's gallery objects:
 * scrolling the page pushes the stream, hovering lifts a card out of the
 * plane and reveals its spec sheet, tapping picks it up with a springy wiggle.
 */

const CARD_W = 176
const CARD_H = 226
const GAP = 20
const BASE_SPEED = 34 // px/s idle drift

// ---- deterministic "abstract wedding light" card art (inline SVG, no assets) ----

const PALETTES: [string, string, string][] = [
  ["#A0685F", "#7E4E49", "#E9C46A"],
  ["#B98A82", "#8E5A54", "#F3E3C3"],
  ["#8E6A5A", "#5F463E", "#E9C46A"],
  ["#C4A48A", "#96705B", "#FAF7F2"],
  ["#A97E6F", "#75504A", "#EFD9B4"],
  ["#9C7A73", "#6B514C", "#E9C46A"],
]

function art(i: number): string {
  const p = PALETTES[i % PALETTES.length]
  const r = (n: number) => {
    // tiny deterministic hash → 0..1
    const v = Math.sin(i * 97.13 + n * 41.7) * 10000
    return v - Math.floor(v)
  }
  const hearts = i % 3 === 0
  const rings = !hearts && i % 3 === 1
  return (
    `data:image/svg+xml;utf8,` +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="352" height="452" viewBox="0 0 352 452">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="${p[0]}"/><stop offset="1" stop-color="${p[1]}"/>
          </linearGradient>
          <radialGradient id="glow" cx="0.5" cy="0.35">
            <stop offset="0" stop-color="${p[2]}" stop-opacity="0.85"/>
            <stop offset="1" stop-color="${p[2]}" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <rect width="352" height="452" fill="url(#g)"/>
        <circle cx="${80 + r(1) * 180}" cy="${90 + r(2) * 120}" r="${120 + r(3) * 90}" fill="url(#glow)"/>
        <circle cx="${40 + r(4) * 260}" cy="${240 + r(5) * 160}" r="${60 + r(6) * 70}" fill="${p[2]}" opacity="0.14"/>
        <circle cx="${30 + r(7) * 280}" cy="${40 + r(8) * 120}" r="${24 + r(9) * 40}" fill="#FAF7F2" opacity="0.2"/>
        ${
          hearts
            ? `<path d="M176 300 C 128 262 100 236 100 204 C 100 180 119 163 141 163 C 156 163 168 171 176 183 C 184 171 196 163 211 163 C 233 163 252 180 252 204 C 252 236 224 262 176 300 Z" fill="#FAF7F2" opacity="0.9"/>`
            : rings
              ? `<g fill="none" stroke="#FAF7F2" stroke-width="10" opacity="0.85">
                   <circle cx="150" cy="250" r="44"/><circle cx="202" cy="250" r="44"/>
                 </g>`
              : `<g stroke="${p[2]}" stroke-width="6" opacity="0.7" fill="none">
                   <circle cx="176" cy="230" r="86"/><circle cx="176" cy="230" r="58"/>
                 </g>`
        }
      </svg>`,
    )
  )
}

const SPECS = [
  ["24mm · f/1.8 · ISO 640", "ขึ้นสด 18:42 น.", "เจอคุณใน 12 รูป ✓"],
  ["50mm · f/2.8 · ISO 400", "ขึ้นสด 19:05 น.", "ไม่มีลายน้ำ ✓"],
  ["85mm · f/1.4 · ISO 800", "ขึ้นสด 19:31 น.", "ดาวน์โหลดเต็มคุณภาพ"],
  ["35mm · f/2 · ISO 500", "ขึ้นสด 20:02 น.", "ค้นด้วยเซลฟี่ 5 วิ"],
  ["70mm · f/2.8 · ISO 320", "ขึ้นสด 20:47 น.", "PIN กันคนนอก ✓"],
]

const CARDS = Array.from({ length: 12 }, (_, i) => ({
  art: art(i),
  specs: SPECS[i % SPECS.length],
  tilt: (i % 5) - 2, // resting tilt -2..2deg for a scattered feel
}))

function Card({
  card,
  picked,
  onPick,
}: {
  card: (typeof CARDS)[number]
  picked: boolean
  onPick: () => void
}) {
  const [hover, setHover] = useState(false)
  return (
    <motion.button
      onClick={onPick}
      onHoverStart={() => setHover(true)}
      onHoverEnd={() => setHover(false)}
      className="group relative block shrink-0 cursor-grab rounded-2xl bg-card p-1.5 text-left ring-1 ring-[oklch(78%_0_0/0.16)] outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
      style={{ width: CARD_W, height: CARD_H, transformPerspective: 900, zIndex: picked ? 30 : hover ? 20 : 1 }}
      animate={
        picked
          ? { rotate: [0, -4, 3, -1.5, 0], scale: 1.12, y: -34, opacity: 1 }
          : { rotate: hover ? 0 : card.tilt, scale: hover ? 1.08 : 1, y: hover ? -30 : 0, opacity: 1 }
      }
      transition={{ type: "spring", stiffness: 260, damping: 20 }}
    >
      <img
        src={card.art}
        alt=""
        draggable={false}
        className="pointer-events-none h-full w-full select-none rounded-xl object-cover"
      />
      {/* spec sheet — slides up on hover / pick */}
      <AnimatePresence>
        {(hover || picked) && (
          <motion.div
            key="spec"
            className="absolute inset-x-3 bottom-3 rounded-xl bg-background/85 p-2.5 shadow-lg backdrop-blur-md"
            initial={{ opacity: 0, y: 24, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: 16, filter: "blur(6px)" }}
            transition={{ type: "spring", stiffness: 300, damping: 26 }}
          >
            {card.specs.map((s, k) => (
              <motion.div
                key={s}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.05 + k * 0.06 }}
                className={
                  k === 0
                    ? "font-mono text-[10px] text-muted-foreground"
                    : "text-[11px] font-medium text-foreground"
                }
              >
                {s}
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      <span className="pointer-events-none absolute right-2.5 top-2.5 size-1.5 rounded-full bg-white/70 opacity-0 transition-opacity group-hover:opacity-100" />
    </motion.button>
  )
}

function DriftRow({ dir, scrollBoost }: { dir: 1 | -1; scrollBoost: ReturnType<typeof useSpring> }) {
  const x = useMotionValue(0)
  const slow = useRef(false)
  const set = CARDS.length * (CARD_W + GAP) // width of one full set
  useAnimationFrame((_, delta) => {
    const d = Math.min(delta, 50) / 1000
    const boost = Math.min(Math.abs(scrollBoost.get()) * 0.55, 620)
    const speed = (BASE_SPEED + boost) * (slow.current ? 0.12 : 1)
    let v = x.get() + dir * speed * d
    v = (((v % set) + set) % set) - set // keep in (-set, 0]
    x.set(v)
  })
  return (
    <motion.div
      className="flex py-2.5"
      style={{ x }}
      onHoverStart={() => (slow.current = true)}
      onHoverEnd={() => (slow.current = false)}
    >
      {[...CARDS, ...CARDS, ...CARDS].map((c, i) => (
        <div key={i} style={{ marginRight: GAP }}>
          <DriftCard card={c} />
        </div>
      ))}
    </motion.div>
  )
}

// row card without pick state (rows are ambient); picking belongs to hero cards
function DriftCard({ card }: { card: (typeof CARDS)[number] }) {
  const [hover, setHover] = useState(false)
  return (
    <motion.button
      onHoverStart={() => setHover(true)}
      onHoverEnd={() => setHover(false)}
      className="group relative block shrink-0 cursor-grab rounded-2xl bg-card p-1.5 text-left ring-1 ring-[oklch(78%_0_0/0.16)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{ width: CARD_W, height: CARD_H, transformPerspective: 900, zIndex: hover ? 20 : 1 }}
      animate={{ rotate: hover ? 0 : card.tilt, scale: hover ? 1.07 : 1, y: hover ? -26 : 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 20 }}
    >
      <img src={card.art} alt="" draggable={false} className="pointer-events-none h-full w-full select-none rounded-xl object-cover" />
      <AnimatePresence>
        {hover && (
          <motion.div
            key="spec"
            className="absolute inset-x-3 bottom-3 rounded-xl bg-background/85 p-2.5 shadow-lg backdrop-blur-md"
            initial={{ opacity: 0, y: 24, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: 16, filter: "blur(6px)" }}
            transition={{ type: "spring", stiffness: 300, damping: 26 }}
          >
            {card.specs.map((s, k) => (
              <motion.div
                key={s}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.05 + k * 0.06 }}
                className={k === 0 ? "font-mono text-[10px] text-muted-foreground" : "text-[11px] font-medium text-foreground"}
              >
                {s}
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.button>
  )
}

export function ObjectsShowcase() {
  const reduced = useReducedMotion()
  const { scrollY } = useScroll()
  const velocity = useVelocity(scrollY)
  const boost = useSpring(velocity, { stiffness: 90, damping: 40 })
  const [picked, setPicked] = useState<number | null>(null)

  // hero row: interactive, pick-up-able cards (the "collection catalogue")
  const heroX = useMotionValue(0)
  const set = CARDS.length * (CARD_W + GAP)
  const heroSlow = useRef(false)
  useAnimationFrame((_, delta) => {
    if (reduced) return
    const d = Math.min(delta, 50) / 1000
    const b = Math.min(Math.abs(boost.get()) * 0.55, 620)
    const speed = (BASE_SPEED * 1.15 + b) * (heroSlow.current ? 0.1 : 1)
    let v = heroX.get() - speed * d
    v = (((v % set) + set) % set) - set
    heroX.set(v)
  })
  const heroRotate = useTransform(boost, (b) => -8 + Math.max(-120, Math.min(120, b)) * 0.004)

  if (reduced) {
    return (
      <section className="border-t border-border/50 py-16">
        <div className="mx-auto max-w-6xl px-5">
          <p className="text-center font-display text-2xl font-semibold">ภาพจริง ขึ้นสด สวยทุกเฟรม</p>
        </div>
      </section>
    )
  }

  return (
    <section className="relative overflow-hidden border-t border-border/50 py-16">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_60%_at_50%_40%,oklch(84%_0.19_80.46/0.05),transparent)]" aria-hidden />
      <div className="relative mx-auto mb-9 max-w-6xl px-5 text-center">
        <span className="inline-flex items-center gap-3 font-mono text-[10.5px] font-medium uppercase tracking-[0.22em] text-gold">
          <span className="h-px w-8 bg-gold/60" /> Live preview <span className="h-px w-8 bg-gold/60" />
        </span>
        <h2 className="mt-5 font-display text-2xl font-semibold tracking-tight sm:text-4xl">
          ภาพจริง ขึ้นสด <span className="italic text-primary">สวยทุกเฟรม</span>
        </h2>
        <p className="mt-3 text-[13px] text-muted-foreground">
          เลื่อนหน้าเว็บเร็ว ๆ แล้วชมกระแสรูปไหลตาม — แตะการ์ดเพื่อหยิบขึ้นดูสเปก
        </p>
      </div>

      {/* tilted plane */}
      <div style={{ perspective: 1300 }} className="relative">
        <motion.div
          style={{ rotateX: 26, rotateZ: heroRotate, scale: 1.02 }}
          className="origin-center will-change-transform"
        >
          {/* top row — ambient, drifting right */}
          <div className="opacity-75 [-webkit-mask-image:linear-gradient(to_right,transparent,black_15%,black_85%,transparent)] [mask-image:linear-gradient(to_right,transparent,black_15%,black_85%,transparent)]">
            <DriftRow dir={1} scrollBoost={boost} />
          </div>
          {/* hero row — interactive pick-up cards */}
          <motion.div
            className="[-webkit-mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)] [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]"
            style={{ x: heroX }}
            onHoverStart={() => (heroSlow.current = true)}
            onHoverEnd={() => (heroSlow.current = false)}
          >
            <div className="flex py-2.5">
              {[...CARDS, ...CARDS, ...CARDS].map((c, i) => (
                <div key={i} style={{ marginRight: GAP }}>
                  <Card card={c} picked={picked === i} onPick={() => setPicked(picked === i ? null : i)} />
                </div>
              ))}
            </div>
          </motion.div>
          {/* bottom row — ambient, drifting left */}
          <div className="opacity-75 [-webkit-mask-image:linear-gradient(to_right,transparent,black_15%,black_85%,transparent)] [mask-image:linear-gradient(to_right,transparent,black_15%,black_85%,transparent)]">
            <DriftRow dir={-1} scrollBoost={boost} />
          </div>
        </motion.div>
      </div>
    </section>
  )
}
