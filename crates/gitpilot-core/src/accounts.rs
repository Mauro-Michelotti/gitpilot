//! GitHub/GitLab accounts. Metadata in `accounts.json`, tokens in the OS
//! credential store (GNOME Keyring/KWallet, macOS Keychain, Windows Credential
//! Manager). If no credential store is reachable the token falls back to a
//! 0600 file, like `gh` does, and the account is flagged accordingly.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::ops::NetAuth;
use crate::tr;
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
    /// Account of the GitHub CLI: its token is asked to `gh` when needed, never stored here.
    #[serde(default)]
    pub from_gh: bool,
}

/// Derive web/API URLs from what the user typed ("", "gitlab.acme.it", "https://ghe.acme.com").
pub fn endpoints(kind: &str, host_input: &str) -> Result<(String, String, String)> {
    let input = host_input.trim().trim_end_matches('/');
    let default_host = match kind {
        "github" => "github.com",
        "gitlab" => "gitlab.com",
        _ => return Err(Error::msg(tr!("provider sconosciuto: {kind}", "unknown provider: {kind}"))),
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
        return Err(Error::msg(tr!("indirizzo server non valido", "invalid server address")));
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

    /// Accounts added in GitPilot, then (with `with_gh`) those of the GitHub CLI that are not
    /// already among them.
    pub fn all(&self, with_gh: bool) -> Vec<Account> {
        let mut list = self.list().unwrap_or_default();
        if with_gh {
            for a in crate::gh::accounts() {
                let known = list
                    .iter()
                    .any(|m| m.host.eq_ignore_ascii_case(&a.host) && m.username.eq_ignore_ascii_case(&a.username));
                if !known {
                    list.push(a);
                }
            }
        }
        list
    }

    /// Account by id, GitHub CLI accounts included.
    pub fn get(&self, id: &str) -> Result<Account> {
        self.all(id.starts_with("gh:"))
            .into_iter()
            .find(|a| a.id == id)
            .ok_or_else(|| Error::msg(tr!("account non trovato", "account not found")))
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
        if account.from_gh {
            return crate::gh::token(&account.host, &account.username);
        }
        if account.token_in_file {
            return self
                .file_tokens()?
                .remove(&account.id)
                .ok_or_else(|| Error::msg(tr!("token mancante per {}", "missing token for {}", account.id)));
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

/// Access of an account to a project, as the provider reports it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Access {
    /// Not found, not authorized, or the check failed.
    None,
    Read,
    Write,
}

/// Account to use for a project among those of its host: write access first, then the one
/// named like the project owner, then those added in GitPilot over the GitHub CLI ones.
pub fn pick_account<'a>(candidates: &'a [(Account, Access)], project: &str) -> Option<&'a Account> {
    let owner = project.split('/').next().unwrap_or_default();
    candidates
        .iter()
        .enumerate()
        // max_by_key keeps the last of equal keys: the reversed index makes the first one win.
        .max_by_key(|(i, (a, access))| (*access, a.username.eq_ignore_ascii_case(owner), !a.from_gh, std::cmp::Reverse(*i)))
        .map(|(_, (a, _))| a)
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

    fn acc(username: &str, from_gh: bool) -> Account {
        Account {
            id: format!("{}:github.com:{username}", if from_gh { "gh" } else { "github" }),
            kind: "github".into(),
            host: "github.com".into(),
            base_url: "https://github.com".into(),
            api_url: "https://api.github.com".into(),
            username: username.into(),
            name: None,
            avatar_url: None,
            token_in_file: false,
            from_gh,
        }
    }

    #[test]
    fn picks_the_account_for_the_project() {
        let work = acc("mauro-work", true);
        let personal = acc("Mauro-Personal", true);
        let pick = |c: &[(Account, Access)], p: &str| pick_account(c, p).map(|a| a.username.clone());
        // Organisation repo: only the work account can push.
        let c = [(work.clone(), Access::Write), (personal.clone(), Access::Read)];
        assert_eq!(pick(&c, "ACME/app").as_deref(), Some("mauro-work"));
        // Public personal repo: both can read, only the owner can push.
        let c = [(work.clone(), Access::Read), (personal.clone(), Access::Write)];
        assert_eq!(pick(&c, "Mauro-Personal/gitpilot").as_deref(), Some("Mauro-Personal"));
        // Same access: the owner wins, then the account added in GitPilot, then the first.
        let c = [(work.clone(), Access::Read), (personal.clone(), Access::Read)];
        assert_eq!(pick(&c, "mauro-personal/x").as_deref(), Some("Mauro-Personal"));
        let manual = acc("other", false);
        let c = [(work.clone(), Access::Read), (manual, Access::Read)];
        assert_eq!(pick(&c, "ACME/app").as_deref(), Some("other"));
        let c = [(work, Access::None), (personal, Access::None)];
        assert_eq!(pick(&c, "ACME/app").as_deref(), Some("mauro-work"));
        assert!(pick_account(&[], "ACME/app").is_none());
    }

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
