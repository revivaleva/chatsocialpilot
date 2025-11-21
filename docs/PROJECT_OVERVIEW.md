# Project Overview — chatsocialpilot



## 概要

`chatsocialpilot` は X（旧Twitter）を対象に、API では実行できない操作をブラウザ自動化で行う運用基盤です。LLM を意思決定やコメント生成に利用し、エンゲージメント（いいね、返信、リポスト、引用など）を自動化して多数のアカウントを段階的に育成・運用します。



## 目的（短期〜長期）

- 短期: X 上でのエンゲージメント操作（いいね、コメント、リポスト／引用）を安定して自動化し、まずは運用テストとして約1000アカウントを管理できることを目標とする。  

- 中期: 同時並列の実行基盤を整備し、10 コンテナ並列で 1 時間あたり合計約 60 件程度（1 処理あたり約 10 分の想定）を実行できる運用を実現する。  

- 長期: データ移行・大規模化により数千〜数万アカウントを安全に運用できる基盤へ拡張する。



## 対象プラットフォーム

- 初期フェーズは **X のみ** を対象とする。



## 初期フェーズで実装する機能（優先度順）

1. いいね（Like）を付与する自動化  

2. コメント／返信（Reply）の自動生成と投稿（LLM による文面生成を許可）  

3. リポスト（Retweet）および引用リツイート（Quote）の自動化  

4. ログ・監査・エラー回復の基本機能



※ 投稿（新規ツイート）は原則別ツール（API 経由）で行い、状況に応じて本ツールに投稿機能を追加する可能性がある。



## 中長期の運用／戦略

- アカウント群の相互エンゲージメントによるネットワーク的成長（少しずつ相互にいいねを付け合う等）  

- 特定アカウントの投稿に対して段階的にエンゲージメントを入れる「シーケンス運用」  

- キューイング、プロキシ管理、セッション管理、アカウントローテーションによる耐障害性とレート制御の実装  

- モニタリング、アラート、操作履歴（監査ログ）の整備



## 技術構成（現在のコードベースに基づく）

- エージェント層: `src/agent/`（計画・実行ロジック）  

  - 補足: `src/agent/tasks.ts` に Task モデル（`Task`, `RunLogEntry`）と `runTask` 実行ループが追加され、planner の `steps` を順次実行してログを残す設計になりました（既存の `dispatch` を再利用）。

- ドライバ層: `src/drivers/`（ブラウザ自動化、OpenAI 連携、DB）  

- サービス層: `src/services/`（posting, profiles, selectors, rag 等のビジネスロジック）  

  - 補足: `src/services/capabilities.ts` 付近で High-level capability（例: `x_open_profile`, `x_collect_recent_posts`, `x_like_recent_posts`, `run_preset`）が整理され、LLM は原則これらの High-level を選ぶ方針になっています。Low-level の `click`/`type` はサービス／executor 層で扱う設計です。

- UI/運用ツール: `src/ui/`, `scripts/`（CLI・サーバ・運用スクリプト）  

- 永続化: `storage/app.db`（SQLite 想定）  

- 設定: `config/`（`accounts.json`, `policy.json` 等）



## NLU / プランナー（最近の変更点）

本プロジェクトはユーザの自然言語指示を LLM ベースで「既存の能力（capability）／プリセット」へマッチングし、自動実行または確認フローへ渡す設計に移行しています。主な仕様は下記の通りです。

- ルータ: `src/agent/planner.ts` 内の `router` が LLM に対して能力カタログとユーザ発話を与え、厳密な JSON スキーマで応答（decision, capability, arguments, missing_fields, confidence, user_summary, reason）を受け取ります。  

- 出力スキーマ（必須フィールド）:

  - decision: "execute" | "confirm" | "clarify" | "decline"  

  - capability: 能力キー（例: `create_preset`, `preset:6`, `navigate`）または null  

  - arguments: 実行に必要な引数オブジェクト  

  - missing_fields: 足りない変数の配列（テンプレ変数等）  

  - confidence: 0.0〜1.0 の信頼度（数値）  

  - user_summary: ユーザ意図の短い要約（日本語）  

  - reason: 判定理由（簡潔）  

  - steps: オプションで返すマルチステップ計画（配列 or null）。各ステップは `{ capability, arguments, description? }` の形で、複数能力を順次実行する指示を表現します（後方互換性のため単発の場合は steps=null でも可）。  

