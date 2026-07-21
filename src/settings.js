// Self-contained settings UI served at GET /settings. Reads /devices/all and
// /config to prefill, writes via POST /config. Authorization is the login
// session (the guard in fetch()), so no control key is entered here.
// No backticks / ${} inside the inline script — this whole file is a template
// literal, so the script uses string concatenation instead.
export const SETTINGS_HTML = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>サーキュレーター自動運転 設定</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, "Hiragino Kaku Gothic ProN", sans-serif;
    max-width: 560px; margin: 0 auto; padding: 16px; line-height: 1.6; }
  h1 { font-size: 1.25rem; }
  h2 { font-size: 1.05rem; margin-top: 1.5rem; border-bottom: 1px solid #8886; padding-bottom: 4px; }
  label { display: block; margin: 12px 0 4px; font-weight: 600; }
  input, select { width: 100%; padding: 8px; font-size: 1rem; border: 1px solid #8886;
    border-radius: 6px; background: transparent; color: inherit; }
  input[type=checkbox] { width: auto; }
  .row { display: flex; gap: 12px; }
  .row > div { flex: 1; }
  .hint { font-size: 0.85rem; opacity: 0.75; margin-top: 2px; }
  button { padding: 10px 16px; font-size: 1rem; border-radius: 6px; border: 1px solid #8886;
    background: #4472c4; color: #fff; cursor: pointer; margin-top: 16px; }
  button.secondary { background: transparent; color: inherit; }
  .btns { display: flex; gap: 12px; flex-wrap: wrap; }
  #msg { margin-top: 12px; padding: 10px; border-radius: 6px; display: none; }
  #msg.ok { display: block; background: #2e7d3233; border: 1px solid #2e7d32; }
  #msg.err { display: block; background: #c6282833; border: 1px solid #c62828; }
  pre { background: #8881; padding: 10px; border-radius: 6px; overflow-x: auto; font-size: 0.85rem; }
  .toggle { display: flex; align-items: center; gap: 8px; }
  a { color: #4472c4; }
</style>
</head>
<body>
<h1>🌀 サーキュレーター自動運転 設定</h1>
<p class="hint">温度しきい値で寝室のサーキュレーターを自動 ON/OFF します。ログイン済みなら、そのまま保存・操作できます。<a href="/">← ダッシュボードへ</a></p>

<h2>自動運転ルール</h2>
<div class="toggle"><input id="enabled" type="checkbox"><label for="enabled" style="margin:0">自動運転を有効にする</label></div>

<label for="sensor">判断に使うセンサー（部屋）</label>
<select id="sensor"></select>

<label for="fan">操作するファン</label>
<select id="fan"></select>

<div class="row">
  <div>
    <label for="onC">ON にする温度（℃以上）</label>
    <input id="onC" type="number" step="0.5" value="28">
  </div>
  <div>
    <label for="offC">OFF にする温度（℃以下）</label>
    <input id="offC" type="number" step="0.5" value="26">
  </div>
</div>
<div class="hint">OFF は ON より低い値にしてください（バタつき防止）。自動で補正されます。</div>

<label for="night">夜間（23:00〜翌7:00）の動作</label>
<select id="night">
  <option value="no-on">夜間は ON にしない（OFF はする）</option>
  <option value="allday">終日ふつうに自動運転</option>
  <option value="off">夜間は一切動かさない</option>
</select>

<button id="save">設定を保存</button>
<div id="msg"></div>

<h2>現在の状態 / 手動操作</h2>
<div class="btns">
  <button class="secondary" id="refresh">状態を取得</button>
  <button id="on">今すぐ ON</button>
  <button class="secondary" id="off">今すぐ OFF</button>
</div>
<pre id="status">（未取得）</pre>

<script>
(function () {
  var el = function (id) { return document.getElementById(id); };
  var msg = function (text, ok) {
    var m = el('msg'); m.textContent = text; m.className = ok ? 'ok' : 'err';
  };
  var devices = [];

  function fillSelect(sel, list, preferMeters) {
    sel.innerHTML = '';
    list.forEach(function (d) {
      var o = document.createElement('option');
      o.value = d.deviceId;
      o.textContent = d.deviceName + ' (' + d.deviceId + ') [' + d.deviceType + ']';
      sel.appendChild(o);
    });
  }

  function loadDevices() {
    return fetch('/devices/all').then(function (r) { return r.json(); }).then(function (j) {
      devices = (j.deviceList || []);
      // Sensor dropdown: temperature-capable devices first, but list all.
      var meters = devices.filter(function (d) { return /Meter|Sensor|Hub 2/i.test(d.deviceType); });
      var fans = devices.filter(function (d) { return /Fan|Circulator|Plug|Bot|Light/i.test(d.deviceType); });
      fillSelect(el('sensor'), meters.length ? meters : devices);
      fillSelect(el('fan'), fans.length ? fans : devices);
    });
  }

  function loadConfig() {
    return fetch('/config').then(function (r) { return r.json(); }).then(function (j) {
      var c = j.config || {};
      el('enabled').checked = !!c.enabled;
      if (c.sensorDeviceId) el('sensor').value = c.sensorDeviceId;
      if (c.fanDeviceId) el('fan').value = c.fanDeviceId;
      if (typeof c.onC === 'number') el('onC').value = c.onC;
      if (typeof c.offC === 'number') el('offC').value = c.offC;
      if (c.night) el('night').value = c.night;
    });
  }

  el('save').onclick = function () {
    var body = {
      enabled: el('enabled').checked,
      sensorDeviceId: el('sensor').value,
      fanDeviceId: el('fan').value,
      onC: parseFloat(el('onC').value),
      offC: parseFloat(el('offC').value),
      night: el('night').value
    };
    fetch('/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json().then(function (j) { return { s: r.status, j: j }; }); })
      .then(function (res) {
        if (res.s === 200 && res.j.ok) {
          msg('保存しました。' + (res.j.config.enabled ? '自動運転: 有効' : '自動運転: 無効'), true);
        } else {
          msg('保存失敗: ' + (res.j.error || res.s), false);
        }
      }).catch(function (e) { msg('通信エラー: ' + e, false); });
  };

  function manual(cmd) {
    var id = el('fan').value;
    var url = '/control?id=' + encodeURIComponent(id) + '&cmd=' + cmd;
    fetch(url).then(function (r) { return r.json().then(function (j) { return { s: r.status, j: j }; }); })
      .then(function (res) {
        if (res.s === 200 && res.j.ok) { msg(cmd + ' を送信しました。', true); setTimeout(refresh, 1500); }
        else { msg(cmd + ' 失敗: ' + (res.j.error || res.s), false); }
      }).catch(function (e) { msg('通信エラー: ' + e, false); });
  }
  el('on').onclick = function () { manual('turnOn'); };
  el('off').onclick = function () { manual('turnOff'); };

  function refresh() {
    var id = el('fan').value;
    el('status').textContent = '取得中...';
    fetch('/devices/status?id=' + encodeURIComponent(id))
      .then(function (r) { return r.json(); })
      .then(function (j) { el('status').textContent = JSON.stringify(j.status || j, null, 2); })
      .catch(function (e) { el('status').textContent = 'エラー: ' + e; });
  }
  el('refresh').onclick = refresh;

  loadDevices().then(loadConfig).catch(function (e) { msg('読み込みエラー: ' + e, false); });
})();
</script>
</body>
</html>`;
