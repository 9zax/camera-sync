export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", ...init })
  const text = await res.text()
  const data = text ? (JSON.parse(text) as unknown) : null
  if (!res.ok) {
    const msg =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : res.statusText
    throw new ApiError(res.status, msg)
  }
  return data as T
}

export const api = {
  get: <T>(p: string) => req<T>(p),
  post: <T>(p: string, body?: unknown) =>
    req<T>(p, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  patch: <T>(p: string, body?: unknown) =>
    req<T>(p, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  del: <T>(p: string) => req<T>(p, { method: "DELETE" }),
}

// ---- types ----

export interface PhotoItem {
  id: string
  filename: string
  bytes: number
  width: number
  height: number
  status: string
  face_status: string
  created_at: number
  taken_at?: number | null
}

export interface PhotoList {
  total: number
  items: PhotoItem[]
}

export interface EventInfo {
  slug: string
  title: string
  partner_a: string
  partner_b: string
  event_date: string
  photo_count: number
  face_enabled: boolean
  pin_required: boolean
  cover_photo_id?: string | null
}

export interface AdminEvent {
  id: string
  slug: string
  title: string
  partner_a: string
  partner_b: string
  event_date: string
  pin: string
  face_enabled: number
  enabled: number
  upload_token: string
  created_at: number
  total: number
  ready: number
  pending: number
  faces_done: number
  cover_photo_id?: string | null
}

export interface FaceSearchResult {
  results: { photo_id: string; score: number }[]
  count: number
  message: string
}

export interface LikeList {
  items: string[]
}

export function listLikes(slug: string, guestId: string): Promise<LikeList> {
  return api.get(`/api/g/${encodeURIComponent(slug)}/likes?guest_id=${encodeURIComponent(guestId)}`)
}

export function setLike(
  slug: string,
  guestId: string,
  photoId: string,
  liked: boolean,
): Promise<{ liked: boolean; photo_likes: number }> {
  return api.post(`/api/g/${encodeURIComponent(slug)}/likes`, {
    guest_id: guestId,
    photo_id: photoId,
    liked,
  })
}

export function photoUrl(id: string, variant: "thumb" | "web" | "orig") {
  return `/api/photos/${id}/file?variant=${variant}`
}

// ---- uploads (XHR for progress) ----

export function uploadOne(
  eventId: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<{ uploaded: number; duplicated: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("POST", `/api/events/${eventId}/photos`)
    xhr.responseType = "json"
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response ?? { uploaded: 1, duplicated: 0 })
      } else {
        const msg = xhr.response?.error ?? xhr.statusText ?? "upload failed"
        reject(new ApiError(xhr.status, msg))
      }
    }
    xhr.onerror = () => reject(new ApiError(0, "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้"))
    const fd = new FormData()
    fd.append("file", file, file.name)
    xhr.send(fd)
  })
}

export async function uploadFiles(
  eventId: string,
  files: File[],
  onFileProgress?: (index: number, pct: number) => void,
): Promise<{ uploaded: number; duplicated: number }> {
  let uploaded = 0
  let duplicated = 0
  for (let i = 0; i < files.length; i++) {
    const r = await uploadOne(eventId, files[i], (pct) => onFileProgress?.(i, pct))
    uploaded += r.uploaded
    duplicated += r.duplicated
    onFileProgress?.(i, 100)
  }
  return { uploaded, duplicated }
}

export async function faceSearch(slug: string, image: Blob): Promise<FaceSearchResult> {
  const fd = new FormData()
  fd.append("selfie", image, "selfie.jpg")
  const res = await fetch(`/api/g/${encodeURIComponent(slug)}/faces/search`, {
    method: "POST",
    body: fd,
    credentials: "same-origin",
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? "ค้นหาไม่สำเร็จ ลองอีกครั้ง")
  }
  return data as FaceSearchResult
}

export async function downloadZip(
  path: string,
  body: unknown,
  filename: string,
): Promise<void> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  })
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new ApiError(res.status, data?.error ?? "ดาวน์โหลดไม่สำเร็จ")
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
