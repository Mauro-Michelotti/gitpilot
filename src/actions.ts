// Application logic: everything that talks to the backend and updates the store.
import type React from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, errorText } from "./api";
import { resolveLang, setLang, t } from "./i18n";
import { emptyTab, useStore, type MenuItem, type PromptSpec, type PromptValues, type Selection } from "./store";
import type { GitFlowKind, GraphResult, OpOutcome, RepoOverview, Settings } from "./types";

const S = () => useStore.getState();

// ---------------------------------------------------------------- feedback

let toastSeq = 0;
export function toast(kind: "info" | "success" | "error" | "warning", text: string) {
  const id = ++toastSeq;
  S().set({ toasts: [...S().toasts, { id, kind, text }] });
  const ms = kind === "error" ? 10000 : kind === "warning" ? 8000 : 4000;
  setTimeout(() => dismissToast(id), ms);
}

export function dismissToast(id: number) {
  S().set({ toasts: S().toasts.filter((t) => t.id !== id) });
}

export function prompt(spec: Omit<PromptSpec, "resolve">): Promise<PromptValues | null> {
  return new Promise((resolve) => {
    S().set({
      prompt: {
        ...spec,
        resolve: (v) => {
          S().set({ prompt: null });
          resolve(v);
        },
      },
    });
  });
}

export async function confirm(
  title: string,
  message: React.ReactNode,
  opts: { confirmLabel?: string; danger?: boolean } = {},
): Promise<boolean> {
  return (await prompt({ title, message, fields: [], ...opts })) !== null;
}

export async function inform(title: string, message: React.ReactNode) {
  await prompt({ title, message, fields: [], confirmLabel: t("common.close"), alert: true });
}

export function showMenu(e: React.MouseEvent, items: MenuItem[]) {
  e.preventDefault();
  e.stopPropagation();
  S().set({ menu: { x: e.clientX, y: e.clientY, items } });
}

export function copy(text: string) {
  navigator.clipboard.writeText(text).then(
    () => toast("info", t("actions.copied", { text: text.length > 60 ? text.slice(0, 60) + "…" : text })),
    () => toast("error", t("actions.copyFailed")),
  );
}

export function openExternal(url: string) {
  openUrl(url).catch((e) => toast("error", errorText(e)));
}

const newOpId = () => Math.random().toString(36).slice(2);

// ---------------------------------------------------------------- settings & boot

export async function saveSettings(patch: Partial<Settings>) {
  const cur = S().settings;
  if (!cur) return;
  const next = { ...cur, ...patch };
  // Before the store update, so components re-render already in the new language.
  if (next.language !== cur.language) applyLanguage(next.language);
  S().set({ settings: next });
  applyTheme(next.theme);
  await api.settingsSave(next).catch((e) => toast("error", errorText(e)));
}

/** Resolve the language setting ("system" included) for the UI, the backend messages and git. */
export function applyLanguage(setting: Settings["language"] | undefined) {
  const lang = resolveLang(setting);
  setLang(lang);
  api.setLanguage(lang).catch(() => {});
}

export function applyTheme(theme: Settings["theme"]) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

export async function reloadAccounts() {
  S().set({ accounts: await api.accountsList() });
}

let booted = false;
export async function boot() {
  if (booted) return;
  booted = true;
  listen<{ opId: string; line: string }>("git-progress", (e) => S().set({ progress: e.payload.line }));
  const [info, settings, accounts] = await Promise.all([api.appInfo(), api.settingsGet(), api.accountsList()]);
  applyLanguage(settings.language);
  S().set({ info, settings, accounts });
  applyTheme(settings.theme);
  for (const p of settings.openTabs) {
    await openRepo(p, { activate: false, quiet: true, persist: false });
  }
  const active = settings.activeTab && S().tabs.includes(settings.activeTab) ? settings.activeTab : (S().tabs[0] ?? null);
  // Restored tabs were just loaded by openRepo: no need to refresh the active one again.
  activate(active);

  const win = getCurrentWindow();
  win.onFocusChanged(({ payload: focused }) => {
    const p = S().active;
    if (focused && p) refresh(p);
  });
}

// ---------------------------------------------------------------- tabs

