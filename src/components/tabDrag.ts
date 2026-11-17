import { useRef, useState } from "react";

/** Pixels the pointer must travel before a press on a tab becomes a drag. */
const THRESHOLD = 5;
/** Distance from the bar edges where dragging scrolls the bar. */
const EDGE = 40;

/**
 * Reorder the tabs of a bar by dragging them. Pointer events with capture, like the Splitter:
 * with Tauri's `dragDropEnabled` the webview handles file drops itself and HTML5 drag and drop
 * does not reach the page on Windows.
 *
 * The draggable tabs carry `data-tab={key}` and call `press` on pointerdown: a press released
 * before the pointer travels THRESHOLD pixels is a click (`onClick`); past it the tab is dragged,
 * an indicator shows where it will go and, on release, `onMove(key, index)` moves it. Nothing
 * else happens while dragging (no tab switch, no refresh); Escape cancels the drag.
 */
export function useTabDrag(onMove: (key: string, to: number) => void) {
  const barRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ key: string; x: number } | null>(null);

  const press = (e: React.PointerEvent<HTMLElement>, key: string, onClick: () => void) => {
    if (e.button !== 0) return;
    const bar = barRef.current;
    const el = e.currentTarget;
    const id = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    let lastX = startX;
    // Tab edges in the bar's scrolled content (stable while it scrolls); null until the drag starts.
    let slots: { key: string; left: number; right: number }[] | null = null;
    let gap = -1;
    let raf = 0;
    el.setPointerCapture(id);

    const contentX = (clientX: number) => clientX - bar!.getBoundingClientRect().left + bar!.scrollLeft;
    // Gap the pointer is over: 0 before the first tab, slots.length after the last one.
    const update = () => {
      const x = contentX(lastX);
      const g = slots!.filter((s) => (s.left + s.right) / 2 < x).length;
      if (g === gap) return;
      gap = g;
      setDrag({ key, x: g < slots!.length ? slots![g].left : slots![slots!.length - 1].right });
    };
    const autoScroll = () => {
      const r = bar!.getBoundingClientRect();
      const d = lastX < r.left + EDGE ? lastX - r.left - EDGE : lastX > r.right - EDGE ? lastX - r.right + EDGE : 0;
      if (d) {
        const before = bar!.scrollLeft;
        bar!.scrollLeft += Math.sign(d) * Math.min(16, Math.ceil(Math.abs(d) / 3));
        if (bar!.scrollLeft !== before) update();
      }
      raf = requestAnimationFrame(autoScroll);
    };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      lastX = ev.clientX;
      if (!slots) {
        if (!bar || (Math.abs(ev.clientX - startX) < THRESHOLD && Math.abs(ev.clientY - startY) < THRESHOLD)) return;
        const r = bar.getBoundingClientRect();
        slots = [...bar.querySelectorAll<HTMLElement>("[data-tab]")].map((n) => {
          const b = n.getBoundingClientRect();
          return { key: n.dataset.tab!, left: b.left - r.left + bar.scrollLeft, right: b.right - r.left + bar.scrollLeft };
        });
        document.body.classList.add("tab-dragging");
        raf = requestAnimationFrame(autoScroll);
      }
      update();
    };
    const finish = (drop: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", onKey, true);
      if (el.hasPointerCapture(id)) el.releasePointerCapture(id);
      if (!slots) {
        if (drop) onClick();
        return;
      }
      cancelAnimationFrame(raf);
      document.body.classList.remove("tab-dragging");
      setDrag(null);
      const from = slots.findIndex((s) => s.key === key);
      // Gaps after the dragged tab are one place further than the index it lands on.
      const to = gap > from ? gap - 1 : gap;
      if (drop && from >= 0 && to !== from) onMove(key, to);
    };
    const up = (ev: PointerEvent) => ev.pointerId === id && finish(true);
    const cancel = (ev: PointerEvent) => ev.pointerId === id && finish(false);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape" || !slots) return;
      ev.preventDefault();
      ev.stopPropagation();
      finish(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", onKey, true);
  };

  return { barRef, press, dragging: drag?.key ?? null, dropX: drag?.x ?? null };
}
