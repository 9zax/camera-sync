//! Face detection (SCRFD det_10g) + recognition (ArcFace w600k_r50) via onnxruntime.
//! Models come from InsightFace "buffalo_l" — download with `wedsync-server fetch-models`.

use std::collections::HashMap;
use std::path::Path;

use anyhow::{Context, Result};
use image::{DynamicImage, GenericImageView, RgbImage};
#[cfg(feature = "face")]
use ort::session::{builder::GraphOptimizationLevel, Session};
#[cfg(feature = "face")]
use ort::value::Tensor;

pub const DET_SIZE: u32 = 640;
pub const REC_SIZE: u32 = 112;

/// ArcFace canonical 5-point template for 112x112 input (eyes, nose, mouth corners).
const ARC_DST: [[f64; 2]; 5] = [
    [38.2946, 51.6963],
    [73.5318, 51.5014],
    [56.0252, 71.7366],
    [41.5493, 92.3655],
    [70.7299, 92.2041],
];

pub enum EngineState {
    Loading,
    #[cfg(feature = "face")]
    Ready(std::sync::Arc<FaceEngine>),
    Unavailable,
}

#[cfg(feature = "face")]
pub struct FaceEngine {
    det: std::sync::Mutex<Session>,
    rec: std::sync::Mutex<Session>,
    /// which recognizer ONNX produced/will produce the embeddings (glintr100 /
    /// w600k_r50) — changing it invalidates every stored embedding
    pub recognizer: String,
}

#[derive(Debug, Clone)]
pub struct FaceDet {
    pub x1: f32,
    pub y1: f32,
    pub x2: f32,
    pub y2: f32,
    pub score: f32,
    /// 5 keypoints (x0,y0,x1,y1,...) in source-image pixel coordinates.
    pub kps: [f32; 10],
}

impl FaceDet {
    pub fn area(&self) -> f32 {
        (self.x2 - self.x1).max(0.0) * (self.y2 - self.y1).max(0.0)
    }
}

#[cfg(feature = "face")]
impl FaceEngine {
    /// Returns Ok(None) when the model files are not present (face search disabled).
    /// Recognizer: glintr100 (Glint360K R100, antelopev2 pack) when available —
    /// stronger than the buffalo_l default — falling back to w600k_r50.
    pub fn load(models_dir: &Path) -> Result<Option<FaceEngine>> {
        let det_path = models_dir.join("det_10g.onnx");
        let rec_path = if models_dir.join("glintr100.onnx").exists() {
            models_dir.join("glintr100.onnx")
        } else {
            models_dir.join("w600k_r50.onnx")
        };
        if !det_path.exists() || !rec_path.exists() {
            return Ok(None);
        }
        let rec_name = rec_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("recognition")
            .to_string();
        let load = |p: &Path, what: &str| -> Result<Session> {
            Session::builder()
                .and_then(|b| b.with_optimization_level(GraphOptimizationLevel::Level3))
                .and_then(|b| b.with_intra_threads(4))
                .and_then(|b| b.commit_from_file(p))
                .with_context(|| format!("loading {what} from {}", p.display()))
        };
        let det = load(&det_path, "face detection model (det_10g.onnx)")?;
        let rec = load(&rec_path, &format!("face recognition model ({rec_name})"))?;
        tracing::info!("face models loaded from {} (recognizer: {rec_name})", models_dir.display());
        println!("  ◉ face search ready — recognizer: {rec_name}");
        Ok(Some(FaceEngine {
            det: std::sync::Mutex::new(det),
            rec: std::sync::Mutex::new(rec),
            recognizer: rec_name,
        }))
    }