export async function openRepo(path: string, opts: { activate?: boolean; quiet?: boolean; persist?: boolean } = {}) {
  try {
    const root = await api.repoOpen(path);
    const st = S();
    if (!st.repos[root]) {
      S().set({
        repos: { ...st.repos, [root]: emptyTab(root, st.settings?.graphLimit ?? 2000) },
        tabs: [...st.tabs, root],
      });
    }
    // The backend updated the recent list: merge it into our copy.
    const fresh = await api.settingsGet();
    if (S().settings) S().set({ settings: { ...S().settings!, recent: fresh.recent } });
    if (opts.activate !== false) S().set({ active: root });
    if (opts.persist !== false) persistTabs();
    await refresh(root, { full: true });
    loadPullRequests(root, true);
    return root;
  } catch (e) {
    if (!opts.quiet) toast("error", errorText(e));
    return null;
  }
}

export function closeTab(path: string) {
  const st = S();
  const idx = st.tabs.indexOf(path);
  const tabs = st.tabs.filter((t) => t !== path);
  const repos = { ...st.repos };
  delete repos[path];
  let active = st.active;
  if (active === path) active = tabs[Math.min(idx, tabs.length - 1)] ?? null;
  S().set({ tabs, repos, active });
  persistTabs();
}

/** Switch tab and reload the repository, so changes made outside GitPilot show up right away. */
export function setActive(path: string | null) {
  activate(path);
  if (path) refresh(path, { full: true });
}

function activate(path: string | null) {
  S().set({ active: path });
  persistTabs();
  getCurrentWindow()
    .setTitle(path ? `${S().repos[path]?.name ?? ""} — GitPilot` : "GitPilot")
    .catch(() => {});
}

function persistTabs() {
  const { tabs, active } = S();
  saveSettings({ openTabs: tabs, activeTab: active });
}

export async function pickAndOpenRepo() {
  const dir = await openDialog({ directory: true, title: t("actions.openRepo.title") });
  if (typeof dir === "string") await openRepo(dir);
}

// ---------------------------------------------------------------- refresh

function graphKeyOf(o: RepoOverview, dirty: boolean, limit: number) {
  return JSON.stringify([
    o.head.hash,
    o.head.branch,
    o.locals.map((b) => b.name + b.hash),
    o.remotes.map((r) => r.branches.map((b) => b.full + b.hash)),
    o.tags.map((t) => t.name + t.hash),
    dirty,
    limit,
  ]);
}

function fixSelection(sel: Selection, graph: GraphResult, dirty: boolean, head: string | null): Selection {
  if (sel === null) return dirty ? { kind: "wip" } : head ? { kind: "commit", hash: head } : null;
  if (sel.kind === "wip" && !dirty) return head ? { kind: "commit", hash: head } : sel;
  if (sel.kind === "commit" && graph.rows.length && !graph.rows.some((r) => r.hash === sel.hash)) {
    return dirty ? { kind: "wip" } : head ? { kind: "commit", hash: head } : null;
  }
  return sel;
}

const inflight = new Map<string, Promise<void>>();
/** Latest refresh started for each repository: an older one finishing later must not overwrite its result. */
const refreshSeq = new Map<string, number>();
/** Keep the refresh indicator visible at least this long, so even a fast refresh is noticeable. */
const MIN_INDICATOR_MS = 500;

function setRefreshing(path: string, on: boolean) {
  const cur = S().refreshing;
  if (!!cur[path] === on) return;
  const next = { ...cur };
  if (on) next[path] = true;
  else delete next[path];
  S().set({ refreshing: next });
}

export function refresh(path: string, opts: { full?: boolean } = {}): Promise<void> {
  // Coalesce concurrent refreshes of the same repository; a full refresh always starts a new one.
  const running = inflight.get(path);
  if (running && !opts.full) return running;
  const seq = (refreshSeq.get(path) ?? 0) + 1;
  refreshSeq.set(path, seq);
  const started = Date.now();
  setRefreshing(path, true);
  const p = doRefresh(path, opts, seq).finally(() => {
    if (inflight.get(path) === p) inflight.delete(path);
    if (refreshSeq.get(path) !== seq) return; // a newer refresh owns the indicator
    const wait = MIN_INDICATOR_MS - (Date.now() - started);
    if (wait <= 0) setRefreshing(path, false);
    else setTimeout(() => refreshSeq.get(path) === seq && setRefreshing(path, false), wait);
  });
  inflight.set(path, p);
  return p;
}

/** Manual "Aggiorna" (toolbar button, F5, Ctrl/Cmd+R): reload the whole repo screen, pull requests included. */
export function reload(path: string) {
  loadPullRequests(path, true);
  return refresh(path, { full: true });
}

