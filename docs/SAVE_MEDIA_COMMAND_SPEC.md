# Container Browser — save_media コマンド実装仕様書

## 概要

Threads 投稿ページから画像・動画を抽出し、ブラウザ内で要素の src/url を取得後、Node.js 側でダウンロード・保存するコマンド。

---

## 1. エンドポイント

```
POST /internal/exec
```

既存の `/internal/exec` エンドポイントに `command: "save_media"` を追加。

---

## 2. リクエスト仕様

### 2.1 リクエストボディ

```json
{
  "contextId": "container-uuid-or-name",
  "command": "save_media",
  "options": {
    "destination_folder": "./storage/media/threads",
    "folder_name": "nanogarden77203_123456789",
    "selectors": [
      {
        "selector": "article img[src*='http']",
        "type": "image"
      },
      {
        "selector": "article video",
        "type": "video"
      },
      {
        "selector": "article video source[src*='http']",
        "type": "video"
      }
    ],
    "timeoutMs": 60000
  }
}
```

### 2.2 パラメータ説明

| パラメータ | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| `contextId` | string | ✅ | コンテナ ID または コンテナ名 |
| `command` | string | ✅ | `"save_media"` 固定 |
| `options.destination_folder` | string | ✅ | 保存先の親ディレクトリ（例: `./storage/media/threads`） |
| `options.folder_name` | string | ✅ | 作成するフォルダ名（例: `nanogarden77203_123456789`） |
| `options.selectors` | array | ✅ | 要素抽出ルール（以下参照） |
| `options.selectors[].selector` | string | ✅ | CSS セレクタ（`document.querySelectorAll()` で使用） |
| `options.selectors[].type` | string | ✅ | メディアタイプ（`"image"` または `"video"`） |
| `options.timeoutMs` | number | - | 全体タイムアウト（デフォルト: 60000 ms） |

---

## 3. 処理フロー

### 3.1 全体フロー

```
1. リクエスト検証
   ├─ contextId 存在確認
   ├─ destination_folder 有効性確認
   └─ folder_name 有効性確認

2. ブラウザ側処理（BrowserView 内の JS 実行）
   ├─ selectors ごとに要素を抽出
   ├─ 要素から URL を取得（src, poster, data 属性など）
   ├─ URL リストを構築
   └─ Node.js 側へ返却

3. Node.js 側処理
   ├─ ディレクトリ作成（親 + フォルダ名）
   ├─ URL ごとにファイルをダウンロード
   ├─ Content-Type からメディアタイプを判定
   ├─ ファイル名付与（media_0.jpg, media_1.mp4 など）
   ├─ ローカルに保存
   └─ 結果を集約

4. レスポンス返却
```

---

## 4. ブラウザ側処理（JavaScript）

### 4.1 要素抽出ロジック

```javascript
/**
 * BrowserView 内で実行される JS
 * selectors に基づいて要素から URL を抽出
 */
(async function() {
  const selectors = [
    { selector: "article img[src*='http']", type: "image" },
    { selector: "article video", type: "video" },
    { selector: "article video source[src*='http']", type: "video" }
  ];
  
  const mediaUrls = [];
  
  for (const selectorRule of selectors) {
    const elements = document.querySelectorAll(selectorRule.selector);
    
    for (const el of elements) {
      let url = null;
      
      // <img> タグから src を取得
      if (el.tagName === 'IMG' && el.src) {
        url = el.src;
      }
      // <video> タグから poster または src を取得
      else if (el.tagName === 'VIDEO') {
        if (el.poster) {
          url = el.poster;
        }
        // または <source src> から取得
        const source = el.querySelector('source[src]');
        if (source && source.src) {
          url = source.src;
        }
      }
      // <source> タグから src を取得
      else if (el.tagName === 'SOURCE' && el.src) {
        url = el.src;
      }
      
      // URL が有効な場合のみ追加
      if (url && url.startsWith('http')) {
        mediaUrls.push({
          url: url,
          type: selectorRule.type,
          selector: selectorRule.selector
        });
      }
    }
  }
  
  return {
    didAction: mediaUrls.length > 0,
    urls: mediaUrls,
    count: mediaUrls.length
  };
})();
```

---

## 5. Node.js 側処理

### 5.1 ダウンロード＆保存ロジック

