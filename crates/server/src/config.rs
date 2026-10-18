use std::path::PathBuf;

#[derive(Clone)]
pub struct Config {
    pub data_dir: PathBuf,
    pub web_dist: PathBuf,
    pub public_app_url: String,
    pub face_threshold: f32,
    pub secret: String,
}

impl Config {
    pub fn load(data_dir: PathBuf) -> anyhow::Result<Self> {
        std::fs::create_dir_all(&data_dir)?;
        for sub in ["originals", "thumbs", "web", "models"] {
            std::fs::create_dir_all(data_dir.join(sub))?;
        }
        let secret_path = data_dir.join("secret.key");
        let secret = match std::fs::read_to_string(&secret_path) {
            Ok(s) if s.trim().len() >= 32 => s.trim().to_string(),
            _ => {
                let s = crate::util::random_token();
                std::fs::write(&secret_path, &s)?;
                s
            }
        };
        Ok(Config {
            public_app_url: std::env::var("PUBLIC_APP_URL")
                .unwrap_or_else(|_| "http://localhost:5173".into()),
            face_threshold: std::env::var("FACE_THRESHOLD")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(0.35),
            web_dist: PathBuf::from(
                std::env::var("WEB_DIST").unwrap_or_else(|_| "web/dist".into()),
            ),
            data_dir,
            secret,
        })
    }

    pub fn db_path(&self) -> PathBuf {
        self.data_dir.join("wedsync.db")
    }
    pub fn models_dir(&self) -> PathBuf {
        self.data_dir.join("models")
    }
    pub fn originals_dir(&self) -> PathBuf {
        self.data_dir.join("originals")
    }
    pub fn thumbs_dir(&self) -> PathBuf {
        self.data_dir.join("thumbs")
    }
    pub fn web_dir(&self) -> PathBuf {
        self.data_dir.join("web")
    }

    pub fn orig_path(&self, hash: &str, ext: &str) -> PathBuf {
        self.originals_dir()
            .join(&hash[..2])
            .join(format!("{hash}.{ext}"))
    }
    pub fn thumb_path(&self, hash: &str) -> PathBuf {
        self.thumbs_dir().join(format!("{hash}.jpg"))
    }
    pub fn web_path(&self, hash: &str) -> PathBuf {
        self.web_dir().join(format!("{hash}.jpg"))
    }
}
