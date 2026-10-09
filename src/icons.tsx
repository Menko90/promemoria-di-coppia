import { useId } from "react";
import type { Reward } from "./api";

type P = { size?: number; className?: string; stroke?: number };

function S({ size = 20, className, stroke = 2, children }: P & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {children}
    </svg>
  );
}

export const Bell = (p: P) => <S {...p}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10 21a2 2 0 0 0 4 0" /></S>;
export const Clock = (p: P) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></S>;
export const Repeat = (p: P) => <S {...p}><path d="M17 2l4 4-4 4" /><path d="M3 11V9a3 3 0 0 1 3-3h15" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a3 3 0 0 1-3 3H3" /></S>;
export const Check = (p: P) => <S stroke={3} {...p}><polyline points="20 6 9 17 4 12" /></S>;
export const Plus = (p: P) => <S stroke={2.5} {...p}><path d="M12 5v14M5 12h14" /></S>;
export const Home = (p: P) => <S {...p}><path d="M3 10l9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></S>;
export const Send = (p: P) => <S {...p}><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4z" /></S>;
export const Back = (p: P) => <S stroke={2.2} {...p}><path d="M15 18l-6-6 6-6" /></S>;
export const Calendar = (p: P) => <S {...p}><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></S>;
export const Lock = (p: P) => <S {...p}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></S>;
export const Message = (p: P) => <S {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></S>;
export const Trash = (p: P) => <S {...p}><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 14h10l1-14" /></S>;
export const Close = (p: P) => <S {...p}><path d="M18 6L6 18M6 6l12 12" /></S>;
export const Share = (p: P) => <S {...p}><path d="M4 12v8h16v-8" /><path d="M12 3v13" /><path d="M7 8l5-5 5 5" /></S>;
export const Eye = (p: P) => <S {...p}><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></S>;
export const Alert = (p: P) => <S {...p}><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></S>;

export const Massaggio = (p: P) => <S stroke={1.8} {...p}><path d="M12 20c-4 0-8-3-8-7 3 0 6 1 8 4 2-3 5-4 8-4 0 4-4 7-8 7z" /><path d="M12 17c-2-3-2-7 0-11 2 4 2 8 0 11z" /></S>;
export const Film = (p: P) => <S stroke={1.8} {...p}><path d="M4 10h16v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" /><path d="M4 10l1.5-5.5 15 3.5-1 2" /><path d="M9 5.6l2 3.4M14 6.8l2 3.2" /></S>;
export const Cena = (p: P) => <S stroke={1.8} {...p}><path d="M7 3v8a2 2 0 0 0 2 2v8" /><path d="M5 3v6M9 3v6" /><path d="M17 21V3c-2 1-3 4-3 7v3h3" /></S>;
export const Regalo = (p: P) => <S stroke={1.8} {...p}><rect x="3" y="8" width="18" height="5" rx="1" /><path d="M5 13v8h14v-8" /><path d="M12 8v13" /><path d="M12 8c-2-4-6-4-6-1 0 1 1 1 6 1zm0 0c2-4 6-4 6-1 0 1-1 1-6 1z" /></S>;

/** Il premio speciale: una fiamma con il cuore. */
export function FlameHeart({ size = 22 }: { size?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id={`fh${id}`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#B4235F" />
          <stop offset="0.55" stopColor="#F2543D" />
          <stop offset="1" stopColor="#FFB547" />
        </linearGradient>
      </defs>
      <path d="M32 4c2 9 12 15 15 25 3 11-3 27-15 27S14 47 16 37c1-6 5-10 7-15 2 4 2 8 1 11 4-3 9-11 8-29z" fill={`url(#fh${id})`} />
      <path d="M32 50c-7-5-10-8.5-10-12.5 0-3 2.3-5 5-5 2 0 3.6 1 5 3 1.4-2 3-3 5-3 2.7 0 5 2 5 5 0 4-3 7.5-10 12.5z" fill="#FFF4E0" />
    </svg>
  );
}

export function AppMark({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="18" fill="#B4235F" />
      <path d="M32 50c-10-7-16-12.5-16-19.5 0-5 3.8-8.5 8.3-8.5 3.3 0 5.9 1.7 7.7 4.3 1.8-2.6 4.4-4.3 7.7-4.3 4.5 0 8.3 3.5 8.3 8.5 0 7-6 12.5-16 19.5z"
        fill="none" stroke="#FFFFFF" strokeWidth="3.4" strokeLinejoin="round" />
      <path d="M25.5 32.5l4.5 4.5 8.5-8.5" fill="none" stroke="#FFFFFF" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export const REWARDS: { id: Exclude<Reward, "speciale">; label: string; Icon: (p: P) => React.ReactElement }[] = [
  { id: "massaggio", label: "Massaggio", Icon: Massaggio },
  { id: "film", label: "Serata film", Icon: Film },
  { id: "cena", label: "Cena", Icon: Cena },
  { id: "regalo", label: "Regalo", Icon: Regalo },
];

export function rewardLabel(r: Reward): string {
  return r === "speciale" ? "Premio speciale" : REWARDS.find((x) => x.id === r)?.label ?? "Premio";
}

export function RewardIcon({ reward, size = 18 }: { reward: Reward; size?: number }) {
  if (reward === "speciale") return <FlameHeart size={size + 4} />;
  const R = REWARDS.find((x) => x.id === reward)?.Icon ?? Regalo;
  return <R size={size} />;
}