- few-shot 例を組み込み、典型的な発話（プリセット作成／投稿いいね／アカウント走査／スケジュール実行 等）に対する安定した出力を目指しています。  

- 自動実行ポリシー（デフォルト）: confidence >= 0.9 で自動実行、0.6〜0.9 は確認（confirm モード）でユーザ承認後実行、<0.6 は補助質問（clarify）。  

- /api/chat の挙動: 受信した発話は従来どおり応答テキストを生成しますが、同時に planner の判定を参照して自動実行を判定します（自動実行された場合は実行結果をレスポンスに含めます）。  

- 監査: 判定結果・ユーザ確認・実行結果は `logs/chat_confirm.jsonl` に保存され、将来の学習と監査に利用します。

 - 追加: High-level capability に `list_containers`（コンテナ一覧取得）を追加しました。チャット発話で「コンテナの一覧を教えて」等といった指示が与えられた場合、planner が `list_containers` を返せばサーバ側で即時に一覧を返す経路が用意されています。

 - デバッグ補助: planner の出力（router の返す JSON）を直接確認できるデバッグ用エンドポイント `POST /api/plan` を追加しました。UI を経由せず planner の判定（decision/capability/steps/confidence 等）を即確認できます。

 - モデル互換性: `src/drivers/openai.ts` の呼び出しを調整し、'nano' 系モデル（例: `gpt-5-nano`）には任意の `temperature` フィールドを送信しないようにしました。これにより `temperature` に関する 400 エラーが発生しにくくなっています。



## ダッシュボード（最近の変更）

- チャット UI: `public/dashboard.html` の AI チャット領域を強化しました。

  - サーバ応答に `messageId` / `sessionId` を付与し、クライアントでメッセージ単位の操作（例: フィードバック）を可能にしています。

  - チャット領域は縦方向にリサイズ可能（`resize: vertical`）になりました。

  - assistant メッセージに「👍 / 👎」ボタンを追加し、ユーザがフィードバックを送信できるようになっています（`POST /api/chat/feedback`）。

- ダッシュボード構成:

  - 「最新スクリーンショット」「直近の投稿」エリアを廃止し、代わりに「タスク一覧（未実行）」と「タスク実行ログ（実行済み）」を表示するレイアウトに変更しました。  

  - タスク一覧は既存 `GET /api/tasks`（未実行タスク）を参照し、実行済ログは `GET /api/task_runs` で取得します。

  - ヘッダに「コンテナ一覧」ボタンを追加し、`GET /api/containers` でコンテナ情報を取得して表示できます（チャットから一覧を要求することも可能）。



## プリセット取込／エクスポート（追加予定）

- プリセット一覧右上に「取込」ボタンを追加し、クリックでモーダルを開いてインポート／エクスポート操作を一箇所で完結。
- モーダル内にはプリセット選択ドロップダウンと「エクスポート」ボタン、下段にエクスポート結果・インポート用のテキストエリアと「インポート」ボタンを並べ、エクスポートでは選択プリセットを JSON 化してクリップボードへコピー（成功/失敗メッセージをモーダル内に表示）、インポートでは貼り付けた JSON を `JSON.parse` して `name` と `steps` の必須フィールドが存在するかだけを確認する最小バリデーションで結果メッセージを見せる構成を想定。
- メッセージ（成功・エラー）はすべてモーダル内に表示し、ファイル出力や追加の確認フロー無しでテキストのコピー/貼り付けが可能な UX とする。

## フィードバック（DB 保存）

- 新しいテーブル `chat_feedback` をマイグレーション `m0005_chat_feedback` として追加しました（`src/drivers/db.ts`）。保存スキーマは最小実装で:

  - `session_id`, `message_id`, `role`, `feedback`("good"|"bad"), `reason?`, `created_at`

- クライアントは `POST /api/chat/feedback` に JSON を送信し、サーバは検証後に INSERT します。将来的な学習や品質計測に利用できます。



## 実行エンジン周りの小改良

- チャット指示からのタスク作成: ユーザ発話で明示的に「タスク作成」「タスク登録」等が含まれる場合、planner が `preset:<id>` や `run_preset` を返せばサーバが `enqueueTask(...)` を呼んでジョブを登録する最小実装を追加しました（`containerId` が必要）。確認フローが必要な場合は従来どおり `waiting_confirm` を返します。

- ロギング: Dashboard の頻繁ポーリング（例: `/api/tasks`）によるノイズログを抑制するため、サーバ側の HTTP ミドルウェアで `/api/tasks` の info-level ログ出力を抑えています（ログ負荷低減）。



