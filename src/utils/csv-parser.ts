/**
 * CSV 解析ユーティリティ
 * 
 * RPA 実行用のコンテナ・パラメータ情報を CSV から抽出
 */

export interface CsvRow {
  [key: string]: string;
}

export interface ParsedCsvData {
  ok: boolean;
  headers: string[];
  rows: CsvRow[];
  error?: string;
  rowCount?: number;
}

/**
 * CSV テキストを解析してオブジェクト配列に変換
 * 
 * 例入力：
 * ```
 * account,password,name
 * user1@x.com,pass123,Alice
 * user2@x.com,pass456,Bob
 * ```
 * 
 * 出力：
 * ```
 * {
 *   ok: true,
 *   headers: ['account', 'password', 'name'],
 *   rows: [
 *     { account: 'user1@x.com', password: 'pass123', name: 'Alice' },
 *     { account: 'user2@x.com', password: 'pass456', name: 'Bob' }
 *   ],
 *   rowCount: 2
 * }
 * ```
 */
export function parseCsv(csvText: string): ParsedCsvData {
  try {
    const lines = csvText
      .trim()
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    if (lines.length === 0) {
      return { ok: false, headers: [], rows: [], error: 'CSV が空です' };
    }

    // ヘッダーを解析
    const headers = parseCSVLine(lines[0]);
    if (headers.length === 0) {
      return { ok: false, headers: [], rows: [], error: 'ヘッダーが解析できません' };
    }

    // データ行を解析
    const rows: CsvRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      if (values.length === 0) continue;  // 空行をスキップ

      // ヘッダーと値の個数が異なる場合は警告（実装によっては止めるか）
      if (values.length !== headers.length) {
        continue;  // スキップ
      }

      const row: CsvRow = {};
      for (let j = 0; j < headers.length; j++) {
        row[headers[j]] = values[j];
      }
      rows.push(row);
    }

    if (rows.length === 0) {
      return { ok: false, headers, rows: [], error: 'データ行がありません' };
    }

    return {
      ok: true,
      headers,
      rows,
      rowCount: rows.length,
    };
  } catch (e: any) {
    return {
      ok: false,
      headers: [],
      rows: [],
      error: String(e),
    };
  }
}

/**
 * CSV 行を解析
 * クォートされたフィールドに対応
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // "" → "
        current += '"';
        i++;
      } else {
        // クォート開始/終了
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      // フィールド区切り
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result.filter(f => f.length > 0 || result.length === 1);  // 最後の空フィールドもキープ
}

/**
 * CSV データからコンテナ名を自動生成
 * 
 * 例：
 * - account が 'user1@x.com' なら 'container-user1-xxx'
 * - account が 'alice' なら 'container-alice-xxx'
 */
export function generateContainerName(row: CsvRow, index: number): string {
  const account = row.account || row.email || row.username || `row-${index}`;
  const sanitized = account
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 20);

  const random = Math.random().toString(36).substring(2, 8);
  return `container-${sanitized}-${random}`;
}

/**
 * CSV データからシナリオパラメータを抽出
 * 
 * 対応フィールド：
 * - account, email, username → シナリオパラメータの username/account
 * - password, pass → password
 * - bio, description → bio
 * など
 */
export function extractScenarioParams(row: CsvRow): Record<string, any> {
  const params: Record<string, any> = {};

  // Account/Email/Username
  if (row.account) params.account = row.account;
  if (row.email) params.account = row.email;
  if (row.username) params.username = row.username;

  // Password
  if (row.password) params.password = row.password;
  if (row.pass) params.password = row.pass;

  // Bio/Description
  if (row.bio) params.bio = row.bio;
  if (row.description) params.bio = row.description;

  // その他のフィールドはそのままコピー
  for (const [key, value] of Object.entries(row)) {
    if (!params[key]) {
      params[key] = value;
    }
  }

  return params;
}

