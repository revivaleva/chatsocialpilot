# Project Overview — chatsocialpilot



## 概要

`chatsocialpilot` は X（旧Twitter）を対象に、API では実行できない操作をブラウザ自動化で行う運用基盤です。LLM を意思決定やコメント生成に利用し、エンゲージメント（いいね、返信、リポスト、引用など）を自動化して多数のアカウントを段階的に育成・運用します。

## クイックスタート（インストール・テスト手順）

### 📦 配布パッケージ

**推奨**: `chatsocialpilot-simple-v0.4.zip` を使用

### 🚀 3ステップでインストール

1. **ZIPファイルをダウンロード・解凍**
   - 任意の場所に解凍（ダウンロードフォルダでも可）
   - 自動で最適な場所への移動を提案

2. **ワンクリックセットアップ**
   ```
   ChatSocialPilot-QuickSetup.bat をダブルクリック
   ```
   - Node.js確認・依存関係インストール
   - 設定ファイル作成・ショートカット作成
   - 全て自動で実行

3. **設定・起動**
   - `.env` ファイルでOpenAI API キーを設定
   - `config/` フォルダで各種設定を調整
   - デスクトップのショートカットで起動

### ⚡ テスト用最小手順

```bash
# 1. 事前準備
# Node.js 20.x LTS をインストール
# OpenAI API キーを取得
# Container Browser アプリを起動

# 2. セットアップ
ChatSocialPilot-QuickSetup.bat  # ダブルクリック

# 3. 設定
# .env ファイルを編集:
OPENAI_API_KEY=sk-your-api-key-here

# 4. 起動
# デスクトップの「ChatSocialPilot Dashboard」をダブルクリック
# または: npm run dashboard
```

### 🔧 ビルド手順（開発者向け）

```bash
# 依存関係インストール
npm install

# TypeScriptビルド
npm run build

# 開発モード起動
npm run dev          # CLI起動
npm run dashboard    # ダッシュボード起動（推奨）

# 配布パッケージ作成
create-simple-distribution.bat  # 超簡単配布パッケージ
create-distribution.bat         # 完全版配布パッケージ
```

### 📋 必要な環境

- **OS**: Windows 10/11（64bit）
- **Node.js**: 20.x LTS
- **外部アプリ**: Container Browser（別途入手）
- **API**: OpenAI API アカウント

### 🎯 動作確認

1. **ダッシュボード起動**: http://localhost:5174
2. **Container Browser連携**: 「コンテナ一覧」ボタンをクリック
3. **プリセット管理**: プリセット一覧から新規作成・編集
4. **タスク実行**: プリセットを選択してタスクを登録・実行



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



## 実行エンジン

本プロジェクトでは、プリセットに定義されたステップを順次実行する実行エンジンを提供しています。

- エグゼキューター: `src/agent/executor.ts` の `dispatch` 関数が、各種 capability（`open_container`, `navigate`, `click`, `type`, `eval`, `remember` 等）を実行します。

- 実行履歴: 各 capability の実行結果は `run_history` テーブルに記録され、実行時間（`latency_ms`）、成功/失敗（`outcome`）、報酬（`reward`）などの情報が保存されます。これにより、実行パフォーマンスの分析や改善に利用できます。

- メモリ機能: `memory` テーブルを使用して、キー・値・タイプ（`fact`, `preference`, `alias` 等）の組み合わせで情報を永続化できます。`remember` capability を通じて、実行時にメモリへの保存が可能です。



## ダッシュボード

- ダッシュボード構成:

  - 「タスク一覧（未実行）」と「タスク実行ログ（実行済み）」を表示するレイアウトです。  

  - タスク一覧は既存 `GET /api/tasks`（未実行タスク）を参照し、実行済ログは `GET /api/task_runs` で取得します。

  - ヘッダに「コンテナ一覧」ボタンを追加し、`GET /api/containers` でコンテナ情報を取得して表示できます。



## プリセット取込／エクスポート（追加予定）

- プリセット一覧右上に「取込」ボタンを追加し、クリックでモーダルを開いてインポート／エクスポート操作を一箇所で完結。
- モーダル内にはプリセット選択ドロップダウンと「エクスポート」ボタン、下段にエクスポート結果・インポート用のテキストエリアと「インポート」ボタンを並べ、エクスポートでは選択プリセットを JSON 化してクリップボードへコピー（成功/失敗メッセージをモーダル内に表示）、インポートでは貼り付けた JSON を `JSON.parse` して `name` と `steps` の必須フィールドが存在するかだけを確認する最小バリデーションで結果メッセージを見せる構成を想定。
- メッセージ（成功・エラー）はすべてモーダル内に表示し、ファイル出力や追加の確認フロー無しでテキストのコピー/貼り付けが可能な UX とする。

## 投稿ライブラリ機能（新規）

本機能は、大量の投稿文・画像をあらかじめ DB に保存しておき、プリセット実行時に未使用データを自動取得して eval に埋め込むことで、同じプリセットで異なるコンテンツを投稿する運用を実現します。

### スキーマ設計

#### `post_library` テーブル
```sql
CREATE TABLE post_library (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT,                 -- 投稿文
  used INTEGER DEFAULT 0,       -- 0=未使用, 1=使用済み
  created_at INTEGER,
  updated_at INTEGER
);
CREATE INDEX idx_post_library_used ON post_library(used);
```

#### `post_media` テーブル（画像・動画：最大4枚）
```sql
CREATE TABLE post_media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  type TEXT,                    -- "image" or "video"
  path TEXT NOT NULL,           -- ローカルパス (例: ./media/img1.jpg)
  created_at INTEGER,
  FOREIGN KEY(post_id) REFERENCES post_library(id) ON DELETE CASCADE
);
CREATE INDEX idx_post_media_post_id ON post_media(post_id);
```

#### `presets` テーブルへの追加カラム
```sql
ALTER TABLE presets ADD COLUMN use_post_library INTEGER DEFAULT 0;
```

### 実行フロー

1. **タスク実行時**（`runTask()` in `taskQueue.ts`）
   - プリセットの `use_post_library` フラグを確認
   - フラグが立っている場合、**post_library から未使用データ 1 件取得**（WHERE used=0 LIMIT 1）
   - 取得した `content` と関連する `post_media` をテンプレート変数にマージ：
     ```
     vars.post_content = "よろしくお願いします！"
     vars.post_media = [
       { type: "image", path: "./media/img1.jpg" },
       { type: "image", path: "./media/img2.jpg" }
     ]
     ```

2. **eval ステップ実行**
   - `applyTemplate()` で `{{post_content}}` / `{{post_media}}` を置換
   - eval 内で画像をアップロード等の操作を実行

3. **成功後**
   - `markPostItemUsed(postId)` で該当レコードを `used=1` に更新

### UI 画面設計

#### 1) 投稿ライブラリ管理画面（新規）
- 左サイドバーに「投稿ライブラリ」メニューを追加
- 画面構成：
  - **[+ 新規投稿を追加]** ボタン
  - **投稿一覧テーブル**：ID | 投稿文（先頭100字） | 画像数 | 使用状況 | 作成日 | [削除]
  - **[一括削除]** / **[CSVエクスポート]** ボタン

#### 2) 投稿追加モーダル
- **投稿文**（テキストエリア、最大280字推奨）
- **画像・動画アップロード**（ドラッグ＆ドロップ、最大4ファイル）
  - ファイル名・サイズ表示
- **[保存]** / **[キャンセル]** ボタン

#### 3) プリセット編集画面の拡張
- 既存項目に加えて新規チェックボックス追加：
  ```
  ✓ 投稿ライブラリを使用する
  ```
  - チェック時、eval ステップで以下のプレースホルダが自動補完できることを説明
    - `{{post_content}}` — 投稿文
    - `{{post_media}}` — 画像/動画パス配列

### API エンドポイント（新規追加予定）

- `POST /api/post-library/items` — 投稿を新規追加
- `GET /api/post-library/items` — 投稿一覧取得（ページング対応）
- `GET /api/post-library/unused-item` — 未使用データ 1 件取得（内部用）
- `PUT /api/post-library/items/:id/mark-used` — 使用済みにマーク
- `DELETE /api/post-library/items/:id` — 投稿削除（画像ファイルも自動削除）
- `POST /api/post-library/media/:postId` — 画像アップロード（最大4枚）
- `DELETE /api/post-library/media/:mediaId` — 画像削除

### サービス層実装（`src/services/presets.ts`）

- `insertPostItem(content: string, mediaPaths: string[])` — 投稿+画像をセット保存
- `getUnusedPostItem()` — 未使用 1 件取得（JOIN で画像も）
- `markPostItemUsed(postId: number)` — used=1 に更新
- `deletePostItem(postId: number)` — レコード削除（画像ファイルも削除）
- `listPostLibrary(limit: number, offset: number)` — 一覧取得

### 実装済みチェックリスト

- [ ] Migration 追加（post_library, post_media, presets.use_post_library）
- [ ] DB CRUD 関数実装
- [ ] taskQueue.ts で取得・埋め込みロジック追加
- [ ] 投稿ライブラリ管理 UI 実装
- [ ] プリセット編集 UI 修正
- [ ] API エンドポイント実装
- [ ] 動作テスト・ドキュメント更新




## 実行エンジン周りの小改良