## 追加 API（要約）

- `POST /api/chat` — 既存のチャット／planner フロー（応答に `messageId` / `sessionId` を含む）

- `POST /api/chat/feedback` — メッセージ単位の Good/Bad フィードバックを保存

- `GET /api/task_runs` — recent task_runs（実行済みログ）を取得

- `GET /api/containers` — コンテナ一覧を返す（renderer の container-db 参照）



注: プロンプトは `PlannerResultV2` を想定するよう更新され、planner は必ず `steps` フィールド（配列または null）を含めるよう誘導しています。これによりチャットから一連の操作（例: プロフィールを開く→投稿を収集→いいね）を順次実行できるようになりました。



## 運用上の重要ポイント

- レート制御と実行間隔の厳密な設計（バーストを避ける）  

- プロキシ・IP 管理とセッションの隔離  

- アカウントの状態監視と自動復旧戦略（失敗時のリトライ・バックオフ等）  

- LLM 利用におけるトーン管理（本ドキュメントでは自動生成トーンを許可）  

- セキュリティおよび法令順守（運用前に必ず確認）



## テスト計画（運用テストの目安）

- フェーズ 1（スモール）：1000 アカウントでの運用テスト（段階的に負荷を上げる）  

- フェーズ 2（コンテナ並列）：10 コンテナ × 1 時間あたり合計 ~60 件 の実行想定で安定性確認  

- フェーズ 3（スケールアップ）：データ移行とインフラ強化により数千〜数万アカウントへ拡張



## ドキュメント保存場所

- このファイル: `docs/PROJECT_OVERVIEW.md`  

- 関連: `README.md`、`TODO.md`、`setup_guide_v0.4.txt` に要約や手順を追記することを推奨



## 開発上の注意

- `ContainerBrowser` は Cursor 上で開発しています。実装中に不明点やエラーが発生した場合は、問題の再現方法や現象を整理した「確認用プロンプト」を作成して共有するようにしてください（デバッグの効率化と情報の一貫化のため）。  



---

作成日: 2025-11-12  

作成者: chatsocialpilot 自動生成ドキュメント



## コンテナブラウザ — 現在できること（要約）

- 起動方法: Electron の main プロセスが `startExportServer()` を呼び、デフォルトで `127.0.0.1:3001` をリッスン。ローカルバインドのみ（外部公開禁止）。  

- 利用可能な HTTP API:

  - `POST /internal/export-restored` — 指定 `containerId` を開いて復元し、`ensureAuth` でトークン取得→`auth.validate`→Cookie 注入。`id` 必須で `ensureAuth`/`timeoutMs`/`forceCopy`/`returnToken` などを受け、処理中は `locks` で排他。レスポンスは `{ ok:true, lastSessionId, authInjected, token?, cookieNames?, message:'profile copy disabled' }` など。

  - `POST` / `DELETE /internal/export-restored/delete` — 保存ファイルの削除を行う（`path` 指定）。  

  - `POST /internal/export-restored/close` — `id` を指定して `closeContainer` + `waitForContainerClosed` を実行し、ロックをクリアして BrowserWindow/BrowserView を解放。`timeoutMs` 付きで待機上限あり。既に閉じた場合は `closed:false` を返す。  

  - `POST /internal/exec` — 開いているコンテナの BrowserView を操作するリモート制御API。`contextId`, `command`（`navigate`, `type`, `eval` のみ。`click`/`scroll` は廃止済みで `eval` で代替）と `options`（`waitForSelector`, `timeoutMs`, `returnHtml`, `returnCookies`, `screenshot`, `exprId`, `sourceSnippet` など）を受け取る。`returnHtml:'trim'` はサニタイズ済み body innerHTML、`screenshot=true` で `shots/` 配下に PNG を保存し `screenshotPath` を返す。例外時は `errorDetail`（message/stack/line/column/snippet/context/exprId/sourceSnippet）付き `ok:false` を返す。  

- `GET /internal/containers` は現状未実装（404）。コンテナ一覧は renderer 側の IPC ハンドラ `containers.list` 経由で取得可能（`window.containersAPI.list()`）。外部プロセスから一覧を取得するには別途 HTTP エンドポイントを追加する必要あり。  

- 認証・保護: 上記 HTTP API はローカルバインドで保護されており通常追加認証は不要。`/internal/exec` は環境変数 `REMOTE_EXEC_HMAC` を設定すると HMAC チェックを要求（リクエスト本体の HMAC を `x-remote-hmac` ヘッダに付与）。  

