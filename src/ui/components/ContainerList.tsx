import React from 'react';
import { generateDeepLink } from '../../utils/generateDeepLink';

export type ContainerRecord = {
  id: string;
  name?: string;
  dir?: string;
  partition?: string;
  updatedAt?: number;
  groupId?: string | null;
};

export type ContainerListProps = {
  containers?: ContainerRecord[];
  selectedIds?: string[];
  onSelect?: (id: string, selected: boolean) => void;
  onOpenGroupEditor?: (initialSelection?: string[]) => void;
};

export default function ContainerList(props: ContainerListProps) {
  const { containers = [], selectedIds = [], onSelect, onOpenGroupEditor } = props;

  function openDeepLink(link: string) {
    // Try Electron shell.openExternal if available, otherwise fall back to window.location.href.
    try {
      // window.require may be provided in some Electron setups. Use any cast intentionally as availability varies.
      const w: any = window as any;
      if (typeof w.require === 'function') {
        try {
          const { shell } = w.require('electron');
          if (shell && typeof shell.openExternal === 'function') {
            shell.openExternal(link);
            return;
          }
        } catch (e) {
          // ignore and fallback
        }
      }
    } catch (e) {
      // ignore and fallback
    }
    try { window.location.href = link; } catch (e) { /* ignore */ }
  }
  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <input placeholder="検索 (id / name)" style={{ padding: 6 }} />
        <button style={{ marginLeft: 8 }} onClick={() => onOpenGroupEditor && onOpenGroupEditor()}>
          グループ設定
        </button>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th>グループ</th>
            <th>名前</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {containers.map((c) => (
            <tr key={c.id}>
              <td>{c.groupId || ''}</td>
              <td>{c.name || ''}</td>
              <td>
                <button onClick={() => onSelect && onSelect(c.id, !(selectedIds || []).includes(c.id))}>選択</button>
                <button style={{ marginLeft: 8 }} onClick={() => {
                  try {
                    const name = c.name || c.id;
                    const link = generateDeepLink({ name, url: undefined });
                    openDeepLink(link);
                  } catch (err) {
                    // fail silently for now; keep minimal change
                    // eslint-disable-next-line no-console
                    console.warn('open in app failed', err);
                  }
                }}>アプリで開く</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


