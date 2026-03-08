# 運用コマンド（ops）

日々の運用作業（DB登録・ログ調査・定例報告）を固定手順で実行するためのスクリプト群です。

## プロジェクト情報（運用観点）

| 項目 | 内容 |
|------|------|
| **DB** | SQLite（`storage/app.db`、better-sqlite3、WAL） |
| **登録方法** | 既存スクリプト（`scripts/*.ts`）で `enqueueTask` を呼ぶ / または `ops/register_tasks` で JSON 一括登録 |
| **ログの場所** | DB テーブル（`task_runs`, `run_history`）、ファイル（`logs/app-YYYYMMDD.log`）、スクショ（`shots/`） |
| **実行環境** | ローカル（Node.js 20.x、`tsx`、ダッシュボードは `npm run dashboard`） |

## コマンド一覧

| コマンド | 説明 |
|----------|------|
| `npm run ops:register -- --dry-run [JSON]` | タスク登録の事前確認（件数・例のみ。DB に書き込まない） |
| `npm run ops:register -- --execute [JSON]` | タスクを DB に登録し、登録後に件数・runId を照合 |
| `npm run ops:audit -- [--from DATE] [--to DATE] [--top N]` | 期間内のログ要約・エラー TopN・件数 |
| `npm run ops:report -- [--date DATE] [--output PATH]` | 定例報告用 Markdown 雛形を生成 |

## 安全策

- **本番DB 誤登録防止**: 登録は必ず `--dry-run` で確認してから `--execute`。`--execute` 実行時は **環境変数 `CONFIRM_EXECUTE=1` 必須**（未設定ならスクリプトは終了する）。
- **シークレット**: ログ・レポートには `overrides` の値や API キーを出さない（キー名のみ or 省略）。
- **成功条件**: 「登録した」で終わりにせず、登録後の件数・runId 照合までを成功条件とする。

## 既存スクリプトとの関係

- タスク登録: 既存の `scripts/create-*-.ts` はそのまま利用可能。一括登録の入力が JSON で揃う場合は `ops/register_tasks` を使用。
- ログ調査: 従来の手動クエリやダッシュボードの代わりに `ops/audit_logs` で期間・エラー集計。
- 定例報告: `ops/daily_report` の出力を Markdown / Discord 用に編集して利用。
