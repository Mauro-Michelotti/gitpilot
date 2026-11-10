//! Tauri commands: thin async wrappers around `gitpilot_core`.
//!
//! Every git invocation is blocking, so it runs on the blocking thread pool to
//! keep the UI responsive. Errors cross the bridge as plain strings.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use gitpilot_core::accounts::{self, Access, Account, AccountStore};
use gitpilot_core::conflict::{self, ConflictDoc};
use gitpilot_core::gitflow::{self, FinishOptions};
use gitpilot_core::model::*;
use gitpilot_core::providers::{self, Issue, IssueDetail, NewPullRequest, PullRequest, RemoteRepo};
use gitpilot_core::settings::Settings;
use gitpilot_core::{ops, remote_url, repo, tr, Git};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::AppState;

type CmdResult<T> = Result<T, String>;

async fn blocking<T, F>(f: F) -> CmdResult<T>
where
    F: FnOnce() -> gitpilot_core::Result<T> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

fn git(path: &str) -> Git {
    Git::new(path)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    op_id: String,
    line: String,
}

/// Progress callback that forwards git's stderr lines to the UI, throttled.
fn progress_emitter(app: AppHandle, op_id: String) -> impl FnMut(&str) {
    let mut last = Instant::now() - Duration::from_secs(1);
    move |line: &str| {
        if last.elapsed() >= Duration::from_millis(80) {
            last = Instant::now();
            let _ = app.emit("git-progress", Progress { op_id: op_id.clone(), line: line.to_string() });
        }
    }
}

// ---------------------------------------------------------------- app

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: String,
    git_version: String,
    config_dir: String,
    home_dir: String,
}

#[tauri::command]
pub async fn app_info(state: State<'_, AppState>) -> CmdResult<AppInfo> {
    let config_dir = state.config_dir.to_string_lossy().to_string();
    blocking(move || {
        Ok(AppInfo {
            version: env!("CARGO_PKG_VERSION").into(),
            git_version: gitpilot_core::git::git_version().unwrap_or_else(|_| tr!("git non trovato", "git not found")),
            config_dir,
            home_dir: std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_default(),
        })
    })
    .await
}

#[tauri::command]
pub async fn settings_get(state: State<'_, AppState>) -> CmdResult<Settings> {
    Ok(state.settings.load())
}

#[tauri::command]
pub async fn settings_save(state: State<'_, AppState>, settings: Settings) -> CmdResult<()> {
    if settings.use_gh_accounts != state.settings.load().use_gh_accounts {
        forget_account_choices(&state);
    }
    state.settings.save(&settings).map_err(|e| e.to_string())
}

/// Language resolved by the frontend ("it" | "en") for backend messages and git output.
#[tauri::command]
pub fn set_language(language: String) {
    gitpilot_core::i18n::set_language(&language);
}

// ---------------------------------------------------------------- repositories

#[tauri::command]
pub async fn repo_open(state: State<'_, AppState>, path: String) -> CmdResult<String> {
    let root = blocking(move || repo::open(Path::new(&path))).await?;
    let root = root.to_string_lossy().to_string();
    state.settings.touch_recent(&root).map_err(|e| e.to_string())?;
    Ok(root)
}

#[tauri::command]
pub async fn repo_init(state: State<'_, AppState>, path: String, default_branch: String) -> CmdResult<String> {
    blocking(move || ops::init(Path::new(&path), &default_branch).and_then(|_| repo::open(Path::new(&path))))
        .await
        .and_then(|root| {
            let root = root.to_string_lossy().to_string();
            state.settings.touch_recent(&root).map_err(|e| e.to_string())?;
            Ok(root)
        })
}

