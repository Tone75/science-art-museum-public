import type { LiveWorkId } from '../art/works.ts';
import type { NumericViewport } from '../numerics/contract.ts';
import { INITIAL_VIEWPORT } from '../framing/contract.ts';

/** Each rectangle lies inside the original print; c, palette, N and output size stay with that work. */
export const TOUR_STOPS = [
  { workId: 'tide', detail: { reMin: -1.44, reMax: 0.16, imMin: -0.73, imMax: 0.87 } },
  { workId: 'twin', detail: { reMin: -1.52, reMax: 0.16, imMin: -0.80, imMax: 0.88 } },
  { workId: 'petals', detail: { reMin: -0.27, reMax: 1.01, imMin: -0.36, imMax: 0.92 } },
] as const satisfies readonly {workId: LiveWorkId; detail: NumericViewport}[];

export const HOLD_MS = 3800;
export const APPROACH_MS = 5200;
export const DETAIL_MS = 4400;
export const PASSAGE_MS = 1200;
export const STOP_MS = HOLD_MS + APPROACH_MS + DETAIL_MS + PASSAGE_MS;
export const TOUR_MS = TOUR_STOPS.length * STOP_MS;
export type TourPhase = 'overview' | 'approach' | 'detail' | 'passage';

export function locateScene(elapsedMs: number) {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > TOUR_MS) {
    throw new Error('鑑賞時刻が順路の外にあります。');
  }
  const index = Math.min(TOUR_STOPS.length - 1, Math.floor(elapsedMs / STOP_MS));
  const stop = TOUR_STOPS[index];
  const within = elapsedMs - index * STOP_MS;
  let phase: TourPhase = 'overview';
  if (within >= HOLD_MS + APPROACH_MS + DETAIL_MS) phase = 'passage';
  else if (within >= HOLD_MS + APPROACH_MS) phase = 'detail';
  else if (within >= HOLD_MS) phase = 'approach';
  return { index, stop, within, phase };
}

/** Interpolate the four world edges, so a single rectangle drives both the image and its handoff. */
export function cameraAt(elapsedMs: number, reducedMotion: boolean): NumericViewport {
  const {phase, stop, within} = locateScene(elapsedMs);
  if (phase === 'overview' || (phase === 'approach' && reducedMotion)) return {...INITIAL_VIEWPORT};
  if (phase !== 'approach') return {...stop.detail};
  const fraction = (within - HOLD_MS) / APPROACH_MS;
  const eased = fraction * fraction * (3 - 2 * fraction);
  const edge = (key: keyof NumericViewport) => INITIAL_VIEWPORT[key] + eased * (stop.detail[key] - INITIAL_VIEWPORT[key]);
  return { reMin: edge('reMin'), reMax: edge('reMax'), imMin: edge('imMin'), imMax: edge('imMax') };
}

/** HTML image coordinates use a top-left origin and continuous pixel edges, not sample centres. */
export function cropOf(view: NumericViewport, imageSide: number) {
  const scale = imageSide / (INITIAL_VIEWPORT.reMax - INITIAL_VIEWPORT.reMin);
  return {
    x: (view.reMin - INITIAL_VIEWPORT.reMin) * scale,
    y: (INITIAL_VIEWPORT.imMax - view.imMax) * scale,
    width: (view.reMax - view.reMin) * scale,
    height: (view.imMax - view.imMin) * scale,
  };
}
