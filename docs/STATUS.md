# STATUS — handoff snapshot

> Last updated: 2026-07-19. Update this file whenever branch / commits / deploys move.

## Branch & PR

- Working branch: `claude/switchbot-turso-setup-nk30n`
- Open PR: bottmk/switchbot#5 (against main)
- Latest commit on branch: **`8e2f89e`** — `Add repo .claude/settings.json to enable Agent Teams in fresh sessions`

## Deployment status

- Cloudflare Worker: **deployed**(`8e2f89e` 以前の最後の deploy が有効)
- D1 database (`switchbot-logs`): 初期化済み・データ投入済み
- Worker URL: `https://switchbot-temperature-logger.bottmk.workers.dev/`
- **アクセス制御なし**: `/` および `/data` エンドポイントは認証不要 → URL を知る誰でもアクセス可能。Zero Trust (Basic 認証 / Cloudflare Access) の導入を検討中。

## D1 data inventory (as of 2026-07-19)

Row counts by `source`:

| source  | rows    | notes                                      |
|---------|---------|--------------------------------------------|
| cron    | 1,494   | 10 分ポーリング、増加中                       |
| webhook | 713     | SwitchBot webhook リアルタイム受信           |
| import  | 427,460 | CSV 過去履歴 import 済み                    |
| **合計** | **429,667** |                                        |

Per-device:

| device_id      | room          | cron | webhook | import  |
|----------------|---------------|------|---------|---------|
| CA5F44864E85   | 防水温湿度計 85 | 498  | 401     | 11,860  |
| CF173FA3A137   | 温湿度計 37    | 498  | 154     | 0       |
| D02818142841   | 防水温湿度計 41 | 498  | 156     | 415,600 |
| SMOKE:TEST:... | (test)        | 0    | 2       | 0       |

- `SMOKE:TEST:00:00:00:00` の 2 件はテスト用ダミー行。ダッシュボードに混入する場合は cleanup 要。
- `CF173FA3A137` は CSV import 未完了(CSV ファイル未提供)。

## Devices

3 SwitchBot 温湿度センサ producing readings:

- `CA5F44864E85` — 防水温湿度計 85
- `CF173FA3A137` — 温湿度計 37
- `D02818142841` — 防水温湿度計 41

4th SwitchBot device `DF7AEE48D46C` is a Hub Mini — appears in API listings but does
not produce temperature/humidity readings. The Worker filters it out automatically.

## Dashboard の制約

- 表示範囲の最大: **7 日(168h)**
- `/data` API の最大: 30 日(720h, `hours` パラメータ)
- import 済みの 2023 年〜 2025 年データはダッシュボードから**現状見えない**
- 対応案: 範囲セレクタに「30 日 / 90 日 / 1 年」追加 + 長期データは日別集計ビューで表示

## Pending tasks

### Open work items

- **CF173FA3A137 の CSV import**: `CF173FA3A137` の過去 CSV ファイルを
  `data/historical/` に追加 → `data/historical/_mapping.json` 更新 →
  `08-import-history.yml` dispatch。`08` は idempotent なので再実行安全。
- **アクセス制御の導入**: Basic 認証 または Cloudflare Zero Trust(無料 50 ユーザー)で
  `/` と `/data` を保護する。`/webhook/` は署名検証済みで対応不要。
- **ダッシュボード長期表示**: 範囲セレクタ拡張 + 日別集計エンドポイント追加で
  import 済みの過去データをグラフに表示できるようにする。
- **Wrangler バージョン更新**: 現在 3.114.17、最新 4.94.0。
  `npm install --save-dev wrangler@4` で更新可能。動作影響なし、急ぎではない。
- **workflow 自動化**: 現在全 workflow が `workflow_dispatch`(手動)のみ。
  `00-test`, `04-deploy`, `06-smoke-test` を push トリガー化する「ハイブリッド CI/CD」
  移行を検討中(未決定)。
- **E (low priority)**: Suppress halt-comment noise in workflows 06 / 07.

### 検討中・保留事項

- **ブランチ戦略の見直し**: 現状 `claude/switchbot-turso-setup-nk30n` を永続作業ブランチとして使用。
  通常の main 中心運用への移行を検討中(未決定)。
- **Tracker PR パターンの継続可否**: PR #5 を通知ハブとして永続 open にしている設計。
  GitHub Actions → PR コメント → `<github-webhook-activity>` → Claude の自動応答ループを
  維持するか、Issue ベースに切り替えるか検討中。

## Recent commit timeline (top 10)

```
8e2f89e  Add repo .claude/settings.json to enable Agent Teams in fresh sessions
6567a68  conventions: add session learnings (loop guard / backfill / R2 staging / dvh / workflow_run bootstrap / Agent Teams / handoff)
8861001  Auto-deploy on 01-diagnose success (eliminate manual 04 dispatch)
effa6cb  refactor(dashboard): single shared legend above charts
c34c534  fix(dashboard): stack date/time on 3d x-axis to avoid mobile overlap
296cef7  fix(dashboard): respect period selector for 3d/7d (was capped at 24h)
2ba3f89  Add 09-backfill-rooms: one-shot UPDATE for room='unknown' rows
c05d033  Drop author-count gate; halt only on (S1 AND S2) OR S3
ec68922  Add S3 (CI failure streak) to loop guard as OR gate
94be18f  Add S2 (commit message duplication) to loop guard as additional AND gate
```
