# CLAUDE.md

## 0. このリポジトリの目的（要約）
chatsocialpilot は X（旧Twitter）向けの運用基盤で、APIではできない操作をブラウザ自動化（別アプリ: Container Browser）で行う。  
LLM で意思決定・コメント生成を行い、いいね・返信・リポスト・引用などのエンゲージメントを自動化する。  
段階的育成・多数アカウント運用を想定（短期: ~1000 / 中期: 10コンテナ並列 / 長期: 数千〜数万）。

まず読む:
- docs/PROJECT_OVERVIEW.md（事実上のトップドキュメント）
- TODO.md（作業粒度/受入れ条件/進め方）
- .cursor/rules/mainrule.mdc（回答フォーマットや最小差分など ※技術スタックは現実と不一致の可能性あり）

---

## 1. クイックスタート（ローカル）
前提:
- Node.js: 20.x LTS 推奨（PROJECT_OVERVIEW）
- Container Browser（別アプリ）を事前に起動しておく（ローカル HTTP 127.0.0.1:3001）

### セットアップ
```bash
npm install
cp .env.example .env
# OPENAI_API_KEY を設定（必須）
```

### 起動（推奨）
```bash
npm run dashboard
# http://localhost:5174（または DASHBOARD_PORT）で確認
```

注意:
- `npm run dev` は `tsx src/run.ts` を起動するが、run.ts は CLI 廃止により即終了する（実質は dashboard を使う）。
- Container Browser が未起動だとコンテナ操作は失敗する。

---

## 2. コマンド一覧（確定しているもの）
install:
- `npm install`

dashboard（推奨）:
- `npm run dashboard`（= `tsx src/ui/server.ts`）

dev:
- `npm run dev`（= `tsx src/run.ts` ※基本使わない）

lint:
- `npm run lint`
- `npm run lint:fix`

format:
- `npm run format`
- `npm run format:check`

typecheck:
- `npm run typecheck`

build:
- `npm run build`（dist 生成。noEmitOnError false || true のため、失敗でも通ったように見える可能性に注意）

test:
- `npm test`（placeholder / 現状テスト未実装）

start（注意）:
- `npm start`（= `node dist/run.js`。run.ts が即終了するため、これ単体では「何も起きない」ように見える可能性）

---

## 3. アーキテクチャ超要約（理解の地図）
入力:
- ダッシュボード（タスク登録・プリセット編集）または scripts/ からの登録
- Container Browser は別プロセス（127.0.0.1:3001 の HTTP API）

処理:
- タスクキュー（default, queue2, queue3, queue4）にタスクが入り、
  executor.dispatch が preset.steps に従って capability を順に実行する。
- コンテナ操作は drivers/browser.ts 経由で Container Browser の /internal/exec 等を叩く。

永続化:
- SQLite（storage/app.db, better-sqlite3, WAL）
  - tasks, task_runs, run_history, presets, x_accounts, container_groups, proxies, email_accounts 等
- Container Browser 側にも別DB（例: %APPDATA%/container-browser/data.db）がある

出力:
- task_runs / run_history に実行結果
- スクショ: shots/
- ログ: logs/
- ダッシュボード API: /api/tasks, /api/task_runs, /api/containers 等

**プリセット40（X投稿・文章のみ）**: 最初のステップの待機時間・タイムアウト、投稿取得失敗時の即失敗、JSON 変更後の DB 同期手順は `docs/PRESET_40_XPOST_OPERATION.md` に記載。

---

## 4. “壊すとヤバい”境界（変更前に必ず意識する）
1) containerId の扱いが混在している
- x_accounts.container_id は「コンテナ名（XID）」
- container_group_members.container_id は UUID
- taskQueue / server 側で変換や対応づけが前提になっているため、ここを崩すと表示・実行が壊れる

2) 同一 containerId の並列操作は排他される
- 409 で排他（同一コンテナの同時操作は禁止）

3) プロキシ分散の前提
- “同一プロキシ＝同一キュー” で分散する設計がある（キュー設計を崩すと負荷/偏りが出る可能性）

4) DBスキーマとタスク実行の対応
- tasks / task_runs / run_history の対応関係は運用の心臓部。安易なカラム変更や命名変更は事故に直結する

---

## 5. 外部依存・統合先
必須:
- OpenAI API（コメント生成/LLM）: OPENAI_API_KEY
- Container Browser（別アプリ）: 127.0.0.1:3001（起動が前提）

オプション/環境次第:
- IMAP（emailFetcher / 確認コード取得など）
- keytar（OSキーチェーンに資格情報保存）
- Discord webhook（settings に discordWebhookUrl がある）
- SMSPVA API V2（src/services/smsPva.ts / 番号・確認コード取得）
- Google Drive（画像URLをプロフィール/ヘッダ等で参照する運用がある）

---

## 6. 設定 / 環境変数（棚卸し）
### 必須
- OPENAI_API_KEY: OpenAI 呼び出し用（絶対にコミットしない）

### 任意（代表）
- TZ: 例 Asia/Tokyo
- DASHBOARD_PORT: ダッシュボードのポート
- CONTAINER_BROWSER_HOST: Container Browser のホスト（デフォルト http://127.0.0.1:3001）
- CONTAINER_EXPORT_HOST / CONTAINER_EXPORT_PORT: export/profiles 系のホスト/ポート
- SMSPVA_API_KEY: SMSPVA 連携用（settings.json でも設定可能）
- DEFAULT_CB_DB: Container Browser DB のパス（未設定時は %APPDATA%/container-browser/data.db）
- CONTAINER_BROWSER_EXE / CONTAINER_EXEC_TIMEOUT_MS
- OPENAI_TIMEOUT_MS / OPENAI_MAX_RETRIES / OPENAI_REQ_TIMEOUT_MS / DEFAULT_OPENAI_MAXTOKENS 等
- LOG_LEVEL

