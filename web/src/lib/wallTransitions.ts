import type { TransitionObjectLike } from "gl-transition"

/**
 * Transition shaders for the Live Wall, vendored from the gl-transitions
 * collection (https://github.com/gl-transitions/gl-transitions, MIT). Each
 * body is reproduced verbatim except where noted, with its original
 * author/license header kept next to it.
 *
 * The gl-transition runtime wraps a body with the GLSL it expects:
 * `progress`, `getFromColor(uv)`, `getToColor(uv)` and the params below.
 */

export type WallTransition = TransitionObjectLike & {
  name: string
  /** ms of hand-off; wedding walls stay slow */
  durationMs: number
}

/** gre, MIT — crossfade that brightens toward a warm light-leak.
 *  `color` is inlined as a fixed warm tone so the effect stays on-brand. */
const burn = `
vec4 transition (vec2 uv) {
  vec3 color = vec3(0.95, 0.55, 0.25);
  return mix(
    getFromColor(uv) + vec4(progress*color, 1.0),
    getToColor(uv) + vec4((1.0-progress)*color, 1.0),
    progress
  );
}`

/** gre, MIT — wipe driven by the incoming frame's own luminance.
 *  The wall binds the incoming texture to the `luma` sampler. */
const luma = `
uniform sampler2D luma;
vec4 transition(vec2 uv) {
  return mix(
    getToColor(uv),
    getFromColor(uv),
    step(progress, texture2D(luma, uv).r)
  );
}`

/** Eke Péter, MIT */
const crosswarp = `
vec4 transition(vec2 p) {
  float x = progress;
  x = smoothstep(.0, 1.0, (x*2.0+p.x-1.0));
  return mix(getFromColor((p-.5)*(1.-x)+.5), getToColor((p-.5)*x+.5), x);
}`

/** mikolalysenko, MIT */
const dreamy = `
vec2 offset(float progress, float x, float theta) {
  float phase = progress*progress + progress + theta;
  float shifty = 0.03*progress*cos(10.0*(progress+x));
  return vec2(0, shifty);
}
vec4 transition(vec2 p) {
  return mix(getFromColor(p + offset(progress, p.x, 0.0)), getToColor(p + offset(1.0-progress, p.x, 3.14)), progress);
}`

/** 0gust1, MIT */
const simpleZoom = `
uniform float zoom_quickness;
vec2 zoom(vec2 uv, float amount) {
  return 0.5 + ((uv - 0.5) * (1.0-amount));
}
vec4 transition (vec2 uv) {
  float nQuick = clamp(zoom_quickness,0.2,1.0);
  return mix(
    getFromColor(zoom(uv, smoothstep(0.0, nQuick, progress))),
    getToColor(uv),
    smoothstep(nQuick-0.2, 1.0, progress)
  );
}`

/** Xaychru, MIT — clock-hand iris */
const radial = `
uniform float smoothness;
const float PI = 3.141592653589;
vec4 transition(vec2 p) {
  vec2 rp = p*2.-1.;
  return mix(
    getToColor(p),
    getFromColor(p),
    smoothstep(0., smoothness, atan(rp.y,rp.x) - (progress-.5) * PI * 2.5)
  );
}`

/** gre, MIT — vertical slices widening */
const windowSlice = `
uniform float count;
uniform float smoothness;
vec4 transition (vec2 p) {
  float pr = smoothstep(-smoothness, 0.0, p.x - progress * (1.0 + smoothness));
  float s = step(pr, fract(count * p.x));
  return mix(getFromColor(p), getToColor(p), s);
}`

