export type RuntimeConfig = {
  dbDriver: 'sqlite';
  queueDriver: 'memory';
  storageDriver: 'fs';
  scheduler: 'internal';
  headless: boolean;
  maxConcurrentBrowsers: number;
  cpuTargetUpperPercent: number;
  defaultWaitMinutes?: number;
  sqlite: { busyRetry: number[]; wal: boolean };
  models: {
    nlu: string;
    vision_primary: string;
    text_reasoning_primary: string;
    healing: { primary: string; vision_fallback: string; text_fallback: string };
  };
  routing: {
    confidenceFloor: number;
    healingMaxHtmlBytesForNano: number;
    retryBeforeFallback: number;
    useVisionIfScreenshot: boolean;
  };
};

export type Account = {
  accountId: string;
  profileUserDataDir: string;
  proxy?: string | null;
  timezone?: string;
  dailyPostTimeJst?: string;
};

export type AccountsConfig = {
  threads: Account[];
};

export type TwoStagePolicy = {
  enabled: boolean;
  defaultDelayMinutes: number;
  mode: 'reply' | 'quote';
  template: string;
};

export type PolicyConfig = {
  ngWords: string[];
  maxChars: number;
  hashtags: string[];
  dedupeWindowMinutes: number;
  twoStage: TwoStagePolicy;
  monitoring: { users: string[]; keywords: string[] };
  healing: {
    candidateCount: number;
    priority: Array<'getByRole' | 'getByLabel' | 'getByText' | 'css'>;
    denyList: string[];
  };
};


