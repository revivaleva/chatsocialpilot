# Chat Assistant / Dashboard AI チャット ドキュメント

このドキュメントは、現状の AI チャット機能の仕様、凍結中の機能、開発者向けメモをまとめたものです。プロジェクト内の `docs/chat-assistant-docs.md` として保存します。

---

## 1. 現状できること（ユーザー向け概要）

このセクションは「Dashboard の AI チャットで今できること」だけをまとめています。将来的に拡張する想定はありますが、ここでは以下の 3 つに絞っています。

### 1-1. ヘルプの出力（できる事の一覧）

#### 振る舞い

- ユーザーが「できる事を教えて」「何ができますか？」などと入力すると、LLM を呼ばずに、サーバ側で用意した固定のヘルプテキストを返します。  
- 提案カード（proposals）は現在表示しません。純粋に「テキストのヘルプ」だけが返ってくる仕様です。

#### ざっくり仕様

- エンドポイント: `POST /api/chat`  
- サーバ側で「ヘルプ系の発話」と判定された場合:
  - OpenAI API は呼ばない  
  - `text` にヘルプ文をセット  
  - `planCandidates` は空 or `null`
- 返ってきた `text` は通常のアシスタントメッセージとして UI に表示され、DB に保存されます。

---

### 1-2. 空のプリセット作成（preset_create_empty）

#### なにが起きるか

- ユーザーが次のような入力をすると:
  - 「空のプリセットを作って」
  - 「新しいプリセットを 1 つ作成して」
  - 「プリセットを作成したい」
- Planner が `preset_create_empty` という capability を返し、サーバ側がそれを検知して、即座に空のプリセットを作成します。

#### 作成される内容

- `presets` テーブルにレコードを 1 行追加します:
  - `name`
    - ユーザーの発話から名前を抽出できればそれを使用
    - 取れない場合は `preset-${Date.now()}` 形式の自動生成名
  - `description`
    - 指定があれば使用、なければ空文字
  - `steps_json`
    - `[]`（空配列）で作成。ステップは後から UI で編集する前提

#### 応答内容

- `POST /api/chat` のレスポンス `text` には、次のようなメッセージが返ります（一例）:

```
新しい空のプリセットを作成しました: (id: 12, name: preset-1763450000000)
必要に応じてステップ編集画面からステップを追加してください。
```

- `outcome` フィールドにも `{ ok: true, id, name }` が入っています（開発者向け）。

---

### 1-3. 通常の会話（LLM との雑談・相談）

#### 振る舞い

- 上記 1-1, 1-2 にマッチしない発話は、通常の LLM チャットとして扱われます。  
  - 例: 「今日は調子どう？」「コンテナブラウザの設定方針どう思う？」など
- 現状、この通常会話からはコンテナ操作やタスク実行などは行いません。会話専用モードとして扱います。

#### ログ保存

- すべての会話は `chat_messages` テーブルに保存されます。
  - `role = 'user'`: ユーザー入力
  - `role = 'assistant'`: モデルからの返答
- `meta_json` には、現状主に以下が入る可能性があります:
  - `intent`（内部的な解析結果）
  - `rating` / `ratingComment` / `ratingAt`（評価ボタン経由）

---

### 1-4. メッセージの評価（👍 / 👎）

#### UI の動き

- 各アシスタントメッセージに対して：
  - 👍 ボタン：即「good」として評価を送信
  - 👎 ボタン：簡単なコメント入力を求め、そのコメント付きで「bad」評価を送信

#### API

- エンドポイント: `POST /api/chat/rate`
- リクエスト例:

```json
{
  "sessionId": "chat-1763xxxxxxx",
  "messageId": "msg-1763xxxxxxx",
  "rating": "good",
  "comment": null
}
```

- `rating` は `"good"` か `"bad"` のみ。  
- サーバ側では該当メッセージの `meta_json` をマージ更新し、以下を保存します:
  - `rating`: `"good"` または `"bad"`
  - `ratingComment`: 任意コメント（bad のときだけでも OK）
  - `ratingAt`: タイムスタンプ（ミリ秒）

---

### 1-5. 今はあえて「やらないこと」

このバージョンでは、チャットからの操作範囲をあえて絞っています。

- ❌ チャット経由でのコンテナ一覧取得・グループ設定・タスク作成・実行  
- ❌ 「提案カード（proposals）」からの自動実行  
- ❌ チャット経由でのバルク操作（大量いいね、フォローなど）

これらは今後の拡張候補としてコード／ドキュメントに残しておき、当面は UI からの手動操作（コンテナ一覧・グループ設定・タスク作成）を中心に運用する想定です。

---

## 2. 凍結中 / 今後の拡張候補機能メモ

このセクションは、現在いったん実装を止めている「AI チャット連携機能」を整理したメモです。将来また実装を再開する際の ToDo リストとして使う想定です。

### 2-1. 提案カード（proposals）と確認モーダル

#### 提案カード UI（現在 OFF）

- 元々は、`/api/chat` のレスポンス `planCandidates` から「提案カード」を作り、  
  - 「詳細」  
  - 「確認してタスク登録（dryRun）」  
  - 「確認して実行（本番）」  
  のボタンで操作する構成だった。  
- 現状は render 部分を無効化し、カード自体を表示していません。