/** gre, MIT — squeeze with chromatic separation */
const squeeze = `
uniform float colorSeparation;
vec4 transition (vec2 uv) {
  float y = 0.5 + (uv.y-0.5) / (1.0-progress);
  if (y < 0.0 || y > 1.0) {
     return getToColor(uv);
  }
  else {
    vec2 fp = vec2(uv.x, y);
    vec2 off = progress * vec2(0.0, colorSeparation);
    vec4 c = getFromColor(fp);
    vec4 cn = getFromColor(fp - off);
    vec4 cp = getFromColor(fp + off);
    return vec4(cn.r, c.g, cp.b, c.a);
  }
}`

/** paniq, MIT */
const morph = `
uniform float strength;
vec4 transition(vec2 p) {
  vec4 ca = getFromColor(p);
  vec4 cb = getToColor(p);
  vec2 oa = (((ca.rg+ca.b)*0.5)*2.0-1.0);
  vec2 ob = (((cb.rg+cb.b)*0.5)*2.0-1.0);
  vec2 oc = mix(oa,ob,0.5)*strength;
  float w0 = progress;
  float w1 = 1.0-w0;
  return mix(getFromColor(p+oc*w0), getToColor(p-oc*w1), progress);
}`

/** Paweł Płóciennik, MIT */
const waterDrop = `
uniform float amplitude;
uniform float speed;
vec4 transition(vec2 p) {
  vec2 dir = p - vec2(.5);
  float dist = length(dir);
  if (dist > progress) {
    return mix(getFromColor(p), getToColor(p), progress);
  } else {
    vec2 offset = dir * sin(dist * amplitude - progress * speed);
    return mix(getFromColor(p + offset), getToColor(p), progress);
  }
}`

/** Ben Zhang, MIT — flash-of-light crossfade */
const overexposure = `
uniform float strength;
const float PI = 3.141592653589793;
vec4 transition (vec2 uv) {
  vec4 from = getFromColor(uv);
  vec4 to = getToColor(uv);
  float from_m = 1.0 - progress + sin(PI * progress) * strength;
  float to_m = progress + sin(PI * progress) * strength;
  return vec4(
    from.r * from.a * from_m + to.r * to.a * to_m,
    from.g * from.a * from_m + to.g * to.a * to_m,
    from.b * from.a * from_m + to.b * to.a * to_m,
    mix(from.a, to.a, progress)
  );
}`

const t = (
  name: string,
  glsl: string,
  durationMs: number,
  paramsTypes: Record<string, string> = {},
  defaultParams: Record<string, unknown> = {},
): WallTransition => ({ name, glsl, durationMs, paramsTypes, defaultParams })

/** Ordered slowest → snappiest; the wall picks at random, never twice running. */
export const WALL_TRANSITIONS: WallTransition[] = [
  t("fade-burn", burn, 1600),
  t("dreamy", dreamy, 1500),
  t("morph", morph, 1500, { strength: "float" }, { strength: 0.05 }),
  t("luma", luma, 1700, { luma: "sampler2D" }, {}),
  t("crosswarp", crosswarp, 1500),
  t("radial", radial, 1800, { smoothness: "float" }, { smoothness: 0.9 }),
  t("simple-zoom", simpleZoom, 1700, { zoom_quickness: "float" }, { zoom_quickness: 0.8 }),
  t("window-slices", windowSlice, 1500, { count: "float", smoothness: "float" }, { count: 7, smoothness: 0.5 }),
  t("squeeze", squeeze, 1400, { colorSeparation: "float" }, { colorSeparation: 0.012 }),
  t("water-drop", waterDrop, 1600, { amplitude: "float", speed: "float" }, { amplitude: 13, speed: 9 }),
  t("overexposure", overexposure, 1300, { strength: "float" }, { strength: 0.5 }),
]

/** Pick at random, never twice running — a repeated wipe reads as a loop. */
export function pickTransition(previous: string | null): WallTransition {
  const pool = WALL_TRANSITIONS.filter((x) => x.name !== previous)
  return pool[Math.floor(Math.random() * pool.length)]
}

/** slow-out, slow-in hand-off curve; linear drift uses time directly */
export const easeInOut = (x: number) =>
  x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
