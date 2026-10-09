// Date e orari in italiano, sempre nel fuso del telefono.

const DAYS_SHORT = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];
const DAYS_LONG = ["Domenica", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato"];
const MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const MONTHS_SHORT = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function dayDiff(a: Date, b: Date): number {
  return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / DAY);
}

export function hm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** "Oggi", "Domani", "Ieri", "sab 10 ott" */
export function dayLabel(d: Date, now = new Date()): string {
  const diff = dayDiff(d, now);
  if (diff === 0) return "Oggi";
  if (diff === 1) return "Domani";
  if (diff === -1) return "Ieri";
  return `${DAYS_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

/** "oggi alle 15:00" */
export function whenLabel(d: Date, now = new Date()): string {
  return `${dayLabel(d, now).toLowerCase()} alle ${hm(d)}`;
}

/** "Venerdì 9 ottobre" */
export function longDate(d: Date): string {
  return `${DAYS_LONG[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "3 h 48 min", "12 min", "meno di 1 min" */
export function duration(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / MIN));
  if (totalMin < 1) return "meno di 1 min";
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return hours ? `${days} g ${hours} h` : `${days} g`;
  if (hours > 0) return mins ? `${hours} h ${mins} min` : `${hours} h`;
  return `${mins} min`;
}

/** Fascia oraria: "Oggi dalle 15:00 alle 19:00", "Domani alle 13:00", "Oggi 22:00 → domani 08:00" */
export function windowLabel(start: Date, end: Date | null, now = new Date()): string {
  if (!end) return `${dayLabel(start, now)} alle ${hm(start)}`;
  if (dayDiff(start, end) === 0) return `${dayLabel(start, now)} dalle ${hm(start)} alle ${hm(end)}`;
  return `${dayLabel(start, now)} ${hm(start)} → ${dayLabel(end, now).toLowerCase()} ${hm(end)}`;
}

export function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function toTimeInput(d: Date): string {
  return hm(d);
}

/** Combina i valori dei campi data e ora (ora locale del telefono). */
export function fromInputs(date: string, time: string): Date | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{2}):(\d{2})/.exec(time);
  if (!dm || !tm) return null;
  const d = new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]), 0, 0);
  return isNaN(d.getTime()) ? null : d;
}

/** Prossimi 5 minuti tondi, per i valori di partenza dei moduli. */
export function roundUp5(d = new Date()): Date {
  const r = new Date(d);
  r.setSeconds(0, 0);
  const m = r.getMinutes();
  r.setMinutes(m + (5 - (m % 5)));
  return r;
}

export const WEEKDAYS_ISO = [
  { iso: 1, short: "L", name: "lunedì" },
  { iso: 2, short: "M", name: "martedì" },
  { iso: 3, short: "M", name: "mercoledì" },
  { iso: 4, short: "G", name: "giovedì" },
  { iso: 5, short: "V", name: "venerdì" },
  { iso: 6, short: "S", name: "sabato" },
  { iso: 7, short: "D", name: "domenica" },
];

export function isoWeekday(d: Date): number {
  return d.getDay() === 0 ? 7 : d.getDay();
}
