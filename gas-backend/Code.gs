/**
 * coly-lottery 在庫一括管理バックエンド
 * このスプレッドシートに紐づくApps Scriptとしてデプロイする。
 * シート構成は初回アクセス時に自動作成される（Prizes / Log / Meta）。
 */

function getSheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

function ensureSetup_() {
  const prizes = getSheet_('Prizes');
  if (prizes.getLastRow() === 0) {
    prizes.appendRow(['ip', 'name', 'total', 'remaining']);
    const defaults = [
      ['matorihime', 'A賞', 1, 1],
      ['matorihime', 'B賞', 4, 4],
      ['matorihime', 'C賞', 45, 45],
      ['stanmai', 'A賞', 1, 1],
      ['stanmai', 'B賞', 4, 4],
      ['stanmai', 'C賞', 45, 45],
    ];
    defaults.forEach((r) => prizes.appendRow(r));
  }
  const log = getSheet_('Log');
  if (log.getLastRow() === 0) {
    log.appendRow(['日付', '作品名', '何人目のお客様か', '回数', 'prizeCountsJson']);
  }
  const meta = getSheet_('Meta');
  if (meta.getLastRow() === 0) {
    meta.appendRow(['key', 'value']);
    meta.appendRow(['maxDraws', 20]);
    meta.appendRow(['counter', 0]);
  }
}

function respond_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  if (e.parameter.action === 'ping') return respond_({ pong: 'v2', now: new Date().toISOString() });
  ensureSetup_();
  const action = e.parameter.action;
  if (action === 'state') return respond_(getState_());
  if (action === 'log') return respond_(getLogRecords_());
  return respond_({ error: 'unknown action: ' + action });
}

function doPost(e) {
  ensureSetup_();
  const body = JSON.parse(e.postData.contents);
  const action = body.action;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (action === 'draw') return respond_(doDraw_(body.ip));
    if (action === 'recordSession') return respond_(doRecordSession_(body));
    if (action === 'updateConfig') return respond_(doUpdateConfig_(body));
    if (action === 'resetStock') return respond_(doResetStock_(body.ip));
    if (action === 'resetLog') return respond_(doResetLog_());
    return respond_({ error: 'unknown action: ' + action });
  } finally {
    lock.releaseLock();
  }
}

function getPrizeRows_() {
  const sheet = getSheet_('Prizes');
  const values = sheet.getDataRange().getValues();
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    rows.push({ row: i + 1, ip: values[i][0], name: values[i][1], total: values[i][2], remaining: values[i][3] });
  }
  return rows;
}

function getMeta_() {
  const sheet = getSheet_('Meta');
  const values = sheet.getDataRange().getValues();
  const meta = {};
  for (let i = 1; i < values.length; i++) meta[values[i][0]] = values[i][1];
  return meta;
}

function setMeta_(key, value) {
  const sheet = getSheet_('Meta');
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (values[i][0] === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  sheet.appendRow([key, value]);
}

function getState_() {
  const rows = getPrizeRows_();
  const prizesByIp = {};
  rows.forEach((r) => {
    if (!prizesByIp[r.ip]) prizesByIp[r.ip] = [];
    prizesByIp[r.ip].push({ name: r.name, total: r.total, remaining: r.remaining });
  });
  const meta = getMeta_();
  return {
    prizesByIp: prizesByIp,
    maxDraws: Number(meta.maxDraws) || 20,
    counter: Number(meta.counter) || 0,
  };
}

function getLogRecords_() {
  const sheet = getSheet_('Log');
  const values = sheet.getDataRange().getValues();
  const records = [];
  for (let i = 1; i < values.length; i++) {
    let prizeCounts = {};
    try { prizeCounts = JSON.parse(values[i][4]); } catch (e) {}
    let dateVal = values[i][0];
    if (Object.prototype.toString.call(dateVal) === '[object Date]') {
      dateVal = Utilities.formatDate(dateVal, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    }
    records.push({
      date: dateVal,
      ip: values[i][1],
      customerNo: values[i][2],
      draws: values[i][3],
      prizeCounts: prizeCounts,
    });
  }
  return { records: records };
}

function doDraw_(ip) {
  const sheet = getSheet_('Prizes');
  const rows = getPrizeRows_().filter((r) => r.ip === ip);
  const total = rows.reduce((s, r) => s + Math.max(0, r.remaining), 0);
  if (total <= 0) return { won: null };
  let rnd = Math.random() * total;
  let picked = null;
  for (const r of rows) {
    if (r.remaining <= 0) continue;
    if (rnd < r.remaining) { picked = r; break; }
    rnd -= r.remaining;
  }
  if (!picked) picked = rows[rows.length - 1];
  if (picked.remaining > 0) {
    sheet.getRange(picked.row, 4).setValue(picked.remaining - 1);
  }
  return { won: picked.name };
}

function doRecordSession_(body) {
  const meta = getMeta_();
  const counter = (Number(meta.counter) || 0) + 1;
  setMeta_('counter', counter);
  const log = getSheet_('Log');
  const date = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  log.appendRow([date, body.ip, counter, body.draws, JSON.stringify(body.prizeCounts || {})]);
  return { customerNo: counter };
}

function doUpdateConfig_(body) {
  if (body.maxDraws) setMeta_('maxDraws', body.maxDraws);
  if (body.prizesByIp) {
    const sheet = getSheet_('Prizes');
    sheet.clearContents();
    sheet.appendRow(['ip', 'name', 'total', 'remaining']);
    Object.keys(body.prizesByIp).forEach((ip) => {
      body.prizesByIp[ip].forEach((p) => {
        sheet.appendRow([ip, p.name, p.total, p.remaining]);
      });
    });
  }
  return { ok: true };
}

function doResetStock_(ip) {
  const sheet = getSheet_('Prizes');
  const rows = getPrizeRows_();
  rows.forEach((r) => {
    if (r.ip === ip) sheet.getRange(r.row, 4).setValue(r.total);
  });
  return { ok: true };
}

function doResetLog_() {
  const log = getSheet_('Log');
  log.clearContents();
  log.appendRow(['日付', '作品名', '何人目のお客様か', '回数', 'prizeCountsJson']);
  setMeta_('counter', 0);
  return { ok: true };
}
