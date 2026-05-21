export const DASHBOARD_HTML = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>SwitchBot 温湿度ロガー</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3.0.0/dist/chartjs-adapter-date-fns.bundle.min.js"></script>
  <style>
    :root { color-scheme: dark light; }
    body { font-family: system-ui, sans-serif; margin: 0; padding: 1rem; }
    header { display: flex; align-items: baseline; gap: 1rem; flex-wrap: wrap; }
    h1 { font-size: 1.2rem; margin: 0 1rem 0 0; }
    select, button { font: inherit; padding: .3rem .5rem; }
    .stats { display: flex; gap: 1rem; flex-wrap: wrap; margin: .8rem 0; font-size: .9rem; opacity: .85; }
    .chart-wrap { position: relative; height: 38vh; height: 38dvh; min-height: 240px; margin-bottom: 1rem; }
    @media (max-width: 600px) { .chart-wrap { height: 32vh; height: 32dvh; min-height: 220px; } }
    .err { color: #c33; font-size: .85rem; margin-top: .3rem; }
  </style>
</head>
<body>
  <header>
    <h1>🌡 SwitchBot 温湿度ロガー</h1>
    <label>期間
      <select id="range">
        <option value="1">1時間</option>
        <option value="6">6時間</option>
        <option value="24" selected>24時間</option>
        <option value="72">3日</option>
        <option value="168">7日</option>
      </select>
    </label>
    <label>自動更新
      <select id="refresh">
        <option value="0">オフ</option>
        <option value="30">30秒</option>
        <option value="60" selected>60秒</option>
        <option value="300">5分</option>
      </select>
    </label>
    <button id="reload">今すぐ更新</button>
  </header>

  <div class="stats" id="stats">読み込み中...</div>
  <div class="err" id="err"></div>

  <div class="chart-wrap"><canvas id="temp"></canvas></div>
  <div class="chart-wrap"><canvas id="humid"></canvas></div>
  <div class="chart-wrap"><canvas id="ah"></canvas></div>

<script>
const colors = ['#4e79a7','#f28e2b','#e15759','#76b7b2','#59a14f','#edc948','#b07aa1','#ff9da7'];

let temp, humid, ah;
let refreshTimer = null;

function mkChart(ctx, ylabel) {
  return new Chart(ctx, {
    type: 'line',
    data: { datasets: [] },
    options: {
      animation: false,
      maintainAspectRatio: false,
      parsing: false,
      responsive: true,
      plugins: {
        title: { display: false },
        legend: { position: 'bottom' },
        tooltip: {
          callbacks: {
            title: (items) => {
              if (!items.length) return '';
              const d = new Date(items[0].parsed.x);
              const mo = String(d.getMonth()+1).padStart(2,'0');
              const da = String(d.getDate()).padStart(2,'0');
              const hh = String(d.getHours()).padStart(2,'0');
              const mm = String(d.getMinutes()).padStart(2,'0');
              return \`\${d.getFullYear()}-\${mo}-\${da} \${hh}:\${mm}\`;
            },
          },
        },
      },
      scales: {
        x: {
          type: 'time',
          ticks: {
            maxRotation: 0,
            minRotation: 0,
            autoSkip: true,
            maxTicksLimit: 7,
            autoSkipPadding: 12,
            callback: function(value) {
              const d = new Date(value);
              const hoursWin = parseInt(document.getElementById('range').value, 10);
              const mo = String(d.getMonth()+1).padStart(2,'0');
              const da = String(d.getDate()).padStart(2,'0');
              const h = String(d.getHours()).padStart(2,'0');
              const m = String(d.getMinutes()).padStart(2,'0');
              if (hoursWin <= 24) {
                return \`\${h}:\${m}\`;
              } else if (hoursWin <= 72) {
                return [\`\${mo}/\${da}\`, \`\${h}:\${m}\`];
              } else {
                return \`\${mo}/\${da}\`;
              }
            },
          },
        },
        y: {
          title: { display: true, text: ylabel, font: { size: 14, weight: 'bold' } },
        },
      },
      elements: { point: { radius: 1.5 }, line: { tension: 0.2 } },
    },
  });
}

function init() {
  temp  = mkChart(document.getElementById('temp'),  '温度 (°C)');
  humid = mkChart(document.getElementById('humid'), '湿度 (%)');
  ah    = mkChart(document.getElementById('ah'),    '絶対湿度 (g/m³)');
}

async function load() {
  const hours = document.getElementById('range').value;
  document.getElementById('err').textContent = '';
  const stats = document.getElementById('stats');
  stats.textContent = '読み込み中...';
  try {
    const r = await fetch('/data?hours=' + hours + '&_=' + Date.now());
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const all = j.rows || [];
    // Hide SMOKE:TEST rows entirely (test data, not real measurement)
    const rows = all.filter(r => !(r.device_id || '').startsWith('SMOKE'));
    apply(rows);
    const last = rows[rows.length-1];
    const lastTs = last ? last.timestamp : '(なし)';
    const labels = [...new Set(rows.map(labelFor))];
    stats.textContent =
      \`期間: \${hours}h / 行数: \${rows.length} / 系列: \${labels.join(', ') || '(なし)'} / 最終: \${lastTs}\`;
  } catch (e) {
    stats.textContent = '';
    document.getElementById('err').textContent = 'fetch error: ' + e.message;
  }
}

function labelFor(r) {
  // Prefer room name; fall back to a short device id if room is missing
  if (r.room && r.room !== 'unknown') return r.room;
  const id = r.device_id || 'unknown';
  return id.length > 8 ? id.slice(-8) : id;
}

function apply(rows) {
  // Group rows by display label (room or short device id)
  const groups = {};
  for (const r of rows) {
    const k = labelFor(r);
    if (!groups[k]) groups[k] = [];
    groups[k].push(r);
  }
  const datasets = (yKey) =>
    Object.entries(groups).map(([k, list], i) => ({
      label: k,
      borderColor: colors[i % colors.length],
      backgroundColor: colors[i % colors.length] + '33',
      data: list.map(r => ({ x: new Date(r.timestamp.replace(' ', 'T') + '+09:00').getTime(), y: r[yKey] })),
    }));
  try {
    temp.data.datasets  = datasets('temperature');
    humid.data.datasets = datasets('humidity');
    ah.data.datasets    = datasets('absolute_humidity');
    temp.update();
    humid.update();
    ah.update();
  } catch (e) {
    document.getElementById('err').textContent = 'chart error: ' + e.message;
  }
}

function arm() {
  if (refreshTimer) clearInterval(refreshTimer);
  const sec = parseInt(document.getElementById('refresh').value, 10);
  if (sec > 0) refreshTimer = setInterval(load, sec * 1000);
}

document.getElementById('range').addEventListener('change', load);
document.getElementById('refresh').addEventListener('change', () => { arm(); load(); });
document.getElementById('reload').addEventListener('click', () => {
  const btn = document.getElementById('reload');
  const orig = btn.textContent;
  btn.textContent = '更新中...';
  btn.disabled = true;
  load().finally(() => { btn.textContent = orig; btn.disabled = false; });
});

init();
load();
arm();
</script>
</body>
</html>`;
