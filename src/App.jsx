/**
 * =============================================================================
 *  EGIS Smart Factory — 설비 배치 에디터
 * =============================================================================
 *  화면 구성
 *    상단  툴바 (뷰 전환 · 도구 · 스냅 · 저장)
 *    좌측  라이브러리 (설비 / 연결장치 탭)
 *    중앙  3D 캔버스 (탑뷰에서 배치, 3D 에서 확인)
 *    우측  인스펙터 (선택 상세 / 도면 요약)
 *    하단  상태바 (커서 좌표 · 현재 동작 안내)
 * ---------------------------------------------------------------------------
 */

import React, { useEffect } from 'react';
import { Ban, Building2, Cable, Crosshair, MousePointer2, Eraser, Truck, Box as BoxIcon } from 'lucide-react';
import { EditorProvider, SHAPE, TOOL, VIEW, isBuildTool, useEditor } from './core/store.jsx';
import { loadModel } from './core/modelStore.js';
import { useCursor } from './core/cursorStore.js';
import { BUILTIN_LIBRARY, PAYLOAD_ITEM, isShelf, isUtility } from './data/library.js';
import { DEFAULT_BAYS, MAX_BAYS, MIN_BAYS } from './core/shelf.js';
import EditorScene from './scene/EditorScene.jsx';
import LibraryPanel from './ui/LibraryPanel.jsx';
import Toolbar from './ui/Toolbar.jsx';
import Inspector from './ui/Inspector.jsx';
import ZoneLayers from './ui/ZoneLayers.jsx';

/* 기본 제공 모델은 앱이 뜨자마자 받아 둔다 — 라이브러리 카드에 치수를 띄우고,
   첫 배치 때 고스트가 늦게 나타나는 것을 막기 위해. */
function usePreloadBuiltins() {
  useEffect(() => {
    [...BUILTIN_LIBRARY, PAYLOAD_ITEM]
      .filter((i) => i.url)
      .forEach((i) => loadModel(i.modelKey, { url: i.url, axis: i.axis }).catch(() => {}));
  }, []);
}

function useShortcuts() {
  const { state, dispatch, activeItem } = useEditor();
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      switch (e.key) {
        case 'r':
        case 'R':
        case 'ㄱ':
          /* 무언가를 들고 있으면(배치 모드) 항상 손에 든 것을 돌린다.
             방금 놓은 설비가 선택 상태로 남아 있다고 해서 그걸 돌려 버리면
             "놓고 → R → 놓고" 흐름이 끊긴다. */
          if (state.tool === TOOL.PLACE) dispatch({ type: 'ROTATE_GHOST', dir: e.shiftKey ? -1 : 1 });
          else if (state.selected?.kind === 'equip') dispatch({ type: 'ROTATE', uid: state.selected.uid, dir: e.shiftKey ? -1 : 1 });
          break;
        case 'x':
        case 'X':
          dispatch({ type: 'SET_TOOL', tool: state.tool === TOOL.ERASE ? TOOL.SELECT : TOOL.ERASE });
          break;
        /* 선반 길이 — 배치 중에는 손에 든 것을, 선택 중에는 그 선반을 늘린다 */
        case '[':
        case ']': {
          const d = e.key === ']' ? 1 : -1;
          if (state.tool === TOOL.PLACE && isShelf(activeItem)) dispatch({ type: 'SHELF_BAYS', delta: d });
          else if (state.selected?.kind === 'equip') {
            const p = state.placed.find((x) => x.uid === state.selected.uid);
            if (p && isShelf(state.library.find((i) => i.id === p.itemId))) {
              dispatch({
                type: 'UPDATE_PLACED',
                uid: p.uid,
                patch: { bays: Math.max(MIN_BAYS, Math.min(MAX_BAYS, (p.bays ?? DEFAULT_BAYS) + d)) },
              });
            }
          }
          break;
        }
        case 'Enter':
          if (state.tool === TOOL.PATH) dispatch({ type: 'PATH_FINISH', closed: e.shiftKey });
          break;
        case 'Escape':
          if (state.polyDraft?.points.length || state.wallDraft) dispatch({ type: 'POLY_CANCEL' });
          else if (state.pathDraft?.points.length) dispatch({ type: 'PATH_CANCEL' });
          else if (state.connectFrom) dispatch({ type: 'CANCEL_CONNECT' });
          else dispatch({ type: 'SET_TOOL', tool: TOOL.SELECT, itemId: null });
          break;
        case 'Delete':
        case 'Backspace':
          // 경로·도형을 찍는 중이면 마지막 점을 물린다
          if (state.tool === TOOL.PATH && state.pathDraft?.points.length) dispatch({ type: 'PATH_UNDO' });
          else if (state.polyDraft?.points.length) dispatch({ type: 'POLY_UNDO' });
          else if (state.selected) {
            dispatch({
              type: 'DELETE',
              kind: state.selected.kind,
              uid: state.selected.uid,
              uids: state.selected.uids,
            });
          }
          break;
        case 'Tab':
          e.preventDefault();
          dispatch({ type: 'SET', patch: { view: state.view === VIEW.TOP ? VIEW.ISO : VIEW.TOP } });
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, dispatch, activeItem]);
}

