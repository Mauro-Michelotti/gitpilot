//! GitHub (REST v3) and GitLab (REST v4) integration.

use std::time::Duration;

use reqwest::{Client, Method, RequestBuilder, Response};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::accounts::Account;
use crate::error::{Error, Result};
use crate::markdown;
use crate::tr;
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

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IssueLabel {
    pub name: String,
    /// `#rrggbb`
    pub color: Option<String>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    /// Issue number (GitHub) or iid (GitLab).
    pub number: u64,
    pub title: String,
    /// open | closed
    pub state: String,
    pub author: String,
    pub labels: Vec<IssueLabel>,
    pub assignees: Vec<String>,
    pub milestone: Option<String>,
    pub comments: u64,
    pub web_url: String,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IssueComment {
    pub author: String,
    pub created_at: Option<String>,
    /// Sanitized HTML.
    pub body_html: String,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IssueDetail {
    pub issue: Issue,
    /// Sanitized HTML of the description.
    pub body_html: String,
    pub comments: Vec<IssueComment>,
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

const GITHUB_JSON: &str = "application/vnd.github+json";
/// GitHub media type that adds `body_html`, rendered by GitHub (mentions, references, signed image URLs).
const GITHUB_FULL: &str = "application/vnd.github.full+json";

fn request(c: &Client, kind: &str, method: Method, url: &str, token: &str) -> RequestBuilder {
    request_accept(c, kind, method, url, token, GITHUB_JSON)
}

fn request_accept(c: &Client, kind: &str, method: Method, url: &str, token: &str, github_accept: &str) -> RequestBuilder {
    let rb = c.request(method, url);
    match kind {
        "github" => rb
            .bearer_auth(token)
            .header("Accept", github_accept)
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
        401 => tr!(" (token non valido o scaduto)", " (invalid or expired token)"),
        403 => tr!(" (permessi del token insufficienti)", " (insufficient token permissions)"),
        404 => tr!(" (risorsa non trovata o non accessibile al token)", " (resource not found or not accessible with this token)"),
        _ => String::new(),
    };
    Err(Error::Api(format!("{}{hint}: {detail}", status)))
}

async fn get_json(c: &Client, acc_kind: &str, url: &str, token: &str) -> Result<(Value, Option<String>)> {
    get_json_accept(c, acc_kind, url, token, GITHUB_JSON).await
}

async fn get_json_accept(c: &Client, acc_kind: &str, url: &str, token: &str, github_accept: &str) -> Result<(Value, Option<String>)> {
    let resp = check(request_accept(c, acc_kind, Method::GET, url, token, github_accept).send().await?).await?;
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
        return Err(Error::Api(tr!("risposta /user inattesa", "unexpected /user response")));
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
        return Err(Error::msg(tr!("il titolo è obbligatorio", "the title is required")));
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

fn issue_from(kind: &str, v: &Value) -> Issue {
    let names = |list: &Value, key: &str| -> Vec<String> {
        list.as_array().into_iter().flatten().map(|a| s(&a[key])).filter(|n| !n.is_empty()).collect()
    };
    let labels = v["labels"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|l| match l {
            // GitLab without `with_labels_details`: plain names.
            Value::String(name) => IssueLabel { name: name.clone(), color: None },
            _ => IssueLabel {
                name: s(&l["name"]),
                color: opt(&l["color"]).filter(|c| !c.is_empty()).map(|c| if c.starts_with('#') { c } else { format!("#{c}") }),
            },
        })
        .collect();
    let milestone = opt(&v["milestone"]["title"]);
    match kind {
        "github" => Issue {
            number: v["number"].as_u64().unwrap_or(0),
            title: s(&v["title"]),
            state: s(&v["state"]),
            author: s(&v["user"]["login"]),
            labels,
            assignees: names(&v["assignees"], "login"),
            milestone,
            comments: v["comments"].as_u64().unwrap_or(0),
            web_url: s(&v["html_url"]),
            created_at: opt(&v["created_at"]),
            updated_at: opt(&v["updated_at"]),
        },
        _ => Issue {
            number: v["iid"].as_u64().unwrap_or(0),
            title: s(&v["title"]),
            state: if v["state"] == "opened" { "open".into() } else { s(&v["state"]) },
            author: s(&v["author"]["username"]),
            labels,
            assignees: names(&v["assignees"], "username"),
            milestone,
            comments: v["user_notes_count"].as_u64().unwrap_or(0),
            web_url: s(&v["web_url"]),
            created_at: opt(&v["created_at"]),
            updated_at: opt(&v["updated_at"]),
        },
    }
}

/// Issues of the project, most recently updated first (one page: the 100 most recent).
/// `state`: open | closed; `mine`: only those assigned to the account.
pub async fn list_issues(acc: &Account, token: &str, project: &str, state: &str, mine: bool) -> Result<Vec<Issue>> {
    let c = client()?;
    let closed = state == "closed";
    let url = match acc.kind.as_str() {
        "github" => format!(
            "{}/repos/{project}/issues?state={}&sort=updated&per_page=100{}",
            acc.api_url,
            if closed { "closed" } else { "open" },
            if mine { format!("&assignee={}", url_encode(&acc.username)) } else { String::new() },
        ),
        _ => format!(
            "{}/projects/{}/issues?state={}&order_by=updated_at&with_labels_details=true&per_page=100{}",
            acc.api_url,
            url_encode(project),
            if closed { "closed" } else { "opened" },
            if mine { "&scope=assigned_to_me" } else { "" },
        ),
    };
    let (v, _) = get_json(&c, &acc.kind, &url, token).await?;
    Ok(v.as_array()
        .into_iter()
        .flatten()
        // GitHub lists pull requests among the issues.
        .filter(|i| i["pull_request"].is_null())
        .map(|i| issue_from(&acc.kind, i))
        .collect())
}

/// Web page of the project, from the URL of one of its issues.
fn project_url(issue_url: &str) -> &str {
    issue_url
        .split_once("/-/issues/")
        .or_else(|| issue_url.split_once("/issues/"))
        .map(|(p, _)| p)
        .unwrap_or(issue_url)
}

/// Issue with description and comments (the first 100), as sanitized HTML.
pub async fn issue_detail(acc: &Account, token: &str, project: &str, number: u64) -> Result<IssueDetail> {
    let c = client()?;
    match acc.kind.as_str() {
        "github" => {
            let base = format!("{}/repos/{project}/issues/{number}", acc.api_url);
            let (v, _) = get_json_accept(&c, &acc.kind, &base, token, GITHUB_FULL).await?;
            // The issues API answers for pull requests too.
            if !v["pull_request"].is_null() {
                return Err(Error::Api(tr!("#{number} è una pull request, non un'issue", "#{number} is a pull request, not an issue")));
            }
            let issue = issue_from(&acc.kind, &v);
            let web = project_url(&issue.web_url).to_string();
            let body_html = markdown::sanitize(v["body_html"].as_str().unwrap_or_default(), &web);
            let (cs, _) = get_json_accept(&c, &acc.kind, &format!("{base}/comments?per_page=100"), token, GITHUB_FULL).await?;
            let comments = cs
                .as_array()
                .into_iter()
                .flatten()
                .map(|n| IssueComment {
                    author: s(&n["user"]["login"]),
                    created_at: opt(&n["created_at"]),
                    body_html: markdown::sanitize(n["body_html"].as_str().unwrap_or_default(), &web),
                })
                .collect();
            Ok(IssueDetail { issue, body_html, comments })
        }
        _ => {
            let base = format!("{}/projects/{}/issues/{number}", acc.api_url, url_encode(project));
            let (v, _) = get_json(&c, &acc.kind, &format!("{base}?with_labels_details=true"), token).await?;
            let issue = issue_from(&acc.kind, &v);
            let web = project_url(&issue.web_url).to_string();
            let body_html = markdown::render(v["description"].as_str().unwrap_or_default(), &web);
            let (ns, _) = get_json(&c, &acc.kind, &format!("{base}/notes?sort=asc&order_by=created_at&per_page=100"), token).await?;
            let comments = ns
                .as_array()
                .into_iter()
                .flatten()
                // System notes: "changed the description", "added label"...
                .filter(|n| !n["system"].as_bool().unwrap_or(false))
                .map(|n| IssueComment {
                    author: s(&n["author"]["username"]),
                    created_at: opt(&n["created_at"]),
                    body_html: markdown::render(n["body"].as_str().unwrap_or_default(), &web),
                })
                .collect();
            Ok(IssueDetail { issue, body_html, comments })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn github_issue() {
        let v = json!({
            "number": 42, "title": "Conferma quantità", "state": "open",
            "user": { "login": "giulia" },
            "labels": [{ "name": "enhancement", "color": "a2eeef" }],
            "assignees": [{ "login": "mario" }],
            "milestone": { "title": "1.1.0" },
            "comments": 2, "html_url": "https://github.com/o/r/issues/42",
            "created_at": "2026-11-01T10:00:00Z", "updated_at": "2026-11-02T10:00:00Z"
        });
        let i = issue_from("github", &v);
        assert_eq!((i.number, i.state.as_str(), i.author.as_str(), i.comments), (42, "open", "giulia", 2));
        assert_eq!(i.labels, [IssueLabel { name: "enhancement".into(), color: Some("#a2eeef".into()) }]);
        assert_eq!(i.assignees, ["mario"]);
        assert_eq!(i.milestone.as_deref(), Some("1.1.0"));
        assert_eq!(project_url(&i.web_url), "https://github.com/o/r");
    }

    #[test]
    fn gitlab_issue() {
        let v = json!({
            "iid": 7, "title": "Errore 500", "state": "opened",
            "author": { "username": "luca" },
            "labels": [{ "name": "bug", "color": "#d73a4a" }, "plain"],
            "assignees": [{ "username": "mario" }, { "username": "giulia" }],
            "milestone": null, "user_notes_count": 4,
            "web_url": "https://gitlab.example.com/team/app/-/issues/7"
        });
        let i = issue_from("gitlab", &v);
        assert_eq!((i.number, i.state.as_str(), i.author.as_str(), i.comments), (7, "open", "luca", 4));
        assert_eq!(i.labels[0].color.as_deref(), Some("#d73a4a"));
        assert_eq!(i.labels[1], IssueLabel { name: "plain".into(), color: None });
        assert_eq!(i.assignees, ["mario", "giulia"]);
        assert_eq!(i.milestone, None);
        assert_eq!(project_url(&i.web_url), "https://gitlab.example.com/team/app");
    }
}
