import { useEffect, useState } from "react";
import type { CompleteResult, CoupleInfo, Reminder } from "./api";
import { api } from "./api";
import { Check, Clock, FlameHeart, RewardIcon, Share, rewardLabel } from "./icons";
import { postponePresets, shiftedEnd } from "./logic";
import { enablePush, isIOS, isStandalone, pushState, type PushState } from "./push";
import { InfoRows, type Data } from "./screens";
import { fromInputs, toDateInput, toTimeInput, whenLabel } from "./time";
import { Avatar, cx, DateTime, RewardBadge, Sheet } from "./ui";

export function PostponeSheet({ r, onClose, onSave }: {
  r: Reminder; onClose: () => void; onSave: (start: Date, end: Date | null, note: string) => Promise<void>;
}) {
  const presets = postponePresets(r, new Date());
  const first = presets.find((p) => p.id === "domani") ?? presets[0];
  const [chosen, setChosen] = useState<string>(first.id);
  const [sDate, setSDate] = useState(toDateInput(first.start));
  const [sTime, setSTime] = useState(toTimeInput(first.start));
  const firstEnd = shiftedEnd(r, first.start);
  const [eDate, setEDate] = useState(firstEnd ? toDateInput(firstEnd) : "");
  const [eTime, setETime] = useState(firstEnd ? toTimeInput(firstEnd) : "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const pick = (id: string, start: Date) => {
    setChosen(id);
    setSDate(toDateInput(start));
    setSTime(toTimeInput(start));
    const e = shiftedEnd(r, start);
    if (e) {
      setEDate(toDateInput(e));
      setETime(toTimeInput(e));
    }
  };

  async function save() {
    setError(null);
    const start = fromInputs(sDate, sTime);
    const end = r.end_at ? fromInputs(eDate, eTime) : null;
    if (!start || start.getTime() < Date.now() - 60_000) return setError("Scegli un orario nel futuro.");
    if (r.end_at && (!end || end <= start)) return setError("La nuova fine deve venire dopo il nuovo inizio.");
    setSaving(true);
    try {
      await onSave(start, end, note.trim());
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <Sheet onClose={onClose} labelledBy="titoloRinvio">
      <h2 id="titoloRinvio" className="sheet-title">Quando potrai farlo?</h2>
      <p className="sheet-sub">{r.title} · ripetizioni e priorità restano come sono</p>
      <div className="chips wrap" role="radiogroup" aria-label="Proposte">
        {presets.map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={chosen === p.id}
            className={cx("chip", chosen === p.id && "on")} onClick={() => pick(p.id, p.start)}>{p.label}</button>
        ))}
        <button type="button" role="radio" aria-checked={chosen === "scegli"}
          className={cx("chip", chosen === "scegli" && "on")} onClick={() => setChosen("scegli")}>Scegli data</button>
      </div>
      <DateTime idPrefix="rinvio-inizio" label="Nuovo inizio" date={sDate} time={sTime}
        onDate={(v) => { setSDate(v); setChosen("scegli"); }} onTime={(v) => { setSTime(v); setChosen("scegli"); }} />
      {r.end_at && (
        <DateTime idPrefix="rinvio-fine" label="Nuova fine" date={eDate} time={eTime}
          onDate={(v) => { setEDate(v); setChosen("scegli"); }} onTime={(v) => { setETime(v); setChosen("scegli"); }} />
      )}
      <div className="field-group">
        <label htmlFor="nota" className="label small">
          {r.created_by !== r.assigned_to ? "Nota per il partner" : "Nota"} <span className="muted">(facoltativa)</span>
        </label>
        <textarea id="nota" className="field" rows={2} maxLength={280} value={note}
          placeholder="Es. sono al lavoro, lo faccio appena esco" onChange={(e) => setNote(e.target.value)} />
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="sheet-actions">
        <button type="button" className="btn-ghost" onClick={onClose}>Annulla</button>
        <button type="button" className="btn-primary" onClick={save} disabled={saving}>
          <Clock size={20} />{saving ? "Salvo…" : "Rimanda"}
        </button>
      </div>
    </Sheet>
  );
}

