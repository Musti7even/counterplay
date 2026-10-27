// Design tokens for canvas/three.js graphics. Mirror of tokens.css (meanings in web/DESIGN.md).
// Pitch colours stay <= 1.0 so the bloom pass (threshold 1.0) never catches them: no glow on graphics.
export const C = {
  surface: 'rgba(20, 7, 34, 0.94)', surface2: '#2a0f47',
  text: '#ffffff', text2: 'rgba(255, 255, 255, 0.62)',
  accent: '#38ff8b', // live focus
  alert: '#ffb020',  // risk
  whatif: '#34ddff', // alternate timeline
};
export const FONT = '"Onest", system-ui, sans-serif';
export const W = { text: 500, strong: 700, heavy: 800 } as const;

// pitch line family (metres on the grass): primary = the point of the graphic, secondary = context
export const LINE = { primary: 0.3, secondary: 0.12, dash: 1.2 };

// motion: one easing, three durations (seconds). In = reveal from the anchor, out = fade only, faster.
export const T = { fast: 0.2, base: 0.4, draw: 0.8 };
export const ease = (x: number) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 4;
// in/out envelope for something shown from t0 for dur seconds, evaluated at time t (recorder-safe, no CSS transitions)
export const envelope = (t: number, t0: number, dur: number) => {
  const age = t - t0;
  if (age < 0 || age > dur) return { a: 0, reveal: 0 };
  return { reveal: ease(age / T.base), a: Math.min(1, (dur - age) / T.fast) };
};
