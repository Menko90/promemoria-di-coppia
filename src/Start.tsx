import { useState } from "react";
import { api, supabase, type CoupleInfo } from "./api";
import { AppMark, FlameHeart, Share } from "./icons";

export function Login({ invite }: { invite: string | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function google() {
    setBusy(true);
    setError(null);
    try {
      if (invite) localStorage.setItem("invito", invite);
    } catch {
      // memoria del browser non disponibile: pazienza
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/`, queryParams: { prompt: "select_account" } },
    });
    if (error) {
      setError(error.message);
      setBusy(false);
    }
  }
  return (
    <main className="start">
      <div className="start-mark"><AppMark size={84} /></div>
      <h1>Promemoria di Coppia</h1>
      <p className="start-sub">I promemoria arrivano al momento giusto, per tutti e due.</p>
      {invite && <p className="start-invite">Il tuo partner ti ha invitato: accedi per collegarti.</p>}
      <button type="button" className="btn-google" onClick={google} disabled={busy}>
        <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z" />
          <path fill="#FBBC05" d="M10.6 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.6l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.7 10.7l7.9-6.1z" />
          <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.2-8.5 2.2-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
        </svg>
        {busy ? "Apro Google…" : "Accedi con Google"}
      </button>
      {error && <p className="error" role="alert">{error}</p>}
    </main>
  );
}

export function Pairing({ info, onDone }: { info: CoupleInfo; onDone: () => void }) {
  const [step, setStep] = useState<"choose" | "invite" | "join">("choose");
  const [code, setCode] = useState(info.couple?.invite_code ?? "");
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const link = `${location.origin}/?invito=${code}`;

  async function invite() {
    setBusy(true);
    setError(null);
    try {
      setCode(await api.createCouple());
      setStep("invite");
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }
  async function share() {
    const text = `Installa la nostra app dei promemoria e collegati a me: ${link}`;
    try {
      if (navigator.share) await navigator.share({ title: "Promemoria di Coppia", text, url: link });
      else await navigator.clipboard.writeText(link);
    } catch {
      // annullato
    }
  }
  async function join() {
    setBusy(true);
    setError(null);
    try {
      await api.joinCouple(joinCode);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }
  async function later() {
    setBusy(true);
    try {
      await api.createCouple();
    } catch {
      // nessun problema: si riprova al primo promemoria
    }
    onDone();
  }

  return (
    <main className="start">
      <div className="start-mark"><FlameHeart size={84} /></div>
      <h1>Ciao {info.me.display_name}!</h1>
      {step === "choose" && (
        <>
          <p className="start-sub">Collegati al tuo partner per scambiarvi i promemoria.</p>
          <button type="button" className="btn-primary wide" onClick={invite} disabled={busy}>Invita il partner</button>
          <button type="button" className="btn-ghost wide" onClick={() => setStep("join")}>Ho ricevuto un codice</button>
          <button type="button" className="btn-link" onClick={later} disabled={busy}>Lo faccio più tardi</button>
        </>
      )}
      {step === "invite" && (
        <>
          <p className="start-sub">Manda questo link al partner. Quando accede, siete collegati.</p>
          <div className="code-box">{code}</div>
          <button type="button" className="btn-primary wide" onClick={share}><Share size={20} />Condividi il link</button>
          <button type="button" className="btn-ghost wide" onClick={onDone}>Continua</button>
        </>
      )}
      {step === "join" && (
        <>
          <p className="start-sub">Scrivi il codice di 6 caratteri che ti ha mandato il partner.</p>
          <label htmlFor="codice-start" className="sr-only">Codice</label>
          <input id="codice-start" className="field code-input big" value={joinCode} maxLength={8}
            autoCapitalize="characters" placeholder="ABC123" onChange={(e) => setJoinCode(e.target.value.toUpperCase())} />
          <button type="button" className="btn-primary wide" onClick={join} disabled={busy || joinCode.trim().length < 6}>Collegati</button>
          <button type="button" className="btn-link" onClick={() => setStep("choose")}>Indietro</button>
        </>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </main>
  );
}
