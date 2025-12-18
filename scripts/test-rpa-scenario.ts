#!/usr/bin/env tsx
/**
 * RPA シナリオ テストスクリプト
 * 
 * 使用例:
 *   npm run test:rpa-scenario -- --scenario x-login --container-id abc123 --username user --password pass
 */

import { dispatch } from '../src/agent/executor';
import { logger } from '../src/utils/logger';

interface TestArgs {
  scenario: 'x-login' | 'x-update-profile' | 'x-like-posts';
  containerId: string;
  username?: string;
  password?: string;
  bio?: string;
  maxLikes?: number;
  enableHtmlAnalysis?: boolean;
}

async function parseArgs(): Promise<TestArgs> {
  const args = process.argv.slice(2);
  const params: any = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--scenario' && i + 1 < args.length) params.scenario = args[++i];
    if (args[i] === '--container-id' && i + 1 < args.length) params.containerId = args[++i];
    if (args[i] === '--username' && i + 1 < args.length) params.username = args[++i];
    if (args[i] === '--password' && i + 1 < args.length) params.password = args[++i];
    if (args[i] === '--bio' && i + 1 < args.length) params.bio = args[++i];
    if (args[i] === '--max-likes' && i + 1 < args.length) params.maxLikes = parseInt(args[++i]);
    if (args[i] === '--html-analysis') params.enableHtmlAnalysis = true;
  }

  if (!params.scenario || !params.containerId) {
    throw new Error('Required: --scenario and --container-id');
  }

  return params;
}

async function main() {
  try {
    logger.info('RPA Scenario Test Started');

    const args = await parseArgs();
    logger.info('Test args:', args);

    // シナリオ実行
    const result = await dispatch({
      capability: 'rpa_scenario',
      args: {
        contextId: args.containerId,
        scenario: args.scenario,
        params: {
          username: args.username,
          password: args.password,
          bio: args.bio,
          maxLikes: args.maxLikes,
        },
        enableHtmlAnalysis: args.enableHtmlAnalysis || false,
      },
    });

    logger.info('Scenario Result:', JSON.stringify(result, null, 2));

    if (result.ok) {
      logger.info('✅ RPA Scenario Completed Successfully');
      console.log('\nResults:');
      if (result.out?.results) {
        for (const r of result.out.results) {
          console.log(`  [${r.step}] ${r.ok ? '✓' : '✗'} ${r.reason || ''}`);
        }
      }
      process.exit(0);
    } else {
      logger.error('❌ RPA Scenario Failed:', result.error);
      process.exit(1);
    }
  } catch (e: any) {
    logger.error('Error:', String(e));
    console.error(e);
    process.exit(1);
  }
}

main();

