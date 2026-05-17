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

## セットアップ手順

### 1. 依存インストール
```bash
npm install
```

### 2. D1 データベース作成
```bash
npx wrangler d1 create switchbot-logs
```
出力された `database_id` を `wrangler.toml` の `[[d1_databases]]` セクションに貼り付ける。

### 3. スキーマ適用
```bash
npx wrangler d1 execute switchbot-logs --remote --file=docs/db_setup.sql
```

### 4. Secrets 設定
```bash
npx wrangler secret put SWITCHBOT_API_TOKEN
npx wrangler secret put SWITCHBOT_API_SECRET
npx wrangler secret put SWITCHBOT_WEBHOOK_SECRET   # 32 文字以上のランダム文字列
```

### 5. デバイスリスト設定
`wrangler.toml` の `DEVICES` を編集:
```toml
DEVICES = '[{"deviceId":"XX:XX:XX:XX:XX:XX","room":"living"},{"deviceId":"YY:YY:YY:YY:YY:YY","room":"bedroom"}]'
```

### 6. デプロイ
```bash
npm run deploy
```

### 7. SwitchBot Webhook 登録
SwitchBot API に対して Webhook URL を登録:
```bash
curl -X POST https://api.switch-bot.com/v1.1/webhook/setupWebhook \
  -H "Authorization: $SWITCHBOT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"setupWebhook","url":"https://<your-worker>.workers.dev/webhook/<SWITCHBOT_WEBHOOK_SECRET>","deviceList":"ALL"}'
```
※ 署名付きリクエストが必要(`sign`, `t`, `nonce` ヘッダ)。詳細は SwitchBot 公式 API ドキュメント参照。

### 8. 動作確認
```bash
npm run tail
```
cron は 10 分毎に動作。Webhook は対応機種の温湿度変化時に発火。

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
