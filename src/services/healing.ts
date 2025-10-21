import { chatJson } from '../drivers/openai';
import { RuntimeConfig } from '../types';

export type HealingInput = {
  url: string;
  htmlSnippet: string;
  a11yTree?: string;
  previousLocators?: any;
  screenshotBase64?: string;
  intent: 'post_button' | 'reply_button' | 'quote_button' | 'text_area';
};

export type HealingOutput = {
  candidates: Array<{ strategy: string; locator: string; reason: string }>;
  postChecks: string[];
  denyList: string[];
  notes?: string;
};

const HEALING_PROMPT = `
  あなたはUI要素を特定するエージェントです。与えられたHTML断片とA11yから、目的の要素を高精度に特定するロケータを最大5件返してください。
  出力はJSON（candidates[], postChecks[], denyList[]）。
  優先: getByRole > getByLabel > getByText > css。広告やaria-hidden要素は避ける。
  `;

export async function proposeSelectors(cfg: RuntimeConfig, input: HealingInput): Promise<HealingOutput> {
  const useVision = !!input.screenshotBase64 && cfg.routing.useVisionIfScreenshot;
  const model = useVision ? cfg.models.healing.vision_fallback : cfg.models.healing.primary;
  return await chatJson<HealingOutput>({
    model,
    system: HEALING_PROMPT,
    user: input,
    responseJson: true,
    temperature: 0.2,
    max_tokens: 800,
  });
}


