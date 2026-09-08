import './style.css';
import { COUNTDOWN, TRACK_LENGTH, RACE_METERS, simulateRace, sampleRace, trackPoint } from './simulation.js';
import { GameStore, STORAGE_KEY, initialState, newSeed, validateBet, placeBet, settleBet, nextRace } from './store.js';

const $ = selector => document.querySelector(selector);
const money = value => new Intl.NumberFormat('ja-JP').format(value);
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const conditionNames = { 2: 'まずまず', 3: '良好', 4: '好調', 5: '絶好調' };
let store, state, storageError = '';
try { store = new GameStore(localStorage); state = store.state; }
catch (error) { state = initialState(); storageError = error.message; }
let selected = state.pending?.horseId || null, amount = state.pending?.amount || 500;
let scene, ready = false, phase = 'betting', race = null, activeTicket = null, busy = false;
let lastUiTime = 0, lastFrame = 0, currentSamples, resultEntry = null, sound = null, lastCue = '';

$('#app').innerHTML = `
  <header class="site-header"><div class="header-inner">
    <a class="brand" href="./" aria-label="VERDANT ターフクラブ ホーム"><span class="brand-mark">♞</span><span>VERDANT<small>T U R F &nbsp; C L U B</small></span></a>
    <nav aria-label="メインメニュー"><button class="nav-link active" id="race-nav">レース</button><button class="nav-link" id="history-open">レース履歴 <span id="history-count">0</span></button><button class="nav-link" id="help-open">遊び方 <span class="question-mark">?</span></button></nav>
    <div class="wallet"><span class="coin-icon">V</span><div><small>所持コイン</small><strong id="balance">10,000</strong><span class="coin-unit"> coins</span></div></div>
  </div></header>
  <main>
    <section class="intro"><div><p class="eyebrow">YOUR RACE. YOUR MOMENT.</p><h1>その一瞬に、胸が躍る。</h1><p class="intro-caption">緑のターフで、あなただけの一頭を。</p></div><div class="venue-status"><span class="sun-symbol">☀</span><div><strong>青葉競馬場</strong><span>晴れ <i></i> 芝・良</span></div><span class="season-label">EARLY SUMMER<br>RACE MEETING</span></div></section>
    <div class="global-error" id="global-error" role="alert" hidden></div>
    <div class="game-layout">
      <section class="race-column" aria-label="レース映像と出走表">
        <div class="race-screen" id="race-screen">
          <div id="world" class="world"></div>
          <div class="scene-shade"></div>
          <div class="screen-top"><div class="race-badge"><span class="race-number" id="race-number">01<small>RACE</small></span><div><span class="live-status" id="live-status"><i></i> まもなく発走</span><h2 id="race-name">青葉の風ステークス</h2><p>芝 1,600m <b>｜</b> 右回り <b>｜</b> 8頭</p></div></div><div class="screen-tools"><button id="sound-toggle" aria-label="効果音をオン" title="効果音">♪<span class="sound-off">／</span></button><button id="fullscreen" aria-label="映像を拡大" title="映像を拡大">⛶</button></div></div>
          <div class="course-map"><canvas id="minimap" width="320" height="168" aria-label="コース上の各馬の位置"></canvas><span>AOBA RACECOURSE</span></div>
          <div class="scene-loading" id="scene-loading" role="status"><span class="loader"></span><strong>ターフを準備しています</strong><small>競馬場と出走馬を読み込み中…</small></div>
          <div class="countdown" id="countdown" aria-live="assertive" hidden></div>
          <div class="race-call" id="race-call" aria-live="polite" hidden></div>
          <div class="scene-bottom"><div class="scene-caption" id="scene-caption"><span class="tiny-label">THE GREEN IS CALLING.</span><strong>さあ、運命の一頭を。</strong><p>出走表で馬を選んで、レースに参加しよう。</p></div><div class="live-rank" id="live-rank" hidden></div><div class="camera-bar" role="group" aria-label="カメラ切り替え"><button data-camera="follow" aria-pressed="false"><span>◉</span> 追従</button><button data-camera="overhead" aria-pressed="false"><span>▦</span> 俯瞰</button><button data-camera="broadcast" class="active" aria-pressed="true"><span>▣</span> 中継</button></div></div>
          <div class="race-progress" id="race-progress" hidden><div class="progress-label"><span id="race-stage">スタート</span><span>残り <strong id="remaining">1,600</strong> m</span></div><div class="progress-track"><span id="progress-fill"></span></div></div>
        </div>
        <div class="scene-meta"><span><i class="green-dot"></i><span id="scene-status">出走受付中</span></span><span>3D LIVE RACING <b>·</b> <label for="quality">画質</label><select id="quality" aria-label="画質"><option value="high">高画質</option><option value="medium">標準</option><option value="low">軽量</option></select></span></div>
        <section class="entries-section"><div class="section-heading"><div><p class="eyebrow">RACE ENTRIES</p><h2 id="entries-title">出走表 <span>8頭</span></h2></div><p id="entries-hint">気になる馬を選択してください<span>単勝オッズは購入時に確定</span></p></div>
          <div class="entries-head"><span>選択</span><span>馬番・馬名</span><span>スピード</span><span>スタミナ</span><span>調子</span><span>脚質</span><span>単勝</span></div><div id="entries" role="group" aria-label="出走馬を選択"></div>
          <p class="entries-note">能力と調子をヒントに。展開と運が、レースの行方を変えます。</p>
        </section>
      </section>
      <aside class="side-column">
        <section class="ticket-panel" aria-label="購入内容"><div class="ticket-top"><span class="ticket-label">YOUR TICKET</span><span class="bet-type">単勝</span></div><h2 id="ticket-title">この一頭に、期待を。</h2><p class="ticket-description" id="ticket-description">1着になる馬を予想しましょう。</p>
          <div class="ticket-horse" id="ticket-horse"><span class="empty-horse">♞</span><div><strong>出走馬を選択</strong><small>下の出走表から1頭選んでください</small></div></div>
          <div id="purchase-form"><label class="amount-label" for="bet-amount">購入コイン<span>100コイン単位</span></label><div class="amount-control"><button id="amount-minus" aria-label="購入額を100コイン減らす">−</button><input id="bet-amount" type="number" min="100" step="100" inputmode="numeric" value="500" aria-describedby="bet-error"><span>coins</span><button id="amount-plus" aria-label="購入額を100コイン増やす">＋</button></div><div class="amount-presets"><button data-amount="100">100</button><button data-amount="500" class="active">500</button><button data-amount="1000">1,000</button><button data-amount="3000">3,000</button></div>
          <div class="ticket-math"><div><span>単勝オッズ</span><strong id="ticket-odds">—<small> 倍</small></strong></div><div><span>的中時の払戻</span><strong id="potential-payout">—<small> coins</small></strong></div></div>
          <div id="bet-error" class="bet-error" role="status"></div><button id="start-race" class="primary-button" disabled><span>購入してレース開始</span><span>→</span></button><p class="ticket-footnote">購入が確定すると、レースが始まります。</p></div>
          <div id="ticket-result" hidden></div><div class="ticket-perforation"></div><div class="ticket-bottom"><span>VERDANT TURF CLUB</span><span class="barcode">▥▥▥▥▥</span></div>
        </section>
        <section class="how-card"><span class="tiny-label">A LITTLE GUIDE</span><h3>ターフの楽しみ方</h3><ol><li><span>01</span><div><strong>一頭を選ぶ</strong><p>能力・調子・脚質をチェック。</p></div></li><li><span>02</span><div><strong>レースを見守る</strong><p>カメラを切り替えて、迫力を間近に。</p></div></li><li><span>03</span><div><strong>勝利の瞬間を楽しむ</strong><p>選んだ馬が1着なら、払戻！</p></div></li></ol></section>
        <div class="club-note"><span>♧</span><p>コインは、このターフの中だけ。<br>気軽に予想して、何度でも楽しもう。</p></div>
      </aside>
    </div>
    <footer><span>VERDANT <small>架空の競馬場で楽しむ、3Dレースゲーム。</small></span><button id="reset-open">データをリセット</button></footer>
  </main>
  <dialog id="help-dialog" aria-labelledby="help-title"><button class="dialog-close" data-close aria-label="遊び方を閉じる">×</button><p class="eyebrow">WELCOME TO THE TURF</p><h2 id="help-title">一頭を選んで、あとは夢中に。</h2><p>出走表から1頭を選び、100コイン単位で購入。「購入してレース開始」を押すと、約40秒のレースが始まります。</p><div class="help-styles"><div><b>逃げ</b><span>序盤から先頭へ</span></div><div><b>先行</b><span>好位置から抜け出す</span></div><div><b>差し</b><span>後半にペースアップ</span></div><div><b>追込</b><span>最後の直線で勝負</span></div></div><p>金色のリングと矢印が、購入した馬の目印。追従・俯瞰・中継の3つのカメラで応援できます。キーボードの <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> でも切り替えられます。</p><p>1着なら「購入額 × 確定オッズ」を小数点以下切り捨てで払い戻します。払戻には購入額が含まれます。コイン・購入中のレース・直近10件の結果はこのブラウザに自動保存。再読み込みしてもレースは続きます。</p><p>重く感じたら画質を「軽量」に。コインが100未満になったら、データをリセットして遊び直せます。実際のお金は使用しません。</p><button class="primary-button" data-close>ターフへ戻る <span>→</span></button></dialog>
  <dialog id="history-dialog" aria-labelledby="history-title"><button class="dialog-close" data-close aria-label="履歴を閉じる">×</button><p class="eyebrow">YOUR RACE RECORD</p><h2 id="history-title">レース履歴</h2><p>このブラウザに保存された直近10レース</p><div id="history-list"></div></dialog>
  <dialog id="reset-dialog" aria-labelledby="reset-title"><p class="eyebrow">A FRESH START</p><h2 id="reset-title">データをリセットしますか？</h2><p>所持金とレース履歴、進行中の購入を削除し、10,000コインから始めます。この操作は取り消せません。</p><div class="dialog-actions"><button data-close class="secondary-button">キャンセル</button><button id="reset-confirm" class="primary-button">リセットする</button></div></dialog>
  <div id="toast" class="toast" role="status" hidden></div>
`;

