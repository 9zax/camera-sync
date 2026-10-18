export function formatBytes(n: number): string {
  if (!Number.isFinite(n)) return "—"
  if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(1) + " GB"
  if (n >= 1024 ** 2) return (n / 1024 ** 2).toFixed(1) + " MB"
  if (n >= 1024) return (n / 1024).toFixed(0) + " KB"
  return n + " B"
}

const dateFmt = new Intl.DateTimeFormat("th-TH", {
  day: "numeric",
  month: "long",
  year: "numeric",
})

const dateTimeFmt = new Intl.DateTimeFormat("th-TH", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
})

export function formatThaiDate(ms?: number | null): string {
  if (!ms) return ""
  return dateFmt.format(new Date(ms))
}

export function formatThaiDateTime(ms?: number | null): string {
  if (!ms) return ""
  return dateTimeFmt.format(new Date(ms))
}

export function formatEventDate(s?: string): string {
  if (!s) return ""
  const d = new Date(s + "T00:00:00")
  if (isNaN(d.getTime())) return s
  return dateFmt.format(d)
}

export function timeAgo(ms: number): string {
  const diff = Date.now() - ms
  const m = Math.floor(diff / 60_000)
  if (m < 1) return "เมื่อสักครู่"
  if (m < 60) return `${m} นาทีที่แล้ว`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} ชั่วโมงที่แล้ว`
  return formatThaiDate(ms)
}
