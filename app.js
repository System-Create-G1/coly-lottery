const GAS_URL = 'https://script.google.com/macros/s/AKfycbysYIZqwMkaELnuDgFCxy_KfjP_0jxWmJE-2kJclgNQLImtMmfI2SWdHEsRiIb-ONy6LA/exec';
const LOCAL_KEY = 'coly_lottery_local_v1';
const CARD_COUNT = 3;
const MAX_DAY = 7;

const IP_TITLES = {
  matorihime: 'ドラッグ王子とマトリ姫',
  stanmai: 'スタンドマイヒーローズ',
};
const IP_LOGOS = {
  matorihime: 'image/matori_logo.png',
  stanmai: 'image/stamy_logo.png',
};
const IP_WAIT_LINES = {
  matorihime: 'ちょっと待て、いま準備中だ…',
  stanmai: '準備はいいか？もうすぐだ…',
};
function renderIpTagLogo(el, ip) {
  el.innerHTML = `<img class="ip-tag-logo" src="${IP_LOGOS[ip] || ''}" alt="${IP_TITLES[ip] || ''}">`;
}

function defaultLocalConfig() {
  return {
    background: null,
    cardBack: null,
    sounds: { matorihime: {}, stanmai: {} }, // ip -> { 賞品名: soundDataURL }
  };
}

/* ── ローカル専用設定（背景・トランプ柄・効果音。端末ごと） ── */
function loadLocalConfig() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) return Object.assign(defaultLocalConfig(), JSON.parse(raw));
  } catch (e) {}
  return defaultLocalConfig();
}
function saveLocalConfig() {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(config));
  } catch (e) {
    alert('保存容量の上限を超えた可能性があります。背景・効果音のファイルサイズを小さくしてお試しください。');
  }
}

let config = loadLocalConfig();
function emptyPrizesByIpDay() {
  const o = {};
  ['matorihime', 'stanmai'].forEach((ip) => {
    o[ip] = {};
    for (let d = 1; d <= MAX_DAY; d++) o[ip][d] = [];
  });
  return o;
}
let serverState = { prizesByIpDay: emptyPrizesByIpDay(), maxDraws: 20, currentDay: 1, days: [] };
let drawing = false;

let currentIp = null;
let sessionMaxDraws = 0;
let sessionDrawsDone = 0;
let sessionResults = {}; // name -> count

const $ = (id) => document.getElementById(id);

const ipSelectScreen = $('ipSelectScreen');
const countSelectScreen = $('countSelectScreen');
const appEl = $('app');
const sessionResultScreen = $('sessionResultScreen');

const ipTag = $('ipTag');
const countIpTag = $('countIpTag');
const sessionIpTag = $('sessionIpTag');
const ipLoadingLine = $('ipLoadingLine');
const ipLoadingText = $('ipLoadingText');
const roundTag = $('roundTag');
const countGrid = $('countGrid');
const stage = $('stage');
const resultText = $('resultText');
const sessionResultList = $('sessionResultList');
const backToStartBtn = $('backToStartBtn');

/* ── GASバックエンド通信 ── */
const GAS_TIMEOUT_MS = 20000;

function gasFetchOnce(url, options) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GAS_TIMEOUT_MS);
  return fetch(url, { ...options, signal: ctrl.signal })
    .then((res) => res.json())
    .finally(() => clearTimeout(timer));
}

function gasFetchWithRetry(url, options) {
  return gasFetchOnce(url, options).catch((e) => {
    console.warn('GAS通信失敗、1回だけ再試行します', e);
    return new Promise((resolve) => setTimeout(resolve, 800)).then(() =>
      gasFetchOnce(url, options)
    );
  });
}

function gasGet(action, params) {
  const url = new URL(GAS_URL);
  url.searchParams.set('action', action);
  Object.keys(params || {}).forEach((k) => url.searchParams.set(k, params[k]));
  return gasFetchWithRetry(url.toString());
}
function gasPost(body) {
  return gasFetchWithRetry(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
  });
}
function networkError(e) {
  console.error(e);
  alert('通信エラーが発生しました。ネットワーク環境をご確認の上、もう一度お試しください。');
}

