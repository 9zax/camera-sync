import type { CSSProperties } from "react"

/**
 * Gallery themes — one design per album, chosen by the photographer.
 *
 * A theme is a token set (the same CSS variables the Neo Kinpaku system in
 * index.css exposes) plus three structural choices: hero layout, photo grid
 * and background texture. Because every component reads colour through
 * var(--background)/var(--gold)/…, overriding the variables on
 * documentElement restyles the whole guest page without touching markup.
 */

export type HeroStyle =
  | "crest"
  | "editorial"
  | "monogram"
  | "fullbleed"
  | "marquee"
  | "postcard"
  | "noir"
  | "arch"

export type GridStyle = "masonry" | "frame" | "square" | "contact" | "polaroid"

export type Texture =
  | "none"
  | "grain"
  | "paper"
  | "linen"
  | "velvet"
  | "bokeh"
  | "bloom"
  | "confetti"
  | "hairline"

export interface GalleryTheme {
  id: string
  name: string
  nameEn: string
  group: string
  dark: boolean
  hero: HeroStyle
  grid: GridStyle
  texture: Texture
  radius: string
  display: string
  body: string
  /** event types this theme is usually right for (picker sorts these first) */
  bestFor: string[]
  vars: Record<string, string>
  swatch: [string, string, string]
}

interface Spec {
  id: string
  name: string
  nameEn: string
  group: string
  dark: boolean
  hero: HeroStyle
  grid: GridStyle
  texture: Texture
  radius: string
  display: string
  body: string
  bestFor: string[]
  bg: string
  fg: string
  surface: string
  surfaceAlt: string
  primary: string
  primaryFg: string
  mutedFg: string
  line: string
  hi: string
  hiRich: string
  hiDeep: string
  rule: string
  live: string
  deep: string
  frame: string
}

/** Thai text needs a Thai face in the chain; skip the duplicate when the
 * theme already leads with it. */
/** Latin display faces carry no Thai glyphs, so the Thai fallback decides how
 *  a Thai title actually looks — keep it in the same register as the Latin face. */
const SERIF_DISPLAY = new Set([
  "Cormorant Garamond",
  "Playfair Display",
  "Bodoni Moda",
  "Cinzel",
  "Marcellus",
  "Trirong",
  "Noto Serif Thai",
])

function fontStack(lead: string, latin: string, thai: string): string {
  const parts = [`"${lead}"`]
  if (lead !== latin) parts.push(`"${latin}"`)
  parts.push(`"${thai}"`, "ui-sans-serif", "sans-serif")
  return parts.join(", ")
}

function build(s: Spec): GalleryTheme {
  const vars: Record<string, string> = {
    "--background": s.bg,
    "--foreground": s.fg,
    "--card": s.surface,
    "--card-foreground": s.fg,
    "--popover": s.surface,
    "--popover-foreground": s.fg,
    "--primary": s.primary,
    "--primary-foreground": s.primaryFg,
    "--secondary": s.surfaceAlt,
    "--secondary-foreground": s.fg,
    "--muted": s.surfaceAlt,
    "--muted-foreground": s.mutedFg,
    "--accent": s.surfaceAlt,
    "--accent-foreground": s.fg,
    "--border": s.line,
    "--input": s.line,
    "--ring": s.hi,
    "--gold": s.hi,
    "--gold-rich": s.hiRich,
    "--gold-deep": s.hiDeep,
    "--rule-strong": s.rule,
    "--rule": s.line,
    "--patina": s.live,
    "--patina-pale": s.hi,
    "--lacquer-deep": s.deep,
    "--radius": s.radius,
    "--theme-font-display": fontStack(s.display, "Kanit", SERIF_DISPLAY.has(s.display) ? "Noto Serif Thai" : "Noto Sans Thai"),
    "--theme-font-body": fontStack(s.body, "Anuphan", "Noto Sans Thai"),
    "--frame": s.frame,
    "--tile-radius": s.grid === "contact" || s.grid === "square" ? "0px" : `min(${s.radius}, 0.75rem)`,
  }
  return {
    id: s.id,
    name: s.name,
    nameEn: s.nameEn,
    group: s.group,
    dark: s.dark,
    hero: s.hero,
    grid: s.grid,
    texture: s.texture,
    radius: s.radius,
    display: s.display,
    body: s.body,
    bestFor: s.bestFor,
    vars,
    swatch: [s.bg, s.primary, s.hi],
  }
}

