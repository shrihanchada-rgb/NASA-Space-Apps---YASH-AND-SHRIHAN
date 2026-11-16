// Colour steps for the calendar. Defined as CSS variables (styles.css) so light and dark mode each get
// their own validated steps. Discrete steps, no gradients.

export const SEQ_STEPS = 7; // --seq-0 (none) ... --seq-6 (most)
export const DIV_STEPS = 7; // --div-0 (far below normal) ... --div-3 (normal) ... --div-6 (far above)

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export const seqColor = (i: number) => `var(--seq-${i})`;
export const divColor = (i: number) => `var(--div-${i})`;

/** Log-count step for a value: 0 = no fires, 1..6 = log-spaced up to the maximum. */
export function logStep(v: number, max: number): number {
  if (v <= 0 || max <= 0) return 0;
  const f = Math.log10(1 + v) / Math.log10(1 + max);
  return Math.min(SEQ_STEPS - 1, Math.max(1, Math.ceil(f * (SEQ_STEPS - 1))));
}

/** Value at the upper edge of log step i (for the legend). */
export function logEdge(i: number, max: number): number {
  return 10 ** ((i / (SEQ_STEPS - 1)) * Math.log10(1 + max)) - 1;
}

/** Percentile (0-100) to one of 6 steps (seq-1..seq-6); 0 is kept for "no fires". */
export const PCT_EDGES = [0, 17, 33, 50, 67, 83, 100];
export function pctStep(p: number): number {
  for (let i = 1; i < PCT_EDGES.length; i++) if (p < (PCT_EDGES[i] as number) || i === PCT_EDGES.length - 1) return i;
  return SEQ_STEPS - 1;
}

/** Anomaly % to a diverging step. Edges are symmetric on a log-ratio scale. */
export const ANOM_EDGES = [-75, -50, -20, 25, 100, 300]; // (-inf,-75) (-75,-50) (-50,-20) [-20,25) [25,100) [100,300) [300,inf)
export function anomStep(a: number): number {
  let i = 0;
  while (i < ANOM_EDGES.length && a >= (ANOM_EDGES[i] as number)) i++;
  return i;
}
export const ANOM_LABELS = ['< −75%', '−75 to −50%', '−50 to −20%', 'Near normal (−20 to +25%)', '+25 to +100%', '+100 to +300%', '> +300%'];
