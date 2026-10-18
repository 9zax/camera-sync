use std::io::{Read, Write};
use std::path::Path;

use anyhow::{bail, Context, Result};
use indicatif::{ProgressBar, ProgressStyle};

const MODEL_URLS: [&str; 2] = [
    "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip",
    "https://github.com/deepinsight/insightface/releases/download/v0.7/antelopev2.zip",
];

/// Download InsightFace buffalo_l and extract the two models we need
/// (SCRFD det_10g.onnx + ArcFace w600k_r50.onnx).
pub fn fetch_models(dir: &Path) -> Result<()> {
    std::fs::create_dir_all(dir)?;
    if dir.join("det_10g.onnx").exists() && dir.join("w600k_r50.onnx").exists() {
        println!("✓ face models already present at {}", dir.display());
        return Ok(());
    }
    let zip_path = dir.join("models.zip");
    let mut downloaded = false;
    for url in MODEL_URLS {
        println!("⇣ downloading face models from {url} (~280 MB, one time)");
        match download(url, &zip_path) {
            Ok(n) => {
                println!("  downloaded {:.1} MB", n as f64 / 1_048_576.0);
                downloaded = true;
                break;
            }
            Err(e) => {
                eprintln!("  download failed: {e:#}");
                let _ = std::fs::remove_file(&zip_path);
            }
        }
    }
    if !downloaded {
        bail!(
            "could not download the models — check network access, or manually copy \
             det_10g.onnx and w600k_r50.onnx into {}",
            dir.display()
        );
    }

    let f = std::fs::File::open(&zip_path)?;
    let mut zip = zip::ZipArchive::new(f)?;
    for name in ["det_10g.onnx", "w600k_r50.onnx"] {
        let mut entry = zip
            .by_name(name)
            .with_context(|| format!("{name} missing in model zip"))?;
        let out_path = dir.join(name);
        let tmp = dir.join(format!("{name}.part"));
        let mut out = std::fs::File::create(&tmp)?;
        std::io::copy(&mut entry, &mut out)?;
        std::fs::rename(&tmp, &out_path)?;
    }
    drop(zip);
    let _ = std::fs::remove_file(&zip_path);
    println!("✓ face models ready in {}", dir.display());
    Ok(())
}

fn download(url: &str, dest: &Path) -> Result<u64> {
    let resp = ureq::get(url)
        // covers slow links for the ~280 MB archive
        .timeout(std::time::Duration::from_secs(600))
        .call()
        .context("HTTP request failed")?;
    let len: u64 = resp
        .header("Content-Length")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let reader = resp.into_reader();
    let file = std::fs::File::create(dest)?;
    let mut writer = std::io::BufWriter::new(file);
    let n = if len > 0 {
        let pb = ProgressBar::new(len);
        pb.set_style(
            ProgressStyle::with_template(
                "{spinner:.green} {bar:36.cyan/blue} {bytes}/{total_bytes} ({eta})",
            )?
            .progress_chars("##-"),
        );
        let mut reader = pb.wrap_read(reader);
        let n = std::io::copy(&mut reader, &mut writer)?;
        pb.finish_and_clear();
        n
    } else {
        let mut reader = reader;
        let mut buf = [0u8; 65536];
        let mut n = 0u64;
        loop {
            let read = reader.read(&mut buf)?;
            if read == 0 {
                break;
            }
            use std::io::Write;
            writer.write_all(&buf[..read])?;
            n += read as u64;
        }
        n
    };
    writer.flush()?;
    Ok(n)
}