- ロギング: Dashboard の頻繁ポーリング（例: `/api/tasks`）によるノイズログを抑制するため、サーバ側の HTTP ミドルウェアで `/api/tasks` の info-level ログ出力を抑えています（ログ負荷低減）。



## 追加 API（要約）

- `GET /api/task_runs` — recent task_runs（実行済みログ）を取得

- `GET /api/containers` — コンテナ一覧を返す（renderer の container-db 参照）

- `POST /api/act` — 直接 capability を実行するエンドポイント（`executor.dispatch` を使用）



## 運用上の重要ポイント

- レート制御と実行間隔の厳密な設計（バーストを避ける）  

- プロキシ・IP 管理とセッションの隔離  

- アカウントの状態監視と自動復旧戦略（失敗時のリトライ・バックオフ等）  

- LLM 利用におけるトーン管理（本ドキュメントでは自動生成トーンを許可）  

- セキュリティおよび法令順守（運用前に必ず確認）

## データ蓄積と保守（現状と推奨対応）

本プロジェクトはローカル SQLite（`storage/app.db`）を永続化に使用しており、運用に伴って複数のテーブルにレコードが蓄積されます。現状で特に蓄積リスクが高いテーブルと推奨対応を以下にまとめます。

- **蓄積が想定される主要テーブル**
  - `task_runs`：実行ごとのログ（`result_json` 等）。頻繁に増加する最重要対象。  
  - `run_history`：capability 実行履歴（`capability_key`, `args_json`, `outcome`, `latency_ms`, `reward` 等）。実行回数に応じて増加。  
  - `job_runs`：定期ジョブの実行ログ。ジョブ頻度に依存して増加。  
  - `posts`, `generations`：投稿履歴や生成出力。出力サイズが大きくなる可能性あり。

- **短期での推奨対応（運用ルール）**
  - 優先対象は `task_runs` と `run_history`。まずは運用ルールを決め、手動削除やアーカイブで増加を抑える。  
  - 削除前に必ず DB スナップショットを作成する（`storage/snapshots` を利用）。`src/drivers/db.ts` の `snapshotDb()` が参考実装あり。  
  - 今回追加した管理API（`POST /api/admin/purge-task-runs`）と簡易UI（`/admin/purge-ui`）を使い、最大件数上限（現在1000）で削除運用を行う。  
  - 削除後の DB ファイル縮小は `VACUUM` が必要だが、`VACUUM` は排他ロックを伴うためオフピークで実行すること。

- **中期〜長期の対策**
  - 定期バッチ（ソフトデリート→一定期間経過後に完全削除）を導入し、自動化する。小バッチ＋再試行で `SQLITE_BUSY` を回避する。  
  - 大容量データ（生成結果等）は外部ストレージ（S3 等）へ移行し、DB に残すのはメタのみとする。  
  - モニタリングを整備する：DBファイルサイズ、テーブルごとの行数、クエリレイテンシの閾値アラートを設定する。

- **デフォルト方針（例）**
  - `task_runs`: 30日保持（運用で延長可）  
  - `run_history`: 90日保持（パフォーマンス分析用途で必要なら延長）  
  - `job_runs` / `generations` / `posts`: 30–90日（用途に応じて調整）

> 注意: SQLite は TTL 機能が無いため、明示的な削除ロジックかアーカイブ設計が必要です。大量削除時は `SQLITE_BUSY` / ロック競合やファイルサイズの即時縮小が起きない点に注意してください。



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

  - `POST /internal/containers/create` — 新しいコンテナを作成します。`name`（必須）とオプションの`proxy`（`server`, `username`, `password`）を受け取ります。プロキシなしの場合は `{"name":"コンテナ名"}`、プロキシありの場合は `{"name":"コンテナ名","proxy":{"server":"proxy.example.com:8080","username":"user","password":"pass"}}` の形式でリクエストします。レスポンスは `{ ok:true, containerId: "生成されたコンテナID", message: "..." }` を返します。このエンドポイントはコンテナを作成して開くため、作成後に`/internal/export-restored`を呼び出す必要はありません。

## コンテナ作成ステップを含むプリセット（新規）

コンテナ作成ステップ（`type: "container"`）を含むプリセットでは、タスク作成時にコンテナ指定が不要になります。コンテナはプリセット実行時に自動的に作成されます。

### X Authログイン用テストデータ形式

プリセット17（X Authログイン）などの認証トークンを使用するプリセットでは、以下の形式でテストデータを提供します：

**データ形式（コロン区切り）:**
```
コンテナ名:パスワード:メールアドレス:?:?:auth_token:ct0
```

**データの各フィールド（インデックス）:**
- `parts[0]`: コンテナ名（例: `nanogarden77203`）
- `parts[1]`: パスワード（使用しない）
- `parts[2]`: メールアドレス（使用しない）
- `parts[3]`: その他（使用しない）
- `parts[4]`: その他（使用しない）
- `parts[5]`: auth_token（認証トークン）
- `parts[6]`: ct0（CSRFトークン）

**使用するパラメータ:**
- `container_name`: `parts[0]`から取得
- `auth_token`: `parts[5]`から取得
- `ct0`: `parts[6]`から取得

**例:**
```
nanogarden77203:fzYJGqx0yLm:evelinelucil8796@outlook.com:LxYlOid25:QLWTXHYTPIMZML6B:e26e180271a8935bc37c0341d3dddbca8310388e:c06a39aae256632188a6614cdf188396a196048d0c53b9908f134778eef4be06b3032152b967a2327c00c963d58dbc46f069e86d7fbb5b129a3670dd3cfda6672d98c2b4679b5ff42789484f11742c88
```

この形式から、コンテナ名、auth_token、ct0を抽出してタスクの`overrides`に設定します。

### X Authログインタスクの一括作成手順

プリセット17（X Authログイン）のタスクを一括で作成する手順です。

#### 1. データ形式の確認

提供されるデータは以下の形式（コロン区切り）です：
```
コンテナ名:パスワード:メールアドレス:?:?:auth_token:ct0
```

**抽出するパラメータ:**
- `parts[0]`: コンテナ名
- `parts[5]`: auth_token
- `parts[6]`: ct0

#### 2. プロキシリストの準備

プロキシは以下の形式で指定します：
```
IP:PORT:USERNAME:PASSWORD
```

例：
```
173.239.233.215:61235:95556_ybuOg:WEP1Yrkfcx
```

複数のプロキシがある場合、タスクごとにランダムに選択して割り当てます。

#### 3. タスク登録スクリプトの作成

以下のようなスクリプト（例: `register-x-auth-tasks.ts`）を作成します：

```typescript
import { enqueueTask } from './src/services/taskQueue.js';
import { initDb } from './src/drivers/db.js';

// データベースを初期化
initDb();

// アカウントデータ（コロン区切り）
const dataLines = [
  'コンテナ名:パスワード:メール:?:?:auth_token:ct0',
  // ... 複数行
];

// プロキシリスト
const proxies = [
  '173.239.233.215:61235:95556_ybuOg:WEP1Yrkfcx',
  // ... 複数のプロキシ
];

// ランダムにプロキシを選択
function getRandomProxy(): string {
  return proxies[Math.floor(Math.random() * proxies.length)];
}

// 各データ行を処理
dataLines.forEach((dataLine) => {
  const parts = dataLine.split(':');
  const containerName = parts[0];
  const authToken = parts[5];
  const ct0 = parts[6];
  const proxy = getRandomProxy();
  
  // タスクを作成
  const runId = enqueueTask({
    presetId: 17,
    containerId: null, // コンテナ作成ステップがあるためnull
    overrides: {
      container_name: containerName,
      auth_token: authToken,
      ct0: ct0,
      proxy: proxy
    },
    waitMinutes: 10 // デフォルト値
  });
  
  console.log(`Registered: ${containerName} - ${runId}`);
});
```

#### 4. スクリプトの実行

```bash
npx tsx register-x-auth-tasks.ts
```

#### 5. 実行結果の確認

- 各タスクにRun IDが割り当てられます
- ダッシュボード（`http://localhost:5174`）でタスクの実行状況を確認できます
- ログは `logs/` ディレクトリに保存されます

#### 6. 注意事項

- **データ形式**: コロン区切りのデータから正しいインデックス（`parts[0]`, `parts[5]`, `parts[6]`）で値を抽出してください
- **プロキシ**: プロキシが不要な場合は、`proxy`フィールドを空文字列にするか、`overrides`から除外してください
- **並列実行**: タスクは順次実行されます。`waitMinutes`で待機時間を調整できます
- **コンテナ作成**: プリセット17にはコンテナ作成ステップが含まれているため、`containerId`は`null`を指定します
- **リトライを避ける**: スクリプトは一度だけ実行してください。重複登録を防ぐため、スクリプトの最後に`process.exit(0)`を追加してください

### プロフィール変更タスクの一括作成手順

プリセット18（プロフィール変更）のタスクを一括で作成する手順です。

#### 概要

プロフィール変更の流れは以下の通りです：

1. **グループ名からグループIDを取得**
   - `container_groups`テーブルからグループ名で検索
   - 同名グループが複数ある場合は、コンテナ数が多い方を優先

2. **グループに属するコンテナを取得**
   - `container_group_members`テーブルからコンテナID（UUID）を取得
   - コンテナDBからコンテナ情報を取得し、UUIDからコンテナ名（XID）に変換
   - **重要**: タスクの`container_id`にはコンテナ名（XID）を保存します（UUIDではなく）

