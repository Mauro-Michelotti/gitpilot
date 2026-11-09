//! Read-only queries: overview, status, log/graph, diffs, commit details.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::diff;
use crate::error::{Error, Result};
use crate::git::Git;
use crate::tr;
use crate::gitflow;
use crate::graph::{self, LayoutInput};
use crate::model::*;
use crate::remote_url;

pub const WIP_HASH: &str = "WIP";

/// Resolve any path inside a work tree to the repository root.
pub fn open(path: &Path) -> Result<PathBuf> {
    if !path.is_dir() {
        return Err(Error::msg(tr!("cartella inesistente: {}", "folder does not exist: {}", path.display())));
    }
    let out = Git::new(path).run(["rev-parse", "--show-toplevel"]).map_err(|_| {
        Error::msg(tr!(
            "{} non è un repository git (o è un repository bare)",
            "{} is not a git repository (or is a bare repository)",
            path.display()
        ))
    })?;
    Ok(PathBuf::from(out.trim()))
}

pub fn has_commits(git: &Git) -> bool {
    git.succeeds(["rev-parse", "-q", "--verify", "HEAD^{commit}"]).unwrap_or(false)
}

pub fn git_dir(git: &Git) -> Result<PathBuf> {
    Ok(PathBuf::from(git.run(["rev-parse", "--absolute-git-dir"])?.trim()))
}

fn parse_track(s: &str) -> (u32, u32, bool) {
    // "ahead 1, behind 2" | "ahead 1" | "behind 3" | "gone" | ""
    let mut ahead = 0;
    let mut behind = 0;
    for part in s.split(',') {
        let part = part.trim();
        if let Some(n) = part.strip_prefix("ahead ") {
            ahead = n.parse().unwrap_or(0);
        } else if let Some(n) = part.strip_prefix("behind ") {
            behind = n.parse().unwrap_or(0);
        }
    }
    (ahead, behind, s.trim() == "gone")
}

struct Refs {
    locals: Vec<BranchInfo>,
    remote_branches: Vec<(String, RemoteBranch)>,
    tags: Vec<TagInfo>,
}

fn read_refs(git: &Git) -> Result<Refs> {
    let out = git.run([
        "for-each-ref",
        "--format=%(refname)%1f%(objectname)%1f%(*objectname)%1f%(upstream:short)%1f%(upstream:track,nobracket)%1f%(HEAD)%1f%(objecttype)",
        "refs/heads",
        "refs/remotes",
        "refs/tags",
    ])?;
    let mut refs = Refs { locals: vec![], remote_branches: vec![], tags: vec![] };
    for line in out.lines() {
        let f: Vec<&str> = line.split('\x1f').collect();
        if f.len() < 7 {
            continue;
        }
        let (refname, oid, peeled, upstream, track, head, otype) = (f[0], f[1], f[2], f[3], f[4], f[5], f[6]);
        if let Some(name) = refname.strip_prefix("refs/heads/") {
            let (ahead, behind, gone) = parse_track(track);
            refs.locals.push(BranchInfo {
                name: name.to_string(),
                hash: oid.to_string(),
                upstream: (!upstream.is_empty()).then(|| upstream.to_string()),
                ahead,
                behind,
                gone,
                is_head: head == "*",
            });
        } else if let Some(full) = refname.strip_prefix("refs/remotes/") {
            let Some((remote, name)) = full.split_once('/') else { continue };
            if name == "HEAD" {
                continue;
            }
            refs.remote_branches.push((
                remote.to_string(),
                RemoteBranch { name: name.to_string(), full: full.to_string(), hash: oid.to_string() },
            ));
        } else if let Some(name) = refname.strip_prefix("refs/tags/") {
            let annotated = otype == "tag";
            refs.tags.push(TagInfo {
                name: name.to_string(),
                hash: if peeled.is_empty() { oid } else { peeled }.to_string(),
                annotated,
            });
        }
    }
    Ok(refs)
}

pub fn remotes(git: &Git) -> Result<Vec<(String, String)>> {
    let out = git.output(["config", "--get-regexp", r"^remote\..*\.url$"])?;
    let mut v = Vec::new();
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        if let Some((key, url)) = line.split_once(' ') {
            if let Some(name) = key.strip_prefix("remote.").and_then(|k| k.strip_suffix(".url")) {
                v.push((name.to_string(), url.to_string()));
            }
        }
    }
    Ok(v)
}

