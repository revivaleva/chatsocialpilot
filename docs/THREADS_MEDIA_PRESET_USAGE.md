# Threads メディア保存プリセット — 使用方法

## 📋 概要

Threads 投稿 URL から画像・動画を自動ダウンロードし、ローカルに保存して `post_library` テーブルに記録するプリセットです。

---

## 🚀 セットアップ

### 1. プリセット登録

**方法A: ダッシュボードから登録**

1. ダッシュボード（`http://localhost:5174`）を開く
2. 「プリセット」タブを選択
3. 「新規作成」ボタンをクリック
4. `presets/threads-download-media.json` の内容をコピー＆ペースト
5. 「保存」をクリック

**方法B: API から登録**

```bash
curl -X POST http://localhost:5174/api/presets \
  -H "Content-Type: application/json" \
  -d @presets/threads-download-media.json
```

---

## 📝 使用方法

### 1. タスク作成

**ダッシュボードから:**

1. 「タスク」タブを選択
2. 「新規タスク」ボタンをクリック
3. プリセット選択: **「Threads投稿メディア保存」**
4. コンテナ選択: Threads にログイン済みのコンテナを選択
5. パラメータ入力:
   ```
   post_url: https://www.threads.com/@nanogarden77203/post/123456789
   ```
6. 「登録」をクリック

### 2. タスク実行

- タスクは自動的にキューに追加され、順次実行されます
- 実行状況は「タスク実行ログ」で確認できます

---

## 📊 実行結果

### 保存先

**ローカルファイル:**
```
./storage/media/threads/{account_id}_{post_id}/
  ├─ media_0.jpg
  ├─ media_1.jpg
  └─ media_2.mp4
```

**データベース（post_library テーブル）:**

| カラム | 値の例 |
|--------|--------|
| `content` | `https://www.threads.com/@nanogarden77203/post/123456789` |
| `media_paths` | `./storage/media/threads/nanogarden77203_123456789/media_0.jpg,./storage/media/threads/nanogarden77203_123456789/media_1.jpg,./storage/media/threads/nanogarden77203_123456789/media_2.mp4` |
| `source_url` | `https://www.threads.com/@nanogarden77203/post/123456789` |
| `account_id` | `nanogarden77203` |
| `post_id_threads` | `123456789` |
| `download_status` | `success` |
| `downloaded_at` | `1702580000000` |
| `media_count` | `3` |

---

## ⚙️ プリセットの動作フロー

```
1. [navigate] Threads投稿ページを開く
   ↓
2. [for ループ] メディア抽出・保存を実行
   ├─ [eval] URL から account_id と post_id を抽出
   │   → pr_post_info: { account_id, post_id, post_url }
   │
   ├─ [save_media] メディア保存（コンテナブラウザ側で実行）
   │   → pr_media_result: { ok, files[], summary: { total, succeeded, failed, paths_comma_separated } }
   │
   ├─ [eval] メディア保存結果確認
   │   → pr_media_check
   │
   └─ [eval] DB保存トリガー
       → pr_save_result
       → サーバー側で post_library に INSERT
```

---

## 🔍 エラーハンドリング

### メディア保存失敗時の動作

**要件**: 1つでもメディアのダウンロードに失敗した場合、**投稿全体をスキップ**します。

**動作:**
- `pr_media_result.summary.failed > 0` の場合
- DB に保存されない（`pr_save_result.saved = 0, skipped = 1`）
- ログに警告が記録される

**ログ例:**
```json
{
  "event": "task.for.save_media.failed_skip",
  "succeeded": 2,
  "failed": 1,
  "total": 3,
  "reason": "Media save failed: 1 of 3 files failed"
}
```

---

## 📋 パラメータ

| パラメータ名 | 型 | 必須 | 説明 | 例 |
|------------|-----|------|------|-----|
| `post_url` | string | ✅ | Threads 投稿の URL | `https://www.threads.com/@account/post/123456789` |

---

## 🧪 テスト手順

### 1. 手動テスト

```bash
# 1. ダッシュボード起動
npm run dashboard

# 2. ブラウザで http://localhost:5174 を開く

# 3. プリセット登録
# → 「プリセット」タブ → 「新規作成」
# → threads-download-media.json の内容をコピー＆ペースト

# 4. タスク作成
# → 「タスク」タブ → 「新規タスク」
# → プリセット: 「Threads投稿メディア保存」
# → post_url: "https://www.threads.com/@account/post/123456789"

# 5. 実行結果確認
# → 「タスク実行ログ」で実行状況を確認
# → SQLite で post_library テーブルを確認
```

### 2. SQLite で結果確認

```bash
# データベース接続
sqlite3 storage/app.db

# post_library テーブルを確認
SELECT 
  id,
  content,
  account_id,
  post_id_threads,
  media_count,
  download_status,
  media_paths
FROM post_library
WHERE source_url LIKE '%threads.com%'
ORDER BY created_at DESC
LIMIT 10;

# メディアファイルの存在確認
SELECT 
  id,
  account_id,
  post_id_threads,
  media_paths
FROM post_library
WHERE download_status = 'success'
  AND media_count > 0;
```

---

## 🐛 トラブルシューティング

### 問題1: メディアが保存されない

**確認事項:**
- コンテナブラウザが起動しているか
- コンテナが Threads にログイン済みか
- 投稿 URL が正しいか（`https://www.threads.com/@account/post/id` 形式）

**ログ確認:**
```bash
# 最新のログを確認
tail -f logs/*.json | grep "save_media"
```

### 問題2: DB に保存されない

**確認事項:**
- `pr_media_result.summary.failed > 0` の場合、投稿全体がスキップされます
- ログで `task.for.save_media.failed_skip` を確認

**ログ確認:**
```bash
# DB保存関連のログを確認
tail -f logs/*.json | grep "save_media.db"
```

### 問題3: タイムアウトエラー

**対処法:**
- プリセットの `save_media` ステップの `timeoutMs` を増やす（デフォルト: 60000ms）
- 大容量動画の場合は 120000ms（2分）以上に設定

---

## 📌 注意事項

1. **フォルダ名の形式**
   - `{account_id}_{post_id}` 形式で自動生成されます
   - 例: `nanogarden77203_123456789`

2. **ファイル命名規則**
   - `media_0.jpg`, `media_1.jpg`, `media_2.mp4` など、インデックス順に保存されます

3. **重複チェック**
   - 同じ `source_url` で複数回実行した場合、重複レコードが作成される可能性があります
   - 必要に応じて、事前に `post_library` テーブルで重複チェックを実装してください

4. **ディスク容量**
   - 大容量動画の場合は、十分なディスク容量を確保してください

---

## 🔗 関連ドキュメント

- [実装報告書](./THREADS_MEDIA_IMPLEMENTATION.md)
- [Container Browser 仕様書](./SAVE_MEDIA_COMMAND_SPEC.md)

---

**最終更新日**: 2025-12-15


