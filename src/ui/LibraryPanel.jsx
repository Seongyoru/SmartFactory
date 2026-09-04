/**
 * =============================================================================
 *  라이브러리 패널 — 작업영역 / 기계설비 / 연결장치 / 운송적재
 * =============================================================================
 *  탭을 나누는 이유는 단순한 분류가 아니라 "놓는 방식이 다르기 때문" 이다.
 *    작업영역 — 끌거나 찍어서 **면과 선**을 그린다 (건물)
 *    기계설비 — 클릭 한 번에 한 대 (그리드 스냅)
 *    연결장치 — 포트 → 포트 (길이는 계산 결과)
 *    운송적재 — 카트는 경로, 선반은 자리
 *  그래서 탭마다 하단 안내 문구도 다르게 준다.
 *
 *  탭 이름은 네 글자로 맞췄다. 폭이 좁아 한 줄에 아이콘+글자를 나란히 두면
 *  글자가 잘리므로 **아이콘을 위, 글자를 아래**로 쌓는다.
 * ---------------------------------------------------------------------------
 */

import React, { useMemo, useState } from 'react';
import {
  Box,
  Building2,
  Cable,
  Columns3,
  Container,
  DoorOpen,
  Frame,
  Layers,
  PenTool,
  Plus,
  Square,
  SquareDashed,
  Trash2,
  Truck,
} from 'lucide-react';
import { CATEGORY, KIND } from '../data/library.js';
import { SHAPE, TOOL, useEditor } from '../core/store.jsx';
import { deleteModelBuffer } from '../core/persistence.js';
import { dropModel, getSpec } from '../core/modelStore.js';
import ImportDialog from './ImportDialog.jsx';
import OrdersDock from './OrdersDock.jsx';
import { ColorField, Slider } from './common.jsx';
import { panelClass } from './narrow.js';

/** 건물 탭은 라이브러리 항목이 아니라 도구 모음이라 별도의 id 를 쓴다 */
const BUILD = 'build';

const TABS = [
  { id: BUILD, label: '작업영역', Icon: Building2 },
  { id: CATEGORY.EQUIPMENT, label: '기계설비', Icon: Box },
  { id: CATEGORY.CONNECTOR, label: '연결장치', Icon: Cable },
  { id: CATEGORY.LOGISTICS, label: '운송적재', Icon: Truck },
];

/** 작업영역 탭의 도구. 면(영역·구역)은 사각형/펜을 고를 수 있다. */
const BUILD_TOOLS = [
  { tool: TOOL.AREA, label: '영역', Icon: Frame, shaped: true, desc: '바닥을 그리면 바깥으로 벽이 선다' },
  { tool: TOOL.WALL, label: '벽', Icon: SquareDashed, desc: '두 점을 찍어 내벽을 세운다' },
  { tool: TOOL.PILLAR, label: '기둥', Icon: Columns3, desc: '누른 자리에 사각 기둥 하나' },
  { tool: TOOL.OPENING, label: '개구부', Icon: DoorOpen, desc: '벽을 클릭 — 트럭이 드나드는 출입구' },
  { tool: TOOL.ZONE, label: '구역', Icon: Square, shaped: true, desc: '바닥 위에만 · 이름이 바닥에 찍힌다' },
];