const SPECS: Spec[] = [
  {
    id: "kinpaku-gold",
    name: "Neo Kinpaku",
    nameEn: "Neo Kinpaku",
    group: "Luxe",
    dark: true,
    hero: "crest",
    grid: "masonry",
    texture: "hairline",
    radius: "0.375rem",
    display: "Kanit",
    body: "Anuphan",
    bestFor: ["wedding", "engagement", "anniversary"],
    bg: "oklch(7% 0.006 95)",
    fg: "oklch(91% 0 0)",
    surface: "oklch(11% 0.006 95)",
    surfaceAlt: "oklch(15% 0.008 95)",
    primary: "oklch(84% 0.19 80.46)",
    primaryFg: "oklch(4% 0.004 95)",
    mutedFg: "oklch(72% 0 0)",
    line: "oklch(78% 0 0 / 0.16)",
    hi: "oklch(84% 0.19 80.46)",
    hiRich: "oklch(77% 0.13 82)",
    hiDeep: "oklch(61% 0.085 78)",
    rule: "oklch(74% 0.09 82 / 0.6)",
    live: "oklch(70% 0.12 188)",
    deep: "oklch(4% 0.004 95)",
    frame: "oklch(11% 0.006 95)",
  },
  {
    id: "rose-champagne",
    name: "แชมเปญกุหลาบ",
    nameEn: "Rose Champagne",
    group: "Romantic",
    dark: false,
    hero: "monogram",
    grid: "frame",
    texture: "paper",
    radius: "0.6rem",
    display: "Cormorant Garamond",
    body: "Sarabun",
    bestFor: ["wedding", "proposal", "anniversary"],
    bg: "oklch(97% 0.009 70)",
    fg: "oklch(30% 0.032 30)",
    surface: "oklch(99% 0.005 75)",
    surfaceAlt: "oklch(94% 0.014 65)",
    primary: "oklch(58% 0.13 20)",
    primaryFg: "oklch(98% 0.006 70)",
    mutedFg: "oklch(50% 0.02 40)",
    line: "oklch(40% 0.03 30 / 0.18)",
    hi: "oklch(70% 0.13 40)",
    hiRich: "oklch(62% 0.14 35)",
    hiDeep: "oklch(48% 0.1 30)",
    rule: "oklch(55% 0.1 35 / 0.5)",
    live: "oklch(55% 0.13 155)",
    deep: "oklch(99% 0.004 75)",
    frame: "oklch(100% 0 0)",
  },
  {
    id: "peony-blush",
    name: "พีโอนี่บลัช",
    nameEn: "Peony Blush",
    group: "Romantic",
    dark: false,
    hero: "arch",
    grid: "frame",
    texture: "bloom",
    radius: "1rem",
    display: "Great Vibes",
    body: "Anuphan",
    bestFor: ["wedding", "proposal", "prewedding"],
    bg: "oklch(97% 0.012 10)",
    fg: "oklch(32% 0.05 350)",
    surface: "oklch(99% 0.006 10)",
    surfaceAlt: "oklch(95% 0.017 8)",
    primary: "oklch(55% 0.15 355)",
    primaryFg: "oklch(98% 0.01 10)",
    mutedFg: "oklch(52% 0.035 350)",
    line: "oklch(45% 0.05 350 / 0.16)",
    hi: "oklch(65% 0.15 5)",
    hiRich: "oklch(58% 0.16 8)",
    hiDeep: "oklch(45% 0.12 355)",
    rule: "oklch(60% 0.12 5 / 0.45)",
    live: "oklch(55% 0.12 160)",
    deep: "oklch(99% 0.005 10)",
    frame: "oklch(100% 0 0)",
  },
  {
    id: "sage-manor",
    name: "Sage Manor",
    nameEn: "Sage Manor",
    group: "Minimal",
    dark: false,
    hero: "editorial",
    grid: "masonry",
    texture: "linen",
    radius: "0.25rem",
    display: "Playfair Display",
    body: "Sarabun",
    bestFor: ["wedding", "engagement", "prewedding"],
    bg: "oklch(96% 0.012 150)",
    fg: "oklch(26% 0.025 155)",
    surface: "oklch(99% 0.006 150)",
    surfaceAlt: "oklch(93% 0.016 152)",
    primary: "oklch(42% 0.062 158)",
    primaryFg: "oklch(97% 0.01 150)",
    mutedFg: "oklch(48% 0.025 155)",
    line: "oklch(35% 0.03 155 / 0.2)",
    hi: "oklch(52% 0.075 152)",
    hiRich: "oklch(45% 0.07 155)",
    hiDeep: "oklch(35% 0.05 158)",
    rule: "oklch(45% 0.05 152 / 0.5)",
    live: "oklch(52% 0.12 155)",
    deep: "oklch(99% 0.005 150)",
    frame: "oklch(98% 0.008 150)",
  },
  {
    id: "ivory-minimal",
    name: "Ivory Minimal",
    nameEn: "Ivory Minimal",
    group: "Minimal",
    dark: false,
    hero: "marquee",
    grid: "square",
    texture: "none",
    radius: "0rem",
    display: "Archivo",
    body: "Anuphan",
    bestFor: ["wedding", "corporate", "event", "prewedding"],
    bg: "oklch(98.5% 0.003 95)",
    fg: "oklch(20% 0.008 95)",
    surface: "oklch(100% 0 0)",
    surfaceAlt: "oklch(95% 0.004 95)",
    primary: "oklch(24% 0.01 95)",
    primaryFg: "oklch(98% 0 0)",
    mutedFg: "oklch(52% 0.008 95)",
    line: "oklch(20% 0.01 95 / 0.14)",
    hi: "oklch(58% 0.05 85)",
    hiRich: "oklch(50% 0.04 85)",
    hiDeep: "oklch(38% 0.03 85)",
    rule: "oklch(30% 0.02 90 / 0.35)",
    live: "oklch(50% 0.12 165)",
    deep: "oklch(100% 0 0)",
    frame: "oklch(100% 0 0)",
  },
  {
    id: "noir-cinema",
    name: "นัวร์ฟิล์ม",
    nameEn: "Noir Cinema",
    group: "Luxe",
    dark: true,
    hero: "noir",
    grid: "contact",
    texture: "grain",
    radius: "0rem",
    display: "Bodoni Moda",
    body: "Manrope",
    bestFor: ["wedding", "prewedding", "event"],
    bg: "oklch(5% 0 0)",
    fg: "oklch(95% 0 0)",
    surface: "oklch(10% 0 0)",
    surfaceAlt: "oklch(14% 0 0)",
    primary: "oklch(92% 0.005 95)",
    primaryFg: "oklch(6% 0 0)",
    mutedFg: "oklch(68% 0 0)",
    line: "oklch(80% 0 0 / 0.18)",
    hi: "oklch(78% 0.012 90)",
    hiRich: "oklch(65% 0.01 90)",
    hiDeep: "oklch(45% 0.01 90)",
    rule: "oklch(80% 0 0 / 0.4)",
    live: "oklch(75% 0.15 155)",
    deep: "oklch(3% 0 0)",
    frame: "oklch(8% 0 0)",
  },
  {
    id: "midnight-pearl",
    name: "มิดไนท์เพิร์ล",
    nameEn: "Midnight Pearl",
    group: "Luxe",
    dark: true,
    hero: "fullbleed",
    grid: "frame",
    texture: "bokeh",
    radius: "0.5rem",
    display: "Cinzel",
    body: "Anuphan",
    bestFor: ["wedding", "engagement", "corporate"],
    bg: "oklch(17% 0.045 258)",
    fg: "oklch(94% 0.012 250)",
    surface: "oklch(22% 0.045 258)",
    surfaceAlt: "oklch(26% 0.045 258)",
    primary: "oklch(84% 0.055 240)",
    primaryFg: "oklch(15% 0.04 258)",
    mutedFg: "oklch(72% 0.02 250)",
    line: "oklch(85% 0.02 250 / 0.2)",
    hi: "oklch(86% 0.09 85)",
    hiRich: "oklch(78% 0.1 80)",
    hiDeep: "oklch(60% 0.08 78)",
    rule: "oklch(86% 0.06 240 / 0.5)",
    live: "oklch(80% 0.12 190)",
    deep: "oklch(11% 0.04 258)",
    frame: "oklch(24% 0.04 258)",
  },
  {
    id: "emerald-brass",
    name: "มรกตทองเหลือง",
    nameEn: "Emerald & Brass",
    group: "Luxe",
    dark: true,
    hero: "crest",
    grid: "masonry",
    texture: "velvet",
    radius: "0.3rem",
    display: "Marcellus",
    body: "Anuphan",
    bestFor: ["wedding", "anniversary", "corporate"],
    bg: "oklch(15% 0.042 165)",
    fg: "oklch(93% 0.014 160)",
    surface: "oklch(19% 0.042 165)",
    surfaceAlt: "oklch(23% 0.04 165)",
    primary: "oklch(82% 0.11 85)",
    primaryFg: "oklch(14% 0.03 165)",
    mutedFg: "oklch(74% 0.02 160)",
    line: "oklch(85% 0.02 160 / 0.18)",
    hi: "oklch(82% 0.11 85)",
    hiRich: "oklch(72% 0.11 80)",
    hiDeep: "oklch(55% 0.08 75)",
    rule: "oklch(80% 0.08 88 / 0.5)",
    live: "oklch(80% 0.13 165)",
    deep: "oklch(9% 0.03 165)",
    frame: "oklch(21% 0.035 165)",
  },
  {
    id: "terracotta-boho",
    name: "ดินเผาโบโฮ",
    nameEn: "Terracotta Boho",
    group: "Minimal",
    dark: false,
    hero: "arch",
    grid: "polaroid",
    texture: "paper",
    radius: "0.35rem",
    display: "Italiana",
    body: "Sarabun",
    bestFor: ["wedding", "prewedding", "birthday"],
    bg: "oklch(95% 0.018 65)",
    fg: "oklch(30% 0.045 45)",
    surface: "oklch(98% 0.008 70)",
    surfaceAlt: "oklch(92% 0.02 60)",
    primary: "oklch(55% 0.13 40)",
    primaryFg: "oklch(98% 0.008 70)",
    mutedFg: "oklch(48% 0.03 45)",
    line: "oklch(35% 0.04 45 / 0.2)",
    hi: "oklch(62% 0.12 55)",
    hiRich: "oklch(52% 0.11 50)",
    hiDeep: "oklch(40% 0.08 45)",
    rule: "oklch(50% 0.08 50 / 0.45)",
    live: "oklch(50% 0.1 150)",
    deep: "oklch(98% 0.006 70)",
    frame: "oklch(97% 0.014 70)",
  },
  {
    id: "dusk-blue-hour",
    name: "Blue Hour",
    nameEn: "Dusk Blue Hour",
    group: "Romantic",
    dark: true,
    hero: "fullbleed",
    grid: "masonry",
    texture: "bokeh",
    radius: "0.75rem",
    display: "Cormorant Garamond",
    body: "Anuphan",
    bestFor: ["wedding", "engagement", "event"],
    bg: "oklch(23% 0.05 265)",
    fg: "oklch(94% 0.015 270)",
    surface: "oklch(27% 0.05 265)",
    surfaceAlt: "oklch(31% 0.05 265)",
    primary: "oklch(85% 0.09 265)",
    primaryFg: "oklch(20% 0.04 265)",
    mutedFg: "oklch(76% 0.03 268)",
    line: "oklch(88% 0.02 268 / 0.22)",
    hi: "oklch(85% 0.1 80)",
    hiRich: "oklch(76% 0.11 75)",
    hiDeep: "oklch(58% 0.09 70)",
    rule: "oklch(85% 0.06 265 / 0.5)",
    live: "oklch(80% 0.11 195)",
    deep: "oklch(15% 0.045 265)",
    frame: "oklch(29% 0.05 265)",
  },
  {
    id: "plum-velvet",
    name: "พลัมเวลเวท",
    nameEn: "Plum Velvet",
    group: "Luxe",
    dark: true,
    hero: "monogram",
    grid: "frame",
    texture: "velvet",
    radius: "0.8rem",
    display: "Playfair Display",
    body: "Sarabun",
    bestFor: ["wedding", "anniversary", "corporate"],
    bg: "oklch(18% 0.052 325)",
    fg: "oklch(94% 0.012 330)",
    surface: "oklch(22% 0.05 325)",
    surfaceAlt: "oklch(26% 0.048 325)",
    primary: "oklch(82% 0.09 20)",
    primaryFg: "oklch(17% 0.04 325)",
    mutedFg: "oklch(75% 0.025 328)",
    line: "oklch(86% 0.02 330 / 0.2)",
    hi: "oklch(82% 0.1 20)",
    hiRich: "oklch(72% 0.12 15)",
    hiDeep: "oklch(55% 0.1 350)",
    rule: "oklch(80% 0.08 20 / 0.5)",
    live: "oklch(78% 0.13 165)",
    deep: "oklch(11% 0.04 325)",
    frame: "oklch(24% 0.045 325)",
  },
  {
    id: "sandalwood-temple",
    name: "จันทร์ไม้หอม",
    nameEn: "Sandalwood Temple",
    group: "Ceremony",
    dark: false,
    hero: "crest",
    grid: "frame",
    texture: "hairline",
    radius: "0.25rem",
    display: "Trirong",
    body: "Sarabun",
    bestFor: ["ordination", "merit", "merit"],
    bg: "oklch(95% 0.028 80)",
    fg: "oklch(28% 0.05 55)",
    surface: "oklch(98% 0.014 85)",
    surfaceAlt: "oklch(92% 0.03 78)",
    primary: "oklch(50% 0.12 45)",
    primaryFg: "oklch(97% 0.02 85)",
    mutedFg: "oklch(46% 0.035 60)",
    line: "oklch(35% 0.04 55 / 0.22)",
    hi: "oklch(68% 0.14 88)",
    hiRich: "oklch(58% 0.13 80)",
    hiDeep: "oklch(44% 0.1 70)",
    rule: "oklch(58% 0.1 85 / 0.55)",
    live: "oklch(50% 0.1 155)",
    deep: "oklch(98% 0.012 85)",
    frame: "oklch(97% 0.02 85)",
  },
  {
    id: "lotus-white",
    name: "บัวขาว",
    nameEn: "Lotus White",
    group: "Ceremony",
    dark: false,
    hero: "arch",
    grid: "square",
    texture: "bloom",
    radius: "0.8rem",
    display: "Noto Serif Thai",
    body: "Anuphan",
    bestFor: ["merit", "ordination", "merit", "memorial"],
    bg: "oklch(98% 0.006 340)",
    fg: "oklch(27% 0.02 345)",
    surface: "oklch(100% 0 0)",
    surfaceAlt: "oklch(95% 0.012 340)",
    primary: "oklch(58% 0.11 20)",
    primaryFg: "oklch(98% 0.006 340)",
    mutedFg: "oklch(50% 0.02 345)",
    line: "oklch(35% 0.02 345 / 0.16)",
    hi: "oklch(70% 0.1 25)",
    hiRich: "oklch(62% 0.11 22)",
    hiDeep: "oklch(46% 0.08 20)",
    rule: "oklch(65% 0.06 25 / 0.45)",
    live: "oklch(52% 0.1 160)",
    deep: "oklch(100% 0 0)",
    frame: "oklch(100% 0 0)",
  },
  {
    id: "sakura-veil",
    name: "Sakura Veil",
    nameEn: "Sakura Veil",
    group: "Romantic",
    dark: false,
    hero: "postcard",
    grid: "polaroid",
    texture: "bloom",
    radius: "1.1rem",
    display: "Charmonman",
    body: "Anuphan",
    bestFor: ["wedding", "proposal", "newborn", "birthday"],
    bg: "oklch(97% 0.014 350)",
    fg: "oklch(32% 0.04 350)",
    surface: "oklch(99.5% 0.004 350)",
    surfaceAlt: "oklch(94% 0.02 350)",
    primary: "oklch(60% 0.14 5)",
    primaryFg: "oklch(99% 0.005 350)",
    mutedFg: "oklch(52% 0.03 350)",
    line: "oklch(45% 0.04 350 / 0.18)",
    hi: "oklch(72% 0.13 3)",
    hiRich: "oklch(62% 0.15 5)",
    hiDeep: "oklch(48% 0.1 8)",
    rule: "oklch(70% 0.1 5 / 0.45)",
    live: "oklch(55% 0.11 160)",
    deep: "oklch(99.5% 0.004 350)",
    frame: "oklch(100% 0 0)",
  },
  {
    id: "mint-confetti",
    name: "มินต์คอนเฟตติ",
    nameEn: "Mint Confetti",
    group: "Celebration",
    dark: false,
    hero: "postcard",
    grid: "frame",
    texture: "confetti",
    radius: "1.2rem",
    display: "Itim",
    body: "Anuphan",
    bestFor: ["birthday", "newborn", "graduation", "event"],
    bg: "oklch(97% 0.012 172)",
    fg: "oklch(28% 0.03 175)",
    surface: "oklch(99.5% 0.004 172)",
    surfaceAlt: "oklch(93% 0.018 170)",
    primary: "oklch(48% 0.1 172)",
    primaryFg: "oklch(98% 0.008 172)",
    mutedFg: "oklch(46% 0.02 175)",
    line: "oklch(35% 0.02 175 / 0.18)",
    hi: "oklch(72% 0.16 70)",
    hiRich: "oklch(62% 0.16 60)",
    hiDeep: "oklch(48% 0.12 50)",
    rule: "oklch(60% 0.1 70 / 0.45)",
    live: "oklch(50% 0.12 165)",
    deep: "oklch(99.5% 0.004 172)",
    frame: "oklch(100% 0 0)",
  },
  {
    id: "peach-pop",
    name: "พีชป๊อป",
    nameEn: "Peach Pop",
    group: "Celebration",
    dark: false,
    hero: "marquee",
    grid: "square",
    texture: "confetti",
    radius: "1.4rem",
    display: "Chakra Petch",
    body: "Anuphan",
    bestFor: ["birthday", "event", "sport", "newborn"],
    bg: "oklch(96% 0.02 55)",
    fg: "oklch(30% 0.05 35)",
    surface: "oklch(99% 0.008 60)",
    surfaceAlt: "oklch(93% 0.025 50)",
    primary: "oklch(58% 0.16 35)",
    primaryFg: "oklch(99% 0.006 60)",
    mutedFg: "oklch(48% 0.04 40)",
    line: "oklch(40% 0.05 40 / 0.2)",
    hi: "oklch(70% 0.17 45)",
    hiRich: "oklch(62% 0.18 40)",
    hiDeep: "oklch(48% 0.14 35)",
    rule: "oklch(62% 0.12 45 / 0.5)",
    live: "oklch(52% 0.12 165)",
    deep: "oklch(99% 0.006 60)",
    frame: "oklch(100% 0 0)",
  },
  {
    id: "kraft-memory",
    name: "คราฟต์ความทรงจำ",
    nameEn: "Kraft Memory",
    group: "Retro",
    dark: false,
    hero: "postcard",
    grid: "polaroid",
    texture: "paper",
    radius: "0.2rem",
    display: "Sriracha",
    body: "Sarabun",
    bestFor: ["anniversary", "birthday", "anniversary", "event"],
    bg: "oklch(92% 0.035 75)",
    fg: "oklch(28% 0.04 60)",
    surface: "oklch(96% 0.022 78)",
    surfaceAlt: "oklch(89% 0.035 72)",
    primary: "oklch(42% 0.07 55)",
    primaryFg: "oklch(96% 0.02 78)",
    mutedFg: "oklch(42% 0.035 60)",
    line: "oklch(35% 0.04 60 / 0.25)",
    hi: "oklch(55% 0.11 60)",
    hiRich: "oklch(46% 0.1 55)",
    hiDeep: "oklch(34% 0.07 50)",
    rule: "oklch(48% 0.08 55 / 0.5)",
    live: "oklch(45% 0.1 155)",
    deep: "oklch(96% 0.02 78)",
    frame: "oklch(97% 0.015 80)",
  },
  {
    id: "campus-navy",
    name: "บัณฑิตวิทยาลัย",
    nameEn: "Campus Navy",
    group: "Formal",
    dark: true,
    hero: "editorial",
    grid: "frame",
    texture: "hairline",
    radius: "0.25rem",
    display: "Cinzel",
    body: "Anuphan",
    bestFor: ["graduation", "corporate", "merit"],
    bg: "oklch(19% 0.05 260)",
    fg: "oklch(95% 0.01 260)",
    surface: "oklch(23% 0.05 260)",
    surfaceAlt: "oklch(27% 0.048 260)",
    primary: "oklch(84% 0.13 90)",
    primaryFg: "oklch(18% 0.045 260)",
    mutedFg: "oklch(76% 0.02 260)",
    line: "oklch(86% 0.02 260 / 0.2)",
    hi: "oklch(84% 0.13 90)",
    hiRich: "oklch(74% 0.13 85)",
    hiDeep: "oklch(56% 0.1 80)",
    rule: "oklch(84% 0.08 90 / 0.55)",
    live: "oklch(80% 0.12 190)",
    deep: "oklch(13% 0.04 260)",
    frame: "oklch(25% 0.05 260)",
  },
  {
    id: "executive-slate",
    name: "สเลตองค์กร",
    nameEn: "Executive Slate",
    group: "Formal",
    dark: true,
    hero: "marquee",
    grid: "contact",
    texture: "none",
    radius: "0.3rem",
    display: "Archivo",
    body: "Anuphan",
    bestFor: ["corporate", "event", "sport", "graduation"],
    bg: "oklch(20% 0.012 260)",
    fg: "oklch(95% 0.004 260)",
    surface: "oklch(24% 0.012 260)",
    surfaceAlt: "oklch(28% 0.012 260)",
    primary: "oklch(78% 0.14 235)",
    primaryFg: "oklch(15% 0.01 260)",
    mutedFg: "oklch(74% 0.008 260)",
    line: "oklch(86% 0 0 / 0.16)",
    hi: "oklch(78% 0.14 235)",
    hiRich: "oklch(68% 0.13 235)",
    hiDeep: "oklch(50% 0.1 235)",
    rule: "oklch(78% 0.08 235 / 0.45)",
    live: "oklch(80% 0.15 155)",
    deep: "oklch(14% 0.01 260)",
    frame: "oklch(26% 0.012 260)",
  },
  {
    id: "ash-solemn",
    name: "เทาอาลัย",
    nameEn: "Ash Remembrance",
    group: "Remembrance",
    dark: false,
    hero: "editorial",
    grid: "masonry",
    texture: "linen",
    radius: "0.2rem",
    display: "Noto Serif Thai",
    body: "Sarabun",
    bestFor: ["memorial", "merit"],
    bg: "oklch(96% 0.006 70)",
    fg: "oklch(28% 0.012 60)",
    surface: "oklch(99% 0.004 75)",
    surfaceAlt: "oklch(93% 0.006 70)",
    primary: "oklch(38% 0.02 55)",
    primaryFg: "oklch(97% 0.005 75)",
    mutedFg: "oklch(48% 0.01 60)",
    line: "oklch(35% 0.01 60 / 0.16)",
    hi: "oklch(55% 0.04 70)",
    hiRich: "oklch(46% 0.035 65)",
    hiDeep: "oklch(35% 0.025 60)",
    rule: "oklch(50% 0.02 65 / 0.4)",
    live: "oklch(50% 0.06 160)",
    deep: "oklch(99% 0.004 75)",
    frame: "oklch(100% 0 0)",
  },
]

