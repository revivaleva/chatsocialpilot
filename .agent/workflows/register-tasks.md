---
description: タスクの一括登録（dry-run確認から本実行まで）
---

1. 登録対象のタスクが記述された JSON ファイルの内容を確認する。
2. **dry-run を実行**:
   ```powershell
   npm run ops:register -- --dry-run <JSONパス>
   ```
3. 出力された「登録予定件数」と「内容のサンプル」が正しいか、ユーザーに提示し確認を得る。
// turbo
4. **本実行**:
   ユーザーの承諾後、環境変数を付与して実行する。
   ```powershell
   $env:CONFIRM_EXECUTE="1"; npm run ops:register -- --execute <JSONパス>
   ```
5. 最終的な登録件数と runId の照合結果（exit 0 であること）を報告する。
