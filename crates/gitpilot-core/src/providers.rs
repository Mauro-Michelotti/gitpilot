//! GitHub (REST v3) and GitLab (REST v4) integration.

use std::time::Duration;

use reqwest::{Client, Method, RequestBuilder, Response};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::accounts::Account;
use crate::error::{Error, Result};
use crate::util::url_encode;

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UserInfo {
    pub username: String,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RemoteRepo {
    pub full_name: String,
    pub name: String,
    pub description: Option<String>,
    pub private: bool,
    pub clone_https: String,
    pub clone_ssh: String,
    pub web_url: String,
    pub default_branch: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PullRequest {
    /// PR number (GitHub) or MR iid (GitLab).
    pub number: u64,
    pub title: String,
    pub author: String,
    pub source_branch: String,
    pub target_branch: String,
    pub web_url: String,
    pub draft: bool,
    pub state: String,
    pub updated_at: Option<String>,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NewPullRequest {
    pub title: String,
    #[serde(default)]
    pub body: String,
    pub source_branch: String,
    pub target_branch: String,
    #[serde(default)]
    pub draft: bool,
}

fn client() -> Result<Client> {
    Ok(Client::builder()
        .user_agent(concat!("GitPilot/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(30))
        .build()?)
}

fn request(c: &Client, kind: &str, method: Method, url: &str, token: &str) -> RequestBuilder {
    let rb = c.request(method, url);
    match kind {
        "github" => rb
            .bearer_auth(token)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28"),
        _ => rb.header("PRIVATE-TOKEN", token),
    }
}

async fn check(resp: Response) -> Result<Response> {
    let status = resp.status();
    if status.is_success() {
        return Ok(resp);
    }
    let body = resp.text().await.unwrap_or_default();
    let detail = serde_json::from_str::<Value>(&body)
        .ok()
        .and_then(|v| {
            let mut parts: Vec<String> = Vec::new();
            match &v["message"] {
                Value::String(s) => parts.push(s.clone()),
                Value::Null => {}
                other => parts.push(other.to_string()),
            }
            if let Some(errs) = v["errors"].as_array() {
                for e in errs {
                    if let Some(m) = e["message"].as_str() {
                        parts.push(m.to_string());
                    } else if let Some(c) = e["code"].as_str() {
                        parts.push(format!("{} {}", e["field"].as_str().unwrap_or(""), c));
                    }
                }
            }
            if let Some(e) = v["error"].as_str() {
                parts.push(e.to_string());
            }
            (!parts.is_empty()).then(|| parts.join(" — "))
        })
        .unwrap_or_else(|| body.chars().take(300).collect());
    let hint = match status.as_u16() {
        401 => " (token non valido o scaduto)",
        403 => " (permessi del token insufficienti)",
        404 => " (risorsa non trovata o non accessibile al token)",
        _ => "",
    };
    Err(Error::Api(format!("{}{hint}: {detail}", status)))
}

async fn get_json(c: &Client, acc_kind: &str, url: &str, token: &str) -> Result<(Value, Option<String>)> {
    let resp = check(request(c, acc_kind, Method::GET, url, token).send().await?).await?;
    let next = next_page(acc_kind, &resp, url);
    Ok((resp.json().await?, next))
}

/// Next-page URL from GitHub `Link` or GitLab `x-next-page` headers.
fn next_page(kind: &str, resp: &Response, url: &str) -> Option<String> {
    if kind == "github" {
        let link = resp.headers().get("link")?.to_str().ok()?;
        link.split(',').find_map(|part| {
            let (u, rel) = part.split_once(';')?;
            rel.contains("rel=\"next\"").then(|| u.trim().trim_matches(['<', '>']).to_string())
        })
    } else {
        let next = resp.headers().get("x-next-page")?.to_str().ok()?.trim().to_string();
        if next.is_empty() {
            return None;
        }
        let base = url.split("&page=").next().unwrap_or(url);
        Some(format!("{base}&page={next}"))
    }
}

fn s(v: &Value) -> String {
    v.as_str().unwrap_or_default().to_string()
}

fn opt(v: &Value) -> Option<String> {
    v.as_str().map(str::to_string)
}

pub async fn whoami(kind: &str, api_url: &str, token: &str) -> Result<UserInfo> {
    let c = client()?;
    let (v, _) = get_json(&c, kind, &format!("{api_url}/user"), token).await?;
    let username = match kind {
        "github" => s(&v["login"]),
        _ => s(&v["username"]),
    };
    if username.is_empty() {
        return Err(Error::Api("risposta /user inattesa".into()));
    }
    Ok(UserInfo { username, name: opt(&v["name"]).filter(|n| !n.is_empty()), avatar_url: opt(&v["avatar_url"]) })
}

const MAX_PAGES: usize = 10;

pub async fn list_repos(acc: &Account, token: &str) -> Result<Vec<RemoteRepo>> {
    let c = client()?;
    let mut url = Some(match acc.kind.as_str() {
        "github" => format!("{}/user/repos?per_page=100&sort=updated", acc.api_url),
        _ => format!("{}/projects?membership=true&order_by=last_activity_at&per_page=100", acc.api_url),
    });
    let mut out = Vec::new();
    let mut pages = 0;
    while let Some(u) = url.take() {
        let (v, next) = get_json(&c, &acc.kind, &u, token).await?;
        for r in v.as_array().into_iter().flatten() {
            out.push(match acc.kind.as_str() {
                "github" => RemoteRepo {
                    full_name: s(&r["full_name"]),
                    name: s(&r["name"]),
                    description: opt(&r["description"]),
                    private: r["private"].as_bool().unwrap_or(false),
                    clone_https: s(&r["clone_url"]),
                    clone_ssh: s(&r["ssh_url"]),
                    web_url: s(&r["html_url"]),
                    default_branch: opt(&r["default_branch"]),
                    updated_at: opt(&r["pushed_at"]).or_else(|| opt(&r["updated_at"])),
                },
                _ => RemoteRepo {
                    full_name: s(&r["path_with_namespace"]),
                    name: s(&r["name"]),
                    description: opt(&r["description"]).filter(|d| !d.is_empty()),
                    private: r["visibility"].as_str().map(|v| v != "public").unwrap_or(true),
                    clone_https: s(&r["http_url_to_repo"]),
                    clone_ssh: s(&r["ssh_url_to_repo"]),
                    web_url: s(&r["web_url"]),
                    default_branch: opt(&r["default_branch"]),
                    updated_at: opt(&r["last_activity_at"]),
                },
            });
        }
        pages += 1;
        if pages < MAX_PAGES {
            url = next;
        }
    }
    Ok(out)
}

fn pr_from(kind: &str, v: &Value) -> PullRequest {
    match kind {
        "github" => PullRequest {
            number: v["number"].as_u64().unwrap_or(0),
            title: s(&v["title"]),
            author: s(&v["user"]["login"]),
            source_branch: s(&v["head"]["ref"]),
            target_branch: s(&v["base"]["ref"]),
            web_url: s(&v["html_url"]),
            draft: v["draft"].as_bool().unwrap_or(false),
            state: s(&v["state"]),
            updated_at: opt(&v["updated_at"]),
        },
        _ => PullRequest {
            number: v["iid"].as_u64().unwrap_or(0),
            title: s(&v["title"]),
            author: s(&v["author"]["username"]),
            source_branch: s(&v["source_branch"]),
            target_branch: s(&v["target_branch"]),
            web_url: s(&v["web_url"]),
            draft: v["draft"].as_bool().or(v["work_in_progress"].as_bool()).unwrap_or(false),
            state: s(&v["state"]),
            updated_at: opt(&v["updated_at"]),
        },
    }
}

pub async fn list_pull_requests(acc: &Account, token: &str, project: &str) -> Result<Vec<PullRequest>> {
    let c = client()?;
    let url = match acc.kind.as_str() {
        "github" => format!("{}/repos/{project}/pulls?state=open&per_page=100", acc.api_url),
        _ => format!("{}/projects/{}/merge_requests?state=opened&per_page=100", acc.api_url, url_encode(project)),
    };
    let (v, _) = get_json(&c, &acc.kind, &url, token).await?;
    Ok(v.as_array().into_iter().flatten().map(|p| pr_from(&acc.kind, p)).collect())
}

pub async fn create_pull_request(acc: &Account, token: &str, project: &str, pr: &NewPullRequest) -> Result<PullRequest> {
    if pr.title.trim().is_empty() {
        return Err(Error::msg("il titolo è obbligatorio"));
    }
    let c = client()?;
    let (url, body) = match acc.kind.as_str() {
        "github" => (
            format!("{}/repos/{project}/pulls", acc.api_url),
            json!({ "title": pr.title, "body": pr.body, "head": pr.source_branch, "base": pr.target_branch, "draft": pr.draft }),
        ),
        _ => {
            let title = if pr.draft && !pr.title.starts_with("Draft:") { format!("Draft: {}", pr.title) } else { pr.title.clone() };
            (
                format!("{}/projects/{}/merge_requests", acc.api_url, url_encode(project)),
                json!({ "title": title, "description": pr.body, "source_branch": pr.source_branch, "target_branch": pr.target_branch, "remove_source_branch": false }),
            )
        }
    };
    let resp = check(request(&c, &acc.kind, Method::POST, &url, token).json(&body).send().await?).await?;
    let v: Value = resp.json().await?;
    Ok(pr_from(&acc.kind, &v))
}
