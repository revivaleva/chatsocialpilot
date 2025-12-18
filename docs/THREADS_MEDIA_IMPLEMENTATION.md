# Threads メディア保存プリセット — 実装完了報告書

## ✅ 実装完了内容

### 1. DB マイグレーション（m0023）

**ファイル**: `src/drivers/db.ts`

`post_library` テーブルに新規カラムを追加：

```sql
ALTER TABLE post_library ADD COLUMN media_paths TEXT;              -- メディアパスのカンマ区切り
ALTER TABLE post_library ADD COLUMN source_url TEXT;               -- Threads投稿のURL
ALTER TABLE post_library ADD COLUMN account_id TEXT;               -- アカウントID（@の後ろ）
ALTER TABLE post_library ADD COLUMN post_id_threads TEXT;          -- Threads投稿ID
ALTER TABLE post_library ADD COLUMN download_status TEXT DEFAULT 'pending';  -- ダウンロード状態
ALTER TABLE post_library ADD COLUMN downloaded_at INTEGER;         -- ダウンロード完了日時
ALTER TABLE post_library ADD COLUMN media_count INTEGER DEFAULT 0; -- ダウンロード数

-- インデックス
CREATE INDEX idx_post_library_source_url ON post_library(source_url);
CREATE INDEX idx_post_library_status ON post_library(download_status);
```

---

### 2. Task Queue ステップ処理追加

**ファイル**: `src/services/taskQueue.ts`

#### 2.1 `save_media` ステップ対応（行1219-1226）

for ループ内のステップ実行ロジックに `save_media` ステップの処理を追加：

```typescript
if (innerStep.type === 'save_media') {
  // save_media ステップの処理
  innerCmdPayload.destination_folder = applyTemplate(
    innerStep.destination_folder || './storage/media/threads',
    gatheredVars
  );
  innerCmdPayload.folder_name = applyTemplate(
    innerStep.folder_name || '',
    gatheredVars
  );
  innerCmdPayload.selectors = innerStep.selectors || [];
}
```

#### 2.2 DB 保存ロジック追加（行1293-1368）

`pr_save_result` トリガーで、Threads メディア保存（`pr_media_result`）と既存の投稿検索保存（`pr_search_results`）を区別して処理：

```typescript
// ケース1: Threads メディア保存（pr_media_result がある場合）
const mediaResult = gatheredVars.pr_media_result;
if (mediaResult && mediaResult.ok && mediaResult.summary && mediaResult.summary.succeeded > 0) {
  const postInfo = gatheredVars.pr_post_info;
  if (postInfo && postInfo.post_url) {
    // post_library に INSERT
    dbRun(
      'INSERT INTO post_library(content, used, media_paths, source_url, account_id, post_id_threads, download_status, downloaded_at, media_count, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      [
        postInfo.post_url,
        0,
        mediaResult.summary.paths_comma_separated,
        postInfo.post_url,
        postInfo.account_id || null,
        postInfo.post_id || null,
        'success',
        Date.now(),
        mediaResult.summary.succeeded,
        Date.now(),
        Date.now()
      ]
    );
  }
}
```

---

### 3. 新プリセット JSON

**ファイル**: `presets/threads-download-media.json`

Threads 投稿 URL からメディア（画像・動画）を自動ダウンロード・保存するプリセット。

**ステップ構成**:

1. **navigate** → 投稿ページ開く
2. **for ループ** → メディア抽出・保存を実行
   - **eval** → URL から account_id, post_id 抽出（`pr_post_info`）
   - **save_media** → メディア保存（`pr_media_result`）
   - **eval** → 保存結果確認（失敗時は投稿全体スキップ）
   - **eval** → DB 保存トリガー（`pr_save_result`）

---

## 📋 使用方法

### 1. プリセット登録

ダッシュボードまたは API で「`threads-download-media.json`」を新規プリセットとして登録：

```json
{
  "name": "Threads投稿メディア保存",
  "description": "Threads投稿URLからメディア（画像・動画）をダウンロードしてローカルに保存"
  // ... steps...
}
```

### 2. タスク作成

パラメータ指定：

```
post_url: https://www.threads.com/@nanogarden77203/post/123456789
```