3. **プロフィール情報の取得**
   - `profile_templates`テーブルから未使用（`used_at IS NULL`）のテンプレートをランダムに取得
   - テンプレートには`account_name`（アカウント名）と`profile_text`（プロフィール文）が含まれます

4. **画像の取得**
   - `profile_icons`テーブルから未使用（`used = 0`）のプロフィール画像をランダムに取得
   - `header_icons`テーブルから未使用（`used = 0`）のヘッダ画像をランダムに取得
   - 取得と同時に使用済みにマーク（`used = 1`, `used_at = 現在時刻`）

5. **タスクの登録**
   - プリセット18（プロフィール変更）のタスクを登録
   - `overrides`に以下を設定：
     - `name`: プロフィールテンプレートの`account_name`
     - `bio`: プロフィールテンプレートの`profile_text`
     - `location`: 空文字列（クリア）
     - `website`: 空文字列（クリア）
     - `avatar_image_path`: 取得したプロフィール画像のURL
     - `banner_image_path`: 取得したヘッダ画像のURL

6. **テーブルの更新**
   - `profile_templates`: `used_at`を現在時刻に更新
   - `profile_icons`: `used = 1`, `used_at = 現在時刻`に更新
   - `header_icons`: `used = 1`, `used_at = 現在時刻`に更新
   - `x_accounts`: `x_username`をプロフィールテンプレートの`account_name`に更新

#### 使用方法（グループ単位での一括登録）

グループに属するコンテナに対して、プロフィール情報・画像を自動取得してタスクを登録します。

```bash
# グループ名を指定して1件のタスクを登録
npx tsx scripts/create-profile-task-for-group.ts "グループ名"

# 例: 「X兵隊12/8作成、プロフィール未変更」グループの最初のコンテナにタスクを登録
npx tsx scripts/create-profile-task-for-group.ts "X兵隊12/8作成、プロフィール未変更"
```

**実行例:**
```
グループ: X兵隊12/8作成、プロフィール未変更 (ID: g-1765172239362-8954)

グループ内のコンテナ数: 52件
最初のコンテナにタスクを登録します

コンテナID: astrosynth87208
アカウント名: なお
プロフ文: アラフィフになって本気で自分を整えたいと思った時短勤務ママ。インナーケアや仕事終わりでもできる...
プロフィール画像: https://drive.google.com/file/d/1XEvAuUHMGs5wXcn8hrb1R4LrGLEL46HD/view?usp=drive_link
ヘッダ画像: https://drive.google.com/file/d/1UBnD59mMSTsKvaLKCSivbjDRLmG3NUdv/view?usp=drive_link

✓ タスク登録完了 (Run ID: run-18-2025-12-08T12-51-11-351Z-362573)
✓ プロフィールテンプレートの使用状況を更新しました (ID: 946)
✓ x_accountsテーブルのx_usernameを更新しました (なお)
```

#### データベーステーブル

##### `profile_templates` テーブル（プロフィールテンプレート）
```sql
CREATE TABLE profile_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_name TEXT NOT NULL,
  profile_text TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  used_at INTEGER,
  UNIQUE(account_name, profile_text)
);
```

- `account_name`: アカウント名（Xユーザー名）
- `profile_text`: プロフィール文
- `used_at`: 使用日時（NULL=未使用）

##### `profile_icons` テーブル（プロフィール画像）
```sql
CREATE TABLE profile_icons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id TEXT UNIQUE NOT NULL,
  url TEXT NOT NULL,
  used INTEGER DEFAULT 0,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);
```

##### `header_icons` テーブル（ヘッダ画像）
```sql
CREATE TABLE header_icons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id TEXT UNIQUE NOT NULL,
  url TEXT NOT NULL,
  used INTEGER DEFAULT 0,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);
```

##### `x_accounts` テーブル（Xアカウント情報）
```sql
CREATE TABLE x_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  container_id TEXT NOT NULL UNIQUE,
  x_username TEXT,
  -- ... その他のフィールド
);
```

- `container_id`: コンテナ名（XID）
- `x_username`: Xユーザー名（タスク登録時にプロフィールテンプレートの`account_name`で更新）

#### 注意事項

- **コンテナ名の使用**: タスクの`container_id`にはコンテナ名（XID）を保存します。UUIDではなくコンテナ名を使用することで、タスク編集画面で正しくコンテナが選択されます。
- **コンテナDBに存在しないUUIDの無視**: グループメンバーに含まれているがコンテナDBに存在しないUUIDは、タスク登録時に自動的にスキップされます（警告メッセージが表示されます）。これにより、実行不可能なタスクが作成されることを防ぎます。
- **プロフィールテンプレートの自動選択**: 未使用のテンプレートからランダムに1件を自動選択します。特定のテンプレートを指定したい場合は、スクリプトを修正してください。
- **画像の自動割り当て**: 各コンテナに異なる画像がランダムに割り当てられます。
- **使用済みマーク**: タスク登録時に画像とテンプレートは自動的に使用済みにマークされます。
- **x_accountsテーブルの更新**: タスク登録時に`x_username`が自動的に更新されます。
- **未使用リソースの不足**: 未使用のテンプレートや画像が不足している場合、エラーで処理が中断されます。

#### 今回のタスク登録手順（2025-12-08実施）

グループ「X兵隊12/8作成、プロフィール未変更」に対して、残りのコンテナ（49件）にプロフィール変更タスクを一括登録しました。

**実行コマンド:**
```bash
npx tsx scripts/create-profile-task-for-group.ts "X兵隊12/8作成、プロフィール未変更"
```

**処理内容:**
1. グループメンバー（52件）からコンテナDBに存在するコンテナ名（50件）を抽出
2. 既存タスクを確認し、未登録のコンテナ（49件）を特定
3. 各コンテナに対して以下を実行:
   - 未使用のプロフィールテンプレートをランダム取得
   - 未使用のプロフィール画像をランダム取得（使用済みマーク付き）
   - 未使用のヘッダ画像をランダム取得（使用済みマーク付き）
   - プリセット18（プロフィール変更）のタスクを登録
   - `profile_templates`、`profile_icons`、`header_icons`、`x_accounts`テーブルを更新

**結果:**
- 登録したタスク数: 51件（コンテナDBに存在しないUUIDが2件含まれていたため、実際には49件の有効なタスク）
- エラー: 0件
- コンテナDBに存在しないUUID: 2件（自動的にスキップされ、警告メッセージが表示された）

**学んだ教訓:**
- グループメンバーに含まれているUUIDが、必ずしもコンテナDBに存在するとは限らない
- スクリプトはコンテナDBに存在しないUUIDを無視するように修正済み（今後のタスク登録では同様の問題は発生しない）

#### 従来の手動登録方法（参考）

手動でプロフィール情報を指定してタスクを登録する場合は、以下のスクリプトを使用します：

```bash
# グループ名、アカウント名、プロフ文を指定
npx tsx scripts/create-profile-task-with-info.ts "グループ名" "アカウント名" "プロフ文"
```

詳細は既存の「プロフィール変更タスクの一括作成手順」セクションを参照してください。

### 機能概要

- **コンテナ作成ステップ**: プリセットのステップに `type: "container"` を指定すると、そのステップで新しいコンテナが作成されます。
- **タスク作成時の動作**: コンテナ作成ステップを含むプリセットを選択すると、コンテナ選択セクションが非表示になり、コンテナ指定なしでタスクを作成できます。
- **実行時の動作**: プリセット実行時に、コンテナ作成ステップで指定されたコンテナ名（テンプレート変数 `{{container_name}}` から取得）でコンテナが作成され、後続のステップで使用されます。
- **プロキシ設定**: コンテナ作成ステップでプロキシを指定できます。テンプレート変数 `{{proxy}}` を使用します。形式は `IP:PORT:USERNAME:PASSWORD`（コロン区切り）です。`proxy`が空の場合はプロキシなしでコンテナが作成されます。

**プロキシ設定の例:**
```json
{
  "type": "container",
  "description": "コンテナ指定（プロキシ付き）",
  "container_name": "{{container_name}}",
  "proxy": "{{proxy}}"
}
```

**プロキシ形式:**
- `IP:PORT:USERNAME:PASSWORD` - 完全な形式（例: `173.239.233.215:61235:95556_ybuOg:WEP1Yrkfcx`）
- `IP:PORT` - ユーザー名・パスワードなし（例: `173.239.233.215:61235`）

## コンテナブラウザでのプロキシ設定に関する仕様

### 概要

コンテナブラウザのプロキシ設定機能を改善するため、コンテナを開くAPIからプロキシ設定パラメータを削除し、プロキシ設定専用のAPIを新設しました。

**目的**
- APIの責務を明確に分離する（コンテナを開く操作とプロキシ設定の変更を分離）
- プロキシ設定の変更を柔軟に行えるようにする
- 設定の永続化を保証する（DBに保存され、次回コンテナを開く際も使用される）

**主な変更点**
- `/internal/export-restored` および `/internal/exec` からプロキシ設定パラメータを削除
- `/internal/containers/set-proxy` エンドポイントを新設（コンテナIDまたはコンテナ名で指定可能）
- プロキシ設定はDBに永続化され、コンテナ作成時（`/internal/containers/create`）と設定変更時（`/internal/containers/set-proxy`）でのみ設定可能

