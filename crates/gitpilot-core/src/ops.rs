//! Write operations on a repository.

use std::path::Path;

use crate::diff;
use crate::error::{Error, Result};
use crate::git::Git;
use crate::model::OpOutcome;
use crate::repo;

/// `http.<url>.extraheader` entries to authenticate HTTPS remotes (see `accounts::auth_config`).
pub type NetAuth = Vec<(String, String)>;

/// Prepare a Git handle for network operations: inject provider tokens for
/// HTTPS remotes and make SSH fail fast instead of waiting for a prompt.
pub fn networked(git: &Git, auth: &NetAuth) -> Git {
    let mut g = git.clone();
    for (k, v) in auth {
        g = g.config(k, v);
    }
    let user_ssh = std::env::var_os("GIT_SSH_COMMAND").is_some()
        || std::env::var_os("GIT_SSH").is_some()
        || git.succeeds(["config", "--get", "core.sshCommand"]).unwrap_or(false);
    if !user_ssh {
        // Passphrase-protected keys must come from ssh-agent (GNOME Keyring / macOS Keychain do this).
        g = g.env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new");
    }
    g
}

fn has_conflicts(git: &Git) -> bool {
    repo::status(git).map(|s| !s.conflicted.is_empty()).unwrap_or(false)
}

/// Run an operation that can stop on conflicts: a failure with unmerged paths
/// is reported as `OpOutcome::conflicts` instead of an error.
fn conflict_aware(git: &Git, args: &[&str], ok_msg: &str) -> Result<OpOutcome> {
    match git.run(args) {
        Ok(_) => Ok(OpOutcome::ok(ok_msg)),
        Err(e) if has_conflicts(git) => Ok(OpOutcome::conflicts(format!("Conflitti da risolvere. {e}"))),
        Err(e) => Err(e),
    }
}

fn conflict_aware_progress(git: &Git, args: &[&str], ok_msg: &str, progress: &mut dyn FnMut(&str)) -> Result<OpOutcome> {
    match git.run_progress(args, progress) {
        Ok(_) => Ok(OpOutcome::ok(ok_msg)),
        Err(e) if has_conflicts(git) => Ok(OpOutcome::conflicts(format!("Conflitti da risolvere. {e}"))),
        Err(e) => Err(e),
    }
}

// ---------------------------------------------------------------- create / clone

pub fn init(path: &Path, default_branch: &str) -> Result<()> {
    std::fs::create_dir_all(path)?;
    let branch = if default_branch.trim().is_empty() { "main" } else { default_branch.trim() };
    Git::new(path).run(["init", "-b", branch])?;
    Ok(())
}

pub fn clone(url: &str, dest: &Path, auth: &NetAuth, progress: &mut dyn FnMut(&str)) -> Result<()> {
    if dest.exists() && std::fs::read_dir(dest).map(|mut d| d.next().is_some()).unwrap_or(false) {
        return Err(Error::msg(format!("la cartella {} esiste e non è vuota", dest.display())));
    }
    let parent = dest.parent().ok_or_else(|| Error::msg("destinazione non valida"))?;
    std::fs::create_dir_all(parent)?;
    let g = networked(&Git::new(parent), auth);
    let dest_s = dest.to_string_lossy().to_string();
    g.run_progress(["clone", "--progress", "--", url, &dest_s], progress)?;
    Ok(())
}

// ---------------------------------------------------------------- index

pub fn stage(git: &Git, paths: &[String]) -> Result<()> {
    if paths.is_empty() {
        return Ok(());
    }
    let mut args = vec!["add", "-A", "--"];
    args.extend(paths.iter().map(String::as_str));
    git.run(&args)?;
    Ok(())
}

pub fn stage_all(git: &Git) -> Result<()> {
    git.run(["add", "-A"])?;
    Ok(())
}

pub fn unstage(git: &Git, paths: &[String]) -> Result<()> {
    if paths.is_empty() {
        return Ok(());
    }
    if repo::has_commits(git) {
        let mut args = vec!["restore", "--staged", "--"];
        args.extend(paths.iter().map(String::as_str));
        git.run(&args)?;
    } else {
        let mut args = vec!["rm", "--cached", "-r", "-q", "--"];
        args.extend(paths.iter().map(String::as_str));
        git.run(&args)?;
    }
    Ok(())
}