### Secrets 扱い推奨（漏れると危険）
- OPENAI_API_KEY
- REMOTE_EXEC_HMAC（導入する場合。コード側の参照/検証箇所は要確認）
- プロキシ認証、IMAP、X 認証情報、Discord Webhook URL（設定やDBに載り得るため秘匿前提）

---

## 7. 開発ルール（短い憲法）
- 最小差分が基本。無関係な整形/リネーム/大移動は禁止
- 変更前に「壊すとヤバい境界」を読み、影響範囲を宣言してから触る
- プリセット編集・作成時は **タイムアウト60秒、実行後待機30秒** を原則とする（詳細は `.cursor/rules/preset.mdc` 参照）
- `.cursor/rules/mainrule.mdc` の「回答フォーマット/最小差分/進め方」は有効
  - ただし技術スタック記載（Next.js/Amplify/DynamoDB 等）は現実と一致しない可能性があるため、必ず本リポジトリの実装を優先する

---

## 8. Definition of Done（初期）
コミット/PR の完了条件:
- `npm run lint:fix` と `npm run format` を実行し、husky/lint-staged を通す
- `npm run typecheck` が通る（現状 CI 未組み込みのためローカル必須）
- `npm run dashboard` で起動し、UI が表示できる（localhost:5174 など）
- Container Browser 起動後、ダッシュボードで「コンテナ一覧」が取得できる
- 最小の動作確認: 1プリセット × 1コンテナ でタスク登録〜実行が通る（手順は notes に残す）

---

## 9. 落とし穴DB（再発防止）
### [PITFALL-001] ルールの技術スタックが現実とズレて誤誘導する
- 症状: AI/新人が `.cursor/rules` を信じて Next.js/Amplify 前提で提案・改修してしまう
- 原因: ルールが別プロジェクト前提の記述を含む
- 対策: docs/PROJECT_OVERVIEW.md と src 実装を正とする。必要なら rules を現実に合わせて修正
- 予防ルール: 「技術構成は PROJECT_OVERVIEW と package.json を優先して確認する」

### [PITFALL-002] `npm start` しても何も起きないように見える
- 症状: start 実行後に画面もログも出ず混乱する
- 原因: run.ts が CLI 廃止で即終了する設計
- 対策: `npm run dashboard` を正規手順として案内する
- 予防ルール: “起動”は dashboard を起点に確認する

### [PITFALL-003] Container Browser 未起動で全て失敗する
- 症状: navigate/click/type が失敗し続ける
- 原因: Container Browser が別プロセス前提
- 対策: 先に Container Browser を起動し、127.0.0.1:3001 が生きていることを確認
- 予防ルール: 「まず Container Browser 起動」を環境構築の先頭に置く

### [PITFALL-004] containerId の “XID と UUID 混在”で表示・実行が壊れる
- 症状: コンテナ一覧やグループ表示、タスク実行が不整合になる
- 原因: DB上で container_id の意味がテーブルにより異なる
- 対策: 変更前に該当テーブルと変換箇所（taskQueue/server）を特定してから触る
- 予防ルール: container_id を扱う修正は「影響範囲」と「確認手順」を必ず notes に残す

### [PITFALL-005] メール本文の QP デコードで日本語が崩れ固定フォーマットがマッチしない
- 症状: メールアドレス変更用の確認コード取得で、正しい6桁（例: 003458）ではなく MIME boundary の数字（例: 101595）が返る
- 原因: Quoted-Printable の `=XX` を `String.fromCharCode(parseInt(hex,16))` で1バイトずつ文字にしただけだと、UTF-8 多バイト列が「バイト＝1文字」扱いになり日本語が正しい文字列にならない。その結果、固定フォーマット用の日本語アンカーが一致せずフォールバックで本文先頭の6桁（boundary 等）を拾う
- 対策: QP デコードで得たバイト列を UTF-8 として解釈する（例: `Buffer.from(str, 'latin1').toString('utf8')`）。対象が text/html など charset=UTF-8 のパートであることを前提にする
- 予防ルール: メール本文から日本語アンカーでコードを抽出する処理を書く場合、「QP → バイト列 → UTF-8 解釈」の順で行う

---

## 10. 直近の作業（再開を速くする）
- last updated: 2026-02-11
- 直近で触った領域:
  - プリセット40: メディアステップ削除（文章のみ投稿）。運用メモは docs/PRESET_40_XPOST_OPERATION.md
- 未解決/保留:
  - （ここに追記）
- 次にやること（最大3つ）:
  1. Rolex予約自動化の統合テスト（humanClick による reCAPTCHA 突破の確認）
  2. 応募完了までのフル・プリセット（SMSPVA連携含む）の構築
  3. メールアドレス・電話番号の自動供給部分のロジック実装

---

## 11. 意思決定ログ（戻れない選択だけ）
- 2026-02-05: “起動手順は dashboard を正とする” 理由: run.ts が即終了するため / 代替案: run.ts を復活させるが現状はしない
- （重要な方式選定だけ追記）

---

## 12. CLAUDE.md / notes 運用ルール（これが“学習ループ”）
更新するタイミング:
- バグを踏んだ / ハマった / 仕様上の落とし穴が判明した → PITFALL を追加
- 作業を中断する → 「直近の作業」を更新（次の一手は3つまで）
- 戻れない選択をした → 意思決定ログに1行で残す

詳細メモ:
- 長い手順・調査ログ・検証手順は `notes/YYYY-MM-DD__topic.md` に書き、CLAUDE.md からリンクする