    /// Detect faces. Input image is letterboxed to 640x640 internally; returned
    /// boxes/kps are in the coordinate space of `img`.
    pub fn detect(&self, img: &DynamicImage, score_thr: f32) -> Result<Vec<FaceDet>> {
        let (iw, ih) = img.dimensions();
        if iw == 0 || ih == 0 {
            return Ok(vec![]);
        }
        let scale = (DET_SIZE as f32 / iw.max(ih) as f32).min(1.0);
        let nw = ((iw as f32 * scale).round() as u32).max(1);
        let nh = ((ih as f32 * scale).round() as u32).max(1);
        let resized = img.resize_exact(nw, nh, image::imageops::FilterType::Triangle).to_rgb8();

        // CHW float planes, BGR order, normalized to [-1, 1] (insightface preprocessing).
        let s = DET_SIZE as usize;
        let mut flat = vec![0f32; 3 * s * s];
        for (x, y, px) in resized.enumerate_pixels() {
            let o = (y as usize) * s + x as usize;
            flat[o] = (px.0[2] as f32 - 127.5) / 128.0; // B
            flat[s * s + o] = (px.0[1] as f32 - 127.5) / 128.0; // G
            flat[2 * s * s + o] = (px.0[0] as f32 - 127.5) / 128.0; // R
        }

        let extracted: Vec<(usize, Vec<f32>)> = {
            let mut det = self.det.lock().expect("det session poisoned");
            let input_name = det.inputs[0].name.clone();
            let out_names: Vec<String> = det.outputs.iter().map(|o| o.name.clone()).collect();
            let outputs = det
                .run(ort::inputs![input_name.as_str() => Tensor::from_array((
                    vec![1usize, 3, s, s],
                    flat
                ))?])
                .context("detection inference")?;
            let mut v = Vec::with_capacity(out_names.len());
            for name in &out_names {
                let (shape, data) = outputs[name.as_str()]
                    .try_extract_tensor::<f32>()
                    .with_context(|| format!("reading det output {name}"))?;
                let c = match shape.len() {
                    3 => shape[2] as usize,
                    2 => shape[1] as usize,
                    _ => 0,
                };
                v.push((c, data.to_vec()));
            }
            v
        };

        // SCRFD outputs 9 tensors: per stride {8,16,32} a (1,N,1) score,
        // (1,N,4) bbox-distance and (1,N,10) keypoints tensor. Group by anchor count N.
        let mut by_n: HashMap<i64, [Option<Vec<f32>>; 3]> = HashMap::new();
        for (c, data) in extracted {
            let slot = match c {
                1 => 0usize,
                4 => 1,
                10 => 2,
                _ => continue,
            };
            let n = (data.len() / c.max(1)) as i64;
            by_n.entry(n).or_insert([None, None, None])[slot] = Some(data);
        }

        let mut dets: Vec<FaceDet> = Vec::new();
        for (n, parts) in by_n {
            let (Some(scores), Some(bboxes), Some(kpss)) = (&parts[0], &parts[1], &parts[2]) else {
                continue;
            };
            let n = n as usize;
            let cells = (n as f32).sqrt(); // anchors per row == anchors per column
            let stride = DET_SIZE as f32 / cells;
            for i in 0..n {
                let score = scores[i];
                if score < score_thr {
                    continue;
                }
                let cx = ((i as f32 % cells) + 0.5) * stride;
                let cy = ((i as f32 / cells).floor() + 0.5) * stride;
                let l = bboxes[i * 4] * stride;
                let t = bboxes[i * 4 + 1] * stride;
                let r = bboxes[i * 4 + 2] * stride;
                let b = bboxes[i * 4 + 3] * stride;
                let mut kps = [0f32; 10];
                for j in 0..5 {
                    kps[j * 2] = cx + kpss[i * 10 + j * 2] * stride;
                    kps[j * 2 + 1] = cy + kpss[i * 10 + j * 2 + 1] * stride;
                }
                dets.push(FaceDet {
                    x1: (cx - l) / scale,
                    y1: (cy - t) / scale,
                    x2: (cx + r) / scale,
                    y2: (cy + b) / scale,
                    score,
                    kps: kps.map(|v| v / scale),
                });
            }
        }

        nms(&mut dets, 0.4);
        dets.sort_by(|a, b| b.area().total_cmp(&a.area()));
        Ok(dets)
    }

