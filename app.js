const CONFIG_KEY = 'coly_lottery_config_v4';
const OLD_CONFIG_KEY_V3 = 'coly_lottery_config_v3';
const OLD_PRIZES_KEY = 'coly_lottery_prizes_v2';
const LOG_KEY = 'coly_lottery_log_v1';
const CARD_COUNT = 3;

const IP_TITLES = {
  matorihime: 'ドラッグ王子とマトリ姫',
  stanmai: 'スタンドマイヒーローズ',
};

function defaultPrizes() {
  return [
    { id: 'p1', name: 'A賞', total: 1, remaining: 1, sound: null },
    { id: 'p2', name: 'B賞', total: 4, remaining: 4, sound: null },
    { id: 'p3', name: 'C賞', total: 45, remaining: 45, sound: null },
  ];
}

function defaultConfig() {
  return {
    prizesByIp: {
      matorihime: defaultPrizes(),
      stanmai: defaultPrizes(),
    },
    maxDraws: 20,
    background: null,
    cardBack: null,
  };
}

let config = loadConfig();
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
const roundTag = $('roundTag');
const countGrid = $('countGrid');
const stage = $('stage');
const resultText = $('resultText');
const sessionResultList = $('sessionResultList');
const backToStartBtn = $('backToStartBtn');

/* ── config load/save ── */
function loadConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const base = defaultConfig();
      return Object.assign(base, parsed, {
        prizesByIp: Object.assign(base.prizesByIp, parsed.prizesByIp || {}),
      });
    }
    // v3（作品共通の在庫）からの移行：両作品に同じ在庫をコピーする
    const oldV3Raw = localStorage.getItem(OLD_CONFIG_KEY_V3);
    if (oldV3Raw) {
      const old = JSON.parse(oldV3Raw);
      const base = defaultConfig();
      if (Array.isArray(old.prizes)) {
        base.prizesByIp.matorihime = JSON.parse(JSON.stringify(old.prizes));
        base.prizesByIp.stanmai = JSON.parse(JSON.stringify(old.prizes));
      }
      base.maxDraws = old.maxDraws || base.maxDraws;
      base.background = old.background || base.background;
      base.cardBack = old.cardBack || base.cardBack;
      return base;
    }
    // さらに旧いバージョンからの移行
    const oldRaw = localStorage.getItem(OLD_PRIZES_KEY);
    if (oldRaw) {
      const oldPrizes = JSON.parse(oldRaw).map(p => ({ ...p, sound: null }));
      const base = defaultConfig();
      base.prizesByIp.matorihime = JSON.parse(JSON.stringify(oldPrizes));
      base.prizesByIp.stanmai = JSON.parse(JSON.stringify(oldPrizes));
      return base;
    }
  } catch (e) {}
  return defaultConfig();
}

function saveConfig() {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch (e) {
    alert('保存容量の上限を超えた可能性があります。背景・効果音のファイルサイズを小さくしてお試しください。');
  }
}

/* ── 来店記録（お客様ごとの抽選履歴） ── */
function loadLog() {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return { counter: 0, records: [] };
}

function saveLog() {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(logData));
  } catch (e) {
    alert('記録データの保存容量の上限を超えた可能性があります。設定画面からCSV出力・リセットをご検討ください。');
  }
}

let logData = loadLog();

function todayDateStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function recordSession() {
  logData.counter++;
  logData.records.push({
    date: todayDateStr(),
    ip: IP_TITLES[currentIp] || currentIp,
    customerNo: logData.counter,
    draws: sessionMaxDraws,
    prizeCounts: JSON.parse(JSON.stringify(sessionResults)),
  });
  saveLog();
}

