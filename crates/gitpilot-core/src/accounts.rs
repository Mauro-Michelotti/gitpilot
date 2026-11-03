//! GitHub/GitLab accounts. Metadata in `accounts.json`, tokens in the OS
//! credential store (GNOME Keyring/KWallet, macOS Keychain, Windows Credential
//! Manager). If no credential store is reachable the token falls back to a
//! 0600 file, like `gh` does, and the account is flagged accordingly.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::ops::NetAuth;
use crate::util::base64;

const KEYRING_SERVICE: &str = "dev.gitpilot.app";

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    /// github | gitlab
    pub kind: String,
    /// Hostname used to match remotes (github.com, gitlab.example.com).
    pub host: String,
    /// Web base URL (https://github.com, https://gitlab.example.com).
    pub base_url: String,
    pub api_url: String,
    pub username: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    /// Token stored in a file because no OS keyring was available.
    #[serde(default)]
    pub token_in_file: bool,
}

/// Derive web/API URLs from what the user typed ("", "gitlab.acme.it", "https://ghe.acme.com").
pub fn endpoints(kind: &str, host_input: &str) -> Result<(String, String, String)> {
    let input = host_input.trim().trim_end_matches('/');
    let default_host = match kind {
        "github" => "github.com",
        "gitlab" => "gitlab.com",
        _ => return Err(Error::msg(format!("provider sconosciuto: {kind}"))),
    };
    let base = if input.is_empty() {
        format!("https://{default_host}")
    } else if input.starts_with("http://") || input.starts_with("https://") {
        input.to_string()
    } else {
        format!("https://{input}")
    };
    let host = base
        .split_once("://")
        .map(|(_, r)| r)
        .unwrap_or(&base)
        .split(['/', ':'])
        .next()
        .unwrap_or_default()
        .to_lowercase();
    if host.is_empty() {
        return Err(Error::msg("indirizzo server non valido"));
    }
    let api = match (kind, host.as_str()) {
        ("github", "github.com") => "https://api.github.com".to_string(),
        ("github", _) => format!("{base}/api/v3"),
        _ => format!("{base}/api/v4"),
    };
    Ok((host, base, api))
}

pub struct AccountStore {
    dir: PathBuf,
}

impl AccountStore {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        AccountStore { dir: dir.into() }
    }

    fn accounts_file(&self) -> PathBuf {
        self.dir.join("accounts.json")
    }

    fn tokens_file(&self) -> PathBuf {
        self.dir.join("tokens.json")
    }

    pub fn list(&self) -> Result<Vec<Account>> {
        match std::fs::read(self.accounts_file()) {
            Ok(b) => Ok(serde_json::from_slice(&b)?),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
            Err(e) => Err(e.into()),
        }
    }

    fn save(&self, list: &[Account]) -> Result<()> {
        std::fs::create_dir_all(&self.dir)?;
        write_atomic(&self.accounts_file(), &serde_json::to_vec_pretty(list)?, false)
    }

    pub fn get(&self, id: &str) -> Result<Account> {
        self.list()?
            .into_iter()
            .find(|a| a.id == id)
            .ok_or_else(|| Error::msg("account non trovato"))
    }

    /// Insert or replace an account and store its token.
    pub fn upsert(&self, mut account: Account, token: &str) -> Result<Account> {
        account.token_in_file = false;
        if let Err(e) = keyring::Entry::new(KEYRING_SERVICE, &account.id).and_then(|en| en.set_password(token)) {
            eprintln!("keyring non disponibile ({e}), token salvato su file");
            let mut map = self.file_tokens()?;
            map.insert(account.id.clone(), token.to_string());
            self.save_file_tokens(&map)?;
            account.token_in_file = true;
        }
        let mut list = self.list()?;
        list.retain(|a| a.id != account.id);
        list.push(account.clone());
        self.save(&list)?;
        Ok(account)
    }

    pub fn remove(&self, id: &str) -> Result<()> {
        if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, id) {
            let _ = entry.delete_credential();
        }
        let mut map = self.file_tokens()?;
        if map.remove(id).is_some() {
            self.save_file_tokens(&map)?;
        }
        let mut list = self.list()?;
        list.retain(|a| a.id != id);
        self.save(&list)
    }

    pub fn token(&self, account: &Account) -> Result<String> {
        if account.token_in_file {
            return self
                .file_tokens()?
                .remove(&account.id)
                .ok_or_else(|| Error::msg(format!("token mancante per {}", account.id)));
        }
        Ok(keyring::Entry::new(KEYRING_SERVICE, &account.id)?.get_password()?)
    }

    fn file_tokens(&self) -> Result<HashMap<String, String>> {
        match std::fs::read(self.tokens_file()) {
            Ok(b) => Ok(serde_json::from_slice(&b)?),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
            Err(e) => Err(e.into()),
        }
    }

    fn save_file_tokens(&self, map: &HashMap<String, String>) -> Result<()> {
        std::fs::create_dir_all(&self.dir)?;
        write_atomic(&self.tokens_file(), &serde_json::to_vec(map)?, true)
    }

    /// Git config entries that authenticate HTTPS remotes of every account
    /// (first account wins when several share a host).
    pub fn net_auth(&self) -> NetAuth {
        let mut seen = std::collections::HashSet::new();
        let mut auth = Vec::new();
        for acc in self.list().unwrap_or_default() {
            if !seen.insert(acc.base_url.clone()) {
                continue;
            }
            if let Ok(token) = self.token(&acc) {
                let cred = base64(format!("{}:{}", acc.username, token).as_bytes());
                auth.push((
                    format!("http.{}/.extraheader", acc.base_url.trim_end_matches('/')),
                    format!("AUTHORIZATION: basic {cred}"),
                ));
            }
        }
        auth
    }
}

fn write_atomic(path: &Path, data: &[u8], private: bool) -> Result<()> {
    let tmp = path.with_extension("tmp");
    {
        let mut opts = std::fs::OpenOptions::new();
        opts.write(true).create(true).truncate(true);
        #[cfg(unix)]
        if private {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        #[cfg(not(unix))]
        let _ = private;
        use std::io::Write;
        let mut f = opts.open(&tmp)?;
        f.write_all(data)?;
        f.sync_all()?;
    }
    std::fs::rename(tmp, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_derivation() {
        assert_eq!(
            endpoints("github", "").unwrap(),
            ("github.com".into(), "https://github.com".into(), "https://api.github.com".into())
        );
        assert_eq!(
            endpoints("github", "ghe.acme.com").unwrap(),
            ("ghe.acme.com".into(), "https://ghe.acme.com".into(), "https://ghe.acme.com/api/v3".into())
        );
        assert_eq!(
            endpoints("gitlab", "http://git.local:8080/").unwrap(),
            ("git.local".into(), "http://git.local:8080".into(), "http://git.local:8080/api/v4".into())
        );
    }
}
