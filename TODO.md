# 自動SNS運用ツール - TODO（v0.4計画・追記版）

## 運用ルール
- 1タスク = 1日以内で終わる粒度。必ず「受入れ条件」を書く。
- 進捗記号: 対応中🔧 / レビュー待ち👀 / 完了✅
- 変更は Git ブランチで。PRは小さく速く。コミット時は Husky が自動チェック。
- 保存前に `npm run lint:fix` / `npm run format` を推奨。

---

## フェーズ0：環境構築
- [ ] Node.js / Git / Playwright インストール（`node -v`, `npx playwright --version`）
- [ ] プロジェクト雛形作成（`npm run build` 成功）
- [ ] `.env` 設定（OpenAI 呼び出し成功）
- [ ] SQLite/WAL 初期化（`storage/app.db` 作成、WAL 設定）
- [ ] **Husky 有効化**（`git commit` 時に lint-staged が動作）

## フェーズ1：基盤ドライバ
- [ ] `drivers/db.ts`（DDLスナップ/禁止DDL/Busyリトライ）
- [ ] `drivers/browser.ts`（Persistent Context）
- [ ] `drivers/openai.ts`（モデル切替/JSON固定）
- [ ] `drivers/queue.ts`（メモリ実装）
- [ ] **スクリプト整備**（`build/typecheck/lint/bench` が通る）

## フェーズ2：サービス最小パス
- [ ] `services/posting.ts`：通常投稿（スクショ+DB記録）
- [ ] `services/healing.ts`：自己修復（候補JSON→検証→selectors更新）
- [ ] `ui/cli.ts`：設定変更/ジョブ登録（policy/runtime の patch 反映）

## フェーズ3：二段階投稿（最優先）
- [ ] 遅延実行（reply/quote）/ テンプレ+要約生成

## フェーズ4：並列とベンチ
- [ ] `runtime.maxConcurrentBrowsers` で並列制御（4→6→8）
- [ ] ベンチ（CPU/失敗率/SQLITE_BUSY を CSV 出力）

## フェーズ5：監視・検索
- [ ] 特定ユーザー監視→差分保存→連鎖
- [ ] キーワード検索→候補化（重複排除）

## フェーズ6：仕上げ
- [ ] 日次サマリ / 停止＆通知 / README 更新

---

## バグ/改善バックログ
- [ ] healing 候補が modal 内を誤検出する
- [ ] ベンチ中にCPU70%超で停止条件が発火しない