- 排他・ロック: 同一 `containerId` / `contextId` に対する並列操作は排他され、409 が返される。  

- タイムアウト: デフォルトの全体タイムアウトは約 60s。`exec` の個別操作には `timeoutMs` 指定が可能（デフォルト例: 30s）。  

- スクリーンショット: `exec` の `screenshot=true` 指定で `shots/` 配下に PNG を保存し、`screenshotPath` を返す。  

- コンテナ情報のデータソース: コンテナ情報はアプリの SQLite DB に保存（Windows 例: `%APPDATA%/container-browser/data.db`、テーブル `containers`）。Main プロセスは `DB.listContainers()` / `DB.getContainer(id)` で参照（実装: `src/main/db.ts`）。  

- ログイン・チャレンジ対応方針: ログイン画面・2FA・CAPTCHA 等を検出したら自動停止しユーザによる手動解除を要求する運用。  

- 安全運用の推奨: 常に dryRun で検証 → 必要な場合にのみ `ensureAuth=false/true` や `dryRun=false` を切り替える。

-### デバッグ・`/internal/exec` 補足



- `POST /internal/exec` は `contextId`（containerId） + `command`（`navigate`, `type`, `eval`）と任意の `options` を受け取り、開いている BrowserView を直接操作するエンドポイントです。

- `options` には `timeoutMs`, `waitForSelector`, `returnHtml`, `returnCookies`, `screenshot` 等があり、HTMLやクッキーの返却は真値を送った場合のみ。デバッグでは `returnHtml: 'trim'` を含め、応答に HTML を含めた上で UI に表示しています（HTML は個別に保持し、ログには出力しない）。

- `params`/`overrides` などのテンプレート変数はクライアント側で置換し、`cmdPayload` に展開済みの値（`url`, `selector`, `text`）を入れて `/internal/exec` に渡す。サーバー側もリクエストの `options` をマージして `internal/exec` へ forward するため、カスタムオプションがそのまま反映されます。

- デバッグ中の `debug-step` では `/api/presets/:id/debug-step` が exec からのレスポンスを `commandResult` という構造に整形して返し、`didAction`/`selector`/`reason`/`elapsedMs` を使った成功判定や `eval` 結果の検証に利用できます。フロントでは `HTMLをコピー` することでスクラップした DOM も別途確認可能です。

- `eval` ステップは実行スクリプト（JS）側で必ず `didAction: true|false` を返すルールとし、フロント画面の didAction 期待値選択（ドロップダウン）を削除しました。スクリプト側で想定通りアクションできたタイミングで `didAction:true` を、想定外の結果や停止が必要なときは `didAction:false` を返し、`reason` や `commandResult` を参照してタスク側で成功/停止/失敗を分離する運用としてください。

- ステップタイプごとの成功判定ルールにも
- ステップタイプごとの成功判定ルールにも注意してください。`navigate`（URLを開く）では「期待する URL（または正規表現）」との一致を使って成功とみなし、`didAction` に頼る必要はありません。その他のステップ（`type`/`eval` など）は URL が変化しないため、`didAction: true` を返すことで成功判定を伝える方式に統一しています。将来的には `didAction` を返さないステップ種を `eval` に統一する方向で API を整理する予定です。

- 複数ステップのデバッグ実行でも同一 `containerId` は排他され、409 が返る。`REMOTE_EXEC_HMAC` 環境変数がセットされていれば `x-remote-hmac` で HMAC を付与する必要があります。

- `unsupported command` などのエラーは `command` 名や `options` の整合性チェック、コンテナ側が該当 `command` をサポートしているか確認することで回避可能。必要であればコンテナ側の拡張（例: `returnHtml` をデフォルト有効にする）をリクエストできます。

- `eval` はクライアントが `JSON.stringify(expr)` を `body.eval` に入れて送信し、サーバ側が `JSON.parse` で復元した文字列を `wc.executeJavaScript(exprStr, true)` で直接評価する方式に変更済み。構文に `}`/`;` を含んでもテンプレート上で壊れず、安全に動作する。

- 実行時の構文・実行例外は `try/catch` して `message`/`stack`/`line`/`column`/`snippet`/`context`/`exprId`/`sourceSnippet` を含む `errorDetail` をレスポンスへ添える。UI 側でこの `errorDetail` を `commandResult` に転記すれば DevTools を開かずにエラー箇所を特定できるようになります。