async function doRefresh(path: string, opts: { full?: boolean }, seq: number) {
  const tab = S().repos[path];
  if (!tab) return;
  const superseded = () => refreshSeq.get(path) !== seq;
  try {
    const [overview, status] = await Promise.all([api.overview(path), api.status(path)]);
    const dirty = status.staged.length + status.unstaged.length + status.conflicted.length > 0;
    const key = graphKeyOf(overview, dirty, tab.graphLimit);
    let graph = tab.graph;
    if (opts.full || !graph || key !== tab.graphKey) {
      graph = await api.graph(path, tab.graphLimit, dirty);
    }
    if (superseded()) return;
    const g = graph;
    S().patchRepo(path, (t) => ({
      overview,
      status,
      graph: g,
      graphKey: key,
      name: overview.name,
      loading: false,
      error: null,
      revision: t.revision + 1,
      selection: fixSelection(t.selection, g, dirty, overview.head.hash),
      // Leave the conflict editor once the file is resolved.
      view:
        t.view.kind === "conflict" && !status.conflicted.some((c) => c.path === (t.view as { file: string }).file)
          ? { kind: "graph" }
          : t.view,
    }));
  } catch (e) {
    if (!superseded()) S().patchRepo(path, { loading: false, error: errorText(e) });
  }
}

export function loadMoreCommits(path: string) {
  S().patchRepo(path, (t) => ({ graphLimit: t.graphLimit + 2000 }));
  refresh(path, { full: true });
}

// ---------------------------------------------------------------- operation runner

export async function run<T>(
  label: string,
  fn: () => Promise<T>,
  opts: { path?: string | null; success?: string | ((r: T) => string | null | undefined); full?: boolean } = {},
): Promise<T | undefined> {
  S().set({ busy: label, progress: null });
  try {
    const r = await fn();
    const msg = typeof opts.success === "function" ? opts.success(r) : opts.success;
    if (msg) toast("success", msg);
    return r;
  } catch (e) {
    toast("error", errorText(e));
    return undefined;
  } finally {
    S().set({ busy: null, progress: null });
    const p = opts.path === undefined ? S().active : opts.path;
    if (p) await refresh(p, { full: opts.full });
  }
}

function handleOutcome(path: string, o: OpOutcome | undefined) {
  if (!o) return;
  if (o.conflicts) {
    toast("warning", o.message);
    S().patchRepo(path, { selection: { kind: "wip" }, view: { kind: "graph" } });
  } else {
    toast("success", o.message);
  }
}

function active(): string {
  const p = S().active;
  if (!p) throw new Error(t("actions.noRepoOpen"));
  return p;
}

const ov = (path: string) => S().repos[path]?.overview ?? null;

// ---------------------------------------------------------------- remotes

export async function fetchAll(path = active()) {
  await run("Fetch", () => api.fetch(path, newOpId()), { path, success: t("actions.fetch.done") });
  loadPullRequests(path, true);
}

export async function pull(path = active(), mode?: string) {
  const m = mode ?? S().settings?.pullMode ?? "ff";
  const o = await run("Pull", () => api.pull(path, newOpId(), m), { path });
  handleOutcome(path, o);
}

/** Pull of a local branch: the current one uses the configured mode, any other one is only fast-forwarded. */
export async function pullBranch(path: string, branch: string) {
  if (ov(path)?.head.branch === branch) return pull(path);
  await run(t("actions.pullBranch.busy", { branch }), () => api.pullBranch(path, newOpId(), branch), { path, success: (m) => m });
}

/** Fast-forward every local branch with an upstream; never switches branch or opens conflicts. */
export async function pullAllBranches(path = active()) {
  const r = await run(t("actions.pullAll.title"), () => api.pullAllBranches(path, newOpId()), { path });
  if (!r) return;
  const { updated, upToDate, skipped } = r;
  const list = (names: string[], max = 5) =>
    names.length > max ? t("actions.list.andMore", { names: names.slice(0, max).join(", "), count: names.length - max }) : names.join(", ");
  const updatedText = list(updated.map((u) => `${u.name} (+${u.commits})`));
  if (!updated.length && !upToDate.length && !skipped.length) {
    return toast("info", t("actions.pullAll.none"));
  }
  if (!skipped.length) {
    if (!updated.length) return toast("success", t("actions.pullAll.allUpToDate", { count: upToDate.length }));
    const rest = upToDate.length ? t("actions.pullAll.restUpToDate", { count: upToDate.length }) : "";
    return toast("success", t("actions.pullAll.updated", { count: updated.length, list: updatedText, rest }));
  }
  const lines = [
    updated.length ? t("actions.pullAll.updatedList", { count: updated.length, list: updatedText }) : t("actions.pullAll.noneUpdated"),
    ...(upToDate.length ? [t("actions.pullAll.upToDateList", { count: upToDate.length, list: list(upToDate) })] : []),
    "",
    t("actions.pullAll.skippedList", { count: skipped.length }),
    ...skipped.map((s) => `• ${s.name}: ${s.reason}`),
  ];
  await inform(t("actions.pullAll.title"), lines.join("\n"));
}

