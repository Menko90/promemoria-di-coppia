import { useMemo, useState } from "react";
import type { CoupleInfo, NewReminder as NewData, Priority, Recurrence, Reward } from "./api";
import { Back, FlameHeart, REWARDS, Repeat, Send } from "./icons";
import { fromInputs, HOUR, isoWeekday, roundUp5, toDateInput, toTimeInput, WEEKDAYS_ISO } from "./time";
import { Chips, cx, DateTime, Segmented, Switch } from "./ui";

export function NewReminder({ info, onBack, onSave }: {
  info: CoupleInfo; onBack: () => void; onSave: (d: NewData) => Promise<void>;
}) {
  const partner = info.partner;
  const initStart = useMemo(() => roundUp5(), []);
  const initEnd = useMemo(() => new Date(initStart.getTime() + 2 * HOUR), [initStart]);

  const [title, setTitle] = useState("");
  const [forWhom, setForWhom] = useState<"me" | "partner">(partner ? "partner" : "me");
  const [startDate, setStartDate] = useState(toDateInput(initStart));
  const [startTime, setStartTime] = useState(toTimeInput(initStart));
  const [hasEnd, setHasEnd] = useState(false);
  const [endDate, setEndDate] = useState(toDateInput(initEnd));
  const [endTime, setEndTime] = useState(toTimeInput(initEnd));
  const [repeat, setRepeat] = useState(0);
  const [priority, setPriority] = useState<Priority>("normale");
  const [recurring, setRecurring] = useState(false);
  const [recurrence, setRecurrence] = useState<Exclude<Recurrence, "none">>("daily");
  const [days, setDays] = useState<number[]>([isoWeekday(initStart)]);
  const [reward, setReward] = useState<Reward | null>(null);
  const [detail, setDetail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const toggleReward = (r: Reward) => setReward((cur) => (cur === r ? null : r));
  const toggleDay = (d: number) =>
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const start = fromInputs(startDate, startTime);
    const end = hasEnd ? fromInputs(endDate, endTime) : null;
    if (!title.trim()) return setError("Scrivi cosa c'è da fare.");
    if (!start) return setError("Scegli giorno e ora della prima notifica.");
    if (hasEnd && !end) return setError("Scegli giorno e ora dell'orario limite.");
    if (end && end <= start) return setError("L'orario limite deve venire dopo la prima notifica.");
    if (end && end.getTime() <= Date.now()) return setError("L'orario limite è già passato.");
    if (recurring && recurrence === "custom" && days.length === 0) return setError("Scegli almeno un giorno.");
    setSaving(true);
    try {
      await onSave({
        title: title.trim(),
        assignedTo: forWhom === "partner" && partner ? partner.id : info.me.id,
        start, end, repeat, priority,
        recurrence: recurring ? recurrence : "none",
        recurrenceDays: recurring && recurrence === "custom" ? days : null,
        reward, rewardDetail: detail.trim(),
      });
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  const forPartner = forWhom === "partner" && partner;

  return (
    <div className="screen screen-form">
      <header className="form-head">
        <button type="button" className="round-btn" aria-label="Indietro" onClick={onBack}><Back size={22} /></button>
        <h1>Nuovo promemoria</h1>
      </header>

      <form className="form" onSubmit={submit} noValidate>
        <div className="field-group">
          <label htmlFor="titolo" className="label">Cosa c'è da fare?</label>
          <input id="titolo" className="field field-big" value={title} maxLength={140} autoComplete="off"
            placeholder="Es. Chiama la pediatra" onChange={(e) => setTitle(e.target.value)} />
        </div>

        <div className="field-group">
          <span className="label" id="perchi">Per chi</span>
          <Segmented label="Per chi" value={forWhom} onChange={setForWhom}
            options={[
              { value: "me", label: "Per me" },
              { value: "partner", label: partner ? `Per ${partner.display_name}` : "Per il partner", disabled: !partner },
            ]} />
          {!partner && <p className="hint">Quando il partner si collega potrai assegnargli promemoria.</p>}
        </div>

        <fieldset className="box">
          <legend className="label">Quando</legend>
          <DateTime idPrefix="inizio" label="Prima notifica" date={startDate} time={startTime}
            onDate={setStartDate} onTime={setStartTime} />
          <div className="switch-row">
            <div>
              <span className="switch-title">Orario limite</span>
              <span className="hint">Dopo quest'ora le notifiche si fermano</span>
            </div>
            <Switch label="Orario limite" checked={hasEnd} onChange={setHasEnd} />
          </div>
          {hasEnd && (
            <DateTime idPrefix="fine" label="Fine" date={endDate} time={endTime} onDate={setEndDate} onTime={setEndTime} />
          )}
        </fieldset>

        <div className="field-group">
          <span className="label">Ripeti ogni</span>
          <Chips label="Ripeti ogni" cols={4} value={repeat} onChange={setRepeat}
            options={[{ value: 0, label: "No" }, { value: 15, label: "15 min" }, { value: 30, label: "30 min" }, { value: 60, label: "60 min" }]} />
          {repeat > 0 && !hasEnd && <p className="hint">Senza orario limite le notifiche continuano finché non tocca «Fatto».</p>}
        </div>

        <div className="field-group">
          <span className="label">Priorità</span>
          <Chips label="Priorità" value={priority} onChange={setPriority}
            tone={(v) => (v === "urgente" ? "urgent" : undefined)}
            options={[{ value: "urgente", label: "Urgente" }, { value: "normale", label: "Normale" }, { value: "quando_puoi", label: "Quando puoi" }]} />
        </div>

        <div className="box box-row">
          <div className="switch-row">
            <div className="switch-icon-text">
              <Repeat size={22} />
              <div>
                <span className="switch-title">Ricorrente</span>
                <span className="hint">Ogni giorno, ogni settimana o giorni scelti</span>
              </div>
            </div>
            <Switch label="Ricorrente" checked={recurring} onChange={setRecurring} />
          </div>
          {recurring && (
            <>
              <Chips label="Ricorrenza" value={recurrence} onChange={setRecurrence}
                options={[{ value: "daily", label: "Ogni giorno" }, { value: "weekly", label: "Ogni settimana" }, { value: "custom", label: "Giorni scelti" }]} />
              {recurrence === "custom" && (
                <div className="weekdays" role="group" aria-label="Giorni">
                  {WEEKDAYS_ISO.map((d) => (
                    <button key={d.iso} type="button" aria-pressed={days.includes(d.iso)} aria-label={d.name}
                      className={cx("weekday", days.includes(d.iso) && "on")} onClick={() => toggleDay(d.iso)}>
                      {d.short}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <fieldset className="field-group plain">
          <legend className="label">Premio <span className="muted">(facoltativo)</span></legend>
          <div className="rewards">
            {REWARDS.map(({ id, label, Icon }) => (
              <button key={id} type="button" aria-pressed={reward === id}
                className={cx("reward", reward === id && "on")} onClick={() => toggleReward(id)}>
                <Icon size={26} />{label}
              </button>
            ))}
          </div>
          <button type="button" aria-pressed={reward === "speciale"}
            className={cx("reward-special", reward === "speciale" && "on")} onClick={() => toggleReward("speciale")}>
            <span className="reward-special-icon"><FlameHeart size={52} /></span>
            <span className="reward-special-text">
              <span className="eyebrow">PREMIO SPECIALE</span>
              <span className="reward-special-title">Una sorpresa per noi due</span>
              <span className="reward-special-sub">Resta segreto finché il compito non è fatto</span>
            </span>
          </button>
          {reward && (
            <div className="field-group">
              <label htmlFor="dettaglio" className="label">
                Dettaglio del premio <span className="muted">(facoltativo)</span>
              </label>
              <textarea id="dettaglio" className="field" rows={3} maxLength={500} value={detail}
                placeholder={reward === "speciale" ? "Lo vedrà solo quando avrà finito" : "Es. scegli tu il film"}
                onChange={(e) => setDetail(e.target.value)} />
            </div>
          )}
          {reward === "speciale" && (
            <p className="tease">Stai promettendo qualcosa di speciale… occhio a non deludere le aspettative!</p>
          )}
        </fieldset>

        {error && <p className="error" role="alert">{error}</p>}

        <button type="submit" className="btn-primary btn-submit" disabled={saving}>
          <Send size={20} />{saving ? "Invio…" : forPartner ? "Invia promemoria" : "Salva promemoria"}
        </button>
      </form>
    </div>
  );
}