#[tauri::command]
pub async fn repo_clone(app: AppHandle, state: State<'_, AppState>, op_id: String, url: String, dest: String) -> CmdResult<String> {
    let dir = state.config_dir.clone();
    let root = blocking(move || {
        let auth = AccountStore::new(&dir).net_auth();
        let mut progress = progress_emitter(app, op_id);
        let dest = PathBuf::from(&dest);
        ops::clone(&url, &dest, &auth, &mut progress)?;
        repo::open(&dest)
    })
    .await?;
    let root = root.to_string_lossy().to_string();
    state.settings.touch_recent(&root).map_err(|e| e.to_string())?;
    Ok(root)
}

#[tauri::command]
pub async fn repo_overview(state: State<'_, AppState>, path: String) -> CmdResult<RepoOverview> {
    let dir = state.config_dir.clone();
    let with_gh = state.settings.load().use_gh_accounts;
    let choices = state.account_choice.lock().map(|m| m.clone()).unwrap_or_default();
    blocking(move || {
        let accounts = AccountStore::new(&dir).all(with_gh);
        let mut o = repo::overview(&git(&path), &accounts)?;
        // Several accounts on the host: show the one actually chosen for this project, once known.
        if let Some(p) = o.provider.as_mut() {
            if let Some(id) = choices.get(&choice_key(&p.host, &p.project)).filter(|id| accounts.iter().any(|a| &a.id == *id)) {
                p.account_id = Some(id.clone());
            }
        }
        Ok(o)
    })
    .await
}

#[tauri::command]
pub async fn repo_status(path: String) -> CmdResult<StatusResult> {
    blocking(move || repo::status(&git(&path))).await
}

#[tauri::command]
pub async fn repo_graph(path: String, limit: usize, wip: bool) -> CmdResult<GraphResult> {
    blocking(move || repo::graph(&git(&path), limit.clamp(50, 100_000), wip)).await
}

#[tauri::command]
pub async fn diff_working(path: String, file: String, old_path: Option<String>, staged: bool, untracked: bool) -> CmdResult<FileDiff> {
    blocking(move || repo::working_diff(&git(&path), &file, old_path.as_deref(), staged, untracked)).await
}

#[tauri::command]
pub async fn diff_commit(path: String, hash: String, file: String, old_path: Option<String>) -> CmdResult<FileDiff> {
    blocking(move || repo::commit_file_diff(&git(&path), &hash, &file, old_path.as_deref())).await
}

#[tauri::command]
pub async fn commit_details(path: String, hash: String) -> CmdResult<CommitDetails> {
    blocking(move || repo::commit_details(&git(&path), &hash)).await
}

#[tauri::command]
pub async fn last_commit_message(path: String) -> CmdResult<String> {
    blocking(move || repo::last_message(&git(&path))).await
}

// ---------------------------------------------------------------- index & commit

#[tauri::command]
pub async fn stage(path: String, files: Vec<String>) -> CmdResult<()> {
    blocking(move || ops::stage(&git(&path), &files)).await
}

#[tauri::command]
pub async fn unstage(path: String, files: Vec<String>) -> CmdResult<()> {
    blocking(move || ops::unstage(&git(&path), &files)).await
}

#[tauri::command]
pub async fn stage_all(path: String) -> CmdResult<()> {
    blocking(move || ops::stage_all(&git(&path))).await
}

#[tauri::command]
pub async fn unstage_all(path: String) -> CmdResult<()> {
    blocking(move || ops::unstage_all(&git(&path))).await
}

#[tauri::command]
pub async fn discard(path: String, tracked: Vec<String>, untracked: Vec<String>) -> CmdResult<()> {
    blocking(move || ops::discard(&git(&path), &tracked, &untracked)).await
}

#[tauri::command]
pub async fn discard_all(path: String) -> CmdResult<()> {
    blocking(move || ops::discard_all(&git(&path))).await
}

#[tauri::command]
pub async fn apply_hunk(path: String, file: String, old_path: Option<String>, hunk_header: String, action: String) -> CmdResult<()> {
    blocking(move || ops::apply_hunk(&git(&path), &file, old_path.as_deref(), &hunk_header, &action)).await
}

#[tauri::command]
pub async fn commit(path: String, message: String, amend: bool) -> CmdResult<String> {
    blocking(move || ops::commit(&git(&path), &message, amend)).await
}