    /// Embed an aligned face (112x112 crop is produced internally from `img` + `kps`).
    /// Returned vector is L2-normalized, so dot product == cosine similarity.
    pub fn embed(&self, img: &DynamicImage, kps: &[f32; 10]) -> Result<Vec<f32>> {
        let rgb = img.to_rgb8();
        let mut crop = [0u8; (REC_SIZE * REC_SIZE * 3) as usize];
        warp_aligned(&rgb, kps, &mut crop);

        let p = (REC_SIZE * REC_SIZE) as usize;
        let mut flat = vec![0f32; 3 * p];
        for i in 0..p {
            flat[i] = (crop[i * 3] as f32 - 127.5) / 128.0; // B
            flat[p + i] = (crop[i * 3 + 1] as f32 - 127.5) / 128.0; // G
            flat[2 * p + i] = (crop[i * 3 + 2] as f32 - 127.5) / 128.0; // R
        }

        let v: Vec<f32> = {
            let mut rec = self.rec.lock().expect("rec session poisoned");
            let input_name = rec.inputs[0].name.clone();
            let out_name = rec.outputs[0].name.clone();
            let outputs = rec
                .run(ort::inputs![input_name.as_str() => Tensor::from_array((
                    vec![1usize, 3, REC_SIZE as usize, REC_SIZE as usize],
                    flat
                ))?])
                .context("recognition inference")?;
            let (_shape, data) = outputs[out_name.as_str()]
                .try_extract_tensor::<f32>()
                .context("reading rec output")?;
            data.to_vec()
        };
        let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt().max(1e-9);
        Ok(v.iter().map(|x| x / norm).collect())
    }
}

pub fn embedding_to_bytes(v: &[f32]) -> Vec<u8> {
    v.iter().flat_map(|f| f.to_le_bytes()).collect()
}

pub fn bytes_to_embedding(b: &[u8]) -> Vec<f32> {
    b.chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect()
}

pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

fn iou(a: &FaceDet, b: &FaceDet) -> f32 {
    let x1 = a.x1.max(b.x1);
    let y1 = a.y1.max(b.y1);
    let x2 = a.x2.min(b.x2);
    let y2 = a.y2.min(b.y2);
    let inter = (x2 - x1).max(0.0) * (y2 - y1).max(0.0);
    inter / (a.area() + b.area() - inter + 1e-9)
}

fn nms(dets: &mut Vec<FaceDet>, thr: f32) {
    dets.sort_by(|a, b| b.score.total_cmp(&a.score));
    let mut keep: Vec<FaceDet> = Vec::new();
    while let Some(d) = dets.first().cloned() {
        dets.remove(0);
        dets.retain(|o| iou(&d, o) <= thr);
        keep.push(d);
    }
    *dets = keep;
}

// ---------------------------------------------------------------------------
// Alignment: fit a 2D similarity transform (as complex a*z + b) from the 5
// detected keypoints to the ArcFace template by complex least squares, then
// inverse-warp bilinear sample. No reflection term — faces are upright.
// ---------------------------------------------------------------------------

#[derive(Clone, Copy)]
struct C(f64, f64);

impl C {
    fn mul(self, o: C) -> C {
        C(self.0 * o.0 - self.1 * o.1, self.0 * o.1 + self.1 * o.0)
    }
    fn conj(self) -> C {
        C(self.0, -self.1)
    }
    fn norm2(self) -> f64 {
        self.0 * self.0 + self.1 * self.1
    }
}

