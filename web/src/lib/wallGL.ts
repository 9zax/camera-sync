import createTransition from "gl-transition"
import type { GLTextureLike } from "gl-transition"
import type { WallTransition } from "./wallTransitions"

/**
 * WebGL photo layer for the Live Wall.
 *
 * A slide is a "scene": the photo contained inside the frame over a stretched,
 * GPU-blurred copy of itself, both drifting slowly. Scenes render into
 * offscreen targets during a hand-off so a gl-transitions shader can blend two
 * finished frames — the drift keeps running while the photos overlap, which is
 * what separates this from a DOM crossfade.
 */

const BACK_W = 32
const BACK_H = 18
const ZOOM_TO = 1.07
const PAN = 0.018
/** the two frames a hand-off blends, plus the next photo, uploaded while idle */
const MAX_ENTRIES = 3

type Scene = { img: HTMLImageElement; pan: [number, number] }
type Tex = GLTextureLike & { tex: WebGLTexture }

export type WallHandle = {
  /** uploads the photo once it is decoded; true = ready to draw */
  prepare: (id: string, img: HTMLImageElement) => boolean
  /**
   * Draws `to` alone, or blends `from` -> `to` with `transition`.
   * `progress` is clamped to 0..1 and a missing `from` degrades to `to`, never
   * the other way round — so a hand-off frame that arrives late still shows the
   * incoming photo rather than a black canvas.
   * False means the frame was not ready — the canvas keeps its last image.
   */
  render: (
    fromId: string | null,
    toId: string,
    progress: number,
    fromT: number,
    toT: number,
    transition: WallTransition | null,
  ) => boolean
  /** compile a transition's program now, so the first blended frame doesn't pay for it */
  prewarm: (transition: WallTransition) => void
  /** re-draw the last frame; resize() clears the canvas, this refills it in the same task */
  repaint: () => void
  resize: () => void
  prune: (keep: (string | null)[]) => void
  dispose: () => void
}

const VERT = `attribute vec2 _p; varying vec2 vUv;
void main(){ gl_Position = vec4(_p, 0.0, 1.0); vUv = 0.5 * (_p + vec2(1.0)); }`

const SCENE_FRAG = `precision mediump float;
varying vec2 vUv;
uniform sampler2D uPhoto;
uniform sampler2D uBack;
uniform vec4 uRect;   // contained photo box in screen uv: x, y, w, h
uniform vec3 uDrift;  // panX, panY, 1/zoom
void main(){
  vec3 col = texture2D(uBack, vUv - uDrift.xy * 0.4).rgb * 0.72;
  vec2 q = (vUv - uRect.xy) / uRect.zw;
  vec2 sp = 0.5 + (q - 0.5) * uDrift.z + uDrift.xy;
  bool inside = q.x >= 0.0 && q.x <= 1.0 && q.y >= 0.0 && q.y <= 1.0;
  bool sampled = sp.x >= 0.0 && sp.x <= 1.0 && sp.y >= 0.0 && sp.y <= 1.0;
  if (inside && sampled) col = texture2D(uPhoto, sp).rgb;
  gl_FragColor = vec4(col, 1.0);
}`

/** the box a photo occupies when fitted inside the screen without cropping */
function containRect(photoW: number, photoH: number, screenW: number, screenH: number) {
  const r = photoW / photoH
  const s = screenW / screenH
  return r > s ? [0, (1 - s / r) / 2, 1, s / r] : [(1 - r / s) / 2, 0, r / s, 1]
}

/** deterministic -1..1 pair so every photo drifts to its own corner, and a
 *  given photo drifts the same way on every reload */
export function photoDrift(id: string): [number, number] {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return [(((h >>> 8) & 0xff) / 255) * 2 - 1, (((h >>> 20) & 0xff) / 255) * 2 - 1]
}

