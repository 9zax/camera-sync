import { useMemo } from "react"
import { Link } from "react-router-dom"
import { AnimatePresence, motion, useReducedMotion, type Variants } from "motion/react"
import { CalendarDays, Images, MonitorPlay } from "lucide-react"
import { photoUrl, type EventInfo, type PhotoItem } from "@/lib/api"
import { formatEventDate } from "@/lib/format"
import type { EventTemplate } from "@/lib/eventTemplates"
import type { GalleryTheme } from "@/lib/galleryThemes"

/**
 * The album hero — eight layouts, one per gallery theme family. Everything here
 * reads design tokens (var(--gold), var(--frame), --theme-font-display) so a
 * theme swap changes colour, type and structure together.
 */
export interface HeroProps {
  theme: GalleryTheme
  tpl: EventTemplate
  info: EventInfo
  couple: string
  total: number
  live: boolean
  photos: PhotoItem[]
  onOpen: (photo: PhotoItem) => void
}

const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
}
const riseIn: Variants = {
  hidden: { opacity: 0, y: 22 },
  show: { opacity: 1, y: 0, transition: { duration: 0.65, ease: [0.16, 1, 0.3, 1] } },
}

function initials(a: string, b: string, title: string): string {
  const first = (s: string) => Array.from((s || "").trim())[0] ?? ""
  const x = first(a) || first(title)
  const y = first(b)
  return (x + y).slice(0, 2)
}

export function WallLink({ slug, dark }: { slug: string; dark?: boolean }) {
  return (
    <Link
      to={`/e/${encodeURIComponent(slug)}/wall`}
      title="เปิดโหมดจอใหญ่สำหรับจอในงาน"
      className={`absolute right-4 top-4 z-20 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium backdrop-blur transition-colors ${
        dark
          ? "border-white/15 bg-black/35 text-white/85 hover:bg-black/55 hover:text-white"
          : "border-border bg-card/70 text-muted-foreground hover:text-foreground"
      }`}
    >
      <MonitorPlay className="size-3.5 text-gold" /> โหมดจอใหญ่
    </Link>
  )
}

function Kicker({ tpl, center }: { tpl: EventTemplate; center?: boolean }) {
  return (
    <p
      className={`mb-3 flex items-center gap-3 font-mono text-[10.5px] font-medium uppercase tracking-[0.22em] text-gold ${
        center ? "justify-center" : ""
      }`}
    >
      {center && <span className="kicker-rule" />}
      {tpl.kicker}
      {center && <span className="kicker-rule" />}
    </p>
  )
}

function DateLine({ tpl, info, center }: { tpl: EventTemplate; info: EventInfo; center?: boolean }) {
  if (!info.event_date) return null
  return (
    <p
      className={`mt-3 flex items-center gap-1.5 text-[13px] text-muted-foreground ${
        center ? "justify-center" : ""
      }`}
    >
      <CalendarDays className="size-4 text-gold" /> {formatEventDate(info.event_date)}
    </p>
  )
}

export function CountPills({
  total,
  live,
  tpl,
  align = "center",
}: {
  total: number;
  live: boolean;
  tpl: EventTemplate;
  align?: "center" | "start"
}) {
  return (
    <div
      className={`mt-5 flex flex-wrap items-center gap-2.5 text-sm ${
        align === "center" ? "justify-center" : "justify-start"
      }`}
    >
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
            <span className="size-2 animate-live-dot rounded-full bg-[var(--patina)]" /> อัปเดตเรียลไทม์
          </motion.span>
        )}
      </AnimatePresence>
      <span className="sr-only">{tpl.heroLine}</span>
    </div>
  )
}

function Cover({
  photo,
  className,
  onOpen,
  rounded,
}: {
  photo?: PhotoItem
  className?: string
  onOpen?: () => void
  rounded?: string
}) {
  if (!photo) {
    return (
      <div
        className={`flex items-center justify-center bg-secondary text-muted-foreground/50 ${rounded ?? ""} ${
          className ?? ""
        }`}
      >
        <Images className="size-7" />
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`block overflow-hidden ${rounded ?? ""} ${className ?? ""}`}
    >
      <motion.img
        src={photoUrl(photo.id, "web")}
        alt=""
        loading="eager"
        draggable={false}
        whileHover={onOpen ? { scale: 1.03 } : undefined}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="h-full w-full object-cover"
      />
    </button>
  )
}

const TILE_RADIUS = "rounded-[var(--tile-radius)]"

function headerBase(): string {
  return "relative overflow-hidden border-b border-border/60"
}