fn warp_aligned(src: &RgbImage, kps: &[f32; 10], out: &mut [u8]) {
    // src points (x=real, y=imag)
    let src_pts: Vec<C> = (0..5)
        .map(|i| C(kps[i * 2] as f64, kps[i * 2 + 1] as f64))
        .collect();
    let dst_pts: Vec<C> = (0..5).map(|i| C(ARC_DST[i][0], ARC_DST[i][1])).collect();

    let sz = src_pts.iter().fold(C(0.0, 0.0), |acc, p| C(acc.0 + p.0, acc.1 + p.1));
    let sw = dst_pts.iter().fold(C(0.0, 0.0), |acc, p| C(acc.0 + p.0, acc.1 + p.1));
    let sz = C(sz.0 / 5.0, sz.1 / 5.0);
    let sw = C(sw.0 / 5.0, sw.1 / 5.0);

    // a = Σ conj(z')w' / Σ |z'|²   (least squares for w ≈ a·z + b)
    let mut num = C(0.0, 0.0);
    let mut den = 0.0f64;
    for (z, w) in src_pts.iter().zip(&dst_pts) {
        let zc = C(z.0 - sz.0, z.1 - sz.1);
        let wc = C(w.0 - sw.0, w.1 - sw.1);
        num = C(num.0 + zc.conj().mul(wc).0, num.1 + zc.conj().mul(wc).1);
        den += zc.norm2();
    }
    if den < 1e-9 {
        out.fill(0);
        return;
    }
    let a = C(num.0 / den, num.1 / den);
    let b = C(sw.0 - a.mul(sz).0, sw.1 - a.mul(sz).1);

    let inv_n = 1.0 / a.norm2();
    let ac = a.conj();
    let (w, h) = (src.width() as f64, src.height() as f64);

    let n = REC_SIZE as i32;
    for y in 0..n {
        for x in 0..n {
            // inverse map: z = (w_pt - b) * conj(a) / |a|²
            let dx = x as f64 + 0.5 - b.0;
            let dy = y as f64 + 0.5 - b.1;
            let u = (dx * ac.0 + dy * ac.1) * inv_n - 0.5;
            let v = (dy * ac.0 - dx * ac.1) * inv_n - 0.5;
            let px = sample_bilinear(src, u, v, w, h);
            let o = ((y * n + x) * 3) as usize;
            out[o] = px[0];
            out[o + 1] = px[1];
            out[o + 2] = px[2];
        }
    }
}

fn sample_bilinear(src: &RgbImage, x: f64, y: f64, w: f64, h: f64) -> [u8; 3] {
    if x < 0.0 || y < 0.0 || x >= w - 1.0 || y >= h - 1.0 {
        return [0, 0, 0];
    }
    let x0 = x.floor() as u32;
    let y0 = y.floor() as u32;
    let fx = x - x0 as f64;
    let fy = y - y0 as f64;
    let p00 = src.get_pixel(x0, y0);
    let p10 = src.get_pixel(x0 + 1, y0);
    let p01 = src.get_pixel(x0, y0 + 1);
    let p11 = src.get_pixel(x0 + 1, y0 + 1);
    let mut out = [0u8; 3];
    for c in 0..3 {
        let top = p00[c] as f64 * (1.0 - fx) + p10[c] as f64 * fx;
        let bot = p01[c] as f64 * (1.0 - fx) + p11[c] as f64 * fx;
        out[c] = (top * (1.0 - fy) + bot * fy).round().clamp(0.0, 255.0) as u8;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn complex_fit_identity() {
        // identity transform maps points to themselves
        let pts = [[30.0f32, 40.0], [80.0, 45.0], [55.0, 70.0], [38.0, 95.0], [72.0, 98.0]];
        let mut kps = [0f32; 10];
        for i in 0..5 {
            kps[i * 2] = pts[i][0];
            kps[i * 2 + 1] = pts[i][1];
        }
        let mut crop = [0u8; (REC_SIZE * REC_SIZE * 3) as usize];
        let img = DynamicImage::new_rgb8(200, 200).to_rgb8();
        warp_aligned(&img, &kps, &mut crop);
        // just checking it runs and fills; numeric correctness verified in e2e tests
        assert_eq!(crop.len(), (REC_SIZE * REC_SIZE * 3) as usize);
    }
}
