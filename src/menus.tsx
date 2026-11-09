// Context-menu builders.
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Copy,
  ExternalLink,
  Eye,
  GitBranchPlus,
  GitCompare,
  GitMerge,
  GitPullRequestCreate,
  Pencil,
  Play,
  RotateCcw,
  Tag,
  Trash,
  Undo2,
  Upload,
  Flag,
  Inbox,
  Link,
} from "lucide-react";
import * as A from "./actions";
import { api } from "./api";
import { t } from "./i18n";
import type { MenuItem } from "./store";
import type { GitFlowKind, PullRequest, RepoOverview } from "./types";

const sep: MenuItem = { separator: true };
const I = 14;

export function commitMenu(path: string, o: RepoOverview, hash: string, subject: string): MenuItem[] {
  const short = hash.slice(0, 7);
  const cur = o.head.branch ?? "HEAD";
  const isHead = o.head.hash === hash;
  return [
    { label: t("menu.commit.createBranch"), icon: <GitBranchPlus size={I} />, action: () => A.createBranch(path, hash, short) },
    { label: t("menu.createTagHere"), icon: <Tag size={I} />, action: () => A.createTag(path, hash, short) },
    { label: t("menu.commit.checkout"), icon: <Play size={I} />, action: () => A.checkoutCommit(path, hash), disabled: isHead },
    sep,
    { label: t("menu.commit.cherryPick", { branch: cur }), icon: <GitCompare size={I} />, action: () => A.cherryPick(path, hash), disabled: isHead },
    { label: t("menu.commit.revert"), icon: <Undo2 size={I} />, action: () => A.revertCommit(path, hash) },
    sep,
    { label: t("menu.commit.reset", { branch: cur, mode: "soft" }), icon: <RotateCcw size={I} />, action: () => A.resetTo(path, hash, "soft"), disabled: isHead },
    { label: t("menu.commit.reset", { branch: cur, mode: "mixed" }), icon: <RotateCcw size={I} />, action: () => A.resetTo(path, hash, "mixed"), disabled: isHead },
    { label: t("menu.commit.reset", { branch: cur, mode: "hard" }), icon: <RotateCcw size={I} />, action: () => A.resetTo(path, hash, "hard"), danger: true },
    sep,
    { label: t("menu.commit.copySha"), icon: <Copy size={I} />, action: () => A.copy(hash), hint: short },
    { label: t("menu.commit.copyMessage"), icon: <Copy size={I} />, action: () => A.copy(subject) },
    ...(o.provider && o.provider.kind !== "unknown"
      ? [{ label: t("menu.commit.openWeb"), icon: <ExternalLink size={I} />, action: () => A.openExternal(`${o.provider!.webUrl}/${o.provider!.kind === "gitlab" ? "-/commit" : "commit"}/${hash}`) }]
      : []),
  ];
}

function gitflowItems(path: string, o: RepoOverview, branch: string): MenuItem[] {
  const gf = o.gitflow;
  if (!gf) return [];
  const kinds: GitFlowKind[] = ["feature", "bugfix", "release", "hotfix"];
  const kind = kinds.find((k) => gf[k] && branch.startsWith(gf[k]));
  if (!kind) return [];
  const name = branch.slice(gf[kind].length);
  return [sep, { label: t("actions.gitflow.finishTitle", { kind, name }), icon: <Flag size={I} />, action: () => A.gitflowFinish(path, kind, name) }];
}

export function localBranchMenu(path: string, o: RepoOverview, name: string): MenuItem[] {
  const b = o.locals.find((x) => x.name === name);
  const isHead = !!b?.isHead;
  const cur = o.head.branch ?? "HEAD";
  const hasProvider = !!o.provider && o.provider.kind !== "unknown";
  return [
    { label: `Checkout ${name}`, icon: <Play size={I} />, action: () => A.checkoutBranch(path, name), disabled: isHead },
    sep,
    { label: t("menu.branch.merge", { name, branch: cur }), icon: <GitMerge size={I} />, action: () => A.merge(path, name, "ff"), disabled: isHead },
    { label: t("menu.branch.mergeNoFf", { name, branch: cur }), icon: <GitMerge size={I} />, action: () => A.merge(path, name, "no-ff"), disabled: isHead },
    { label: t("menu.branch.squash", { name, branch: cur }), icon: <GitMerge size={I} />, action: () => A.merge(path, name, "squash"), disabled: isHead },
    { label: t("menu.branch.rebase", { branch: cur, onto: name }), icon: <GitCompare size={I} />, action: () => A.rebase(path, name), disabled: isHead },
    sep,
    { label: "Push", icon: <Upload size={I} />, action: () => A.push(path, { branch: name }) },
    { label: "Force push", icon: <Upload size={I} />, action: () => A.push(path, { branch: name, force: true }), danger: true },
    {
      label: isHead ? "Pull" : t("menu.branch.pullFfOnly"),
      icon: <ArrowDownToLine size={I} />,
      action: () => A.pullBranch(path, name),
      // Without a working copy the branch can only follow its upstream.
      disabled: !isHead && (!b?.upstream || b.gone),
    },
    { label: t("menu.branch.setUpstream"), icon: <Link size={I} />, action: () => A.setUpstream(path, name) },
    ...(hasProvider
      ? [{ label: o.provider!.kind === "gitlab" ? t("menu.branch.createMr") : t("menu.branch.createPr"), icon: <GitPullRequestCreate size={I} />, action: () => A.createPullRequest(path, name) }]
      : []),
    ...gitflowItems(path, o, name),
    sep,
    { label: t("menu.createBranchFromHere"), icon: <GitBranchPlus size={I} />, action: () => A.createBranch(path, name, name) },
    { label: t("menu.createTagHere"), icon: <Tag size={I} />, action: () => A.createTag(path, name, name) },
    { label: t("menu.rename"), icon: <Pencil size={I} />, action: () => A.renameBranch(path, name) },
    { label: t("menu.copyName"), icon: <Copy size={I} />, action: () => A.copy(name) },
    { label: t("menu.delete"), icon: <Trash size={I} />, action: () => A.deleteBranch(path, name), danger: true, disabled: isHead },
  ];
}

