import React from 'react';

export type GroupRecord = {
  id: string;
  name: string;
  description?: string;
  color?: string;
  createdAt?: number;
  updatedAt?: number;
};

export type ContainerGroupEditorProps = {
  visible?: boolean;
  groups?: GroupRecord[];
  initialSelection?: string[]; // container ids
  onClose?: () => void;
  onCreateGroup?: (payload: { name: string; description?: string; color?: string }) => Promise<GroupRecord>;
  onAssignGroup?: (groupId: string, containerIds: string[]) => Promise<void>;
};

export default function ContainerGroupEditor(props: ContainerGroupEditorProps) {
  const { visible = false, groups = [], initialSelection = [], onClose } = props;
  if (!visible) return null;
  return (
    <div style={{ position: 'fixed', left: 0, top: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', padding: 12, borderRadius: 8, width: '90%', maxWidth: 800 }}>
        <h3>グループ編集</h3>
        <div style={{ maxHeight: 400, overflow: 'auto' }}>
          <ul>
            {groups.map(g => <li key={g.id}>{g.name} <small style={{ marginLeft: 8 }}>{g.description || ''}</small></li>)}
          </ul>
        </div>
        <div style={{ marginTop: 8, textAlign: 'right' }}>
          <button onClick={() => onClose && onClose()}>閉じる</button>
        </div>
      </div>
    </div>
  );
}


