// Typed wrappers around the Tauri commands defined in src-tauri/src/commands.rs.
import { invoke } from "@tauri-apps/api/core";
import type {
  Account,
  AppInfo,
  BranchIssue,
  CommitDetails,
  ConflictDoc,
  FileDiff,
  FinishOptions,
  GitFlowConfig,
  GraphResult,
  Issue,
  IssueDetail,
  NewPullRequest,
  PullAllReport,
  OpOutcome,
  PullRequest,
  RemoteRepo,
  RepoOverview,
  Settings,
  StatusResult,
} from "./types";

const call = <T>(cmd: string, args?: Record<string, unknown>) => invoke<T>(cmd, args);

export const api = {
  appInfo: () => call<AppInfo>("app_info"),
  settingsGet: () => call<Settings>("settings_get"),
  settingsSave: (settings: Settings) => call<void>("settings_save", { settings }),
  setLanguage: (language: "it" | "en") => call<void>("set_language", { language }),

  repoOpen: (path: string) => call<string>("repo_open", { path }),
  repoInit: (path: string, defaultBranch: string) => call<string>("repo_init", { path, defaultBranch }),
  repoClone: (opId: string, url: string, dest: string) => call<string>("repo_clone", { opId, url, dest }),
  overview: (path: string) => call<RepoOverview>("repo_overview", { path }),
  status: (path: string) => call<StatusResult>("repo_status", { path }),
  graph: (path: string, limit: number, wip: boolean) => call<GraphResult>("repo_graph", { path, limit, wip }),
  diffWorking: (path: string, file: string, oldPath: string | null, staged: boolean, untracked: boolean) =>
    call<FileDiff>("diff_working", { path, file, oldPath, staged, untracked }),
  diffCommit: (path: string, hash: string, file: string, oldPath: string | null) =>
    call<FileDiff>("diff_commit", { path, hash, file, oldPath }),
  commitDetails: (path: string, hash: string) => call<CommitDetails>("commit_details", { path, hash }),
  lastCommitMessage: (path: string) => call<string>("last_commit_message", { path }),

  stage: (path: string, files: string[]) => call<void>("stage", { path, files }),
  unstage: (path: string, files: string[]) => call<void>("unstage", { path, files }),
  stageAll: (path: string) => call<void>("stage_all", { path }),
  unstageAll: (path: string) => call<void>("unstage_all", { path }),
  discard: (path: string, tracked: string[], untracked: string[]) => call<void>("discard", { path, tracked, untracked }),
  discardAll: (path: string) => call<void>("discard_all", { path }),
  applyHunk: (path: string, file: string, oldPath: string | null, hunkHeader: string, action: "stage" | "unstage" | "discard") =>
    call<void>("apply_hunk", { path, file, oldPath, hunkHeader, action }),
  commit: (path: string, message: string, amend: boolean) => call<string>("commit", { path, message, amend }),

  fetch: (path: string, opId: string, remote: string | null = null) => call<void>("fetch", { path, opId, remote }),
  pull: (path: string, opId: string, mode: string) => call<OpOutcome>("pull", { path, opId, mode }),
  pullBranch: (path: string, opId: string, branch: string) => call<string>("pull_branch", { path, opId, branch }),
  pullAllBranches: (path: string, opId: string) => call<PullAllReport>("pull_all_branches", { path, opId }),
  push: (path: string, opId: string, branch: string | null, remote: string | null, force: boolean) =>
    call<string>("push", { path, opId, branch, remote, force }),

  checkout: (path: string, branch: string) => call<void>("checkout", { path, branch }),
  checkoutRemote: (path: string, full: string) => call<string>("checkout_remote", { path, full }),
  checkoutCommit: (path: string, hash: string) => call<void>("checkout_commit", { path, hash }),
  branchCreate: (path: string, name: string, start: string | null, checkout: boolean) =>
    call<void>("branch_create", { path, name, start, checkout }),
  branchDelete: (path: string, name: string, force: boolean) => call<void>("branch_delete", { path, name, force }),
  branchRename: (path: string, old: string, newName: string) => call<void>("branch_rename", { path, old, new: newName }),
  branchDeleteRemote: (path: string, remote: string, name: string) => call<void>("branch_delete_remote", { path, remote, name }),
  branchSetUpstream: (path: string, branch: string, upstream: string) =>
    call<void>("branch_set_upstream", { path, branch, upstream }),
  tagCreate: (path: string, name: string, target: string, message: string | null) =>
    call<void>("tag_create", { path, name, target, message }),
  tagDelete: (path: string, name: string) => call<void>("tag_delete", { path, name }),
  tagPush: (path: string, remote: string, name: string) => call<void>("tag_push", { path, remote, name }),
  tagDeleteRemote: (path: string, remote: string, name: string) => call<void>("tag_delete_remote", { path, remote, name }),
  remoteAdd: (path: string, name: string, url: string) => call<void>("remote_add", { path, name, url }),
  remoteRemove: (path: string, name: string) => call<void>("remote_remove", { path, name }),

  stashSave: (path: string, message: string, includeUntracked: boolean) =>
    call<void>("stash_save", { path, message, includeUntracked }),
  stashApply: (path: string, index: number, pop: boolean) => call<OpOutcome>("stash_apply", { path, index, pop }),
  stashDrop: (path: string, index: number) => call<void>("stash_drop", { path, index }),

  merge: (path: string, target: string, mode: string) => call<OpOutcome>("merge", { path, target, mode }),
  rebase: (path: string, onto: string) => call<OpOutcome>("rebase", { path, onto }),
  cherryPick: (path: string, hash: string) => call<OpOutcome>("cherry_pick", { path, hash }),
  revert: (path: string, hash: string) => call<OpOutcome>("revert", { path, hash }),
  reset: (path: string, hash: string, mode: string) => call<void>("reset", { path, hash, mode }),
  opContinue: (path: string) => call<OpOutcome>("op_continue", { path }),
  opAbort: (path: string) => call<void>("op_abort", { path }),
  opSkip: (path: string) => call<OpOutcome>("op_skip", { path }),

  conflictLoad: (path: string, file: string) => call<ConflictDoc>("conflict_load", { path, file }),
  conflictResolve: (path: string, file: string, content: string) => call<void>("conflict_resolve", { path, file, content }),
  conflictTake: (path: string, file: string, side: "ours" | "theirs" | "delete") =>
    call<void>("conflict_take", { path, file, side }),

  gitflowSuggest: (path: string) => call<GitFlowConfig>("gitflow_suggest", { path }),
  gitflowInit: (path: string, config: GitFlowConfig) => call<void>("gitflow_init", { path, config }),
  gitflowStart: (path: string, kind: string, name: string, base: string | null) =>
    call<string>("gitflow_start", { path, kind, name, base }),
  gitflowFinish: (path: string, kind: string, name: string, options: FinishOptions) =>
    call<OpOutcome>("gitflow_finish", { path, kind, name, options }),

  accountsList: () => call<Account[]>("accounts_list"),
  accountAdd: (kind: string, host: string, token: string) => call<Account>("account_add", { kind, host, token }),
  accountRemove: (id: string) => call<void>("account_remove", { id }),
  providerRepos: (accountId: string) => call<RemoteRepo[]>("provider_repos", { accountId }),
  pullRequests: (path: string) => call<PullRequest[]>("pull_requests", { path }),
  /** Account used for the repository's pull requests and issues. */
  providerAccount: (path: string) => call<Account>("provider_account", { path }),
  issues: (path: string, filter: "open" | "closed", mine: boolean) => call<Issue[]>("issues", { path, filter, mine }),
  issueDetail: (path: string, number: number) => call<IssueDetail>("issue_detail", { path, number }),
  branchIssues: (path: string) => call<BranchIssue[]>("branch_issues", { path }),
  branchSetIssue: (path: string, branch: string, issue: number | null) => call<void>("branch_set_issue", { path, branch, issue }),
  pullRequestCreate: (path: string, pr: NewPullRequest) => call<PullRequest>("pull_request_create", { path, pr }),
};

export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
