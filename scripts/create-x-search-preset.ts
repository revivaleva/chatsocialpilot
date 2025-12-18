#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

async function main() {
  const scenarioPath = path.join(__dirname, '../data/rpa-scenarios/X検索いいねリプライフォロー.json');
  
  if (!fs.existsSync(scenarioPath)) {
    console.error(`❌ シナリオファイルが見つかりません: ${scenarioPath}`);
    process.exit(1);
  }
  
  const scenarioContent = fs.readFileSync(scenarioPath, 'utf-8');
  const scenario = JSON.parse(scenarioContent);
  
  const dashboardPort = process.env.DASHBOARD_PORT || 5174;
  const apiUrl = `http://localhost:${dashboardPort}/api/presets`;
  
  try {
    console.log(`📡 Dashboard に接続中: ${apiUrl}`);
    
    const body = {
      name: scenario.name,
      description: scenario.description,
      steps: scenario.steps
    };
    
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    
    const result = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(result);
    } catch {
      parsed = { raw: result };
    }
    
    console.log('');
    console.log('✅ プリセット作成成功');
    console.log(`   名前: ${scenario.name}`);
    console.log(`   説明: ${scenario.description}`);
    console.log(`   ステップ数: ${scenario.steps.length}`);
    console.log('');
    console.log('レスポンス:');
    console.log(JSON.stringify(parsed, null, 2));
    console.log('');
    console.log('プリセット ID: ', parsed?.id || parsed?.outcome?.id || '(レスポンスから確認)');
    console.log('');
    console.log('パラメータ例:');
    console.log(JSON.stringify(scenario.params, null, 2));
    console.log('');
    console.log('タスク登録例:');
    const presetId = parsed?.id || parsed?.outcome?.id || '{preset_id}';
    console.log(`{
  "presetId": ${presetId},
  "containerId": "hitozuma_rann",
  "overrides": {
    "params": {
      "keyword": "#Xはじめました",
      "minLikes": 100,
      "replySpinText": "{いい投稿ですね|参考になりました|素晴らしい|ありがとうございます}"
    }
  }
}`);
  } catch (e) {
    console.error('❌ プリセット作成失敗:', e.message);
    process.exit(1);
  }
}

main();

