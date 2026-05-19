# プロジェクト共通の進め方(横展開向け)

このドキュメントは、switchbot リポジトリで採用している運用パターンの要点を
切り出したものです。新しいリポジトリで Claude Code on the web を使う時に
参考にしてください。User memory(`~/.claude/CLAUDE.md`)に貼り付けるか、
新しい repo の `docs/conventions.md` としてコミットして「これに従って」と
Claude に伝えれば、同じ運用を引き継げます。

---

## コミュニケーション

- **簡潔に。冗長な表現は使わない。**
- 表は比較情報があるときだけ。単なる情報羅列ではプレーンテキストで。
- 完了報告は1〜2 文。次のアクションだけ書く。
- Claude が判断に迷う時は短く質問する。

## 実装前のチェックリスト(必須)

外部 API / Webhook / 外部仕様に関わるコードを書く時、**書き始める前に**:

1. **公式 API ドキュメント該当箇所**を引用する(URL + 該当パラグラフ)
2. **実際のリクエスト/レスポンスのサンプル**を 1 つ取得する
3. **両者から想定する変換ロジック**を 1 行で言語化する

→ これをやらずに「文字列がそのまま使える」と仮定すると、必ず後で書式不一致でハマる。
(本プロジェクトでは MAC アドレスのコロン有無で発生)

## テスト方針

- **外部 I/O のない pure 関数(parse / normalize / compute 系)は単体テスト必須**。
  追加コストはほぼゼロ。書式バグは仕様確認とテストで本番デプロイ前に検出すべき。
- 個人運用でも書く。再デプロイ 1 回の方が高くつく。
- 統合テスト / ステージング環境は個人運用には過剰。**fail-fast + 短い修正サイクル**でカバー。
- ツール: Node.js 22+ の組み込み `node:test`(追加依存ゼロ)

例:
```js
// test/devices.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookupRoom } from '../src/devices.js';

test('lookupRoom normalizes MAC formats', () => {
  const devs = [{ deviceId: 'AA:BB:CC:DD:EE:FF', room: 'living' }];
  assert.equal(lookupRoom(devs, 'AABBCCDDEEFF'), 'living');
});
```

`package.json` への追加:
```json
"scripts": { "test": "node --test 'test/**/*.test.js'" }
```

## GitHub Actions ワークフロー設計(switchbot 採用パターン)

### 階層化
- **00-test.yml** — 全 push でテスト実行。loop-guard なし(暴走しない)。
- **01-diagnose.yml / 06-smoke-test.yml / 07-diag-to-issue.yml** — 読み取り系。
  push でも auto-trigger、loop-guard 付き。
- **02-init-d1.yml / 03-set-secrets.yml / 04-deploy.yml / deploy.yml** —
  本番状態を変える系。`workflow_dispatch` のみ。手動オペレーション。

### Loop guard
連続 Claude commit が 3 個でメインジョブを skip。`workflow_dispatch` 時は
バイパス。halt 時に PR にコメントを残して可視化。

```yaml
- id: check
  run: |
    if [ "$GITHUB_EVENT_NAME" = "workflow_dispatch" ]; then
      echo "go=true" >> $GITHUB_OUTPUT; exit 0
    fi
    AUTHORS=$(git log -3 --format='%ae')
    CLAUDE=$(echo "$AUTHORS" | grep -c 'noreply@anthropic.com' || true)
    if [ "$CLAUDE" -ge 3 ]; then echo "go=false" >> $GITHUB_OUTPUT
    else echo "go=true" >> $GITHUB_OUTPUT; fi
```

### Concurrency
`cancel-in-progress: true` で重複 run を自動キャンセル。

### Tracker PR + post-tracker.cjs
ブランチに対して draft PR を 1 個作っておき、ワークフロー出力を **PR コメント**
として投稿する。Claude は `mcp__github__subscribe_pr_activity` でその PR に
subscribe し、push やワークフロー完了を自動受信できる。

`scripts/post-tracker.cjs`(`.cjs` 拡張子必須: `package.json` の
`"type": "module"` 下でも CommonJS で動かすため):

```js
const fs = require('node:fs');
module.exports = async ({ github, context, core, logPath, kind }) => {
  let body = '';
  try { body = fs.readFileSync(logPath, 'utf8'); } catch {}
  if (body.length > 60000) body = body.slice(0, 60000) + '\n\n... (truncated)';
  const branch = context.ref.replace('refs/heads/', '');
  const prs = await github.rest.pulls.list({
    owner: context.repo.owner, repo: context.repo.repo,
    state: 'open', head: `${context.repo.owner}:${branch}`, per_page: 1,
  });
  const wrapped = '```\n' + body + '\n```';
  const title = `[${kind}] run #${context.runNumber} on ${branch}`;
  if (prs.data.length) {
    await github.rest.issues.createComment({
      owner: context.repo.owner, repo: context.repo.repo,
      issue_number: prs.data[0].number, body: `### ${title}\n\n${wrapped}`,
    });
  } else {
    await github.rest.issues.create({
      owner: context.repo.owner, repo: context.repo.repo, title, body: wrapped,
    });
  }
};
```

ワークフロー側:
```yaml
- name: Post report
  if: always()
  uses: actions/github-script@v7
  with:
    script: |
      const post = require('./scripts/post-tracker.cjs');
      await post({ github, context, core, logPath: '/tmp/run.log', kind: 'diag' });
```

### Secret scrubbing
ログを投稿する前に、既知の Secret 値を `<<NAME>>` プレースホルダに置換。
GitHub Issue/PR body は自動マスクされないので必須。

```yaml
- name: Scrub secrets
  env:
    SECRET_A: ${{ secrets.SECRET_A }}
    # ...
  run: |
    python3 - <<'PY'
    import os
    with open('/tmp/run.log') as f: t = f.read()
    for n in ['SECRET_A', 'SECRET_B']:
        v = os.environ.get(n, '')
        if v: t = t.replace(v, f'<<{n}>>')
    with open('/tmp/run.log', 'w') as f: f.write(t)
    PY
```

## Cloudflare Workers デプロイの罠

### `[vars]` と Secret 同名問題
`wrangler.toml` の `[vars]` に書いた key を後で削除して、代わりに
`wrangler secret put` でセットしようとすると、deploy 前なら Var が残っており
**「Binding name 'X' already in use [code: 10053]」** で失敗する。

→ deploy.yml の順序は **「Deploy → Set Secrets」**。Deploy が
wrangler.toml を再適用して古い Var を消してから Secret を put する。

## 受け渡し時のセキュリティ

- トークン直貼り は **TTL 短く + 完了即 Revoke**
- 環境変数注入(Claude Code on the web の Environment 設定)が次善
- GitHub Actions Secrets が最強(暗号化、登録後閲覧不可、Workflow 越しに自動配布)
- Private リポでは Spending Limit を $0 に設定して暴走時の課金を 0 に固定

## Claude の自律レベル

- **Lv1 同期**: ユーザが毎回 Run/Done を伝える
- **Lv2 PR 通知**: subscribe_pr_activity で完了を自動受信。あなたは Run のみ。
- **Lv3 push 自動**: 一部ワークフローを push トリガーに(本番デプロイは除外)。
  Loop guard 必須。

個人運用なら **Lv2** が良いバランス。デプロイは手動コントロールを残す。