// ---------------------------------------------------------------- network

#[tauri::command]
pub async fn fetch(app: AppHandle, state: State<'_, AppState>, path: String, op_id: String, remote: Option<String>) -> CmdResult<()> {
    let dir = state.config_dir.clone();
    blocking(move || {
        let auth = AccountStore::new(&dir).net_auth();
        let mut progress = progress_emitter(app, op_id);
        ops::fetch(&git(&path), remote.as_deref(), &auth, &mut progress)
    })
    .await
}

#[tauri::command]
pub async fn pull(app: AppHandle, state: State<'_, AppState>, path: String, op_id: String, mode: String) -> CmdResult<OpOutcome> {
    let dir = state.config_dir.clone();
    blocking(move || {
        let auth = AccountStore::new(&dir).net_auth();
        let mut progress = progress_emitter(app, op_id);
        ops::pull(&git(&path), &mode, &auth, &mut progress)
    })
    .await
}

#[tauri::command]
pub async fn pull_branch(app: AppHandle, state: State<'_, AppState>, path: String, op_id: String, branch: String) -> CmdResult<String> {
    let dir = state.config_dir.clone();
    blocking(move || {
        let auth = AccountStore::new(&dir).net_auth();
        let mut progress = progress_emitter(app, op_id);
        ops::pull_branch(&git(&path), &branch, &auth, &mut progress)
    })
    .await
}