export async function push(path = active(), opts: { branch?: string; force?: boolean } = {}) {
  const o = ov(path);
  const branchName = opts.branch ?? o?.head.branch;
  if (!branchName) return toast("error", t("actions.push.detached"));
  const info = o?.locals.find((b) => b.name === branchName);
  let remote: string | null = null;
  if (!info?.upstream && o && o.remotes.length > 1) {
    const v = await prompt({
      title: t("actions.push.publishTitle", { branch: branchName }),
      message: t("actions.push.chooseRemote"),
      fields: [
        {
          name: "remote",
          label: "Remote",
          type: "select",
          value: o.remotes.some((r) => r.name === "origin") ? "origin" : o.remotes[0].name,
          options: o.remotes.map((r) => ({ value: r.name, label: `${r.name} — ${r.url}` })),
        },
      ],
      confirmLabel: "Push",
    });
    if (!v) return;
    remote = String(v.remote);
  }
  if (opts.force) {
    const ok = await confirm(
      "Force push",
      t("actions.push.forceConfirm", { branch: branchName }),
      { confirmLabel: "Force push", danger: true },
    );
    if (!ok) return;
  }
  await run(opts.force ? "Force push" : "Push", () => api.push(path, newOpId(), branchName, remote, !!opts.force), {
    path,
    success: (m) => m,
  });
}

export async function addRemote(path = active()) {
  const v = await prompt({
    title: t("actions.remote.addTitle"),
    fields: [
      { name: "name", label: t("actions.field.name"), value: ov(path)?.remotes.length ? "upstream" : "origin", required: true },
      { name: "url", label: "URL", placeholder: "git@github.com:owner/repo.git", required: true, mono: true },
    ],
    confirmLabel: t("actions.add"),
  });
  if (!v) return;
  await run(t("actions.remote.addTitle"), () => api.remoteAdd(path, String(v.name), String(v.url)), {
    path,
    success: t("actions.remote.added", { name: String(v.name) }),
  });
  fetchAll(path);
}

export async function removeRemote(path: string, name: string) {
  if (!(await confirm(t("actions.remote.removeTitle"), t("actions.remote.removeConfirm", { name }), { danger: true, confirmLabel: t("common.remove") })))
    return;
  await run(t("actions.remote.removeTitle"), () => api.remoteRemove(path, name), { path, success: t("actions.remote.removed", { name }) });
}

// ---------------------------------------------------------------- branches

export async function createBranch(path = active(), start?: string, startLabel?: string) {
  const v = await prompt({
    title: t("actions.branch.newTitle"),
    message: start
      ? t("actions.branch.startPoint", { start: startLabel ?? start.slice(0, 8) })
      : t("actions.branch.fromCurrent", { branch: ov(path)?.head.branch ?? "HEAD" }),
    fields: [
      { name: "name", label: t("actions.branch.nameLabel"), placeholder: t("actions.branch.namePlaceholder"), required: true, mono: true },
      { name: "checkout", label: t("actions.branch.checkoutNew"), type: "checkbox", value: true },
    ],
    confirmLabel: t("actions.branch.create"),
  });
  if (!v) return;
  await run(t("actions.branch.create"), () => api.branchCreate(path, String(v.name), start ?? null, !!v.checkout), {
    path,
    success: t("actions.branch.created", { name: String(v.name) }),
  });
}

export async function checkoutBranch(path: string, name: string) {
  await run(`Checkout ${name}`, () => api.checkout(path, name), { path, success: t("actions.checkout.nowOn", { name }) });
}

export async function checkoutRemote(path: string, full: string) {
  await run(`Checkout ${full}`, () => api.checkoutRemote(path, full), { path, success: (n) => t("actions.checkout.nowOn", { name: n }) });
}

export async function checkoutCommit(path: string, hash: string) {
  const ok = await confirm(
    t("actions.checkoutCommit.title"),
    t("actions.checkoutCommit.confirm", { hash: hash.slice(0, 8) }),
    { confirmLabel: "Checkout" },
  );
  if (!ok) return;
  await run("Checkout", () => api.checkoutCommit(path, hash), { path, success: t("actions.checkoutCommit.done", { hash: hash.slice(0, 8) }) });
}

