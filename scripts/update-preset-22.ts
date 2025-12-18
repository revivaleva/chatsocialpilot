import * as PresetService from '../src/services/presets';

const presetId = 22;
const preset = PresetService.getPreset(presetId) as any;

if (!preset) {
  console.error('Preset not found');
  process.exit(1);
}

console.log('Current preset:', preset.name);
const steps = JSON.parse(preset.steps_json || '[]');
console.log('Steps count:', steps.length);

// パスワード入力ステップを探す（通常はステップ2）
let passwordStepIndex = -1;
for (let i = 0; i < steps.length; i++) {
  const step = steps[i];
  const code = step.code || step.eval || '';
  if (code.includes('password') || code.includes('パスワード') || (step.description && step.description.includes('パスワード'))) {
    passwordStepIndex = i;
    console.log(`Found password step at index ${i}`);
    console.log('Current code:', code.substring(0, 200));
    break;
  }
}

if (passwordStepIndex === -1) {
  console.error('Password step not found');
  process.exit(1);
}

const passwordStep = steps[passwordStepIndex];
const currentCode = passwordStep.code || passwordStep.eval || '';

// フォーカスとエンターキーの処理を追加
// 既存のコードの最後に追加する
const focusAndEnterCode = `
// パスワード入力欄にフォーカスを当てる
const passwordInput = document.querySelector('input[type="password"]');
if (passwordInput) {
  passwordInput.focus();
  passwordInput.click();
  await new Promise(r => setTimeout(r, 100));
  
  // エンターキーをシミュレート
  const enterEvent = new KeyboardEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    bubbles: true,
    cancelable: true
  });
  passwordInput.dispatchEvent(enterEvent);
  
  await new Promise(r => setTimeout(r, 100));
}
`;

// 既存のコードに追加（最後に追加）
const updatedCode = currentCode.trim() + '\n' + focusAndEnterCode;

// ステップを更新
if (passwordStep.code) {
  passwordStep.code = updatedCode;
} else if (passwordStep.eval) {
  passwordStep.eval = updatedCode;
} else {
  passwordStep.code = updatedCode;
}

// プリセットを更新
PresetService.updatePreset(
  presetId,
  preset.name,
  preset.description || '',
  JSON.stringify(steps),
  (preset as any).use_post_library
);

console.log('Preset updated successfully');
console.log('Updated code length:', updatedCode.length);

