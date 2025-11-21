export type LocatorCandidate = { strategy: 'getByRole'|'getByLabel'|'getByText'|'css', locator: string };

function norm(host: string) { return (host||'').toLowerCase(); }

export function siteCandidates(host: string): { text_area: LocatorCandidate[]; post_button: LocatorCandidate[] } {
  const h = norm(host);
  // 既定（どのサイトでも無害な候補）
  const baseText: LocatorCandidate[] = [
    { strategy:'css', locator:'[contenteditable="true"]' },
    { strategy:'getByRole', locator:'textbox' },
    { strategy:'css', locator:'textarea' },
  ];
  const basePost: LocatorCandidate[] = [
    { strategy:'getByText', locator:'投稿' },
    { strategy:'getByText', locator:'Post' },
    { strategy:'getByText', locator:'Share' },
    { strategy:'getByText', locator:'Send' },
    { strategy:'css', locator:'button[type=submit]' },
    { strategy:'css', locator:'button[aria-label="Post"],button[aria-label="投稿"]' },
  ];

  // Threads 系（ドメインが threads.net を含む場合に微調整）
  if (h.includes('threads.net')) {
    return {
      text_area: [
        { strategy:'css', locator:'[contenteditable="true"]' },
        { strategy:'getByRole', locator:'textbox' },
        { strategy:'css', locator:'textarea' },
        // よくある placeholder（変化する可能性あり・存在すれば当たり）
        { strategy:'getByText', locator:'今なにしてる？|What’s on your mind|What are you thinking?' }
      ],
      post_button: [
        { strategy:'getByText', locator:'投稿|Post|Share|Send' },
        { strategy:'css', locator:'button[type=submit]' },
        { strategy:'css', locator:'button[aria-label="投稿"],button[aria-label="Post"]' }
      ]
    };
  }

  return { text_area: baseText, post_button: basePost };
}





