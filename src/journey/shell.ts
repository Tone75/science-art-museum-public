import { LIVE_WORKS } from '../art/works.ts';
import { POP_PALETTES, ARCHIVE_PALETTES } from '../art/palette.ts';
import { UX_PRESETS } from '../ux-state.ts';

const workChoices = LIVE_WORKS.map(work => `
  <article class="gallery-work" data-work-id="${work.id}">
    <button class="work-choice" id="work-${work.id}" data-work-id="${work.id}" type="button">
      <span class="work-image"><img src="${work.image}" width="768" height="768" alt="${work.title}の初期構図" /></span>
      <span class="work-caption"><span class="work-name">${work.title}</span><span class="work-note">${work.note}</span>
        <span class="work-link">この作品から始める <span aria-hidden="true">↗</span></span></span>
    </button>
    <p id="work-image-error-${work.id}" class="image-error" role="status" hidden>
      作品画像を読み込めませんでした。<button id="work-image-retry-${work.id}" type="button">画像を読み直す</button>
    </p>
  </article>`).join('');

const renderPaletteButtons = (list: readonly { id: string; note: string }[], extraClass = '') => list.map(p => `
  <button id="palette-${p.id}" type="button" class="palette${extraClass ? ' ' + extraClass : ''}" aria-pressed="false">
    <span class="palette-swatch ${p.id}" aria-hidden="true"></span><span>${p.note}</span>
  </button>`).join('');

const popPalettes = renderPaletteButtons(POP_PALETTES, 'palette-pop');
const archivePalettes = renderPaletteButtons(ARCHIVE_PALETTES, 'palette-archive');