#[tauri::command]
pub async fn pull_all_branches(app: AppHandle, state: State<'_, AppState>, path: String, op_id: String) -> CmdResult<PullAllReport> {
    let dir = state.config_dir.clone();
    blocking(move || {
        let auth = AccountStore::new(&dir).net_auth();
        let mut progress = progress_emitter(app, op_id);
        ops::pull_all_branches(&git(&path), &auth, &mut progress)
    })
    .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn push(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    op_id: String,
    branch: Option<String>,
    remote: Option<String>,
    force: bool,
) -> CmdResult<String> {
    let dir = state.config_dir.clone();
    blocking(move || {
        let auth = AccountStore::new(&dir).net_auth();
        let mut progress = progress_emitter(app, op_id);
        ops::push(&git(&path), branch.as_deref(), remote.as_deref(), force, &auth, &mut progress)
    })
    .await
}

// ---------------------------------------------------------------- branches, tags, remotes

#[tauri::command]
pub async fn checkout(path: String, branch: String) -> CmdResult<()> {
    blocking(move || ops::checkout(&git(&path), &branch)).await
}

#[tauri::command]
pub async fn checkout_remote(path: String, full: String) -> CmdResult<String> {
    blocking(move || ops::checkout_remote(&git(&path), &full)).await
}

#[tauri::command]
pub async fn checkout_commit(path: String, hash: String) -> CmdResult<()> {
    blocking(move || ops::checkout_commit(&git(&path), &hash)).await
}

#[tauri::command]
pub async fn branch_create(path: String, name: String, start: Option<String>, checkout: bool) -> CmdResult<()> {
    blocking(move || ops::create_branch(&git(&path), name.trim(), start.as_deref(), checkout)).await
}

#[tauri::command]
pub async fn branch_delete(path: String, name: String, force: bool) -> CmdResult<()> {
    blocking(move || ops::delete_branch(&git(&path), &name, force)).await
}

#[tauri::command]
pub async fn branch_rename(path: String, old: String, new: String) -> CmdResult<()> {
    blocking(move || ops::rename_branch(&git(&path), &old, new.trim())).await
}

#[tauri::command]
pub async fn branch_delete_remote(state: State<'_, AppState>, path: String, remote: String, name: String) -> CmdResult<()> {
    let dir = state.config_dir.clone();
    blocking(move || ops::delete_remote_branch(&git(&path), &remote, &name, &AccountStore::new(&dir).net_auth())).await
}

#[tauri::command]
pub async fn branch_set_upstream(path: String, branch: String, upstream: String) -> CmdResult<()> {
    blocking(move || ops::set_upstream(&git(&path), &branch, &upstream)).await
}

#[tauri::command]
pub async fn tag_create(path: String, name: String, target: String, message: Option<String>) -> CmdResult<()> {
    blocking(move || ops::create_tag(&git(&path), name.trim(), &target, message.as_deref())).await
}

#[tauri::command]
pub async fn tag_delete(path: String, name: String) -> CmdResult<()> {
    blocking(move || ops::delete_tag(&git(&path), &name)).await
}

#[tauri::command]
pub async fn tag_push(state: State<'_, AppState>, path: String, remote: String, name: String) -> CmdResult<()> {
    let dir = state.config_dir.clone();
    blocking(move || ops::push_tag(&git(&path), &remote, &name, &AccountStore::new(&dir).net_auth())).await
}

#[tauri::command]
pub async fn tag_delete_remote(state: State<'_, AppState>, path: String, remote: String, name: String) -> CmdResult<()> {
    let dir = state.config_dir.clone();
    blocking(move || ops::delete_remote_tag(&git(&path), &remote, &name, &AccountStore::new(&dir).net_auth())).await
}

#[tauri::command]
pub async fn remote_add(path: String, name: String, url: String) -> CmdResult<()> {
    blocking(move || ops::add_remote(&git(&path), name.trim(), url.trim())).await
}

#[tauri::command]
pub async fn remote_remove(path: String, name: String) -> CmdResult<()> {
    blocking(move || ops::remove_remote(&git(&path), &name)).await
}

// ---------------------------------------------------------------- stash

#[tauri::command]
pub async fn stash_save(path: String, message: String, include_untracked: bool) -> CmdResult<()> {
    blocking(move || ops::stash_save(&git(&path), &message, include_untracked)).await
}

#[tauri::command]
pub async fn stash_apply(path: String, index: u32, pop: bool) -> CmdResult<OpOutcome> {
    blocking(move || ops::stash_apply(&git(&path), index, pop)).await
}

#[tauri::command]
pub async fn stash_drop(path: String, index: u32) -> CmdResult<()> {
    blocking(move || ops::stash_drop(&git(&path), index)).await
}

// ---------------------------------------------------------------- merge & co.

#[tauri::command]
pub async fn merge(path: String, target: String, mode: String) -> CmdResult<OpOutcome> {
    blocking(move || ops::merge(&git(&path), &target, &mode)).await
}

#[tauri::command]
pub async fn rebase(path: String, onto: String) -> CmdResult<OpOutcome> {
    blocking(move || ops::rebase(&git(&path), &onto)).await
}

#[tauri::command]
pub async fn cherry_pick(path: String, hash: String) -> CmdResult<OpOutcome> {
    blocking(move || ops::cherry_pick(&git(&path), &hash)).await
}

#[tauri::command]
pub async fn revert(path: String, hash: String) -> CmdResult<OpOutcome> {
    blocking(move || ops::revert(&git(&path), &hash)).await
}

#[tauri::command]
pub async fn reset(path: String, hash: String, mode: String) -> CmdResult<()> {
    blocking(move || ops::reset(&git(&path), &hash, &mode)).await
}

#[tauri::command]
pub async fn op_continue(path: String) -> CmdResult<OpOutcome> {
    blocking(move || ops::continue_op(&git(&path))).await
}

#[tauri::command]
pub async fn op_abort(path: String) -> CmdResult<()> {
    blocking(move || ops::abort_op(&git(&path))).await
}

#[tauri::command]
pub async fn op_skip(path: String) -> CmdResult<OpOutcome> {
    blocking(move || ops::skip_op(&git(&path))).await
}

#[tauri::command]
pub async fn conflict_load(path: String, file: String) -> CmdResult<ConflictDoc> {
    blocking(move || conflict::load(&git(&path), &file)).await
}

#[tauri::command]
pub async fn conflict_resolve(path: String, file: String, content: String) -> CmdResult<()> {
    blocking(move || conflict::resolve_with_content(&git(&path), &file, &content)).await
}

#[tauri::command]
pub async fn conflict_take(path: String, file: String, side: String) -> CmdResult<()> {
    blocking(move || conflict::resolve_with_side(&git(&path), &file, &side)).await
}

// ---------------------------------------------------------------- gitflow

#[tauri::command]
pub async fn gitflow_suggest(path: String) -> CmdResult<GitFlowConfig> {
    blocking(move || Ok(gitflow::suggest_config(&git(&path)))).await
}

#[tauri::command]
pub async fn gitflow_init(path: String, config: GitFlowConfig) -> CmdResult<()> {
    blocking(move || gitflow::init(&git(&path), &config)).await
}

#[tauri::command]
pub async fn gitflow_start(path: String, kind: String, name: String, base: Option<String>) -> CmdResult<String> {
    blocking(move || gitflow::start(&git(&path), &kind, &name, base.as_deref())).await
}

#[tauri::command]
pub async fn gitflow_finish(
    state: State<'_, AppState>,
    path: String,
    kind: String,
    name: String,
    options: FinishOptions,
) -> CmdResult<OpOutcome> {
    let dir = state.config_dir.clone();
    blocking(move || {
        let auth = if options.push { AccountStore::new(&dir).net_auth() } else { vec![] };
        gitflow::finish(&git(&path), &kind, &name, &options, &auth)
    })
    .await
}

// ---------------------------------------------------------------- accounts & providers

#[tauri::command]
pub async fn accounts_list(state: State<'_, AppState>) -> CmdResult<Vec<Account>> {
    let with_gh = state.settings.load().use_gh_accounts;
    let dir = state.config_dir.clone();
    blocking(move || Ok(AccountStore::new(&dir).all(with_gh))).await
}

fn choice_key(host: &str, project: &str) -> String {
    format!("{}/{}", host.to_lowercase(), project.to_lowercase())
}

/// Accounts changed: the choice for each project has to be made again.
fn forget_account_choices(state: &State<'_, AppState>) {
    if let Ok(mut m) = state.account_choice.lock() {
        m.clear();
    }
}

#[tauri::command]
pub async fn account_add(state: State<'_, AppState>, kind: String, host: String, token: String) -> CmdResult<Account> {
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err(tr!("inserisci un token di accesso", "enter an access token"));
    }
    let (host, base_url, api_url) = accounts::endpoints(&kind, &host).map_err(|e| e.to_string())?;
    let user = providers::whoami(&kind, &api_url, &token).await.map_err(|e| e.to_string())?;
    let account = Account {
        id: format!("{kind}:{host}:{}", user.username),
        kind,
        host,
        base_url,
        api_url,
        username: user.username,
        name: user.name,
        avatar_url: user.avatar_url,
        token_in_file: false,
        from_gh: false,
    };
    forget_account_choices(&state);
    let dir = state.config_dir.clone();
    blocking(move || AccountStore::new(&dir).upsert(account, &token)).await
}

