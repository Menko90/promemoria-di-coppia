import type { CoupleInfo, Reminder } from "./api";
import { Alert, Calendar, Check, Clock, Message, Repeat, Send, Trash } from "./icons";
import { assignedStatus, isActive, nextNotification, pickFocus, recurrenceLabel, STATUS_LABEL } from "./logic";
import { duration, hm, whenLabel, windowLabel } from "./time";
import { Banner, cx, RewardBadge, TimeBlock } from "./ui";

export interface Data {
  info: CoupleInfo;
  reminders: Reminder[];
  rewards: Record<string, string>;
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

const PRIORITY_CHIP: Record<string, string> = { urgente: "URGENTE", normale: "NORMALE", quando_puoi: "QUANDO PUOI" };

function fromLabel(r: Reminder, data: Data): string {
  if (r.created_by === r.assigned_to) return "Promemoria per te";
  const p = data.info.partner;
  return r.created_by === data.info.me.id ? `Per ${p?.display_name ?? "il partner"}` : `Da ${p?.display_name ?? "partner"}`;
}

export function InfoRows({ r, now, light }: { r: Reminder; now: number; light?: boolean }) {
  const next = nextNotification(r, now);
  const rec = recurrenceLabel(r);
  const start = new Date(r.start_at);
  const end = r.end_at ? new Date(r.end_at) : null;
  return (
    <div className={cx("info", light && "info-light")}>
      <span><Clock size={18} />{windowLabel(start, end, new Date(now))}</span>
      {r.repeat_minutes > 0 && (
        <span><Repeat size={18} />Ripete ogni {r.repeat_minutes} min{next && next > now ? ` · prossimo alle ${hm(new Date(next))}` : ""}</span>
      )}
      {rec && <span><Calendar size={18} />{rec}</span>}
    </div>
  );
}

function Progress({ r, now }: { r: Reminder; now: number }) {
  const start = new Date(r.start_at).getTime();
  if (start > now) {
    return <p className="focus-note">Inizia tra {duration(start - now)}</p>;
  }
  if (!r.end_at) return null;
  const end = new Date(r.end_at).getTime();
  const pct = Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100));
  return (
    <div className="progress">
      <div className="progress-labels">
        <span>{hm(new Date(start))}</span>
        <span>Mancano {duration(end - now)}</span>
        <span>{hm(new Date(end))}</span>
      </div>
      <div className="progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}
        aria-label="Tempo passato">
        <div style={{ width: `${Math.max(3, pct)}%` }} />
      </div>
    </div>
  );
}

export function FocusCard({ r, data, now, onDone, onPostpone, busy }: {
  r: Reminder; data: Data; now: number; onDone: () => void; onPostpone: () => void; busy: boolean;
}) {
  return (
    <section className="focus" aria-label={isActive(r, now) ? "Da fare adesso" : "Prossimo promemoria"}>
      <div className="focus-top">
        <span className={cx("focus-chip", r.priority === "urgente" && "urgent")}>{PRIORITY_CHIP[r.priority]}</span>
        <span className="focus-from">{fromLabel(r, data)}</span>
      </div>
      <h2 className="focus-title">{r.title}</h2>
      <InfoRows r={r} now={now} light />
      {r.postponed_at && r.postpone_note && <p className="focus-note">Hai rimandato: «{r.postpone_note}»</p>}
      <Progress r={r} now={now} />
      {r.reward && <div><RewardBadge r={r} detail={r.reward !== "speciale" ? data.rewards[r.id] : undefined} dark /></div>}
      <div className="focus-actions">
        <button type="button" className="btn-done" onClick={onDone} disabled={busy}><Check size={20} />Fatto</button>
        <button type="button" className="btn-later" onClick={onPostpone} disabled={busy}>Non posso ora</button>
      </div>
    </section>
  );
}

export function ReminderRow({ r, data, onOpen }: { r: Reminder; data: Data; onOpen: () => void }) {
  const start = new Date(r.start_at);
  const end = r.end_at ? new Date(r.end_at) : null;
  const sub = [
    end ? `Fino alle ${hm(end)}` : r.repeat_minutes ? null : "Una sola notifica",
    r.repeat_minutes ? `ogni ${r.repeat_minutes} min` : null,
    recurrenceLabel(r)?.toLowerCase(),
    r.created_by !== r.assigned_to ? lowerFirst(fromLabel(r, data)) : null,
  ].filter(Boolean).join(" · ");
  return (
    <button type="button" className="row" onClick={onOpen}>
      <TimeBlock date={start} tone={r.priority === "urgente" ? undefined : "lilac"} />
      <span className="row-main">
        <span className="row-title">{r.title}</span>
        <span className="row-sub">{sub}</span>
        {r.reward && <RewardBadge r={r} detail={r.reward !== "speciale" ? data.rewards[r.id] : undefined} />}
      </span>
    </button>
  );
}