function showError(message) { $('#global-error').textContent = message; $('#global-error').hidden = false; }
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { $('#toast').hidden = true; }, 4300); }
function horseBadge(h) { return `<span class="number-badge" style="--silk:${h.silk};--ink:${[1, 5].includes(h.id) ? '#253b32' : '#fff'}">${h.id}</span>`; }
function renderEntries() {
  const ranking = resultEntry?.results;
  const horses = ranking ? ranking.map(r => state.card.horses[r.id - 1]) : state.card.horses;
  $('#entries').innerHTML = horses.map(h => `<button class="horse-row ${selected === h.id ? 'selected' : ''}" data-horse="${h.id}" aria-label="${h.id}番 ${escape(h.name)}、単勝${h.odds.toFixed(1)}倍" aria-pressed="${selected === h.id}" ${phase !== 'betting' ? 'disabled' : ''}>
    <span class="select-circle">${ranking ? ranking.find(r => r.id === h.id).rank : selected === h.id ? '✓' : ''}</span><span class="horse-identity">${horseBadge(h)}<span><strong>${escape(h.name)}</strong><small>${h.id % 2 ? '牡' : '牝'} ${3 + h.id % 3}歳 <i style="background:${h.coat}"></i>${['栗毛', '青鹿毛', '栗毛', '鹿毛', '芦毛', '栃栗毛', '金栗毛', '黒鹿毛'][h.id - 1]}<span class="mobile-style">・${h.style}</span></small></span></span>
    <span class="stat"><b>${h.speed}</b><span class="stat-track"><i style="width:${h.speed}%"></i></span></span><span class="stat stamina"><b>${h.stamina}</b><span class="stat-track"><i style="width:${h.stamina}%"></i></span></span><span class="condition condition-${h.condition}"><i></i>${conditionNames[h.condition]}</span><span class="style-tag">${h.style}</span><span class="odds">${h.odds.toFixed(1)}<small>倍</small></span></button>`).join('');
  $('#entries-title').innerHTML = ranking ? '確定着順 <span>8頭</span>' : '出走表 <span>8頭</span>';
  $('#entries-hint').innerHTML = ranking ? 'おつかれさまでした<span>次のレースで、また新しいドラマを。</span>' : '気になる馬を選択してください<span>単勝オッズは購入時に確定</span>';
}

