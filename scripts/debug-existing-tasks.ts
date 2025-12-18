/**
 * 既存タスクの判定ロジックをデバッグするスクリプト
 */

import { initDb, query } from '../src/drivers/db';

interface Task {
  container_id: string;
  queue_name: string;
  overrides_json: string;
}

function main() {
  initDb({ wal: true });

  // 今回登録した100件のアカウントIDを取得
  const targetAccountIds = new Set<string>();
  const dataLines = [
    'infoborne16185', 'infoborne113558', 'infoborne142981', 'infonimbus60569', 'infranova349288',
    'infratechx78684', 'ioncoder78093', 'ioncoder82762', 'ioncoder85679', 'ioncoder92030',
    'ioncore80375876', 'ioncraft135614', 'ioncraft168748', 'ionforge167180', 'ionframe118659',
    'ionframe120010', 'ionframe125433', 'ionframe172154', 'iongarden143124', 'iongarden167963',
    'iongrove99277', 'ionharvest61954', 'ionicsenti63144', 'ionicsenti68742', 'ionmatrix124260',
    'ionpillar16476', 'ionseed138902', 'ionstream268837', 'iontracer41301', 'iontracer89911',
    'iontrailbl90905', 'kriptodalg68661', 'kuantumorm23123', 'logisphere8622', 'luminacre197937',
    'lunarbiome66670', 'lunarbiome79043', 'lunarbios18207', 'lunarbios97220', 'lunarbios98069',
    'lunarbotan27116', 'lunarcryog80108', 'lunarpilot34511', 'lunarworks45598', 'lunarworks75904',
    'lunarworks92330', 'machforge98358', 'machinova276376', 'machinova279351', 'mechabloom42279',
    'mechabloom73028', 'mechabotan4448', 'mechacoder96226', 'mechadrift7387', 'mechadrift26620',
    'mechadrift42714', 'mechaflora63011', 'mechatrell432', 'mechatrell25614', 'mechawisp12311',
    'mechawisp72236', 'mechbyte125417', 'mechbyte169842', 'mechbyte170018', 'mechbyte183528',
    'mechcomet167409', 'mechcomet186653', 'mechflora114311', 'mechflora132337', 'mechfossil65290',
    'mechfossil79041', 'mechgrove35751', 'mechgrove54575', 'mechgrove69763', 'mechgrove87299',
    'mechmeteor34417', 'mechmoss122715', 'mechnebula37189', 'mechnebula78617', 'mechquasar32958',
    'mechquasar81409', 'mechstarli45246', 'mechstarli50302', 'mechstarli52016', 'metaforge842167',
    'metaloom244887', 'metaloom2415357', 'metaloom2488589', 'metaloom2489160', 'metaspark189095',
    'metaspark197356', 'muhendismi22713', 'nanoastrob74910', 'nanobionex37059', 'nanoblosso8679',
    'nanocanopy11481', 'nanocanopy88346', 'nanocosmos42845', 'nanocurato25982', 'nanocurato67587',
  ];

  for (const id of dataLines) {
    targetAccountIds.add(id);
  }

  // タスク1のタスクを取得
  const tasks = query<Task>(
    "SELECT container_id, queue_name, overrides_json FROM tasks WHERE preset_id = 18 AND (queue_name = 'default' OR queue_name = 'タスク1')",
    []
  );

  console.log(`タスク1のプロフィール変更タスク数: ${tasks.length}件\n`);

  const existingContainerIds = new Set<string>();
  
  for (const task of tasks) {
    if (task.container_id) {
      existingContainerIds.add(task.container_id);
      if (targetAccountIds.has(task.container_id)) {
        console.log(`✓ 対象アカウントのタスクが見つかりました: ${task.container_id}`);
      }
    }
    
    try {
      const overrides = JSON.parse(task.overrides_json || '{}');
      if (overrides.container_id) {
        existingContainerIds.add(String(overrides.container_id));
        if (targetAccountIds.has(String(overrides.container_id))) {
          console.log(`✓ 対象アカウントのタスクが見つかりました（overrides）: ${overrides.container_id}`);
        }
      }
    } catch (e) {
      // JSON解析エラーは無視
    }
  }

  console.log(`\n既存タスクのcontainer_id数: ${existingContainerIds.size}件`);
  console.log(`対象アカウント数: ${targetAccountIds.size}件`);
  console.log(`既存タスクに含まれる対象アカウント数: ${Array.from(targetAccountIds).filter(id => existingContainerIds.has(id)).length}件`);

  // 対象アカウントで既存タスクに含まれていないものを表示
  const notInTasks = Array.from(targetAccountIds).filter(id => !existingContainerIds.has(id));
  console.log(`\n既存タスクに含まれていない対象アカウント数: ${notInTasks.length}件`);
  if (notInTasks.length > 0 && notInTasks.length <= 10) {
    console.log('アカウントID:');
    notInTasks.forEach(id => console.log(`  - ${id}`));
  }
}

try {
  main();
  process.exit(0);
} catch (e) {
  console.error('エラーが発生しました:', e);
  process.exit(1);
}

