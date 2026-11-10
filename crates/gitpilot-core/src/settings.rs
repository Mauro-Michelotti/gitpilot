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

/// Named set of repositories shown as a single tab with second-level tabs.
#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct RepoGroup {
    /// `group:<random>`: never a path, so it can sit in `open_tabs` next to repository paths.
    pub id: String,
    pub name: String,
    /// Repository roots, in tab order; a repository belongs to one group at most.
    pub repos: Vec<String>,
    /// Last active second-level tab.
    pub active_repo: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub recent: Vec<RecentRepo>,
    /// Top-level tabs: repository paths and `RepoGroup` ids.
    pub open_tabs: Vec<String>,
    /// Repository shown (also when it is a tab of a group).
    pub active_tab: Option<String>,
    /// Saved groups, open or not.
    pub groups: Vec<RepoGroup>,
    /// system | dark | light
    pub theme: String,
    /// ff | ff-only | rebase
    pub pull_mode: String,
    pub graph_limit: u32,
    pub clone_dir: Option<String>,
    pub author_avatars: bool,
    /// system | it | en
    pub language: String,
    /// Use the accounts of the GitHub CLI (`gh auth login`) for pull requests and issues.
    pub use_gh_accounts: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            recent: vec![],
            open_tabs: vec![],
            active_tab: None,
            groups: vec![],
            theme: "system".into(),
            pull_mode: "ff".into(),
            graph_limit: 2000,
            clone_dir: None,
            author_avatars: true,
            language: "system".into(),
            use_gh_accounts: true,
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

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("gitpilot-settings-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn settings_without_groups_still_load() {
        let s: Settings = serde_json::from_str(r#"{"openTabs":["/r/a"],"activeTab":"/r/a","theme":"dark"}"#).unwrap();
        assert!(s.groups.is_empty());
        assert_eq!(s.open_tabs, ["/r/a"]);
        assert_eq!(s.theme, "dark");
    }

    #[test]
    fn groups_survive_save_and_touch_recent() {
        let dir = tmp_dir("groups");
        let store = SettingsStore::new(&dir);
        let group = RepoGroup {
            id: "group:abc".into(),
            name: "iPick".into(),
            repos: vec!["/r/be".into(), "/r/fe".into()],
            active_repo: Some("/r/fe".into()),
        };
        let s = Settings {
            open_tabs: vec!["group:abc".into(), "/r/other".into()],
            active_tab: Some("/r/fe".into()),
            groups: vec![group.clone()],
            ..Settings::default()
        };
        store.save(&s).unwrap();
        // Opening a repository rewrites the file from the backend: the groups must stay.
        store.touch_recent("/r/other").unwrap();
        let back = store.load();
        assert_eq!(back.groups, [group]);
        assert_eq!(back.open_tabs, ["group:abc", "/r/other"]);
        assert_eq!(back.active_tab.as_deref(), Some("/r/fe"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
