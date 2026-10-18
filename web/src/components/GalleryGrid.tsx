import { motion, type Variants } from "motion/react"
import { Skeleton } from "@/components/ui/skeleton"
import { photoUrl, type PhotoItem } from "@/lib/api"

export function GallerySkeleton({ count = 12 }: { count?: number }) {
  const heights = [260, 340, 200, 300, 240, 380]
  return (
    <div className="masonry-3">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="w-full rounded-xl" style={{ height: heights[i % heights.length] }} />
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

export function PhotoTile({
  photo,
  onClick,
  badge,
}: {
  photo: PhotoItem
  onClick: () => void
  badge?: React.ReactNode
}) {
  return (
    <motion.button
      layout
      onClick={onClick}
      className="group relative block w-full overflow-hidden rounded-xl bg-muted text-left shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      whileHover={{ scale: 1.015, boxShadow: "0 12px 28px -10px rgb(0 0 0 / 0.35)" }}
      whileTap={{ scale: 0.985 }}
      transition={{ type: "spring", stiffness: 320, damping: 24 }}
    >
      <img
        src={photoUrl(photo.id, "thumb")}
        alt={photo.filename}
        loading="lazy"
        className="w-full"
        style={{ aspectRatio: photo.width && photo.height ? `${photo.width} / ${photo.height}` : "4 / 5" }}
      />
      {badge}
    </motion.button>
  )
}

export function GalleryGrid({
  photos,
  onOpen,
}: {
  photos: PhotoItem[]
  onOpen: (index: number) => void
}) {
  return (
    <motion.div
      className="masonry-3"
      variants={gridVariants}
      initial="hidden"
      animate="show"
    >
      {photos.map((p, i) => (
        <motion.div key={p.id} variants={tileVariants} layout>
          <PhotoTile photo={p} onClick={() => onOpen(i)} />
        </motion.div>
      ))}
    </motion.div>
  )
}
