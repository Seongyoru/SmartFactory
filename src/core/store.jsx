/**
 * =============================================================================
 *  에디터 상태
 * =============================================================================
 *  화면 전체가 하나의 상태를 공유한다(라이브러리 · 3D 씬 · 인스펙터).
 *  Redux 같은 외부 의존을 늘리지 않고 useReducer + Context 로 둔다.
 *
 *  저장되는 좌표는 전부 "스냅이 끝난 값" 이다. 마우스 좌표는 씬 안에서만
 *  존재하고, 여기로 들어오는 순간 그리드에 정렬된 확정값이 된다.
 * ---------------------------------------------------------------------------
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { DEFAULT_GRID } from './grid.js';
import { BUILTIN_LIBRARY, CATEGORY } from '../data/library.js';
import { loadModel } from './modelStore.js';
import {
  getModelBuffer,
  layoutSnapshot,
  loadAppearance,
  loadLayout,
  loadUserLibrary,
  saveAppearance,
  saveLayout,
  saveUserLibrary,
} from './persistence.js';

const EditorCtx = createContext(null);

export const TOOL = {
  SELECT: 'select',
  PLACE: 'place',
  CONNECT: 'connect',
  /** 카트 순찰 경로 그리기 — 바닥을 눌러 경유점을 찍는다 */
  PATH: 'path',
  ERASE: 'erase',
};
export const VIEW = { TOP: 'top', ISO: 'iso' };

const initialState = {
  view: VIEW.TOP,
  /** 화면 테마. 마지막 선택을 기억한다 */
  appearance: loadAppearance(),
  gridSize: DEFAULT_GRID,
  snapEdge: true,
  showPorts: true,
  showGrid: true,

  library: BUILTIN_LIBRARY,
  placed: [],
  links: [],
  carts: [],
  seq: 1,

  tool: TOOL.SELECT,
  activeItemId: null,
  ghostRot: 0,
  cornerRadius: 1.0,

  /** 벨트 UV 애니메이션 구동 여부 · 기본 속도(m/s) */
  running: true,
  beltSpeed: 0.6,

  selected: null,       // { kind:'equip'|'link'|'cart', uid }
  connectFrom: null,    // 포트 참조 { uid, portId }
  pathDraft: null,      // 카트 경로를 그리는 중 { itemId, points:[[x,z],…] }
  hint: null,
};

/** 카트 경로를 처음 그릴 때의 기본값 */
const CART_DEFAULTS = { speed: 1.4, radius: 1.2, dwell: 1.2, reverse: false, count: 1 };

