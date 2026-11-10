//! Accounts of the GitHub CLI (`gh auth login`): GitPilot uses them without copying their tokens.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

use crate::accounts::{endpoints, Account};
use crate::error::{Error, Result};
use crate::tr;

static GH_BIN: OnceLock<Option<PathBuf>> = OnceLock::new();

/// The `gh` executable, if installed. GUI apps on macOS start with a minimal PATH,
/// so the usual Homebrew locations are probed explicitly.
fn binary() -> Option<&'static Path> {
    GH_BIN
        .get_or_init(|| {
            let exe = if cfg!(windows) { "gh.exe" } else { "gh" };
            let mut candidates: Vec<PathBuf> = Vec::new();
            if cfg!(target_os = "macos") {
                candidates.push("/opt/homebrew/bin/gh".into());
                candidates.push("/usr/local/bin/gh".into());
            }
            if let Some(path) = std::env::var_os("PATH") {
                candidates.extend(std::env::split_paths(&path).map(|d| d.join(exe)));
            }
            candidates.push("/usr/bin/gh".into());
            candidates.into_iter().find(|p| p.is_file())
        })
        .as_deref()
}

/// Configuration directory of gh, as gh itself resolves it.
fn config_dir() -> Option<PathBuf> {
    let var = |k: &str| std::env::var_os(k).filter(|v| !v.is_empty()).map(PathBuf::from);
    if let Some(d) = var("GH_CONFIG_DIR") {
        return Some(d);
    }
    if let Some(d) = var("XDG_CONFIG_HOME") {
        return Some(d.join("gh"));
    }
    if cfg!(windows) {
        if let Some(d) = var("AppData") {
            return Some(d.join("GitHub CLI"));
        }
    }
    var("HOME").map(|h| h.join(".config").join("gh"))
}

/// `(host, login)` pairs of a gh `hosts.yml`. Since gh 2.40 every host lists its accounts under
/// `users:`; older files only have the active `user:`.
pub fn parse_hosts(yaml: &str) -> Vec<(String, String)> {
    fn key(s: &str) -> &str {
        s.trim().trim_end_matches(':').trim().trim_matches(|c| c == '"' || c == '\'')
    }
    struct Host {
        name: String,
        users: Vec<String>,
        active: Option<String>,
    }
    let mut hosts: Vec<Host> = Vec::new();
    // Indent of `users:` and of the account names right below it (their settings are deeper).
    let mut users_indent: Option<usize> = None;
    let mut child_indent: Option<usize> = None;
    for line in yaml.lines() {
        let text = line.trim_end();
        let trimmed = text.trim_start();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let indent = text.len() - trimmed.len();
        if indent == 0 {
            hosts.push(Host { name: key(trimmed).to_lowercase(), users: vec![], active: None });
            users_indent = None;
            continue;
        }
        let Some(host) = hosts.last_mut() else { continue };
        if let Some(ui) = users_indent {
            if indent > ui {
                if indent == *child_indent.get_or_insert(indent) {
                    let name = key(trimmed.split_once(':').map(|(k, _)| k).unwrap_or(trimmed));
                    if !name.is_empty() && !host.users.iter().any(|u| u == name) {
                        host.users.push(name.to_string());
                    }
                }
                continue;
            }
            users_indent = None;
        }
        if trimmed == "users:" {
            users_indent = Some(indent);
            child_indent = None;
        } else if let Some(u) = trimmed.strip_prefix("user:") {
            let u = key(u);
            if !u.is_empty() {
                host.active = Some(u.to_string());
            }
        }
    }
    hosts
        .into_iter()
        .flat_map(|h| {
            let users = if h.users.is_empty() { h.active.into_iter().collect() } else { h.users };
            let name = h.name;
            users.into_iter().map(move |u| (name.clone(), u))
        })
        .collect()
}

/// Accounts gh is logged in with on GitHub hosts (no network, no token read).
pub fn accounts() -> Vec<Account> {
    if binary().is_none() {
        return vec![];
    }
    let Some(file) = config_dir().map(|d| d.join("hosts.yml")) else {
        return vec![];
    };
    let Ok(yaml) = std::fs::read_to_string(file) else {
        return vec![];
    };
    parse_hosts(&yaml)
        .into_iter()
        .filter_map(|(host, login)| {
            let (host, base_url, api_url) = endpoints("github", &host).ok()?;
            Some(Account {
                id: format!("gh:{host}:{login}"),
                kind: "github".into(),
                host,
                base_url,
                api_url,
                username: login,
                name: None,
                avatar_url: None,
                token_in_file: false,
                from_gh: true,
            })
        })
        .collect()
}

fn gh(args: &[&str]) -> Result<String> {
    let bin = binary().ok_or_else(|| Error::msg(tr!("GitHub CLI (gh) non trovata", "GitHub CLI (gh) not found")))?;
    let mut cmd = Command::new(bin);
    cmd.args(args)
        // A token in the environment would answer for every account.
        .env_remove("GH_TOKEN")
        .env_remove("GITHUB_TOKEN")
        .env_remove("GH_ENTERPRISE_TOKEN")
        .env_remove("GITHUB_ENTERPRISE_TOKEN")
        .env("GH_PROMPT_DISABLED", "1")
        .env("NO_COLOR", "1");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let out = cmd.output()?;
    if !out.status.success() {
        return Err(Error::msg(String::from_utf8_lossy(&out.stderr).trim().to_string()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Token of a gh account, asked to gh every time (GitPilot never stores it).
pub fn token(host: &str, login: &str) -> Result<String> {
    let token = gh(&["auth", "token", "--hostname", host, "--user", login]).or_else(|e| {
        // gh before 2.40 has no --user, and a single account per host.
        let single = accounts().iter().filter(|a| a.host == host).count() == 1;
        if single { gh(&["auth", "token", "--hostname", host]) } else { Err(e) }
    });
    match token {
        Ok(t) if !t.is_empty() => Ok(t),
        Ok(_) | Err(_) => Err(Error::msg(tr!(
            "GitHub CLI: nessun token per {login} su {host} (prova `gh auth login`)",
            "GitHub CLI: no token for {login} on {host} (try `gh auth login`)"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pairs(v: &[(&str, &str)]) -> Vec<(String, String)> {
        v.iter().map(|(h, u)| (h.to_string(), u.to_string())).collect()
    }

    #[test]
    fn multi_account_hosts() {
        let yaml = "github.com:\n    git_protocol: https\n    users:\n        mauro-work:\n        Mauro-Personal:\n            git_protocol: ssh\n    user: mauro-work\nghe.acme.com:\n    users:\n        ops:\n    user: ops\n";
        assert_eq!(
            parse_hosts(yaml),
            pairs(&[("github.com", "mauro-work"), ("github.com", "Mauro-Personal"), ("ghe.acme.com", "ops")])
        );
    }

    #[test]
    fn single_account_hosts_of_old_gh() {
        let yaml = "github.com:\n    oauth_token: gho_xxx\n    user: someone\n    git_protocol: ssh\n";
        assert_eq!(parse_hosts(yaml), pairs(&[("github.com", "someone")]));
        assert!(parse_hosts("").is_empty());
        assert!(parse_hosts("# nothing\n").is_empty());
    }
}