async function fetchState() {
  const data = await gasGet('state');
  serverState.prizesByIpDay = data.prizesByIpDay || emptyPrizesByIpDay();
  serverState.maxDraws = Number(data.maxDraws) || 20;
  serverState.currentDay = Number(data.currentDay) || 1;
  serverState.days = data.days || [];
  return serverState;
}

function dayLabel(day) {
  const info = (serverState.days || []).find((d) => Number(d.day) === Number(day));
  let label = `${day}日目`;
  if (info && (info.date || info.time)) {
    const parts = [info.date, info.time].filter(Boolean).join(' ');
    label += `（${parts}）`;
  }
  return label;
}

function currentPrizes() {
  const byDay = serverState.prizesByIpDay[currentIp] || {};
  return byDay[serverState.currentDay] || [];
}

/* ── テーマ（背景・トランプ柄）適用 ── */
function applyTheme() {
  document.querySelectorAll('.screen').forEach((el) => {
    if (config.background) {
      el.style.backgroundImage = `url(${config.background})`;
    } else {
      el.style.backgroundImage = '';
    }
  });
  let styleTag = document.getElementById('cardBackOverride');
  if (config.cardBack) {
    if (!styleTag) {
      styleTag = document.createElement('style');
      styleTag.id = 'cardBackOverride';
      document.head.appendChild(styleTag);
    }
    styleTag.textContent = `.card-back{background-image:url(${config.cardBack});background-size:cover;background-position:center;} .card-back::after{content:'';}`;
  } else if (styleTag) {
    styleTag.remove();
  }
}

/* ── 文字を折り返さず、収まらない場合は縮小して1行に収める ── */
function fitTextNoWrap(el) {
  if (!el) return;
  el.style.fontSize = '';
  const target = el.clientWidth;
  let fontSize = parseFloat(getComputedStyle(el).fontSize);
  let guard = 0;
  while (el.scrollWidth > target && fontSize > 8 && guard < 60) {
    fontSize -= 0.5;
    el.style.fontSize = fontSize + 'px';
    guard++;
  }
}
function fitAllLabels() {
  document.querySelectorAll('.ip-btn-label').forEach(fitTextNoWrap);
}
window.addEventListener('resize', fitAllLabels);

/* ── background sparkles ── */
function spawnSparkles(container) {
  for (let i = 0; i < 18; i++) {
    const s = document.createElement('div');
    s.className = 'sparkle';
    const size = 4 + Math.random() * 10;
    s.style.width = size + 'px';
    s.style.height = size + 'px';
    s.style.left = Math.random() * 100 + 'vw';
    s.style.bottom = '-5vh';
    s.style.animationDuration = (7 + Math.random() * 8) + 's';
    s.style.animationDelay = (Math.random() * 10) + 's';
    container.appendChild(s);
  }
}
document.querySelectorAll('.screen').forEach(spawnSparkles);

/* ── 効果音（デフォルトはWeb Audioで簡易生成、カスタム音があればそれを再生） ── */
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
function playTone(freqs, dur = 0.18) {
  const ctx = getAudioCtx();
  freqs.forEach((f, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine';
    const t0 = ctx.currentTime + i * dur;
    osc.frequency.setValueAtTime(f, t0);
    gain.gain.setValueAtTime(0.18, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur * 0.95);
    osc.start(t0); osc.stop(t0 + dur);
  });
}
function playDefaultSoundForPrize(name, idx) {
  if (!name) { playTone([392, 330]); return; }
  if (name === 'A賞' || idx === 0) playTone([523.25, 659.25, 783.99, 1046.5], 0.16);
  else if (name === 'B賞' || idx === 1) playTone([523.25, 659.25], 0.2);
  else if (name === 'C賞' || idx === 2) playTone([523.25], 0.25);
  else playTone([440, 550], 0.18);
}
function playPrizeSound(ip, name, idx) {
  const custom = name && config.sounds[ip] && config.sounds[ip][name];
  if (custom) {
    try { new Audio(custom).play(); return; } catch (e) {}
  }
  playDefaultSoundForPrize(name, idx);
}
function playBtnClick() { playTone([660], 0.06); }

