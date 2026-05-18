# GitHub Actions 経由デプロイ セットアップマニュアル

このドキュメントは、SwitchBot 温湿度ロガーを **GitHub Actions** から
**Cloudflare Workers + D1** にデプロイするための完全な手順書です。
トークンをローカル PC やチャットに露出させずに済むため、本リポジトリでは
**推奨方式**です。

---

## 0. 前提

- GitHub リポジトリの管理権限を持っている
- Cloudflare アカウントを持っている(無料プランで可)
- SwitchBot アプリで温湿度計を登録済み
- 開発者オプションを有効化できる SwitchBot アカウント

このドキュメントの所要時間: **約 30 分**。

---

## 1. 全体像

GitHub Actions ワークフローを 1 回実行すれば、以下が一気通貫で実行されます:

1. Cloudflare D1 データベース作成
2. スキーマ適用(`docs/db_setup.sql`)
3. Cloudflare Worker Secrets 登録
4. Worker デプロイ
5. SwitchBot Webhook 登録
6. D1 行数の検証

そのために事前準備として、**6 つの GitHub Secrets を登録**する必要があります:

| Secret 名 | 取得元 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare ダッシュボード(本書 §3) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare ダッシュボード(本書 §4) |
| `SWITCHBOT_API_TOKEN` | SwitchBot アプリ(本書 §5) |
| `SWITCHBOT_API_SECRET` | SwitchBot アプリ(本書 §5) |
| `SWITCHBOT_WEBHOOK_SECRET` | コマンドで生成(本書 §6) |
| `DEVICES` | 自分で JSON を組み立て(本書 §7) |

---

## 2. Cloudflare workers.dev サブドメイン設定(初回のみ)

Worker をデプロイする前に、`<username>.workers.dev` サブドメインを 1 度だけ予約する必要があります。

1. https://dash.cloudflare.com/ にログイン
2. 左メニュー **Workers & Pages**
3. 初回アクセス時に「Set up your subdomain」ダイアログが出る
4. 希望のサブドメイン名を入力(例: GitHub username をそのまま小文字で)
5. 「Set Subdomain」をクリック

成功すると Worker のデプロイ先 URL がこの形式になります:

```
https://switchbot-temperature-logger.<your-subdomain>.workers.dev
```

> ⚠ サブドメイン名は **後から変更不可**。ただし用途上、Worker の URL は他人に公開しないので深く悩む必要はありません。

---

## 3. Cloudflare API トークン作成

ワークフローが Cloudflare API を叩くために必要なトークンです。

### 3.1. アクセス

https://dash.cloudflare.com/profile/api-tokens を開く(**User API tokens** ページ)。

### 3.2. テンプレ選択

1. **「Create Token」**(青ボタン)をクリック
2. **「Edit Cloudflare Workers」** テンプレの **「Use template」**

### 3.3. 権限の追加(重要)

テンプレに **D1 編集権限が含まれていない**ため、追加します:

1. 権限欄の一番下 **「+ Add more」/「+ さらに追加する」**
2. 新しい行のプルダウンを以下に設定:
   - 種別: **Account**(アカウント)
   - 権限グループ: **D1**(検索ボックスに `D1` と入力)
   - レベル: **Edit**(編集)

完了後、権限欄には以下が含まれているはず:

| 種別 | 権限グループ | レベル |
|---|---|---|
| Account | Workers Scripts | Edit |
| Account | Workers KV Storage | Edit |
| Account | Workers Tail | Read |
| Account | **D1** | **Edit** ← 自分で追加 |
| Account | Account Settings | Read |
| Zone | Workers Routes | Edit |
| User | User Details | Read |
| User | Memberships | Read |

### 3.4. アカウントリソース

| 項目 | 設定 |
|---|---|
| Include / 含む | そのまま |
| 右のプルダウン | 自分のアカウントを選択(または All accounts) |

### 3.5. ゾーンリソース

特にカスタムドメインを使わないので **デフォルト(All zones)** で OK。

### 3.6. クライアント IP アドレスフィルタリング(超重要)

**絶対に何も設定しない**。