/** 현재 무엇을 하는 중인지 캔버스 위에 띄우는 안내 */
function ModeBanner() {
  const { state, activeItem, dispatch } = useEditor();
  const { tool, connectFrom, view, hint } = state;

  /* 거절 안내는 잠깐만 띄우고 스스로 사라진다 — 닫으라고 시키면 성가시다 */
  useEffect(() => {
    if (!hint) return undefined;
    const t = setTimeout(() => dispatch({ type: 'SET', patch: { hint: null } }), 2600);
    return () => clearTimeout(t);
  }, [hint, dispatch]);

  if (tool === TOOL.SELECT) return null;

  const buildText = () => {
    const pen = state.drawShape === SHAPE.PEN;
    const n = state.polyDraft?.points.length ?? 0;
    if (tool === TOOL.PILLAR) return '기둥을 세울 자리를 클릭하세요';
    if (tool === TOOL.WALL) {
      return state.wallDraft ? '끝점을 클릭하세요 · 다른 벽 끝에 붙습니다' : '내벽 시작점을 클릭하세요';
    }
    const what = tool === TOOL.ZONE ? '구역' : '영역';
    if (!pen) return `${what} — 끌어서 사각형을 그리세요${tool === TOOL.ZONE ? ' (바닥 위에서만)' : ''}`;
    return n === 0
      ? `${what} — 펜: 첫 점을 클릭하세요`
      : `점 ${n}개 · 더블클릭으로 닫기 · 첫 점을 다시 눌러도 됩니다`;
  };

  const info =
    isBuildTool(tool)
      ? { Icon: Building2, color: 'text-emerald-600 ring-emerald-500/40', text: buildText() }
    : tool === TOOL.PLACE
      ? {
          Icon: BoxIcon,
          color: 'text-cyan-600 ring-cyan-500/40',
          text: isShelf(activeItem)
            ? `${activeItem?.name ?? ''} · 길이 ${state.shelfBays}칸 — [ ] 로 조절 · R 회전`
            : `${activeItem?.name ?? ''} 배치 — 클릭해서 놓기 · R 회전`,
        }
      : tool === TOOL.PATH
        ? {
            Icon: Truck,
            color: 'text-violet-500 ring-violet-500/40',
            text: (state.pathDraft?.points.length ?? 0) === 0
              ? `${activeItem?.name ?? ''} — 순찰 경로를 찍기 시작하세요`
              : `경유점 ${state.pathDraft.points.length}개 · 더블클릭으로 마침 · 첫 점을 다시 누르면 고리`,
          }
        : tool === TOOL.CONNECT
          ? {
              Icon: Cable,
              color: 'text-amber-600 ring-amber-500/40',
              text: connectFrom
                ? isUtility(activeItem)
                  ? '끝점을 클릭하세요 · 설비나 기존 배관 위에 놓으면 붙습니다'
                  : `${connectFrom.kind === 'out' ? '유입부' : connectFrom.kind === 'in' ? '유출부' : '도착 포트'}를 클릭하세요 · 회색 포트는 이을 수 없습니다`
                : isUtility(activeItem)
                  ? `${activeItem?.name ?? ''} — 시작점을 클릭하세요 (높이 ${activeItem?.height ?? 1}m)`
                  : `${activeItem?.name ?? ''} — 출발 포트를 클릭하세요`,
            }
          : { Icon: Eraser, color: 'text-red-500 ring-red-500/40', text: '지울 대상을 클릭하세요' };

  return (
    <div className="pointer-events-none absolute left-1/2 top-3 z-10 flex -translate-x-1/2 flex-col items-center gap-1.5">
      {hint && (
        <div className="flex items-center gap-1.5 rounded-full bg-red-500 px-3.5 py-1.5 text-[11.5px] font-medium text-white shadow-lg">
          <Ban size={13} />
          {hint}
        </div>
      )}
      <div className={`pointer-events-auto flex items-center gap-2 rounded-full bg-float px-3.5 py-1.5 text-[11.5px] font-medium ring-1 backdrop-blur ${info.color}`}>
        <info.Icon size={13} />
        {info.text}
        {view !== VIEW.TOP && <span className="text-ink4">· 탑뷰에서만 배치할 수 있습니다</span>}
        <button
          onClick={() => dispatch({ type: 'SET_TOOL', tool: TOOL.SELECT, itemId: null })}
          className="ml-1 rounded-full bg-kbd px-2 py-0.5 text-[10px] text-ink2 hover:bg-raiseh"
        >
          Esc
        </button>
      </div>
    </div>
  );
}

function StatusBar() {
  const { state } = useEditor();
  const cursor = useCursor();
  const toolName =
    state.tool === TOOL.PLACE ? '배치' : state.tool === TOOL.CONNECT ? '연결' : state.tool === TOOL.ERASE ? '지우개' : '선택';

  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-line bg-head px-3 text-[10.5px] text-ink4">
      <span className="flex items-center gap-1.5">
        <Crosshair size={11} />
        <b className="text-ink2 tabular-nums">
          X {cursor[0].toFixed(2)} / Z {cursor[1].toFixed(2)}
        </b>
      </span>
      <span className="flex items-center gap-1.5">
        <MousePointer2 size={11} /> {toolName}
      </span>
      <span>스냅 {state.gridSize >= 1 ? `${state.gridSize} m` : `${state.gridSize * 100} cm`}</span>
      <span>{state.snapEdge ? '면 맞춤 ON' : '면 맞춤 OFF'}</span>
      <div className="flex-1" />
      <span>설비 {state.placed.length} · 연결 {state.links.length}</span>
      <span className="text-ink4">자동 저장됨</span>
    </footer>
  );
}

function Shell() {
  usePreloadBuiltins();
  useShortcuts();

  return (
    <div className="flex h-full flex-col bg-app text-ink">
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <LibraryPanel />
        <main className="relative min-w-0 flex-1">
          <EditorScene />
          <ModeBanner />
          <ZoneLayers />
        </main>
        <Inspector />
      </div>
      <StatusBar />
    </div>
  );
}

export default function App() {
  return (
    <EditorProvider>
      <Shell />
    </EditorProvider>
  );
}