**注意**
既に開いているコンテナのプロキシ設定を変更した場合、変更を反映するにはコンテナを一度閉じてから再度開く必要があります。

### 使用方法

#### プロキシ設定API (`/internal/containers/set-proxy`)

**コンテナIDで指定:**
```bash
curl -X POST http://127.0.0.1:3001/internal/containers/set-proxy \
  -H "Content-Type: application/json" \
  -d '{
    "id": "fcc257e7-92e8-41ca-83de-b3afd708372b",
    "proxy": {
      "server": "173.239.233.215:61235",
      "username": "95556_ybuOg",
      "password": "WEP1Yrkfcx"
    }
  }'
```

**コンテナ名で指定:**
```bash
curl -X POST http://127.0.0.1:3001/internal/containers/set-proxy \
  -H "Content-Type: application/json" \
  -d '{
    "name": "remigiozarcorb618",
    "proxy": {
      "server": "173.239.233.215:61235",
      "username": "95556_ybuOg",
      "password": "WEP1Yrkfcx"
    }
  }'
```

**プロキシを無効化:**
```bash
curl -X POST http://127.0.0.1:3001/internal/containers/set-proxy \
  -H "Content-Type: application/json" \
  -d '{
    "name": "remigiozarcorb618",
    "proxy": null
  }'
```

### API仕様

#### リクエスト

- `id` (string, optional): コンテナID
- `name` (string, optional): コンテナ名
- `proxy` (object | null, required): プロキシ設定
  - `server` (string, required): プロキシサーバー（例: "173.239.233.215:61235"）
  - `username` (string, optional): プロキシユーザー名
  - `password` (string, optional): プロキシパスワード
  - `null`: プロキシを無効化

#### レスポンス

- `200 { ok: true, container: {...} }`: 成功
- `400 { ok: false, error: "..." }`: リクエストエラー
- `404 { ok: false, error: "container not found" }`: コンテナが見つからない
- `500 { ok: false, error: "..." }`: サーバーエラー

### 注意事項

#### 既に開いているコンテナの場合

プロキシ設定を更新しても、既存のセッションには反映されません。コンテナを一度閉じてから再度開く必要があります。

#### プロキシ設定の永続化

APIで指定したプロキシ設定はDBに保存されます。次回コンテナを開く際も、この設定が使用されます。

これで、プロキシ設定はコンテナ作成API（`/internal/containers/create`）とプロキシ変更専用API（`/internal/containers/set-proxy`）でのみ行えるようになりました。

## プロキシの追加手順

本プロジェクトでは、プロキシ情報を`proxies`テーブルに保存し、タスク実行時に自動的にプロキシを割り当てることができます。

### データベーススキーマ

#### `proxies` テーブル
```sql
CREATE TABLE proxies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proxy_info TEXT NOT NULL UNIQUE,
  added_at INTEGER NOT NULL
);
```

- `proxy_info`: プロキシ情報（`IP:PORT:USERNAME:PASSWORD`形式）
- `added_at`: 追加日時（タイムスタンプ）

### プロキシ形式

プロキシは以下の形式で保存されます：
```
IP:PORT:USERNAME:PASSWORD
```

**例:**
```
173.239.233.215:61235:95556_ybuOg:WEP1Yrkfcx
```

### 一括追加方法

#### 1. スクリプトの準備

`scripts/add-proxies.ts`スクリプトを使用してプロキシを一括追加します。

#### 2. プロキシリストの編集

`scripts/add-proxies.ts`ファイルを開き、`PROXY_LIST`配列にプロキシを追加します：

```typescript
const PROXY_LIST = [
  '173.239.233.215:61235:95556_ybuOg:WEP1Yrkfcx',
  '173.239.233.199:61235:95556_ybuOg:WEP1Yrkfcx',
  '157.254.14.2:61235:95556_ybuOg:WEP1Yrkfcx',
  // ... 複数のプロキシ
];
```

#### 3. スクリプトの実行

```bash
npx tsx scripts/add-proxies.ts
```

#### 4. 実行結果の確認

スクリプトは以下の情報を表示します：

- **既存のプロキシ数**: データベースに既に登録されているプロキシ数
- **追加対象**: 追加しようとするプロキシ数（重複除去後）
- **追加結果**: 各プロキシの追加状況（追加成功 / スキップ / エラー）
- **処理結果サマリ**: 追加件数、スキップ件数、エラー件数
- **データベース内のプロキシ総数**: 追加後の総数

**実行例:**
```
📥 プロキシの一括追加を開始します...

📊 既存のプロキシ数: 10件

📋 追加対象: 50件（元のリスト: 50件）

✅ [1] 173.239.233.58:61235:95556_ybuOg:WEP1Yrkfcx
✅ [2] 157.254.14.41:61235:95556_ybuOg:WEP1Yrkfcx
⏭️  [スキップ] 173.239.233.215:61235:95556_ybuOg:WEP1Yrkfcx (既に存在します)
...

📊 処理結果:
  ✅ 追加: 40件
  ⏭️  スキップ（既存）: 10件
  ❌ エラー: 0件
  📋 合計: 50件

📊 データベース内のプロキシ総数: 50件
```

### 重複チェック

スクリプトは以下の方法で重複をチェックします：

1. **事前チェック**: データベースに既に存在するプロキシを検索
2. **UNIQUE制約**: データベースレベルでも`proxy_info`カラムにUNIQUE制約があるため、重複登録は防止されます
3. **正規化**: 前後の空白を自動的に削除して比較

既に存在するプロキシは自動的にスキップされ、エラーにはなりません。

### 手動追加（参考）

プログラムから直接追加する場合：

```typescript
import { initDb, run } from './src/drivers/db';

initDb();

// プロキシを追加
run(
  'INSERT INTO proxies (proxy_info, added_at) VALUES (?, ?)',
  ['173.239.233.215:61235:95556_ybuOg:WEP1Yrkfcx', Date.now()]
);
```

### プロキシの確認

データベースに登録されているプロキシを確認する場合：

```bash
# SQLiteで確認
sqlite3 storage/app.db "SELECT id, proxy_info, datetime(added_at/1000, 'unixepoch') as added_at FROM proxies ORDER BY added_at DESC LIMIT 10;"

# 総数を確認
sqlite3 storage/app.db "SELECT COUNT(*) as count FROM proxies;"
```

### 注意事項

- **重複登録の防止**: 同じプロキシ情報は重複して登録されません（UNIQUE制約）
- **正規化**: プロキシ情報は前後の空白が自動的に削除されます
- **形式の検証**: スクリプトは形式の検証を行いません。正しい形式（`IP:PORT:USERNAME:PASSWORD`）で指定してください
- **エラーハンドリング**: エラーが発生した場合、該当プロキシはスキップされ、処理は続行されます

### API エンドポイント

- `GET /api/presets/:id/has-container-step` — 指定されたプリセットにコンテナ作成ステップが含まれているか確認します。レスポンスは `{ ok: true, presetId: number, hasContainerStep: boolean }` を返します。

### 実装詳細

- **バックエンド**: `src/services/presets.ts` に `presetHasContainerStep()` 関数を追加し、プリセットのステップを解析してコンテナ作成ステップの有無を判定します。
- **フロントエンド**: `public/dashboard.html` でプリセット選択時に `updateTaskModalContainerSection()` を呼び出し、コンテナ作成ステップがある場合はコンテナ選択セクションを非表示にします。
- **タスク実行**: `src/services/taskQueue.ts` でコンテナ作成ステップがある場合、`containerId` が `null` でもタスクを実行できるように修正しました。

  - `POST /internal/export-restored` — 指定 `containerId` を開いて復元し、`ensureAuth` でトークン取得→`auth.validate`→Cookie 注入。`id` 必須で `ensureAuth`/`timeoutMs`/`forceCopy`/`returnToken` などを受け、処理中は `locks` で排他。レスポンスは `{ ok:true, lastSessionId, authInjected, token?, cookieNames?, message:'profile copy disabled' }` など。コンテナが存在しない場合はエラーを返します。**注意**: プロキシ設定パラメータは受け取りません。プロキシ設定は `/internal/containers/create` または `/internal/containers/set-proxy` で行います。

  - `POST` / `DELETE /internal/export-restored/delete` — 保存ファイルの削除を行う（`path` 指定）。  

  - `POST /internal/export-restored/close` — `id` を指定して `closeContainer` + `waitForContainerClosed` を実行し、ロックをクリアして BrowserWindow/BrowserView を解放。`timeoutMs` 付きで待機上限あり。既に閉じた場合は `closed:false` を返す。  

  - `POST /internal/exec` — 開いているコンテナの BrowserView を操作するリモート制御API。`contextId`, `command`（`navigate`, `type`, `eval` のみ。`click`/`scroll` は廃止済みで `eval` で代替）と `options`（`waitForSelector`, `timeoutMs`, `returnHtml`, `returnCookies`, `screenshot`, `exprId`, `sourceSnippet` など）を受け取る。`returnHtml:'trim'` はサニタイズ済み body innerHTML、`screenshot=true` で `shots/` 配下に PNG を保存し `screenshotPath` を返す。例外時は `errorDetail`（message/stack/line/column/snippet/context/exprId/sourceSnippet）付き `ok:false` を返す。**注意**: プロキシ設定パラメータは受け取りません。プロキシ設定は `/internal/containers/create` または `/internal/containers/set-proxy` で行います。  