export function DetailSheet({ r, data, now, onClose, onDone, onPostpone }: {
  r: Reminder; data: Data; now: number; onClose: () => void; onDone: () => void; onPostpone: () => void;
}) {
  return (
    <Sheet onClose={onClose} labelledBy="titoloDettaglio">
      <h2 id="titoloDettaglio" className="sheet-title">{r.title}</h2>
      <InfoRows r={r} now={now} />
      {r.reward && <div><RewardBadge r={r} detail={r.reward !== "speciale" ? data.rewards[r.id] : undefined} /></div>}
      {r.status === "pending" && (
        <div className="sheet-actions">
          <button type="button" className="btn-ghost" onClick={onPostpone}>Non posso ora</button>
          <button type="button" className="btn-primary" onClick={onDone}><Check size={20} />Fatto</button>
        </div>
      )}
    </Sheet>
  );
}

export function Reveal({ result, onClose }: { result: CompleteResult; onClose: () => void }) {
  const special = result.reward === "speciale";
  useEffect(() => {
    navigator.vibrate?.(special ? [60, 40, 120] : 40);
  }, [special]);
  return (
    <div className={cx("reveal", special ? "reveal-special" : "reveal-normal")} role="dialog" aria-modal="true" aria-labelledby="revealTitle">
      <div className="reveal-glow" aria-hidden="true">
        {special ? <FlameHeart size={170} /> : <span className="reveal-icon">{result.reward && <RewardIcon reward={result.reward} size={72} />}</span>}
      </div>
      <span className="eyebrow">{special ? "PREMIO SPECIALE SBLOCCATO" : "PREMIO GUADAGNATO"}</span>
      <h1 id="revealTitle">{special ? "Te lo sei meritato" : rewardLabel(result.reward!)}</h1>
      <p className="reveal-sub">Hai completato: {result.title}</p>
      <div className="reveal-card">
        <span className="eyebrow">IL TUO PREMIO</span>
        <span className="reveal-detail">{result.reward_detail || (special ? "Il partner non ha scritto i dettagli: chiediglieli tu 😉" : rewardLabel(result.reward!))}</span>
      </div>
      <button type="button" className="reveal-btn" onClick={onClose} autoFocus>Che bello!</button>
    </div>
  );
}

export function SettingsSheet({ info, onClose, onChanged, onLogout, onInvite }: {
  info: CoupleInfo; onClose: () => void; onChanged: (msg?: string) => void; onLogout: () => void; onInvite: () => void;
}) {
  const [state, setState] = useState<PushState>(pushState());
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(info.me.display_name);
  const [msg, setMsg] = useState<string | null>(null);
  const [log, setLog] = useState<Awaited<ReturnType<typeof api.pushLog>> | null>(null);

  async function enable() {
    setBusy(true);
    setMsg(null);
    try {
      const s = await enablePush();
      setState(s);
      if (s === "granted") {
        setMsg("Notifiche attive su questo telefono.");
        onChanged();
      } else if (s === "denied") {
        setMsg("Le notifiche sono bloccate: sbloccale dalle impostazioni del browser (lucchetto accanto all'indirizzo → Notifiche → Consenti).");
      }
    } catch (e) {
      setMsg((e as Error).message);
    }
    setBusy(false);
  }

  async function test() {
    setBusy(true);
    try {
      const n = await api.testPush();
      await api.kick();
      setMsg(n > 0 ? "Prova inviata: dovrebbe arrivare entro pochi secondi." : "Nessun telefono registrato: attiva prima le notifiche.");
    } catch (e) {
      setMsg((e as Error).message);
    }
    setBusy(false);
  }

  async function saveName() {
    if (name.trim() === info.me.display_name) return;
    try {
      await api.setName(name);
      onChanged("Nome aggiornato");
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  const partner = info.partner;
  return (
    <Sheet onClose={onClose} labelledBy="titoloImpostazioni">
      <h2 id="titoloImpostazioni" className="sheet-title">Notifiche e account</h2>

      <section className="set-block">
        <h3 className="label">Notifiche su questo telefono</h3>
        {state === "granted" && <p className="ok-line"><Check size={18} />Attive</p>}
        {state === "default" && <p className="hint">Non ancora attivate.</p>}
        {state === "denied" && <p className="hint">Bloccate dal browser: sbloccale dal lucchetto accanto all'indirizzo → Notifiche → Consenti, poi riprova.</p>}
        {state === "needs-install" && (
          <p className="hint">Su iPhone le notifiche funzionano solo dall'app installata: tocca Condividi <Share size={14} /> → «Aggiungi alla schermata Home», poi apri l'app da lì.</p>
        )}
        {state === "unsupported" && <p className="hint">Questo browser non supporta le notifiche. Usa Chrome su Android o Safari su iPhone.</p>}
        <div className="set-actions">
          {state !== "granted" && state !== "unsupported" && state !== "needs-install" && (
            <button type="button" className="btn-primary" onClick={enable} disabled={busy}>Attiva notifiche</button>
          )}
          {state === "granted" && (
            <>
              <button type="button" className="btn-ghost" onClick={enable} disabled={busy}>Registra di nuovo</button>
              <button type="button" className="btn-primary" onClick={test} disabled={busy}>Invia una prova</button>
            </>
          )}
        </div>
        {!isStandalone() && !isIOS() && (
          <p className="hint">Consiglio: installa l'app dal menu ⋮ di Chrome → «Installa app», così le notifiche sono più affidabili.</p>
        )}
        {msg && <p className="info-msg" role="status">{msg}</p>}
      </section>

      <section className="set-block">
        <h3 className="label">Partner</h3>
        {partner ? (
          <div className="person">
            <Avatar person={partner} />
            <div>
              <strong>{partner.display_name}</strong>
              <span className="hint">{partner.push_devices > 0 ? `Notifiche attive su ${partner.push_devices} ${partner.push_devices === 1 ? "telefono" : "telefoni"}` : "Notifiche non ancora attivate"}</span>
            </div>
          </div>
        ) : (
          <button type="button" className="btn-ghost" onClick={onInvite}>Invita il partner</button>
        )}
      </section>

      <section className="set-block">
        <label htmlFor="nome" className="label">Il tuo nome</label>
        <div className="inline-field">
          <input id="nome" className="field" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onBlur={saveName} />
        </div>
      </section>

      <details className="set-block" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && !log) api.pushLog().then(setLog).catch(() => setLog([])); }}>
        <summary className="label">Ultimi invii verso questo account</summary>
        {log === null ? <p className="hint">Carico…</p> : log.length === 0 ? <p className="hint">Nessun invio registrato.</p> : (
          <ul className="log">
            {log.map((l, i) => (
              <li key={i} className={l.ok ? "ok" : "ko"}>
                {whenLabel(new Date(l.created_at))} · {l.kind} · {l.ok ? "consegnata" : l.error ?? `errore ${l.status}`}
              </li>
            ))}
          </ul>
        )}
      </details>

      <button type="button" className="btn-link" onClick={onLogout}>Esci</button>
    </Sheet>
  );
}

