import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, supabase, type CompleteResult, type CoupleInfo, type NewReminder as NewData, type Reminder } from "./api";
import { Bell } from "./icons";
import { NewReminder } from "./NewReminder";
import { pushState, registerServiceWorker, syncPush, enablePush } from "./push";
import { Assigned, PerMe, type Data } from "./screens";
import { DetailSheet, InviteSheet, PostponeSheet, Reveal, SettingsSheet } from "./sheets";
import { Login, Pairing } from "./Start";
import { longDate, whenLabel } from "./time";
import { BottomNav, cx, Toast, type View } from "./ui";

type Session = { user: { id: string } } | null;
type Overlay =
  | { kind: "postpone"; r: Reminder }
  | { kind: "detail"; r: Reminder }
  | { kind: "settings" }
  | { kind: "invite" }
  | { kind: "reveal"; result: CompleteResult }
  | null;

function readParams() {
  const p = new URLSearchParams(location.search);
  return { invito: p.get("invito"), apri: p.get("apri"), rimanda: p.get("rimanda"), fatto: p.get("fatto") };
}

function clearParams() {
  if (location.search) history.replaceState(null, "", location.pathname);
}

export function App() {
  const [session, setSession] = useState<Session | undefined>(undefined);
  const [info, setInfo] = useState<CoupleInfo | null>(null);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [rewards, setRewards] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<View | "new">("me");
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [pushOk, setPushOk] = useState(pushState() === "granted");
  const [pairingDone, setPairingDone] = useState(false);
  const pendingAction = useRef(readParams());
  const reloadTimer = useRef<number | undefined>(undefined);

  // sessione
  useEffect(() => {
    registerServiceWorker();
    supabase.auth.getSession().then(({ data }: { data: { session: Session } }) => setSession(data.session ?? null));
    const { data } = supabase.auth.onAuthStateChange((_e: string, s: Session) => setSession(s ?? null));
    return () => data.subscription.unsubscribe();
  }, []);

  // orologio per conti alla rovescia e barre
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    try {
      const [i, r, d] = await Promise.all([api.coupleInfo(), api.reminders(), api.rewardDetails()]);
      setInfo(i);
      setReminders(r);
      setRewards(d);
      setLoadError(null);
      setNow(Date.now());
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);

  const reloadSoon = useCallback(() => {
    window.clearTimeout(reloadTimer.current);
    reloadTimer.current = window.setTimeout(load, 300);
  }, [load]);

  // dati, invito, notifiche e aggiornamenti in tempo reale
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      let invite = pendingAction.current.invito;
      try {
        invite = invite ?? localStorage.getItem("invito");
        localStorage.removeItem("invito");
      } catch {
        // niente memoria locale
      }
      if (invite) {
        try {
          await api.joinCouple(invite);
          setToast("Collegato al partner!");
        } catch (e) {
          setToast((e as Error).message);
        }
        pendingAction.current.invito = null;
      }
      if (!cancelled) await load();
      syncPush().then((ok) => setPushOk(ok || pushState() === "granted"));
    })();
    const channel = supabase
      .channel("promemoria")
      .on("postgres_changes", { event: "*", schema: "public", table: "reminders" }, reloadSoon)
      .subscribe();
    const onVisible = () => { if (document.visibilityState === "visible") reloadSoon(); };
    document.addEventListener("visibilitychange", onVisible);
    const poll = window.setInterval(reloadSoon, 60_000);
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(poll);
    };
  }, [session, load, reloadSoon]);

  const data: Data | null = useMemo(() => (info ? { info, reminders, rewards } : null), [info, reminders, rewards]);

  // "letto": quello che vedo nella mia lista
  useEffect(() => {
    if (!data || view !== "me") return;
    const unread = data.reminders.filter((r) => r.assigned_to === data.info.me.id && r.status === "pending" && !r.read_at);
    if (unread.length) api.markRead(unread.map((r) => r.id)).catch(() => undefined);
  }, [data, view]);

  const done = useCallback(async (r: Reminder) => {
    setBusy(true);
    setOverlay(null);
    try {
      const result = await api.complete(r.id);
      api.kick();
      await load();
      if (result.reward && !result.already_done) setOverlay({ kind: "reveal", result });
      else setToast(result.already_done ? "Era già segnato come fatto" : "Fatto! Notifiche fermate.");
    } catch (e) {
      setToast((e as Error).message);
    }
    setBusy(false);
  }, [load]);

  // azioni arrivate dalle notifiche (link o messaggio dal service worker)
  const handleAction = useCallback((params: { apri?: string | null; rimanda?: string | null; fatto?: string | null }) => {
    if (!data) return false;
    const find = (id?: string | null) => data.reminders.find((r) => r.id === id && r.assigned_to === data.info.me.id);
    const rFatto = find(params.fatto);
    const rRimanda = find(params.rimanda);
    const rApri = find(params.apri);
    setView("me");
    if (rFatto) done(rFatto);
    else if (rRimanda && rRimanda.status === "pending") setOverlay({ kind: "postpone", r: rRimanda });
    else if (rApri && rApri.status === "pending") setOverlay({ kind: "detail", r: rApri });
    else if (params.apri) {
      const mineCreated = data.reminders.find((r) => r.id === params.apri);
      if (mineCreated) setView(mineCreated.created_by === data.info.me.id && mineCreated.assigned_to !== data.info.me.id ? "assigned" : "me");
    }
    return true;
  }, [data, done]);

  useEffect(() => {
    if (!data) return;
    const p = pendingAction.current;
    if (p.apri || p.rimanda || p.fatto) {
      handleAction(p);
      pendingAction.current = { invito: null, apri: null, rimanda: null, fatto: null };
    }
    clearParams();
  }, [data, handleAction]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "refresh") return reloadSoon();
      if (e.data?.type !== "navigate" || typeof e.data.url !== "string") return;
      const u = new URL(e.data.url, location.origin);
      reloadSoon();
      handleAction({ apri: u.searchParams.get("apri"), rimanda: u.searchParams.get("rimanda"), fatto: u.searchParams.get("fatto") });
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    return () => navigator.serviceWorker.removeEventListener("message", onMsg);
  }, [handleAction, reloadSoon]);

  async function postpone(r: Reminder, start: Date, end: Date | null, note: string) {
    await api.postpone(r.id, start, end, note);
    setOverlay(null);
    api.kick();
    await load();
    setToast(`Rimandato a ${whenLabel(start)}`);
  }

  async function create(d: NewData) {
    await api.create(d);
    api.kick();
    await load();
    const forPartner = info?.partner && d.assignedTo === info.partner.id;
    setView(forPartner ? "assigned" : "me");
    setToast(forPartner ? `Inviato a ${info!.partner!.display_name}` : "Promemoria salvato");
    window.scrollTo(0, 0);
  }

  async function remove(r: Reminder) {
    if (!window.confirm(`Eliminare «${r.title}»?`)) return;
    try {
      await api.remove(r.id);
      await load();
      setToast("Eliminato");
    } catch (e) {
      setToast((e as Error).message);
    }
  }

  async function turnOnPush() {
    try {
      const s = await enablePush();
      setPushOk(s === "granted");
      if (s === "granted") {
        setToast("Notifiche attive");
        load();
      } else setOverlay({ kind: "settings" });
    } catch (e) {
      setToast((e as Error).message);
    }
  }

  async function logout() {
    setOverlay(null);
    await supabase.auth.signOut();
    setInfo(null);
    setReminders([]);
  }

  // ---- schermate ----
  if (session === undefined) return <div className="loading" aria-label="Caricamento"><span className="spinner" /></div>;
  if (session === null) return <Login invite={pendingAction.current.invito} />;
  if (!data) {
    return loadError ? (
      <main className="start">
        <h1>Non riesco a caricare</h1>
        <p className="start-sub">{loadError}</p>
        <button type="button" className="btn-primary wide" onClick={load}>Riprova</button>
        <button type="button" className="btn-link" onClick={logout}>Esci</button>
      </main>
    ) : <div className="loading" aria-label="Caricamento"><span className="spinner" /></div>;
  }
  if (!data.info.couple && !pairingDone) {
    return <Pairing info={data.info} onDone={() => { setPairingDone(true); load(); }} />;
  }

  const me = data.info.me;
  const myCount = data.reminders.filter((r) => r.assigned_to === me.id && r.status === "pending").length;
  const sentCount = data.reminders.filter((r) => r.created_by === me.id && r.assigned_to !== me.id && r.status === "pending").length;

  return (
    <div className="app">
      {view === "new" ? (
        <NewReminder info={data.info} onBack={() => setView("me")} onSave={create} />
      ) : (
        <>
          <header className="top">
            <div className="top-text">
              {view === "me" ? (
                <>
                  <span className="top-date">{longDate(new Date(now))}</span>
                  <h1>Ciao {me.display_name}</h1>
                </>
              ) : (
                <>
                  <span className="top-date">{data.info.partner ? `Quello che hai chiesto a ${data.info.partner.display_name}` : "I promemoria per il partner"}</span>
                  <h1>Ho assegnato</h1>
                </>
              )}
            </div>
            <button type="button" className={cx("round-btn", !pushOk && "dot")} aria-label="Notifiche e account"
              onClick={() => setOverlay({ kind: "settings" })}>
              <Bell size={22} />
            </button>
          </header>
          <nav className="tabs" aria-label="Viste">
            <button type="button" className={cx(view === "me" && "on")} aria-current={view === "me" ? "page" : undefined}
              onClick={() => setView("me")}>Per me · {myCount}</button>
            <button type="button" className={cx(view === "assigned" && "on")} aria-current={view === "assigned" ? "page" : undefined}
              onClick={() => setView("assigned")}>Ho assegnato · {sentCount}</button>
          </nav>
          {view === "me" ? (
            <PerMe data={data} now={now} busy={busy} pushOk={pushOk}
              onDone={done} onPostpone={(r) => setOverlay({ kind: "postpone", r })}
              onOpen={(r) => setOverlay({ kind: "detail", r })} onEnablePush={turnOnPush} />
          ) : (
            <Assigned data={data} now={now} onDelete={remove} onInvite={() => setOverlay({ kind: "invite" })} />
          )}
          <BottomNav view={view} onView={setView} onNew={() => { setView("new"); window.scrollTo(0, 0); }} />
        </>
      )}

      {overlay?.kind === "postpone" && (
        <PostponeSheet r={overlay.r} onClose={() => setOverlay(null)} onSave={(s, e, n) => postpone(overlay.r, s, e, n)} />
      )}
      {overlay?.kind === "detail" && (
        <DetailSheet r={overlay.r} data={data} now={now} onClose={() => setOverlay(null)}
          onDone={() => done(overlay.r)} onPostpone={() => setOverlay({ kind: "postpone", r: overlay.r })} />
      )}
      {overlay?.kind === "settings" && (
        <SettingsSheet info={data.info} onClose={() => setOverlay(null)} onLogout={logout}
          onInvite={() => setOverlay({ kind: "invite" })}
          onChanged={(m) => { setPushOk(pushState() === "granted"); load(); if (m) setToast(m); }} />
      )}
      {overlay?.kind === "invite" && <InviteSheet info={data.info} onClose={() => setOverlay(null)} onChanged={load} />}
      {overlay?.kind === "reveal" && <Reveal result={overlay.result} onClose={() => setOverlay(null)} />}
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </div>
  );
}