fn read_stashes(git: &Git) -> Result<Vec<StashInfo>> {
    let out = git.output(["stash", "list", "--format=%gd%x1f%H%x1f%ct%x1f%gs"])?;
    let mut v = Vec::new();
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        let f: Vec<&str> = line.split('\x1f').collect();
        if f.len() < 4 {
            continue;
        }
        let index = f[0]
            .trim_start_matches("stash@{")
            .trim_end_matches('}')
            .parse()
            .unwrap_or(v.len() as u32);
        v.push(StashInfo { index, hash: f[1].into(), time: f[2].parse().unwrap_or(0), message: f[3].into() });
    }
    Ok(v)
}

fn read_file(p: &Path) -> Option<String> {
    std::fs::read_to_string(p).ok().map(|s| s.trim_end().to_string())
}

pub fn repo_state(git_dir: &Path) -> RepoState {
    let has = |p: &str| git_dir.join(p).exists();
    let message = read_file(&git_dir.join("MERGE_MSG")).map(|m| {
        // Drop the comment block git appends for the editor.
        m.lines().filter(|l| !l.starts_with('#')).collect::<Vec<_>>().join("\n").trim().to_string()
    });
    if has("rebase-merge") || has("rebase-apply") {
        let dir = if has("rebase-merge") { git_dir.join("rebase-merge") } else { git_dir.join("rebase-apply") };
        let step = read_file(&dir.join("msgnum")).or_else(|| read_file(&dir.join("next")));
        let end = read_file(&dir.join("end")).or_else(|| read_file(&dir.join("last")));
        let head = read_file(&dir.join("head-name")).map(|h| h.trim_start_matches("refs/heads/").to_string());
        let mut detail = String::new();
        if let (Some(s), Some(e)) = (step, end) {
            detail = tr!("passo {s}/{e}", "step {s}/{e}");
        }
        if let Some(h) = head {
            detail = tr!("{detail} di {h}", "{detail} of {h}").trim().to_string();
        }
        return RepoState { kind: "rebase".into(), detail: (!detail.is_empty()).then_some(detail), message: None };
    }
    let kind = if has("MERGE_HEAD") {
        "merge"
    } else if has("CHERRY_PICK_HEAD") {
        "cherry-pick"
    } else if has("REVERT_HEAD") {
        "revert"
    } else if has("BISECT_LOG") {
        "bisect"
    } else {
        "none"
    };
    RepoState { kind: kind.into(), detail: None, message: if kind == "none" { None } else { message } }
}

pub fn overview(git: &Git, accounts: &[crate::accounts::Account]) -> Result<RepoOverview> {
    let gd = git_dir(git)?;
    let refs = read_refs(git)?;
    let remote_list = remotes(git)?;

    let mut head = HeadInfo::default();
    let sym = git.output(["symbolic-ref", "-q", "--short", "HEAD"])?;
    if sym.status.success() {
        head.branch = Some(String::from_utf8_lossy(&sym.stdout).trim().to_string());
    } else {
        head.detached = true;
    }
    if has_commits(git) {
        head.hash = Some(git.run(["rev-parse", "HEAD"])?.trim().to_string());
    }
    if let Some(b) = refs.locals.iter().find(|b| b.is_head) {
        head.upstream = b.upstream.clone();
        head.ahead = b.ahead;
        head.behind = b.behind;
    }

    let mut remotes_out: Vec<RemoteInfo> = remote_list
        .iter()
        .map(|(name, url)| RemoteInfo { name: name.clone(), url: url.clone(), branches: vec![] })
        .collect();
    for (remote, rb) in refs.remote_branches {
        match remotes_out.iter_mut().find(|r| r.name == remote) {
            Some(r) => r.branches.push(rb),
            None => remotes_out.push(RemoteInfo { name: remote, url: String::new(), branches: vec![rb] }),
        }
    }

    let mut tags = refs.tags;
    // Newest-looking versions first (natural-ish order).
    tags.sort_by(|a, b| natural_cmp(&b.name, &a.name));

    let path = git.dir.to_string_lossy().to_string();
    let name = git.dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| path.clone());

    Ok(RepoOverview {
        path,
        name,
        git_dir: gd.to_string_lossy().to_string(),
        head,
        locals: refs.locals,
        remotes: remotes_out,
        tags,
        stashes: read_stashes(git)?,
        state: repo_state(&gd),
        gitflow: gitflow::read_config(git)?,
        provider: remote_url::provider_link(&remote_list, accounts),
    })
}