export function remoteBranchMenu(path: string, o: RepoOverview, full: string): MenuItem[] {
  const cur = o.head.branch ?? "HEAD";
  const name = full.split("/").slice(1).join("/");
  const local = o.locals.find((b) => b.upstream === full);
  return [
    { label: local ? `Checkout ${local.name}` : t("menu.remoteBranch.checkoutAs", { name }), icon: <Play size={I} />, action: () => A.checkoutRemote(path, full) },
    sep,
    { label: t("menu.branch.merge", { name: full, branch: cur }), icon: <GitMerge size={I} />, action: () => A.merge(path, full, "ff") },
    { label: t("menu.branch.rebase", { branch: cur, onto: full }), icon: <GitCompare size={I} />, action: () => A.rebase(path, full) },
    sep,
    { label: t("menu.createBranchFromHere"), icon: <GitBranchPlus size={I} />, action: () => A.createBranch(path, full, full) },
    { label: t("menu.copyName"), icon: <Copy size={I} />, action: () => A.copy(full) },
    { label: t("menu.remoteBranch.delete"), icon: <Trash size={I} />, action: () => A.deleteRemoteBranch(path, full), danger: true },
  ];
}

export function tagMenu(path: string, o: RepoOverview, name: string): MenuItem[] {
  const tag = o.tags.find((x) => x.name === name);
  return [
    { label: t("menu.tag.checkout"), icon: <Play size={I} />, action: () => tag && A.checkoutCommit(path, tag.hash) },
    { label: t("menu.tag.createBranch"), icon: <GitBranchPlus size={I} />, action: () => A.createBranch(path, name, name) },
    { label: t("menu.tag.push"), icon: <Upload size={I} />, action: () => A.pushTag(path, name), disabled: !o.remotes.length },
    sep,
    { label: t("menu.copyName"), icon: <Copy size={I} />, action: () => A.copy(name) },
    { label: t("menu.delete"), icon: <Trash size={I} />, action: () => A.deleteTag(path, name), danger: true },
  ];
}

export function stashMenu(path: string, index: number): MenuItem[] {
  return [
    { label: t("menu.stash.apply"), icon: <Inbox size={I} />, action: () => A.stashApply(path, index, false) },
    { label: t("menu.stash.pop"), icon: <ArrowUpFromLine size={I} />, action: () => A.stashApply(path, index, true) },
    sep,
    { label: t("menu.delete"), icon: <Trash size={I} />, action: () => A.stashDrop(path, index), danger: true },
  ];
}

export function remoteMenu(path: string, name: string, url: string): MenuItem[] {
  return [
    { label: `Fetch ${name}`, icon: <ArrowDownToLine size={I} />, action: () => A.run(`Fetch ${name}`, () => api.fetch(path, "f", name), { path, success: t("actions.fetch.done") }) },
    { label: t("menu.remote.copyUrl"), icon: <Copy size={I} />, action: () => A.copy(url) },
    sep,
    { label: t("menu.remote.remove"), icon: <Trash size={I} />, action: () => A.removeRemote(path, name), danger: true },
  ];
}

export function prMenu(path: string, o: RepoOverview, pr: PullRequest): MenuItem[] {
  const remote = o.provider?.remote ?? "origin";
  const full = `${remote}/${pr.sourceBranch}`;
  const available = o.remotes.some((r) => r.branches.some((b) => b.full === full));
  return [
    { label: t("menu.pr.openBrowser"), icon: <ExternalLink size={I} />, action: () => A.openExternal(pr.webUrl) },
    { label: `Checkout ${pr.sourceBranch}`, icon: <Play size={I} />, action: () => A.checkoutRemote(path, full), disabled: !available },
    { label: t("menu.pr.showInGraph"), icon: <Eye size={I} />, disabled: !available, action: () => {
      const h = o.remotes.flatMap((r) => r.branches).find((b) => b.full === full)?.hash;
      if (h) A.selectCommit(path, h);
    } },
    sep,
    { label: t("menu.pr.copyLink"), icon: <Copy size={I} />, action: () => A.copy(pr.webUrl) },
  ];
}
