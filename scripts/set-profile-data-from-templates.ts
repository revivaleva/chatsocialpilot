/**
 * profile_templatesテーブルからデータを取得してprofile_dataテーブルにセットするスクリプト
 */

import { initDb, query, run } from '../src/drivers/db';

interface ProfileTemplate {
  id: number;
  account_name: string;
  profile_text: string;
  used_at: number | null;
}

interface ProfileData {
  container_id: string;
  name: string;
  bio: string;
}

/**
 * 今回登録した100件のアカウントIDのリストを取得
 */
function getTargetAccountIds(): Set<string> {
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

  return new Set(dataLines);
}

/**
 * 未使用のプロフィールテンプレートをランダムに取得し、使用済みにマーク
 */
function getRandomUnusedTemplate(): ProfileTemplate | null {
  const templates = query<ProfileTemplate>(
    'SELECT id, account_name, profile_text, used_at FROM profile_templates WHERE used_at IS NULL ORDER BY RANDOM() LIMIT 1',
    []
  );
  
  if (templates && templates.length > 0) {
    const template = templates[0];
    // 使用済みにマーク
    run('UPDATE profile_templates SET used_at = ? WHERE id = ?', [Date.now(), template.id]);
    return template;
  }
  
  return null;
}

function main() {
  initDb({ wal: true });

  console.log('🔧 profile_templatesからprofile_dataにデータをセット中...\n');

  const targetAccountIds = getTargetAccountIds();
  console.log(`対象アカウント数: ${targetAccountIds.size}件\n`);

  // profile_dataテーブルから対象アカウントのデータを取得
  const profileDataList = query<ProfileData>(
    'SELECT container_id, name, bio FROM profile_data WHERE container_id IN (' +
    Array.from(targetAccountIds).map(() => '?').join(',') +
    ')',
    Array.from(targetAccountIds)
  );

  console.log(`profile_dataに存在するアカウント数: ${profileDataList.length}件\n`);

  if (profileDataList.length === 0) {
    console.log('❌ profile_dataにデータが見つかりませんでした');
    return;
  }

  let successCount = 0;
  let errorCount = 0;
  let skippedCount = 0;

  console.log('📝 プロフィール情報を更新中...\n');

  for (let i = 0; i < profileDataList.length; i++) {
    const profileData = profileDataList[i];
    
    // 既にnameとbioが設定されている場合はスキップ（空文字列は更新対象）
    if (profileData.name && profileData.name.trim() !== '' && profileData.bio && profileData.bio.trim() !== '') {
      skippedCount++;
      if ((i + 1) % 10 === 0) {
        console.log(`  [${i + 1}/${profileDataList.length}] 処理中...`);
      }
      continue;
    }

    // 未使用のテンプレートを取得
    const template = getRandomUnusedTemplate();
    
    if (!template) {
      console.warn(`  ⚠ 未使用のテンプレートがありません: ${profileData.container_id}`);
      errorCount++;
      continue;
    }

    try {
      const now = Date.now();
      run(
        'UPDATE profile_data SET name = ?, bio = ?, updated_at = ? WHERE container_id = ?',
        [template.account_name, template.profile_text, now, profileData.container_id]
      );
      successCount++;
      
      if ((i + 1) % 10 === 0 || (i + 1) === profileDataList.length) {
        console.log(`  [${i + 1}/${profileDataList.length}] 処理中...`);
      }
    } catch (e: any) {
      errorCount++;
      console.error(`  ✗ エラー: ${profileData.container_id} - ${e?.message || String(e)}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 処理結果サマリ');
  console.log('='.repeat(60));
  console.log(`対象アカウント数: ${profileDataList.length}件`);
  console.log(`✓ 更新成功: ${successCount}件`);
  console.log(`⊘ スキップ（既に設定済み）: ${skippedCount}件`);
  console.log(`✗ エラー: ${errorCount}件`);
  console.log('='.repeat(60));

  // 更新後の確認
  try {
    const updatedCount = query<{ count: number }>(
      'SELECT COUNT(*) as count FROM profile_data WHERE container_id IN (' +
      Array.from(targetAccountIds).map(() => '?').join(',') +
      ') AND name IS NOT NULL AND name != "" AND bio IS NOT NULL AND bio != ""',
      Array.from(targetAccountIds)
    );
    console.log(`\nnameとbioが設定されているアカウント数: ${updatedCount[0]?.count || 0}件`);
  } catch (e) {
    // エラーは無視（テーブル構造の問題の可能性）
    console.log('\n更新後の確認をスキップしました');
  }

  if (errorCount > 0) {
    process.exit(1);
  }
}

try {
  main();
  process.exit(0);
} catch (e) {
  console.error('エラーが発生しました:', e);
  process.exit(1);
}