function csvEscape(v) {
  const s = String(v);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function exportLogCsv() {
  const fixedPrizeNames = ['A賞', 'B賞', 'C賞'];
  const extraNames = [];
  logData.records.forEach((r) => {
    Object.keys(r.prizeCounts).forEach((n) => {
      if (!fixedPrizeNames.includes(n) && !extraNames.includes(n)) extraNames.push(n);
    });
  });
  const allPrizeNames = fixedPrizeNames.concat(extraNames);
  const header = ['日付', '作品名', '何人目のお客様か', '回数', ...allPrizeNames];
  const rows = [header];
  logData.records.forEach((r) => {
    rows.push([
      r.date, r.ip, r.customerNo, r.draws,
      ...allPrizeNames.map((n) => r.prizeCounts[n] || 0),
    ]);
  });
  const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `coly_lottery_log_${todayDateStr()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function currentPrizes() {
  return config.prizesByIp[currentIp] || [];
}

function totalRemaining() {
  return currentPrizes().reduce((sum, p) => sum + Math.max(0, p.remaining), 0);
}

function drawPrize() {
  const total = totalRemaining();
  if (total <= 0) return null;
  const prizes = currentPrizes();
  let r = Math.random() * total;
  for (const p of prizes) {
    if (p.remaining <= 0) continue;
    if (r < p.remaining) return p;
    r -= p.remaining;
  }
  return prizes[prizes.length - 1];
}

/* ── テーマ（背景・トランプ柄）適用 ── */
function applyTheme() {
  document.querySelectorAll('.screen').forEach(el => {
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
function playDefaultSoundForPrize(prize, idx) {
  if (!prize) { playTone([392, 330]); return; }
  if (prize.name === 'A賞' || idx === 0) playTone([523.25, 659.25, 783.99, 1046.5], 0.16);
  else if (prize.name === 'B賞' || idx === 1) playTone([523.25, 659.25], 0.2);
  else if (prize.name === 'C賞' || idx === 2) playTone([523.25], 0.25);
  else playTone([440, 550], 0.18);
}
function playPrizeSound(prize, idx) {
  if (prize && prize.sound) {
    try { new Audio(prize.sound).play(); return; } catch (e) {}
  }
  playDefaultSoundForPrize(prize, idx);
}
function playBtnClick() { playTone([660], 0.06); }

/* ── 画面切り替え ── */
function showScreen(el) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  el.classList.remove('hidden');
}

/* ── ① IP選択 ── */
document.querySelectorAll('.ip-btn').forEach(btn => {
  btn.addEventListener('click', () => { playBtnClick(); selectIP(btn.dataset.ip); });
});

function selectIP(ip) {
  currentIp = ip;
  countIpTag.textContent = IP_TITLES[ip] || '';
  buildCountGrid();
  showScreen(countSelectScreen);
}

/* ── ② 回数選択 ── */
function buildCountGrid() {
  countGrid.innerHTML = '';
  const max = Math.min(100, Math.max(1, Number(config.maxDraws) || 20));
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
  ipTag.textContent = IP_TITLES[currentIp] || '';
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

function onCardTap(card) {
  if (drawing) return;
  if (card.classList.contains('flipped')) return;
  drawing = true;

  const won = drawPrize();
  const wonIdx = won ? currentPrizes().indexOf(won) : -1;
  const isMiss = !won || won.name === 'はずれ';

  if (won) {
    won.remaining = Math.max(0, won.remaining - 1);
    saveConfig();
    sessionResults[won.name] = (sessionResults[won.name] || 0) + 1;
  } else {
    sessionResults['はずれ'] = (sessionResults['はずれ'] || 0) + 1;
  }

  const front = card.querySelector('.card-front');
  const label = front.querySelector('.label');
  if (isMiss) {
    front.classList.add('miss');
    label.innerHTML = `はずれ`;
  } else {
    label.innerHTML = `<div class="medal">🎁</div>${escapeHtml(won.name)}`;
  }
  card.classList.add('flipped');
  playPrizeSound(isMiss ? null : won, wonIdx);

  document.querySelectorAll('.card').forEach(c => {
    if (c !== card) c.classList.add('dim', 'disabled');
  });

  resultText.textContent = isMiss ? 'また挑戦してね！' : `${won.name} おめでとうございます！`;

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
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* ── ⑥ セッション結果画面 ── */
function orderedResultNames() {
  const order = currentPrizes().map(p => p.name);
  if (sessionResults['はずれ'] !== undefined && !order.includes('はずれ')) order.push('はずれ');
  return order.filter(name => sessionResults[name]);
}

function showSessionResult() {
  recordSession();
  sessionIpTag.textContent = IP_TITLES[currentIp] || '';
  sessionResultList.innerHTML = '';
  const names = orderedResultNames();
  if (names.length === 0) {
    sessionResultList.innerHTML = '<div class="row"><span>結果</span><span class="num">なし</span></div>';
  } else {
    names.forEach(name => {
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

let editing = null;
let settingsActiveIp = 'matorihime';

function openSettings() {
  editing = JSON.parse(JSON.stringify(config));
  maxDrawsInput.value = editing.maxDraws;
  settingsActiveIp = 'matorihime';
  renderIpTabs();
  renderPrizeList();
  logCountText.textContent = `記録件数：${logData.records.length}件`;
  settingsPanel.classList.add('open');
}

exportCsvBtn.addEventListener('click', () => {
  if (logData.records.length === 0) { alert('まだ記録がありません。'); return; }
  exportLogCsv();
});

resetLogBtn.addEventListener('click', () => {
  if (!confirm(`来店記録（${logData.records.length}件）とお客様番号のカウントをリセットします。よろしいですか？`)) return;
  logData = { counter: 0, records: [] };
  saveLog();
  logCountText.textContent = '記録件数：0件';
});

function renderIpTabs() {
  prizeIpTabsEl.innerHTML = '';
  Object.keys(IP_TITLES).forEach(ip => {
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

function activePrizeList() {
  if (!editing.prizesByIp[settingsActiveIp]) editing.prizesByIp[settingsActiveIp] = [];
  return editing.prizesByIp[settingsActiveIp];
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

  prizeListEl.querySelectorAll('input[type=text], input[type=number]').forEach(inp => {
    inp.addEventListener('input', e => {
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
  prizeListEl.querySelectorAll('.soundInput').forEach(inp => {
    inp.addEventListener('change', e => {
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
  prizeListEl.querySelectorAll('.testSoundBtn').forEach(btn => {
    btn.addEventListener('click', e => {
      const idx = Number(e.target.dataset.idx);
      const list = activePrizeList();
      playPrizeSound(list[idx], idx);
    });
  });
  prizeListEl.querySelectorAll('.removeBtn').forEach(btn => {
    btn.addEventListener('click', e => {
      const idx = Number(e.target.dataset.idx);
      activePrizeList().splice(idx, 1);
      renderPrizeList();
    });
  });
}

addPrizeBtn.addEventListener('click', () => {
  activePrizeList().push({ id: 'p' + Date.now(), name: '新しい景品', total: 1, remaining: 1, sound: null });
  renderPrizeList();
});

closeSettingsBtn.addEventListener('click', () => settingsPanel.classList.remove('open'));

saveSettingsBtn.addEventListener('click', () => {
  Object.keys(editing.prizesByIp).forEach(ip => {
    editing.prizesByIp[ip] = editing.prizesByIp[ip].filter(p => p.name.trim() !== '');
  });
  editing.maxDraws = Math.min(100, Math.max(1, parseInt(maxDrawsInput.value, 10) || 20));
  config = editing;
  saveConfig();
  applyTheme();
  fitAllLabels();
  settingsPanel.classList.remove('open');
});

resetCountsBtn.addEventListener('click', () => {
  if (!confirm(`「${IP_TITLES[settingsActiveIp]}」の当選数（在庫）をリセットします。よろしいですか？`)) return;
  editing.prizesByIp[settingsActiveIp] = activePrizeList().map(p => ({ ...p, remaining: Number(p.total) || 0 }));
  renderPrizeList();
});

bgFileInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => { editing.background = reader.result; };
  reader.readAsDataURL(file);
});
resetBgBtn.addEventListener('click', () => { editing.background = null; bgFileInput.value = ''; });

cardBackFileInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => { editing.cardBack = reader.result; };
  reader.readAsDataURL(file);
});
resetCardBackBtn.addEventListener('click', () => { editing.cardBack = null; cardBackFileInput.value = ''; });

/* ── 初期化 ── */
applyTheme();
fitAllLabels();