export async function deleteBranch(path: string, name: string) {
  const b = ov(path)?.locals.find((x) => x.name === name);
  const remoteName = b?.upstream && !b.gone ? b.upstream : null;
  const fields: PromptSpec["fields"] = [
    { name: "force", label: t("actions.branch.forceDelete"), type: "checkbox", value: false },
  ];
  if (remoteName) fields.push({ name: "remote", label: t("actions.branch.deleteRemoteToo", { remote: remoteName }), type: "checkbox", value: false });
  const v = await prompt({
    title: t("actions.branch.deleteTitle", { name }),
    message: t("actions.branch.deleteMessage"),
    fields,
    confirmLabel: t("common.delete"),
    danger: true,
  });
  if (!v) return;
  await run(t("actions.branch.deleteBusy"), async () => {
    await api.branchDelete(path, name, !!v.force);
    if (v.remote && remoteName) {
      const [remote, ...rest] = remoteName.split("/");
      await api.branchDeleteRemote(path, remote, rest.join("/"));
    }
  }, { path, success: t("actions.branch.deleted", { name }) });
}

export async function deleteRemoteBranch(path: string, full: string) {
  const [remote, ...rest] = full.split("/");
  const name = rest.join("/");
  if (!(await confirm(t("actions.remoteBranch.deleteTitle"), t("actions.remoteBranch.deleteConfirm", { name, remote }), { danger: true, confirmLabel: t("common.delete") })))
    return;
  await run(t("actions.remoteBranch.deleteTitle"), () => api.branchDeleteRemote(path, remote, name), {
    path,
    success: t("actions.remoteBranch.deleted", { name: full }),
  });
}

export async function renameBranch(path: string, name: string) {
  const v = await prompt({
    title: t("actions.branch.renameTitle", { name }),
    fields: [{ name: "name", label: t("actions.branch.newName"), value: name, required: true, mono: true }],
    confirmLabel: t("actions.rename"),
  });
  if (!v || v.name === name) return;
  await run(t("actions.branch.renameBusy"), () => api.branchRename(path, name, String(v.name)), {
    path,
    success: t("actions.branch.renamed", { name: String(v.name) }),
  });
}

export async function setUpstream(path: string, branch: string) {
  const o = ov(path);
  const options = (o?.remotes ?? []).flatMap((r) => r.branches.map((b) => ({ value: b.full, label: b.full })));
  if (!options.length) return toast("error", t("actions.upstream.noRemoteBranches"));
  const v = await prompt({
    title: t("actions.upstream.title", { branch }),
    fields: [{ name: "up", label: t("actions.upstream.remoteBranch"), type: "select", options, value: options.find((x) => x.value.endsWith("/" + branch))?.value ?? options[0].value }],
    confirmLabel: t("actions.upstream.set"),
  });
  if (!v) return;
  await run(t("actions.upstream.busy"), () => api.branchSetUpstream(path, branch, String(v.up)), {
    path,
    success: t("actions.upstream.done", { upstream: String(v.up) }),
  });
}

// ---------------------------------------------------------------- merge / rebase / history

export async function merge(path: string, target: string, mode: "ff" | "no-ff" | "squash" = "ff") {
  const cur = ov(path)?.head.branch ?? "HEAD";
  const o = await run(`Merge ${target}`, () => api.merge(path, target, mode), { path });
  if (o && !o.conflicts && mode !== "squash") o.message = t("actions.merge.done", { target, branch: cur });
  handleOutcome(path, o);
}

export async function rebase(path: string, onto: string) {
  const cur = ov(path)?.head.branch ?? "HEAD";
  const ok = await confirm("Rebase", t("actions.rebase.confirm", { branch: cur, onto }), {
    confirmLabel: "Rebase",
  });
  if (!ok) return;
  handleOutcome(path, await run(t("actions.rebase.busy", { onto }), () => api.rebase(path, onto), { path }));
}

export async function cherryPick(path: string, hash: string) {
  handleOutcome(path, await run("Cherry-pick", () => api.cherryPick(path, hash), { path }));
}

export async function revertCommit(path: string, hash: string) {
  handleOutcome(path, await run("Revert", () => api.revert(path, hash), { path }));
}

export async function resetTo(path: string, hash: string, mode: "soft" | "mixed" | "hard") {
  const branch = ov(path)?.head.branch ?? "HEAD";
  const descr = t(`actions.reset.${mode}`);
  const ok = await confirm(`Reset ${mode}`, t("actions.reset.confirm", { branch, hash: hash.slice(0, 8), mode, descr }), {
    confirmLabel: `Reset ${mode}`,
    danger: mode === "hard",
  });
  if (!ok) return;
  await run("Reset", () => api.reset(path, hash, mode), { path, success: t("actions.reset.done", { branch, hash: hash.slice(0, 8) }) });
}