function reducer(state, action) {
  switch (action.type) {
    case 'SET':
      return { ...state, ...action.patch };

    case 'SET_TOOL':
      return {
        ...state,
        tool: action.tool,
        activeItemId: action.itemId ?? (action.tool === TOOL.PLACE || action.tool === TOOL.CONNECT ? state.activeItemId : null),
        connectFrom: null,
        selected: action.tool === TOOL.SELECT ? state.selected : null,
      };

    case 'PICK_ITEM': {
      const item = state.library.find((i) => i.id === action.itemId);
      if (!item) return state;
      const toolFor =
        item.category === CATEGORY.CONNECTOR ? TOOL.CONNECT
          : item.category === CATEGORY.CART ? TOOL.PATH
            : TOOL.PLACE;
      return {
        ...state,
        activeItemId: item.id,
        tool: toolFor,
        pathDraft: item.category === CATEGORY.CART ? { itemId: item.id, points: [] } : null,
        /* 배치는 탑뷰에서만 한다 — 라이브러리에서 무언가를 고르는 순간
           설치 뷰(탑뷰)로 자동 전환한다. */
        view: VIEW.TOP,
        connectFrom: null,
        selected: null,
        ghostRot: 0,
      };
    }

    case 'ROTATE_GHOST':
      return { ...state, ghostRot: (state.ghostRot + (action.dir ?? 1) + 4) % 4 };

    case 'PLACE': {
      const uid = `E${state.seq}`;
      const item = state.library.find((i) => i.id === action.itemId);
      const n = state.placed.filter((p) => p.itemId === action.itemId).length + 1;
      return {
        ...state,
        seq: state.seq + 1,
        placed: [
          ...state.placed,
          {
            uid,
            itemId: action.itemId,
            pos: action.pos,
            y: action.y ?? 0,
            rot: action.rot ?? 0,
            name: `${item?.name ?? action.itemId} #${n}`,
            status: 'IDLE',
            /** 한 묶음의 층수 — 벨트 위 반송물도, 카트가 싣는 양도 이 값을 따른다 */
            outputCount: 3,
            /** 벨트 위로 내보내는 간격(m) */
            spawnGap: 3,
          },
        ],
        selected: { kind: 'equip', uid },
      };
    }

    case 'MOVE': {
      return {
        ...state,
        placed: state.placed.map((p) => (p.uid === action.uid ? { ...p, pos: action.pos } : p)),
      };
    }

    case 'ROTATE': {
      return {
        ...state,
        placed: state.placed.map((p) =>
          p.uid === action.uid ? { ...p, rot: (p.rot + (action.dir ?? 1) + 4) % 4 } : p,
        ),
      };
    }

    case 'UPDATE_PLACED':
      return {
        ...state,
        placed: state.placed.map((p) => (p.uid === action.uid ? { ...p, ...action.patch } : p)),
      };

    case 'UPDATE_LINK':
      return {
        ...state,
        links: state.links.map((l) => (l.uid === action.uid ? { ...l, ...action.patch } : l)),
      };

    case 'START_CONNECT':
      return { ...state, connectFrom: action.port };

    case 'CANCEL_CONNECT':
      return { ...state, connectFrom: null };

    case 'ADD_LINK': {
      const uid = `C${state.seq}`;
      const item = state.library.find((i) => i.id === action.itemId);
      const n = state.links.filter((l) => l.itemId === action.itemId).length + 1;
      return {
        ...state,
        seq: state.seq + 1,
        connectFrom: null,
        links: [
          ...state.links,
          {
            uid,
            itemId: action.itemId,
            from: action.from,
            to: action.to,
            radius: state.cornerRadius,
            /** 층 — 기존 레일과 겹치면 씬에서 계산해 넘겨 준다 */
            layer: action.layer ?? 0,
            /** 폭 배율 (1 = 모델 원본 폭) */
            widthScale: 1,
            /** 벨트 속도(m/s). null 이면 전역 기본값을 따른다 */
            speed: null,
            name: `${item?.name ?? action.itemId} #${n}`,
          },
        ],
        selected: { kind: 'link', uid },
      };
    }

    /* ---- 카트 경로 그리기 ---------------------------------------------- */
    case 'PATH_ADD_POINT': {
      if (!state.pathDraft) return state;
      const pts = state.pathDraft.points;
      const last = pts[pts.length - 1];
      // 같은 칸을 두 번 찍는 건 무시한다 (더블클릭으로 마무리하는 흐름과 겹친다)
      if (last && last[0] === action.point[0] && last[1] === action.point[1]) return state;
      return { ...state, pathDraft: { ...state.pathDraft, points: [...pts, action.point] } };
    }

    case 'PATH_UNDO': {
      if (!state.pathDraft?.points.length) return state;
      return { ...state, pathDraft: { ...state.pathDraft, points: state.pathDraft.points.slice(0, -1) } };
    }

    case 'PATH_FINISH': {
      const draft = state.pathDraft;
      if (!draft || draft.points.length < 2) return { ...state, pathDraft: null, tool: TOOL.SELECT };
      const uid = `K${state.seq}`;
      const item = state.library.find((i) => i.id === draft.itemId);
      const n = state.carts.filter((c) => c.itemId === draft.itemId).length + 1;
      return {
        ...state,
        seq: state.seq + 1,
        pathDraft: { itemId: draft.itemId, points: [] }, // 이어서 또 그릴 수 있게
        carts: [
          ...state.carts,
          {
            uid,
            itemId: draft.itemId,
            points: draft.points,
            closed: !!action.closed,
            ...CART_DEFAULTS,
            y: 0,
            name: `${item?.name ?? draft.itemId} #${n}`,
          },
        ],
        selected: { kind: 'cart', uid },
      };
    }

    case 'PATH_CANCEL':
      return { ...state, pathDraft: state.pathDraft ? { ...state.pathDraft, points: [] } : null };

    case 'UPDATE_CART':
      return {
        ...state,
        carts: state.carts.map((c) => (c.uid === action.uid ? { ...c, ...action.patch } : c)),
      };

    case 'DELETE': {
      const { kind, uid } = action;
      if (kind === 'cart') {
        return { ...state, carts: state.carts.filter((c) => c.uid !== uid), selected: null };
      }
      if (kind === 'link') {
        return { ...state, links: state.links.filter((l) => l.uid !== uid), selected: null };
      }
      return {
        ...state,
        placed: state.placed.filter((p) => p.uid !== uid),
        // 설비를 지우면 그 설비에 물린 연결장치도 함께 사라진다
        links: state.links.filter((l) => l.from.uid !== uid && l.to.uid !== uid),
        selected: null,
      };
    }

    case 'SELECT':
      return { ...state, selected: action.selected };

    case 'ADD_LIB_ITEM':
      return { ...state, library: [...state.library, action.item] };

    case 'REMOVE_LIB_ITEM':
      return {
        ...state,
        library: state.library.filter((i) => i.id !== action.id),
        placed: state.placed.filter((p) => p.itemId !== action.id),
        links: state.links.filter((l) => l.itemId !== action.id),
        carts: state.carts.filter((c) => c.itemId !== action.id),
        activeItemId: state.activeItemId === action.id ? null : state.activeItemId,
      };

    case 'LOAD_LAYOUT':
      return {
        ...state,
        placed: action.data.placed ?? [],
        links: action.data.links ?? [],
        carts: action.data.carts ?? [],
        seq: action.data.seq ?? 1,
        selected: null,
        connectFrom: null,
        pathDraft: null,
      };

    case 'CLEAR':
      return { ...state, placed: [], links: [], carts: [], selected: null, connectFrom: null, pathDraft: null };

    default:
      return state;
  }
}

