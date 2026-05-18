# SwitchBot 温湿度ロギング (Cloudflare Workers + D1)

## 概要
SwitchBot 温湿度計から 10 分毎(cron)+ 変化時(Webhook)に温度・湿度・電池残量を取得し、
絶対湿度を計算して Cloudflare D1 に追記ログするバッチ。

## 構成
- Cloudflare Workers — scheduled() で cron、fetch() で Webhook 受信
- Cloudflare D1 — SQLite 互換のサーバーレス DB(`env.DB` バインディング)
- SwitchBot API v1.1 — デバイス状態取得 + Webhook
- 可視化 — 本リポジトリ範囲外(Phase 2 で追加予定)

## 前提
- Node.js 20+
- Cloudflare アカウント
- SwitchBot API トークン + シークレット(SwitchBot アプリから発行)

## デプロイ手順(推奨: GitHub Actions 経由)

トークン類を **GitHub Secrets に暗号化保存**し、ワークフローからデプロイする方式。
チャットやローカルにトークンを露出させない。

### 1. Cloudflare Account ID を取得
Cloudflare ダッシュボード右側に表示される 32 桁の hex 文字列。

### 2. GitHub Secrets を登録
リポジトリ `Settings → Secrets and variables → Actions → New repository secret` で以下を登録:

| 名前 | 値 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API トークン(`Workers Scripts: Edit` + `D1: Edit` 権限、IP フィルタなし) |
| `CLOUDFLARE_ACCOUNT_ID` | 上記 Account ID |
| `SWITCHBOT_API_TOKEN` | SwitchBot アプリ → 開発者オプション |
| `SWITCHBOT_API_SECRET` | 同上 |
| `SWITCHBOT_WEBHOOK_SECRET` | `openssl rand -hex 32` で生成した 64 文字の hex |
| `DEVICES` | `[{"deviceId":"XX:XX:XX:XX:XX:XX","room":"living"}]` 形式の JSON 文字列 |

### 3. ワークフロー実行
GitHub の `Actions` タブ → **`Deploy to Cloudflare Workers`** → **`Run workflow`** をクリック。
初回は `register_webhook` を `true` にして実行。

ワークフローは以下を自動実行:
1. D1 データベース作成(初回のみ)+ `wrangler.toml` の `database_id` を自動コミット
2. スキーマ適用
3. Worker Secrets 登録(SwitchBot Token/Secret/WebhookSecret/Devices)
4. デプロイ
5. SwitchBot Webhook 登録(`register_webhook=true` のとき)
6. D1 行数を検証

### 4. 動作確認
`Actions` の実行ログ末尾に `SELECT COUNT(*)` の結果が出る。
継続監視は `npx wrangler tail`(要 wrangler login)。

---

## デプロイ手順(代替: 手動)

ローカルから直接デプロイする場合。

### 1. 依存インストールと認証
```bash
npm install
npx wrangler login
```

### 2. D1 作成 & スキーマ適用
```bash
npx wrangler d1 create switchbot-logs
# 出力された database_id を wrangler.toml に貼り付け
npx wrangler d1 execute switchbot-logs --remote --file=docs/db_setup.sql
```

### 3. Secrets 設定
```bash
npx wrangler secret put SWITCHBOT_API_TOKEN
npx wrangler secret put SWITCHBOT_API_SECRET
npx wrangler secret put SWITCHBOT_WEBHOOK_SECRET
npx wrangler secret put DEVICES   # JSON 文字列
```

### 4. デプロイ
```bash
npm run deploy
```

### 5. SwitchBot Webhook 登録
```bash
WORKER_URL=https://switchbot-temperature-logger.<sub>.workers.dev \
SWITCHBOT_API_TOKEN=... SWITCHBOT_API_SECRET=... SWITCHBOT_WEBHOOK_SECRET=... \
  node scripts/register-webhook.js
```

## ローカル開発
1. `.dev.vars.example` を `.dev.vars` にコピーして値を埋める
2. `npm run dev` で起動
3. `--local --persist` で D1 もローカルファイルに保存される

## Cron スケジュール
`*/10 * * * *`(10 分毎)。範囲: 5〜15 分の中間値として 10 分を採用。

## データソース識別
`temperature_logs.source` 列で `'cron'`(定期取得)と `'webhook'`(変化検知)を区別。
同一タイミングで両方から書き込まれる場合があるため、集計時は必要に応じて重複除外を実装。

## スコープ外
- 可視化(Grafana / Pages / Analytics Engine)
- データ重複の自動除外(クエリ側で対処)
- 単体テスト