function Ornament() {
  return (
    <div className="my-5 flex items-center justify-center gap-3" aria-hidden>
      <span className="hero-rule h-px w-14 sm:w-20" />
      <span className="ornament-dot text-[11px] leading-none">✦</span>
      <span className="hero-rule h-px w-14 sm:w-20" />
    </div>
  )
}

/** big display headline used by most layouts */
function Title({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h1 className={`font-display leading-[1.04] tracking-tight text-balance ${className ?? "text-[clamp(2.3rem,5.6vw,4rem)] font-semibold"}`}>
      {children}
    </h1>
  )
}

function Names({ couple, className }: { couple: string; className?: string }) {
  return (
    <p className={`font-display text-lg italic text-gold-rich sm:text-2xl ${className ?? ""}`}>{couple}</p>
  )
}

/** 1 — crest: centred emblem over the cover, the classic wedding album */
function CrestHero({ tpl, info, couple, total, live, photos, onOpen }: HeroProps) {
  return (
    <header className={`${headerBase()} px-4 pb-14 pt-14 sm:pb-20 sm:pt-18`}>
      <div className="hero-veil pointer-events-none absolute inset-x-0 -top-8 h-56 opacity-60" aria-hidden />
      <motion.div variants={stagger} initial="hidden" animate="show" className="relative mx-auto max-w-3xl text-center">
        <motion.div variants={riseIn}>
          <Kicker tpl={tpl} center />
        </motion.div>
        <motion.div variants={riseIn}>
          <Title>{info.title}</Title>
        </motion.div>
        <motion.div variants={riseIn}>
          <Ornament />
        </motion.div>
        <motion.div variants={riseIn}>
          <Names couple={couple} />
          <DateLine tpl={tpl} info={info} center />
          <CountPills total={total} live={live} tpl={tpl} />
        </motion.div>
        {photos[0] && (
          <motion.div variants={riseIn} className="mt-10">
            <Cover
              photo={photos[0]}
              rounded={TILE_RADIUS}
              className="mx-auto aspect-[16/10] w-full max-w-4xl shadow-[0_28px_60px_-32px_color-mix(in_oklab,var(--foreground)_45%,transparent)]"
              onOpen={() => onOpen(photos[0])}
            />
          </motion.div>
        )}
      </motion.div>
    </header>
  )
}

/** 2 — editorial: magazine spread, copy left / framed print right */
function EditorialHero({ tpl, info, couple, total, live, photos, onOpen }: HeroProps) {
  return (
    <header className={`${headerBase()} px-4 py-12 sm:py-16`}>
      <div className="mx-auto grid max-w-6xl items-center gap-10 md:grid-cols-[1.05fr_0.95fr]">
        <motion.div variants={stagger} initial="hidden" animate="show">
          <motion.div variants={riseIn}>
            <Kicker tpl={tpl} />
          </motion.div>
          <motion.div variants={riseIn}>
            <Title className="text-[clamp(2.6rem,6.5vw,4.6rem)] font-light">{info.title}</Title>
          </motion.div>
          <motion.div variants={riseIn} className="hero-rule mt-6 h-px w-40" aria-hidden />
          <motion.p variants={riseIn} className="mt-6 max-w-md text-[15px] leading-relaxed text-muted-foreground">
            {tpl.heroLine}
          </motion.p>
          <motion.div variants={riseIn} className="mt-6">
            <Names couple={couple} />
            <DateLine tpl={tpl} info={info} />
          </motion.div>
          <motion.div variants={riseIn}>
            <CountPills total={total} live={live} tpl={tpl} align="start" />
          </motion.div>
        </motion.div>
        <div className="tile-frame relative">
          <Cover
            photo={photos[0]}
            className="aspect-[4/5] max-h-[560px] w-full"
            onOpen={() => photos[0] && onOpen(photos[0])}
          />
          <p className="tile-caption mt-2 text-center">{tpl.kickerEn}</p>
        </div>
      </div>
    </header>
  )
}