function updateTicket() {
  const h = state.card.horses.find(h => h.id === selected);
  const ticket = state.pending || (phase === 'results' ? resultEntry : null);
  const locked = phase !== 'betting';
  $('#balance').textContent = money(state.balance); $('#history-count').textContent = state.history.length;
  $('#race-name').textContent = state.card.name; $('#race-number').innerHTML = `${String(state.round).padStart(2, '0')}<small>RACE</small>`;
  $('#ticket-horse').innerHTML = h ? `${horseBadge(h)}<div><strong>${escape(h.name)}</strong><small>${h.style} <b>·</b> ${conditionNames[h.condition]} ${locked ? '· 購入確定' : '· あなたの選んだ一頭'}</small></div><span class="selected-check">✓</span>` : '<span class="empty-horse">♞</span><div><strong>出走馬を選択</strong><small>出走表から1頭選んでください</small></div>';
  $('#ticket-horse').classList.toggle('has-horse', !!h);
  const actualAmount = ticket?.amount || amount, odds = ticket?.odds || h?.odds;
  if (document.activeElement !== $('#bet-amount') || locked) $('#bet-amount').value = actualAmount;
  $('#bet-amount').max = Math.floor(state.balance / 100) * 100;
  $('#ticket-odds').innerHTML = `${odds ? odds.toFixed(1) : '—'}<small> 倍</small>`;
  const validAmount = Number.isSafeInteger(actualAmount) && actualAmount >= 100 && actualAmount % 100 === 0;
  $('#potential-payout').innerHTML = `${odds && validAmount ? money(Math.floor(actualAmount * odds)) : '—'}<small> coins</small>`;
  document.querySelectorAll('#purchase-form input, #purchase-form button').forEach(el => { el.disabled = locked || busy; });
  document.querySelectorAll('[data-amount]').forEach(el => { el.classList.toggle('active', Number(el.dataset.amount) === actualAmount); el.disabled ||= Number(el.dataset.amount) > state.balance; });
  const error = validateBet(state, selected, amount);
  $('#bet-error').textContent = locked ? '' : error;
  $('#start-race').disabled = !!error || locked || !ready || busy || !!storageError;
  $('#start-race').innerHTML = locked ? '<span class="button-spinner"></span><span>レース進行中</span>' : '<span>購入してレース開始</span><span>→</span>';
  $('#ticket-title').textContent = locked ? 'あなたの一頭を、応援。' : 'この一頭に、期待を。';
  $('#ticket-description').textContent = locked ? '購入内容は確定しています。' : '1着になる馬を予想しましょう。';
  $('#purchase-form').hidden = phase === 'results';
  $('#ticket-result').hidden = phase !== 'results';
}