function ItemCard({ item, active, onPick, onRemove }) {
  const spec = item.modelKey ? getSpec(item.modelKey) : null;
  const size = spec?.bbox.size;
  const isConn = item.category === CATEGORY.CONNECTOR;
  const Icon = item.kind === KIND.SHELF ? Layers
    : item.kind === KIND.TRUCK ? Container
      : item.kind === KIND.CART ? Truck : isConn ? Cable : Box;

  return (
    <div
      onClick={onPick}
      data-guide={`item-${item.id}`}
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

      {/* 손가락에는 hover 가 없다 — `data-touch-show` 를 보고 index.css 의
          (pointer: coarse) 가 늘 보이게 한다. 없으면 이 단추가 손가락으로 쓰는
          화면에는 **아예 존재하지 않는다**(크기가 아니라 닿을 수 없는 문제다). */}
      {item.source === 'user' && (
        <button
          data-touch-show=""
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

/* --------------------------------------------------------------------------
 * 작업영역 도구 모음
 * ------------------------------------------------------------------------ */
function BuildTools() {
  const { state, dispatch } = useEditor();
  const active = BUILD_TOOLS.find((t) => t.tool === state.tool);
  const b = state.build;
  const setB = (patch) => dispatch({ type: 'SET_BUILD', patch });

  return (
    <div className="space-y-2">
      {BUILD_TOOLS.map(({ tool, label, Icon, desc }) => (
        <button
          key={tool}
          data-guide={`tool-${tool}`}
          onClick={() => dispatch({ type: 'SET_TOOL', tool: state.tool === tool ? TOOL.SELECT : tool })}
          className={`flex w-full items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors ${
            state.tool === tool
              ? 'border-sky-500/70 bg-sky-500/10'
              : 'border-line bg-raise hover:border-edge hover:bg-raiseh'
          }`}
        >
          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md text-sky-500 ring-1 ring-edge">
            <Icon size={14} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-medium text-ink">{label}</span>
            <span className="mt-0.5 block text-[10.5px] leading-snug text-ink4">{desc}</span>
          </span>
        </button>
      ))}

      {/* 놓기 전에 정해 두는 규격.
          같은 두께의 벽을 여러 장 세우는 일이 훨씬 많아서, 놓고 나서 하나씩
          고치는 것보다 먼저 맞춰 두고 계속 찍는 쪽이 손이 덜 간다. */}
      {(active?.tool === TOOL.AREA || active?.tool === TOOL.WALL) && (
        <div className="rounded-lg border border-line bg-raise p-2">
          <p className="mb-1 text-[10.5px] text-ink4">
            {active.tool === TOOL.AREA ? '새 영역의 벽' : '새 내벽'} 규격
          </p>
          <Slider
            label="두께" min={0.05} max={1.5} step={0.05}
            value={b.wallThickness} text={`${b.wallThickness.toFixed(2)} m`}
            onChange={(v) => setB({ wallThickness: v })}
          />
          <Slider
            label="높이" min={0.3} max={12} step={0.1}
            value={b.wallHeight} text={`${b.wallHeight.toFixed(2)} m`}
            onChange={(v) => setB({ wallHeight: v })}
          />
          <ColorField label="벽 색" value={b.wallColor} onChange={(v) => setB({ wallColor: v })} />
        </div>
      )}

      {active?.tool === TOOL.PILLAR && (
        <div className="rounded-lg border border-line bg-raise p-2">
          <p className="mb-1 text-[10.5px] text-ink4">새 기둥 규격</p>
          <Slider
            label="가로" min={0.1} max={3} step={0.05}
            value={b.pillarW} text={`${b.pillarW.toFixed(2)} m`}
            onChange={(v) => setB({ pillarW: v })}
          />
          <Slider
            label="세로" min={0.1} max={3} step={0.05}
            value={b.pillarD} text={`${b.pillarD.toFixed(2)} m`}
            onChange={(v) => setB({ pillarD: v })}
          />
          <Slider
            label="높이" min={0.3} max={12} step={0.1}
            value={b.pillarHeight} text={`${b.pillarHeight.toFixed(2)} m`}
            onChange={(v) => setB({ pillarHeight: v })}
          />
          <ColorField label="색" value={b.pillarColor} onChange={(v) => setB({ pillarColor: v })} />
        </div>
      )}

      {active?.tool === TOOL.OPENING && (
        <div className="rounded-lg border border-line bg-raise p-2">
          <p className="mb-1 text-[10.5px] text-ink4">새 개구부 규격</p>
          <Slider
            label="폭" min={0.3} max={20} step={0.1}
            value={b.openingWidth} text={`${b.openingWidth.toFixed(2)} m`}
            onChange={(v) => setB({ openingWidth: v })}
          />
          <Slider
            label="높이" min={0.3} max={12} step={0.1}
            value={b.openingHeight} text={`${b.openingHeight.toFixed(2)} m`}
            onChange={(v) => setB({ openingHeight: v })}
          />
          {/* 밑턱이 0 이면 바닥까지 트인 출입구, 올리면 창이 된다 */}
          <Slider
            label="밑턱" min={0} max={4} step={0.05}
            value={b.openingSill}
            text={b.openingSill > 0 ? `${b.openingSill.toFixed(2)} m · 창` : '0 · 출입구'}
            onChange={(v) => setB({ openingSill: v })}
          />
        </div>
      )}

      {/* 면을 그리는 방식 — 영역·구역에만 해당한다 */}
      {active?.shaped && (
        <div className="rounded-lg border border-line bg-raise p-2">
          <p className="mb-1.5 text-[10.5px] text-ink4">{active.label} 그리는 방식</p>
          <div className="flex gap-1.5">
            {[
              { id: SHAPE.RECT, label: '사각형', Icon: Square },
              { id: SHAPE.PEN, label: '펜', Icon: PenTool },
            ].map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => dispatch({ type: 'SET', patch: { drawShape: id, polyDraft: null } })}
                className={`flex flex-1 items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-[11px] transition-colors ${
                  state.drawShape === id
                    ? 'border-sky-500/70 bg-sky-500/10 text-sky-500'
                    : 'border-line text-ink4 hover:text-ink2'
                }`}
              >
                <Icon size={12} /> {label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-line bg-raise px-3 py-2 text-[10.5px] leading-relaxed text-ink4">
        영역을 겹쳐 그리면 안쪽 선이 사라지고 <b className="text-ink3">바깥 윤곽 하나</b>로 합쳐집니다.
        3D 뷰에서는 보는 쪽 벽이 자동으로 감춰집니다.
      </div>
    </div>
  );
}

/* ========================================================================== */

export default function LibraryPanel({ mode = 'side' }) {
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
    <aside className={`flex flex-col border-r border-line bg-panel ${panelClass('lib', mode)}`}>
      <div className="flex min-h-0 flex-1 flex-col">
      {/* 탭 — 아이콘 위, 이름 아래 */}
      <div className="flex border-b border-line">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            data-guide={`tab-${id}`}
            onClick={() => {
              setTab(id);
              /* 다른 탭으로 넘어가면 그리던 도구는 놓는다 — 영역 도구를 든 채
                 설비 탭을 보고 있으면 클릭이 어디로 가는지 알 수 없다 */
              if (id !== BUILD) dispatch({ type: 'SET_TOOL', tool: TOOL.SELECT });
            }}
            className={`flex flex-1 flex-col items-center justify-center gap-1 border-b-2 px-1 py-2 text-[11px] font-medium transition-colors ${
              tab === id
                ? 'border-sky-500 text-sky-400'
                : 'border-transparent text-ink4 hover:text-ink2'
            }`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      {/* 목록 */}
      <div className="flex-1 space-y-2 overflow-y-auto p-2.5">
        {tab === BUILD ? (
          <BuildTools />
        ) : (
          <>
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
          </>
        )}
      </div>

      {/* 탭별 안내 */}
      <div className="border-t border-line px-3 py-2.5">
        <p className="text-[10.5px] leading-relaxed text-ink4">
          {tab === BUILD ? (
            <>
              <b className="text-ink3">사각형</b>은 끌어서, <b className="text-ink3">펜</b>은 점을 찍고
              <kbd className="mx-1 rounded bg-kbd px-1 text-ink2">더블클릭</kbd>(또는 첫 점 다시 클릭)으로 닫습니다.
              벽은 <b className="text-ink3">면을 한 번 더</b> 누르면 그 면만 따로 고칠 수 있습니다.
            </>
          ) : tab === CATEGORY.EQUIPMENT ? (
            <>
              항목을 고르면 <b className="text-ink3">탑뷰</b>로 전환됩니다. 클릭해서 배치하고
              <kbd className="mx-1 rounded bg-kbd px-1 text-ink2">R</kbd>로 90° 회전.
            </>
          ) : tab === CATEGORY.LOGISTICS ? (
            <>
              <b className="text-ink3">카트</b>는 바닥을 클릭해 순찰 경로를 찍고
              <kbd className="mx-1 rounded bg-kbd px-1 text-ink2">더블클릭</kbd>으로 마칩니다.
              <b className="text-ink3"> 선반</b>은 클릭해서 놓고
              <kbd className="mx-1 rounded bg-kbd px-1 text-ink2">[ ]</kbd>로 길이를 조절합니다.
              카트가 선반 앞을 지나면 싣고 있던 자재를 부립니다.
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

      </div>

      {/**
        * 생산 오더 — **왼쪽 아래 절반**에 붙박이로 둔다.
        * ---------------------------------------------------------------------
        *  인스펙터에만 있으면 설비를 하나라도 누르는 순간 진척이 화면에서 사라진다.
        *  라인을 손보는 동안에도 「지금 몇 개까지 왔고 납기를 맞추는가」 는 계속
        *  보여야 하는 값이다.
        */}
      <OrdersDock />

      {importing && (
        <ImportDialog
          defaultCategory={tab === BUILD ? CATEGORY.EQUIPMENT : tab}
          onClose={() => setImporting(false)}
          onAdd={(item) => dispatch({ type: 'ADD_LIB_ITEM', item })}
        />
      )}
    </aside>
  );
}