pub fn unstage_all(git: &Git) -> Result<()> {
    if repo::has_commits(git) {
        git.run(["reset", "-q"])?;
    } else {
        git.run(["rm", "--cached", "-r", "-q", "."])?;
    }
    Ok(())
}

/// Throw away working-tree changes. Untracked files are deleted.
pub fn discard(git: &Git, tracked: &[String], untracked: &[String]) -> Result<()> {
    if !tracked.is_empty() {
        let mut args = vec!["restore", "--worktree", "--"];
        args.extend(tracked.iter().map(String::as_str));
        git.run(&args)?;
    }
    if !untracked.is_empty() {
        let mut args = vec!["clean", "-f", "-q", "--"];
        args.extend(untracked.iter().map(String::as_str));
        git.run(&args)?;
    }
    Ok(())
}

pub fn discard_all(git: &Git) -> Result<()> {
    if repo::has_commits(git) {
        git.run(["reset", "--hard", "-q"])?;
    }
    git.run(["clean", "-fd", "-q"])?;
    Ok(())
}

/// Stage, unstage or discard a single hunk identified by its `@@` header.
pub fn apply_hunk(git: &Git, path: &str, old_path: Option<&str>, hunk_header: &str, action: &str) -> Result<()> {
    let staged = action == "unstage";
    let fd = repo::working_diff(git, path, old_path, staged, false)?;
    let patch = diff::single_hunk_patch(&fd, hunk_header)
        .ok_or_else(|| Error::msg("il file è cambiato nel frattempo: aggiorna e riprova"))?;
    let args: &[&str] = match action {
        "stage" => &["apply", "--cached", "--whitespace=nowarn", "-"],
        "unstage" => &["apply", "--cached", "-R", "--whitespace=nowarn", "-"],
        "discard" => &["apply", "-R", "--whitespace=nowarn", "-"],
        _ => return Err(Error::msg(format!("azione hunk sconosciuta: {action}"))),
    };
    git.run_stdin(args, patch.as_bytes())?;
    Ok(())
}

// ---------------------------------------------------------------- commit

pub fn commit(git: &Git, message: &str, amend: bool) -> Result<String> {
    let message = message.trim();
    if message.is_empty() && !amend {
        return Err(Error::msg("il messaggio di commit è vuoto"));
    }
    let mut args = vec!["commit", "--cleanup=strip"];
    if amend {
        args.push("--amend");
    }
    if message.is_empty() {
        args.push("--no-edit");
        git.run(&args)?;
    } else {
        args.extend(["-F", "-"]);
        git.run_stdin(&args, message.as_bytes())?;
    }
    Ok(git.run(["rev-parse", "--short", "HEAD"])?.trim().to_string())
}

// ---------------------------------------------------------------- remotes

pub fn fetch(git: &Git, remote: Option<&str>, auth: &NetAuth, progress: &mut dyn FnMut(&str)) -> Result<()> {
    let g = networked(git, auth);
    match remote {
        Some(r) => g.run_progress(["fetch", "--progress", "--prune", "--tags", r], progress)?,
        None => g.run_progress(["fetch", "--progress", "--prune", "--tags", "--all"], progress)?,
    };
    Ok(())
}

/// mode: "ff" (merge, fast-forward when possible) | "ff-only" | "rebase"
pub fn pull(git: &Git, mode: &str, auth: &NetAuth, progress: &mut dyn FnMut(&str)) -> Result<OpOutcome> {
    let g = networked(git, auth);
    let flag = match mode {
        "ff-only" => "--ff-only",
        "rebase" => "--rebase",
        _ => "--no-rebase",
    };
    conflict_aware_progress(&g, &["pull", "--progress", "--no-edit", flag], "Pull completato", progress)
}

