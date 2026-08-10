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
import { BUILTIN_LIBRARY, CATEGORY, KIND } from '../data/library.js';
import { DEFAULT_BAYS, MAX_BAYS, MIN_BAYS } from './shelf.js';
import {
  PILLAR_DEFAULTS,
  WALL_DEFAULTS,
  ZONE_DEFAULTS,
  clipZoneToAreas,
  mpOverlaps,
  unionMP,
} from './area.js';
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
  /* ---- 작업 영역 ------------------------------------------------------
   *  영역·구역은 "면" 이라 끌어서(또는 펜으로) 그리고, 벽·기둥은 "선/점" 이라
   *  두 번 찍기·한 번 찍기로 놓는다. 그리는 방식이 달라서 도구를 나눈다. */
  AREA: 'area',
  WALL: 'wall',
  PILLAR: 'pillar',
  ZONE: 'zone',
};

/** 면을 그리는 방식 — 사각형 드래그 / 펜(점 찍기) */
export const SHAPE = { RECT: 'rect', PEN: 'pen' };

export const VIEW = { TOP: 'top', ISO: 'iso' };

/** 영역·구역·벽·기둥을 그리는 도구인가 */
export const isBuildTool = (t) => t === TOOL.AREA || t === TOOL.WALL || t === TOOL.PILLAR || t === TOOL.ZONE;

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
  /* 건물 — 바닥 영역 · 내벽 · 기둥 · 구역 */
  areas: [],
  walls: [],
  pillars: [],
  zones: [],
  seq: 1,

  tool: TOOL.SELECT,
  activeItemId: null,
  ghostRot: 0,
  cornerRadius: 1.0,

  /** 벨트 UV 애니메이션 구동 여부 · 기본 속도(m/s) */
  running: true,
  beltSpeed: 0.6,

  /** 선반을 놓을 때의 길이(칸 수). 배치 중 [ ] 로 바꾼다 */
  shelfBays: DEFAULT_BAYS,

  /** 면을 사각형으로 끌지, 펜으로 찍을지 (영역·구역 공통) */
  drawShape: SHAPE.RECT,

  /**
   * 건물을 새로 놓을 때 쓸 기본 규격.
   *  놓고 나서 인스펙터에서 고칠 수도 있지만, 같은 두께의 벽을 여러 장 세우는
   *  일이 훨씬 많다. 미리 정해 두고 계속 찍는 쪽이 손이 덜 간다.
   */
  build: {
    wallThickness: WALL_DEFAULTS.thickness,
    wallHeight: WALL_DEFAULTS.height,
    wallColor: WALL_DEFAULTS.color,
    pillarW: PILLAR_DEFAULTS.size[0],
    pillarD: PILLAR_DEFAULTS.size[1],
    pillarHeight: PILLAR_DEFAULTS.height,
    pillarColor: PILLAR_DEFAULTS.color,
  },

  /** 구역을 화면에서 감출지 (구역 레이어 패널에서 끈다) */
  showZones: true,

  selected: null,       // { kind:'equip'|'link'|'cart'|'area'|'wall'|'pillar'|'zone', uid, edge? }
  connectFrom: null,    // 포트 참조 { uid, portId }
  pathDraft: null,      // 카트 경로를 그리는 중 { itemId, points:[[x,z],…] }
  polyDraft: null,      // 펜으로 면을 그리는 중 { kind:'area'|'zone', points:[[x,z],…] }
  wallDraft: null,      // 내벽 첫 점을 찍은 상태 [x, z]
  hint: null,
};

/** 카트 경로를 처음 그릴 때의 기본값 */
const CART_DEFAULTS = { speed: 1.4, radius: 1.2, dwell: 1.2, reverse: false, count: 1 };