```typescript
/**
 * メディアファイルをダウンロード・保存
 * 
 * @param urls - { url, type, selector }[] ブラウザ側から取得した URL リスト
 * @param destFolder - 保存先親ディレクトリ
 * @param folderName - 作成するフォルダ名
 * @param timeoutMs - タイムアウト
 * @returns ダウンロード結果
 */
async function downloadAndSaveMedia(
  urls: Array<{ url: string; type: string; selector: string }>,
  destFolder: string,
  folderName: string,
  timeoutMs: number = 60000
): Promise<{
  ok: boolean;
  folder_path: string;
  files: Array<{
    index: number;
    type: string;
    filename: string;
    local_path: string;
    file_size?: number;
    media_type?: string;
    success: boolean;
    error_message?: string;
  }>;
  summary: {
    total: number;
    succeeded: number;
    failed: number;
    paths_comma_separated: string;
  };
}> {
  // 1. ディレクトリ作成
  const fullPath = path.resolve(destFolder, folderName);
  try {
    fs.mkdirSync(fullPath, { recursive: true });
  } catch (err: any) {
    return {
      ok: false,
      folder_path: fullPath,
      files: [],
      summary: { total: 0, succeeded: 0, failed: 0, paths_comma_separated: '' }
    };
  }

  // 2. ファイルダウンロード
  const files = [];
  const successPaths = [];
  let succeeded = 0;
  let failed = 0;

  for (let index = 0; index < urls.length; index++) {
    const item = urls[index];
    const filename = await downloadFile(item.url, fullPath, index, item.type, timeoutMs);
    
    if (filename.success) {
      const fullFilePath = path.join(fullPath, filename.filename);
      const fileSize = getFileSize(fullFilePath);
      const mediaType = getMediaType(fullFilePath);
      
      files.push({
        index,
        type: item.type,
        filename: filename.filename,
        local_path: fullFilePath,
        file_size: fileSize,
        media_type: mediaType,
        success: true
      });
      
      successPaths.push(fullFilePath);
      succeeded++;
    } else {
      files.push({
        index,
        type: item.type,
        filename: `media_${index}`,
        local_path: null,
        success: false,
        error_message: filename.error
      });
      failed++;
    }
  }

  return {
    ok: failed === 0,
    folder_path: fullPath,
    files,
    summary: {
      total: urls.length,
      succeeded,
      failed,
      paths_comma_separated: successPaths.join(',')
    }
  };
}

/**
 * 単一ファイルをダウンロード
 */
async function downloadFile(
  url: string,
  destFolder: string,
  index: number,
  type: string,
  timeoutMs: number
): Promise<{ success: boolean; filename: string; error?: string }> {
  try {
    const ext = getFileExtension(url, type);
    const filename = `media_${index}.${ext}`;
    const filepath = path.join(destFolder, filename);
    
    // HTTP/HTTPS でダウンロード
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    
    if (!response.ok) {
      return { success: false, filename, error: `HTTP ${response.status}` };
    }
    
    // ファイルに書き込み
    const buffer = await response.arrayBuffer();
    fs.writeFileSync(filepath, Buffer.from(buffer));
    
    return { success: true, filename };
  } catch (err: any) {
    return {
      success: false,
      filename: `media_${index}`,
      error: err.message
    };
  }
}

/**
 * URL からファイル拡張子を取得
 */
function getFileExtension(url: string, type: string): string {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const ext = pathname.split('.').pop()?.toLowerCase();
    
    if (ext && /^[a-z0-9]{2,4}$/.test(ext)) {
      return ext;
    }
  } catch {}
  
  // フォールバック
  return type === 'video' ? 'mp4' : 'jpg';
}

/**
 * ファイルの MIME タイプを取得
 */
function getMediaType(filepath: string): string {
  const ext = path.extname(filepath).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime'
  };
  return mimeMap[ext] || 'application/octet-stream';
}

/**
 * ファイルサイズを取得
 */
function getFileSize(filepath: string): number {
  try {
    return fs.statSync(filepath).size;
  } catch {
    return 0;
  }
}
```

---

## 6. レスポンス仕様

