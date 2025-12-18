#!/usr/bin/env tsx
/**
 * Google Driveフォルダ内の画像ファイルの直接リンクURLリストを生成
 * 
 * 使用方法:
 * 1. ファイルIDのリストをJSONファイルで提供: tsx scripts/get-drive-file-urls.ts file-ids.json
 * 2. または、コード内の FILE_IDS を編集して実行
 * 
 * ファイルIDの取得方法:
 * - 各ファイルをクリックして、URLからファイルIDを取得
 * - 例: https://drive.google.com/file/d/1dbcJxxIHx86RyLMwZNN0DGi3sy-BGHG6/view?usp=drive_link
 * - ファイルID: 1dbcJxxIHx86RyLMwZNN0DGi3sy-BGHG6
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface FileInfo {
  name: string;
  id: string;
}

interface FileIdMap {
  [fileName: string]: string;
}

/**
 * ファイルIDから直接リンクURLを生成
 */
function generateDriveUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view?usp=drive_link`;
}

/**
 * ファイル名とファイルIDのマッピングからURLリストを生成
 */
function generateUrlList(fileIdMap: FileIdMap): string[] {
  const urls: string[] = [];
  
  // ファイル名でソートして順序を保持
  const sortedFiles = Object.entries(fileIdMap).sort(([a], [b]) => {
    // 数値でソート（icon (3).jpg, icon (35).jpg など）
    const numA = parseInt(a.match(/\((\d+)\)/)?.[1] || '0');
    const numB = parseInt(b.match(/\((\d+)\)/)?.[1] || '0');
    return numA - numB;
  });

  for (const [fileName, fileId] of sortedFiles) {
    if (fileId) {
      urls.push(generateDriveUrl(fileId));
    }
  }

  return urls;
}

/**
 * メイン処理
 */
async function main() {
  const inputFile = process.argv[2];
  
  // ファイル名リスト（フォルダ内の全画像ファイル）
  const fileNames = [
    'icon (3).jpg',
    'icon (35).jpg',
    'icon (112).jpg',
    'icon (260).jpg',
    'icon (261).jpg',
    'icon (320).jpg',
    'icon (566).jpg',
    'icon (567).jpg',
    'icon (569).jpg',
    'icon (572).jpg',
    'icon (584).jpg',
    'icon (596).jpg',
    'icon (597).jpg',
    'icon (598).jpg',
    'icon (601).jpg',
    'icon (604).jpg',
    'icon (615).jpg',
    'icon (616).jpg',
    'icon (622).jpg',
    'icon (629).jpg',
    'icon (631).jpg',
    'icon (632).jpg',
    'icon (635).jpg',
    'icon (640).jpg',
    'icon (647).jpg',
    'icon (649).jpg',
    'icon (651).jpg',
    'icon (655).jpg',
    'icon (657).jpg',
    'icon (659).jpg',
    'icon (662).jpg',
    'icon (669).jpg',
    'icon (675).jpg',
    'icon (676).jpg',
    'icon (682).jpg',
    'icon (686).jpg',
    'icon (687).jpg',
    'icon (689).jpg',
    'icon (694).jpg',
    'icon (695).jpg',
    'icon (705).jpg',
    'icon (716).jpg',
    'icon (726).jpg',
    'icon (731).jpg',
    'icon (732).jpg',
    'icon (736).jpg',
    'icon (740).jpg',
    'icon (744).jpg',
    'icon (745).jpg',
    'icon (747).jpg',
  ];

  let fileIdMap: FileIdMap = {};

  // 入力ファイルが指定されている場合、それを読み込む
  if (inputFile) {
    try {
      const filePath = resolve(process.cwd(), inputFile);
      const fileContent = readFileSync(filePath, 'utf-8');
      fileIdMap = JSON.parse(fileContent);
      console.log(`ファイルIDマッピングを読み込みました: ${inputFile}\n`);
    } catch (error) {
      console.error(`ファイルの読み込みに失敗しました: ${inputFile}`);
      console.error('エラー:', error);
      process.exit(1);
    }
  } else {
    // 入力ファイルが指定されていない場合、テンプレートを表示
    console.log('Google Driveフォルダ内の画像ファイルリスト\n');
    console.log(`ファイル数: ${fileNames.length}\n`);
    
    console.log('使用方法:');
    console.log('1. 以下のファイル名とファイルIDのマッピングをJSONファイルに保存');
    console.log('2. tsx scripts/get-drive-file-urls.ts <JSONファイル> で実行\n');
    
    console.log('JSONファイル形式の例:');
    console.log('{');
    console.log('  "icon (3).jpg": "ファイルIDをここに",');
    console.log('  "icon (35).jpg": "ファイルIDをここに",');
    console.log('  ...');
    console.log('}\n');
    
    // テンプレートJSONを生成
    const template: FileIdMap = {};
    fileNames.forEach(name => {
      template[name] = '';
    });
    
    const templatePath = resolve(process.cwd(), 'drive-file-ids-template.json');
    writeFileSync(templatePath, JSON.stringify(template, null, 2), 'utf-8');
    console.log(`テンプレートファイルを生成しました: ${templatePath}`);
    console.log('各ファイルをクリックしてファイルIDを取得し、このファイルに記入してください。\n');
    
    // ファイル名リストを表示
    console.log('ファイル名リスト:');
    fileNames.forEach((name, index) => {
      console.log(`${index + 1}. ${name}`);
    });
    
    process.exit(0);
  }

  // ファイルIDマッピングが不完全な場合をチェック
  const missingIds = fileNames.filter(name => !fileIdMap[name] || fileIdMap[name].trim() === '');
  if (missingIds.length > 0) {
    console.warn(`警告: ${missingIds.length}個のファイルのIDが未設定です:`);
    missingIds.forEach(name => console.warn(`  - ${name}`));
    console.log('');
  }

  // URLリストを生成
  const urls = generateUrlList(fileIdMap);
  
  console.log('生成された直接リンクURLリスト:');
  console.log('='.repeat(80));
  urls.forEach((url, index) => {
    console.log(url);
  });
  console.log('='.repeat(80));
  console.log(`\n合計: ${urls.length}個のURL\n`);

  // 出力ファイルに保存
  const outputPath = resolve(process.cwd(), 'drive-file-urls.txt');
  writeFileSync(outputPath, urls.join('\n') + '\n', 'utf-8');
  console.log(`URLリストをファイルに保存しました: ${outputPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('エラーが発生しました:', error);
    process.exit(1);
  });
}