export function EditorProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const booted = useRef(false);

  /* ---- 부팅: 사용자 라이브러리(IDB) → 레이아웃(localStorage) 복원 -------- */
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;

    (async () => {
      const userItems = loadUserLibrary();
      for (const item of userItems) {
        try {
          const buffer = await getModelBuffer(item.id);
          if (!buffer) continue;
          await loadModel(item.modelKey, { buffer });
          dispatch({ type: 'ADD_LIB_ITEM', item });
        } catch (e) {
          console.warn('사용자 모델 복원 실패', item.id, e);
        }
      }
      const layout = loadLayout();
      if (layout) dispatch({ type: 'LOAD_LAYOUT', data: layout });
    })();
  }, []);

  /* ---- 자동 저장 (배치가 바뀔 때마다, 0.6초 디바운스) ------------------- */
  useEffect(() => {
    const t = setTimeout(() => {
      saveLayout(layoutSnapshot(state));
    }, 600);
    return () => clearTimeout(t);
  }, [state.placed, state.links, state.carts, state.seq]);

  useEffect(() => {
    saveUserLibrary(state.library.filter((i) => i.source === 'user'));
  }, [state.library]);

  /* ---- 테마: 루트 속성에 반영 + 기억 -----------------------------------
   *  색 자체는 CSS 변수(index.css)가 갖고 있고, 여기서는 어느 벌을 쓸지만
   *  루트에 표시한다. body 배경까지 한 번에 따라오도록 documentElement 에 건다. */
  useEffect(() => {
    document.documentElement.dataset.theme = state.appearance;
    saveAppearance(state.appearance);
  }, [state.appearance]);

  /* ---- 조회 헬퍼 -------------------------------------------------------- */
  const itemOf = useCallback((id) => state.library.find((i) => i.id === id) ?? null, [state.library]);
  const placedOf = useCallback((uid) => state.placed.find((p) => p.uid === uid) ?? null, [state.placed]);
  const activeItem = useMemo(
    () => state.library.find((i) => i.id === state.activeItemId) ?? null,
    [state.library, state.activeItemId],
  );

  const value = useMemo(
    () => ({ state, dispatch, itemOf, placedOf, activeItem }),
    [state, itemOf, placedOf, activeItem],
  );

  return <EditorCtx.Provider value={value}>{children}</EditorCtx.Provider>;
}

export function useEditor() {
  const ctx = useContext(EditorCtx);
  if (!ctx) throw new Error('useEditor 는 EditorProvider 안에서만 쓸 수 있습니다');
  return ctx;
}
