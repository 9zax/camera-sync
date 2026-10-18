import { AnimatePresence, motion } from "motion/react"
import { useMemo } from "react"
import { Navigate, Route, Routes, useLocation } from "react-router-dom"
import Landing from "@/pages/Landing"
import Perf from "@/pages/Perf"
import GuestEvent from "@/pages/GuestEvent"
import AdminPage from "@/pages/admin/AdminPage"
import EventDetail from "@/pages/admin/EventDetail"

function Page({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  )
}

/**
 * When the app is entered through the built-in tunnel (/t/<id>/…), strip the
 * prefix so the router sees the real path. After boot the app uses plain
 * paths (/api, /e/…) which the relay routes back via the cs_tunnel cookie.
 */
function useTunnelStrippedLocation() {
  const location = useLocation()
  return useMemo(() => {
    if (!location.pathname.startsWith("/t/")) return location
    const stripped = location.pathname.replace(/^\/t\/[^/]+/, "") || "/"
    return { ...location, pathname: stripped }
  }, [location])
}

function AnimatedRoutes() {
  const location = useTunnelStrippedLocation()
  return (
    <AnimatePresence mode="wait" initial={false}>
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={<Page><Landing /></Page>} />
        <Route path="/perf" element={<Page><Perf /></Page>} />
        <Route path="/e/:slug" element={<Page><GuestEvent /></Page>} />
        <Route path="/e/:slug/*" element={<Page><GuestEvent /></Page>} />
        <Route path="/admin" element={<Page><AdminPage /></Page>} />
        <Route path="/admin/events/:id" element={<Page><EventDetail /></Page>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AnimatePresence>
  )
}

export default function App() {
  return <AnimatedRoutes />
}