export function PerMe({ data, now, onDone, onPostpone, onOpen, onEnablePush, pushOk, busy }: {
  data: Data; now: number; busy: boolean; pushOk: boolean;
  onDone: (r: Reminder) => void; onPostpone: (r: Reminder) => void; onOpen: (r: Reminder) => void; onEnablePush: () => void;
}) {
  const mine = data.reminders.filter((r) => r.assigned_to === data.info.me.id);
  const pending = mine.filter((r) => r.status === "pending");
  const focus = pickFocus(pending, now);
  const rest = pending.filter((r) => r.id !== focus?.id)
    .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
  const today = new Date(now).toDateString();
  const doneToday = mine.filter((r) => r.status === "done" && r.done_at && new Date(r.done_at).toDateString() === today);

  return (
    <div className="screen">
      {!pushOk && (
        <Banner tone="berry" action={<button type="button" className="banner-btn" onClick={onEnablePush}>Attiva</button>}>
          <strong>Notifiche spente su questo telefono.</strong> Attivale per ricevere i promemoria.
        </Banner>
      )}
      {focus ? (
        <FocusCard r={focus} data={data} now={now} busy={busy} onDone={() => onDone(focus)} onPostpone={() => onPostpone(focus)} />
      ) : (
        <section className="empty">
          <div className="empty-mark"><Check size={34} /></div>
          <h2>Tutto fatto!</h2>
          <p>Non hai promemoria in sospeso. Goditi il momento.</p>
        </section>
      )}
      {rest.length > 0 && (
        <section className="list" aria-label="Più tardi">
          <h3 className="section-title">PIÙ TARDI</h3>
          {rest.map((r) => <ReminderRow key={r.id} r={r} data={data} onOpen={() => onOpen(r)} />)}
        </section>
      )}
      {doneToday.length > 0 && (
        <section className="list" aria-label="Fatti oggi">
          <h3 className="section-title">FATTI OGGI</h3>
          {doneToday.map((r) => (
            <div key={r.id} className="row row-done">
              <span className="done-dot" aria-hidden="true"><Check size={16} /></span>
              <span className="row-main">
                <span className="row-title">{r.title}</span>
                <span className="row-sub">Fatto alle {hm(new Date(r.done_at!))}</span>
              </span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

const PILL_CLASS: Record<string, string> = {
  fatto: "pill-green", scaduto: "pill-red", rimandato: "pill-amber", letto: "pill-lilac",
  non_letto: "pill-lilac", programmato: "pill-grey",
};

export function AssignedCard({ r, data, now, onDelete }: { r: Reminder; data: Data; now: number; onDelete: () => void }) {
  const st = assignedStatus(r, now);
  const start = new Date(r.start_at);
  const end = r.end_at ? new Date(r.end_at) : null;
  const facts = [
    r.read_at && `Letto ${whenLabel(new Date(r.read_at), new Date(now))}`,
    r.repeat_minutes ? `ogni ${r.repeat_minutes} min` : null,
    r.priority === "urgente" ? "urgente" : null,
    recurrenceLabel(r)?.toLowerCase(),
  ].filter(Boolean).join(" · ");
  return (
    <article className="card">
      <div className="card-top">
        <span className="card-title">{r.title}</span>
        <span className={cx("pill", PILL_CLASS[st])}>{st === "fatto" && <Check size={13} />}{STATUS_LABEL[st]}</span>
      </div>
      {r.status === "done" ? (
        <span className="card-line"><Check size={17} />Fatto {whenLabel(new Date(r.done_at!), new Date(now))}</span>
      ) : (
        <span className="card-line"><Clock size={17} />
          {st === "rimandato" ? "Nuovo orario: " : ""}{windowLabel(start, end, new Date(now))}
        </span>
      )}
      {r.postponed_at && r.postpone_note && r.status !== "done" && (
        <div className="note"><Message size={17} /><span>“{r.postpone_note}”</span></div>
      )}
      {r.reward && <div><RewardBadge r={r} detail={r.reward !== "speciale" ? data.rewards[r.id] : undefined} /></div>}
      <div className="card-foot">
        <span>{facts}</span>
        <button type="button" className="icon-btn" aria-label={`Elimina «${r.title}»`} onClick={onDelete}><Trash size={18} /></button>
      </div>
    </article>
  );
}

export function Assigned({ data, now, onDelete, onInvite }: {
  data: Data; now: number; onDelete: (r: Reminder) => void; onInvite: () => void;
}) {
  const me = data.info.me.id;
  const mine = data.reminders.filter((r) => r.created_by === me && r.assigned_to !== me);
  const open = mine.filter((r) => r.status === "pending")
    .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
  const closed = mine.filter((r) => r.status !== "pending")
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  const partner = data.info.partner;

  if (!partner) {
    return (
      <div className="screen">
        <section className="empty">
          <div className="empty-mark"><Send size={30} /></div>
          <h2>Manca il partner</h2>
          <p>Invita il tuo partner per assegnargli promemoria.</p>
          <button type="button" className="btn-primary" onClick={onInvite}>Invita il partner</button>
        </section>
      </div>
    );
  }
  return (
    <div className="screen">
      {partner.push_devices === 0 && (
        <Banner>
          <Alert size={18} /> <strong>{partner.display_name} non ha ancora attivato le notifiche</strong>: vedrà i promemoria solo aprendo l'app.
        </Banner>
      )}
      {open.length === 0 && closed.length === 0 && (
        <section className="empty">
          <div className="empty-mark"><Send size={30} /></div>
          <h2>Nessun promemoria inviato</h2>
          <p>Tocca + per mandarne uno a {partner.display_name}.</p>
        </section>
      )}
      {open.length > 0 && (
        <section className="list" aria-label="In corso">
          <h3 className="section-title">IN CORSO</h3>
          {open.map((r) => <AssignedCard key={r.id} r={r} data={data} now={now} onDelete={() => onDelete(r)} />)}
        </section>
      )}
      {closed.length > 0 && (
        <section className="list" aria-label="Conclusi">
          <h3 className="section-title">CONCLUSI</h3>
          {closed.map((r) => <AssignedCard key={r.id} r={r} data={data} now={now} onDelete={() => onDelete(r)} />)}
        </section>
      )}
    </div>
  );
}
