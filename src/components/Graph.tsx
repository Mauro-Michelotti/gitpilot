import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Cloud, Laptop, Pencil, Tag, CircleDot } from "lucide-react";
import * as A from "../actions";
import { commitMenu, localBranchMenu, remoteBranchMenu, tagMenu } from "../menus";
import type { RepoTab } from "../store";
import type { CommitRow, GraphLine, RefLabel, RepoOverview, StatusResult } from "../types";
import { fullDate, initials, laneColor, personColor, relativeTime } from "../util";

const ROW_H = 30;
const LANE_W = 20;
const PAD = 10;
const NODE_R = 9;

const x = (col: number) => PAD + col * LANE_W + LANE_W / 2;

function linePath(l: GraphLine) {
  const mid = ROW_H / 2;
  const x1 = x(l.from);
  const x2 = x(l.to);
  switch (l.kind) {
    case "pass":
      return `M${x1} 0V${ROW_H}`;
    case "top":
      return x1 === x2 ? `M${x1} 0V${mid}` : `M${x1} 0C${x1} ${mid * 0.9} ${x2} ${mid * 0.1} ${x2} ${mid}`;
    case "bottom":
      return x1 === x2 ? `M${x1} ${mid}V${ROW_H}` : `M${x1} ${mid}C${x1} ${mid + mid * 0.9} ${x2} ${mid + mid * 0.1} ${x2} ${ROW_H}`;
  }
}

interface Chip {
  key: string;
  label: string;
  kind: "local" | "remote" | "tag" | "head";
  local?: string;
  remote?: string;
  current: boolean;
}

/** Merge "main" + "origin/main" pointing to the same commit into one chip. */
function chipsFor(refs: RefLabel[], o: RepoOverview | null): Chip[] {
  const out: Chip[] = [];
  const remotes = new Set(refs.filter((r) => r.kind === "remote").map((r) => r.name));
  const used = new Set<string>();
  for (const r of refs) {
    if (r.kind === "local") {
      const up = o?.locals.find((b) => b.name === r.name)?.upstream ?? null;
      const together = up && remotes.has(up) ? up : null;
      if (together) used.add(together);
      out.push({ key: "l:" + r.name, label: r.name, kind: "local", local: r.name, remote: together ?? undefined, current: r.current });
    }
  }
  for (const r of refs) {
    if (r.kind === "remote" && !used.has(r.name)) out.push({ key: "r:" + r.name, label: r.name, kind: "remote", remote: r.name, current: false });
    if (r.kind === "tag") out.push({ key: "t:" + r.name, label: r.name, kind: "tag", current: false });
    if (r.kind === "head") out.push({ key: "h", label: "HEAD", kind: "head", current: true });
  }
  out.sort((a, b) => Number(b.current) - Number(a.current));
  return out;
}

const Row = memo(function Row({
  row,
  top,
  selected,
  wipColor,
  width,
  overview,
  status,
  path,
  showAvatars,
}: {
  row: CommitRow;
  top: number;
  selected: boolean;
  wipColor: number | null;
  width: number;
  overview: RepoOverview | null;
  status: StatusResult | null;
  path: string;
  showAvatars: boolean;
}) {
  const g = row.graph;
  const cx = x(g.col);
  const cy = ROW_H / 2;
  const color = laneColor(g.color);
  const chips = chipsFor(row.refs, overview);
  const isMerge = row.parents.length > 1;

  const onChipDouble = (c: Chip) => {
    if (c.kind === "local" && c.local && !c.current) A.checkoutBranch(path, c.local);
    else if (c.kind === "remote" && c.remote) A.checkoutRemote(path, c.remote);
  };
  const onChipMenu = (e: React.MouseEvent, c: Chip) => {
    if (!overview) return;
    if (c.kind === "local" && c.local) A.showMenu(e, localBranchMenu(path, overview, c.local));
    else if (c.kind === "remote" && c.remote) A.showMenu(e, remoteBranchMenu(path, overview, c.remote));
    else if (c.kind === "tag") A.showMenu(e, tagMenu(path, overview, c.label));
  };

  const counts = status ? { staged: status.staged.length, unstaged: status.unstaged.length, conflicts: status.conflicted.length } : null;

  return (
    <div
      className={`gr${selected ? " selected" : ""}${row.wip ? " wip" : ""}`}
      style={{ top, height: ROW_H, ["--lane" as string]: color }}
      onMouseDown={() => A.selectCommit(path, row.hash)}
      onContextMenu={(e) => {
        A.selectCommit(path, row.hash);
        if (overview && !row.wip) A.showMenu(e, commitMenu(path, overview, row.hash, row.subject));
      }}
    >
      <div className="gcol-refs">
        {chips.slice(0, 2).map((c) => (
          <span
            key={c.key}
            className={`chip chip-${c.kind}${c.current ? " current" : ""}`}
            style={{ ["--chip" as string]: color }}
            title={c.remote && c.local ? `${c.local} ↔ ${c.remote}` : c.label}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onChipDouble(c);
            }}
            onContextMenu={(e) => onChipMenu(e, c)}
          >
            {c.current && <Check size={11} strokeWidth={3} />}
            {c.local && <Laptop size={11} />}
            {c.remote && <Cloud size={11} />}
            {c.kind === "tag" && <Tag size={11} />}
            {c.kind === "head" && <CircleDot size={11} />}
            <span className="chip-label">{c.label}</span>
          </span>
        ))}
        {chips.length > 2 && (
          <span className="chip chip-more" title={chips.slice(2).map((c) => c.label).join("\n")}>
            +{chips.length - 2}
          </span>
        )}
        {chips.length > 0 && <span className="chip-link" style={{ background: color }} />}
      </div>
      <svg className="gcol-graph" width={width} height={ROW_H}>
        {g.lines.map((l, i) => (
          <path
            key={i}
            d={linePath(l)}
            stroke={laneColor(l.color)}
            strokeWidth={2}
            fill="none"
            strokeDasharray={wipColor !== null && l.color === wipColor ? "3 3" : undefined}
          />
        ))}
        {row.wip ? (
          <circle cx={cx} cy={cy} r={NODE_R - 1} fill="var(--bg)" stroke={color} strokeWidth={2} strokeDasharray="3 2" />
        ) : isMerge ? (
          <circle cx={cx} cy={cy} r={5} fill={color} stroke="var(--bg)" strokeWidth={1.5} />
        ) : showAvatars ? (
          <g>
            <circle cx={cx} cy={cy} r={NODE_R} fill={personColor(row.email || row.author)} stroke={color} strokeWidth={2.5} />
            <text x={cx} y={cy + 3.2} textAnchor="middle" className="node-initials">
              {initials(row.author)}
            </text>
          </g>
        ) : (
          <circle cx={cx} cy={cy} r={6} fill={color} stroke="var(--bg)" strokeWidth={1.5} />
        )}
      </svg>
      <div className="gcol-msg">
        {row.wip ? (
          <>
            <Pencil size={13} className="muted" />
            <span className="wip-label">// WIP</span>
            {counts && (
              <span className="wip-counts">
                {counts.conflicts > 0 && <span className="badge badge-danger">{counts.conflicts} conflitti</span>}
                {counts.unstaged > 0 && <span className="badge">{counts.unstaged} modificati</span>}
                {counts.staged > 0 && <span className="badge badge-ok">{counts.staged} in stage</span>}
              </span>
            )}
          </>
        ) : (
          <span className={isMerge ? "msg merge" : "msg"}>{row.subject}</span>
        )}
      </div>
      <div className="gcol-author" title={row.email}>
        {!row.wip && row.author}
      </div>
      <div className="gcol-date" title={row.wip ? "" : fullDate(row.time)}>
        {!row.wip && relativeTime(row.time)}
      </div>
      <div className="gcol-sha mono">{!row.wip && row.hash.slice(0, 7)}</div>
    </div>
  );
});