export function createWallRenderer(canvas: HTMLCanvasElement): WallHandle | null {
  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "low-power",
  }) as WebGLRenderingContext | null
  if (!gl) return null

  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)

  const compile = (type: number, src: string) => {
    const sh = gl.createShader(type)!
    gl.shaderSource(sh, src)
    gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      gl.deleteShader(sh)
      throw new Error(gl.getShaderInfoLog(sh) || "shader compile failed")
    }
    return sh
  }

  let sceneProg: WebGLProgram
  let sceneU: {
    photo: WebGLUniformLocation | null
    back: WebGLUniformLocation | null
    rect: WebGLUniformLocation | null
    drift: WebGLUniformLocation | null
    p: number
  }
  try {
    const prog = gl.createProgram()!
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT))
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, SCENE_FRAG))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || "link failed")
    sceneProg = prog
    sceneU = {
      photo: gl.getUniformLocation(prog, "uPhoto"),
      back: gl.getUniformLocation(prog, "uBack"),
      rect: gl.getUniformLocation(prog, "uRect"),
      drift: gl.getUniformLocation(prog, "uDrift"),
      p: gl.getAttribLocation(prog, "_p"),
    }
  } catch {
    return null
  }

  const bindTex = (tex: WebGLTexture, shape: [number, number]): Tex => ({
    tex,
    shape,
    bind: (unit) => {
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, tex)
      return unit
    },
  })

  const makeTex = (src: HTMLImageElement | HTMLCanvasElement, w: number, h: number) => {
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return bindTex(tex, [w, h])
  }

  // a 32x18 copy of the photo, upscaled by the GPU: a cheap blur that costs
  // nothing per frame and survives a six-hour run
  const backCanvas = document.createElement("canvas")
  backCanvas.width = BACK_W
  backCanvas.height = BACK_H
  const backCtx = backCanvas.getContext("2d")!

  type Entry = { photo: Tex; back: Tex; scene: Scene; used: number }
  const entries = new Map<string, Entry>()
  let clock = 0

  const size = { w: 0, h: 0 }
  type Target = { fbo: WebGLFramebuffer; tex: Tex }
  let targets: Target[] = []

  const makeTarget = (w: number, h: number): Target => {
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const fbo = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return { fbo, tex: bindTex(tex, [w, h]) }
  }

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    const w = Math.max(2, Math.round(canvas.clientWidth * dpr))
    const h = Math.max(2, Math.round(canvas.clientHeight * dpr))
    if (w === size.w && h === size.h) return
    size.w = w
    size.h = h
    canvas.width = w
    canvas.height = h
    for (const t of targets) {
      gl.deleteTexture(t.tex.tex)
      gl.deleteFramebuffer(t.fbo)
    }
    targets = [makeTarget(w, h), makeTarget(w, h)]
  }
  resize()

  const drawScene = (target: Target | null, entry: Entry, t: number) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null)
    gl.viewport(0, 0, size.w, size.h)
    gl.useProgram(sceneProg)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.enableVertexAttribArray(sceneU.p)
    gl.vertexAttribPointer(sceneU.p, 2, gl.FLOAT, false, 0, 0)
    const [pw, ph] = entry.photo.shape
    const rect = containRect(pw, ph, size.w, size.h)
    const pan = entry.scene.pan
    gl.uniform1i(sceneU.photo, entry.photo.bind(0))
    gl.uniform1i(sceneU.back, entry.back.bind(1))
    gl.uniform4f(sceneU.rect, rect[0], rect[1], rect[2], rect[3])
    gl.uniform3f(sceneU.drift, pan[0] * PAN * t, pan[1] * PAN * t, 1 / (1 + (ZOOM_TO - 1) * t))
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  const progs = new Map<string, ReturnType<typeof createTransition> | null>()

  const getProg = (transition: WallTransition) => {
    let handle = progs.get(transition.name)
    if (handle === undefined) {
      try {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
        handle = createTransition(gl, transition, { resizeMode: "cover" })
      } catch {
        handle = null
      }
      progs.set(transition.name, handle)
    }
    return handle
  }

  type RenderArgs = Parameters<WallHandle["render"]>
  let lastFrame: RenderArgs | null = null

  const drawFrame = (
    fromId: string | null,
    toId: string,
    progress: number,
    fromT: number,
    toT: number,
    transition: WallTransition | null,
  ): boolean => {
    const to = entries.get(toId)
    if (!to) return false
    resize()
    const from = fromId ? entries.get(fromId) : undefined
    const handle = from && transition ? getProg(transition) : null
    if (!from || !transition || !handle) {
      drawScene(null, to, toT)
      return true
    }
    drawScene(targets[0], from, fromT)
    drawScene(targets[1], to, toT)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, size.w, size.h)
    const params: Record<string, unknown> = {}
    if (transition.paramsTypes.luma === "sampler2D") params.luma = targets[1].tex
    handle.draw(Math.min(1, Math.max(0, progress)), targets[0].tex, targets[1].tex, size.w, size.h, params)
    return true
  }

  return {
    prepare: (id, img) => {
      const hit = entries.get(id)
      if (hit) {
        hit.used = clock++
        return true
      }
      if (!img.complete || !img.naturalWidth) return false
      backCtx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, 0, 0, BACK_W, BACK_H)
      entries.set(id, {
        photo: makeTex(img, img.naturalWidth, img.naturalHeight),
        back: makeTex(backCanvas, BACK_W, BACK_H),
        scene: { img, pan: photoDrift(id) },
        used: clock++,
      })
      return true
    },

    render: (...args) => {
      lastFrame = args
      return drawFrame(...args)
    },

    repaint: () => {
      if (lastFrame) drawFrame(...lastFrame)
    },

    prewarm: (transition) => {
      getProg(transition)
    },

    resize,
    prune: (keep) => {
      if (entries.size <= MAX_ENTRIES) return
      const pinned = new Set(keep)
      for (const [id, e] of [...entries].sort((a, b) => a[1].used - b[1].used)) {
        if (entries.size <= MAX_ENTRIES) break
        if (pinned.has(id)) continue
        gl.deleteTexture(e.photo.tex)
        gl.deleteTexture(e.back.tex)
        entries.delete(id)
      }
    },

    dispose: () => {
      for (const e of entries.values()) {
        gl.deleteTexture(e.photo.tex)
        gl.deleteTexture(e.back.tex)
      }
      entries.clear()
      for (const t of targets) {
        gl.deleteTexture(t.tex.tex)
        gl.deleteFramebuffer(t.fbo)
      }
      targets = []
      for (const h of progs.values()) h?.dispose()
      progs.clear()
      gl.deleteProgram(sceneProg)
      gl.deleteBuffer(buffer)
      // deliberately not WEBGL_lose_context: React remounts this component in
      // StrictMode and on every hot edit, and a lost context is never recovered
      // by the next createWallRenderer() — it shares this same canvas
    },
  }
}
