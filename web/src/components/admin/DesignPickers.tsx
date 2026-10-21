import { useState } from "react"
import { motion } from "motion/react"
import { Check, Sparkles } from "lucide-react"
import {
  GALLERY_THEMES,
  THEME_GROUPS,
  getTheme,
  themeStyle,
  type GalleryTheme,
  type GridStyle,
  type HeroStyle,
} from "@/lib/galleryThemes"
import { EVENT_TEMPLATES, getTemplate, type EventTemplate } from "@/lib/eventTemplates"

/**
 * The two design choices a photographer makes per album: what the event is
 * (drives every word the guest sees) and how it looks (drives colour, type,
 * hero layout, grid and texture). Both pickers preview for real — the theme
 * cards render with their own tokens, not a flat colour chip.
 */

const LABEL_RECOMMENDED = "แนะนำ"
const LABEL_SHOW_ALL = "ดูธีมทั้งหมด 20 แบบ"
const LABEL_SHOW_FEWER = "แสดงเฉพาะธีมที่แนะนำ"

function heroShape(t: GalleryTheme) {
  const cover = "bg-muted"
  switch (t.hero as HeroStyle) {
    case "fullbleed":
      return (
        <div className={`relative h-16 w-full overflow-hidden rounded-[var(--tile-radius)] ${cover}`}>
          <div className="absolute inset-x-0 bottom-0 h-8 bg-[var(--lacquer-deep)]" />
          <div className="absolute bottom-1.5 left-2 space-y-1">
            <div className="h-1.5 w-16 rounded-full bg-muted-foreground/60" />
            <div className="h-1 w-10 rounded-full bg-gold/80" />
          </div>
        </div>
      )
    case "noir":
      return (
        <div className={`flex h-16 w-full flex-col justify-center gap-1 rounded-[var(--tile-radius)] ${cover} px-2`}>
          <div className="h-2 w-24 rounded-full bg-muted-foreground/50" />
          <div className="mx-auto h-px w-14 bg-[var(--rule-strong)]" />
        </div>
      )
    case "monogram":
      return (
        <div className={`flex h-16 w-full items-center justify-center rounded-[var(--tile-radius)] ${cover}`}>
          <span className="monogram-ring flex size-8 items-center justify-center rounded-full font-display text-[10px] text-gold">
            AB
          </span>
        </div>
      )
    case "marquee":
      return (
        <div className="flex h-16 w-full items-end gap-1 overflow-hidden rounded-[var(--tile-radius)] p-1">
          {[10, 14, 8, 12, 9].map((h, i) => (
            <div key={i} className={`w-1/5 shrink-0 rounded-[2px] ${cover}`} style={{ height: h * 3 }} />
          ))}
        </div>
      )
    case "postcard":
      return (
        <div className={`flex h-16 w-full items-center justify-center rounded-[var(--tile-radius)] ${cover}`}>
          <div className="tile-polaroid -rotate-3" style={{ padding: "3px 3px 12px" }}>
            <div className="h-7 w-12 bg-muted-foreground/25" />
          </div>
        </div>
      )
    case "arch":
      return (
        <div className={`flex h-16 w-full items-end justify-center rounded-[var(--tile-radius)] ${cover} pb-1`}>
          <div className="tile-arch h-12 w-9 border-2" style={{ borderColor: "var(--gold)" }} />
        </div>
      )
    case "editorial":
      return (
        <div className={`flex h-16 w-full items-center gap-2 rounded-[var(--tile-radius)] ${cover} px-2`}>
          <div className="flex-1 space-y-1">
            <div className="h-1 w-10 rounded-full bg-gold/70" />
            <div className="h-2 w-16 rounded-full bg-muted-foreground/50" />
            <div className="h-px w-8 bg-[var(--rule-strong)]" />
          </div>
          <div className="tile-frame h-11 w-9" style={{ padding: "3px" }}>
            <div className="h-full w-full rounded-[2px] bg-muted-foreground/25" />
          </div>
        </div>
      )
    default:
      return (
        <div className={`flex h-16 w-full flex-col items-center justify-center gap-1 rounded-[var(--tile-radius)] ${cover}`}>
          <div className="h-1 w-8 rounded-full bg-gold/70" />
          <div className="h-2 w-24 rounded-full bg-muted-foreground/50" />
          <div className="h-1 w-12 rounded-full bg-muted-foreground/30" />
        </div>
      )
  }
}