/** 3 — monogram: initials in a gold ring, the invitation look */
function MonogramHero({ tpl, info, couple, total, live, photos, onOpen }: HeroProps) {
  const mono = initials(info.partner_a, info.partner_b, info.title)
  return (
    <header className={`${headerBase()} px-4 pb-14 pt-16 sm:pt-20`}>
      <motion.div variants={stagger} initial="hidden" animate="show" className="relative mx-auto max-w-2xl text-center">
        <motion.div variants={riseIn} className="mx-auto flex size-24 items-center justify-center rounded-full monogram-ring sm:size-28">
          <span className="font-display text-3xl tracking-[0.14em] text-gold sm:text-4xl">{mono}</span>
        </motion.div>
        <motion.div variants={riseIn}>
          <Kicker tpl={tpl} center />
        </motion.div>
        <motion.div variants={riseIn}>
          <Title className="text-[clamp(2rem,4.6vw,3.2rem)] font-medium uppercase tracking-[0.12em]">{info.title}</Title>
          <Names couple={couple} className="mt-3 not-italic tracking-[0.06em] text-gold" />
          <DateLine tpl={tpl} info={info} center />
          <CountPills total={total} live={live} tpl={tpl} />
        </motion.div>
        {photos[0] && (
          <motion.div variants={riseIn} className="mx-auto mt-10 grid max-w-3xl grid-cols-3 gap-2">
            {[photos[0], photos[1], photos[2]].map(
              (p, i) =>
                p && (
                  <Cover
                    key={p.id}
                    photo={p}
                    rounded={TILE_RADIUS}
                    className={`aspect-square w-full ${i === 1 ? "-mt-5" : "mt-3"}`}
                    onOpen={() => onOpen(p)}
                  />
                ),
            )}
          </motion.div>
        )}
      </motion.div>
    </header>
  )
}

/** 4 — fullbleed: the photo is the hero, type sits bottom-left */
function FullbleedHero({ tpl, info, couple, total, live, photos, onOpen, theme }: HeroProps) {
  const reduce = useReducedMotion()
  return (
    <header className={`${headerBase()} min-h-[58dvh] px-4 pb-12 pt-24 sm:min-h-[64dvh] sm:pb-16`}>
      {photos[0] ? (
        <motion.img
          src={photoUrl(photos[0].id, "web")}
          alt=""
          draggable={false}
          initial={reduce ? false : { scale: 1.08 }}
          animate={{ scale: 1 }}
          transition={{ duration: 1.6, ease: [0.16, 1, 0.3, 1] }}
          className="absolute inset-0 -z-10 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 -z-10 bg-secondary" />
      )}
      <div className="hero-veil absolute inset-0 -z-10" aria-hidden />
      <div className="hero-veil-side absolute inset-0 -z-10" aria-hidden />
      <motion.div variants={stagger} initial="hidden" animate="show" className="relative mx-auto max-w-6xl">
        <motion.div variants={riseIn}>
          <Kicker tpl={tpl} />
        </motion.div>
        <motion.div variants={riseIn}>
          <Title className="text-[clamp(2.8rem,7.5vw,5.5rem)] font-semibold [text-shadow:0_2px_24px_rgb(0_0_0/0.35)]">
            {info.title}
          </Title>
        </motion.div>
        <motion.div variants={riseIn} className="mt-4">
          <Names couple={couple} className="text-gold" />
          <DateLine tpl={tpl} info={info} />
          <CountPills total={total} live={live} tpl={tpl} align="start" />
        </motion.div>
        <motion.a
          variants={riseIn}
          href="#gallery"
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-lg transition-transform hover:scale-[1.02] active:scale-95"
        >
          ดูรูปทั้งหมด
          <span className={theme.dark ? "" : "text-primary-foreground"} aria-hidden>
            ↓
          </span>
        </motion.a>
      </motion.div>
    </header>
  )
}

/** 5 — marquee: a run of prints, for festival / birthday energy */
function MarqueeHero({ tpl, info, couple, total, live, photos, onOpen }: HeroProps) {
  const strip = photos.slice(0, 5)
  return (
    <header className={`${headerBase()} px-4 pb-12 pt-14`}>
      <div className="mx-auto max-w-6xl">
        <motion.div variants={stagger} initial="hidden" animate="show" className="text-center">
          <motion.div variants={riseIn}>
            <Kicker tpl={tpl} center />
          </motion.div>
          <motion.div variants={riseIn}>
            <Title className="text-[clamp(2.4rem,6vw,4.4rem)] font-bold uppercase tracking-tight">{info.title}</Title>
            <Names couple={couple} className="mt-2 font-bold not-italic uppercase text-[13px] tracking-[0.2em] text-muted-foreground sm:text-sm" />
            <DateLine tpl={tpl} info={info} center />
            <CountPills total={total} live={live} tpl={tpl} />
          </motion.div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 26 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="mt-10 flex items-end gap-3 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {strip.map((p, i) => (
            <Cover
              key={p.id}
              photo={p}
              rounded={TILE_RADIUS}
              className={
                i % 2 === 0
                  ? "aspect-[3/4] w-36 shrink-0 sm:w-44"
                  : "aspect-square w-28 shrink-0 sm:w-32"
              }
              onOpen={() => onOpen(p)}
            />
          ))}
        </motion.div>
      </div>
    </header>
  )
}

