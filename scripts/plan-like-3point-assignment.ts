import { initDb, query } from '../src/drivers/db';

/**
 * いいね3点セットの割り当て計画を立てるスクリプト
 * 
 * 要件:
 * - 4グループ × 2セット = 8セット必要
 * - 各グループで未実施のセットから選択
 * - グループごとに異なるセットを割り当て
 */

type GroupRow = {
  id: string;
  name: string;
};

type PresetRow = {
  id: number;
  name: string;
};

// 直近3日の開始時刻（ミリ秒）
function getThreeDaysAgoTimestamp(): number {
  const now = Date.now();
  const threeDaysAgo = now - (3 * 24 * 60 * 60 * 1000);
  return threeDaysAgo;
}

// いいね3点セットかどうかを判定
function isLike3PointSet(preset: PresetRow): boolean {
  return preset.name.includes('いいね3点セット#');
}

// セットの種類を識別
function getSetType(preset: PresetRow): string {
  const name = preset.name;
  const match = name.match(/#(.+)$/);
  return match ? match[1] : name;
}

async function main() {
  initDb({ wal: true });
  
  console.log('=== いいね3点セット割り当て計画 ===\n');
  
  // 1. 対象グループを取得
  const targetGroupPatterns = [
    'X兵隊12/5',
    'X兵隊12/6',
    'X兵隊12/7',
    'X兵隊12/8'
  ];
  
  const targetGroups: GroupRow[] = [];
  for (const pattern of targetGroupPatterns) {
    const groups = query<GroupRow>(
      'SELECT id, name FROM container_groups WHERE name LIKE ?',
      [`%${pattern}%`]
    );
    targetGroups.push(...groups);
  }
  
  if (targetGroups.length === 0) {
    console.log('対象グループが見つかりませんでした。');
    return;
  }
  
  // 2. いいね3点セットのpresetを取得
  const allPresets = query<PresetRow>(
    'SELECT id, name FROM presets ORDER BY id'
  );
  
  const like3PointPresets = allPresets.filter(isLike3PointSet);
  
  // 3. 各グループの未実施セットを取得
  const threeDaysAgo = getThreeDaysAgoTimestamp();
  
  type GroupStatus = {
    group: GroupRow;
    executedSetTypes: Set<string>;
    notExecutedSetTypes: string[];
    presetMap: Map<string, number>; // セット名 -> preset ID
  };
  
  const groupStatuses: GroupStatus[] = [];
  
  // preset名からpreset IDのマップを作成
  const presetMap = new Map<string, number>();
  for (const preset of like3PointPresets) {
    const setType = getSetType(preset);
    presetMap.set(setType, preset.id);
  }
  
  for (const group of targetGroups) {
    // グループ単位でタスクを取得
    const tasks = query<{ preset_id: number }>(
      `SELECT t.preset_id
       FROM tasks t
       LEFT JOIN presets p ON t.preset_id = p.id
       WHERE t.group_id = ? AND t.created_at >= ? AND p.name LIKE '%いいね3点セット#%'`,
      [group.id, threeDaysAgo]
    );
    
    const executedSetTypes = new Set<string>();
    for (const task of tasks) {
      const preset = like3PointPresets.find(p => p.id === task.preset_id);
      if (preset) {
        executedSetTypes.add(getSetType(preset));
      }
    }
    
    // 未実施セットを取得
    const allSetTypes = like3PointPresets.map(p => getSetType(p));
    const notExecutedSetTypes = allSetTypes.filter(s => !executedSetTypes.has(s));
    
    groupStatuses.push({
      group,
      executedSetTypes,
      notExecutedSetTypes,
      presetMap
    });
  }
  
  // 4. 割り当て計画を立てる
  console.log('【各グループの未実施セット】\n');
  for (const status of groupStatuses) {
    console.log(`${status.group.name}:`);
    console.log(`  未実施: ${status.notExecutedSetTypes.join(', ')}`);
    console.log('');
  }
  
  // 5. 最適な組み合わせを計算
  // 各グループに異なる2セットずつを割り当てる
  // 可能な限り均等に分散させる
  
  console.log('【割り当て計画】\n');
  
  // 全セットのリスト
  const allSetTypes = like3PointPresets.map(p => getSetType(p));
  
  // 各セットがどのグループで未実施かを記録
  const setToGroups = new Map<string, string[]>();
  for (const setType of allSetTypes) {
    const availableGroups: string[] = [];
    for (const status of groupStatuses) {
      if (status.notExecutedSetTypes.includes(setType)) {
        availableGroups.push(status.group.name);
      }
    }
    setToGroups.set(setType, availableGroups);
  }
  
  // 貪欲法で割り当て: 利用可能なグループが少ないセットから優先的に割り当て
  const assignments: Array<{ groupName: string; sets: string[] }> = [];
  const usedSets = new Set<string>();
  const groupAssignments = new Map<string, string[]>();
  
  // 各グループの割り当てを初期化
  for (const status of groupStatuses) {
    groupAssignments.set(status.group.name, []);
  }
  
  // セットを利用可能なグループ数でソート（少ないものから）
  const sortedSets = Array.from(setToGroups.entries()).sort((a, b) => a[1].length - b[1].length);
  
  // 各セットを割り当て可能なグループに割り当て
  for (const [setType, availableGroups] of sortedSets) {
    if (usedSets.has(setType)) continue;
    
    // 利用可能なグループのうち、まだ2セット未満のグループを探す
    for (const groupName of availableGroups) {
      const currentAssignments = groupAssignments.get(groupName) || [];
      if (currentAssignments.length < 2) {
        currentAssignments.push(setType);
        groupAssignments.set(groupName, currentAssignments);
        usedSets.add(setType);
        break;
      }
    }
  }
  
  // 結果を表示
  for (const status of groupStatuses) {
    const assigned = groupAssignments.get(status.group.name) || [];
    console.log(`${status.group.name}:`);
    if (assigned.length === 2) {
      console.log(`  ✅ ${assigned[0]} (preset ID: ${presetMap.get(assigned[0])})`);
      console.log(`  ✅ ${assigned[1]} (preset ID: ${presetMap.get(assigned[1])})`);
    } else if (assigned.length === 1) {
      console.log(`  ⚠️  ${assigned[0]} (preset ID: ${presetMap.get(assigned[0])})`);
      console.log(`  ⚠️  もう1セット必要（未実施セットから選択）`);
    } else {
      console.log(`  ❌ 割り当て不可（未実施セットが不足）`);
    }
    console.log('');
  }
  
  // 6. 割り当ての重複チェック
  console.log('【重複チェック】\n');
  const setUsage = new Map<string, number>();
  for (const [groupName, sets] of groupAssignments.entries()) {
    for (const setType of sets) {
      setUsage.set(setType, (setUsage.get(setType) || 0) + 1);
    }
  }
  
  let hasDuplicate = false;
  for (const [setType, count] of setUsage.entries()) {
    if (count > 1) {
      console.log(`  ⚠️  ${setType}: ${count}グループで使用`);
      hasDuplicate = true;
    }
  }
  
  if (!hasDuplicate) {
    console.log('  ✅ 重複なし（各セットは1グループのみで使用）');
  }
  
  // 7. 未使用セットの確認
  console.log('\n【未使用セット】\n');
  const unusedSets = allSetTypes.filter(s => !usedSets.has(s));
  if (unusedSets.length > 0) {
    console.log(`  未使用: ${unusedSets.join(', ')}`);
  } else {
    console.log('  すべてのセットが使用されています');
  }
}

main().catch((e) => {
  console.error('エラーが発生しました:', e);
  process.exit(1);
});

