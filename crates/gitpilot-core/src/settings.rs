//! Persistent UI settings (recent repositories, open tabs, preferences).

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::Result;

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct RecentRepo {
    pub path: String,
    pub name: String,
    pub last_opened: i64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub recent: Vec<RecentRepo>,
    pub open_tabs: Vec<String>,
    pub active_tab: Option<String>,
    /// system | dark | light
    pub theme: String,
    /// ff | ff-only | rebase
    pub pull_mode: String,
    pub graph_limit: u32,
    pub clone_dir: Option<String>,
    pub author_avatars: bool,
    /// system | it | en
    pub language: String,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            recent: vec![],
            open_tabs: vec![],
            active_tab: None,
            theme: "system".into(),
            pull_mode: "ff".into(),
            graph_limit: 2000,
            clone_dir: None,
            author_avatars: true,
            language: "system".into(),
        }
    }
}

pub struct SettingsStore {
    file: PathBuf,
}

impl SettingsStore {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        SettingsStore { file: dir.into().join("settings.json") }
    }

    pub fn load(&self) -> Settings {
        std::fs::read(&self.file)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, s: &Settings) -> Result<()> {
        if let Some(dir) = self.file.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = self.file.with_extension("tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(s)?)?;
        std::fs::rename(tmp, &self.file)?;
        Ok(())
    }

    /// Record a repository as recently opened (most recent first, max 30).
    pub fn touch_recent(&self, path: &str) -> Result<Settings> {
        let mut s = self.load();
        s.recent.retain(|r| r.path != path);
        let name = std::path::Path::new(path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| path.to_string());
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        s.recent.insert(0, RecentRepo { path: path.to_string(), name, last_opened: now });
        s.recent.truncate(30);
        self.save(&s)?;
        Ok(s)
    }
}
