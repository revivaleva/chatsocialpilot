import React from 'react';
import type { ContainerRecord } from './ContainerList';

export type ContainerDetailPanelProps = {
  container?: ContainerRecord | null;
  onClose?: () => void;
};

export default function ContainerDetailPanel(props: ContainerDetailPanelProps) {
  const { container = null, onClose } = props;
  if (!container) return null;
  return (
    <div style={{ border: '1px solid #eee', padding: 8, borderRadius: 8 }}>
      <h4 style={{ marginTop: 0 }}>{container.name || container.id}</h4>
      <div><strong>ID:</strong> {container.id}</div>
      <div><strong>ディレクトリ:</strong> {container.dir || ''}</div>
      <div><strong>更新:</strong> {container.updatedAt ? new Date(container.updatedAt).toLocaleString() : ''}</div>
      <div style={{ marginTop: 8 }}>
        <button onClick={() => onClose && onClose()}>閉じる</button>
      </div>
    </div>
  );
}