/// Compare strings treating digit runs as numbers (v1.10 > v1.9).
pub fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    let (mut a, mut b) = (a.as_bytes(), b.as_bytes());
    loop {
        match (a.first(), b.first()) {
            (None, None) => return Ordering::Equal,
            (None, _) => return Ordering::Less,
            (_, None) => return Ordering::Greater,
            (Some(x), Some(y)) if x.is_ascii_digit() && y.is_ascii_digit() => {
                let na = a.iter().take_while(|c| c.is_ascii_digit()).count();
                let nb = b.iter().take_while(|c| c.is_ascii_digit()).count();
                let va: u128 = std::str::from_utf8(&a[..na]).unwrap().parse().unwrap_or(0);
                let vb: u128 = std::str::from_utf8(&b[..nb]).unwrap().parse().unwrap_or(0);
                match va.cmp(&vb) {
                    Ordering::Equal => {
                        a = &a[na..];
                        b = &b[nb..];
                    }
                    o => return o,
                }
            }
            (Some(x), Some(y)) => match x.cmp(y) {
                Ordering::Equal => {
                    a = &a[1..];
                    b = &b[1..];
                }
                o => return o,
            },
        }
    }
}

// ---------------------------------------------------------------- status

fn unmerged_kind(xy: &str) -> &'static str {
    match xy {
        "DD" => "both-deleted",
        "AU" => "added-by-us",
        "UD" => "deleted-by-them",
        "UA" => "added-by-them",
        "DU" => "deleted-by-us",
        "AA" => "both-added",
        _ => "both-modified",
    }
}

pub fn parse_status(raw: &[u8]) -> StatusResult {
    let text = String::from_utf8_lossy(raw);
    let mut entries = text.split('\0').filter(|s| !s.is_empty());
    let mut st = StatusResult::default();
    while let Some(e) = entries.next() {
        let mut it = e.splitn(2, ' ');
        let kind = it.next().unwrap_or("");
        let rest = it.next().unwrap_or("");
        match kind {
            "1" | "2" => {
                // 1 XY sub mH mI mW hH hI path
                // 2 XY sub mH mI mW hH hI Xscore path\0origPath
                let n = if kind == "1" { 8 } else { 9 };
                let fields: Vec<&str> = rest.splitn(n, ' ').collect();
                if fields.len() < n {
                    continue;
                }
                let xy = fields[0].as_bytes();
                let path = fields[n - 1].to_string();
                let old_path = if kind == "2" { entries.next().map(str::to_string) } else { None };
                let (x, y) = (xy[0] as char, xy[1] as char);
                if x != '.' {
                    st.staged.push(FileChange { path: path.clone(), old_path: old_path.clone(), status: x.to_string() });
                }
                if y != '.' {
                    st.unstaged.push(FileChange { path, old_path: None, status: y.to_string() });
                }
            }
            "u" => {
                let fields: Vec<&str> = rest.splitn(10, ' ').collect();
                if fields.len() < 10 {
                    continue;
                }
                st.conflicted.push(ConflictFile { path: fields[9].to_string(), kind: unmerged_kind(fields[0]).into() });
            }
            "?" => st.unstaged.push(FileChange { path: rest.to_string(), old_path: None, status: "?".into() }),
            _ => {}
        }
    }
    st
}

pub fn status(git: &Git) -> Result<StatusResult> {
    let g = git.clone().env("GIT_OPTIONAL_LOCKS", "0");
    let raw = g.run_bytes(["status", "--porcelain=v2", "-z", "--untracked-files=all", "--ignore-submodules=dirty"])?;
    Ok(parse_status(&raw))
}

// ---------------------------------------------------------------- log / graph

