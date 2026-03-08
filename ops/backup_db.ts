/**
 * データベースのバックアップを作成するスクリプト
 * 
 * 使用方法:
 *   npx tsx scripts/backup-database.ts
 * 
 * バックアップファイルは storage/backups/ ディレクトリに保存されます
 * ファイル名は app.db.YYYYMMDD-HHMMSS.backup 形式です
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

const DB_PATH = path.resolve('storage', 'app.db');
const BACKUP_DIR = path.resolve('storage', 'backups');

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

function generateBackupFileName(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  
  return `app.db.${year}${month}${day}-${hours}${minutes}${seconds}.backup`;
}

function main() {
  console.log('📦 データベースのバックアップを作成します...\n');
  
  // データベースファイルの存在確認
  if (!fs.existsSync(DB_PATH)) {
    console.error(`❌ データベースファイルが見つかりません: ${DB_PATH}`);
    process.exit(1);
  }
  
  // バックアップディレクトリの作成
  ensureBackupDir();
  
  // バックアップファイル名の生成
  const backupFileName = generateBackupFileName();
  const backupPath = path.join(BACKUP_DIR, backupFileName);
  
  console.log(`📁 データベース: ${DB_PATH}`);
  console.log(`💾 バックアップ先: ${backupPath}\n`);
  
  try {
    // データベースを開く
    const sourceDb = new Database(DB_PATH);
    
    // WALモードの場合はチェックポイントを実行してメインファイルに統合
    const journalMode = sourceDb.pragma('journal_mode', { simple: true }) as string;
    if (journalMode === 'wal') {
      console.log('   WALモードを検出しました。チェックポイントを実行中...');
      sourceDb.pragma('wal_checkpoint(TRUNCATE)');
    }
    
    sourceDb.close();
    
    // ファイルを直接コピー（より確実な方法）
    console.log('   バックアップを実行中...');
    fs.copyFileSync(DB_PATH, backupPath);
    
    // ファイルサイズを取得
    const stats = fs.statSync(backupPath);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    
    console.log('✅ バックアップが正常に完了しました');
    console.log(`   ファイルサイズ: ${sizeMB} MB`);
    console.log(`   バックアップファイル: ${backupPath}\n`);
  } catch (error: any) {
    // エラー時はバックアップファイルを削除
    if (fs.existsSync(backupPath)) {
      try {
        fs.unlinkSync(backupPath);
      } catch (e) {
        // 無視
      }
    }
    
    console.error('❌ バックアップの作成に失敗しました:');
    console.error(`   ${error.message}`);
    process.exit(1);
  }
}

main();