export async function continueOp(path = active()) {
  handleOutcome(path, await run(t("actions.op.continue"), () => api.opContinue(path), { path }));
}

export async function abortOp(path = active()) {
  const kind = ov(path)?.state.kind ?? "";
  const title = t("actions.op.abortTitle");
  if (!(await confirm(title, t("actions.op.abortConfirm", { kind }), { danger: true, confirmLabel: title }))) return;
  await run(t("actions.op.abortBusy"), () => api.opAbort(path), { path, success: t("actions.op.aborted") });
}

export async function skipOp(path = active()) {
  handleOutcome(path, await run(t("actions.op.skip"), () => api.opSkip(path), { path }));
}

// ---------------------------------------------------------------- tags

export async function createTag(path: string, target: string, label?: string) {
  const v = await prompt({
    title: t("actions.tag.newTitle"),
    message: t("actions.tag.on", { target: label ?? target.slice(0, 8) }),
    fields: [
      { name: "name", label: t("actions.field.name"), placeholder: "v1.2.0", required: true, mono: true },
      { name: "message", label: t("actions.tag.message"), type: "textarea" },
      { name: "push", label: t("actions.tag.pushToOrigin"), type: "checkbox", value: false },
    ],
    confirmLabel: t("actions.tag.create"),
  });
  if (!v) return;
  const name = String(v.name);
  await run(t("actions.tag.create"), async () => {
    await api.tagCreate(path, name, target, String(v.message || "") || null);
    if (v.push) await api.tagPush(path, ov(path)?.provider?.remote ?? "origin", name);
  }, { path, success: t("actions.tag.created", { name }) });
}

export async function deleteTag(path: string, name: string) {
  const remotes = ov(path)?.remotes ?? [];
  const fields: PromptSpec["fields"] = remotes.length
    ? [{ name: "remote", label: t("actions.tag.deleteRemoteToo", { remote: remotes[0].name }), type: "checkbox", value: false }]
    : [];
  const v = await prompt({ title: t("actions.tag.deleteTitle", { name }), fields, confirmLabel: t("common.delete"), danger: true });
  if (!v) return;
  await run(t("actions.tag.deleteBusy"), async () => {
    await api.tagDelete(path, name);
    if (v.remote) await api.tagDeleteRemote(path, remotes[0].name, name);
  }, { path, success: t("actions.tag.deleted", { name }) });
}

export async function pushTag(path: string, name: string) {
  const remote = ov(path)?.provider?.remote ?? ov(path)?.remotes[0]?.name ?? "origin";
  await run("Push tag", () => api.tagPush(path, remote, name), { path, success: t("actions.tag.pushed", { name, remote }) });
}

// ---------------------------------------------------------------- stash

export async function stashSave(path = active()) {
  const v = await prompt({
    title: t("actions.stash.title"),
    fields: [
      { name: "message", label: t("actions.stash.description"), placeholder: t("actions.stash.placeholder") },
      { name: "untracked", label: t("actions.stash.untracked"), type: "checkbox", value: true },
    ],
    confirmLabel: "Stash",
  });
  if (!v) return;
  await run("Stash", () => api.stashSave(path, String(v.message ?? ""), !!v.untracked), { path, success: t("actions.stash.saved") });
}

export async function stashApply(path: string, index: number, pop: boolean) {
  handleOutcome(path, await run(pop ? "Pop stash" : t("actions.stash.apply"), () => api.stashApply(path, index, pop), { path }));
}

export async function stashDrop(path: string, index: number) {
  const title = t("actions.stash.dropTitle");
  if (!(await confirm(title, t("actions.stash.dropConfirm", { ref: `stash@{${index}}` }), { danger: true, confirmLabel: t("common.delete") }))) return;
  await run(title, () => api.stashDrop(path, index), { path, success: t("actions.stash.dropped") });
}

// ---------------------------------------------------------------- working copy

export async function discardFiles(path: string, files: { path: string; status: string }[]) {
  if (!files.length) return;
  const names = files.length === 1 ? files[0].path : t("actions.discard.nFiles", { count: files.length });
  const discard = t("actions.discard.button");
  if (!(await confirm(t("actions.discard.title"), t("actions.discard.confirm", { names }), { danger: true, confirmLabel: discard }))) return;
  const tracked = files.filter((f) => f.status !== "?").map((f) => f.path);
  const untracked = files.filter((f) => f.status === "?").map((f) => f.path);
  await run(discard, () => api.discard(path, tracked, untracked), { path, success: t("actions.discard.done") });
}