pub fn graph(git: &Git, limit: usize, include_wip: bool) -> Result<GraphResult> {
    let refs = read_refs(git)?;
    let head_hash = if has_commits(git) { Some(git.run(["rev-parse", "HEAD"])?.trim().to_string()) } else { None };
    let detached = !git.succeeds(["symbolic-ref", "-q", "HEAD"])?;

    let mut labels: HashMap<String, Vec<RefLabel>> = HashMap::new();
    if detached {
        if let Some(h) = &head_hash {
            labels.entry(h.clone()).or_default().push(RefLabel { name: "HEAD".into(), kind: "head".into(), current: true });
        }
    }
    for b in &refs.locals {
        labels.entry(b.hash.clone()).or_default().push(RefLabel { name: b.name.clone(), kind: "local".into(), current: b.is_head });
    }
    for (_, rb) in &refs.remote_branches {
        labels.entry(rb.hash.clone()).or_default().push(RefLabel { name: rb.full.clone(), kind: "remote".into(), current: false });
    }
    for t in &refs.tags {
        labels.entry(t.hash.clone()).or_default().push(RefLabel { name: t.name.clone(), kind: "tag".into(), current: false });
    }

    let mut rows: Vec<CommitRow> = Vec::new();
    let mut truncated = false;
    if head_hash.is_some() || !refs.locals.is_empty() || !refs.remote_branches.is_empty() {
        let mut args: Vec<String> = vec![
            "log".into(),
            "--date-order".into(),
            format!("-n{}", limit + 1),
            "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%s".into(),
            "--branches".into(),
            "--remotes".into(),
            "--tags".into(),
        ];
        if head_hash.is_some() {
            args.push("HEAD".into());
        }
        args.push("--".into());
        let out = git.run(&args)?;
        for line in out.lines() {
            let f: Vec<&str> = line.splitn(6, '\x1f').collect();
            if f.len() < 6 {
                continue;
            }
            if rows.len() >= limit {
                truncated = true;
                break;
            }
            let hash = f[0].to_string();
            rows.push(CommitRow {
                refs: labels.remove(&hash).unwrap_or_default(),
                parents: f[1].split_whitespace().map(str::to_string).collect(),
                author: f[2].into(),
                email: f[3].into(),
                time: f[4].parse().unwrap_or(0),
                subject: f[5].into(),
                hash,
                wip: false,
                graph: Default::default(),
            });
        }
    }

    if include_wip {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        rows.insert(
            0,
            CommitRow {
                hash: WIP_HASH.into(),
                parents: head_hash.iter().cloned().collect(),
                author: String::new(),
                email: String::new(),
                time: now,
                subject: "// WIP".into(),
                refs: vec![],
                wip: true,
                graph: Default::default(),
            },
        );
    }

    let input: Vec<LayoutInput> =
        rows.iter().map(|r| LayoutInput { hash: &r.hash, parents: &r.parents, virtual_row: r.wip }).collect();
    let (layout, lanes) = graph::layout(&input);
    for (row, g) in rows.iter_mut().zip(layout) {
        row.graph = g;
    }
    Ok(GraphResult { rows, lanes, truncated })
}

// ---------------------------------------------------------------- diffs

/// Diff of a working-tree file. `staged` selects index vs HEAD.
pub fn working_diff(git: &Git, path: &str, old_path: Option<&str>, staged: bool, untracked: bool) -> Result<FileDiff> {
    let out = if untracked {
        // --no-index exits with 1 when files differ.
        let null = if cfg!(windows) { "NUL" } else { "/dev/null" };
        let o = git.output(["diff", "--no-color", "--no-ext-diff", "--no-index", "--", null, path])?;
        if o.status.code().unwrap_or(2) > 1 {
            return Err(Error::msg(String::from_utf8_lossy(&o.stderr).trim().to_string()));
        }
        String::from_utf8_lossy(&o.stdout).into_owned()
    } else {
        let mut args = vec!["diff", "--no-color", "--no-ext-diff", "-M"];
        if staged {
            args.push("--cached");
        }
        args.push("--");
        if let Some(o) = old_path {
            args.push(o);
        }
        args.push(path);
        git.run(&args)?
    };
    Ok(diff::parse(&out).into_iter().next().unwrap_or_else(|| FileDiff { path: path.to_string(), ..Default::default() }))
}