function tiles(grid: GridStyle) {
  const key = (i: number) => "t" + i
  if (grid === "contact") {
    return (
      <div className="mt-2 grid grid-cols-5 gap-0.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={key(i)} className="aspect-square rounded-[2px] bg-secondary" />
        ))}
      </div>
    )
  }
  if (grid === "square") {
    return (
      <div className="mt-2 grid grid-cols-3 gap-1">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={key(i)} className="aspect-square rounded-[var(--tile-radius)] bg-secondary" />
        ))}
      </div>
    )
  }
  if (grid === "polaroid") {
    return (
      <div className="mt-2 flex gap-1">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={key(i)}
            className="tile-polaroid flex-1"
            style={{ padding: "2px 2px 8px", transform: `rotate(${i - 1}deg)` }}
          >
            <div className="aspect-square w-full rounded-[2px] bg-secondary" />
          </div>
        ))}
      </div>
    )
  }
  if (grid === "frame") {
    return (
      <div className="mt-2 flex items-start gap-1">
        {[18, 26, 22].map((h, i) => (
          <div key={key(i)} className="tile-frame flex-1" style={{ padding: "3px" }}>
            <div className="w-full rounded-[2px] bg-secondary" style={{ height: h * 2 }} />
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="mt-2 flex items-start gap-1">
      {[26, 18, 32].map((h, i) => (
        <div key={key(i)} className="flex-1 rounded-[var(--tile-radius)] bg-secondary" style={{ height: h * 1.6 }} />
      ))}
    </div>
  )
}

function ThemeCard({ t }: { t: GalleryTheme }) {
  return (
    <div
      style={themeStyle(t)}
      data-texture={t.texture}
      className="preview-shell relative overflow-hidden rounded-xl border border-border bg-background"
    >
      <span className="theme-texture" aria-hidden />
      <div className="relative p-2.5">
        {heroShape(t)}
        {tiles(t.grid)}
        <p className="relative mt-2 font-display text-[12px] leading-tight text-foreground">{t.name}</p>
        <p className="relative font-mono text-[8.5px] uppercase tracking-[0.16em] text-gold">{t.nameEn}</p>
      </div>
    </div>
  )
}

export function ThemePicker({
  value,
  onChange,
  tpl,
  collapsible = false,
}: {
  value: string
  onChange: (id: string) => void
  tpl?: EventTemplate
  /** start with only the themes that suit this event type — the create dialog
   * stays short, the settings page shows the whole set */
  collapsible?: boolean
}) {
  const [showAll, setShowAll] = useState(!collapsible)
  const recommended = new Set(tpl?.themes ?? [])
  const picked = getTheme(value)
  const rest = GALLERY_THEMES.filter((t) => !recommended.has(t.id))
  const recommendedList = GALLERY_THEMES.filter((t) => recommended.has(t.id))

  const option = (t: GalleryTheme, note?: string) => {
    const active = t.id === picked.id
    return (
      <button
        key={t.id}
        type="button"
        onClick={() => onChange(t.id)}
        aria-pressed={active}
        className={`relative rounded-xl text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          active ? "ring-2 ring-gold ring-offset-2 ring-offset-background" : "hover:-translate-y-0.5"
        }`}
      >
        <ThemeCard t={t} />
        {note && (
          <span className="absolute right-1.5 top-1.5 z-10 flex items-center gap-1 rounded-full bg-black/45 px-2 py-0.5 text-[9.5px] font-medium text-white backdrop-blur">
            <Sparkles className="size-2.5 text-gold" />
            {note}
          </span>
        )}
        {active && (
          <span className="absolute left-1.5 top-1.5 z-10 flex size-5 items-center justify-center rounded-full bg-gold text-black">
            <Check className="size-3.5" strokeWidth={3} />
          </span>
        )}
      </button>
    )
  }

  return (
    <div className="space-y-4">
      {!showAll &&
        (() => {
          const list = picked && !recommended.has(picked.id) ? [...recommendedList, picked] : recommendedList
          return (
            <div>
              <p className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                <Sparkles className="size-3 text-gold" /> {tpl?.label}
              </p>
              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">{list.map((t) => option(t))}</div>
            </div>
          )
        })()}
      {showAll && (
        <>
          {recommendedList.length > 0 && (
            <div>
              <p className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                <Sparkles className="size-3 text-gold" /> {tpl?.label}
              </p>
              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {recommendedList.map((t) => option(t, LABEL_RECOMMENDED))}
              </div>
            </div>
          )}
          {THEME_GROUPS.map((group) => {
            const list = rest.filter((t) => t.group === group)
            if (!list.length) return null
            return (
              <div key={group}>
                <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{group}</p>
                <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">{list.map((t) => option(t))}</div>
              </div>
            )
          })}
        </>
      )}
      {collapsible && !showAll && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="text-xs font-medium text-muted-foreground underline decoration-[var(--rule-strong)] underline-offset-4 hover:text-foreground"
        >
          {LABEL_SHOW_ALL}
        </button>
      )}
      {collapsible && showAll && (
        <button
          type="button"
          onClick={() => setShowAll(false)}
          className="text-xs font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          {LABEL_SHOW_FEWER}
        </button>
      )}
    </div>
  )
}

export function EventTypePicker({
  value,
  onChange,
}: {
  value: string
  onChange: (id: string) => void
}) {
  const picked = getTemplate(value)
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {EVENT_TEMPLATES.map((t) => {
        const active = t.id === picked.id
        const Icon = t.icon
        return (
          <motion.button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            aria-pressed={active}
            whileTap={{ scale: 0.97 }}
            className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors ${
              active
                ? "border-[var(--rule-strong)] bg-primary/10 font-medium text-foreground shadow-sm"
                : "border-border/70 bg-background text-muted-foreground hover:border-border hover:text-foreground"
            }`}
          >
            <span
              className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${
                active ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground"
              }`}
            >
              <Icon className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block truncate">{t.label}</span>
              <span className="block truncate font-mono text-[9.5px] uppercase tracking-[0.14em] opacity-60">
                {t.labelEn}
              </span>
            </span>
          </motion.button>
        )
      })}
    </div>
  )
}