- 行が表示されていたら **右端の × ボタンで削除**
- 「自分のIPを使用」ボタンは**絶対に押さない**
- 何か入っていると、GitHub Actions Runner の IP から API が叩けず `Host not in allowlist` エラーで失敗します

### 3.7. TTL(有効期限)

| 項目 | 設定 |
|---|---|
| Start Date | 空欄(または今日) |
| **End Date** | 必要な期間。長期運用なら **1 年後**、安全重視なら **数日後** |

### 3.8. 作成

1. 一番下の **「Continue to summary」/「概要に進む」**
2. 内容確認画面で **「Create Token」/「トークンを作成」**
3. **表示された 40 桁前後のトークン文字列をコピー**

> ⚠ **トークン文字列はこの 1 回だけしか表示されません**。閉じる前に必ずコピー。
> もし保存し忘れたら、トークンを Revoke して新規作成してください。

### 3.9. 形式の確認

- `cfut_` で始まる新方式のトークン形式
- 40 文字程度の英数字
- 例: `cfut_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`(伏字)

---

## 4. Cloudflare Account ID の取得

### 4.1. 方法 A: Workers & Pages 画面

1. Cloudflare ダッシュボード → **Workers & Pages**
2. 右側または下部に「**Account details**」「**API**」セクションが表示される
3. **Account ID** をコピー

### 4.2. 方法 B: URL から取得

ダッシュボードを開いている時の URL を確認:

```
https://dash.cloudflare.com/abc123def456...../workers-and-pages
                            ^^^^^^^^^^^^^^^^^
                            この 32 桁が Account ID
```

### 4.3. 形式の確認

- **32 桁の hex 文字列**(英小文字 a–f + 数字)
- 例: `a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6`

---

## 5. SwitchBot API Token / Secret の取得

### 5.1. 開発者オプションを有効化

1. SwitchBot アプリを開く
2. 右下 **プロフィール** タブ
3. **設定**
4. **アプリバージョン**(下にスクロールした最下部)を **10 回連続でタップ**
5. 「開発者オプション」メニューが新たに表示される

### 5.2. Token / Secret を取得

1. 開発者オプションをタップ
2. **Token**(長い英数字)をコピー → メモ
3. **Secret**(別の英数字)をコピー → メモ

### 5.3. 形式の確認

- どちらも 64 文字程度の英数字
- Secret はやや短いことがある(20〜30 文字程度の場合あり)

---

## 6. Webhook Secret の生成

Worker への Webhook URL に埋め込む推測困難な文字列を作成します。

### 6.1. ローカルマシンで生成(推奨)

```bash
openssl rand -hex 32
```

出力例:
```
2d3930e278bd710e5b43fce37b5695f1ca5741dc7951b5f98e7ad34427b0680e
```

### 6.2. 代替: オンラインジェネレータ

`openssl` が使えない場合は、ブラウザで「random hex generator 64 chars」と検索して使う。

### 6.3. 形式

- **64 文字の hex 文字列**(`a-f0-9`)
- 短すぎると総当たり攻撃のリスクが上がるので 32 文字以上推奨

---

## 7. DEVICES JSON の準備

監視対象の SwitchBot 温湿度計を JSON 形式で列挙します。

### 7.1. デバイス ID の取得

SwitchBot アプリ内の各デバイス設定画面で確認できる **MAC アドレス**(`XX:XX:XX:XX:XX:XX` 形式)が deviceId です。

または、SwitchBot API でリスト取得:
```bash
curl -H "Authorization: <token>" https://api.switch-bot.com/v1.1/devices
```
※ 署名ヘッダ必要。後述の Webhook 登録スクリプトを参考に。

### 7.2. JSON 構築

```json
[
  {"deviceId":"XX:XX:XX:XX:XX:XX","room":"living"},
  {"deviceId":"YY:YY:YY:YY:YY:YY","room":"bedroom"}
]
```

- `deviceId`: 大文字小文字どちらでも OK(コード側で小文字比較)
- `room`: 任意のラベル(`living`, `bedroom`, `kitchen` など)

