/**
 * =============================================================================
 *  라이브러리 패널 — 설비 / 연결장치 두 탭
 * =============================================================================
 *  탭을 나누는 이유는 단순한 분류가 아니라 "배치 방식이 다르기 때문" 이다.
 *  그래서 탭마다 하단 안내 문구도 다르게 준다.
 * ---------------------------------------------------------------------------
 */

import React, { useMemo, useState } from 'react';
import { Box, Cable, Plus, Trash2, Truck } from 'lucide-react';
import { CATEGORY, CATEGORY_META } from '../data/library.js';
import { useEditor } from '../core/store.jsx';
import { deleteModelBuffer } from '../core/persistence.js';
import { dropModel, getSpec } from '../core/modelStore.js';
import ImportDialog from './ImportDialog.jsx';

const TABS = [
  { id: CATEGORY.EQUIPMENT, label: '설비', Icon: Box },
  { id: CATEGORY.CONNECTOR, label: '연결장치', Icon: Cable },
  { id: CATEGORY.CART, label: '카트', Icon: Truck },
];

function ItemCard({ item, active, onPick, onRemove }) {
  const spec = item.modelKey ? getSpec(item.modelKey) : null;
  const size = spec?.bbox.size;
  const isConn = item.category === CATEGORY.CONNECTOR;
  const isCartItem = item.category === CATEGORY.CART;
  const Icon = isCartItem ? Truck : isConn ? Cable : Box;

  return (
    <div
      onClick={onPick}
      className={`cursor-grab-item group relative rounded-lg border px-3 py-2.5 transition-colors ${
        active
          ? 'border-sky-500/70 bg-sky-500/10'
          : 'border-line bg-raise hover:border-edge hover:bg-raiseh'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <span
          className="mt-0.5 h-7 w-7 shrink-0 rounded-md ring-1 ring-edge"
          style={{ background: `linear-gradient(140deg, ${item.color}44, ${item.color}12)` }}
        >
          <span className="grid h-full w-full place-items-center" style={{ color: item.color }}>
            <Icon size={14} />
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-ink">{item.name}</p>
          <p className="mt-0.5 truncate text-[10.5px] text-ink4">
            {item.desc
              ? item.desc
              : size
                ? isConn
                  ? `${spec.connector.span.toFixed(2)} m 토막 · ${spec.hasExplicitPorts ? '포트 정의됨' : '포트 자동'}`
                  : `${size[0].toFixed(1)} × ${size[1].toFixed(1)} × ${size[2].toFixed(1)} m`
                : '로딩 중…'}
          </p>
        </div>
      </div>

      {item.source === 'user' && (
        <button
          title="라이브러리에서 삭제"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="absolute right-1.5 top-1.5 hidden rounded p-1 text-ink4 hover:bg-red-500/15 hover:text-red-500 group-hover:block"
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );
}

export default function LibraryPanel() {
  const { state, dispatch } = useEditor();
  const [tab, setTab] = useState(CATEGORY.EQUIPMENT);
  const [importing, setImporting] = useState(false);

  const items = useMemo(() => state.library.filter((i) => i.category === tab), [state.library, tab]);

  const remove = (item) => {
    if (!window.confirm(`"${item.name}" 을(를) 라이브러리에서 삭제할까요?\n이 모델로 배치한 것도 함께 사라집니다.`)) return;
    dispatch({ type: 'REMOVE_LIB_ITEM', id: item.id });
    dropModel(item.modelKey);
    deleteModelBuffer(item.id).catch(() => {});
  };

  return (
    <aside className="flex w-[264px] shrink-0 flex-col border-r border-line bg-panel">
      {/* 탭 */}
      <div className="flex border-b border-line">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors ${
              tab === id
                ? 'border-sky-500 text-sky-400'
                : 'border-transparent text-ink4 hover:text-ink2'
            }`}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      {/* 목록 */}
      <div className="flex-1 space-y-2 overflow-y-auto p-2.5">
        {items.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            active={state.activeItemId === item.id}
            onPick={() => dispatch({ type: 'PICK_ITEM', itemId: item.id })}
            onRemove={() => remove(item)}
          />
        ))}
        {items.length === 0 && (
          <p className="px-2 py-8 text-center text-[11px] text-ink4">등록된 항목이 없습니다</p>
        )}

        <button
          onClick={() => setImporting(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-edge px-3 py-2.5 text-[11px] text-ink3 transition-colors hover:border-sky-500/60 hover:text-sky-600"
        >
          <Plus size={13} /> 내 모델 추가 (GLB)
        </button>
      </div>

      {/* 탭별 안내 */}
      <div className="border-t border-line px-3 py-2.5">
        <p className="text-[10.5px] leading-relaxed text-ink4">
          {tab === CATEGORY.EQUIPMENT ? (
            <>
              항목을 고르면 <b className="text-ink3">탑뷰</b>로 전환됩니다. 클릭해서 배치하고
              <kbd className="mx-1 rounded bg-kbd px-1 text-ink2">R</kbd>로 90° 회전.
            </>
          ) : tab === CATEGORY.CART ? (
            <>
              바닥을 클릭해 <b className="text-ink3">순찰 경로</b>를 찍고
              <kbd className="mx-1 rounded bg-kbd px-1 text-ink2">더블클릭</kbd>으로 마칩니다.
              첫 점을 다시 누르면 고리로 닫힙니다. 경로가 설비 유출부 옆을 지나면 싣고,
              유입부 옆을 지나면 내립니다.
            </>
          ) : (
            <>
              <b className="text-ink3">유출 포트 → 유입 포트</b> 순서로 클릭하면 거리에 맞춰 모델이
              연장되고 코너는 자동으로 곡선이 됩니다. 배관·전선은 포트 대신
              <b className="text-ink3"> 자기 높이</b>에 놓입니다.
            </>
          )}
        </p>
      </div>

      {importing && (
        <ImportDialog
          defaultCategory={tab}
          onClose={() => setImporting(false)}
          onAdd={(item) => dispatch({ type: 'ADD_LIB_ITEM', item })}
        />
      )}
    </aside>
  );
}