- `GET /internal/containers` は現状未実装（404）。コンテナ一覧は renderer 側の IPC ハンドラ `containers.list` 経由で取得可能（`window.containersAPI.list()`）。外部プロセスから一覧を取得するには別途 HTTP エンドポイントを追加する必要あり。

- `POST /internal/containers/set-proxy` — 既存コンテナのプロキシ設定を変更します。`id`（コンテナID）または `name`（コンテナ名）と `proxy`（`server`, `username`, `password` を含むオブジェクト、または `null` で無効化）を受け取ります。レスポンスは `{ ok:true, container: {...} }` を返します。プロキシ設定は DB に永続化され、次回コンテナを開く際も使用されます。既に開いているコンテナの場合、設定変更を反映するにはコンテナを一度閉じてから再度開く必要があります。  

- 認証・保護: 上記 HTTP API はローカルバインドで保護されており通常追加認証は不要。`/internal/exec` は環境変数 `REMOTE_EXEC_HMAC` を設定すると HMAC チェックを要求（リクエスト本体の HMAC を `x-remote-hmac` ヘッダに付与）。  

- 排他・ロック: 同一 `containerId` / `contextId` に対する並列操作は排他され、409 が返される。  

- タイムアウト: デフォルトの全体タイムアウトは約 60s。各ステップ（`exec` の個別操作）の既定タイムアウトは **30秒**（`timeoutMs` / `timeoutSeconds` で上書き可能）です。`exec` の個別操作には `timeoutMs` 指定が可能（例: 30000）。  

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

- ステップタイプごとの成功判定ルール（簡潔）

- **navigate**
  - HTTP レスポンスの `status` が 200（`ok: true`）でなければ **失敗（failed）** と扱います。
  - `status` が 200 の場合、応答に含まれる URL（`body.url` または正規化された `result.url`）がプリセットで指定した期待パターン（完全一致 / プレフィックス / `re:...` による正規表現）と一致しなければ **停止（stopped）** と扱います。
  - 期待パターンと一致すれば **成功（ok）** と扱います。

- **eval**
  - HTTP レスポンスの `status` が 200（`ok: true`）でなければ **失敗（failed）** と扱います。
  - `status` が 200 の場合、返却された結果オブジェクトの `didAction` が `false` なら **停止（stopped）** と扱い、`true` なら **成功（ok）** と扱います。

その他のステップは既存のルールに従ってください（`type` 等は `didAction` を用いる場合があり、URL 変化を伴わない操作は `didAction` による判定が有効です）。

ステップ実行後の待機（post-wait）

- 各ステップ定義にオプショナルな数値フィールド `postWaitSeconds`（秒）を指定できます。ステップが成功（ok）で終了した後、実行エンジンはこの秒数だけ待機してから次のステップに進みます。
- デフォルトは **10 秒** です（UI とサーバ両方でフォールバックを行います）。0 を指定すると待機はスキップされます。
- 例:
  - `{ "type":"eval", "code":"...", "postWaitSeconds": 5 }` → eval 成功後に 5 秒待機して次へ。
- ログ: ステップの実行結果オブジェクトには待機したミリ秒 `waitedMs` が付与され、監査とトラブルシュートに利用できます。

- 複数ステップのデバッグ実行でも同一 `containerId` は排他され、409 が返る。`REMOTE_EXEC_HMAC` 環境変数がセットされていれば `x-remote-hmac` で HMAC を付与する必要があります。

- `unsupported command` などのエラーは `command` 名や `options` の整合性チェック、コンテナ側が該当 `command` をサポートしているか確認することで回避可能。必要であればコンテナ側の拡張（例: `returnHtml` をデフォルト有効にする）をリクエストできます。

- `eval` はクライアントが `JSON.stringify(expr)` を `body.eval` に入れて送信し、サーバ側が `JSON.parse` で復元した文字列を `wc.executeJavaScript(exprStr, true)` で直接評価する方式に変更済み。構文に `}`/`;` を含んでもテンプレート上で壊れず、安全に動作する。

- 実行時の構文・実行例外は `try/catch` して `message`/`stack`/`line`/`column`/`snippet`/`context`/`exprId`/`sourceSnippet` を含む `errorDetail` をレスポンスへ添える。UI 側でこの `errorDetail` を `commandResult` に転記すれば DevTools を開かずにエラー箇所を特定できるようになります。

## 画像管理機能（プロフィール画像・ヘッダ画像）

本プロジェクトでは、Google Drive上に保存された画像を管理し、未使用の画像をランダムに取得してプロフィール画像やヘッダ画像として使用する機能を提供しています。

### データベーススキーマ

#### `profile_icons` テーブル（プロフィール画像）
```sql
CREATE TABLE profile_icons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id TEXT UNIQUE NOT NULL,
  url TEXT NOT NULL,
  used INTEGER DEFAULT 0,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);
```

#### `header_icons` テーブル（ヘッダ画像）
```sql
CREATE TABLE header_icons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id TEXT UNIQUE NOT NULL,
  url TEXT NOT NULL,
  used INTEGER DEFAULT 0,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);
```

### 使用方法

#### 1. 画像のインポート

Google DriveのURLリストをテキストファイルに保存し、インポートスクリプトを実行します。

**プロフィール画像:**
```bash
# ファイルからインポート
npm run icons:import -- profile-icons-urls.txt

# 標準入力からインポート
echo "https://drive.google.com/file/d/xxx/view" | npm run icons:import
```

**ヘッダ画像:**
```bash
# ファイルからインポート
npm run headers:import -- header-icons-urls.txt

# 標準入力からインポート
echo "https://drive.google.com/file/d/xxx/view" | npm run headers:import
```

#### 2. ランダム取得

未使用の画像をランダムに1件取得します。`--mark-used`オプションを付けると、取得と同時に使用済みにマークされます。

**プロフィール画像:**
```bash
# 取得のみ（マークなし）
npm run icons:random

# 取得と同時に使用済みにマーク
npm run icons:random -- --mark-used
```

**ヘッダ画像:**
```bash
# 取得のみ（マークなし）
npm run headers:random

# 取得と同時に使用済みにマーク
npm run headers:random -- --mark-used
```

#### 3. 使用済みマーク

特定の画像を手動で使用済みにマークします。

**プロフィール画像:**
```bash
# ファイルIDで指定
npm run icons:mark -- 1dbcJxxIHx86RyLMwZNN0DGi3sy-BGHG6

# URLで指定
npm run icons:mark -- "https://drive.google.com/file/d/1dbcJxxIHx86RyLMwZNN0DGi3sy-BGHG6/view"
```

**ヘッダ画像:**
```bash
# ファイルIDで指定
npm run headers:mark -- 1kFGIZr_E_ji5xMtNjxGlZh5l8H4HQ70C

# URLで指定
npm run headers:mark -- "https://drive.google.com/file/d/1kFGIZr_E_ji5xMtNjxGlZh5l8H4HQ70C/view"
```

#### 4. リセット

使用済みフラグをリセットして再利用可能にします。

**プロフィール画像:**
```bash
# 全件リセット
npm run icons:reset

# 特定の画像のみリセット
npm run icons:reset -- 1dbcJxxIHx86RyLMwZNN0DGi3sy-BGHG6
```

**ヘッダ画像:**
```bash
# 全件リセット
npm run headers:reset

# 特定の画像のみリセット
npm run headers:reset -- 1kFGIZr_E_ji5xMtNjxGlZh5l8H4HQ70C
```

#### 5. 一覧表示

画像の一覧と統計情報を表示します。

**プロフィール画像:**
```bash
# 全件表示
npm run icons:list

# 未使用のみ表示
npm run icons:list -- --unused

# 使用済みのみ表示
npm run icons:list -- --used

# 統計情報のみ表示
npm run icons:list -- --stats
```

**ヘッダ画像:**
```bash
# 全件表示
npm run headers:list

# 未使用のみ表示
npm run headers:list -- --unused

# 使用済みのみ表示
npm run headers:list -- --used

# 統計情報のみ表示
npm run headers:list -- --stats
```

### 運用フロー例

1. **初期セットアップ**: URLリストを準備してインポート
   ```bash
   npm run icons:import -- profile-icons-urls.txt
   npm run headers:import -- header-icons-urls.txt
   ```

2. **画像使用**: タスク実行時にランダム取得
   ```bash
   # URLを取得（使用済みマーク付き）
   URL=$(npm run icons:random -- --mark-used | tail -1)
   echo "使用する画像: $URL"
   ```

3. **再利用**: 全件リセットして再度使用可能に
   ```bash
   npm run icons:reset
   npm run headers:reset
   ```

### グループ単位でのタスク登録

グループに属するコンテナに対して、プロフィール画像とヘッダ画像を設定するタスクを一括で登録できます。

#### 使用方法

```bash
# グループ内の全コンテナに対してタスクを作成
npx tsx scripts/create-profile-update-task.ts "グループ名"

# 指定した数のコンテナに対してタスクを作成
npx tsx scripts/create-profile-update-task.ts "グループ名" 5
```

#### 実行例

```bash
# グループ「X兵隊12/5作成、プロフィール画像のみ未変更」の全コンテナに対してタスクを作成
npx tsx scripts/create-profile-update-task.ts "X兵隊12/5作成、プロフィール画像のみ未変更" 8
```

