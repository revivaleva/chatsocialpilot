#!/usr/bin/env tsx
/**
 * グループの複数コンテナにプロフィール情報、プロフィール画像、ヘッダ画像を設定するタスクを一括登録
 * 
 * 使用方法:
 *   tsx scripts/create-profile-tasks-batch.ts <グループ名>
 */

import { initDb, query, run } from '../src/drivers/db.js';
import { enqueueTask } from '../src/services/taskQueue.js';

interface ProfileIcon {
  id: number;
  file_id: string;
  url: string;
}

interface HeaderIcon {
  id: number;
  file_id: string;
  url: string;
}

interface ProfileInfo {
  name: string;
  bio: string;
}

/**
 * 未使用のプロフィール画像をランダムに取得（使用済みマーク付き）
 */
function getRandomProfileIcon(): ProfileIcon | null {
  const icons = query<ProfileIcon>(
    'SELECT id, file_id, url FROM profile_icons WHERE used = 0 ORDER BY RANDOM() LIMIT 1'
  );

  if (icons.length === 0) {
    return null;
  }

  const icon = icons[0];
  const now = Date.now();
  run('UPDATE profile_icons SET used = 1, used_at = ? WHERE id = ?', [now, icon.id]);

  return icon;
}

/**
 * 未使用のヘッダ画像をランダムに取得（使用済みマーク付き）
 */
function getRandomHeaderIcon(): HeaderIcon | null {
  const icons = query<HeaderIcon>(
    'SELECT id, file_id, url FROM header_icons WHERE used = 0 ORDER BY RANDOM() LIMIT 1'
  );

  if (icons.length === 0) {
    return null;
  }

  const icon = icons[0];
  const now = Date.now();
  run('UPDATE header_icons SET used = 1, used_at = ? WHERE id = ?', [now, icon.id]);

  return icon;
}

/**
 * グループ名からグループIDを取得（同名グループが複数ある場合はコンテナ数が多い方を優先）
 */
function getGroupIdByName(groupName: string): string | null {
  const groups = query<{ id: string; name: string }>(
    'SELECT id, name FROM container_groups WHERE name = ?',
    [groupName]
  );

  if (groups.length === 0) {
    return null;
  }

  if (groups.length === 1) {
    return groups[0].id;
  }

  let bestGroup = groups[0];
  let maxContainerCount = 0;

  for (const group of groups) {
    const containerCount = query<{ count: number }>(
      'SELECT COUNT(*) as count FROM container_group_members WHERE group_id = ?',
      [group.id]
    )[0]?.count || 0;

    if (containerCount > maxContainerCount) {
      maxContainerCount = containerCount;
      bestGroup = group;
    }
  }

  return bestGroup.id;
}

/**
 * グループに属するコンテナID一覧を取得
 */
function getContainerIdsByGroupId(groupId: string): string[] {
  const members = query<{ container_id: string }>(
    'SELECT container_id FROM container_group_members WHERE group_id = ?',
    [groupId]
  );

  return members.map(m => m.container_id);
}

/**
 * メイン処理
 */
