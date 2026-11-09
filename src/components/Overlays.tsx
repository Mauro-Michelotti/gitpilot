import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { CircleCheck, CircleX, FolderOpen, Info, TriangleAlert, X } from "lucide-react";
import { dismissToast } from "../actions";
import { useStore, type PromptValues } from "../store";

export function ContextMenu() {
  const menu = useStore((s) => s.menu);
  const set = useStore((s) => s.set);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const x = Math.min(menu.x, window.innerWidth - r.width - 6);
    const y = menu.y + r.height > window.innerHeight - 6 ? Math.max(6, menu.y - r.height) : menu.y;
    setPos({ x: Math.max(6, x), y });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const close = () => set({ menu: null });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
    };
  }, [menu, set]);

  if (!menu) return null;
  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.items.map((it, i) =>
        it.separator ? (
          <div key={i} className="menu-sep" />
        ) : (
          <button
            key={i}
            className={`menu-item${it.danger ? " danger" : ""}`}
            disabled={it.disabled}
            onClick={() => {
              set({ menu: null });
              it.action?.();
            }}
          >
            <span className="menu-icon">{it.icon}</span>
            <span className="menu-label">{it.label}</span>
            {it.hint && <span className="menu-hint">{it.hint}</span>}
          </button>
        ),
      )}
    </div>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const icon = { info: <Info size={16} />, success: <CircleCheck size={16} />, error: <CircleX size={16} />, warning: <TriangleAlert size={16} /> };
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} role="status">
          <span className="toast-icon">{icon[t.kind]}</span>
          <span className="toast-text">{t.text}</span>
          <button className="icon-btn" onClick={() => dismissToast(t.id)} aria-label="Chiudi">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function Modal({
  title,
  children,
  footer,
  onClose,
  width = 520,
}: {
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" style={{ width }} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Chiudi">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function PromptDialog() {
  const spec = useStore((s) => s.prompt);
  const [values, setValues] = useState<PromptValues>({});
  const firstRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null>(null);

  useEffect(() => {
    if (!spec) return;
    const v: PromptValues = {};
    for (const f of spec.fields) v[f.name] = f.value ?? (f.type === "checkbox" ? false : "");
    setValues(v);
    setTimeout(() => {
      const el = firstRef.current;
      el?.focus();
      if (el instanceof HTMLInputElement) el.select();
    }, 0);
  }, [spec]);

  if (!spec) return null;
  const missing = spec.fields.some((f) => f.required && !String(values[f.name] ?? "").trim());
  const submit = () => {
    if (!missing) spec.resolve(values);
  };
  const setField = (name: string, v: string | boolean) => setValues((s) => ({ ...s, [name]: v }));
  let focusAssigned = false;
  const refFor = (type?: string) => {
    if (focusAssigned || type === "checkbox") return undefined;
    focusAssigned = true;
    return (el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null) => {
      firstRef.current = el;
    };
  };

  return (
    <Modal
      title={spec.title}
      onClose={() => spec.resolve(null)}
      footer={
        <>
          {!spec.alert && (
            <button className="btn" onClick={() => spec.resolve(null)}>
              Annulla
            </button>
          )}
          <button className={`btn ${spec.danger ? "btn-danger" : "btn-primary"}`} disabled={missing} onClick={submit}>
            {spec.confirmLabel ?? "OK"}
          </button>
        </>
      }
    >
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit();
        }}
      >
        {spec.message && <div className="form-message">{spec.message}</div>}
        {spec.fields.map((f) => {
          const val = values[f.name];
          if (f.type === "checkbox") {
            return (
              <label key={f.name} className="check">
                <input type="checkbox" checked={!!val} onChange={(e) => setField(f.name, e.target.checked)} />
                <span>{f.label}</span>
              </label>
            );
          }
          return (
            <label key={f.name} className="field">
              <span className="field-label">{f.label}</span>
              {f.type === "textarea" ? (
                <textarea
                  ref={refFor(f.type)}
                  rows={4}
                  value={String(val ?? "")}
                  placeholder={f.placeholder}
                  onChange={(e) => setField(f.name, e.target.value)}
                />
              ) : f.type === "select" ? (
                <select ref={refFor(f.type)} value={String(val ?? "")} onChange={(e) => setField(f.name, e.target.value)}>
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="input-row">
                  <input
                    ref={refFor(f.type)}
                    className={f.mono ? "mono" : undefined}
                    type={f.type === "password" ? "password" : "text"}
                    value={String(val ?? "")}
                    placeholder={f.placeholder}
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="off"
                    onChange={(e) => setField(f.name, e.target.value)}
                  />
                  {f.type === "folder" && (
                    <button
                      type="button"
                      className="btn"
                      onClick={async () => {
                        const d = await openDialog({ directory: true, defaultPath: String(val || "") || undefined });
                        if (typeof d === "string") setField(f.name, d);
                      }}
                    >
                      <FolderOpen size={14} /> Sfoglia
                    </button>
                  )}
                </div>
              )}
              {f.help && <span className="field-help">{f.help}</span>}
            </label>
          );
        })}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