#### 動作

1. 指定されたグループ名からグループIDを取得
2. グループに属するコンテナID一覧を取得
3. 各コンテナに対して以下を実行:
   - 未使用のプロフィール画像をランダムに1件取得（使用済みマーク付き）
   - 未使用のヘッダ画像をランダムに1件取得（使用済みマーク付き）
   - プリセット18（プロフィール変更）のタスクを登録
   - `avatar_image_path`と`banner_image_path`に取得した画像URLを設定

#### 出力例

```
グループ: X兵隊12/5作成、プロフィール画像のみ未変更 (ID: g-xxx)
グループ内のコンテナ数: 8件
登録するタスク数: 8件

タスク 1/8:
  コンテナID: 615b8ead-6c7b-4d3c-baef-58e976bf8d7d
  プロフィール画像: https://drive.google.com/file/d/xxx/view?usp=drive_link
  ヘッダ画像: https://drive.google.com/file/d/yyy/view?usp=drive_link
  ✓ タスク登録完了 (Run ID: run-18-...)

...

統計情報:
プロフィール画像: 合計503件（未使用493件、使用済み10件）
ヘッダ画像: 合計310件（未使用301件、使用済み9件）
```

#### 注意事項

- **グループ名の指定**: グループ名は完全一致で検索されます。正確なグループ名を指定してください
- **画像の自動割り当て**: 各コンテナに異なる画像がランダムに割り当てられます
- **使用済みマーク**: タスク登録時に画像は自動的に使用済みにマークされます
- **タスクパラメータ**: プロフィール画像とヘッダ画像のみが設定され、名前、Bio、Location、Websiteは変更されません
- **未使用画像の不足**: 未使用の画像が不足している場合、エラーで処理が中断されます

### 注意事項

- **URL形式**: Google Driveの共有URL（`https://drive.google.com/file/d/FILE_ID/view?usp=sharing`）または直接ファイルIDに対応しています
- **重複チェック**: 同じ`file_id`の画像は重複してインポートされません
- **統計情報**: 各コマンド実行時に統計情報（合計・未使用・使用済み）が表示されます
- **ランダム取得**: 未使用の画像がない場合、エラーが返されます

## メールアカウント管理機能

本プロジェクトでは、メールアドレスとパスワードの組み合わせを管理し、タスク作成時に未使用のメールアカウントを取得して使用する機能を提供しています。プロフィール画像やヘッダ画像と同様のパターンで、タスク実行時に自動的にメールアカウントを割り当てます。

### データベーススキーマ

#### `email_accounts` テーブル
```sql
CREATE TABLE email_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_password TEXT NOT NULL UNIQUE,
  added_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX idx_email_accounts_used_at ON email_accounts(used_at);
```

### データ形式

メールアカウントは以下の形式で保存されます：
```
メールアドレス:パスワード
```

**例:**
```
aarondonohue2004@puedemail.com:rjdvxldgY7927
```

### 使用方法

#### 1. メールアカウントの追加

データベースに直接INSERTするか、スクリプト経由で追加します。

```typescript
import { run } from './src/drivers/db';

// メールアカウント追加
run(
  'INSERT INTO email_accounts (email_password, added_at) VALUES (?, ?)',
  ['aarondonohue2004@puedemail.com:rjdvxldgY7927', Date.now()]
);
```

#### 2. 未使用メールアカウントの取得

タスク作成時に未使用のメールアカウントを取得します。

```typescript
import { query } from './src/drivers/db';

// 未使用のメールアカウントを1件取得（追加日時が古い順）
const unused = query<{id: number, email_password: string, added_at: number}>(
  'SELECT * FROM email_accounts WHERE used_at IS NULL ORDER BY added_at ASC LIMIT 1'
);

if (unused && unused.length > 0) {
  const account = unused[0];
  const [email, password] = account.email_password.split(':');
  console.log(`メールアドレス: ${email}`);
  console.log(`パスワード: ${password}`);
}
```

#### 3. 使用日時の更新

メールアカウントを使用した際に、使用日時を更新します。

```typescript
import { run } from './src/drivers/db';

// 使用日時更新
run(
  'UPDATE email_accounts SET used_at = ? WHERE id = ?',
  [Date.now(), accountId]
);
```

### タスク作成時の使用パターン

プロフィール画像やヘッダ画像と同様に、タスク作成時に未使用のメールアカウントを自動取得して使用します。

#### 実行フロー例

1. **タスク作成時**
   - プリセットの設定に応じて、未使用のメールアカウントを1件取得
   - `email_password`を`email:password`形式で分割
   - テンプレート変数に設定（例: `{{email}}`, `{{email_password}}`）

2. **タスク実行時**
   - プリセットのステップで`{{email}}`や`{{email_password}}`を使用
   - ログイン処理などでメールアカウント情報を利用

3. **使用後**
   - タスク実行成功時に`used_at`を更新
   - 次回のタスク作成時は別の未使用アカウントが取得される

### 運用フロー例

1. **初期セットアップ**: メールアカウントリストを準備してデータベースに追加
   ```typescript
   const accounts = [
     'aarondonohue2004@puedemail.com:rjdvxldgY7927',
     'another@example.com:password123',
     // ... 複数のアカウント
   ];
   
   accounts.forEach(account => {
     run(
       'INSERT INTO email_accounts (email_password, added_at) VALUES (?, ?)',
       [account, Date.now()]
     );
   });
   ```

2. **タスク作成**: 未使用アカウントを取得してタスクに設定
   ```typescript
   const account = getUnusedEmailAccount();
   if (account) {
     const [email, password] = account.email_password.split(':');
     enqueueTask({
       presetId: 17,
       overrides: {
         email: email,
         email_password: password,
         // ... その他のパラメータ
       }
     });
     
     // 使用済みにマーク
     markEmailAccountUsed(account.id);
   }
   ```

3. **再利用**: 必要に応じて`used_at`をNULLにリセットして再利用可能に
   ```typescript
   // 全件リセット
   run('UPDATE email_accounts SET used_at = NULL');
   
   // 特定のアカウントのみリセット
   run('UPDATE email_accounts SET used_at = NULL WHERE id = ?', [accountId]);
   ```

### 注意事項

- **データ形式**: `email:password`形式で保存されます。コロン（`:`）を含むパスワードの場合は別の区切り文字を使用するか、エスケープ処理が必要です
- **重複チェック**: `email_password`カラムにUNIQUE制約があるため、同じメールアカウントは重複して登録されません
- **未使用アカウントの取得**: `used_at IS NULL`のレコードを`added_at`の昇順で取得することで、古いアカウントから順に使用されます
- **使用済みマーク**: タスク実行成功時に`used_at`を更新することで、同じアカウントが重複して使用されることを防ぎます

## Xアカウント管理機能

本プロジェクトでは、X（旧Twitter）アカウントの認証情報を管理する機能を提供しています。コンテナID（XユーザーID）、パスワード、2FAコード、Authトークン、CSRFトークン（ct0）などを一元的に管理し、タスク実行時に自動的に認証情報を取得して使用できます。

### データベーススキーマ

#### `x_accounts` テーブル
```sql
CREATE TABLE x_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  container_id TEXT NOT NULL UNIQUE,    -- XユーザーID（コンテナ名として使用）
  email TEXT,                           -- メールアドレス（email_accountsから引き当て）
  email_password TEXT,                   -- メールパスワード
  x_password TEXT,                       -- Xアカウントのパスワード
  follower_count INTEGER,                 -- フォロワー数
  following_count INTEGER,               -- フォロー数
  x_username TEXT,                        -- Xユーザー名
  x_user_id TEXT,                         -- XユーザーID
  twofa_code TEXT,                       -- 2FAコード
  auth_token TEXT,                        -- Authトークン
  ct0 TEXT,                              -- CSRFトークン
  last_synced_at INTEGER,                -- 最終同期日時
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_x_accounts_container_id ON x_accounts(container_id);
CREATE INDEX idx_x_accounts_email ON x_accounts(email);
```

### データ形式

ログイン情報は以下の形式（コロン区切り）で管理されます：
```
XID:Xパスワード:旧メールアドレス:旧メールパスワード:2FAコード:Authトークン:ct0
```

**例:**
```
astrosynth18312:LQlI5Fd0xV4I4:stefyarteaga7583@outlook.com:LIn855H5:R7MRH65FZ5VWB6KM:d0c53a8359f7c0fe3aa4ba3f4d8addf279ceedcc:77abccc2213d45a3808b18371444011bb2b4aed1756d365a9ce5a1b895ff68c60d37cd34c9892003420eda2edde607a0d46b514eb1918f9041baabd4e0fd078ada81f819d52a72b77bd0b948270266f6
```

**各フィールドの説明:**
- `parts[0]`: XID（XユーザーID）→ `container_id`に保存
- `parts[1]`: Xパスワード → `x_password`に保存
- `parts[2]`: 旧メールアドレス → **保存しない**（email_accountsから別途引き当て）
- `parts[3]`: 旧メールパスワード → **保存しない**
- `parts[4]`: 2FAコード → `twofa_code`に保存
- `parts[5]`: Authトークン → `auth_token`に保存
- `parts[6]`: CSRFトークン（ct0） → `ct0`に保存