async function main(): Promise<void> {
  const groupName = process.argv[2];

  if (!groupName) {
    console.error('使い方: tsx scripts/create-profile-tasks-batch.ts <グループ名>');
    process.exit(1);
  }

  // プロフィール情報リスト（1件目は既に使用済みのため、2件目以降を使用）
  const profileInfos: ProfileInfo[] = [
    { name: "さやか@ワーママ美容", bio: "産後くたくたでもキレイでいたいワーママの美容メモ。5分でできるベースメイク、時短スキンケア、寝る前のセルフマッサージなど現実的なケアだけ集めてます。" },
    { name: "Reina_beauty40", bio: "アラフォー混合肌のゆる美容垢。毛穴・くすみ・たるみ対策を中心に、実際に使ってよかったスキンケア＆ベースメイクだけ記録していきます。" },
    { name: "在宅女子のすっぴん育成", bio: "在宅ワーク民のすっぴん育成計画。肌に優しいスキンケア、石けんオフメイク、ブルーライト対策など、おうち時間でもできる美容をコツコツ実践中。" },
    { name: "miho / ダイエットと美容", bio: "30代から本気出したダイエット＆美容ログ。食事管理、筋トレ、ボディケア、むくみ対策など、無理しない範囲で続けられたことだけ残していきます。" },
    { name: "ゆり🌿敏感肌ケア", bio: "敏感肌×乾燥肌のスキンケア難民が落ち着くまでの記録。低刺激コスメ中心に、荒れなかった・調子が良かったアイテムだけを忘れないようメモしてます。" },
    { name: "nanase - ナチュラルメイク", bio: "ナチュラルメイクが好きな大人女子。ベージュ・ブラウン中心のやりすぎないメイクと、ツヤと血色感をちょっと足すだけのシンプル美容を発信中。" },
    { name: "千尋｜40代の清潔感美容", bio: "40代からの清潔感重視美容。ヘアケア、ベースメイク、眉メイクなど、派手じゃないけどきちんと見えるコツを同世代の方向けにシェアしてます。" },
    { name: "ズボラ美容代表ゆか", bio: "とにかく面倒くさがりなズボラ女子の美容垢。ワンステップスキンケア、オールインワン、時短メイクなど、サボりがちでも続いたものだけ紹介してます。" },
    { name: "cosme収納ノート📦", bio: "コスメ収納オタクの備忘録。持っているアイテムの使い切りチャレンジ、断捨離レポ、使いやすい収納アイデアなどをまとめて無駄買い防止を目指してます。" },
    { name: "kana｜ブルベ夏OL", bio: "ブルベ夏っぽいと言われがちなOLのコスメ記録。青みピンク、ローズ系チーク、くすみ飛ばし下地など似合ったと感じたものだけ厳選して残してます。" },
    { name: "Mai🦵むくみケア記録", bio: "むくみやすい脚と顔がコンプレックスなアラサーのケア日記。着圧、マッサージ、ストレッチ、入浴でどこまで変われるか実験しながら記録してます。" },
    { name: "あつこ@アラフィフ手前", bio: "アラフィフ手前のリアルスキンケア日誌。乾燥・くすみ・目元の小じわ対策など、無理なく続けられることだけをゆっくり積み重ねています。" },
    { name: "haru｜アトピー肌とメイク", bio: "アトピー気味の肌でもメイクを楽しみたい人。成分ゆるめのベースメイク、肌負担少なめのポイントメイク、落とし方の工夫などを中心に書いてます。" },
    { name: "miki_haircare", bio: "ヘアケア沼にはまったOL。ドラストシャンプーからサロン専売品まで、髪質改善を目標にシャンプー・トリートメント・オイルを試して本音レビュー中。" },
    { name: "りな＊ゆる美容26", bio: "20代後半のゆる美容垢。毛穴・ニキビ跡・色素沈着が気になる肌を少しでもなめらかにしたくて、スキンケアと生活習慣を見直していく過程を記録します。" },
    { name: "nozomi｜忙しい30代の小ワザ", bio: "毎日忙しいけど老け込みたくない30代。仕事の合間にもできるハンドケア、リップケア、簡単メイク直しなどちょい足しで印象を上げる小ワザを共有中。" },
    { name: "drugstore_コスメ研究部", bio: "コスパ重視のドラッグストア美容専門アカウント。プチプラスキンケア、ベースメイク、ポイントメイクを中心に、値段以上に良かったものだけ推します。" },
    { name: "homecare_美活ログ", bio: "美容医療までは踏み切れないけど、できる範囲で整えたい人。ホームケア、マッサージ、美容家電など、自宅でできるケアを試して正直にレポしてます。" },
  ];

  // DB初期化
  initDb();

  // グループIDを取得
  const groupId = getGroupIdByName(groupName);
  if (!groupId) {
    console.error(`エラー: グループ "${groupName}" が見つかりませんでした`);
    process.exit(1);
  }

  console.log(`グループ: ${groupName} (ID: ${groupId})\n`);

  // コンテナID一覧を取得
  const containerIds = getContainerIdsByGroupId(groupId);
  if (containerIds.length === 0) {
    console.error(`エラー: グループ "${groupName}" にコンテナがありません`);
    process.exit(1);
  }

  // 1件目は既に使用済みのため、2件目以降を使用（インデックス1から開始）
  const remainingContainers = containerIds.slice(1);
  const tasksToCreate = Math.min(remainingContainers.length, profileInfos.length);

  if (tasksToCreate === 0) {
    console.error('エラー: 残りのコンテナがありません');
    process.exit(1);
  }

  if (profileInfos.length < tasksToCreate) {
    console.error(`エラー: プロフィール情報が不足しています（必要: ${tasksToCreate}件、提供: ${profileInfos.length}件）`);
    process.exit(1);
  }

  console.log(`グループ内のコンテナ数: ${containerIds.length}件`);
  console.log(`残りのコンテナ数: ${remainingContainers.length}件`);
  console.log(`登録するタスク数: ${tasksToCreate}件\n`);

  // タスク登録
  const runIds: string[] = [];
  for (let i = 0; i < tasksToCreate; i++) {
    const containerId = remainingContainers[i];
    const profileInfo = profileInfos[i];

    // プロフィール画像とヘッダ画像を取得
    const profileIcon = getRandomProfileIcon();
    const headerIcon = getRandomHeaderIcon();

    if (!profileIcon) {
      console.error(`エラー: 未使用のプロフィール画像が見つかりませんでした（${i + 1}/${tasksToCreate}件目）`);
      break;
    }

    if (!headerIcon) {
      console.error(`エラー: 未使用のヘッダ画像が見つかりませんでした（${i + 1}/${tasksToCreate}件目）`);
      break;
    }

    console.log(`タスク ${i + 1}/${tasksToCreate}:`);
    console.log(`  コンテナID: ${containerId}`);
    console.log(`  アカウント名: ${profileInfo.name}`);
    console.log(`  プロフ文: ${profileInfo.bio.substring(0, 50)}...`);
    console.log(`  プロフィール画像: ${profileIcon.url}`);
    console.log(`  ヘッダ画像: ${headerIcon.url}`);

    // タスクを登録（プリセット18: プロフィール変更）
    const runId = enqueueTask({
      presetId: 18,
      containerId: containerId,
      overrides: {
        name: profileInfo.name,
        bio: profileInfo.bio,
        location: '',
        website: '',
        avatar_image_path: profileIcon.url,
        banner_image_path: headerIcon.url,
      },
      waitMinutes: 10,
    });

    runIds.push(runId);
    console.log(`  ✓ タスク登録完了 (Run ID: ${runId})\n`);
  }

  console.log('='.repeat(80));
  console.log('登録完了');
  console.log('='.repeat(80));
  console.log(`登録したタスク数: ${runIds.length}件\n`);

  console.log('Run ID一覧:');
  runIds.forEach((runId, i) => {
    console.log(`  ${i + 1}. ${runId}`);
  });

  console.log('\n統計情報:');
  
  // プロフィール画像統計
  const profileStats = query(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN used = 0 THEN 1 ELSE 0 END) as unused,
      SUM(CASE WHEN used = 1 THEN 1 ELSE 0 END) as used
    FROM profile_icons
  `)[0] as any;
  console.log(`プロフィール画像: 合計${profileStats.total}件（未使用${profileStats.unused}件、使用済み${profileStats.used}件）`);

  // ヘッダ画像統計
  const headerStats = query(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN used = 0 THEN 1 ELSE 0 END) as unused,
      SUM(CASE WHEN used = 1 THEN 1 ELSE 0 END) as used
    FROM header_icons
  `)[0] as any;
  console.log(`ヘッダ画像: 合計${headerStats.total}件（未使用${headerStats.unused}件、使用済み${headerStats.used}件）`);
}

main().catch((err) => {
  console.error('エラーが発生しました:', err);
  process.exit(1);
});
















