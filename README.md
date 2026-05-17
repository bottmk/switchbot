# SwitchBot 温湿度ロギング (CF Workers + Turso)

## 概要

SwitchBot 温湿度計から10分毎にデータを取得し、Turso (libSQL) に追記するロガーです。Cloudflare Workers の Cron Triggers で動作します。

## 構成

- Cloudflare Workers — 定期実行とデータ取り込み
- Turso (libSQL) — 時系列データの保存先
- Grafana Cloud — 可視化 (スコープ外)

## 前提

- Node.js 20+
- Cloudflare アカウント
- Turso CLI
- SwitchBot API トークン / シークレット

## セットアップ手順

1. 依存関係をインストール

   ```sh
   npm install
   ```

2. Turso DB を作成しスキーマを流し込む

   ```sh
   turso db create switchbot
   turso db shell switchbot < docs/db_setup.sql
   ```

3. Workers シークレットを 4 つ登録

   ```sh
   wrangler secret put SWITCHBOT_API_TOKEN
   wrangler secret put SWITCHBOT_API_SECRET
   wrangler secret put TURSO_DATABASE_URL
   wrangler secret put TURSO_AUTH_TOKEN
   ```

4. `wrangler.toml` の `DEVICES` を設定

   ```toml
   DEVICES = '[{"deviceId":"XXXXXXXXXXXX","room":"living"}]'
   ```

5. 本番デプロイ

   ```sh
   npm run deploy
   ```

6. ログ確認

   ```sh
   npm run tail
   ```

## ローカル開発

`.dev.vars.example` をコピーして `.dev.vars` を作成し、各値を埋めてから起動します。

```sh
cp .dev.vars.example .dev.vars
npm run dev
```

## Cron

10分毎に実行されます (`*/10 * * * *`)。

## スコープ外

Grafana ダッシュボードは別途構築します。