#[tauri::command]
pub async fn account_remove(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    forget_account_choices(&state);
    let dir = state.config_dir.clone();
    blocking(move || AccountStore::new(&dir).remove(&id)).await
}

async fn account_with_token(dir: PathBuf, id: String) -> CmdResult<(Account, String)> {
    blocking(move || {
        let store = AccountStore::new(&dir);
        let acc = store.get(&id)?;
        let token = store.token(&acc)?;
        Ok((acc, token))
    })
    .await
}

#[tauri::command]
pub async fn provider_repos(state: State<'_, AppState>, account_id: String) -> CmdResult<Vec<RemoteRepo>> {
    let (acc, token) = account_with_token(state.config_dir.clone(), account_id).await?;
    providers::list_repos(&acc, &token).await.map_err(|e| e.to_string())
}

/// Provider, account and token for the repository's main remote. With several accounts on the
/// host (e.g. personal and work on github.com) the provider is asked what each one can do on
/// the project, and the choice is kept for the session.
async fn repo_provider(state: &State<'_, AppState>, path: String) -> CmdResult<(Account, String, String)> {
    let dir = state.config_dir.clone();
    let with_gh = state.settings.load().use_gh_accounts;
    let (link, candidates) = blocking(move || {
        let accounts = AccountStore::new(&dir).all(with_gh);
        let remotes = repo::remotes(&git(&path))?;
        let link = remote_url::provider_link(&remotes, &accounts);
        let candidates: Vec<Account> = match &link {
            Some(l) => accounts.into_iter().filter(|a| a.host.eq_ignore_ascii_case(&l.host)).collect(),
            None => vec![],
        };
        Ok((link, candidates))
    })
    .await?;
    let link = link.ok_or_else(|| tr!("il repository non ha un remote GitHub/GitLab riconosciuto", "the repository has no recognized GitHub/GitLab remote"))?;
    if candidates.is_empty() {
        return Err(tr!(
            "nessun account configurato per {}: aggiungilo nelle Preferenze",
            "no account configured for {}: add one in Preferences",
            link.host
        ));
    }
    let key = choice_key(&link.host, &link.project);
    let cached = state.account_choice.lock().ok().and_then(|m| m.get(&key).cloned());
    let account = match cached.and_then(|id| candidates.iter().find(|a| a.id == id)) {
        Some(a) => a.clone(),
        None if candidates.len() == 1 => candidates[0].clone(),
        None => {
            let mut scored = Vec::new();
            for acc in candidates {
                let access = match account_token(state.config_dir.clone(), acc.clone()).await {
                    Ok(token) => providers::project_access(&acc, &token, &link.project).await,
                    Err(_) => Access::None,
                };
                scored.push((acc, access));
            }
            let best = accounts::pick_account(&scored, &link.project).cloned().expect("at least one candidate");
            if let Ok(mut m) = state.account_choice.lock() {
                m.insert(key, best.id.clone());
            }
            best
        }
    };
    let token = account_token(state.config_dir.clone(), account.clone()).await?;
    Ok((account, token, link.project))
}