/// Update a local branch that is not checked out to its upstream, without switching to it.
///
/// Without a working copy only a fast-forward is possible: the branch ref is moved
/// (atomically, from the expected old value) and HEAD, index and working tree are
/// never touched. A diverged branch is left as it is, with an explanation.
pub fn pull_branch(git: &Git, branch: &str, auth: &NetAuth, progress: &mut dyn FnMut(&str)) -> Result<String> {
    let local_ref = format!("refs/heads/{branch}");
    let local = commit_of(git, &local_ref).map_err(|_| Error::msg(format!("il branch {branch} non esiste")))?;
    if current_branch(git).ok().as_deref() == Some(branch) {
        return Err(Error::msg(format!("{branch} è il branch corrente: usa Pull dalla toolbar")));
    }
    if let Some(wt) = worktree_of(git, &local_ref)? {
        return Err(Error::msg(format!("{branch} è in checkout nel worktree {wt}: aggiornalo da lì")));
    }
    // A rebase/bisect detaches HEAD but still owns its branch: moving it would break the operation.
    let state = repo::repo_state(&repo::git_dir(git)?);
    if state.kind == "rebase" || state.kind == "bisect" {
        return Err(Error::msg(format!("{} in corso: completalo o annullalo prima del pull di {branch}", state.kind)));
    }
    let (Some(remote), Some(merge)) =
        (config_get(git, &format!("branch.{branch}.remote")), config_get(git, &format!("branch.{branch}.merge")))
    else {
        return Err(Error::msg(format!("{branch} non ha un upstream: impostalo prima del pull")));
    };
    let short = merge.strip_prefix("refs/heads/").unwrap_or(&merge);
    let upstream = if remote == "." { short.to_string() } else { format!("{remote}/{short}") };

    // Also refreshes the remote-tracking branch, so ahead/behind stay correct.
    networked(git, auth).run_progress(["fetch", "--progress", &remote, &merge], progress)?;
    let target = commit_of(git, "FETCH_HEAD")?;

    if target == local {
        return Ok(format!("{branch} è già aggiornato"));
    }
    let behind = count_between(git, &local, &target)?;
    let ahead = count_between(git, &target, &local)?;
    if behind == 0 {
        return Ok(format!("{branch} è avanti di {ahead} commit rispetto a {upstream}: niente da aggiornare"));
    }
    if ahead > 0 {
        return Err(Error::msg(format!(
            "{branch} è divergente da {upstream} ({ahead} commit avanti, {behind} indietro): \
             fai checkout di {branch} per unire con merge o rebase"
        )));
    }
    git.run(["update-ref", "-m", &format!("pull: fast-forward da {upstream}"), &local_ref, &target, &local])?;
    Ok(format!("{branch} aggiornato in fast-forward a {upstream} ({behind} commit)"))
}

fn commit_of(git: &Git, rev: &str) -> Result<String> {
    Ok(git.run(["rev-parse", "--verify", "--quiet", &format!("{rev}^{{commit}}")])?.trim().to_string())
}

/// Number of commits reachable from `to` but not from `from`.
fn count_between(git: &Git, from: &str, to: &str) -> Result<u32> {
    let n = git.run(["rev-list", "--count", &format!("{from}..{to}")])?;
    n.trim().parse().map_err(|_| Error::msg(format!("rev-list: risposta inattesa {n:?}")))
}

/// Path of the worktree (this one included) that has `branch_ref` checked out, if any.
fn worktree_of(git: &Git, branch_ref: &str) -> Result<Option<String>> {
    let out = git.run(["worktree", "list", "--porcelain"])?;
    let mut path = None;
    for line in out.lines() {
        if let Some(p) = line.strip_prefix("worktree ") {
            path = Some(p.to_string());
        } else if line.strip_prefix("branch ") == Some(branch_ref) {
            return Ok(path);
        }
    }
    Ok(None)
}