/** 6 — postcard: one tilted print with a handwritten note */
function PostcardHero({ tpl, info, couple, total, live, photos, onOpen }: HeroProps) {
  return (
    <header className={`${headerBase()} px-4 pb-14 pt-16`}>
      <div className="mx-auto max-w-3xl text-center">
        <motion.div
          initial={{ opacity: 0, rotate: -3.5, y: 30 }}
          animate={{ opacity: 1, rotate: -1.2, y: 0 }}
          transition={{ type: "spring", stiffness: 90, damping: 18 }}
          whileHover={{ rotate: 0, scale: 1.01 }}
          className="tile-polaroid mx-auto inline-block max-w-full text-left"
        >
          <Cover
            photo={photos[0]}
            className="aspect-[4/3] w-full max-w-xl"
            onOpen={() => photos[0] && onOpen(photos[0])}
          />
          <p className="tile-caption mt-3 px-1 text-[13px]">{info.title}</p>
        </motion.div>
        <motion.div variants={stagger} initial="hidden" animate="show" className="mt-9">
          <motion.div variants={riseIn}>
            <Kicker tpl={tpl} center />
          </motion.div>
          <motion.div variants={riseIn}>
            <Names couple={couple} className="text-[clamp(1.5rem,3.6vw,2.3rem)]" />
            <DateLine tpl={tpl} info={info} center />
            <CountPills total={total} live={live} tpl={tpl} />
          </motion.div>
        </motion.div>
      </div>
    </header>
  )
}

/** 7 — noir: letterboxed cinema still, oversized serif */
function NoirHero({ tpl, info, couple, total, live, photos, onOpen }: HeroProps) {
  return (
    <header className={`${headerBase()} px-4 pb-14 pt-0`}>
      {photos[0] && (
        <div className="mx-auto -mb-16 mt-0 max-w-6xl sm:-mb-24">
          <Cover photo={photos[0]} className="aspect-[16/9] w-full sm:aspect-[21/9]" onOpen={() => onOpen(photos[0])} />
        </div>
      )}
      <div className="relative mx-auto max-w-3xl pt-20 text-center sm:pt-28">
        <motion.div variants={stagger} initial="hidden" animate="show">
          <motion.div variants={riseIn}>
            <Kicker tpl={tpl} center />
          </motion.div>
          <motion.div variants={riseIn}>
            <Title className="text-[clamp(2.6rem,7vw,5rem)] font-normal tracking-[-0.01em]">{info.title}</Title>
          </motion.div>
          <motion.div variants={riseIn} className="hero-rule mx-auto mt-6 h-px w-52" aria-hidden />
          <motion.div variants={riseIn} className="mt-6">
            <Names couple={couple} />
            <DateLine tpl={tpl} info={info} center />
            <CountPills total={total} live={live} tpl={tpl} />
          </motion.div>
        </motion.div>
      </div>
    </header>
  )
}

/** 8 — arch: temple / ceremony framing, arch-topped cover */
function ArchHero({ tpl, info, couple, total, live, photos, onOpen }: HeroProps) {
  return (
    <header className={`${headerBase()} px-4 pb-14 pt-16`}>
      <div className="mx-auto max-w-2xl text-center">
        {photos[0] && (
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="mx-auto mb-8 w-full max-w-sm"
          >
            <div className="tile-arch overflow-hidden border-[3px] shadow-lg" style={{ borderColor: "var(--gold)" }}>
              <Cover photo={photos[0]} className="aspect-[3/4] w-full" onOpen={() => onOpen(photos[0])} />
            </div>
          </motion.div>
        )}
        <motion.div variants={stagger} initial="hidden" animate="show">
          <motion.div variants={riseIn}>
            <Kicker tpl={tpl} center />
          </motion.div>
          <motion.div variants={riseIn}>
            <Title>{info.title}</Title>
            <Ornament />
            <Names couple={couple} />
            <DateLine tpl={tpl} info={info} center />
            <CountPills total={total} live={live} tpl={tpl} />
          </motion.div>
        </motion.div>
      </div>
    </header>
  )
}

const HEROES: Record<GalleryTheme["hero"], (p: HeroProps) => React.ReactElement> = {
  crest: CrestHero,
  editorial: EditorialHero,
  monogram: MonogramHero,
  fullbleed: FullbleedHero,
  marquee: MarqueeHero,
  postcard: PostcardHero,
  noir: NoirHero,
  arch: ArchHero,
}

export function AlbumHero(props: HeroProps) {
  const Layout = HEROES[props.theme.hero] ?? CrestHero
  return (
    <div className="relative">
      <Layout {...props} />
      <WallLink slug={props.info.slug} dark={props.theme.dark} />
    </div>
  )
}
