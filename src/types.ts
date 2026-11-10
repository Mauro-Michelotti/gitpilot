// Mirrors of the Rust models in crates/gitpilot-core (camelCase JSON).

export interface HeadInfo {
  branch: string | null;
  detached: boolean;
  hash: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
}

export interface BranchInfo {
  name: string;
  hash: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  gone: boolean;
  isHead: boolean;
}

export interface RemoteBranch {
  name: string;
  full: string;
  hash: string;
}

export interface RemoteInfo {
  name: string;
  url: string;
  branches: RemoteBranch[];
}

export interface TagInfo {
  name: string;
  hash: string;
  annotated: boolean;
}

export interface StashInfo {
  index: number;
  hash: string;
  message: string;
  time: number;
}

export interface RepoState {
  kind: "none" | "merge" | "rebase" | "cherry-pick" | "revert" | "bisect";
  detail: string | null;
  message: string | null;
}

export interface GitFlowConfig {
  master: string;
  develop: string;
  feature: string;
  bugfix: string;
  release: string;
  hotfix: string;
  support: string;
  versionTag: string;
}

export interface ProviderLink {
  kind: "github" | "gitlab" | "unknown";
  host: string;
  project: string;
  remote: string;
  webUrl: string;
  accountId: string | null;
}

export interface RepoOverview {
  path: string;
  name: string;
  gitDir: string;
  head: HeadInfo;
  locals: BranchInfo[];
  remotes: RemoteInfo[];
  tags: TagInfo[];
  stashes: StashInfo[];
  state: RepoState;
  gitflow: GitFlowConfig | null;
  provider: ProviderLink | null;
}

export interface FileChange {
  path: string;
  oldPath: string | null;
  status: string;
}

export interface ConflictFile {
  path: string;
  kind: string;
}

export interface StatusResult {
  staged: FileChange[];
  unstaged: FileChange[];
  conflicted: ConflictFile[];
}

export interface RefLabel {
  name: string;
  kind: "local" | "remote" | "tag" | "head";
  current: boolean;
}

export interface GraphLine {
  from: number;
  to: number;
  kind: "top" | "bottom" | "pass";
  color: number;
}

export interface GraphRow {
  col: number;
  color: number;
  lines: GraphLine[];
}

export interface CommitRow {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  time: number;
  subject: string;
  refs: RefLabel[];
  wip: boolean;
  graph: GraphRow;
}

export interface GraphResult {
  rows: CommitRow[];
  lanes: number;
  truncated: boolean;
}

export interface CommitDetails {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  authorTime: number;
  committer: string;
  committerEmail: string;
  commitTime: number;
  subject: string;
  body: string;
  files: FileChange[];
}

export interface DiffLine {
  kind: " " | "+" | "-" | "\\";
  oldNo: number | null;
  newNo: number | null;
  text: string;
}

export interface Hunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  oldPath: string | null;
  binary: boolean;
  header: string;
  hunks: Hunk[];
  added: number;
  removed: number;
  truncated: boolean;
}

export interface OpOutcome {
  conflicts: boolean;
  message: string;
}

/** Result of "Pull di tutti i branch": every local branch with an upstream lands in one list. */
export interface PullAllReport {
  updated: { name: string; commits: number }[];
  /** Same commit as the upstream, or only ahead of it. */
  upToDate: string[];
  /** Left untouched, with the reason. */
  skipped: { name: string; reason: string }[];
}

export type Segment =
  | { type: "common"; text: string }
  | {
      type: "conflict";
      ours: string;
      base: string | null;
      theirs: string;
      oursLabel: string;
      theirsLabel: string;
    };

export interface ConflictDoc {
  path: string;
  kind: string;
  binary: boolean;
  segments: Segment[];
  oursExists: boolean;
  theirsExists: boolean;
  oursName: string;
  theirsName: string;
}

export interface Account {
  id: string;
  kind: "github" | "gitlab";
  host: string;
  baseUrl: string;
  apiUrl: string;
  username: string;
  name: string | null;
  avatarUrl: string | null;
  tokenInFile: boolean;
}

export interface RemoteRepo {
  fullName: string;
  name: string;
  description: string | null;
  private: boolean;
  cloneHttps: string;
  cloneSsh: string;
  webUrl: string;
  defaultBranch: string | null;
  updatedAt: string | null;
}

export interface PullRequest {
  number: number;
  title: string;
  author: string;
  sourceBranch: string;
  targetBranch: string;
  webUrl: string;
  draft: boolean;
  state: string;
  updatedAt: string | null;
}

export interface NewPullRequest {
  title: string;
  body: string;
  sourceBranch: string;
  targetBranch: string;
  draft: boolean;
}

export interface RecentRepo {
  path: string;
  name: string;
  lastOpened: number;
}

export interface IssueLabel {
  name: string;
  /** `#rrggbb` */
  color: string | null;
}

export interface Issue {
  /** Issue number (GitHub) or iid (GitLab). */
  number: number;
  title: string;
  state: "open" | "closed";
  author: string;
  labels: IssueLabel[];
  assignees: string[];
  milestone: string | null;
  comments: number;
  webUrl: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface IssueComment {
  author: string;
  createdAt: string | null;
  /** Sanitized by the backend. */
  bodyHtml: string;
}

export interface IssueDetail {
  issue: Issue;
  /** Sanitized by the backend. */
  bodyHtml: string;
  comments: IssueComment[];
}

/** Branch created for an issue. */
export interface BranchIssue {
  branch: string;
  issue: number;
}

/** Repositories shown as one tab with second-level tabs. */
export interface RepoGroup {
  /** `group:<random>`, never a path: it sits in `openTabs` next to repository paths. */
  id: string;
  name: string;
  /** Repository roots in tab order; a repository belongs to one group at most. */
  repos: string[];
  /** Last active second-level tab. */
  activeRepo: string | null;
}

export interface Settings {
  recent: RecentRepo[];
  /** Top-level tabs: repository paths and group ids. */
  openTabs: string[];
  /** Repository shown, also when it is a tab of a group. */
  activeTab: string | null;
  /** Saved groups, open or not. */
  groups: RepoGroup[];
  theme: "system" | "dark" | "light";
  pullMode: "ff" | "ff-only" | "rebase";
  graphLimit: number;
  cloneDir: string | null;
  authorAvatars: boolean;
  language: "system" | "it" | "en";
}

export interface AppInfo {
  version: string;
  gitVersion: string;
  configDir: string;
  homeDir: string;
}

export interface FinishOptions {
  deleteBranch: boolean;
  tagMessage?: string | null;
  push: boolean;
}

export type GitFlowKind = "feature" | "bugfix" | "release" | "hotfix";