### 使用方法

#### 1. データファイルの準備

テキストファイル（例: `accounts.txt`）に1行1アカウントで記載します。空行や`#`で始まる行はコメントとして無視されます。

```
astrosynth18312:LQlI5Fd0xV4I4:stefyarteaga7583@outlook.com:LIn855H5:R7MRH65FZ5VWB6KM:d0c53a8359f7c0fe3aa4ba3f4d8addf279ceedcc:77abccc2213d45a3808b18371444011bb2b4aed1756d365a9ce5a1b895ff68c60d37cd34c9892003420eda2edde607a0d46b514eb1918f9041baabd4e0fd078ada81f819d52a72b77bd0b948270266f6
another_account:password:old@email.com:oldpass:2FA123:auth_token_here:ct0_token_here
```

#### 2. データインポート

インポートスクリプトを使用してデータを追加します。

```bash
npx tsx scripts/import-x-accounts.ts accounts.txt
```

**実行例:**
```
📄 ファイル読み込み完了: 100行

✓ [1] 追加成功: astrosynth18312
✓ [2] 追加成功: another_account
⊘ [3] 既に存在します: existing_account
✗ [4] エラー: invalid_account - UNIQUE constraint failed

==================================================
📊 処理結果サマリ
==================================================
総行数: 100
処理対象: 98件
✓ 追加成功: 95件
⊘ スキップ（既存）: 2件
✗ エラー: 1件
==================================================
```

#### 3. データの確認

SQLiteでデータを確認できます。

```bash
# 基本的な確認
sqlite3 storage/app.db "SELECT container_id, x_password IS NOT NULL as has_password, twofa_code IS NOT NULL as has_2fa, auth_token IS NOT NULL as has_auth, ct0 IS NOT NULL as has_ct0 FROM x_accounts LIMIT 5;"

# 詳細確認
sqlite3 storage/app.db "SELECT container_id, x_username, follower_count, following_count, created_at FROM x_accounts ORDER BY created_at DESC LIMIT 10;"
```

#### 4. プログラムから取得

タスク実行時に認証情報を取得して使用します。

```typescript
import { query } from './src/drivers/db';

// コンテナIDから認証情報を取得
const account = query<{
  container_id: string;
  x_password: string;
  twofa_code: string;
  auth_token: string;
  ct0: string;
}>(
  'SELECT container_id, x_password, twofa_code, auth_token, ct0 FROM x_accounts WHERE container_id = ?',
  [containerId]
);

if (account && account.length > 0) {
  const acc = account[0];
  // プリセットのテンプレート変数に設定
  const overrides = {
    container_name: acc.container_id,
    x_password: acc.x_password,
    twofa_code: acc.twofa_code,
    auth_token: acc.auth_token,
    ct0: acc.ct0,
  };
}
```

### 運用フロー例

1. **初期セットアップ**: ログイン情報リストを準備してインポート
   ```bash
   # データファイルを準備
   echo "XID:Xパスワード:旧メール:旧パス:2FA:Auth:ct0" > accounts.txt
   
   # インポート実行
   npx tsx scripts/import-x-accounts.ts accounts.txt
   ```

2. **メールアドレスの割り当て**: `email_accounts`テーブルから未使用のメールアカウントを取得して設定
   ```typescript
   // email_accountsから未使用のメールアカウントを取得
   const emailAccount = query(
     'SELECT * FROM email_accounts WHERE used_at IS NULL ORDER BY added_at ASC LIMIT 1'
   );
   
   if (emailAccount && emailAccount.length > 0) {
     const [email, password] = emailAccount[0].email_password.split(':');
     
     // x_accountsテーブルを更新
     run(
       'UPDATE x_accounts SET email = ?, email_password = ? WHERE container_id = ?',
       [email, password, containerId]
     );
   }
   ```

3. **タスク実行**: プリセット実行時に認証情報を自動取得
   ```typescript
   // タスク作成時にx_accountsから認証情報を取得
   const xAccount = getXAccountByContainerId(containerId);
   if (xAccount) {
     enqueueTask({
       presetId: 17, // X Authログイン
       containerId: null, // コンテナ作成ステップがあるためnull
       overrides: {
         container_name: xAccount.container_id,
         auth_token: xAccount.auth_token,
         ct0: xAccount.ct0,
         // ... その他のパラメータ
       }
     });
   }
   ```

### 注意事項

- **コンテナIDの一意性**: `container_id`（XID）はUNIQUE制約があるため、同じXIDは重複して登録されません。既存の場合はスキップされます
- **メールアドレスの管理**: メールアドレスは`email_accounts`テーブルから別途引き当てて使用する想定です。インポート時には旧メール情報は保存されません
- **認証情報のセキュリティ**: パスワードやトークンなどの機密情報がデータベースに保存されます。適切なアクセス制御とバックアップ管理を行ってください
- **データ形式の検証**: インポートスクリプトは7つのフィールド（コロン区切り）を期待します。形式が不正な行は警告を表示してスキップされます
- **コメント行**: `#`で始まる行はコメントとして無視されます。データファイルに説明を追加する際に便利です

## パラメータ命名規則と自動取得

プリセット実行時に、特定のパラメータはデータベースから自動取得され、UIでの入力が不要になります。パラメータの命名規則を統一することで、どのパラメータが自動取得されるかを明確にします。

### 命名規則

#### `db_` プレフィックス（DBから自動取得）

`db_`で始まるパラメータは、データベースから自動取得されます。UIのパラメータ入力欄には表示されません。

- **形式**: `db_カラム名`
- **例**: `db_x_password` → `x_accounts.x_password`から取得
- **取得タイミング**: タスク実行時およびデバッグモードで自動的に設定されます
- **優先順位**: `overrides`や`params`で指定されていても無視され、常にDBから取得されます

#### `pr_` プレフィックス（内部変数）

`pr_`で始まるパラメータは、ステップ実行中に生成される内部変数です。UIのパラメータ入力欄には表示されません。

- **形式**: `pr_変数名`
- **例**: `pr_verification_code` → メール取得ステップで生成される確認コード
- **生成タイミング**: 該当するステップ実行時に自動生成されます

### 現在実装されているパラメータ

#### DBから自動取得されるパラメータ

- **`db_x_password`**: `x_accounts.x_password`から取得
  - タスク実行時およびデバッグモードで自動的に設定されます
  - `overrides`や`params`で指定されていても無視され、常にDBから取得されます

- **`db_email`**: `x_accounts.email`から取得
  - タスク実行時およびデバッグモードで自動的に設定されます
  - `overrides`や`params`で指定されていても無視され、常にDBから取得されます

- **`db_email_credential`**: `x_accounts.email`と`x_accounts.email_password`を組み合わせて`email:password`形式で取得
  - タスク実行時およびデバッグモードで自動的に設定されます
  - `overrides`や`params`で指定されていても無視され、常にDBから取得されます
  - メール取得ステップ（`fetch_email`）で使用されます

- **`db_new_email`**: `email_accounts`テーブルから未使用のメールアドレスを取得
  - `used_at IS NULL`のレコードから`email_password`を取得し、`email`部分を抽出します
  - タスク実行時およびデバッグモードで自動的に設定されます
  - `overrides`や`params`で指定されていても無視され、常にDBから取得されます
  - メールアドレス変更などのプリセットで使用されます

#### 内部変数

- **`pr_verification_code`**: メール取得ステップ（`fetch_email`）で生成される確認コード
  - デフォルトの`result_var`として使用されます
  - 後続のステップで`{{pr_verification_code}}`として参照可能です

### 実装詳細

#### タスク実行時（`taskQueue.ts`）

```typescript
// container_idからx_accountsテーブルを参照して各種パラメータを取得
if (task.containerId) {
  const xAccount = dbQuery<any>(
    'SELECT x_password, email, email_password FROM x_accounts WHERE container_id = ? LIMIT 1',
    [String(task.containerId)]
  )[0];
  if (xAccount) {
    // db_x_password: x_accounts.x_passwordから取得
    if (xAccount.x_password) {
      gatheredVars.db_x_password = String(xAccount.x_password);
    }
    
    // db_email: x_accounts.emailから取得
    if (xAccount.email) {
      gatheredVars.db_email = String(xAccount.email);
    }
    
    // db_email_credential: x_accounts.emailとemail_passwordを組み合わせてemail:password形式で取得
    if (xAccount.email && xAccount.email_password) {
      gatheredVars.db_email_credential = `${String(xAccount.email)}:${String(xAccount.email_password)}`;
    }
  }
}

// email_accountsテーブルから未使用のメールアドレスを取得
const emailAccount = dbQuery<any>(
  'SELECT email_password FROM email_accounts WHERE used_at IS NULL ORDER BY added_at ASC LIMIT 1',
  []
)[0];
if (emailAccount && emailAccount.email_password) {
  const email = String(emailAccount.email_password).split(':')[0]?.trim();
  if (email) {
    gatheredVars.db_new_email = email;
  }
}
```

#### デバッグモード（`server.ts`）

