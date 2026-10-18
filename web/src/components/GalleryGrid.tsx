import { useState } from "react"
import { motion, type Variants } from "motion/react"
import { Skeleton } from "@/components/ui/skeleton"
import { photoUrl, type PhotoItem } from "@/lib/api"

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
          <Skeleton className="w-full rounded-xl" style={{ height: heights[i % heights.length] }} />
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

export function PhotoTile({
  photo,
  onClick,
  badge,
}: {
  photo: PhotoItem
  onClick: () => void
  badge?: React.ReactNode
}) {
  // blur-up: shimmer + heavy blur until the bytes are in, then spring to crisp
  const [loaded, setLoaded] = useState(false)
  return (
    <motion.button
      layout
      onClick={onClick}
      className="group relative block w-full overflow-hidden rounded-xl bg-muted text-left shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      whileHover={{ scale: 1.015, boxShadow: "0 12px 28px -10px rgb(0 0 0 / 0.35)" }}
      whileTap={{ scale: 0.985 }}
      transition={{ type: "spring", stiffness: 320, damping: 24 }}
    >
      {!loaded && (
        <motion.div
          className="absolute inset-0 origin-top animate-shimmer rounded-xl bg-gradient-to-b from-muted via-secondary to-muted bg-[length:100%_200%]"
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
        className="w-full"
        style={{ aspectRatio: photo.width && photo.height ? `${photo.width} / ${photo.height}` : "4 / 5" }}
      />
      {/* Ken Burns drift on hover — pure transform, GPU cheap */}
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
