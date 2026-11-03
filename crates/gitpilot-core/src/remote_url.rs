//! Remote URL parsing and provider detection.

use crate::accounts::Account;
use crate::model::ProviderLink;

#[derive(Debug, PartialEq)]
pub struct ParsedRemote {
    pub host: String,
    /// Path without leading slash and without `.git`.
    pub path: String,
}

/// Understands https://, http://, ssh://, git:// and scp-like `user@host:path`.
pub fn parse(url: &str) -> Option<ParsedRemote> {
    let url = url.trim();
    let (host_part, path) = if let Some((scheme, rest)) = url.split_once("://") {
        if scheme == "file" {
            return None;
        }
        let (authority, path) = rest.split_once('/')?;
        (authority.to_string(), path.to_string())
    } else if let Some((authority, path)) = url.split_once(':') {
        // scp-like syntax; reject Windows paths such as C:\repo
        if authority.contains('/') || authority.len() == 1 {
            return None;
        }
        (authority.to_string(), path.to_string())
    } else {
        return None;
    };
    let host = host_part.rsplit('@').next()?.to_string();
    let host = host.split(':').next()?.to_lowercase();
    let path = path.trim_matches('/').trim_end_matches(".git").trim_matches('/').to_string();
    if host.is_empty() || path.is_empty() {
        return None;
    }
    Some(ParsedRemote { host, path })
}

pub fn provider_link(remotes: &[(String, String)], accounts: &[Account]) -> Option<ProviderLink> {
    let (remote, url) = remotes
        .iter()
        .find(|(n, _)| n == "origin")
        .or_else(|| remotes.first())?;
    let parsed = parse(url)?;
    let account = accounts.iter().find(|a| a.host.eq_ignore_ascii_case(&parsed.host));
    let kind = match account {
        Some(a) => a.kind.clone(),
        None if parsed.host == "github.com" => "github".into(),
        None if parsed.host.contains("gitlab") => "gitlab".into(),
        None => "unknown".into(),
    };
    let base = account.map(|a| a.base_url.trim_end_matches('/').to_string()).unwrap_or_else(|| format!("https://{}", parsed.host));
    Some(ProviderLink {
        kind,
        web_url: format!("{base}/{}", parsed.path),
        host: parsed.host,
        project: parsed.path,
        remote: remote.clone(),
        account_id: account.map(|a| a.id.clone()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(host: &str, path: &str) -> Option<ParsedRemote> {
        Some(ParsedRemote { host: host.into(), path: path.into() })
    }

    #[test]
    fn parses_common_forms() {
        assert_eq!(parse("https://github.com/owner/repo.git"), p("github.com", "owner/repo"));
        assert_eq!(parse("https://user:tok@gitlab.example.com:8443/grp/sub/proj"), p("gitlab.example.com", "grp/sub/proj"));
        assert_eq!(parse("git@github.com:owner/repo.git"), p("github.com", "owner/repo"));
        assert_eq!(parse("ssh://git@gitlab.com:2222/grp/proj.git"), p("gitlab.com", "grp/proj"));
        assert_eq!(parse("/local/path/repo"), None);
        assert_eq!(parse("C:\\repos\\x"), None);
    }
}
