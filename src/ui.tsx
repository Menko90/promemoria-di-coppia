import { useEffect, useRef, type ReactNode } from "react";
import type { Person, Reminder } from "./api";
import { Close, FlameHeart, Home, Plus, RewardIcon, Send, rewardLabel } from "./icons";
import { dayLabel, hm } from "./time";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Sheet({ title, onClose, children, labelledBy }: {
  title?: string; onClose: () => void; children: ReactNode; labelledBy?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    ref.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="sheet-wrap">
      <div className="sheet-overlay" onClick={onClose} aria-hidden="true" />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={labelledBy ? undefined : title}
        aria-labelledby={labelledBy} tabIndex={-1} ref={ref}>
        <div className="sheet-handle" aria-hidden="true" />
        <button type="button" className="sheet-close" aria-label="Chiudi" onClick={onClose}><Close size={20} /></button>
        {children}
      </div>
    </div>
  );
}

export function Toast({ text, onDone }: { text: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3200);
    return () => clearTimeout(t);
  }, [text, onDone]);
  return <div className="toast" role="status">{text}</div>;
}

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string; disabled?: boolean }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value}
          disabled={o.disabled} className={cx(value === o.value && "on")} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chips<T extends string | number>({ value, options, onChange, label, cols, tone }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string;
  cols?: number; tone?: (v: T) => string | undefined;
}) {
  return (
    <div className="chips" role="radiogroup" aria-label={label}
      style={cols ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, display: "grid" } : undefined}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={value === o.value}
          className={cx("chip", value === o.value && "on", value === o.value && tone?.(o.value))}
          onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label}
      className={cx("switch", checked && "on")} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

export function DateTime({ idPrefix, label, date, time, onDate, onTime, minDate }: {
  idPrefix: string; label: string; date: string; time: string;
  onDate: (v: string) => void; onTime: (v: string) => void; minDate?: string;
}) {
  return (
    <div className="dt">
      <span className="dt-label" id={`${idPrefix}-l`}>{label}</span>
      <div className="dt-row">
        <input type="date" className="field dt-date" aria-label={`${label}: giorno`}
          value={date} min={minDate} onChange={(e) => onDate(e.target.value)} required />
        <input type="time" className="field dt-time" aria-label={`${label}: ora`}
          value={time} onChange={(e) => onTime(e.target.value)} required />
      </div>
    </div>
  );
}

export function RewardBadge({ r, detail, dark }: { r: Reminder; detail?: string; dark?: boolean }) {
  if (!r.reward) return null;
  if (r.reward === "speciale") {
    return (
      <span className="badge badge-special">
        <FlameHeart size={22} />
        {r.status === "done" ? "Premio speciale sbloccato" : "Premio speciale da sbloccare"}
      </span>
    );
  }
  return (
    <span className={cx("badge", dark ? "badge-onberry" : "badge-reward")}>
      <RewardIcon reward={r.reward} size={16} />
      {rewardLabel(r.reward)}{detail ? ` · ${detail}` : ""}
    </span>
  );
}

export function TimeBlock({ date, tone }: { date: Date; tone?: "amber" | "lilac" }) {
  return (
    <div className={cx("timeblock", tone === "lilac" && "lilac")} aria-hidden="true">
      <span>{dayLabel(date)}</span>
      <strong>{hm(date)}</strong>
    </div>
  );
}

export type View = "me" | "assigned";

export function BottomNav({ view, onView, onNew }: { view: View; onView: (v: View) => void; onNew: () => void }) {
  return (
    <nav className="bottom-nav" aria-label="Navigazione">
      <button type="button" className={cx("nav-item", view === "me" && "on")} aria-current={view === "me" ? "page" : undefined}
        onClick={() => onView("me")}>
        <Home size={24} />Per me
      </button>
      <button type="button" className="nav-fab" aria-label="Nuovo promemoria" onClick={onNew}><Plus size={30} /></button>
      <button type="button" className={cx("nav-item", view === "assigned" && "on")} aria-current={view === "assigned" ? "page" : undefined}
        onClick={() => onView("assigned")}>
        <Send size={24} />Ho assegnato
      </button>
    </nav>
  );
}

export function Avatar({ person, size = 40 }: { person: Person | null; size?: number }) {
  const initial = (person?.display_name || "?").slice(0, 1).toUpperCase();
  if (person?.avatar_url) {
    return <img className="avatar" src={person.avatar_url} alt="" width={size} height={size} referrerPolicy="no-referrer" />;
  }
  return <span className="avatar avatar-initial" style={{ width: size, height: size }} aria-hidden="true">{initial}</span>;
}

export function Banner({ tone = "amber", children, action }: { tone?: "amber" | "berry"; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={cx("banner", tone === "berry" && "banner-berry")} role="note">
      <div>{children}</div>
      {action}
    </div>
  );
}