export const museumShell = `
<a class="skip-link" href="#main-content">作品と操作へ移動</a>
<header class="masthead">
  <a class="brand" href="#/gallery"><span aria-hidden="true" class="brand-mark">∿</span> Science × Art Museum</a>
  <span lang="ja">数式で遊ぶ美術館</span>
</header>
<div id="main-content" tabindex="-1">
  <section id="gallery" aria-labelledby="gallery-title">
    <div class="gallery-intro"><div><p class="section-caption">常設展示</p><h1 id="gallery-title">Julia <em>Garden</em></h1></div>
      <div class="gallery-tour-entry"><p class="gallery-lead">ひとつの数式から生まれた三作品。<br>気になる一枚を選び、形、色、構図を変えてください。</p>
        <button type="button" id="tour-start"><span aria-hidden="true">▷</span> 三作品を自動で巡る</button>
      </div></div>
    <div class="resume-line" hidden id="resume-line"><button type="button" id="resume-work">編集中の作品へ戻る <span aria-hidden="true">→</span></button><span id="resume-label"></span>
      <button type="button" id="gallery-restore-edit" hidden>巡回前の制作へ戻る</button></div>
    <div class="work-grid">${workChoices}</div>
  </section>
  <section id="tour" aria-labelledby="tour-title" hidden>
    <figure class="tour-work">
      <canvas id="tour-canvas" width="768" height="768" role="img" aria-labelledby="tour-title" aria-describedby="tour-phase"></canvas>
      <figcaption class="tour-label">
        <div class="tour-caption">
          <p class="tour-progress">自動鑑賞 <span id="tour-position"></span></p>
          <h1 id="tour-title" tabindex="-1" aria-live="polite" aria-atomic="true">Julia Garden</h1>
          <p id="tour-phase"></p>
        </div>
        <div class="tour-controls" role="group" aria-label="自動鑑賞の操作">
          <button type="button" id="tour-pause">一時停止</button>
          <button type="button" id="tour-replay" hidden>もう一度巡る</button>
          <button type="button" id="tour-takeover" aria-describedby="tour-takeover-help">自分で動かす <span aria-hidden="true">↗</span></button>
          <div class="tour-navigation">
            <button type="button" id="tour-return" hidden>元の制作へ戻る</button>
            <button type="button" id="tour-exit">鑑賞を終了</button>
          </div>
        </div>
        <div class="tour-notes">
          <p id="tour-status" role="status"></p>
          <p id="tour-takeover-help">いま見えている形と構図を引き継いで、確定した一枚を保存できます。</p>
        </div>
      </figcaption>
    </figure>
  </section>
  <section id="exhibit" aria-labelledby="live-work-title" hidden>
    <div class="exhibit-heading">
      <div class="work-heading"><nav class="breadcrumb" aria-label="現在地"><a href="#/gallery" id="back-gallery">← Gallery</a><span>/</span> Julia Garden</nav>
      <h1 id="live-work-title" tabindex="-1">潮目</h1></div>
      <div class="artwork-actions">
        <div class="artwork-action-buttons"><button type="button" id="save-entry" aria-describedby="save-eligibility">作品を保存</button>
        <button type="button" id="load-entry">設定を読み込む</button></div>
        <button type="button" id="restore-edit" hidden>巡回前の制作へ戻る</button>
        <input id="artwork-file" type="file" accept="application/json,.json" hidden>
        <p id="save-eligibility" role="status"></p><p id="saved-target-note" hidden></p><p id="load-state" role="status"></p>
        <button type="button" id="load-cancel" hidden>読込を中止</button>
      </div>
    </div>
    <div id="live-workspace" class="studio">
      <figure class="art-frame">
        <div id="canvas-stage"><canvas id="art-canvas" width="256" height="256" tabindex="0" role="group" aria-label="Julia像。ドラッグまたは矢印で構図を移動"></canvas>
          <p id="art-placeholder">作品を描いています…</p></div>
        <figcaption><p id="display-settings"></p><p id="ux-status" role="status" aria-live="polite"></p></figcaption>
      </figure>
      <aside class="creation-panel" aria-label="作品を編集">
        <section class="tool"><h2 id="parameter-title">形を探す</h2>
          <p class="hint" id="parameter-map-help">地図をなぞると形が変わります。矢印でも選べます。</p>
          <div id="parameter-map-frame" class="parameter-map-frame">
            <canvas id="parameter-map" width="288" height="192" tabindex="0" role="group" aria-label="形を変える地図" aria-describedby="parameter-map-help parameter-status"></canvas>
            <span id="parameter-marker" class="parameter-marker" hidden></span><span id="parameter-candidate-marker" class="parameter-marker candidate-marker" hidden></span>
            <div id="parameter-map-placeholder">地図を読み込んでいます…</div></div>
          <button id="parameter-map-retry" type="button" hidden>地図を読み直す</button>
          <p id="parameter-status" role="status"></p><p id="parameter-pending" hidden></p>
        </section>
        <section class="tool"><h2>色を選ぶ</h2><div class="palette-list">${popPalettes}</div>
          <p class="palette-group-label">アーカイブ配色</p><div class="palette-list palette-archive-list">${archivePalettes}</div></section>
        <section class="tool"><h2>構図を選ぶ</h2><p class="hint">作品の中をドラッグして、見たい場所へ。</p>
          <div class="composition-controls"><div class="framing-zoom"><button id="zoom-out" type="button" aria-label="構図を一段階縮小">−</button>
          <output id="zoom-level">全景</output><button id="zoom-in" type="button" aria-label="構図を一段階拡大">＋</button>
          <button id="reset-composition" type="button">構図を戻す</button></div>
          <div class="framing-pan" role="group" aria-label="構図を移動">${[['up','上','↑'],['left','左','←'],['right','右','→'],['down','下','↓']].map(([id,dir,arrow])=>`<button id="pan-${id}" type="button" aria-label="構図を${dir}へ">${arrow}</button>`).join('')}</div>
          </div><p id="zoom-limit-reason" class="hint"></p>
          <p id="framing-status" role="status"></p>
        </section>
        <div class="render-actions"><button id="stop-render" type="button">計算を停止</button><button id="recalculate" type="button">再計算</button><button id="retry" type="button" hidden>もう一度描く</button></div>
        <p id="draft-notice" role="status" hidden>数値入力に未適用の値があります。</p>
        <details id="parameter-details"><summary>形の数値・プリセット</summary>
          <form id="parameter-form"><label>実部 re<input id="parameter-re" type="text" autocomplete="off" spellcheck="false" inputmode="decimal"></label>
          <label>虚部 im<input id="parameter-im" type="text" autocomplete="off" spellcheck="false" inputmode="decimal"></label><button id="parameter-apply">このcを適用</button></form>
          <p class="hint">適用済み c = <output id="parameter-applied-c"></output></p>
          <div class="preset-list">${UX_PRESETS.map((p,i)=>`<button id="preset-${i}" type="button" aria-pressed="false">${p.name}</button>`).join('')}</div>
          <p class="hint">プリセットは形だけを変えます。地図上の矢印は0.01、Shift＋矢印は0.1ずつ移動します。</p></details>
        <details id="display-options"><summary>描画の設定</summary>
          <p>確定像の解像度</p><div class="quality-list"><button id="quality-preview" type="button">256 × 256</button><button id="quality-full" type="button">768 × 768</button></div>
          <p>反復上限 N</p><div class="iteration-list">${[128,256,512].map(n=>`<button id="iteration-${n}" type="button">${n}</button>`).join('')}</div>
          <p class="hint">反復上限が変わると、未脱出の分類や色が変わる場合があります。</p>
          <p id="requested-settings"></p><dl><dt>選択したc</dt><dd id="selected-c"></dd><dt>表示中のc</dt><dd id="shown-c"></dd><dt>選択した範囲</dt><dd id="selected-viewport"></dd><dt>表示中の範囲と反復上限</dt><dd id="shown-viewport"></dd></dl>
        </details>
        <div class="work-actions"><button id="parameter-restore" type="button">作品の初期状態へ戻す</button><a id="choose-work" href="#/gallery">別の作品を選ぶ ↗</a></div>
      </aside>
    </div>
    <details id="explanation"><summary>この庭のしくみ</summary>
      <p>地図では画素ごとにパラメータcを変え、初期値z₀=0から計算します。作品では、選んだcをすべての画素で固定し、各画素の位置を初期値z₀にします。構図を動かす操作は、この初期値の平面のどこを見るかを変えます。配色は計算後に選べます。</p>
      <details id="math-details"><summary>数式と有限計算</summary>
        <p class="equation">zₙ₊₁ = zₙ² + c</p>
        <p>n=0から指定反復数Nまで、最初に |zₙ| &gt; 2 となる回数を色へ対応させています。Nで初めて脱出した場合と、指定反復数まで未脱出の場合は区別します。</p>
        <p>自動鑑賞では、各場面で画面全体に共通の値 c を少しずつ変え、同じ座標範囲の模様を描き直します。</p>
        <p>充填ジュリア集合K<sub>c</sub>は有界な軌道を持つ初期値の集合で、その境界J<sub>c</sub> = ∂K<sub>c</sub>をジュリア集合と呼びます。有限反復・有限精度の観測だけでは、厳密な集合所属や連結性は判定できません。</p>
        <p>地図はN128の固定像です。選択範囲は地図の矩形内かつ|c|≤2。Julia像は画素中心で計算し、初期全景は両軸−1.6から1.6、構図の幅は0.25〜3.2、端点は−4〜4です。</p>
      </details>
    </details>
  </section>
</div>
<footer><a href="#/gallery">Science × Art Museum</a><span>Julia Garden</span></footer>
<dialog id="save-dialog" aria-labelledby="save-title">
  <div class="save-dialog-body">
    <div class="save-dialog-heading"><h2 id="save-title">この一枚を残す</h2><button id="save-close" type="button">閉じる <span aria-hidden="true">×</span></button></div>
    <div class="save-subject"><p id="save-settings"></p><p id="save-target-note"></p></div>
    <div class="save-downloads">
      <button id="save-png" type="button" disabled><strong>PNGを取得</strong><small>作品の画像</small></button>
      <button id="save-json" type="button" disabled><strong>設定JSONを取得</strong><small>同じ構図を再現</small></button>
    </div>
    <p id="save-status" role="status"></p>
    <div class="save-secondary-actions"><button id="save-capture" type="button">今の確定表示で作り直す</button><button id="save-release" type="button">保存対象を解放</button></div>
    <p id="save-capture-reason"></p>
  </div>
</dialog>`;
