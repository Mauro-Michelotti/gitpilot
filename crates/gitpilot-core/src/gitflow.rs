//! Native GitFlow implementation (no git-flow extension required).
//!
//! Configuration lives in the same `gitflow.*` keys used by git-flow AVH and
//! GitKraken, so repositories initialized by either tool just work.

use serde::Deserialize;

use crate::error::{Error, Result};
use crate::git::Git;
use crate::model::{GitFlowConfig, OpOutcome};
use crate::ops::{self, NetAuth};
use crate::repo;

pub const KINDS: [&str; 5] = ["feature", "bugfix", "release", "hotfix", "support"];

pub fn read_config(git: &Git) -> Result<Option<GitFlowConfig>> {
    let out = git.output(["config", "--get-regexp", r"^gitflow\."])?;
    let text = String::from_utf8_lossy(&out.stdout);
    let get = |key: &str| -> Option<String> {
        text.lines().find_map(|l| {
            let (k, v) = l.split_once(' ').unwrap_or((l, ""));
            (k.eq_ignore_ascii_case(key)).then(|| v.to_string())
        })
    };
    let master = get("gitflow.branch.master").or_else(|| get("gitflow.branch.main"));
    let (Some(master), Some(develop)) = (master, get("gitflow.branch.develop")) else {
        return Ok(None);
    };
    let d = GitFlowConfig::default();
    Ok(Some(GitFlowConfig {
        master,
        develop,
        feature: get("gitflow.prefix.feature").unwrap_or(d.feature),
        bugfix: get("gitflow.prefix.bugfix").unwrap_or(d.bugfix),
        release: get("gitflow.prefix.release").unwrap_or(d.release),
        hotfix: get("gitflow.prefix.hotfix").unwrap_or(d.hotfix),
        support: get("gitflow.prefix.support").unwrap_or(d.support),
        version_tag: get("gitflow.prefix.versiontag").unwrap_or(d.version_tag),
    }))
}

fn local_exists(git: &Git, name: &str) -> bool {
    git.succeeds(["show-ref", "--verify", "--quiet", &format!("refs/heads/{name}")]).unwrap_or(false)
}

fn remote_exists(git: &Git, full: &str) -> bool {
    git.succeeds(["show-ref", "--verify", "--quiet", &format!("refs/remotes/{full}")]).unwrap_or(false)
}

/// Defaults for the init dialog, using whichever of main/master exists.
pub fn suggest_config(git: &Git) -> GitFlowConfig {
    if let Ok(Some(c)) = read_config(git) {
        return c;
    }
    let mut c = GitFlowConfig::default();
    let candidates = ["main", "master"];
    if let Some(m) = candidates.iter().find(|b| local_exists(git, b) || remote_exists(git, &format!("origin/{b}"))) {
        c.master = m.to_string();
    } else if let Ok(cur) = git.run(["symbolic-ref", "-q", "--short", "HEAD"]) {
        let cur = cur.trim();
        if !cur.is_empty() && cur != c.develop {
            c.master = cur.to_string();
        }
    }
    c
}

/// Make sure a local branch exists, creating it from `origin/<name>` if needed.
fn ensure_local(git: &Git, name: &str) -> Result<()> {
    if local_exists(git, name) {
        return Ok(());
    }
    let remote = format!("origin/{name}");
    if remote_exists(git, &remote) {
        git.run(["branch", "--track", name, &remote])?;
        return Ok(());
    }
    Err(Error::msg(format!("il branch '{name}' non esiste")))
}

pub fn init(git: &Git, cfg: &GitFlowConfig) -> Result<()> {
    for b in [&cfg.master, &cfg.develop] {
        git.run(["check-ref-format", "--branch", b])
            .map_err(|_| Error::msg(format!("nome branch non valido: {b}")))?;
    }
    if cfg.master == cfg.develop {
        return Err(Error::msg("produzione e sviluppo devono essere branch diversi"));
    }
    if !repo::has_commits(git) {
        git.run(["symbolic-ref", "HEAD", &format!("refs/heads/{}", cfg.master)])?;
        git.run(["commit", "--allow-empty", "-q", "-m", "Initial commit"])?;
    }
    ensure_local(git, &cfg.master)?;
    if !local_exists(git, &cfg.develop) {
        let remote = format!("origin/{}", cfg.develop);
        if remote_exists(git, &remote) {
            git.run(["branch", "--track", &cfg.develop, &remote])?;
        } else {
            git.run(["branch", &cfg.develop, &cfg.master])?;
        }
    }
    let pairs = [
        ("gitflow.branch.master", &cfg.master),
        ("gitflow.branch.develop", &cfg.develop),
        ("gitflow.prefix.feature", &cfg.feature),
        ("gitflow.prefix.bugfix", &cfg.bugfix),
        ("gitflow.prefix.release", &cfg.release),
        ("gitflow.prefix.hotfix", &cfg.hotfix),
        ("gitflow.prefix.support", &cfg.support),
        ("gitflow.prefix.versiontag", &cfg.version_tag),
    ];
    for (k, v) in pairs {
        git.run(["config", "--local", k, v])?;
    }
    // Like git-flow, end up on develop when the working tree allows it.
    let _ = git.run(["switch", &cfg.develop]);
    Ok(())
}

fn config(git: &Git) -> Result<GitFlowConfig> {
    read_config(git)?.ok_or_else(|| Error::msg("GitFlow non è inizializzato in questo repository"))
}

fn prefix<'a>(cfg: &'a GitFlowConfig, kind: &str) -> Result<&'a str> {
    Ok(match kind {
        "feature" => &cfg.feature,
        "bugfix" => &cfg.bugfix,
        "release" => &cfg.release,
        "hotfix" => &cfg.hotfix,
        "support" => &cfg.support,
        _ => return Err(Error::msg(format!("tipo GitFlow sconosciuto: {kind}"))),
    })
}

