import { LIVE_WORKS, type LiveWorkId } from '../art/works.ts';
import type { NumericComplex } from '../numerics/contract.ts';
import { STOP_MS } from './route.ts';

export const ARRIVAL_MS = 600;
export const SETTLE_MS = 1100;

/** A closed path on the parameter plane for one room. The viewer's z₀ plane stays fixed. */
export function marbleC(workId: LiveWorkId, withinMs: number, reducedMotion = false): NumericComplex {
  const work = LIVE_WORKS.find(item => item.id === workId);
  if (!work || !Number.isFinite(withinMs) || withinMs < 0 || withinMs > STOP_MS) {
    throw new RangeError('巡回の作品または時刻が順路の外にあります。');
  }
  if (reducedMotion || withinMs <= ARRIVAL_MS || withinMs >= STOP_MS - SETTLE_MS) return { ...work.c };

  const t = (withinMs - ARRIVAL_MS) / (STOP_MS - ARRIVAL_MS - SETTLE_MS);
  const angle = 2 * Math.PI * t * t * (3 - 2 * t);
  const sin = Math.sin(angle), cos = Math.cos(angle);
  switch (workId) {
    case 'tide':
      // The paired spirals open as the current crosses a curved band near the original c.
      return { re: work.c.re + .024 * (1 - cos) + .014 * sin,
        im: work.c.im + .009 * (1 - cos) - .012 * sin - .005 * (1 - Math.cos(2 * angle)) };
    case 'twin':
      // Swing the necks in opposite directions, then widen the two lobes on the return.
      return { re: work.c.re + .116 * sin + .048 * Math.sin(2 * angle) + .035 * (1 - cos),
        im: work.c.im + .19 * sin - .018 * Math.sin(2 * angle) };
    case 'petals': {
      // Trace both sides of the real axis. The small whorls inside the petals change handedness.
      const re = work.c.re + .009 * (1 - cos) + .004 * Math.sin(2 * angle);
      const slope = (work.c.im / (work.c.re - .25)) * cos + .14 * sin + .055 * (1 - Math.cos(2 * angle));
      return { re, im: (re - .25) * slope };
    }
  }
}
