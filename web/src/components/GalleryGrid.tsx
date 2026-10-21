import { useState } from "react"
import { motion, type Variants } from "motion/react"
import { Heart } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { photoUrl, type PhotoItem } from "@/lib/api"
import type { GridStyle } from "@/lib/galleryThemes"

export function GallerySkeleton({ count = 12 }: { count?: number }) {
  const heights = [260, 340, 200, 300, 240, 380]
  return (
    <div className="masonry-3">
      {Array.from({ length: count }).map((_, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: i * 0.04 }}
        >
          <Skeleton className="w-full rounded-[var(--tile-radius)]" style={{ height: heights[i % heights.length] }} />
        </motion.div>
      ))}
    </div>
  )
}

const gridVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.035 } },
}

const tileVariants: Variants = {
  hidden: { opacity: 0, y: 22, scale: 0.97 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring", stiffness: 240, damping: 26 },
  },
}

/** container class per grid style — columns for masonry families, CSS grid for
 *  the square/contact sheets so every cell keeps its 1:1 shape */
const CONTAINER: Record<GridStyle, string> = {
  masonry: "masonry-3",
  frame: "masonry-3",
  polaroid: "masonry-3 g-polaroid",
  square: "g-square",
  contact: "g-contact",
}

export function PhotoTile({
  photo,
  onClick,
  badge,
  grid = "masonry",
  caption,
}: {
  photo: PhotoItem
  onClick: () => void
  badge?: React.ReactNode
  grid?: GridStyle
  caption?: string
}) {
  // blur-up: shimmer + heavy blur until the bytes are in, then spring to crisp
  const [loaded, setLoaded] = useState(false)
  const matted = grid === "frame" || grid === "polaroid"
  return (
    <motion.button
      layout
      onClick={onClick}
      className={`group relative block w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        matted ? "" : "overflow-hidden rounded-[var(--tile-radius)] bg-secondary shadow-sm"
      }`}
      whileHover={{ scale: 1.015, boxShadow: matted ? undefined : "0 12px 28px -10px rgb(0 0 0 / 0.35)" }}
      whileTap={{ scale: 0.985 }}
      transition={{ type: "spring", stiffness: 320, damping: 24 }}
    >
      <div className={grid === "frame" ? "tile-frame" : grid === "polaroid" ? "tile-polaroid" : undefined}>
        {!loaded && (
          <motion.div
            className="absolute inset-0 origin-top animate-shimmer bg-gradient-to-b from-muted via-secondary to-muted bg-[length:100%_200%]"
            exit={{ opacity: 0 }}
          />
        )}
        <motion.img
          layoutId={`photo-${photo.id}`}
          src={photoUrl(photo.id, "thumb")}
          alt={photo.filename}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          initial={{ opacity: 0, scale: 1.08, filter: "blur(16px)" }}
          animate={
            loaded
              ? { opacity: 1, scale: 1, filter: "blur(0px)" }
              : { opacity: 0, scale: 1.08, filter: "blur(16px)" }
          }
          transition={{ type: "spring", stiffness: 130, damping: 22, opacity: { duration: 0.45 } }}
          className={`w-full ${matted ? "rounded-[calc(var(--tile-radius)-0.25rem)]" : "rounded-[var(--tile-radius)]"}`}
          style={{ aspectRatio: photo.width && photo.height ? `${photo.width} / ${photo.height}` : "4 / 5" }}
        />
        {caption && <p className="tile-caption mt-2 text-center">{caption}</p>}
      </div>
      {/* hover scrim */}
      <motion.div
        className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        aria-hidden
      />
      {badge}
    </motion.button>
  )
}

export function GalleryGrid({
  photos,
  onOpen,
  likedIds,
  onToggleLike,
  grid = "masonry",
}: {
  photos: PhotoItem[]
  onOpen: (index: number) => void
  likedIds?: Set<string>
  onToggleLike?: (photoId: string) => void
  grid?: GridStyle
}) {
  return (
    <motion.div
      className={CONTAINER[grid]}
      variants={gridVariants}
      initial="hidden"
      animate="show"
    >
      {photos.map((p, i) => (
        <motion.div key={p.id} variants={tileVariants} layout>
          <PhotoTile
            photo={p}
            grid={grid}
            caption={grid === "polaroid" ? `No. ${String(i + 1).padStart(2, "0")}` : undefined}
            onClick={() => onOpen(i)}
            badge={
              onToggleLike ? (
                <span
                  role="button"
                  aria-label={likedIds?.has(p.id) ? "เอาออกจากรายการถูกใจ" : "ถูกใจรูปนี้"}
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleLike(p.id)
                  }}
                  className={`absolute right-2 top-2 z-10 flex size-8 cursor-pointer items-center justify-center rounded-full backdrop-blur-sm transition-colors ${
                    likedIds?.has(p.id)
                      ? "bg-black/50 text-gold"
                      : "bg-black/30 text-white/85 hover:bg-black/50"
                  }`}
                >
                  <Heart className={`size-4 ${likedIds?.has(p.id) ? "fill-gold text-gold" : ""}`} />
                </span>
              ) : undefined
            }
          />
        </motion.div>
      ))}
    </motion.div>
  )
}