/// Start `<prefix><name>` from `base` (default: develop, or master for hotfix/support).
pub fn start(git: &Git, kind: &str, name: &str, base: Option<&str>) -> Result<String> {
    let cfg = config(git)?;
    let name = name.trim();
    if name.is_empty() {
        return Err(Error::msg("specifica un nome"));
    }
    let branch = format!("{}{}", prefix(&cfg, kind)?, name);
    if local_exists(git, &branch) {
        return Err(Error::msg(format!("il branch '{branch}' esiste già")));
    }
    let default_base = if matches!(kind, "hotfix" | "support") { &cfg.master } else { &cfg.develop };
    let base = base.filter(|b| !b.trim().is_empty()).unwrap_or(default_base.as_str());
    if base == cfg.master.as_str() || base == cfg.develop.as_str() {
        ensure_local(git, base)?;
    }
    ops::create_branch(git, &branch, Some(base), true)?;
    Ok(branch)
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FinishOptions {
    #[serde(default = "yes")]
    pub delete_branch: bool,
    /// Annotated tag message for release/hotfix (default: "Release <name>"/"Hotfix <name>").
    #[serde(default)]
    pub tag_message: Option<String>,
    /// Push develop, master and the tag to origin afterwards.
    #[serde(default)]
    pub push: bool,
}

fn yes() -> bool {
    true
}

fn require_clean(git: &Git) -> Result<()> {
    let state = repo::repo_state(&repo::git_dir(git)?);
    if state.kind != "none" {
        return Err(Error::msg(format!("completa o annulla prima l'operazione in corso ({})", state.kind)));
    }
    let st = repo::status(git)?;
    let dirty = !st.staged.is_empty() || !st.conflicted.is_empty() || st.unstaged.iter().any(|f| f.status != "?");
    if dirty {
        return Err(Error::msg("ci sono modifiche non committate: fai commit o stash prima di concludere"));
    }
    Ok(())
}

/// Merge `branch` into `target` with --no-ff unless already contained.
/// Returns `Some(outcome)` when the merge stopped on conflicts.
fn merge_into(git: &Git, branch: &str, target: &str) -> Result<Option<OpOutcome>> {
    ensure_local(git, target)?;
    if git.succeeds(["merge-base", "--is-ancestor", branch, target])? {
        return Ok(None);
    }
    git.run(["switch", target])?;
    let out = ops::merge(git, branch, "no-ff")?;
    if out.conflicts {
        return Ok(Some(OpOutcome::conflicts(format!(
            "Conflitti nel merge di '{branch}' in '{target}'. Risolvili, completa il merge e ripeti Concludi."
        ))));
    }
    Ok(None)
}

pub fn finish(git: &Git, kind: &str, name: &str, opts: &FinishOptions, auth: &NetAuth) -> Result<OpOutcome> {
    let cfg = config(git)?;
    let branch = format!("{}{}", prefix(&cfg, kind)?, name);
    if !local_exists(git, &branch) {
        return Err(Error::msg(format!("il branch '{branch}' non esiste")));
    }
    require_clean(git)?;

    let mut tag = None;
    match kind {
        "feature" | "bugfix" => {
            if let Some(c) = merge_into(git, &branch, &cfg.develop)? {
                return Ok(c);
            }
        }
        "release" | "hotfix" => {
            if let Some(c) = merge_into(git, &branch, &cfg.master)? {
                return Ok(c);
            }
            let tag_name = format!("{}{}", cfg.version_tag, name);
            let exists = git.succeeds(["show-ref", "--verify", "--quiet", &format!("refs/tags/{tag_name}")])?;
            if !exists {
                let default_msg = format!("{} {}", if kind == "release" { "Release" } else { "Hotfix" }, name);
                let msg = opts.tag_message.as_deref().map(str::trim).filter(|m| !m.is_empty()).unwrap_or(default_msg.as_str());
                ops::create_tag(git, &tag_name, &cfg.master, Some(msg))?;
            }
            // Back-merge the tag (git-flow AVH behaviour) so that master stays
            // an ancestor of develop.
            if let Some(c) = merge_into(git, &tag_name, &cfg.develop)? {
                return Ok(c);
            }
            tag = Some(tag_name);
        }
        "support" => return Err(Error::msg("i branch support non si concludono")),
        _ => return Err(Error::msg(format!("tipo GitFlow sconosciuto: {kind}"))),
    }

    git.run(["switch", &cfg.develop])?;
    let remote_branch = format!("origin/{branch}");
    let had_remote = remote_exists(git, &remote_branch);
    if opts.delete_branch {
        git.run(["branch", "-d", &branch])?;
    }

    if opts.push {
        let mut refs = vec![format!("refs/heads/{}", cfg.develop)];
        if tag.is_some() {
            refs.push(format!("refs/heads/{}", cfg.master));
        }
        if let Some(t) = &tag {
            refs.push(format!("refs/tags/{t}"));
        }
        let g = ops::networked(git, auth);
        let mut args = vec!["push", "origin"];
        args.extend(refs.iter().map(String::as_str));
        g.run(&args)?;
        if opts.delete_branch && had_remote {
            g.run(["push", "origin", "--delete", &format!("refs/heads/{branch}")])?;
        }
    }

    let what = match kind {
        "feature" => "Feature",
        "bugfix" => "Bugfix",
        "release" => "Release",
        _ => "Hotfix",
    };
    let mut msg = format!("{what} '{name}' conclusa");
    if let Some(t) = tag {
        msg.push_str(&format!(", tag {t} creato"));
    }
    if opts.push {
        msg.push_str(", push su origin eseguito");
    }
    Ok(OpOutcome::ok(msg))
}