export function Graph({ tab }: { tab: RepoTab }) {
  const graph = tab.graph;
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);
  const showAvatars = true;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const rows = graph?.rows ?? [];
  const lanes = Math.max(1, Math.min(graph?.lanes ?? 1, 14));
  const width = PAD * 2 + lanes * LANE_W;
  const wipColor = rows[0]?.wip ? rows[0].graph.color : null;
  const selectedHash = tab.selection?.kind === "wip" ? "WIP" : tab.selection?.kind === "commit" ? tab.selection.hash : null;
  const selectedIndex = useMemo(() => rows.findIndex((r) => r.hash === selectedHash), [rows, selectedHash]);

  // Keep the selected row visible when selection changes programmatically.
  useEffect(() => {
    const el = ref.current;
    if (!el || selectedIndex < 0) return;
    const top = selectedIndex * ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight;
  }, [selectedIndex]);

  const onKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const next = Math.max(0, Math.min(rows.length - 1, selectedIndex + (e.key === "ArrowDown" ? 1 : -1)));
      if (rows[next]) A.selectCommit(tab.path, rows[next].hash);
    },
    [rows, selectedIndex, tab.path],
  );

  const overscan = 10;
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - overscan);
  const end = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW_H) + overscan);

  return (
    <div className="graph" style={{ ["--graph-w" as string]: `${width}px` }}>
      <div className="graph-head">
        <div className="gcol-refs">Branch / tag</div>
        <div className="gcol-graph" style={{ width }}>
          Grafo
        </div>
        <div className="gcol-msg">Messaggio</div>
        <div className="gcol-author">Autore</div>
        <div className="gcol-date">Data</div>
        <div className="gcol-sha">SHA</div>
      </div>
      <div
        className="graph-body"
        ref={ref}
        tabIndex={0}
        onKeyDown={onKey}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        <div style={{ height: rows.length * ROW_H + (graph?.truncated ? 48 : 0), position: "relative" }}>
          {rows.slice(start, end).map((row, i) => (
            <Row
              key={row.hash}
              row={row}
              top={(start + i) * ROW_H}
              selected={row.hash === selectedHash}
              wipColor={wipColor}
              width={width}
              overview={tab.overview}
              status={row.wip ? tab.status : null}
              path={tab.path}
              showAvatars={showAvatars}
            />
          ))}
          {graph?.truncated && (
            <div className="graph-more" style={{ top: rows.length * ROW_H }}>
              <button className="btn" onClick={() => A.loadMoreCommits(tab.path)}>
                Mostra altri commit
              </button>
            </div>
          )}
        </div>
        {!tab.loading && rows.length === 0 && (
          <div className="empty">
            <p>Nessun commit ancora.</p>
            <p className="muted">Aggiungi dei file e crea il primo commit dal pannello a destra.</p>
          </div>
        )}
      </div>
    </div>
  );
}
