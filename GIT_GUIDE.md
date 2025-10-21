# Git運用ガイド（追記版）

## 方針
- トランクベース + 短命ブランチ（1タスク1PR）
- main は常に動作可能
- PR は小さく・速く。CI の代わりに Husky フックで最低限チェック

## 初期化
git init
git branch -M main
echo "node_modules/
dist/
.env
storage/snapshots/
*.log
" > .gitignore
git add .
git commit -m "chore: bootstrap project (v0.4)"
git remote add origin <YOUR_REPO_URL>
git push -u origin main

## ブランチ運用
- 命名: feat/xxx, fix/xxx, chore/xxx
- 例: feat/posting-two-stage, fix/healing-modal-scope

## コミットフロー（Husky）
- pre-commit: **lint-staged**（ESLint+Prettier 自動修正）
- pre-push: `npm run typecheck && npm run build && npm test`
- 失敗したら修正して再実行

## スクリプト一覧
- `npm run dev`：開発実行（ts-node）
- `npm run build`：ビルド（tsc）
- `npm run typecheck`：型チェックのみ
- `npm run lint` / `lint:fix`：Lint（修正）
- `npm run format` / `format:check`：Prettier
- `npm run bench`：並列ベンチ（scripts/bench.ts）

## PRルール（軽量）
- タイトル: `[feat|fix] scope: 要約`
- 本文: 目的 / 変更点 / 受入れ条件 / 実行手順 / スクショ
- 自己レビューのチェックリストを通す

## リリース
- `git tag v0.4.0` → `git push --tags`
- CHANGELOG は任意（大きめの機能境界で追記）
