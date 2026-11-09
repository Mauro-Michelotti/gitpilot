//! Data types shared with the frontend (serialized as camelCase JSON).

use serde::{Deserialize, Serialize};

use crate::graph::GraphRow;

#[derive(Serialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct HeadInfo {
    /// Current branch name, `None` when detached or unborn.
    pub branch: Option<String>,
    pub detached: bool,
    /// HEAD commit, `None` in a repository without commits.
    pub hash: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub name: String,
    pub hash: String,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    /// Upstream configured but deleted on the remote.
    pub gone: bool,
    pub is_head: bool,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RemoteBranch {
    /// Branch name without the remote prefix (`feature/x`).
    pub name: String,
    /// Full short ref (`origin/feature/x`).
    pub full: String,
    pub hash: String,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    pub name: String,
    pub url: String,
    pub branches: Vec<RemoteBranch>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TagInfo {
    pub name: String,
    /// Commit the tag points to (peeled for annotated tags).
    pub hash: String,
    pub annotated: bool,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StashInfo {
    pub index: u32,
    pub hash: String,
    pub message: String,
    pub time: i64,
}

#[derive(Serialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct RepoState {
    /// none | merge | rebase | cherry-pick | revert | bisect
    pub kind: String,
    /// Human readable detail, e.g. "passo 2/5 su main".
    pub detail: Option<String>,
    /// Prepared commit message (MERGE_MSG) when a merge/cherry-pick is pending.
    pub message: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitFlowConfig {
    pub master: String,
    pub develop: String,
    pub feature: String,
    pub bugfix: String,
    pub release: String,
    pub hotfix: String,
    pub support: String,
    pub version_tag: String,
}

impl Default for GitFlowConfig {
    fn default() -> Self {
        GitFlowConfig {
            master: "main".into(),
            develop: "develop".into(),
            feature: "feature/".into(),
            bugfix: "bugfix/".into(),
            release: "release/".into(),
            hotfix: "hotfix/".into(),
            support: "support/".into(),
            version_tag: String::new(),
        }
    }
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProviderLink {
    /// github | gitlab | unknown
    pub kind: String,
    pub host: String,
    /// `owner/repo` (GitHub) or `group/subgroup/project` (GitLab).
    pub project: String,
    pub remote: String,
    pub web_url: String,
    /// Account configured for this host, if any.
    pub account_id: Option<String>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RepoOverview {
    pub path: String,
    pub name: String,
    pub git_dir: String,
    pub head: HeadInfo,
    pub locals: Vec<BranchInfo>,
    pub remotes: Vec<RemoteInfo>,
    pub tags: Vec<TagInfo>,
    pub stashes: Vec<StashInfo>,
    pub state: RepoState,
    pub gitflow: Option<GitFlowConfig>,
    pub provider: Option<ProviderLink>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    pub old_path: Option<String>,
    /// M A D R C T U ? (single letter, like `git status`)
    pub status: String,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConflictFile {
    pub path: String,
    /// both-modified | both-added | both-deleted | added-by-us | added-by-them | deleted-by-us | deleted-by-them
    pub kind: String,
}

#[derive(Serialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct StatusResult {
    pub staged: Vec<FileChange>,
    pub unstaged: Vec<FileChange>,
    pub conflicted: Vec<ConflictFile>,
}

impl StatusResult {
    pub fn is_clean(&self) -> bool {
        self.staged.is_empty() && self.unstaged.is_empty() && self.conflicted.is_empty()
    }
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RefLabel {
    pub name: String,
    /// local | remote | tag | head (detached HEAD)
    pub kind: String,
    /// The checked-out branch.
    pub current: bool,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CommitRow {
    pub hash: String,
    pub parents: Vec<String>,
    pub author: String,
    pub email: String,
    pub time: i64,
    pub subject: String,
    pub refs: Vec<RefLabel>,
    /// Synthetic "work in progress" row on top of HEAD.
    pub wip: bool,
    pub graph: GraphRow,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GraphResult {
    pub rows: Vec<CommitRow>,
    pub lanes: u16,
    /// More commits exist beyond the requested limit.
    pub truncated: bool,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetails {
    pub hash: String,
    pub parents: Vec<String>,
    pub author: String,
    pub email: String,
    pub author_time: i64,
    pub committer: String,
    pub committer_email: String,
    pub commit_time: i64,
    pub subject: String,
    pub body: String,
    pub files: Vec<FileChange>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    /// ' ' context, '+' added, '-' removed, '\\' "no newline" marker
    pub kind: String,
    pub old_no: Option<u32>,
    pub new_no: Option<u32>,
    pub text: String,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Hunk {
    pub header: String,
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub lines: Vec<DiffLine>,
}

#[derive(Serialize, Debug, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    pub old_path: Option<String>,
    pub binary: bool,
    /// Raw file header lines (`diff --git`, `index`, `---`, `+++`).
    pub header: String,
    pub hunks: Vec<Hunk>,
    pub added: u32,
    pub removed: u32,
    /// Diff cut because it was too large to display.
    pub truncated: bool,
}

/// Result of an operation that may stop on conflicts (merge, rebase, pull...).
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpOutcome {
    pub conflicts: bool,
    pub message: String,
}

impl OpOutcome {
    pub fn ok(message: impl Into<String>) -> Self {
        OpOutcome { conflicts: false, message: message.into() }
    }
    pub fn conflicts(message: impl Into<String>) -> Self {
        OpOutcome { conflicts: true, message: message.into() }
    }
}

/// Result of fast-forwarding every local branch to its upstream (`ops::pull_all_branches`).
#[derive(Serialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PullAllReport {
    pub updated: Vec<UpdatedBranch>,
    /// Nothing to take from the upstream: same commit, or only ahead of it.
    pub up_to_date: Vec<String>,
    /// Left untouched (diverged, in another worktree, upstream gone, fetch failed…).
    pub skipped: Vec<SkippedBranch>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdatedBranch {
    pub name: String,
    /// Commits gained from the upstream.
    pub commits: u32,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SkippedBranch {
    pub name: String,
    pub reason: String,
}