export function InviteSheet({ info, onClose, onChanged }: { info: CoupleInfo; onClose: () => void; onChanged: () => void }) {
  const [code, setCode] = useState(info.couple?.invite_code ?? "");
  const [joinCode, setJoinCode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!code) api.createCouple().then((c) => { setCode(c); onChanged(); }).catch((e) => setMsg(e.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const link = `${location.origin}/?invito=${code}`;
  async function share() {
    const text = `Scarica la nostra app dei promemoria e collegati a me: ${link}`;
    try {
      if (navigator.share) await navigator.share({ title: "Promemoria di Coppia", text, url: link });
      else {
        await navigator.clipboard.writeText(link);
        setMsg("Link copiato: incollalo nella chat con il partner.");
      }
    } catch {
      // condivisione annullata
    }
  }
  async function join() {
    setBusy(true);
    setMsg(null);
    try {
      await api.joinCouple(joinCode);
      onChanged();
      onClose();
    } catch (e) {
      setMsg((e as Error).message);
    }
    setBusy(false);
  }
  return (
    <Sheet onClose={onClose} labelledBy="titoloInvito">
      <h2 id="titoloInvito" className="sheet-title">Collega il partner</h2>
      <p className="sheet-sub">Manda questo link al partner: apre l'app e vi collega in automatico.</p>
      <div className="code-box" aria-label="Codice di invito">{code || "……"}</div>
      <button type="button" className="btn-primary" onClick={share} disabled={!code}><Share size={20} />Condividi il link</button>
      <div className="divider"><span>oppure</span></div>
      <label htmlFor="codice" className="label small">Hai ricevuto un codice?</label>
      <div className="inline-field">
        <input id="codice" className="field code-input" value={joinCode} maxLength={8} autoCapitalize="characters"
          placeholder="ABC123" onChange={(e) => setJoinCode(e.target.value.toUpperCase())} />
        <button type="button" className="btn-ghost" onClick={join} disabled={busy || joinCode.trim().length < 6}>Collegati</button>
      </div>
      {msg && <p className="info-msg" role="status">{msg}</p>}
    </Sheet>
  );
}
