// タスク一覧APIをテストするスクリプト
import fetch from 'node-fetch';

const baseUrl = 'http://localhost:5174';

async function testTasksAPI() {
  console.log('=== タスク一覧APIテスト ===\n');
  
  // default キューのタスク一覧を取得
  try {
    console.log('1. default キューのタスク一覧を取得');
    const resp1 = await fetch(`${baseUrl}/api/tasks?queue_name=default`);
    const data1 = await resp1.json();
    console.log(`   Status: ${resp1.status}`);
    console.log(`   OK: ${data1.ok}`);
    console.log(`   Count: ${data1.count || 0}`);
    console.log(`   Items: ${data1.items?.length || 0}件`);
    if (data1.items && data1.items.length > 0) {
      console.log('   最初の3件:');
      data1.items.slice(0, 3).forEach((item, i) => {
        console.log(`     ${i + 1}. runId: ${item.runId}, status: ${item.status}, presetId: ${item.presetId}`);
      });
    }
  } catch (e) {
    console.error('   Error:', e.message);
  }
  
  console.log('\n');
  
  // queue2 キューのタスク一覧を取得
  try {
    console.log('2. queue2 キューのタスク一覧を取得');
    const resp2 = await fetch(`${baseUrl}/api/tasks?queue_name=queue2`);
    const data2 = await resp2.json();
    console.log(`   Status: ${resp2.status}`);
    console.log(`   OK: ${data2.ok}`);
    console.log(`   Count: ${data2.count || 0}`);
    console.log(`   Items: ${data2.items?.length || 0}件`);
    if (data2.items && data2.items.length > 0) {
      console.log('   最初の3件:');
      data2.items.slice(0, 3).forEach((item, i) => {
        console.log(`     ${i + 1}. runId: ${item.runId}, status: ${item.status}, presetId: ${item.presetId}`);
      });
    }
  } catch (e) {
    console.error('   Error:', e.message);
  }
  
  console.log('\n');
  
  // queue_name パラメータなしで取得（デフォルト動作）
  try {
    console.log('3. queue_name パラメータなしで取得（デフォルト）');
    const resp3 = await fetch(`${baseUrl}/api/tasks`);
    const data3 = await resp3.json();
    console.log(`   Status: ${resp3.status}`);
    console.log(`   OK: ${data3.ok}`);
    console.log(`   Count: ${data3.count || 0}`);
    console.log(`   Items: ${data3.items?.length || 0}件`);
  } catch (e) {
    console.error('   Error:', e.message);
  }
}

testTasksAPI().catch(console.error);