### 7.3. 1 行に整形(GitHub Secret 用)

GitHub Secrets は改行を含む値も扱えますが、扱いやすさのため 1 行に圧縮:

```
[{"deviceId":"XX:XX:XX:XX:XX:XX","room":"living"},{"deviceId":"YY:YY:YY:YY:YY:YY","room":"bedroom"}]
```

---

## 8. GitHub Secrets の登録

ここまでで取得した 6 つの値を GitHub に登録します。

### 8.1. 登録画面へアクセス

1. GitHub のリポジトリページ
2. **Settings** タブ
3. 左サイドメニュー **Secrets and variables** → **Actions**
4. 「**New repository secret**」(緑のボタン)

### 8.2. 6 つを順に登録

各 Secret について以下を繰り返す:

1. **Name**: 下表の「Secret 名」を**完全一致**で入力(大文字小文字も)
2. **Secret**: 値をペースト
3. 「**Add secret**」をクリック

| Secret 名 | 値の例 | 取得元 |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | `cfut_XXXXXXXXXXXXXXXX...`(40 桁前後) | §3 |
| `CLOUDFLARE_ACCOUNT_ID` | `a1b2c3d4e5f6a7b8c9d0...` | §4 |
| `SWITCHBOT_API_TOKEN` | `xxxxxxxxxxxxxxxxxxxx...` | §5 |
| `SWITCHBOT_API_SECRET` | `xxxxxxxxxxxxxxxxxxxx...` | §5 |
| `SWITCHBOT_WEBHOOK_SECRET` | `2d3930e278bd710e5b43...` | §6 |
| `DEVICES` | `[{"deviceId":"XX:XX:...` | §7 |

> ⚠ 登録後、**値の閲覧は不可**(GitHub の仕様)。書き直したい場合は「Update」から上書きのみ。

### 8.3. 登録確認

登録完了後、Secrets 一覧画面に 6 つが並んでいることを確認:

```
Repository secrets (6)
- CLOUDFLARE_ACCOUNT_ID         Updated XX seconds ago
- CLOUDFLARE_API_TOKEN          Updated XX seconds ago
- DEVICES                       Updated XX seconds ago
- SWITCHBOT_API_SECRET          Updated XX seconds ago
- SWITCHBOT_API_TOKEN           Updated XX seconds ago
- SWITCHBOT_WEBHOOK_SECRET      Updated XX seconds ago
```

---

## 9. ワークフロー実行

### 9.1. 実行

1. GitHub リポジトリの **Actions** タブ
2. 左メニューから **「Deploy to Cloudflare Workers」** を選択
3. 右上 **「Run workflow」**(プルダウン)
4. 入力:
   - **Branch**: デプロイしたいブランチ(通常は `main` or 開発ブランチ)
   - **Register/update SwitchBot webhook after deploy**: **初回は ✓ をオン**
5. 「Run workflow」(緑ボタン)

### 9.2. ログ確認

実行中の job をクリックすると各ステップのログが見られます。所要時間は約 2–4 分。

成功時のサマリー欄に Worker URL が表示されます:

```
## Deployed
- Worker URL: https://switchbot-temperature-logger.<sub>.workers.dev
```

---

## 10. 設定値の確認方法(再取得)

> ⚠ **GitHub Secrets は登録後の値を再表示できない仕様**です。
> 「合っているか確認したい」場合は元のソースで再取得して比較するか、上書き登録します。

| 値 | 再取得方法 |
|---|---|
| **CLOUDFLARE_API_TOKEN** | 再取得不可。失念したら新規作成して上書き |
| **CLOUDFLARE_ACCOUNT_ID** | https://dash.cloudflare.com/ で再表示可能 |
| **SWITCHBOT_API_TOKEN** | SwitchBot アプリ → 開発者オプションで再表示 |
| **SWITCHBOT_API_SECRET** | 同上 |
| **SWITCHBOT_WEBHOOK_SECRET** | 再生成して上書き(Worker と SwitchBot 両方の更新が必要) |
| **DEVICES** | SwitchBot アプリで再構築 |

