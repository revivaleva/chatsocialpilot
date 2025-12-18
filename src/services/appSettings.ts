import fs from 'node:fs';
import path from 'node:path';

export type AppSettings = {
  dashboardPort: number;
  containerBrowserHost: string;
  containerBrowserPort: number;
  discordWebhookUrl?: string;
};

const SETTINGS_PATH = path.resolve('config', 'settings.json');

const DEFAULT_SETTINGS: AppSettings = {
  dashboardPort: 5174,
  containerBrowserHost: '127.0.0.1',
  containerBrowserPort: 3001,
};

function ensureConfigDir() {
  const dir = path.dirname(SETTINGS_PATH);
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    // ignore errors - reading/writing will fail later if needed
  }
}

function parseSettings(raw: string | null): AppSettings {
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    const parsed = JSON.parse(raw);
    return {
      dashboardPort: Number.isFinite(Number(parsed.dashboardPort)) && Number(parsed.dashboardPort) > 0 ? Number(parsed.dashboardPort) : DEFAULT_SETTINGS.dashboardPort,
      containerBrowserHost: parsed.containerBrowserHost ? String(parsed.containerBrowserHost) : DEFAULT_SETTINGS.containerBrowserHost,
      containerBrowserPort: Number.isFinite(Number(parsed.containerBrowserPort)) && Number(parsed.containerBrowserPort) > 0 ? Number(parsed.containerBrowserPort) : DEFAULT_SETTINGS.containerBrowserPort,
      discordWebhookUrl: parsed.discordWebhookUrl ? String(parsed.discordWebhookUrl).trim() : undefined,
    };
  } catch (e) {
    return { ...DEFAULT_SETTINGS };
  }
}

function safeReadFile(): string | null {
  try {
    if (!fs.existsSync(SETTINGS_PATH)) return null;
    return fs.readFileSync(SETTINGS_PATH, 'utf8');
  } catch (e) {
    return null;
  }
}

export function loadSettings(): AppSettings {
  const raw = safeReadFile();
  const parsed = parseSettings(raw);
  if (raw === null) {
    // file missing: create default
    try {
      ensureConfigDir();
      fs.writeFileSync(SETTINGS_PATH, JSON.stringify(parsed, null, 2), 'utf8');
    } catch (e) {
      // best effort only
    }
  }
  return parsed;
}

export function saveSettings(partial: Partial<AppSettings>): AppSettings {
  const existing = loadSettings();
  const merged: AppSettings = {
    dashboardPort: Number.isFinite(Number(partial.dashboardPort ?? existing.dashboardPort)) && Number(partial.dashboardPort ?? existing.dashboardPort) > 0
      ? Number(partial.dashboardPort ?? existing.dashboardPort)
      : existing.dashboardPort,
    containerBrowserHost: partial.containerBrowserHost ? String(partial.containerBrowserHost) : existing.containerBrowserHost,
    containerBrowserPort: Number.isFinite(Number(partial.containerBrowserPort ?? existing.containerBrowserPort)) && Number(partial.containerBrowserPort ?? existing.containerBrowserPort) > 0
      ? Number(partial.containerBrowserPort ?? existing.containerBrowserPort)
      : existing.containerBrowserPort,
    discordWebhookUrl: partial.discordWebhookUrl !== undefined
      ? (partial.discordWebhookUrl ? String(partial.discordWebhookUrl).trim() : undefined)
      : existing.discordWebhookUrl,
  };
  try {
    ensureConfigDir();
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(merged, null, 2), 'utf8');
  } catch (e) {
    // propagate for caller if needed
    throw e;
  }
  return merged;
}