export const GALLERY_THEMES: GalleryTheme[] = SPECS.map(build)

export const DEFAULT_THEME_ID = "kinpaku-gold"

const BY_ID = new Map(GALLERY_THEMES.map((t) => [t.id, t]))
const FALLBACK = BY_ID.get(DEFAULT_THEME_ID) as GalleryTheme

/** Unknown/older ids fall back to the house style — never a blank page. */
export function getTheme(id?: string | null): GalleryTheme {
  return (id && BY_ID.get(id)) || FALLBACK
}

export function themeIsKnown(id?: string | null): boolean {
  return !!id && BY_ID.has(id)
}

/** Style object for scoped previews (admin picker) — vars land on this node. */
export function themeStyle(t: GalleryTheme): CSSProperties {
  return t.vars as unknown as CSSProperties
}

const APPLIED = new Set<string>()
let APPLIED_DARK = false

/** Paint a theme over the whole document (guest pages own the viewport). */
export function applyTheme(t: GalleryTheme) {
  const root = document.documentElement
  for (const key of Object.keys(t.vars)) {
    root.style.setProperty(key, t.vars[key])
    APPLIED.add(key)
  }
  for (const stale of [...APPLIED]) {
    if (!(stale in t.vars)) {
      root.style.removeProperty(stale)
      APPLIED.delete(stale)
    }
  }
  root.classList.toggle("dark", t.dark)
  APPLIED_DARK = t.dark
  root.dataset.theme = t.id
  root.dataset.texture = t.texture
  root.dataset.hero = t.hero
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute("content", t.vars["--background"])
}

export function resetTheme() {
  const root = document.documentElement
  for (const key of APPLIED) root.style.removeProperty(key)
  APPLIED.clear()
  if (APPLIED_DARK) root.classList.remove("dark")
  APPLIED_DARK = false
  delete root.dataset.theme
  delete root.dataset.texture
  delete root.dataset.hero
}

/** Group label order used by the picker (romantic wedding first). */
export const THEME_GROUPS = ["Romantic", "Minimal", "Luxe", "Ceremony", "Celebration", "Formal", "Retro", "Remembrance"]