/* ── 画面切り替え ── */
function showScreen(el) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
  el.classList.remove('hidden');
}

/* ── ① IP選択 ── */
document.querySelectorAll('.ip-btn').forEach((btn) => {
  btn.addEventListener('click', () => { playBtnClick(); selectIP(btn.dataset.ip); });
});

async function selectIP(ip) {
  currentIp = ip;
  renderIpTagLogo(countIpTag, ip);

  ipLoadingText.textContent = IP_WAIT_LINES[ip] || '';
  ipLoadingLine.classList.remove('hidden');
  document.querySelectorAll('.ip-btn').forEach((b) => b.classList.add('disabled'));

  try {
    await fetchState();
  } catch (e) {
    ipLoadingLine.classList.add('hidden');
    document.querySelectorAll('.ip-btn').forEach((b) => b.classList.remove('disabled'));
    networkError(e);
    return;
  }
  ipLoadingLine.classList.add('hidden');
  document.querySelectorAll('.ip-btn').forEach((b) => b.classList.remove('disabled'));
  buildCountGrid();
  showScreen(countSelectScreen);
}

/* ── ② 回数選択 ── */
function buildCountGrid() {
  countGrid.innerHTML = '';
  const max = Math.min(100, Math.max(1, Number(serverState.maxDraws) || 20));
  for (let n = 1; n <= max; n++) {
    const btn = document.createElement('button');
    btn.className = 'count-btn';
    btn.textContent = n + '回';
    btn.addEventListener('click', () => { playBtnClick(); chooseDrawCount(n); });
    countGrid.appendChild(btn);
  }
}

function chooseDrawCount(n) {
  sessionMaxDraws = n;
  sessionDrawsDone = 0;
  sessionResults = {};
  renderIpTagLogo(ipTag, currentIp);
  showScreen(appEl);
  startRound();
}

/* ── ③ カード抽選（自動で配られる。配布ボタンなし） ── */
function buildCards() {
  stage.innerHTML = '';
  for (let i = 0; i < CARD_COUNT; i++) {
    const card = document.createElement('div');
    card.className = 'card disabled';
    card.dataset.index = i;
    card.innerHTML = `
      <div class="card-inner">
        <div class="card-face card-back"></div>
        <div class="card-face card-front"><div class="label"></div></div>
      </div>`;
    card.addEventListener('click', () => onCardTap(card));
    stage.appendChild(card);
  }
}

function startRound() {
  roundTag.textContent = `${sessionDrawsDone + 1} / ${sessionMaxDraws} 回目`;
  resultText.textContent = '';
  buildCards();

  const cards = Array.from(document.querySelectorAll('.card'));
  cards.forEach((c, i) => {
    c.style.opacity = '0';
    c.style.transform = 'translateY(24px)';
    setTimeout(() => {
      c.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
      c.style.opacity = '1';
      c.style.transform = 'translateY(0)';
      c.classList.remove('disabled');
    }, i * 140);
  });
}

