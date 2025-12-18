import { initDb, query, run as dbRun } from '../src/drivers/db.js';
import { enqueueTask } from '../src/services/taskQueue.js';
import * as PresetService from '../src/services/presets.js';

const keywords = [
  'コスメ',
  '美容',
  'リップ',
  'アイメイク',
  'スキンケア',
  'くすみ',
  '肌悩み',
  '肌トラブル',
  '保湿',
  'ファンデ',
  'パウダー',
  'メイクブラシ',
  'コンシーラー',
  '化粧水',
  '美容液',
  '乳液',
  'ピーリング',
  '角質',
  'スリーピングパック',
  'フェイスパック',
  '泡パック',
  'クレンジング',
  'レチノール',
  'アイクリーム',
  'しわ',
  '乳化',
  '乾燥',
  '洗顔',
  '石鹸',
  'ビタミンC',
  'メイク落とし',
  '酵素',
  '高濃度',
  'むくみ',
  'ヘアパック',
  'トリートメント',
  'ヘアケア',
  'ウォンジョンヨ',
  'フェイシャルパック',
  'アイブロウ',
  'チーク',
  'ハンドクリーム',
  'リップクリーム',
  'マスカラ',
  'ヘアオイル',
  '香水',
  '老け見え',
  'ナイトマスク',
  'うる艶',
  'アンチエイジング',
  'リードル',
  'セラミド',
  'ナイアシンアミド',
  '小じわ',
  'アゼライン酸',
  'ニキビ',
  '毛穴',
  'プチプラ',
  'デパコス',
  'ドラコス',
  'ノーファンデ',
  'トラネキサム酸',
  'ハイドロキノン',
  'サリチル酸',
  'アスタキサンチン',
  'グリシルグリシン',
  '脂性肌',
  '乾燥肌',
  'インナードライ',
  '混合肌',
  'イエベ',
  'ブルベ',
  'テカリ',
  'シミ',
  'オールインワン',
  '皮脂',
  'AHA',
  '肝斑',
  '日焼け止め',
  'ベスコス',
  '保湿クリーム',
  'スクラブ',
  '頭皮ケア',
  '高保湿',
  'ローション',
  '乾燥ジワ',
  '肌タイプ',
  '黒ずみ',
  'ボディクリーム',
  'ボディークリーム',
  '美白',
  'Tゾーン',
  '青クマ',
  '茶クマ',
  '黒クマ',
  '紫外線',
  'プラセンタ',
  '資生堂',
  'まつ毛',
  'ターンオーバー',
  'デコルテ',
  '導入美容液',
  'セザンヌ',
  'キャンメイク',
  'コントゥア',
  'アイシャドウ',
  'パケ買い',
  'ミニリップ',
  '下地',
  'シェーディング',
  'フェイスライン',
  'クレド',
  'fwee',
  'アルコールフリー',
  'メガ割',
  'Qoo10',
  '粘膜リップ',
  'ロムアンド',
  'anua',
  'ミルクタッチ',
  'コスメデコルテ',
  'メディキューブ',
  'CICA',
  '美顔器',
  'トナパ',
  'シートマスク',
  'トナーパッド',
  '拭き取り化粧水',
  '敏感肌',
  'PDRN',
  '角栓',
  'プライマー',
  'プランパー',
  'ハイライト',
  '涙袋',
  'ツヤ肌',
  'マット肌',
  '艶肌',
  'ティント',
  'パーソナルカラー',
  '小顔',
  'ナチュラルメイク',
  '多幸感',
  'ほんのり発色',
  '美容法',
  'カラコン',
  'アイライン',
  '美肌',
  '色ムラ',
  '血色',
  '透明感',
  '垢抜け',
  'エレガンス',
  '2aN',
  '限定品',
  'コフレ',
  'ミニコスメ',
  'コンビニコスメ',
  '無印良品',
  'キュレル',
  '乾燥さん',
  '眉マスカラ',
  '血色感',
  '皮脂汚れ',
  '毛穴落ち',
  'クッションファンデ',
  'リキッドファンデ',
  'パウダーファンデ',
  '色味'
];

const PRESET_ID = 28; // Threads検索・投稿取得プリセット
const CONTAINER_ID = 'loureiroalbuquerqueqd556';
const QUEUE_NAME = 'queue2';
const REPEAT_COUNT = 10;
const BATCH_SIZE = 10;
const MAX_POSTS = 50; // 50件ずつ取得

initDb({ wal: true });

// プリセットの存在確認
const preset = PresetService.getPreset(PRESET_ID);
if (!preset) {
  console.error(`プリセット ${PRESET_ID} が見つかりません`);
  process.exit(1);
}

console.log(`プリセット: ${preset.name}`);
console.log(`キーワード数: ${keywords.length}`);
console.log(`コンテナ: ${CONTAINER_ID}`);
console.log(`キュー: ${QUEUE_NAME}`);
console.log(`繰り返し回数: ${REPEAT_COUNT}`);
console.log(`バッチサイズ: ${BATCH_SIZE}`);
console.log(`最大投稿数: ${MAX_POSTS}`);
console.log('');

let successCount = 0;
let errorCount = 0;
const errors: Array<{ keyword: string; error: string }> = [];

for (const keyword of keywords) {
  try {
    const overrides = {
      keyword,
      repeat_count: String(REPEAT_COUNT),
      batch_size: String(BATCH_SIZE),
      max_posts: String(MAX_POSTS)
    };

    const runId = enqueueTask(
      {
        presetId: PRESET_ID,
        containerId: CONTAINER_ID,
        overrides,
        scheduledAt: undefined
      },
      QUEUE_NAME
    );

    console.log(`✓ ${keyword}: ${runId}`);
    successCount++;
  } catch (e: any) {
    const errorMsg = String(e?.message || e);
    console.error(`✗ ${keyword}: ${errorMsg}`);
    errors.push({ keyword, error: errorMsg });
    errorCount++;
  }
}

console.log('');
console.log('=== 登録結果 ===');
console.log(`成功: ${successCount}件`);
console.log(`失敗: ${errorCount}件`);

if (errors.length > 0) {
  console.log('');
  console.log('=== エラー詳細 ===');
  errors.forEach(({ keyword, error }) => {
    console.log(`  ${keyword}: ${error}`);
  });
}

process.exit(errorCount > 0 ? 1 : 0);