#### 確認モーダルの挙動（封印中）

- `openConfirmModal(proposal, defaultDryRun)` でモーダルを開く。OK すると:
  - `/api/chat/confirm` に監査用ログを保存
  - `proposal.presetId` があれば `/api/presets/{id}/run-with-overrides` を叩いてタスク登録
- 課題点（凍結理由）:
  - `presetAccount` 要素の扱い・containerId の決定ロジックが不統一だった
  - proposal に `presetId` がないとボタンが無効化される構造だった
- 現在、この一連のフローは封印しており、UI からは到達しません。

---

### 2-2. Planner 経由の自動実行機能

#### fast_path: `list_containers`

- ユーザー発話から `list_containers` をヒューリスティックで判定し、`scanContainers(defaultCbDir())` を直接叩いてテキストを返す special-case がある。  
- 現在は「チャットからコンテナ操作はしない」方針のため、この機能も実質封印しています。

#### その他の capability

- 例: `task_create`, `task_update`, `task_delete`, `group_assign_members`, `run_preset`, `preset_create_empty`（一部は今も使用）  
- 将来的には「チャット → plan → confirm → execute」の流れで動かす想定ですが、現状は空プリセット作成以外は自動実行しない方針です。

---

### 2-3. 汎用実行エンドポイントの構想

将来的に `/api/plan/execute` のような汎用実行エンドポイントを用意し、UI が確認済みの plan を渡してサーバ側で capability ごとに実行する構成を想定しています。現状は未実装です。

---

### 2-4. コンテナ / グループ / タスクをチャットからいじる構想

将来の構想メモとして以下のアイデアがありましたが、現在はチャット経由での実行は行いません。UI 操作を優先します。

- 「このコンテナを A グループに入れて」  
- 「B グループのコンテナで、このプリセットを毎日 10:00 に実行するタスクを作って」  
- 「今日動いたタスクの状況を教えて」

---

### 2-5. 再開する場合の優先順位案

1. `/api/plan/execute` のような汎用実行 API を作る  
2. 提案カード（proposals）を「表示だけ」復活し、execute はまだやらない  
3. SAFE capability のみ「チャット → plan → UI 確認 → `/api/plan/execute`」で段階的に有効化  
4. 問題なければ capability を増やす

当面は「ここまではやらずに、一旦ドキュメント化して終了」とします。

---

## 3. Chat 機能の開発者向けメモ

このセクションは、`/api/chat` 周りのサーバ処理と DB 保存、評価機能の流れの開発者向けまとめです。

### 3-1. エンドポイント一覧

- `POST /api/chat` — メインのチャット API  
- `GET /api/chat/history` — セッションごとの履歴取得（Dashboard 起動時に使用）  
- `POST /api/chat/rate` — メッセージへの評価（👍 / 👎）

---

### 3-2. `/api/chat` の処理フロー（ざっくり）

```
受信
  ↓
ユーザ入力の正規化 (userText)
  ↓
ユーザメッセージを chat_messages に INSERT
  ↓
ヘルプ or preset_create_empty の special-case 判定
  ↓
それ以外は LLM 呼び出し（通常会話）
  ↓
アシスタントメッセージを chat_messages に INSERT
  ↓
JSON でレスポンス
```

（詳細は本文に記載の通り）

---

### 3-3. `/api/chat/history` の流れ（概要）

- クエリ: `sessionId`, `limit`  
- `chat_messages` テーブルから `session_id` 一致かつ `created_at` の古い順で取得し、最大 `limit` 件返す。  
- フロント側では `loadChatHistory()` で呼び、`chatState.messages` に復元して `renderChat()` で描画する。

---

### 3-4. `/api/chat/rate` の仕様

#### リクエスト

`POST /api/chat/rate`  
```json
{
  "sessionId": "chat-xxxx",
  "messageId": "msg-xxxx",
  "rating": "good",
  "comment": "optional"
}
```

- `rating`: `"good"` または `"bad"`  
- `comment`: 任意（bad のときに入力される想定）

#### サーバ側処理

1. `sessionId`, `messageId`, `rating` のバリデーション  
2. 対象レコードを `chat_messages` から取得（1件）  
3. `meta_json` を `JSON.parse`（失敗したら `{}`）し、以下をマージ:  
   - `rating`  
   - `ratingComment`（コメント、最大長を適宜トリム）  
   - `ratingAt`（タイムスタンプ）  
4. `meta_json` を `JSON.stringify` して UPDATE

成功レスポンス: `{ "ok": true }`

---

### 3-5. フロント側（dashboard.html）との接続ポイント

- `#chatForm` の submit ハンドラが `POST /api/chat` を呼ぶ。  
- レスポンスから `text` をチャットエリアへ表示し、`messageId` / `sessionId` を `chatState.messages` に保存して評価時に利用する。  
- 各 assistant メッセージに 👍 / 👎 ボタンを配置し、`sendRating(msg, rating, comment)` で `POST /api/chat/rate` を呼ぶ。

---

### 3-6. 今後いじるときのガイドライン

1. まず special-case を検討して機能を固定する（ヘルプや空プリセットなど）。  
2. DB スキーマは触らず `meta_json` に情報を蓄える。  
3. 副作用操作はチャット経由にする場合は必ず確認フローを挟む。

---

以上



