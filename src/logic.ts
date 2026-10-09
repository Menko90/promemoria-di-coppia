// Regole dell'app che non dipendono dalla grafica (testate a parte).
import type { Reminder } from "./api";
import { DAY, HOUR, MIN } from "./time";

export const PRIORITY_RANK: Record<string, number> = { urgente: 0, normale: 1, quando_puoi: 2 };

const t = (s: string | null) => (s ? new Date(s).getTime() : null);

export function isActive(r: Reminder, now: number): boolean {
  return r.status === "pending" && t(r.start_at)! <= now && (r.end_at === null || t(r.end_at)! >= now);
}

/** Il promemoria da mettere in grande: prima quelli già iniziati (urgenti, poi chi scade prima), altrimenti il prossimo. */
export function pickFocus(mine: Reminder[], now: number): Reminder | null {
  const pending = mine.filter((r) => r.status === "pending");
  const active = pending.filter((r) => isActive(r, now));
  if (active.length) {
    return [...active].sort((a, b) =>
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      (t(a.end_at) ?? Infinity) - (t(b.end_at) ?? Infinity) ||
      t(a.start_at)! - t(b.start_at)!)[0];
  }
  const upcoming = pending.filter((r) => t(r.start_at)! > now);
  return upcoming.sort((a, b) => t(a.start_at)! - t(b.start_at)! || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])[0] ?? null;
}

/** Quando arriverà la prossima notifica (null se non ne arriveranno altre). */
export function nextNotification(r: Reminder, now: number): number | null {
  if (r.status !== "pending") return null;
  const start = t(r.start_at)!;
  const end = t(r.end_at);
  if (start > now) return start;
  const last = t(r.last_notified_at);
  if (last === null) return now;
  if (r.repeat_minutes <= 0) return null;
  let next = last + r.repeat_minutes * MIN;
  while (next < now - MIN) next += r.repeat_minutes * MIN;
  if (end !== null && next > end) return null;
  return next;
}

export type AssignedStatus = "fatto" | "scaduto" | "rimandato" | "letto" | "non_letto" | "programmato";

export function assignedStatus(r: Reminder, now: number): AssignedStatus {
  if (r.status === "done") return "fatto";
  if (r.status === "missed") return "scaduto";
  if (r.postponed_at) return "rimandato";
  if (r.read_at) return "letto";
  if (t(r.start_at)! > now) return "programmato";
  return "non_letto";
}

export const STATUS_LABEL: Record<AssignedStatus, string> = {
  fatto: "Fatto",
  scaduto: "Scaduto",
  rimandato: "Rimandato",
  letto: "Letto",
  non_letto: "Non ancora letto",
  programmato: "Programmato",
};

/** Proposte rapide per "Non posso ora". */
export function postponePresets(r: Reminder, now: Date): { id: string; label: string; start: Date }[] {
  const out: { id: string; label: string; start: Date }[] = [];
  const inOneHour = new Date(now.getTime() + HOUR);
  inOneHour.setSeconds(0, 0);
  out.push({ id: "1h", label: "Tra 1 ora", start: inOneHour });
  if (now.getHours() < 20) {
    const tonight = new Date(now);
    tonight.setHours(20, 30, 0, 0);
    out.push({ id: "sera", label: "Stasera", start: tonight });
  }
  const orig = new Date(r.start_at);
  const tomorrow = new Date(now.getTime() + DAY);
  tomorrow.setHours(orig.getHours(), orig.getMinutes(), 0, 0);
  out.push({ id: "domani", label: "Domani", start: tomorrow });
  return out;
}

/** La nuova fine mantiene la stessa durata della fascia originale. */
export function shiftedEnd(r: Reminder, newStart: Date): Date | null {
  if (!r.end_at) return null;
  const dur = t(r.end_at)! - t(r.start_at)!;
  return new Date(newStart.getTime() + Math.max(dur, 15 * MIN));
}

export function recurrenceLabel(r: Pick<Reminder, "recurrence" | "recurrence_days">): string | null {
  if (r.recurrence === "daily") return "Ogni giorno";
  if (r.recurrence === "weekly") return "Ogni settimana";
  if (r.recurrence === "custom" && r.recurrence_days?.length) {
    const names = ["", "lun", "mar", "mer", "gio", "ven", "sab", "dom"];
    return "Ogni " + r.recurrence_days.map((d) => names[d]).join(", ");
  }
  return null;
}
