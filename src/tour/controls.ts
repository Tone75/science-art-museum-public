import { LIVE_WORKS } from '../art/works.ts';
import type { TourSnapshot } from './player.ts';

/** Only the route or a change of scene updates the room labels. Rendering another frame does not move focus. */
export function updateTourControls(state: TourSnapshot, hasEditor: boolean): void {
  const room = document.getElementById('tour')!;
  const button = (id: string) => document.getElementById(id) as HTMLButtonElement;
  const text = (id: string, value: string) => {
    const node = document.getElementById(id)!;
    if (node.textContent !== value) node.textContent = value;
  };
  const work = LIVE_WORKS.find(item => item.id === state.displayed?.workId);
  const ended = state.status === 'ended';
  const paused = state.status === 'paused';
  const failed = state.status === 'error';
  const pause = button('tour-pause');
  const replay = button('tour-replay');
  const focusReplay = ended && document.activeElement === pause && !room.hidden;
  room.dataset.status = state.status;
  room.dataset.phase = state.phase;
  room.dataset.workId = work?.id ?? '';
  text('tour-title', work?.title ?? 'Julia Garden');
  text('tour-position', work ? [LIVE_WORKS.indexOf(work) + 1, LIVE_WORKS.length].join(' / ') : '');
  const next = work && LIVE_WORKS[LIVE_WORKS.indexOf(work) + 1];
  const phase = {
    overview: state.reducedMotion ? '静止鑑賞' : '全景',
    approach: state.reducedMotion ? '静止鑑賞' : ({tide: '渦がほどける', twin: '輪郭がうねる', petals: '花片がひらく'}[work?.id ?? 'tide']),
    detail: state.reducedMotion ? '静止鑑賞' : '模様を眺める',
    passage: next ? '次は「' + next.title + '」へ' : '最後の一枚',
  };
  text('tour-phase', work ? phase[state.phase] : '');
  text('tour-pause', failed ? 'この場面を再試行' : paused ? '鑑賞を再開' : '一時停止');
  text('tour-exit', ended ? 'Galleryへ戻る' : '鑑賞を終了');
  pause.hidden = ended;
  replay.hidden = !ended;
  button('tour-takeover').disabled = !state.displayed;
  button('tour-return').hidden = !hasEditor;
  let message = '';
  if (ended) message = '三作品を巡り終えました。';
  else if (failed) message = state.error ?? 'この場面を用意できませんでした。';
  else if (paused) message = state.pausedBy === 'hidden' ? '画面を離れたため、鑑賞を一時停止しました。' : 'この場面で一時停止しています。';
  else if (state.status === 'loading') message = '作品を用意しています。';
  text('tour-status', message);
  if (focusReplay) replay.focus({preventScroll:true});
}
