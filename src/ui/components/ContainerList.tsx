import React from 'react';

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
            <th>名前</th>
            <th>グループ</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {containers.map((c) => (
            <tr key={c.id}>
              <td>{c.name || ''}</td>
              <td>{c.groupId || ''}</td>
              <td>
                <button onClick={() => onSelect && onSelect(c.id, !(selectedIds || []).includes(c.id))}>選択</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