async fn account_token(dir: PathBuf, account: Account) -> CmdResult<String> {
    blocking(move || AccountStore::new(&dir).token(&account)).await
}

/// Account used for the repository's pull requests and issues.
#[tauri::command]
pub async fn provider_account(state: State<'_, AppState>, path: String) -> CmdResult<Account> {
    Ok(repo_provider(&state, path).await?.0)
}

#[tauri::command]
pub async fn pull_requests(state: State<'_, AppState>, path: String) -> CmdResult<Vec<PullRequest>> {
    let (acc, token, project) = repo_provider(&state, path).await?;
    providers::list_pull_requests(&acc, &token, &project).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pull_request_create(state: State<'_, AppState>, path: String, pr: NewPullRequest) -> CmdResult<PullRequest> {
    let (acc, token, project) = repo_provider(&state, path).await?;
    providers::create_pull_request(&acc, &token, &project, &pr).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn issues(state: State<'_, AppState>, path: String, filter: String, mine: bool) -> CmdResult<Vec<Issue>> {
    let (acc, token, project) = repo_provider(&state, path).await?;
    providers::list_issues(&acc, &token, &project, &filter, mine).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn issue_detail(state: State<'_, AppState>, path: String, number: u64) -> CmdResult<IssueDetail> {
    let (acc, token, project) = repo_provider(&state, path).await?;
    providers::issue_detail(&acc, &token, &project, number).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn branch_issues(path: String) -> CmdResult<Vec<BranchIssue>> {
    blocking(move || ops::branch_issues(&git(&path))).await
}

#[tauri::command]
pub async fn branch_set_issue(path: String, branch: String, issue: Option<u64>) -> CmdResult<()> {
    blocking(move || ops::set_branch_issue(&git(&path), &branch, issue)).await
}