async function onCardTap(card) {
  if (drawing) return;
  if (card.classList.contains('flipped')) return;
  drawing = true;

  card.classList.add('loading');
  document.querySelectorAll('.card').forEach((c) => c.classList.add('disabled'));
  resultText.innerHTML = '<span class="spinner"></span>💕胸きゅん💕どきどき中…';

  let result;
  try {
    result = await gasPost({ action: 'draw', ip: currentIp });
  } catch (e) {
    drawing = false;
    card.classList.remove('loading');
    document.querySelectorAll('.card').forEach((c) => c.classList.remove('disabled'));
    resultText.textContent = '';
    networkError(e);
    return;
  }
  card.classList.remove('loading');

  const wonName = result && result.won;
  const wonIdx = wonName ? currentPrizes().findIndex((p) => p.name === wonName) : -1;
  const isMiss = !wonName || wonName === 'はずれ';

  if (!isMiss) {
    sessionResults[wonName] = (sessionResults[wonName] || 0) + 1;
    const prizeObj = currentPrizes()[wonIdx];
    if (prizeObj) prizeObj.remaining = Math.max(0, prizeObj.remaining - 1);
  } else {
    sessionResults['はずれ'] = (sessionResults['はずれ'] || 0) + 1;
  }

  const front = card.querySelector('.card-front');
  const label = front.querySelector('.label');
  if (isMiss) {
    front.classList.add('miss');
    label.innerHTML = `はずれ`;
  } else {
    label.innerHTML = `<div class="medal">🎁</div>${escapeHtml(wonName)}`;
  }
  card.classList.add('flipped');
  playPrizeSound(currentIp, isMiss ? null : wonName, wonIdx);

  document.querySelectorAll('.card').forEach((c) => {
    if (c !== card) c.classList.add('dim', 'disabled');
  });

  resultText.textContent = isMiss ? 'また挑戦してね！' : `${wonName} おめでとうございます！`;

  setTimeout(() => {
    drawing = false;
    sessionDrawsDone++;
    if (sessionDrawsDone < sessionMaxDraws) {
      startRound();
    } else {
      showSessionResult();
    }
  }, 1300);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/* ── ⑥ セッション結果画面 ── */
function orderedResultNames() {
  const order = currentPrizes().map((p) => p.name);
  if (sessionResults['はずれ'] !== undefined && !order.includes('はずれ')) order.push('はずれ');
  return order.filter((name) => sessionResults[name]);
}

function showSessionResult() {
  gasPost({ action: 'recordSession', ip: currentIp, draws: sessionMaxDraws, prizeCounts: sessionResults })
    .catch((e) => console.error('recordSession failed', e));

  renderIpTagLogo(sessionIpTag, currentIp);
  sessionResultList.innerHTML = '';
  const names = orderedResultNames();
  if (names.length === 0) {
    sessionResultList.innerHTML = '<div class="row"><span>結果</span><span class="num">なし</span></div>';
  } else {
    names.forEach((name) => {
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `<span>${escapeHtml(name)}</span><span class="num">× ${sessionResults[name]}</span>`;
      sessionResultList.appendChild(row);
    });
  }
  showScreen(sessionResultScreen);
}

backToStartBtn.addEventListener('click', () => {
  playBtnClick();
  currentIp = null;
  showScreen(ipSelectScreen);
});

/* ── ロゴタップで前の画面に戻る ── */
countIpTag.addEventListener('click', () => {
  playBtnClick();
  currentIp = null;
  showScreen(ipSelectScreen);
});

ipTag.addEventListener('click', () => {
  playBtnClick();
  sessionDrawsDone = 0;
  sessionResults = {};
  showScreen(countSelectScreen);
});

/* ── 隠し管理画面アクセス（お客様には見せない） ── */
const adminHiddenZone = $('adminHiddenZone');
let adminTapCount = 0;
let adminTapTimer = null;
adminHiddenZone.addEventListener('click', () => {
  adminTapCount++;
  clearTimeout(adminTapTimer);
  adminTapTimer = setTimeout(() => { adminTapCount = 0; }, 2500);
  if (adminTapCount >= 7) {
    adminTapCount = 0;
    openSettings();
  }
});

/* ── 設定パネル ── */
const settingsPanel = $('settingsPanel');
const prizeIpTabsEl = $('prizeIpTabs');
const prizeDayTabsEl = $('prizeDayTabs');
const prizeListEl = $('prizeList');
const addPrizeBtn = $('addPrizeBtn');
const saveSettingsBtn = $('saveSettingsBtn');
const closeSettingsBtn = $('closeSettingsBtn');
const resetCountsBtn = $('resetCountsBtn');
const maxDrawsInput = $('maxDrawsInput');
const bgFileInput = $('bgFileInput');
const resetBgBtn = $('resetBgBtn');
const cardBackFileInput = $('cardBackFileInput');
const resetCardBackBtn = $('resetCardBackBtn');
const logCountText = $('logCountText');
const exportCsvBtn = $('exportCsvBtn');
const resetLogBtn = $('resetLogBtn');
const currentDaySelect = $('currentDaySelect');
const switchDayBtn = $('switchDayBtn');
const currentDayStatus = $('currentDayStatus');

let editing = null; // { prizesByIpDay: {matorihime:{1:[{name,total,remaining,sound}],...}, stanmai:{...}}, maxDraws }
let settingsActiveIp = 'matorihime';
let settingsActiveDay = 1;

async function openSettings() {
  logCountText.textContent = '記録件数：読み込み中...';
  settingsPanel.classList.add('open');
  let state;
  try {
    state = await fetchState();
  } catch (e) {
    networkError(e);
    settingsPanel.classList.remove('open');
    return;
  }
  editing = {
    maxDraws: state.maxDraws,
    prizesByIpDay: {},
  };
  ['matorihime', 'stanmai'].forEach((ip) => {
    editing.prizesByIpDay[ip] = {};
    for (let d = 1; d <= MAX_DAY; d++) {
      const list = (state.prizesByIpDay[ip] && state.prizesByIpDay[ip][d]) || [];
      editing.prizesByIpDay[ip][d] = list.map((p) => ({
        ...p, sound: (config.sounds[ip] || {})[p.name] || null,
      }));
    }
  });

  maxDrawsInput.value = editing.maxDraws;
  settingsActiveIp = 'matorihime';
  settingsActiveDay = state.currentDay;
  renderIpTabs();
  renderDayTabs();
  renderPrizeList();
  renderCurrentDaySelect();

  gasGet('log').then((data) => {
    logCountText.textContent = `記録件数：${(data.records || []).length}件`;
  }).catch(() => {
    logCountText.textContent = '記録件数：取得失敗';
  });
}

function renderCurrentDaySelect() {
  currentDaySelect.innerHTML = '';
  for (let d = 1; d <= MAX_DAY; d++) {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = dayLabel(d);
    if (d === serverState.currentDay) opt.selected = true;
    currentDaySelect.appendChild(opt);
  }
  currentDayStatus.textContent = `現在稼働中：${dayLabel(serverState.currentDay)}`;
}

switchDayBtn.addEventListener('click', async () => {
  const day = Number(currentDaySelect.value);
  if (!confirm(`稼働日を「${dayLabel(day)}」に切り替えます。以降の抽選はこの日程の在庫が使われます。よろしいですか？`)) return;
  try {
    await gasPost({ action: 'setCurrentDay', day });
    await fetchState();
  } catch (e) {
    networkError(e);
    return;
  }
  renderCurrentDaySelect();
});

exportCsvBtn.addEventListener('click', async () => {
  let data;
  try {
    data = await gasGet('log');
  } catch (e) {
    networkError(e);
    return;
  }
  const records = data.records || [];
  if (records.length === 0) { alert('まだ記録がありません。'); return; }
  exportLogCsv(records);
});

resetLogBtn.addEventListener('click', async () => {
  if (!confirm('来店記録とお客様番号のカウントをリセットします。よろしいですか？')) return;
  try {
    await gasPost({ action: 'resetLog' });
  } catch (e) {
    networkError(e);
    return;
  }
  logCountText.textContent = '記録件数：0件';
});

function csvEscape(v) {
  const s = String(v);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function exportLogCsv(records) {
  const fixedPrizeNames = ['A賞', 'B賞', 'C賞'];
  const extraNames = [];
  records.forEach((r) => {
    Object.keys(r.prizeCounts || {}).forEach((n) => {
      if (!fixedPrizeNames.includes(n) && !extraNames.includes(n)) extraNames.push(n);
    });
  });
  const allPrizeNames = fixedPrizeNames.concat(extraNames);
  const header = ['日付', '日程', '作品名', '何人目のお客様か', '回数', ...allPrizeNames];
  const rows = [header];
  records.forEach((r) => {
    rows.push([
      r.date, r.day, r.ip, r.customerNo, r.draws,
      ...allPrizeNames.map((n) => (r.prizeCounts || {})[n] || 0),
    ]);
  });
  const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const pad = (n) => String(n).padStart(2, '0');
  const d = new Date();
  a.download = `coly_lottery_log_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function renderIpTabs() {
  prizeIpTabsEl.innerHTML = '';
  Object.keys(IP_TITLES).forEach((ip) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = IP_TITLES[ip];
    if (ip === settingsActiveIp) btn.classList.add('active');
    btn.addEventListener('click', () => {
      settingsActiveIp = ip;
      renderIpTabs();
      renderPrizeList();
    });
    prizeIpTabsEl.appendChild(btn);
  });
}

function renderDayTabs() {
  prizeDayTabsEl.innerHTML = '';
  for (let d = 1; d <= MAX_DAY; d++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = dayLabel(d);
    if (d === settingsActiveDay) btn.classList.add('active');
    btn.addEventListener('click', () => {
      settingsActiveDay = d;
      renderDayTabs();
      renderPrizeList();
    });
    prizeDayTabsEl.appendChild(btn);
  }
}

function activePrizeList() {
  if (!editing.prizesByIpDay[settingsActiveIp]) editing.prizesByIpDay[settingsActiveIp] = {};
  if (!editing.prizesByIpDay[settingsActiveIp][settingsActiveDay]) {
    editing.prizesByIpDay[settingsActiveIp][settingsActiveDay] = [];
  }
  return editing.prizesByIpDay[settingsActiveIp][settingsActiveDay];
}

function renderPrizeList() {
  prizeListEl.innerHTML = '';
  const list = activePrizeList();
  const total = list.reduce((s, p) => s + (Number(p.total) || 0), 0);
  list.forEach((p, idx) => {
    const row = document.createElement('div');
    row.className = 'prizeRow';
    const pct = total > 0 ? ((Number(p.total) || 0) / total * 100).toFixed(1) : '0.0';
    row.innerHTML = `
      <input type="text" value="${escapeHtml(p.name)}" data-field="name" data-idx="${idx}">
      <span class="remainLabel">設定数</span>
      <input type="number" min="0" value="${p.total}" data-field="total" data-idx="${idx}">
      <span class="remainLabel">残り<b>${Math.max(0, Number(p.remaining) || 0)}</b></span>
      <span class="pct">${pct}%</span>
      <input type="file" accept="audio/*" data-idx="${idx}" class="soundInput">
      <button class="testSoundBtn" data-idx="${idx}" title="試聴">▶</button>
      <span class="soundStatus">${p.sound ? 'カスタム音あり' : 'デフォルト音'}</span>
      <button class="removeBtn" data-idx="${idx}">×</button>
    `;
    prizeListEl.appendChild(row);
  });

  prizeListEl.querySelectorAll('input[type=text], input[type=number]').forEach((inp) => {
    inp.addEventListener('input', (e) => {
      const idx = Number(e.target.dataset.idx);
      const field = e.target.dataset.field;
      const list = activePrizeList();
      if (field === 'total') {
        const v = Math.max(0, parseInt(e.target.value, 10) || 0);
        list[idx].total = v;
        list[idx].remaining = v;
      } else {
        list[idx].name = e.target.value;
      }
      renderPrizeList();
    });
  });
  prizeListEl.querySelectorAll('.soundInput').forEach((inp) => {
    inp.addEventListener('change', (e) => {
      const idx = Number(e.target.dataset.idx);
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        activePrizeList()[idx].sound = reader.result;
        renderPrizeList();
      };
      reader.readAsDataURL(file);
    });
  });
  prizeListEl.querySelectorAll('.testSoundBtn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const idx = Number(e.target.dataset.idx);
      const p = activePrizeList()[idx];
      if (p.sound) { try { new Audio(p.sound).play(); } catch (err) {} }
      else playDefaultSoundForPrize(p.name, idx);
    });
  });
  prizeListEl.querySelectorAll('.removeBtn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const idx = Number(e.target.dataset.idx);
      activePrizeList().splice(idx, 1);
      renderPrizeList();
    });
  });
}

addPrizeBtn.addEventListener('click', () => {
  activePrizeList().push({ name: '新しい景品', total: 1, remaining: 1, sound: null });
  renderPrizeList();
});

closeSettingsBtn.addEventListener('click', () => settingsPanel.classList.remove('open'));

saveSettingsBtn.addEventListener('click', async () => {
  ['matorihime', 'stanmai'].forEach((ip) => {
    for (let d = 1; d <= MAX_DAY; d++) {
      editing.prizesByIpDay[ip][d] = editing.prizesByIpDay[ip][d].filter((p) => p.name.trim() !== '');
    }
  });
  editing.maxDraws = Math.min(100, Math.max(1, parseInt(maxDrawsInput.value, 10) || 20));

  // 効果音はローカル保存
  ['matorihime', 'stanmai'].forEach((ip) => {
    config.sounds[ip] = {};
    for (let d = 1; d <= MAX_DAY; d++) {
      editing.prizesByIpDay[ip][d].forEach((p) => {
        if (p.sound) config.sounds[ip][p.name] = p.sound;
      });
    }
  });
  saveLocalConfig();

  // 賞品在庫・回数設定はサーバーへ保存
  const payloadPrizes = {};
  ['matorihime', 'stanmai'].forEach((ip) => {
    payloadPrizes[ip] = {};
    for (let d = 1; d <= MAX_DAY; d++) {
      payloadPrizes[ip][d] = editing.prizesByIpDay[ip][d].map((p) => ({
        name: p.name, total: Number(p.total) || 0, remaining: Number(p.remaining) || 0,
      }));
    }
  });
  saveSettingsBtn.disabled = true;
  try {
    await gasPost({ action: 'updateConfig', maxDraws: editing.maxDraws, prizesByIpDay: payloadPrizes });
    await fetchState();
  } catch (e) {
    networkError(e);
    saveSettingsBtn.disabled = false;
    return;
  }
  saveSettingsBtn.disabled = false;
  applyTheme();
  fitAllLabels();
  settingsPanel.classList.remove('open');
});

resetCountsBtn.addEventListener('click', async () => {
  if (!confirm(`「${IP_TITLES[settingsActiveIp]}」${dayLabel(settingsActiveDay)}の当選数（在庫）をリセットします。よろしいですか？`)) return;
  try {
    await gasPost({ action: 'resetStock', ip: settingsActiveIp, day: settingsActiveDay });
    await fetchState();
  } catch (e) {
    networkError(e);
    return;
  }
  const freshList = (serverState.prizesByIpDay[settingsActiveIp] && serverState.prizesByIpDay[settingsActiveIp][settingsActiveDay]) || [];
  editing.prizesByIpDay[settingsActiveIp][settingsActiveDay] = freshList.map((p) => ({
    ...p, sound: (config.sounds[settingsActiveIp] || {})[p.name] || null,
  }));
  renderPrizeList();
});

bgFileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => { editing.background = reader.result; config.background = reader.result; saveLocalConfig(); applyTheme(); };
  reader.readAsDataURL(file);
});
resetBgBtn.addEventListener('click', () => { config.background = null; bgFileInput.value = ''; saveLocalConfig(); applyTheme(); });

cardBackFileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => { config.cardBack = reader.result; saveLocalConfig(); applyTheme(); };
  reader.readAsDataURL(file);
});
resetCardBackBtn.addEventListener('click', () => { config.cardBack = null; cardBackFileInput.value = ''; saveLocalConfig(); applyTheme(); });

/* ── 初期化 ── */
applyTheme();
fitAllLabels();
fetchState().catch((e) => console.error('initial fetchState failed', e));