### 3. 実行結果

**post_library テーブルに保存されるデータ例**:

```
id: 1
content: "https://www.threads.com/@nanogarden77203/post/123456789"
used: 0
media_paths: "./storage/media/threads/nanogarden77203_123456789/media_0.jpg,./storage/media/threads/nanogarden77203_123456789/media_1.jpg,./storage/media/threads/nanogarden77203_123456789/media_2.mp4"
source_url: "https://www.threads.com/@nanogarden77203/post/123456789"
account_id: "nanogarden77203"
post_id_threads: "123456789"
download_status: "success"
downloaded_at: 1702580000000
media_count: 3
created_at: 1702580000000
updated_at: 1702580000000
```

---

## 🔧 次のステップ（Container Browser 実装）

以下をコンテナブラウザ側に実装が必要：

### 1. `/internal/exec` に `save_media` コマンド追加

**リクエスト**:

```json
{
  "contextId": "container-id",
  "command": "save_media",
  "options": {
    "destination_folder": "./storage/media/threads",
    "folder_name": "nanogarden77203_123456789",
    "selectors": [
      { "selector": "article img[src*='http']", "type": "image" },
      { "selector": "article video", "type": "video" }
    ],
    "timeoutMs": 60000
  }
}
```

**レスポンス（成功）**:

```json
{
  "ok": true,
  "folder_path": "./storage/media/threads/nanogarden77203_123456789",
  "files": [
    {
      "index": 0,
      "type": "image",
      "filename": "media_0.jpg",
      "local_path": "./storage/media/threads/nanogarden77203_123456789/media_0.jpg",
      "file_size": 245632,
      "media_type": "image/jpeg",
      "success": true
    }
  ],
  "summary": {
    "total": 3,
    "succeeded": 3,
    "failed": 0,
    "paths_comma_separated": "./storage/media/threads/nanogarden77203_123456789/media_0.jpg,./storage/media/threads/nanogarden77203_123456789/media_1.jpg,./storage/media/threads/nanogarden77203_123456789/media_2.mp4"
  }
}
```

---

## 📝 修正パス

```
修正ファイル:
1. src/drivers/db.ts                    ✅ マイグレーション m0023 追加
2. src/services/taskQueue.ts            ✅ save_media ステップ処理 + DB保存ロジック追加
3. presets/threads-download-media.json  ✅ 新プリセット作成

未実装（Container Browser 側）:
4. container-browser: /internal/exec に save_media コマンド実装 ⏳
```

---

## 🧪 ローカルテスト手順

1. **マイグレーション実行**：

```bash
npm run build
npm run dev  # または npm run dashboard
```

2. **ダッシュボードからプリセット登録**：
   - 「プリセット」 → 「新規作成」
   - `presets/threads-download-media.json` の内容をコピー＆ペースト

3. **タスク作成**：
   - プリセット選択：「Threads投稿メディア保存」
   - パラメータ入力：`post_url` に Threads 投稿 URL を入力
   - 実行

4. **結果確認**：
   - `logs/` ディレクトリでタスク実行ログを確認
   - SQLite で `post_library` テーブルを確認

---

## 📌 重要な設計決定

| 項目 | 決定内容 | 理由 |
|------|---------|------|
| **DB スキーマ** | `post_media` 不使用、`post_library` 拡張 | シンプル化 + 既存機能との分離 |
| **メディア管理** | post_library に 1 行 + media_paths 勾配区切り | JOIN 不要で管理容易 |
| **フォルダ構造** | `{account_id}_{post_id}/` | URL から直接生成可能 |
| **ファイル命名** | `media_0.jpg`, `media_1.mp4`, ... | シンプルでスケーラブル |
| **エラー処理** | 1 ファイル失敗 → 投稿全体スキップ | 一貫性保証 |

---

## ✨ 次回実装予定

- [ ] Container Browser 側での `save_media` コマンド実装
- [ ] エラーハンドリング・リトライ機構
- [ ] 大容量メディア（動画）のタイムアウト最適化
- [ ] ダッシュボード UI で保存メディア表示機能

---

**実装完了日**: 2025-12-15


