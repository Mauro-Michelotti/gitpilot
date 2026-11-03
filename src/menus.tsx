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
import type { MenuItem } from "./store";
import type { GitFlowKind, PullRequest, RepoOverview } from "./types";

const sep: MenuItem = { separator: true };
const I = 14;

export function commitMenu(path: string, o: RepoOverview, hash: string, subject: string): MenuItem[] {
  const short = hash.slice(0, 7);
  const cur = o.head.branch ?? "HEAD";
  const isHead = o.head.hash === hash;
  return [
    { label: "Crea branch qui", icon: <GitBranchPlus size={I} />, action: () => A.createBranch(path, hash, short) },
    { label: "Crea tag qui", icon: <Tag size={I} />, action: () => A.createTag(path, hash, short) },
    { label: "Checkout di questo commit", icon: <Play size={I} />, action: () => A.checkoutCommit(path, hash), disabled: isHead },
    sep,
    { label: `Cherry-pick in ${cur}`, icon: <GitCompare size={I} />, action: () => A.cherryPick(path, hash), disabled: isHead },
    { label: "Revert del commit", icon: <Undo2 size={I} />, action: () => A.revertCommit(path, hash) },
    sep,
    { label: `Reset ${cur} qui — soft`, icon: <RotateCcw size={I} />, action: () => A.resetTo(path, hash, "soft"), disabled: isHead },
    { label: `Reset ${cur} qui — mixed`, icon: <RotateCcw size={I} />, action: () => A.resetTo(path, hash, "mixed"), disabled: isHead },
    { label: `Reset ${cur} qui — hard`, icon: <RotateCcw size={I} />, action: () => A.resetTo(path, hash, "hard"), danger: true },
    sep,
    { label: "Copia SHA", icon: <Copy size={I} />, action: () => A.copy(hash), hint: short },
    { label: "Copia messaggio", icon: <Copy size={I} />, action: () => A.copy(subject) },
    ...(o.provider && o.provider.kind !== "unknown"
      ? [{ label: "Apri sul web", icon: <ExternalLink size={I} />, action: () => A.openExternal(`${o.provider!.webUrl}/${o.provider!.kind === "gitlab" ? "-/commit" : "commit"}/${hash}`) }]
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
  return [sep, { label: `Concludi ${kind} ${name}`, icon: <Flag size={I} />, action: () => A.gitflowFinish(path, kind, name) }];
}

export function localBranchMenu(path: string, o: RepoOverview, name: string): MenuItem[] {
  const b = o.locals.find((x) => x.name === name);
  const isHead = !!b?.isHead;
  const cur = o.head.branch ?? "HEAD";
  const hasProvider = !!o.provider && o.provider.kind !== "unknown";
  return [
    { label: `Checkout ${name}`, icon: <Play size={I} />, action: () => A.checkoutBranch(path, name), disabled: isHead },
    sep,
    { label: `Merge ${name} in ${cur}`, icon: <GitMerge size={I} />, action: () => A.merge(path, name, "ff"), disabled: isHead },
    { label: `Merge ${name} in ${cur} (no fast-forward)`, icon: <GitMerge size={I} />, action: () => A.merge(path, name, "no-ff"), disabled: isHead },
    { label: `Squash ${name} in ${cur}`, icon: <GitMerge size={I} />, action: () => A.merge(path, name, "squash"), disabled: isHead },
    { label: `Rebase ${cur} su ${name}`, icon: <GitCompare size={I} />, action: () => A.rebase(path, name), disabled: isHead },
    sep,
    { label: "Push", icon: <Upload size={I} />, action: () => A.push(path, { branch: name }) },
    { label: "Force push", icon: <Upload size={I} />, action: () => A.push(path, { branch: name, force: true }), danger: true },
    ...(isHead ? [{ label: "Pull", icon: <ArrowDownToLine size={I} />, action: () => A.pull(path) }] : []),
    { label: "Imposta upstream…", icon: <Link size={I} />, action: () => A.setUpstream(path, name) },
    ...(hasProvider
      ? [{ label: o.provider!.kind === "gitlab" ? "Crea merge request" : "Crea pull request", icon: <GitPullRequestCreate size={I} />, action: () => A.createPullRequest(path, name) }]
      : []),
    ...gitflowItems(path, o, name),
    sep,
    { label: "Crea branch da qui", icon: <GitBranchPlus size={I} />, action: () => A.createBranch(path, name, name) },
    { label: "Crea tag qui", icon: <Tag size={I} />, action: () => A.createTag(path, name, name) },
    { label: "Rinomina…", icon: <Pencil size={I} />, action: () => A.renameBranch(path, name) },
    { label: "Copia nome", icon: <Copy size={I} />, action: () => A.copy(name) },
    { label: "Elimina…", icon: <Trash size={I} />, action: () => A.deleteBranch(path, name), danger: true, disabled: isHead },
  ];
}

export function remoteBranchMenu(path: string, o: RepoOverview, full: string): MenuItem[] {
  const cur = o.head.branch ?? "HEAD";
  const name = full.split("/").slice(1).join("/");
  const local = o.locals.find((b) => b.upstream === full);
  return [
    { label: local ? `Checkout ${local.name}` : `Checkout come ${name}`, icon: <Play size={I} />, action: () => A.checkoutRemote(path, full) },
    sep,
    { label: `Merge ${full} in ${cur}`, icon: <GitMerge size={I} />, action: () => A.merge(path, full, "ff") },
    { label: `Rebase ${cur} su ${full}`, icon: <GitCompare size={I} />, action: () => A.rebase(path, full) },
    sep,
    { label: "Crea branch da qui", icon: <GitBranchPlus size={I} />, action: () => A.createBranch(path, full, full) },
    { label: "Copia nome", icon: <Copy size={I} />, action: () => A.copy(full) },
    { label: "Elimina dal remote…", icon: <Trash size={I} />, action: () => A.deleteRemoteBranch(path, full), danger: true },
  ];
}

export function tagMenu(path: string, o: RepoOverview, name: string): MenuItem[] {
  const t = o.tags.find((x) => x.name === name);
  return [
    { label: "Checkout del tag", icon: <Play size={I} />, action: () => t && A.checkoutCommit(path, t.hash) },
    { label: "Crea branch dal tag", icon: <GitBranchPlus size={I} />, action: () => A.createBranch(path, name, name) },
    { label: "Push del tag", icon: <Upload size={I} />, action: () => A.pushTag(path, name), disabled: !o.remotes.length },
    sep,
    { label: "Copia nome", icon: <Copy size={I} />, action: () => A.copy(name) },
    { label: "Elimina…", icon: <Trash size={I} />, action: () => A.deleteTag(path, name), danger: true },
  ];
}

export function stashMenu(path: string, index: number): MenuItem[] {
  return [
    { label: "Applica", icon: <Inbox size={I} />, action: () => A.stashApply(path, index, false) },
    { label: "Applica ed elimina (pop)", icon: <ArrowUpFromLine size={I} />, action: () => A.stashApply(path, index, true) },
    sep,
    { label: "Elimina…", icon: <Trash size={I} />, action: () => A.stashDrop(path, index), danger: true },
  ];
}

export function remoteMenu(path: string, name: string, url: string): MenuItem[] {
  return [
    { label: `Fetch ${name}`, icon: <ArrowDownToLine size={I} />, action: () => A.run(`Fetch ${name}`, () => api.fetch(path, "f", name), { path, success: "Fetch completato" }) },
    { label: "Copia URL", icon: <Copy size={I} />, action: () => A.copy(url) },
    sep,
    { label: "Rimuovi remote…", icon: <Trash size={I} />, action: () => A.removeRemote(path, name), danger: true },
  ];
}

export function prMenu(path: string, o: RepoOverview, pr: PullRequest): MenuItem[] {
  const remote = o.provider?.remote ?? "origin";
  const full = `${remote}/${pr.sourceBranch}`;
  const available = o.remotes.some((r) => r.branches.some((b) => b.full === full));
  return [
    { label: "Apri nel browser", icon: <ExternalLink size={I} />, action: () => A.openExternal(pr.webUrl) },
    { label: `Checkout ${pr.sourceBranch}`, icon: <Play size={I} />, action: () => A.checkoutRemote(path, full), disabled: !available },
    { label: "Mostra nel grafo", icon: <Eye size={I} />, disabled: !available, action: () => {
      const h = o.remotes.flatMap((r) => r.branches).find((b) => b.full === full)?.hash;
      if (h) A.selectCommit(path, h);
    } },
    sep,
    { label: "Copia link", icon: <Copy size={I} />, action: () => A.copy(pr.webUrl) },
  ];
}