export async function discardAll(path = active()) {
  const title = t("actions.discardAll.title");
  if (!(await confirm(title, t("actions.discardAll.confirm"), { danger: true, confirmLabel: title }))) return;
  await run(title, () => api.discardAll(path), { path, success: t("actions.discardAll.done") });
}

// ---------------------------------------------------------------- GitFlow

export async function gitflowInit(path = active()) {
  const s = await api.gitflowSuggest(path).catch(() => null);
  if (!s) return;
  const v = await prompt({
    title: t("actions.gitflow.initTitle"),
    message: t("actions.gitflow.initMessage"),
    fields: [
      { name: "master", label: t("actions.gitflow.production"), value: s.master, required: true, mono: true },
      { name: "develop", label: t("actions.gitflow.development"), value: s.develop, required: true, mono: true },
      { name: "feature", label: t("actions.gitflow.prefix.feature"), value: s.feature, mono: true },
      { name: "bugfix", label: t("actions.gitflow.prefix.bugfix"), value: s.bugfix, mono: true },
      { name: "release", label: t("actions.gitflow.prefix.release"), value: s.release, mono: true },
      { name: "hotfix", label: t("actions.gitflow.prefix.hotfix"), value: s.hotfix, mono: true },
      { name: "versionTag", label: t("actions.gitflow.prefix.versionTag"), value: s.versionTag, placeholder: t("actions.gitflow.versionTagPlaceholder"), mono: true },
    ],
    confirmLabel: t("actions.gitflow.init"),
  });
  if (!v) return;
  const cfg = { ...s, ...(v as Record<string, string>) };
  await run("Git Flow init", () => api.gitflowInit(path, cfg), { path, success: t("actions.gitflow.initialized"), full: true });
}

const kindLabel: Record<GitFlowKind, string> = { feature: "feature", bugfix: "bugfix", release: "release", hotfix: "hotfix" };

export async function gitflowStart(path: string, kind: GitFlowKind) {
  const cfg = ov(path)?.gitflow;
  if (!cfg) return gitflowInit(path);
  const isVersion = kind === "release" || kind === "hotfix";
  const base = kind === "hotfix" ? cfg.master : cfg.develop;
  let suggestion = "";
  if (isVersion) {
    const last = ov(path)?.tags.find((t) => t.name.startsWith(cfg.versionTag))?.name.slice(cfg.versionTag.length);
    const m = last?.match(/^(\d+)\.(\d+)\.(\d+)$/);
    if (m) {
      suggestion = kind === "hotfix" ? `${m[1]}.${m[2]}.${+m[3] + 1}` : `${m[1]}.${+m[2] + 1}.0`;
    }
  }
  const v = await prompt({
    title: t("actions.gitflow.startTitle", { kind: kindLabel[kind] }),
    message: t("actions.gitflow.startMessage", { prefix: cfg[kind], base }),
    fields: [
      { name: "name", label: isVersion ? t("actions.gitflow.version") : t("actions.field.name"), value: suggestion, placeholder: isVersion ? "1.4.0" : "login-oauth", required: true, mono: true },
      { name: "base", label: "Base", value: base, mono: true },
    ],
    confirmLabel: t("actions.gitflow.start"),
  });
  if (!v) return;
  await run(`Git Flow ${kind} start`, () => api.gitflowStart(path, kind, String(v.name), String(v.base || "") || null), {
    path,
    success: (b) => t("actions.gitflow.created", { branch: b }),
  });
}

export async function gitflowFinish(path: string, kind: GitFlowKind, name: string) {
  const cfg = ov(path)?.gitflow;
  if (!cfg) return;
  const isVersion = kind === "release" || kind === "hotfix";
  const targets = isVersion ? t("actions.gitflow.targetsBoth", { master: cfg.master, develop: cfg.develop }) : cfg.develop;
  const fields: PromptSpec["fields"] = [];
  if (isVersion) {
    fields.push({ name: "tagMessage", label: t("actions.gitflow.tagMessage", { tag: `${cfg.versionTag}${name}` }), type: "textarea", value: `${kind === "release" ? "Release" : "Hotfix"} ${name}` });
  }
  fields.push({ name: "deleteBranch", label: t("actions.gitflow.deleteAfter", { branch: `${cfg[kind]}${name}` }), type: "checkbox", value: true });
  fields.push({ name: "push", label: t("actions.gitflow.pushAfter"), type: "checkbox", value: false });
  const v = await prompt({
    title: t("actions.gitflow.finishTitle", { kind, name }),
    message: t(isVersion ? "actions.gitflow.finishMessageTag" : "actions.gitflow.finishMessage", { branch: `${cfg[kind]}${name}`, targets }),
    fields,
    confirmLabel: t("actions.gitflow.finish"),
  });
  if (!v) return;
  const o = await run(`Git Flow ${kind} finish`, () =>
    api.gitflowFinish(path, kind, name, {
      deleteBranch: !!v.deleteBranch,
      push: !!v.push,
      tagMessage: isVersion ? String(v.tagMessage ?? "") : null,
    }), { path, full: true });
  handleOutcome(path, o);
}