fn current_branch(git: &Git) -> Result<String> {
    let out = git.output(["symbolic-ref", "-q", "--short", "HEAD"])?;
    if !out.status.success() {
        return Err(Error::msg("HEAD è staccato: crea o seleziona un branch"));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn config_get(git: &Git, key: &str) -> Option<String> {
    let out = git.output(["config", "--get", key]).ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn default_remote(git: &Git) -> Result<String> {
    let remotes = repo::remotes(git)?;
    if remotes.iter().any(|(n, _)| n == "origin") {
        return Ok("origin".into());
    }
    remotes.into_iter().next().map(|(n, _)| n).ok_or_else(|| Error::msg("nessun remote configurato"))
}

/// Push `branch` (default: current). Without an upstream the branch is
/// published on `remote` (default: origin) and tracking is configured.
pub fn push(
    git: &Git,
    branch: Option<&str>,
    remote: Option<&str>,
    force: bool,
    auth: &NetAuth,
    progress: &mut dyn FnMut(&str),
) -> Result<String> {
    let branch = match branch {
        Some(b) => b.to_string(),
        None => current_branch(git)?,
    };
    let g = networked(git, auth);
    let up_remote = config_get(git, &format!("branch.{branch}.remote"));
    let up_merge = config_get(git, &format!("branch.{branch}.merge"));
    let mut args: Vec<String> = vec!["push".into(), "--progress".into()];
    if force {
        args.push("--force-with-lease".into());
    }
    let msg = match (up_remote, up_merge, remote) {
        (Some(r), Some(m), None) if r != "." => {
            args.push(r.clone());
            args.push(format!("refs/heads/{branch}:{m}"));
            format!("Push di {branch} su {r}")
        }
        (_, _, r) => {
            let r = match r {
                Some(r) => r.to_string(),
                None => default_remote(git)?,
            };
            args.push("--set-upstream".into());
            args.push(r.clone());
            args.push(format!("refs/heads/{branch}:refs/heads/{branch}"));
            format!("Branch {branch} pubblicato su {r}")
        }
    };
    let a: Vec<&str> = args.iter().map(String::as_str).collect();
    g.run_progress(&a, progress)?;
    Ok(msg)
}

pub fn delete_remote_branch(git: &Git, remote: &str, name: &str, auth: &NetAuth) -> Result<()> {
    networked(git, auth).run(["push", remote, "--delete", &format!("refs/heads/{name}")])?;
    Ok(())
}

pub fn push_tag(git: &Git, remote: &str, tag: &str, auth: &NetAuth) -> Result<()> {
    networked(git, auth).run(["push", remote, &format!("refs/tags/{tag}")])?;
    Ok(())
}

pub fn delete_remote_tag(git: &Git, remote: &str, tag: &str, auth: &NetAuth) -> Result<()> {
    networked(git, auth).run(["push", remote, "--delete", &format!("refs/tags/{tag}")])?;
    Ok(())
}

pub fn add_remote(git: &Git, name: &str, url: &str) -> Result<()> {
    git.run(["remote", "add", name, url])?;
    Ok(())
}

pub fn remove_remote(git: &Git, name: &str) -> Result<()> {
    git.run(["remote", "remove", name])?;
    Ok(())
}

// ---------------------------------------------------------------- branches

pub fn checkout(git: &Git, branch: &str) -> Result<()> {
    git.run(["switch", "--no-guess", branch])?;
    Ok(())
}

/// Check out a remote branch (`origin/feature/x`), creating or reusing the local one.
pub fn checkout_remote(git: &Git, full: &str) -> Result<String> {
    let (_, name) = full.split_once('/').ok_or_else(|| Error::msg("nome remote branch non valido"))?;
    let exists = git.succeeds(["show-ref", "--verify", "--quiet", &format!("refs/heads/{name}")])?;
    if exists {
        git.run(["switch", name])?;
    } else {
        git.run(["switch", "-c", name, "--track", full])?;
    }
    Ok(name.to_string())
}

pub fn checkout_commit(git: &Git, hash: &str) -> Result<()> {
    git.run(["switch", "--detach", hash])?;
    Ok(())
}

pub fn create_branch(git: &Git, name: &str, start: Option<&str>, checkout: bool) -> Result<()> {
    git.run(["check-ref-format", "--branch", name])
        .map_err(|_| Error::msg(format!("nome branch non valido: {name}")))?;
    let start = start.unwrap_or("HEAD");
    if checkout {
        git.run(["switch", "-c", name, start])?;
    } else {
        git.run(["branch", name, start])?;
    }
    Ok(())
}

pub fn delete_branch(git: &Git, name: &str, force: bool) -> Result<()> {
    git.run(["branch", if force { "-D" } else { "-d" }, name])?;
    Ok(())
}

pub fn rename_branch(git: &Git, old: &str, new: &str) -> Result<()> {
    git.run(["branch", "-m", old, new])?;
    Ok(())
}

pub fn set_upstream(git: &Git, branch: &str, upstream: &str) -> Result<()> {
    git.run(["branch", &format!("--set-upstream-to={upstream}"), branch])?;
    Ok(())
}

// ---------------------------------------------------------------- tags

pub fn create_tag(git: &Git, name: &str, target: &str, message: Option<&str>) -> Result<()> {
    match message.map(str::trim).filter(|m| !m.is_empty()) {
        Some(m) => git.run(["tag", "-a", name, "-m", m, target])?,
        None => git.run(["tag", name, target])?,
    };
    Ok(())
}

pub fn delete_tag(git: &Git, name: &str) -> Result<()> {
    git.run(["tag", "-d", name])?;
    Ok(())
}

// ---------------------------------------------------------------- stash

pub fn stash_save(git: &Git, message: &str, include_untracked: bool) -> Result<()> {
    let mut args = vec!["stash", "push"];
    if include_untracked {
        args.push("--include-untracked");
    }
    if !message.trim().is_empty() {
        args.extend(["-m", message.trim()]);
    }
    git.run(&args)?;
    Ok(())
}

pub fn stash_apply(git: &Git, index: u32, pop: bool) -> Result<OpOutcome> {
    let r = format!("stash@{{{index}}}");
    let msg = if pop { "Stash applicato e rimosso" } else { "Stash applicato" };
    conflict_aware(git, &["stash", if pop { "pop" } else { "apply" }, &r], msg)
}

pub fn stash_drop(git: &Git, index: u32) -> Result<()> {
    git.run(["stash", "drop", &format!("stash@{{{index}}}")])?;
    Ok(())
}

// ---------------------------------------------------------------- history rewriting

/// mode: "ff" | "no-ff" | "ff-only" | "squash"
pub fn merge(git: &Git, target: &str, mode: &str) -> Result<OpOutcome> {
    let mut args = vec!["merge", "--no-edit"];
    match mode {
        "no-ff" => args.push("--no-ff"),
        "ff-only" => args.push("--ff-only"),
        "squash" => args.push("--squash"),
        _ => {}
    }
    args.push(target);
    let msg = if mode == "squash" {
        format!("Modifiche di {target} preparate nello stage: completa con un commit")
    } else {
        format!("{target} unito")
    };
    conflict_aware(git, &args, &msg)
}

pub fn rebase(git: &Git, onto: &str) -> Result<OpOutcome> {
    conflict_aware(git, &["rebase", onto], &format!("Rebase su {onto} completato"))
}

fn is_merge_commit(git: &Git, hash: &str) -> bool {
    git.succeeds(["rev-parse", "-q", "--verify", &format!("{hash}^2")]).unwrap_or(false)
}

pub fn cherry_pick(git: &Git, hash: &str) -> Result<OpOutcome> {
    let mut args = vec!["cherry-pick"];
    if is_merge_commit(git, hash) {
        args.extend(["-m", "1"]);
    }
    args.push(hash);
    conflict_aware(git, &args, "Cherry-pick completato")
}

pub fn revert(git: &Git, hash: &str) -> Result<OpOutcome> {
    let mut args = vec!["revert", "--no-edit"];
    if is_merge_commit(git, hash) {
        args.extend(["-m", "1"]);
    }
    args.push(hash);
    conflict_aware(git, &args, "Revert completato")
}

/// mode: soft | mixed | hard
pub fn reset(git: &Git, hash: &str, mode: &str) -> Result<()> {
    let flag = match mode {
        "soft" => "--soft",
        "hard" => "--hard",
        _ => "--mixed",
    };
    git.run(["reset", "-q", flag, hash])?;
    Ok(())
}

fn in_progress(git: &Git) -> Result<String> {
    let st = repo::repo_state(&repo::git_dir(git)?);
    if st.kind == "none" || st.kind == "bisect" {
        return Err(Error::msg("nessuna operazione in corso"));
    }
    Ok(st.kind)
}

/// Continue a merge/rebase/cherry-pick/revert after resolving conflicts.
pub fn continue_op(git: &Git) -> Result<OpOutcome> {
    let kind = in_progress(git)?;
    if has_conflicts(git) {
        return Err(Error::msg("ci sono ancora file in conflitto: risolvili e aggiungili allo stage"));
    }
    match kind.as_str() {
        "merge" => conflict_aware(git, &["commit", "--no-edit"], "Merge completato"),
        "rebase" => conflict_aware(git, &["rebase", "--continue"], "Rebase completato"),
        "cherry-pick" => conflict_aware(git, &["cherry-pick", "--continue"], "Cherry-pick completato"),
        "revert" => conflict_aware(git, &["revert", "--continue"], "Revert completato"),
        k => Err(Error::msg(format!("operazione non supportata: {k}"))),
    }
}

pub fn abort_op(git: &Git) -> Result<()> {
    let kind = in_progress(git)?;
    git.run([kind.as_str(), "--abort"])?;
    Ok(())
}

pub fn skip_op(git: &Git) -> Result<OpOutcome> {
    let kind = in_progress(git)?;
    if kind == "merge" {
        return Err(Error::msg("un merge non può essere saltato, solo annullato"));
    }
    conflict_aware(git, &[kind.as_str(), "--skip"], "Commit saltato")
}
