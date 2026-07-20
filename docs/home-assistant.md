# Home Assistant 連携メモ

このプロジェクトは SwitchBot 機器を Cloudflare Worker + SwitchBot Cloud API で
制御しているが、Home Assistant (HA) からも操作したい場合の方針をまとめる。

## サーキュレーター

- deviceId: `B0E9FEF98348`
- SwitchBot アプリ登録名: **サーキュレーター2 Pro 48**（別名で埋もれてはいない）
- deviceType: `Battery Circulator Fan 2 Pro`（`enableCloudService: true`）

## HA 連携の対応状況（調査: 2026-07-19）

| HA 連携 | サーキュレーター | 備考 |
|---|---|---|
| **SwitchBot Cloud**（`switchbot_cloud`） | ✅ 対応 | ON/OFF・モード・バッテリーを fan/センサーとして公開。SwitchBot Cloud API 経由 |
| SwitchBot ローカル Bluetooth（`switchbot`） | ❌ 未対応 | Circulator / Standing Fan は未サポート（`home-assistant/core#172800`） |
| Matter | ✅ 対応 | Matter 対応 SwitchBot Hub が同一ネットワークに必要 |

→ HA に出てこない場合は、たいてい**ローカル Bluetooth 連携**を使っているため。
**SwitchBot Cloud 連携**を追加すれば fan エンティティとして現れる。

参考:
- https://www.home-assistant.io/integrations/switchbot_cloud
- https://www.home-assistant.io/integrations/switchbot/
- https://github.com/home-assistant/core/issues/172800

## 採用方針: 公式 SwitchBot Cloud 連携

rest_command や自作の HMAC 署名は不要。手順:

1. HA → 設定 → デバイスとサービス → 統合を追加 → **「SwitchBot Cloud」**
2. SwitchBot の **トークン** と **クライアントシークレット** を入力
   （このリポジトリの Worker が使うものと同じ値でよい。使い回し可）
3. サーキュレーター2 Pro 48 が fan エンティティとして現れ、HA のオートメーションで制御可能

## ⚠️ 制御の競合に注意

HA の SwitchBot Cloud 連携と、本 Worker の温度自動運転（`/settings`）は、
**どちらも独立してファンを ON/OFF できる**。両方を同時に有効にすると、
互いの操作を打ち消し合う競合が起きうる。

**司令塔は一方に統一すること:**
- HA 側でファンの自動化を組むなら → Worker 側 `/settings` の自動運転は **`enabled=false` のまま** にする
- Worker 側（`/settings`）で自動運転するなら → HA 側ではファンの自動化を組まない（表示・手動操作のみ）

温度の記録・可視化（ダッシュボード）と HA 表示は競合しないので併用してよい。競合するのは
「ファンを能動的に制御する自動化」だけ。

## rest_command 方式（採用しないが、参考）

Worker を制御の司令塔に一本化したい場合は、HA から Worker の `/control` を叩く案もある。
ただし現状 `/control` はログイン（クッキー）認証なので、機械（HA）から呼ぶには
API トークン認証パスの追加が必要になる。今回は公式 Cloud 連携を採るため見送り。