function setCamera(mode) {
  if (scene) scene.mode = mode;
  document.querySelectorAll('[data-camera]').forEach(button => { const active = button.dataset.camera === mode; button.classList.toggle('active', active); button.setAttribute('aria-pressed', active); });
}

function startPlayback(ticket, showNotice = false, calculatedRace = null) {
  activeTicket = ticket; selected = ticket.horseId; amount = ticket.amount;
  race = calculatedRace || simulateRace(state.card, ticket.seed); phase = 'racing'; resultEntry = null;
  $('#scene-caption').hidden = true; $('#race-progress').hidden = false; $('#live-rank').hidden = false;
  $('#scene-status').textContent = '購入確定・レース進行中'; $('#live-status').innerHTML = '<i></i> LIVE RACE';
  renderEntries(); updateTicket();
  if (showNotice) toast('保存された購入内容でレースを再開しました。');
}

async function buy() {
  if (busy || phase !== 'betting' || !ready || storageError) return;
  const error = validateBet(state, selected, amount); if (error) { $('#bet-error').textContent = error; return; }
  busy = true; updateTicket();
  try {
    const seed = newSeed();
    // Complete deterministic calculation before any debit; failed initialization costs no coins.
    const preview = simulateRace(state.card, seed);
    state = await store.update(current => {
      if (current.round !== state.round || current.card.seed !== state.card.seed) throw new Error('別のタブでレースが更新されました。再読み込みしてください。');
      return placeBet(current, selected, amount, seed, Date.now());
    });
    startPlayback(state.pending, false, preview); cue('start');
    if (window.innerWidth < 850) $('#race-screen').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { showError(`購入できませんでした。${error.message}`); }
  finally { busy = false; updateTicket(); }
}

async function finishRace() {
  if (phase !== 'racing' || busy) return;
  busy = true;
  try {
    const ticketId = activeTicket.id;
    state = await store.update(current => settleBet(current, ticketId, race.results, Date.now()));
    const entry = state.history.find(h => h.id === ticketId);
    if (entry) showResult(entry);
    else syncExternal();
  } catch (error) {
    phase = 'settlement-error'; showError('払戻を保存できませんでした。空き容量や保存設定を確認し、再読み込みしてください。購入記録は保持されています。');
  } finally { busy = false; }
}

function showResult(entry) {
  resultEntry = entry; phase = 'results'; selected = entry.horseId;
  $('#scene-caption').hidden = true; $('#race-progress').hidden = false; $('#live-rank').hidden = false;
  $('#countdown').hidden = true; $('#race-call').hidden = true;
  const winner = entry.card.horses[entry.results[0].id - 1], rank = entry.results.find(r => r.id === entry.horseId).rank;
  $('#ticket-title').textContent = entry.payout ? 'おめでとう、見事的中！' : '次のドラマが、待っている。';
  $('#ticket-result').innerHTML = `<div class="result-verdict ${entry.payout ? 'won' : ''}"><span>${entry.payout ? 'WINNING TICKET' : 'RACE FINISHED'}</span><h3>${entry.payout ? '単勝 的中！' : `あなたの馬は ${rank}着`}</h3></div><div class="result-winner"><small>1着</small>${horseBadge(winner)}<strong>${escape(winner.name)}</strong><span>${entry.results[0].time.toFixed(2)}<small>秒</small></span></div><dl class="result-math"><div><dt>購入額 × 確定オッズ</dt><dd>${money(entry.amount)} × ${entry.odds.toFixed(1)}</dd></div><div><dt>払戻コイン</dt><dd class="payout-value">${money(entry.payout)}<small> coins</small></dd></div><div><dt>今回の収支</dt><dd>${entry.payout - entry.amount >= 0 ? '+' : '−'}${money(Math.abs(entry.payout - entry.amount))}</dd></div></dl><button id="next-race" class="primary-button">次のレースへ <span>→</span></button><p class="ticket-footnote">結果とコインを保存しました</p>`;
  $('#live-status').innerHTML = '<i></i> RACE FINISHED'; $('#scene-status').textContent = `レース確定・払戻 ${money(entry.payout)} コイン`;
  $('#race-stage').textContent = 'ゴール・全着順確定'; $('#remaining').textContent = '0'; $('#progress-fill').style.width = '100%';
  renderEntries(); updateTicket();
  $('#ticket-title').textContent = entry.payout ? 'おめでとう、見事的中！' : '次のドラマが、待っている。';
  $('#ticket-description').textContent = 'このレースの結果が確定しました。';
  $('#next-race').addEventListener('click', advanceRace);
  cue(entry.payout ? 'win' : 'finish');
}

async function advanceRace() {
  if (busy || phase !== 'results') return;
  busy = true;
  try { state = await store.update(current => {
    if (current.round !== state.round) return current;
    return nextRace(current, newSeed());
  }); resetView(); }
  catch (error) { showError(error.message); }
  finally { busy = false; updateTicket(); }
}

function resetView() {
  phase = 'betting'; selected = null; activeTicket = null; race = null; resultEntry = null; amount = state.balance >= 500 ? 500 : 100;
  $('#scene-caption').hidden = false; $('#race-progress').hidden = true; $('#live-rank').hidden = true;
  $('#countdown').hidden = true; $('#race-call').hidden = true; $('#scene-status').textContent = '出走受付中';
  $('#live-status').innerHTML = '<i></i> まもなく発走'; $('#global-error').hidden = true;
  scene?.setHorses(state.card.horses); renderEntries(); updateTicket();
}

function syncExternal() {
  try {
    const incoming = store.read(), previous = state.card.seed; state = incoming;
    if (previous !== state.card.seed) { scene?.setHorses(state.card.horses); }
    if (state.pending) {
      if (activeTicket?.id !== state.pending.id) startPlayback(state.pending, true);
    } else if (state.history[0]?.card.round === state.round) {
      const entry = state.history[0];
      if (!race || race.seed !== entry.seed) race = simulateRace(entry.card, entry.seed);
      activeTicket = entry; showResult(entry);
    } else resetView();
    updateTicket();
  } catch (error) { showError(error.message); }
}

function drawMinimap(samples) {
  const canvas = $('#minimap'), ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, 320, 168);
  ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 14; ctx.beginPath();
  for (let i = 0; i <= 160; i++) { const p = trackPoint(i / 160 * TRACK_LENGTH); const x = 160 + p.x * 1.34, y = 80 + p.z * 1.34; if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.closePath(); ctx.stroke();
  ctx.fillStyle = '#fbf8e8'; ctx.fillRect(158, 125, 4, 20);
  samples.forEach((s, i) => { const p = trackPoint(s.d, s.lane * .65); ctx.fillStyle = selected === i + 1 ? '#f4cf76' : state.card.horses[i].silk;
    ctx.beginPath(); ctx.arc(160 + p.x * 1.34, 80 + p.z * 1.34, selected === i + 1 ? 6 : 4, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = 'rgba(20,43,29,.7)'; ctx.lineWidth = 1.5; ctx.stroke(); });
}

function renderRaceUi(samples, elapsed) {
  const finished = race.results.filter(r => r.time <= elapsed);
  const ranks = [...finished.map(r => r.id), ...samples.map((s, i) => ({ ...s, id: i + 1 })).filter(h => !finished.some(r => r.id === h.id)).sort((a, b) => b.d - a.d || a.id - b.id).map(h => h.id)];
  $('#live-rank').innerHTML = `<span class="ranking-label">${finished.length === 8 ? '確定着順' : '現在の順位'}</span><div>${ranks.map((id, i) => `<span class="rank-chip ${id === selected ? 'my-horse' : ''}"><small>${i + 1}</small>${horseBadge(state.card.horses[id - 1])}</span>`).join('')}</div>`;
  const progress = Math.min(1, Math.max(...samples.map(s => s.d)) / TRACK_LENGTH);
  $('#remaining').textContent = money(Math.ceil((1 - progress) * RACE_METERS));
  $('#progress-fill').style.width = `${progress * 100}%`;
  $('#race-stage').textContent = finished.length ? `ゴール！ ${finished.length}/8頭` : progress > .75 ? 'ラストスパート' : progress > .45 ? '勝負は後半へ' : progress > .12 ? 'ポジション争い' : 'スタート';
  let call = '';
  if (elapsed >= 0 && elapsed < 1.7) call = 'さあ、スタート！';
  else if (progress > .75 && progress < .80) call = 'ラストスパート！';
  else if (finished.length && elapsed - race.results[0].time < 2.8) call = `${finished[0].id}番 ${state.card.horses[finished[0].id - 1].name}、ゴール！`;
  $('#race-call').textContent = call; $('#race-call').hidden = !call;
  drawMinimap(samples);
}

function cue(type) {
  if (!sound) return;
  const context = sound, now = context.currentTime;
  const tones = type === 'win' ? [523, 659, 784, 1047] : type === 'finish' ? [659, 784] : [type === 'start' ? 660 : 480];
  tones.forEach((frequency, i) => {
    const osc = context.createOscillator(), gain = context.createGain(); osc.type = 'sine'; osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0, now + i * .14); gain.gain.linearRampToValueAtTime(.055, now + i * .14 + .01); gain.gain.exponentialRampToValueAtTime(.001, now + i * .14 + .23);
    osc.connect(gain); gain.connect(context.destination); osc.start(now + i * .14); osc.stop(now + i * .14 + .25);
  });
}

function frame(timestamp) {
  const dt = Math.min((timestamp - lastFrame) / 1000 || .016, .1); lastFrame = timestamp;
  let elapsed = 0;
  if (race && activeTicket) {
    elapsed = phase === 'results' ? race.duration : Math.max(-COUNTDOWN, (Date.now() - activeTicket.startedAt) / 1000 - COUNTDOWN);
    currentSamples = sampleRace(race, elapsed);
    if (phase === 'results' || phase === 'settlement-error') currentSamples = currentSamples.map(s => ({ ...s, v: 0 }));
    if (phase === 'racing') {
      $('#countdown').hidden = elapsed >= 0;
      if (elapsed < 0) {
        const number = String(Math.ceil(-elapsed));
        $('#countdown').innerHTML = `<small>GET READY</small><strong>${number}</strong><span>まもなく発走</span>`;
        if (lastCue !== number) { cue('countdown'); lastCue = number; }
      }
      if (elapsed >= race.duration + 1.6) finishRace();
    }
  } else currentSamples = state.card.horses.map((h, i) => ({ d: 0, lane: (i - 3.5) * 1.7, v: 0 }));
  if (timestamp - lastUiTime > 120) {
    if (race) renderRaceUi(currentSamples, elapsed); else drawMinimap(currentSamples);
    lastUiTime = timestamp;
  }
  try { scene.update(currentSamples, race ? Math.max(0, elapsed) : timestamp / 1000, dt, !!race && elapsed >= 0, selected, elapsed); }
  catch (error) { scene.renderer.setAnimationLoop(null); ready = false; showError(`3D映像の表示に失敗しました。再読み込みしてください。${error.message}`); updateTicket(); }
}

$('#entries').addEventListener('click', event => {
  const button = event.target.closest('[data-horse]'); if (!button || phase !== 'betting' || busy) return;
  selected = Number(button.dataset.horse); renderEntries(); updateTicket();
});
$('#bet-amount').addEventListener('input', event => { amount = event.target.value === '' ? 0 : Number(event.target.value); updateTicket(); });
$('#amount-minus').addEventListener('click', () => { amount = Math.max(100, (Math.ceil(amount / 100) - 1) * 100); updateTicket(); });
$('#amount-plus').addEventListener('click', () => { amount = Math.min(Math.floor(state.balance / 100) * 100, (Math.floor(amount / 100) + 1) * 100); updateTicket(); });
document.querySelectorAll('[data-amount]').forEach(button => button.addEventListener('click', () => { amount = Number(button.dataset.amount); updateTicket(); }));
$('#start-race').addEventListener('click', buy);
document.querySelectorAll('[data-camera]').forEach(button => button.addEventListener('click', () => setCamera(button.dataset.camera)));
window.addEventListener('keydown', event => { if (['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName) || document.querySelector('dialog[open]')) return; const mode = { 1: 'follow', 2: 'overhead', 3: 'broadcast' }[event.key]; if (mode) setCamera(mode); });
$('#quality').value = state.quality;
$('#quality').addEventListener('change', async event => {
  scene?.setQuality(event.target.value);
  try { state = await store.update(current => ({ ...current, quality: event.target.value })); }
  catch { showError('画質設定を保存できませんでした。このページでは設定を適用しています。'); }
});
$('#sound-toggle').addEventListener('click', async () => {
  if (sound) { await sound.close(); sound = null; } else { const Audio = window.AudioContext || window.webkitAudioContext; if (Audio) { sound = new Audio(); await sound.resume(); cue('start'); } }
  $('#sound-toggle').setAttribute('aria-label', sound ? '効果音をオフ' : '効果音をオン'); $('#sound-toggle').classList.toggle('sound-enabled', !!sound);
});
$('#fullscreen').addEventListener('click', async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else if ($('#race-screen').requestFullscreen) await $('#race-screen').requestFullscreen(); else $('#race-screen').classList.toggle('theater'); }
  catch { $('#race-screen').classList.toggle('theater'); }
  $('#fullscreen').setAttribute('aria-label', document.fullscreenElement || $('#race-screen').classList.contains('theater') ? '映像の拡大を終了' : '映像を拡大');
});
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } }));
$('#help-open').addEventListener('click', () => $('#help-dialog').showModal());
$('#race-nav').addEventListener('click', () => $('#race-screen').scrollIntoView({ behavior: 'smooth', block: 'center' }));
$('#history-open').addEventListener('click', () => {
  $('#history-list').innerHTML = state.history.length ? state.history.map(entry => `<article class="history-item"><div><small>第${entry.card.round}レース <span>${new Date(entry.settledAt).toLocaleDateString('ja-JP')}</span></small><strong>${escape(entry.card.name)}</strong><p>${entry.horseId}番 ${escape(entry.card.horses[entry.horseId - 1].name)} · ${money(entry.amount)} coins × ${entry.odds.toFixed(1)}倍</p><p>1着：${entry.results[0].id}番 ${escape(entry.card.horses[entry.results[0].id - 1].name)}</p></div><div class="history-payout ${entry.payout ? 'won' : ''}"><span>${entry.payout ? '的中' : '不的中'}</span><strong>${money(entry.payout)}</strong><small>払戻 coins</small></div></article>`).join('') : '<div class="empty-history"><span>♞</span><h3>最初のドラマは、これから。</h3><p>レースを終えると、ここに結果が残ります。</p></div>';
  $('#history-dialog').showModal();
});
$('#reset-open').addEventListener('click', () => $('#reset-dialog').showModal());
$('#reset-confirm').addEventListener('click', async () => {
  if (busy) return; busy = true; $('#reset-confirm').disabled = true;
  try {
    if (!store) store = Object.assign(Object.create(GameStore.prototype), { storage: localStorage });
    state = await store.reset(); storageError = ''; resetView(); $('#quality').value = state.quality; scene?.setQuality(state.quality);
    $('#reset-dialog').close(); toast('10,000コインで、新しいスタート。');
  } catch { showError('データを保存できません。ブラウザのサイトデータ保存を許可してから再読み込みしてください。'); }
  finally { busy = false; $('#reset-confirm').disabled = false; updateTicket(); }
});
window.addEventListener('storage', event => { if (event.key === STORAGE_KEY && store) syncExternal(); });

renderEntries(); updateTicket();
if (storageError) showError(storageError);

async function init() {
  try {
    const { RaceScene } = await import('./scene.js');
    scene = new RaceScene($('#world'), state.card.horses, state.quality, message => { ready = false; showError(message); updateTicket(); });
    scene.update(state.card.horses.map((h, i) => ({ d: 0, lane: (i - 3.5) * 1.7, v: 0 })), 0, .016, false, selected);
    ready = true; $('#scene-loading').hidden = true; updateTicket();
    if (state.pending) startPlayback(state.pending, true);
    else if (state.history[0]?.card.round === state.round) {
      const entry = state.history[0]; race = simulateRace(entry.card, entry.seed); activeTicket = entry; showResult(entry);
    }
    scene.renderer.setAnimationLoop(frame);
  } catch (error) {
    ready = false;
    $('#scene-loading').innerHTML = '<strong>3D映像を読み込めませんでした</strong><small>WebGL対応のブラウザを使用し、再読み込みしてください。</small><button class="secondary-button" id="retry-load">再読み込み</button>';
    $('#retry-load').addEventListener('click', () => location.reload());
    showError(`競馬場の読み込みに失敗しました。コインは消費されません。${error.message}`);
  }
}
init();