function reducer(state, action) {
  switch (action.type) {
    case 'SET':
      return { ...state, ...action.patch };

    /** 앞으로 놓을 벽·기둥·바닥의 기본 규격 */
    case 'SET_BUILD':
      return { ...state, build: { ...state.build, ...action.patch } };

    case 'SET_TOOL':
      return {
        ...state,
        tool: action.tool,
        activeItemId: action.itemId ?? (action.tool === TOOL.PLACE || action.tool === TOOL.CONNECT ? state.activeItemId : null),
        connectFrom: null,
        /* 그리던 것은 도구를 바꾸는 순간 버린다 — 반쯤 그린 도형이 다음 도구의
           클릭을 먹어 버리면 무엇이 그려질지 예측할 수 없다 */
        polyDraft: null,
        wallDraft: null,
        /* 건물 도구는 탑뷰에서만 그린다 (배치와 같은 이유) */
        view: isBuildTool(action.tool) ? VIEW.TOP : state.view,
        selected: action.tool === TOOL.SELECT ? state.selected : null,
      };

    case 'PICK_ITEM': {
      const item = state.library.find((i) => i.id === action.itemId);
      if (!item) return state;
      /* 운송/적재 탭은 카트와 선반이 섞여 있다. 카트는 경로를 그리고
         선반은 자리를 찍으므로 도구가 다르다 — 항목의 kind 로 가른다. */
      const toolFor =
        item.category === CATEGORY.CONNECTOR ? TOOL.CONNECT
          : item.kind === KIND.CART ? TOOL.PATH
            : TOOL.PLACE;
      return {
        ...state,
        activeItemId: item.id,
        tool: toolFor,
        pathDraft: item.kind === KIND.CART ? { itemId: item.id, points: [] } : null,
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

    case 'SHELF_BAYS':
      return {
        ...state,
        shelfBays: Math.max(MIN_BAYS, Math.min(MAX_BAYS, state.shelfBays + action.delta)),
      };

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
            /** 선반이면 길이(칸 수)가 함께 들어온다 */
            ...(action.extra ?? {}),
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
      const { kind } = action;
      /* 여러 개를 골라 둔 상태의 삭제. 하나씩 dispatch 해도 되지만 그러면
         중간 상태마다 선택이 풀렸다 다시 잡히는 것이 저장에 그대로 남는다. */
      const many = action.uids ?? (action.uid ? [action.uid] : []);
      if (many.length > 1) {
        const gone = new Set(many);
        if (kind === 'pillar') {
          return { ...state, pillars: state.pillars.filter((p) => !gone.has(p.uid)), selected: null };
        }
        if (kind === 'equip') {
          return {
            ...state,
            placed: state.placed.filter((p) => !gone.has(p.uid)),
            links: state.links.filter((l) => !gone.has(l.from.uid) && !gone.has(l.to.uid)),
            selected: null,
          };
        }
      }
      const uid = action.uid ?? many[0];
      if (kind === 'area') {
        /* 영역이 사라지면 그 위의 구역도 갈 곳이 없다 — 남은 바닥에 맞춰 다시
           자르고, 아무 데도 안 걸리면 함께 지운다. */
        const areas = state.areas.filter((a) => a.uid !== uid);
        const zones = state.zones
          .map((z) => ({ ...z, mp: clipZoneToAreas(z.mp, areas) }))
          .filter((z) => z.mp);
        return { ...state, areas, zones, selected: null };
      }
      if (kind === 'wall') return { ...state, walls: state.walls.filter((w) => w.uid !== uid), selected: null };
      if (kind === 'pillar') return { ...state, pillars: state.pillars.filter((p) => p.uid !== uid), selected: null };
      if (kind === 'zone') return { ...state, zones: state.zones.filter((z) => z.uid !== uid), selected: null };
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

    /* ---- 작업 영역 ------------------------------------------------------ */

    /**
     * 영역 추가.
     *  이미 있는 영역과 닿거나 겹치면 **새로 만들지 않고 합친다**. 겹친 사각형을
     *  따로 두면 안쪽에 벽이 남아 도면이 상자 더미가 되기 때문이다.
     *  합쳐질 때는 먼저 있던 영역의 이름과 설정(두께·높이·색)을 이어받는다 —
     *  나중에 그린 조각이 앞선 작업장의 정체성을 덮어쓰면 곤란하다.
     */
    case 'ADD_AREA': {
      const mp = action.mp;
      if (!mp?.length) return state;

      const hits = state.areas.filter((a) => mpOverlaps(a.mp, mp));
      if (!hits.length) {
        const uid = `A${state.seq}`;
        const b = state.build;
        return {
          ...state,
          seq: state.seq + 1,
          areas: [
            ...state.areas,
            {
              uid,
              name: `영역 ${state.areas.length + 1}`,
              mp,
              edges: {},
              thickness: b.wallThickness,
              height: b.wallHeight,
              color: b.wallColor,
            },
          ],
          selected: { kind: 'area', uid },
        };
      }
      const base = hits[0];
      const merged = unionMP(...hits.map((a) => a.mp), mp);
      const keep = new Set(hits.slice(1).map((a) => a.uid));
      return {
        ...state,
        areas: state.areas
          .filter((a) => !keep.has(a.uid))
          .map((a) => (a.uid === base.uid ? { ...a, mp: merged } : a)),
        selected: { kind: 'area', uid: base.uid },
      };
    }

    case 'UPDATE_AREA':
      return {
        ...state,
        areas: state.areas.map((a) => (a.uid === action.uid ? { ...a, ...action.patch } : a)),
      };

    /** 한 면(변)만 덮어쓴다 — 나머지 면은 영역 기본값을 계속 따른다.
     *  patch 가 null 이면 덮어쓰기를 걷어 내 다시 영역 기본값을 따르게 한다. */
    case 'UPDATE_AREA_EDGE':
      return {
        ...state,
        areas: state.areas.map((a) => {
          if (a.uid !== action.uid) return a;
          const edges = { ...a.edges };
          if (action.patch === null) delete edges[action.edge];
          else edges[action.edge] = { ...(edges[action.edge] ?? {}), ...action.patch };
          return { ...a, edges };
        }),
      };

    case 'ADD_WALL': {
      const uid = `W${state.seq}`;
      const b = state.build;
      return {
        ...state,
        seq: state.seq + 1,
        walls: [
          ...state.walls,
          {
            uid,
            a: action.a,
            b: action.b,
            name: `내벽 ${state.walls.length + 1}`,
            thickness: b.wallThickness,
            height: b.wallHeight,
            color: b.wallColor,
          },
        ],
        wallDraft: null,
        selected: { kind: 'wall', uid },
      };
    }

    case 'UPDATE_WALL':
      return {
        ...state,
        walls: state.walls.map((w) => (w.uid === action.uid ? { ...w, ...action.patch } : w)),
      };

    case 'WALL_START':
      return { ...state, wallDraft: action.point };

    case 'ADD_PILLAR': {
      const uid = `P${state.seq}`;
      const b = state.build;
      return {
        ...state,
        seq: state.seq + 1,
        pillars: [
          ...state.pillars,
          {
            uid,
            pos: action.pos,
            name: `기둥 ${state.pillars.length + 1}`,
            size: [b.pillarW, b.pillarD],
            height: b.pillarHeight,
            color: b.pillarColor,
          },
        ],
        selected: { kind: 'pillar', uid },
      };
    }

    case 'UPDATE_PILLAR':
      return {
        ...state,
        pillars: state.pillars.map((p) => (p.uid === action.uid ? { ...p, ...action.patch } : p)),
      };

    /** 구역은 바닥 위에만 남는다 — 자르고 남는 게 없으면 아무 일도 하지 않는다 */
    case 'ADD_ZONE': {
      const mp = clipZoneToAreas(action.mp, state.areas);
      if (!mp) return { ...state, hint: '구역은 영역(바닥) 위에만 그릴 수 있습니다' };
      const uid = `Z${state.seq}`;
      return {
        ...state,
        seq: state.seq + 1,
        hint: null,
        zones: [...state.zones, { uid, name: `구역 ${state.zones.length + 1}`, mp, ...ZONE_DEFAULTS }],
        selected: { kind: 'zone', uid },
      };
    }

    case 'UPDATE_ZONE':
      return {
        ...state,
        zones: state.zones.map((z) => (z.uid === action.uid ? { ...z, ...action.patch } : z)),
      };

    /* ---- 펜으로 면 그리기 ------------------------------------------------ */
    case 'POLY_START':
      return { ...state, polyDraft: { kind: action.kind, points: [] } };

    case 'POLY_ADD_POINT': {
      const d = state.polyDraft;
      if (!d) return state;
      const last = d.points[d.points.length - 1];
      if (last && last[0] === action.point[0] && last[1] === action.point[1]) return state;
      return { ...state, polyDraft: { ...d, points: [...d.points, action.point] } };
    }

    case 'POLY_UNDO':
      return state.polyDraft?.points.length
        ? { ...state, polyDraft: { ...state.polyDraft, points: state.polyDraft.points.slice(0, -1) } }
        : state;

    case 'POLY_CANCEL':
      return { ...state, polyDraft: state.polyDraft ? { ...state.polyDraft, points: [] } : null, wallDraft: null };

    case 'SELECT':
      return { ...state, selected: action.selected };

    /* ---- 여러 개 고르기 --------------------------------------------------
     *  selected 는 계속 하나의 객체지만 uids 를 함께 들고 다닌다.
     *    uid  — 마지막에 누른 것(기준). 인스펙터가 상세를 보여 주는 대상.
     *    uids — 실제로 골라진 전부.
     *  이렇게 두면 uid 만 보던 기존 코드가 그대로 동작하고, 여러 개를 아는
     *  곳(케이지 · 정렬)만 uids 를 읽으면 된다.
     *
     *  **같은 종류끼리만 묶인다.** 설비와 기둥은 크기의 근거도(모델 vs 설정값),
     *  옮길 때의 제약도(바닥·간섭) 달라서, 섞어 놓으면 정렬이 무엇을 기준으로
     *  하는지 말할 수 없게 된다.
     */
    case 'SELECT_TOGGLE': {
      const { kind, uid } = action;
      const cur = state.selected;
      if (!cur || cur.kind !== kind) return { ...state, selected: { kind, uid, uids: [uid] } };
      const uids = cur.uids ?? [cur.uid];
      const next = uids.includes(uid) ? uids.filter((u) => u !== uid) : [...uids, uid];
      if (!next.length) return { ...state, selected: null };
      return { ...state, selected: { kind, uid: next[next.length - 1], uids: next } };
    }

    case 'SELECT_MANY': {
      const uids = action.uids ?? [];
      if (!uids.length) return { ...state, selected: null };
      return { ...state, selected: { kind: action.kind, uid: uids[uids.length - 1], uids } };
    }

    /** 여러 개를 한 번에 옮긴다 (묶어 끌기 · 정렬) */
    case 'MOVE_MANY': {
      const at = new Map(action.moves.map((m) => [m.uid, m.pos]));
      if (action.kind === 'pillar') {
        return {
          ...state,
          pillars: state.pillars.map((p) => (at.has(p.uid) ? { ...p, pos: at.get(p.uid) } : p)),
        };
      }
      return {
        ...state,
        placed: state.placed.map((p) => (at.has(p.uid) ? { ...p, pos: at.get(p.uid) } : p)),
      };
    }

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
        areas: action.data.areas ?? [],
        walls: action.data.walls ?? [],
        pillars: action.data.pillars ?? [],
        zones: action.data.zones ?? [],
        seq: action.data.seq ?? 1,
        selected: null,
        connectFrom: null,
        pathDraft: null,
        polyDraft: null,
        wallDraft: null,
      };

    case 'CLEAR':
      return {
        ...state,
        placed: [], links: [], carts: [],
        areas: [], walls: [], pillars: [], zones: [],
        selected: null, connectFrom: null, pathDraft: null, polyDraft: null, wallDraft: null,
      };

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
  }, [state.placed, state.links, state.carts, state.areas, state.walls, state.pillars, state.zones, state.seq]);

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