pub fn commit_details(git: &Git, hash: &str) -> Result<CommitDetails> {
    let out = git.run([
        "show",
        "-s",
        "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ce%x1f%ct%x1f%B",
        hash,
        "--",
    ])?;
    let f: Vec<&str> = out.splitn(9, '\x1f').collect();
    if f.len() < 9 {
        return Err(Error::msg(tr!("formato di git show inatteso", "unexpected git show output")));
    }
    let message = f[8].trim_end();
    let (subject, body) = match message.split_once('\n') {
        Some((s, b)) => (s.trim().to_string(), b.trim().to_string()),
        None => (message.trim().to_string(), String::new()),
    };
    Ok(CommitDetails {
        hash: f[0].into(),
        parents: f[1].split_whitespace().map(str::to_string).collect(),
        author: f[2].into(),
        email: f[3].into(),
        author_time: f[4].parse().unwrap_or(0),
        committer: f[5].into(),
        committer_email: f[6].into(),
        commit_time: f[7].parse().unwrap_or(0),
        subject,
        body,
        files: commit_files(git, hash)?,
    })
}

pub fn commit_files(git: &Git, hash: &str) -> Result<Vec<FileChange>> {
    let raw = git.run_bytes([
        "show",
        "--format=",
        "--name-status",
        "-z",
        "-M",
        "--diff-merges=first-parent",
        hash,
        "--",
    ])?;
    let text = String::from_utf8_lossy(&raw);
    let mut it = text.split('\0').filter(|s| !s.is_empty());
    let mut files = Vec::new();
    while let Some(status) = it.next() {
        let letter = status.chars().next().unwrap_or('M');
        if letter == 'R' || letter == 'C' {
            let old = it.next().unwrap_or_default().to_string();
            let new = it.next().unwrap_or_default().to_string();
            files.push(FileChange { path: new, old_path: Some(old), status: letter.to_string() });
        } else if let Some(p) = it.next() {
            files.push(FileChange { path: p.to_string(), old_path: None, status: letter.to_string() });
        }
    }
    Ok(files)
}

pub fn commit_file_diff(git: &Git, hash: &str, path: &str, old_path: Option<&str>) -> Result<FileDiff> {
    let mut args = vec!["show", "--format=", "--no-color", "--no-ext-diff", "-M", "--diff-merges=first-parent", hash, "--"];
    if let Some(o) = old_path {
        args.push(o);
    }
    args.push(path);
    let out = git.run(&args)?;
    Ok(diff::parse(&out).into_iter().next().unwrap_or_else(|| FileDiff { path: path.to_string(), ..Default::default() }))
}

/// Last commit message, used to prefill "amend".
pub fn last_message(git: &Git) -> Result<String> {
    if !has_commits(git) {
        return Ok(String::new());
    }
    Ok(git.run(["log", "-1", "--format=%B"])?.trim_end().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_v2_parsing() {
        let raw = b"1 M. N... 100644 100644 100644 aaa bbb src/a.rs\x001 .M N... 100644 100644 100644 aaa bbb b c.txt\x002 R. N... 100644 100644 100644 aaa bbb R100 new.rs\x00old.rs\x00u UU N... 100644 100644 100644 100644 a b c conf.txt\x00? untracked file.txt\x00";
        let st = parse_status(raw);
        assert_eq!(st.staged.len(), 2);
        assert_eq!(st.staged[0].path, "src/a.rs");
        assert_eq!(st.staged[1], FileChange { path: "new.rs".into(), old_path: Some("old.rs".into()), status: "R".into() });
        assert_eq!(st.unstaged[0].path, "b c.txt");
        assert_eq!(st.unstaged[1].status, "?");
        assert_eq!(st.unstaged[1].path, "untracked file.txt");
        assert_eq!(st.conflicted[0], ConflictFile { path: "conf.txt".into(), kind: "both-modified".into() });
    }

    #[test]
    fn natural_order() {
        assert_eq!(natural_cmp("v1.10.0", "v1.9.0"), std::cmp::Ordering::Greater);
        assert_eq!(natural_cmp("a", "a"), std::cmp::Ordering::Equal);
    }
}