### Cloudflare 側で各 Secret が反映されているか確認

```bash
# ローカルから wrangler login 済みの場合
npx wrangler secret list
```

出力に以下が含まれていれば OK:
- `SWITCHBOT_API_TOKEN`
- `SWITCHBOT_API_SECRET`
- `SWITCHBOT_WEBHOOK_SECRET`
- `DEVICES`

### SwitchBot Webhook が登録されているか確認

```bash
# scripts/register-webhook.js を再実行すれば idempotent に動作
node scripts/register-webhook.js
```

出力に `Webhook already registered.` が出ればすでに登録済み。

---

## 11. トラブルシューティング

### 11.1. ワークフローが `Host not in allowlist` で失敗

**原因**: Cloudflare API トークンに IP フィルタが設定されている。

**対処**:
1. https://dash.cloudflare.com/profile/api-tokens
2. 該当トークンの「…」→ Edit
3. 「Client IP Address Filtering」欄を **すべて削除**(× ボタン)
4. 保存(トークン文字列は変わらない)

### 11.2. `D1 database not found` で失敗

**原因**: `wrangler.toml` の `database_id` が `REPLACE_WITH_ACTUAL_ID` のままで、かつ D1 作成にも失敗している。

**対処**:
- ワークフローログで `wrangler d1 create switchbot-logs` の出力を確認
- 「already exists」が出ている場合、`wrangler d1 list --json` でリストアップ → ID を手動で `wrangler.toml` に書き込んでコミット

### 11.3. デプロイは成功するが SwitchBot からデータが来ない

**確認項目**:
1. `register_webhook=true` でワークフローを再実行
2. SwitchBot アプリで「対象デバイスが Webhook 対応機種か」確認(温湿度計 plus/Hub2 等)
3. Worker URL が `workers.dev` ドメインで正しく到達するか curl で確認:
   ```bash
   curl -X POST https://switchbot-temperature-logger.<sub>.workers.dev/webhook/<webhook-secret> \
     -H "Content-Type: application/json" \
     -d '{"eventType":"test"}'
   ```
   → `{"ok":true,"ignored":true}` が返れば疎通 OK

### 11.4. cron が動いていない

**確認**:
- Cloudflare ダッシュボード → Workers → 該当 Worker → **Triggers** タブ
- `Cron Triggers` に `*/10 * * * *` が表示されているか

ない場合、`wrangler.toml` の `[triggers]` セクション欠落 → 再デプロイ。

### 11.5. ワークフローがブランチ保護で push できない

**症状**: `Commit database_id if new` ステップで失敗。

**対処**:
- `Settings → Branches → Branch protection rules` で対象ブランチを確認
- GitHub Actions からの push を許可するか、main ブランチ以外で実行

---

## 12. 完了後のクリーンアップ

### 12.1. 一時的なトークンの Revoke

短期 TTL でトークンを作った場合、TTL 切れで自動失効するので放置で OK。
即座に無効化したいなら:

1. https://dash.cloudflare.com/profile/api-tokens
2. 該当トークン → **Roll** または **Revoke**

> ⚠ Revoke すると、次回ワークフロー実行時に失敗します。再デプロイする場合は **新しいトークンを作成して GitHub Secret を更新**してください。

### 12.2. GitHub Secrets はそのままで OK

GitHub Secrets は暗号化保存され、ワークフロー以外からは閲覧不可能。
再デプロイで再利用するためにそのまま保持します。

### 12.3. ローカル PC のクリーンアップ

このワークフロー方式では**ローカル PC にトークンが保存されない**ため、特に削除作業は不要。
ただし、メモアプリやクリップボード履歴に貼った場合はそちらを削除してください。

---

## 13. 参考

- Cloudflare Workers ドキュメント: https://developers.cloudflare.com/workers/
- Cloudflare D1 ドキュメント: https://developers.cloudflare.com/d1/
- SwitchBot API ドキュメント: https://github.com/OpenWonderLabs/SwitchBotAPI
- 本リポジトリの `wrangler.toml` / `.github/workflows/deploy.yml` / `scripts/register-webhook.js`