### 6.1 成功レスポンス（全ファイル DL 成功）

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
    },
    {
      "index": 1,
      "type": "image",
      "filename": "media_1.jpg",
      "local_path": "./storage/media/threads/nanogarden77203_123456789/media_1.jpg",
      "file_size": 182456,
      "media_type": "image/jpeg",
      "success": true
    },
    {
      "index": 2,
      "type": "video",
      "filename": "media_2.mp4",
      "local_path": "./storage/media/threads/nanogarden77203_123456789/media_2.mp4",
      "file_size": 8456234,
      "media_type": "video/mp4",
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

### 6.2 部分失敗レスポンス

```json
{
  "ok": false,
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
    },
    {
      "index": 1,
      "type": "video",
      "filename": "media_1.mp4",
      "local_path": null,
      "success": false,
      "error_message": "Connection timeout after 60000ms"
    }
  ],
  "summary": {
    "total": 2,
    "succeeded": 1,
    "failed": 1,
    "paths_comma_separated": "./storage/media/threads/nanogarden77203_123456789/media_0.jpg"
  }
}
```

### 6.3 エラーレスポンス（ディレクトリ作成失敗など）

```json
{
  "ok": false,
  "errorDetail": {
    "message": "Failed to create directory",
    "code": "EACCES"
  }
}
```

---

## 7. エラーハンドリング

| エラー条件 | HTTP ステータス | レスポンス |
|-----------|-----------------|-----------|
| `contextId` が見つからない | 404 | `{ ok: false, error: "Context not found" }` |
| `destination_folder` が無効 | 400 | `{ ok: false, error: "Invalid destination folder" }` |
| `folder_name` が無効 | 400 | `{ ok: false, error: "Invalid folder name" }` |
| ディレクトリ作成失敗 | 500 | `{ ok: false, error: "Failed to create directory" }` |
| ブラウザ JS 実行失敗 | 500 | `{ ok: false, error: "Failed to extract media URLs" }` |
| タイムアウト | 504 | `{ ok: false, error: "Operation timeout" }` |
| その他の例外 | 500 | `{ ok: false, error: "Internal server error" }` |

---

## 8. ロギング＆デバッグ

### 8.1 ログレベル

```typescript
logger.event('container.save_media.start', {
  contextId,
  folderName,
  selectorCount: selectors.length,
  timeoutMs
}, 'info');

logger.event('container.save_media.urls_extracted', {
  contextId,
  urlCount: urls.length
}, 'debug');

logger.event('container.save_media.download_complete', {
  contextId,
  succeeded,
  failed,
  totalBytes,
  elapsedMs
}, 'info');

logger.event('container.save_media.error', {
  contextId,
  error: err.message
}, 'error');
```

---

## 9. 制約・注意事項

### 9.1 ファイル制限

| 項目 | 制限値 | 備考 |
|------|--------|------|
| 最大ファイルサイズ | 500 MB | 単一ファイル |
| 最大ファイル数 | 100 | per リクエスト |
| タイムアウト | 60 秒（デフォルト） | configurable |
| ディスク容量 | 制限なし | ホストの容量に依存 |

### 9.2 URL 検証

- HTTPS/HTTP のみ対応
- リダイレクト対応（最大 5 回）
- 相対 URL は実施しない（エラー）

### 9.3 排他制御

- 同一 `contextId` への並列 `save_media` コマンドは排他
- 409 (Conflict) を返す

### 9.4 一時領域

- 作成されたフォルダは永続保存
- エラー時も部分的に作成されたファイルは残存

---

## 10. テスト用 curl コマンド

### 10.1 基本形

```bash
curl -X POST http://127.0.0.1:3001/internal/exec \
  -H "Content-Type: application/json" \
  -d '{
    "contextId": "nanogarden77203",
    "command": "save_media",
    "options": {
      "destination_folder": "./storage/media/threads",
      "folder_name": "nanogarden77203_123456789",
      "selectors": [
        {"selector": "article img[src*=\"http\"]", "type": "image"},
        {"selector": "article video source[src*=\"http\"]", "type": "video"}
      ],
      "timeoutMs": 60000
    }
  }'
```

### 10.2 最小形

```bash
curl -X POST http://127.0.0.1:3001/internal/exec \
  -H "Content-Type: application/json" \
  -d '{
    "contextId": "container-id",
    "command": "save_media",
    "options": {
      "destination_folder": "./storage/media/threads",
      "folder_name": "test_folder",
      "selectors": [{"selector": "img", "type": "image"}]
    }
  }'
```

---

## 11. 実装チェックリスト

- [ ] `/internal/exec` に `command === "save_media"` の分岐を追加
- [ ] ブラウザ側 JS で selector ベースの要素抽出
- [ ] URL リストの構築
- [ ] Node.js 側ディレクトリ作成
- [ ] HTTP fetch によるダウンロード
- [ ] ファイル拡張子の自動判定
- [ ] メディアタイプの判定
- [ ] 結果の集約＆レスポンス
- [ ] エラーハンドリング（部分失敗対応）
- [ ] ロギング
- [ ] 排他制御（409 返却）
- [ ] タイムアウト対応

---

## 12. 依頼内容

上記仕様に基づいて、Container Browser 側に以下を実装してください：

1. **`/internal/exec` エンドポイント拡張**
   - `command === "save_media"` の処理を追加

2. **ブラウザ側処理**
   - selector ベースで要素から URL を抽出
   - URL リストを返却

3. **Node.js 側処理**
   - ディレクトリ作成
   - HTTP fetch でダウンロード
   - ファイル保存
   - 結果集約

4. **レスポンス返却**
   - 上記 6.1-6.3 に従った形式

5. **エラー＆ロギング**
   - 7-8 に従った処理

---

**実装完了後、ブラウザ側で npm run dev 等で動作確認の上、RPA タスク側でテストをお願いします。**