```typescript
// デバッグモードでも同様にDBから取得
if (containerId) {
  const xAccount = dbQuery<any>(
    'SELECT x_password, email, email_password FROM x_accounts WHERE container_id = ? LIMIT 1',
    [String(containerId)]
  )[0];
  if (xAccount) {
    // db_x_password: x_accounts.x_passwordから取得
    if (xAccount.x_password) {
      templateVars.db_x_password = String(xAccount.x_password);
    }
    
    // db_email: x_accounts.emailから取得
    if (xAccount.email) {
      templateVars.db_email = String(xAccount.email);
    }
    
    // db_email_credential: x_accounts.emailとemail_passwordを組み合わせてemail:password形式で取得
    if (xAccount.email && xAccount.email_password) {
      templateVars.db_email_credential = `${String(xAccount.email)}:${String(xAccount.email_password)}`;
    }
  }
}

// email_accountsテーブルから未使用のメールアドレスを取得
const emailAccount = dbQuery<any>(
  'SELECT email_password FROM email_accounts WHERE used_at IS NULL ORDER BY added_at ASC LIMIT 1',
  []
)[0];
if (emailAccount && emailAccount.email_password) {
  const email = String(emailAccount.email_password).split(':')[0]?.trim();
  if (email) {
    templateVars.db_new_email = email;
  }
}
```

#### UIでのパラメータ検出（`dashboard.html`）

```javascript
// db_で始まるパラメータ（DBから自動取得）とpr_で始まるパラメータ（内部変数）を除外
return found.filter(name => !name.startsWith('db_') && !name.startsWith('pr_'));
```

### 今後の拡張

今後、DBから自動取得するパラメータを追加する場合は、以下の手順に従ってください：

1. **パラメータ名を`db_カラム名`形式で定義**
   - 例: `db_email` → `x_accounts.email`から取得
2. **`taskQueue.ts`の`runTask`関数**で、`gatheredVars`に追加する処理を実装
3. **`server.ts`の`/api/presets/:id/debug-step`エンドポイント**で、`templateVars`に追加する処理を実装
4. **`dashboard.html`の`inferParamsFromPreset`関数**は、`db_`で始まるパラメータを自動的に除外するため、追加の修正は不要

内部変数を追加する場合は：

1. **パラメータ名を`pr_変数名`形式で定義**
2. **該当するステップで値を生成し、`gatheredVars`に設定**
3. **`dashboard.html`の`inferParamsFromPreset`関数**は、`pr_`で始まるパラメータを自動的に除外するため、追加の修正は不要

### テンプレート変数の正しい参照方法

eval ステップ内からテンプレート変数を参照する際は、以下のパターンを使用してください。

#### ❌ 避けるべき方法

```javascript
// 誤り1: 文字列リテラル内で直接プレースホルダを使用
const code = '{{pr_verification_code}}'.trim();
if (!code || code === '{{pr_verification_code}}') {  // ← サーバー側の置換解析で二重解析
  // エラー: template variables missing
}

// 誤り2: eval コード内で複雑なチェック条件と組み合わせる
const rawCode = '{{pr_verification_code}}';
if (!code || !code.trim() || code === '{{pr_verification_code}}') {  // ← プレースホルダ比較がエラーの原因
  return { didAction: false, reason: 'missing' };
}
```

#### ✅ 推奨される方法

**方法1: ステップの `parameters` オブジェクトを使用（推奨）**

```javascript
// ステップ定義にparametersを追加
{
  "type": "eval",
  "name": "確認コードを入力",
  "parameters": {
    "verification_code": "{{pr_verification_code}}"  // ← ステップレベルでテンプレート変数を定義
  },
  "code": "(async () => { ... })()"
}

// eval コード内で参照
const verificationCode = '{{parameters.verification_code}}';  // ← 二重括弧でパラメータ参照
const code = (verificationCode || '').trim();

if (!code || code.length === 0) {  // ← シンプルなチェックのみ
  return { didAction: false, reason: 'verification code is empty' };
}
```

**方法2: サーバー側で置換されるパラメータの値を前提にする**

```javascript
// テンプレート変数は実行前にサーバーで置換されていることを前提
const verificationCode = '{{db_verification_code}}';  // ← 置換済みの値が入る
const code = verificationCode.trim();

if (!code || code.length === 0) {  // ← 単純な存在確認のみ
  return { didAction: false, reason: 'code not provided' };
}
```

#### トラブルシューティング

**エラー: `template variables missing: pr_verification_code`**

原因と対策：
1. **サーバー側の置換タイミング**: テンプレート変数は `eval` コード送信前にサーバー側で一度置換されます
2. **二重括弧の避け方**: `{{parameters.verification_code}}` のように二重括弧を使う場合、括弧内の内容はエスケープ必須
3. **プレースホルダ比較の禁止**: `code === '{{variable}}'` という比較は、置換後にリテラル文字列となるため避ける
4. **parameters の活用**: 必要な変数は ステップレベルで `parameters` オブジェクトとして定義し、eval 内で参照

**実装例（メール確認コード入力ステップ）:**

```typescript
// ステップ定義
const step = {
  type: "eval",
  name: "確認コードを入力（キー入力方式）",
  parameters: {
    verification_code: '{{pr_verification_code}}'  // pr_from fetch_email ステップ
  },
  code: `(async () => {
    try {
      // 確認コード入力フィールドを検索
      let codeInput = document.querySelector('input[name="verfication_code"]');
      // ... フィールド検索ロジック ...
      
      // ⭐ パラメータから参照（サーバーが自動置換）
      const code = '{{parameters.verification_code}}'.trim();
      
      // ⭐ シンプルなチェック（プレースホルダ比較を避ける）
      if (!code || code.length === 0) {
        return { didAction: false, reason: 'code not provided' };
      }
      
      // 値を入力
      codeInput.value = code;
      codeInput.dispatchEvent(new Event('input', { bubbles: true }));
      return { didAction: true, reason: 'code entered' };
    } catch (e) {
      return { didAction: false, reason: 'error: ' + String(e) };
    }
  })()`
};
```

### 注意事項

- **`db_`パラメータの優先順位**: `overrides`や`params`で指定されていても、常にDBから取得した値が使用されます
- **`container_id`の必須性**: DBから取得するパラメータは、`container_id`が指定されている場合のみ取得されます
- **エラーハンドリング**: DBから取得できない場合は、警告ログが出力されますが、タスク実行は続行されます（パラメータが未設定のままになる可能性があります）
- **命名規則の遵守**: 新しいパラメータを追加する際は、必ず`db_`または`pr_`プレフィックスを使用してください
- **テンプレート変数の参照**: eval ステップ内から `pr_` や `db_` 変数を参照する際は、サーバー側の置換メカニズムを理解した上で、`parameters` オブジェクトを活用する

### `pr_`パラメータ（内部変数）の汎用的な取り扱い

`pr_`で始まるパラメータはステップ実行中に生成される内部変数であり、以下の特性と注意事項があります：

**特性:**
- **自動生成**: 特定のステップ（例：`fetch_email`）で値が自動生成されます
- **ステップ間での連携**: 前のステップで生成された`pr_`変数は、後続のステップから`{{pr_変数名}}`形式で参照可能です
- **UI表示されない**: ダッシュボードのパラメータ入力欄には表示されず、スクリプト側の定義に従って自動的に管理されます
- **デバッグ時の伝播**: デバッグモード（debug-step）でも、同じ伝播ルールが適用されます

**オプションパラメータ（未設定時の対応）:**
- `db_`パラメータと異なり、`pr_`パラメータが未設定の場合、サーバー側の`applyTemplate`関数は**デフォルトでエラーを投げます**
- オプショナルなパラメータ（例：`db_new_email`が未設定の場合）を使用する場合は、eval コード内で以下のパターンで対応してください：
  1. **スキップロジック判定**: eval コード内に、パラメータ未設定時のスキップ条件を含める
     ```javascript
     const value = '{{parameter_name}}'.trim();
     if (!value || value === 'undefined') {
       return { didAction: true, reason: 'parameter not set, skipping...' };
     }
     ```
  2. **サーバー側での`allowEmpty`フラグ**: eval コードにスキップロジック（`"=== 'undefined'"`など）が含まれている場合、サーバー側は自動的に`allowEmpty: true`で`applyTemplate`を呼び出し、未設定パラメータを`"undefined"`文字列に置換します

**実装例（メールアドレス変更チェックステップ）:**

ステップ3（メールアドレス変更状態確認）では、`db_new_email`がオプショナルです：

```javascript
// eval コード内での対応
const newEmail = '{{db_new_email}}'.trim();

// db_new_emailが未設定（"undefined"に置換）の場合、スキップ
if (!newEmail || newEmail === 'undefined') {
  return { 
    didAction: true, 
    reason: 'db_new_email が指定されていないため、変更状態チェックをスキップします' 
  };
}

// db_new_emailが設定されている場合、チェック実施
if (currentEmail === newEmail) {
  return { 
    didAction: false,  // 既に変更済み → プリセット実行を停止
    reason: `メールアドレスは既に ${currentEmail} に変更済みです` 
  };
}

// 変更が必要な状態 → 続行
return { 
  didAction: true, 
  reason: `現在のメール: ${currentEmail}、変更予定: ${newEmail}` 
};
```

**重要な注意:**
- テンプレート変数未設定時の条件分岐は、**eval コード内で実装してください**（サーバー側のテンプレート置換ではなく）
- サーバー側がスキップロジック判定を検出した場合のみ、未設定パラメータを許容します
- プレースホルダ文字列との直接比較（`=== '{{parameter}}'`）は避け、置換後の値（`"undefined"`）との比較を使用してください
