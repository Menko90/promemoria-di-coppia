import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { cx } from "./ui";

/*
 * Schermate affiancate su una "pista" che scorre col dito, come un carrello.
 * Mentre il dito trascina, la pista si sposta direttamente dal DOM (niente render di React);
 * al rilascio si decide se passare alla pagina vicina o tornare indietro.
 */

const GAP = 32; // spazio tra le pagine, uguale al CSS
const EDGE = 24; // i gesti che partono dai bordi dello schermo sono del sistema (indietro)
const LOCK = 10; // dopo 10px si decide una volta sola: orizzontale = trascino, verticale = scorro
const SWITCH_RATIO = 0.25; // basta superare un quarto della larghezza
const FLICK_PX = 40; // oppure un colpetto veloce: più di 40px...
const FLICK_MS = 350; // ...in meno di 350ms
const RESIST = 0.3; // resistenza oltre la prima e l'ultima pagina

const offset = (index: number, px = 0) => `translate3d(calc(${-index} * (100% + ${GAP}px) + ${px}px), 0, 0)`;
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Calcola dove andare al rilascio: esportata per poterla provare da sola. */
export function releaseTarget(index: number, count: number, dx: number, dt: number, width: number): number {
  const far = Math.abs(dx) > width * SWITCH_RATIO;
  const flick = Math.abs(dx) > FLICK_PX && dt < FLICK_MS;
  if (!far && !flick) return index;
  return Math.min(count - 1, Math.max(0, index + (dx < 0 ? 1 : -1)));
}

export function Carousel({ index, onIndex, disabled, labels, children }: {
  index: number; onIndex: (i: number) => void; disabled?: boolean; labels: string[]; children: ReactNode[];
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const live = useRef({ index, disabled: Boolean(disabled), onIndex, count: children.length });
  live.current = { index, disabled: Boolean(disabled), onIndex, count: children.length };
  const first = useRef(true);
  const endTimer = useRef<number | undefined>(undefined);

  // porta la pista sulla pagina giusta (anche quando si tocca una scheda), con l'animazione
  const settle = (to: number, animate: boolean, changed = false) => {
    const t = track.current;
    if (!t) return;
    window.clearTimeout(endTimer.current);
    const finish = () => {
      t.classList.remove("moving");
      if (changed && window.scrollY > 0) window.scrollTo({ top: 0 }); // la nuova pagina si vede dall'inizio
    };
    t.style.transition = animate ? "" : "none";
    t.style.transform = offset(to);
    if (!animate || reducedMotion()) {
      void t.offsetWidth; // applica subito la posizione prima di riattivare la transizione
      t.style.transition = "";
      finish();
      return;
    }
    t.classList.add("moving");
    const onEnd = (e: TransitionEvent) => {
      if (e.target !== t || e.propertyName !== "transform") return;
      t.removeEventListener("transitionend", onEnd);
      finish();
    };
    t.addEventListener("transitionend", onEnd);
    endTimer.current = window.setTimeout(() => { t.removeEventListener("transitionend", onEnd); finish(); }, 600);
  };

  useLayoutEffect(() => {
    settle(index, !first.current, !first.current);
    first.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  useEffect(() => {
    const w = wrap.current;
    const t = track.current;
    if (!w || !t) return;
    let mode: "none" | "pending" | "drag" = "none";
    let x0 = 0, y0 = 0, t0 = 0, dx = 0, width = 1;

    const cancel = () => {
      if (mode === "drag") settle(live.current.index, true);
      mode = "none";
    };

    const onStart = (e: TouchEvent) => {
      mode = "none";
      if (live.current.disabled || e.touches.length !== 1) return;
      const p = e.touches[0];
      if (p.clientX < EDGE || p.clientX > window.innerWidth - EDGE) return;
      if ((e.target as Element | null)?.closest?.("input, textarea, select, [contenteditable]")) return;
      x0 = p.clientX; y0 = p.clientY; t0 = performance.now(); dx = 0;
      width = w.clientWidth || window.innerWidth;
      mode = "pending";
    };

    const onMove = (e: TouchEvent) => {
      if (mode === "none") return;
      if (e.touches.length !== 1 || live.current.disabled) return cancel();
      const p = e.touches[0];
      const mx = p.clientX - x0;
      const my = p.clientY - y0;
      if (mode === "pending") {
        if (Math.abs(mx) < LOCK && Math.abs(my) < LOCK) return;
        if (Math.abs(mx) <= Math.abs(my)) { mode = "none"; return; } // è uno scroll: lo lascio al browser
        mode = "drag";
        window.clearTimeout(endTimer.current);
        t.style.transition = "none";
        t.classList.add("moving");
      }
      if (e.cancelable) e.preventDefault();
      dx = mx;
      const { index: i, count } = live.current;
      const atEdge = (i === 0 && mx > 0) || (i === count - 1 && mx < 0);
      t.style.transform = offset(i, atEdge ? mx * RESIST : mx);
    };

    const onEnd = () => {
      if (mode !== "drag") { mode = "none"; return; }
      mode = "none";
      const { index: i, count, onIndex: go } = live.current;
      const to = releaseTarget(i, count, dx, performance.now() - t0, width);
      if (to === i) settle(i, true);
      else go(to); // il cambio di pagina fa partire l'animazione da useLayoutEffect
    };

    w.addEventListener("touchstart", onStart, { passive: true });
    w.addEventListener("touchmove", onMove, { passive: false });
    w.addEventListener("touchend", onEnd);
    w.addEventListener("touchcancel", cancel);
    return () => {
      w.removeEventListener("touchstart", onStart);
      w.removeEventListener("touchmove", onMove);
      w.removeEventListener("touchend", onEnd);
      w.removeEventListener("touchcancel", cancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="carousel" ref={wrap}>
      <div className="track" ref={track}>
        {children.map((child, i) => (
          <section key={i} className={cx("page", i === index && "active")} aria-label={labels[i]}
            aria-hidden={i === index ? undefined : true}>
            {child}
          </section>
        ))}
      </div>
    </div>
  );
}