// ---------------------------------------------------------------- pull requests

export async function loadPullRequests(path: string, quiet = false) {
  const o = ov(path);
  if (!o?.provider?.accountId) {
    S().patchRepo(path, { prs: null, prError: null, prLoading: false });
    return;
  }
  S().patchRepo(path, { prLoading: true });
  try {
    const prs = await api.pullRequests(path);
    S().patchRepo(path, { prs, prError: null, prLoading: false });
  } catch (e) {
    S().patchRepo(path, { prError: errorText(e), prLoading: false });
    if (!quiet) toast("error", errorText(e));
  }
}

export async function createPullRequest(path = active(), source?: string) {
  const o = ov(path);
  if (!o) return;
  if (!o.provider || o.provider.kind === "unknown") return toast("error", t("actions.pr.unsupported"));
  if (!o.provider.accountId) {
    toast("warning", t("actions.pr.addAccount", { host: o.provider.host }));
    S().set({ modal: "preferences" });
    return;
  }
  const remote = o.remotes.find((r) => r.name === o.provider!.remote);
  const remoteBranches = remote?.branches.map((b) => b.name) ?? [];
  const src = source ?? o.head.branch ?? "";
  const defaultTarget =
    (o.gitflow && !src.startsWith(o.gitflow.release) && !src.startsWith(o.gitflow.hotfix) ? o.gitflow.develop : null) ??
    ["main", "master", "develop"].find((b) => remoteBranches.includes(b)) ??
    remoteBranches[0] ??
    "main";
  const isGh = o.provider.kind === "github";
  const lastSubject = (await api.lastCommitMessage(path).catch(() => "")).split("\n")[0];
  const v = await prompt({
    title: isGh ? t("actions.pr.newGithub") : t("actions.pr.newGitlab"),
    message: t("actions.pr.projectOn", { project: o.provider.project, host: o.provider.host }),
    fields: [
      { name: "source", label: t("actions.pr.source"), value: src, required: true, mono: true },
      {
        name: "target",
        label: t("actions.pr.target"),
        type: "select",
        value: defaultTarget,
        options: (remoteBranches.length ? remoteBranches : [defaultTarget]).map((b) => ({ value: b, label: b })),
      },
      { name: "title", label: t("actions.pr.title"), value: lastSubject, required: true },
      { name: "body", label: t("actions.pr.body"), type: "textarea" },
      { name: "draft", label: t("actions.pr.draft"), type: "checkbox", value: false },
    ],
    confirmLabel: t("actions.create"),
  });
  if (!v) return;
  const source2 = String(v.source);
  // The source branch must exist on the remote.
  if (!remoteBranches.includes(source2) && o.locals.some((b) => b.name === source2)) {
    const ok = await confirm(t("actions.pr.notPublishedTitle"), t("actions.pr.notPublished", { branch: source2 }), {
      confirmLabel: t("actions.pr.pushAndCreate"),
    });
    if (!ok) return;
    const pushed = await run("Push", () => api.push(path, newOpId(), source2, o.provider!.remote, false), { path });
    if (pushed === undefined) return;
  }
  const pr = await run(t("actions.pr.createBusy"), () =>
    api.pullRequestCreate(path, {
      title: String(v.title),
      body: String(v.body ?? ""),
      sourceBranch: source2,
      targetBranch: String(v.target),
      draft: !!v.draft,
    }), { path, success: (p) => t("actions.pr.created", { kind: isGh ? "PR" : "MR", number: p.number }) });
  if (pr) {
    loadPullRequests(path, true);
    openExternal(pr.webUrl);
  }
}

// ---------------------------------------------------------------- selection

export function selectCommit(path: string, hash: string) {
  S().patchRepo(path, (t) => ({
    selection: hash === "WIP" ? { kind: "wip" } : { kind: "commit", hash },
    view: t.view.kind === "conflict" ? t.view : { kind: "graph" },
  }));
}
