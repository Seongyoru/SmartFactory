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
import { DEFAULT_GRID, clean } from './grid.js';
import { BUILTIN_LIBRARY, CATEGORY, KIND, defaultOutOf } from '../data/library.js';
import { DEFAULT_BAYS, MAX_BAYS, MIN_BAYS } from './shelf.js';
import {
  OPENING_DEFAULTS,
  PILLAR_DEFAULTS,
  WALL_DEFAULTS,
  ZONE_DEFAULTS,
  clipZoneToAreas,
  floorOf,
  insertVertex,
  moveVertex,
  mpOverlaps,
  normalizeMP,
  remapEdgeSpecs,
  removeVertex,
  unionMP,
} from './area.js';
import { loadModel } from './modelStore.js';
import {
  getModelBuffer,
  layoutSnapshot,
  loadAppearance,
  loadGuidePhase,
  loadScenarios,
  loadLayout,
  loadUserLibrary,
  saveAppearance,
  saveGuidePhase,
  saveScenarios,
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
  /** 복사한 것을 손에 들고 놓을 자리를 고르는 중 */
  PASTE: 'paste',
  /* ---- 작업 영역 ------------------------------------------------------
   *  영역·구역은 "면" 이라 끌어서(또는 펜으로) 그리고, 벽·기둥은 "선/점" 이라
   *  두 번 찍기·한 번 찍기로 놓는다. 그리는 방식이 달라서 도구를 나눈다. */
  AREA: 'area',
  WALL: 'wall',
  PILLAR: 'pillar',
  ZONE: 'zone',
  OPENING: 'opening',
};

/** 면을 그리는 방식 — 사각형 드래그 / 펜(점 찍기) */
export const SHAPE = { RECT: 'rect', PEN: 'pen' };

export const VIEW = { TOP: 'top', ISO: 'iso' };

/* ==========================================================================
 * 선택
 * ==========================================================================
 *  고른 것들은 **종류가 섞일 수 있다** — 탑뷰에서 사각형을 끌면 그 안의 설비도
 *  기둥도 벽도 함께 잡히는 것이 자연스럽기 때문이다(바닥과 구역은 화면 전체를
 *  덮는 배경이라 뺀다). 그래서 목록으로 들고 다닌다.
 *
 *      selected = { kind, uid, edge?, items:[{kind, uid, edge?}, …] }
 *
 *    kind · uid — **마지막에 누른 것**. 하나만 골랐을 때 인스펙터가 보여 줄 대상.
 *    items      — 골라진 전부. 하나만 골라도 길이 1 이다.
 *
 *  앞의 두 값을 남겨 둔 이유는 개별 상세 패널(설비·연결·카트…)이 전부 그것만
 *  보고 있기 때문이다. 여러 개를 아는 곳만 items 를 읽으면 된다.
 *
 *  영역의 벽면은 uid 하나로 가릴 수 없어서(한 영역에 면이 여럿) edge 를 함께
 *  본다. 같은 것인지 비교할 때도 둘을 같이 본다.
 * ======================================================================== */

export const selItems = (sel) =>
  sel?.items ?? (sel?.uid ? [{ kind: sel.kind, uid: sel.uid, edge: sel.edge }] : []);

export const sameItem = (a, b) => a.kind === b.kind && a.uid === b.uid && (a.edge ?? null) === (b.edge ?? null);

/** 그 종류의 uid 만 뽑는다 (케이지 표시·정렬처럼 한 종류만 다루는 곳에서) */
export const selUidsOf = (sel, kind) =>
  selItems(sel).filter((i) => i.kind === kind).map((i) => i.uid);

/** 목록 → selected. 마지막 항목이 기준이 된다. 비면 null. */
function normalizeSel(input) {
  if (!input) return null;
  const items = Array.isArray(input) ? input : selItems(input);
  if (!items.length) return null;
  const last = items[items.length - 1];
  return { kind: last.kind, uid: last.uid, edge: last.edge, items };
}

/** 영역·구역·벽·기둥을 그리는 도구인가 */
export const isBuildTool = (t) =>
  t === TOOL.AREA || t === TOOL.WALL || t === TOOL.PILLAR || t === TOOL.ZONE || t === TOOL.OPENING;

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
  /** 벽에 뚫은 개구부 — 어느 벽인지는 좌표로 찾는다 (area.js) */
  openings: [],
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
    openingWidth: OPENING_DEFAULTS.width,
    openingHeight: OPENING_DEFAULTS.height,
    openingSill: OPENING_DEFAULTS.sill,
  },

  /** 구역을 화면에서 감출지 (구역 레이어 패널에서 끈다) */
  showZones: true,

  /** 3D 에서 앞 벽을 감출지(돌하우스). 끄면 벽이 전부 서 있는 모습을 본다 */
  dollhouse: true,

  /**
   * 꼭짓점을 고치는 중인 도형 — { kind:'area'|'zone', uid } 또는 null.
   * -------------------------------------------------------------------------
   *  고르기만 하면 손잡이가 나오게 두었더니, 바닥을 한 번 누를 때마다 꼭짓점이
   *  우수수 뜨고 그 손잡이가 벽 클릭과 자리를 다퉜다. **고치겠다고 말할 때만**
   *  손잡이를 낸다. 편집 중에는 건물이 클릭을 받지 않으므로(EditorScene 의 pick)
   *  옆의 벽을 잘못 눌러 편집이 끝나 버리는 일도 없다.
   *
   *  도면이 아니라 "지금 무엇을 하는 중인가" 라서 되돌리기·저장에는 넣지 않는다.
   */
  editShape: null,

  /**
   * 따라 하기 안내 — null(닫힘) · 'welcome'(환영 창) · 'steps'(체크리스트).
   * -------------------------------------------------------------------------
   *  이 편집기는 **바닥을 먼저 그려야** 설비를 놓을 수 있다. 처음 여는 사람이
   *  기계부터 고르면 아무 데도 놓이지 않는데, 화면만 봐서는 왜 안 되는지 알
   *  길이 없다 — 순서를 먼저 알려 주는 편이 안내문 열 줄보다 낫다.
   *
   *  도면이 아니라 지금 무엇을 하는 중인가라서 되돌리기·저장에는 넣지 않는다.
   *  어디까지 왔는지만 이 브라우저에 남긴다(persistence 의 loadGuidePhase).
   */
  guide: loadGuidePhase(),

  /**
   * 견주려고 모아 둔 배치들 — [{ uid, name, at, layout, run }].
   * -------------------------------------------------------------------------
   *  지금 도면은 작업 중인 한 벌이고, 이건 비교하려고 쌓아 둔 여러 벌이다.
   *  도면이 아니므로 되돌리기 대상이 아니고, 초기화해도 남는다(따로 저장한다).
   */
  scenarios: loadScenarios(),
  /** 시나리오 창이 열려 있는가 */
  showScenarios: false,

  selected: null,       // { kind:'equip'|'link'|'cart'|'area'|'wall'|'pillar'|'zone', uid, edge? }
  connectFrom: null,    // 포트 참조 { uid, portId }
  pathDraft: null,      // 카트 경로를 그리는 중 { itemId, points:[[x,z],…] }
  polyDraft: null,      // 펜으로 면을 그리는 중 { kind:'area'|'zone', points:[[x,z],…] }
  wallDraft: null,      // 내벽 첫 점을 찍은 상태 [x, z]
  hint: null,

  /** 복사해 둔 것 — 붙여넣기 전까지 들고 있는다 (도면이 아니라 작업 중 상태) */
  clipboard: null,

  /** 되돌리기 기록 — 도면 스냅샷만 담는다 (아래 withHistory 참고) */
  past: [],
  future: [],
};

/** 카트 경로를 처음 그릴 때의 기본값 */
const CART_DEFAULTS = { speed: 1.4, radius: 1.2, dwell: 1.2, reverse: false, count: 1 };

const sameShape = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * 목록에서 한 항목만 갈아 끼운다 — 실제로 바뀐 것이 없으면 **같은 배열**을 준다.
 *  되돌리기와 자동 저장이 "도면이 바뀌었는가" 를 참조 비교 하나로 보기 때문에
 *  (withHistory 의 sameDoc), 값이 같은데 배열만 새로 만들면 아무 일도 없었던
 *  조작이 기록에 한 칸씩 쌓인다.
 */
function replaceIn(list, uid, patch) {
  let changed = false;
  const out = list.map((x) => {
    if (x.uid !== uid) return x;
    if (Object.keys(patch).every((k) => x[k] === patch[k])) return x;
    changed = true;
    return { ...x, ...patch };
  });
  return changed ? out : list;
}

/**
 * 영역·구역 한 장을 갈아 끼운다 (꼭짓점 편집의 착지점).
 * ---------------------------------------------------------------------------
 *  settle 이 켜지면 **바닥이 바뀐 결과를 구역에 반영한다.** 구역은 바닥 위에만
 *  있을 수 있으므로(clipZoneToAreas) 바닥이 줄면 따라 줄고, 남는 게 없으면
 *  사라진다.
 *
 *  ── 끄는 중에는 켜지 않는다 ───────────────────────────────────────────────
 *  자르기는 되돌릴 수 없다. 프레임마다 걸면 벽을 안으로 밀었다가 도로 빼도
 *  구역은 잘린 채로 남는다 — 한 번의 조작 안에서 되돌아온 것은 없던 일이어야
 *  하므로, 손을 뗄 때만 자른다.
 */
function shapePatched(state, kind, uid, patch, settle) {
  if (kind === 'zone') {
    let mp = patch.mp;
    if (settle) {
      /* 잘라서 남는 게 없으면 편집 자체를 무른다 — 구역이 사라지는 것보다
         "그 자리로는 못 간다" 가 낫다 */
      const cut = clipZoneToAreas(mp, state.areas);
      if (!cut) return state;
      if (!sameShape(cut, mp)) mp = cut;
    }
    const zones = replaceIn(state.zones, uid, { ...patch, mp });
    return zones === state.zones ? state : { ...state, zones };
  }

  const areas = replaceIn(state.areas, uid, patch);
  if (!settle) return areas === state.areas ? state : { ...state, areas };

  const cut = state.zones
    .map((z) => {
      const c = clipZoneToAreas(z.mp, areas);
      if (!c) return null;
      return sameShape(c, z.mp) ? z : { ...z, mp: c };
    })
    .filter(Boolean);
  const zones = cut.length === state.zones.length && cut.every((z, i) => z === state.zones[i])
    ? state.zones
    : cut;
  return areas === state.areas && zones === state.zones ? state : { ...state, areas, zones };
}

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
          : item.kind === KIND.CART || item.kind === KIND.TRUCK ? TOOL.PATH
            : TOOL.PLACE;
      return {
        ...state,
        activeItemId: item.id,
        tool: toolFor,
        pathDraft: item.kind === KIND.CART || item.kind === KIND.TRUCK ? { itemId: item.id, points: [] } : null,
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
      /**
       * 무엇을 만드는지는 **놓는 순간 도면에 적힌다.**
       * -----------------------------------------------------------------------
       *  라이브러리를 그릴 때마다 되묻지 않는다. 되물으면 같은 기계를 놓은 두
       *  자리가 영영 같은 것만 만들게 되고, 무엇을 만드는지가 도면이 아니라
       *  카탈로그에 적혀 있게 된다 — 인스펙터에서 바꿔도 카탈로그가 이긴다.
       *  여기서 한 번 복사하고 나면 그 뒤로는 아무도 라이브러리를 안 본다.
       *  (재료는 비워 둔다 = 원자재 공급원. 조립은 사용자가 정한다)
       */
      const out = defaultOutOf(item);
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
            ...(out ? { recipe: { in: [], out } } : null),
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
      /**
       * 여러 개를 골라 둔 상태의 삭제.
       * -----------------------------------------------------------------------
       *  **종류마다 따로 쓰지 않는다.** 예전에는 설비와 기둥만 여러 개 지우는
       *  분기가 있었고, 벽·구역·개구부·연결·차량은 조용히 단일 삭제 경로로
       *  흘러가 마지막 하나만 지워졌다. 목록이 어디에 있는지만 다르므로
       *  "어느 목록에서 지울 것인가" 하나만 정하고 나머지는 공통으로 둔다.
       */
      const many = action.uids?.length ? action.uids : action.uid ? [action.uid] : [];
      if (!many.length) return state;
      const gone = new Set(many);
      const drop = (list) => list.filter((x) => !gone.has(x.uid));

      if (kind === 'equip') {
        return {
          ...state,
          placed: drop(state.placed),
          // 설비를 지우면 그 설비에 물린 연결장치도 함께 사라진다
          links: state.links.filter((l) => !gone.has(l.from.uid) && !gone.has(l.to.uid)),
          selected: null,
        };
      }
      if (kind === 'wall') return { ...state, walls: drop(state.walls), selected: null };
      if (kind === 'pillar') return { ...state, pillars: drop(state.pillars), selected: null };
      if (kind === 'zone') return { ...state, zones: drop(state.zones), selected: null };
      if (kind === 'opening') return { ...state, openings: drop(state.openings), selected: null };
      if (kind === 'cart') return { ...state, carts: drop(state.carts), selected: null };
      if (kind === 'link') return { ...state, links: drop(state.links), selected: null };

      if (kind === 'area') {
        /* 영역이 사라지면 그 위의 구역도 갈 곳이 없다 — 남은 바닥에 맞춰 다시
           자르고, 아무 데도 안 걸리면 함께 지운다. */
        const areas = drop(state.areas);
        const zones = state.zones
          .map((z) => ({ ...z, mp: clipZoneToAreas(z.mp, areas) }))
          .filter((z) => z.mp);
        /* 벽이 사라지면 그 벽에 뚫은 개구부도 갈 곳이 없다 */
        const kept = floorOf(areas);
        const openings = kept ? state.openings : [];
        return { ...state, areas, zones, openings, selected: null };
      }
      return state;
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

    /* ---- 꼭짓점 편집 (영역·구역 공통) -------------------------------------
     *  그린 뒤에 모양을 고치는 유일한 길이다. 씬이 "어느 점을 어디로" 만 넘기고,
     *  실제 계산은 area.js 가 한다 — 같은 함수를 씬도 미리 불러 보고(놓을 수 있는
     *  자리인지 판정) 여기서 다시 부르므로, 판정과 결과가 어긋날 수 없다.
     *
     *  ── 지우기만 그 자리에서 정리한다 ─────────────────────────────────────
     *  옮기기·끼우기는 **끄는 중**이라 정리(union)를 걸면 잡고 있던 점이 손에서
     *  빠져나간다. 손을 뗄 때 SHAPE_COMMIT 이 한 번 정리한다. Alt+클릭 지우기는
     *  한 번으로 끝나는 조작이라 여기서 바로 정리해도 손에 걸리는 것이 없다. */
    case 'SHAPE_VERTEX': {
      const { kind, uid, addr, op, pt } = action;
      const list = kind === 'zone' ? state.zones : state.areas;
      const target = list.find((x) => x.uid === uid);
      if (!target) return state;

      const edited =
        op === 'insert' ? insertVertex(target.mp, addr, pt)
          : op === 'remove' ? removeVertex(target.mp, addr)
            : moveVertex(target.mp, addr, pt);
      if (!edited) return state;                    // 옆 점과 겹침·삼각형 미만

      const patch = { mp: op === 'remove' ? normalizeMP(edited) ?? edited : edited };
      if (kind === 'area') {
        patch.edges = remapEdgeSpecs(
          target.edges,
          target.mp[addr.poly]?.[addr.ring],
          edited[addr.poly]?.[addr.ring],
          op,
          addr.i,
        );
      }
      return shapePatched(state, kind, uid, patch, op === 'remove');
    }

    /** 끌기가 끝났다 — 여기서 한 번 정리한다 (접힌 고리 풀기 · 구역 다시 자르기) */
    case 'SHAPE_COMMIT': {
      const { kind, uid } = action;
      const list = kind === 'zone' ? state.zones : state.areas;
      const target = list.find((x) => x.uid === uid);
      if (!target) return state;
      const mp = normalizeMP(target.mp);
      if (!mp) return state;
      /* 정리해도 모양이 같으면 **원래 배열을 그대로 쓴다.** 여기서 통째로
         돌아가 버리면 안 된다 — 도형이 안 변했어도 끄는 동안 미뤄 둔 구역
         반영은 아직 남아 있다. 아무것도 안 바뀐 경우는 shapePatched 가
         같은 state 를 돌려주는 것으로 걸러진다. */
      return shapePatched(state, kind, uid, { mp: sameShape(mp, target.mp) ? target.mp : mp }, true);
    }

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

    /* ---- 개구부 ---------------------------------------------------------
     *  벽 위의 한 점만 기억한다. 어느 벽인지는 그릴 때 좌표로 찾으므로,
     *  영역 모양이 바뀌어 변이 다시 만들어져도 그대로 따라온다. */
    case 'ADD_OPENING': {
      const uid = `O${state.seq}`;
      const b = state.build;
      return {
        ...state,
        seq: state.seq + 1,
        hint: null,
        openings: [
          ...state.openings,
          {
            uid,
            name: `개구부 ${state.openings.length + 1}`,
            at: action.at,
            width: b.openingWidth,
            height: b.openingHeight,
            sill: b.openingSill,
          },
        ],
        selected: { kind: 'opening', uid },
      };
    }

    case 'UPDATE_OPENING':
      return {
        ...state,
        openings: state.openings.map((o) => (o.uid === action.uid ? { ...o, ...action.patch } : o)),
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

    /* ==========================================================================
     * 복사 · 붙여넣기
     * ==========================================================================
     *  **한 종류만** 복사한다. 설비와 기둥은 만들어지는 곳(placed vs pillars)도,
     *  놓을 수 있는지 판정하는 근거(모델 바운딩 박스 vs 설정값)도 달라서, 섞어
     *  붙이면 "무엇이 어디에 놓였는가" 를 한 번에 말할 수 없다. 벽·카트처럼
     *  자리가 아니라 **선/경로**로 정의되는 것도 복사 대상에서 뺀다 — 붙여넣을
     *  자리가 점 하나로 정해지지 않는다.
     *
     *  붙여넣기는 곧바로 만들지 않고 **손에 든 상태**로 넘어간다. 어디에 놓일지
     *  보고 정하는 편이, 원본 옆 어딘가에 생긴 것을 다시 끌어 옮기는 것보다 낫다.
     * ======================================================================== */
    case 'COPY': {
      const items = selItems(state.selected);
      if (!items.length) return state;
      const kinds = new Set(items.map((i) => i.kind));
      if (kinds.size > 1) return { ...state, hint: '한 종류만 복사할 수 있습니다' };

      const kind = items[0].kind;
      if (kind !== 'equip' && kind !== 'pillar') {
        return { ...state, hint: '설비·선반·기둥만 복사할 수 있습니다' };
      }
      const src = kind === 'pillar' ? state.pillars : state.placed;
      const picked = items.map((i) => src.find((x) => x.uid === i.uid)).filter(Boolean);
      if (!picked.length) return state;

      /* 첫 항목을 기준점으로 삼고 나머지는 상대 위치로 기억한다 —
         묶음을 붙여넣어도 서로의 간격이 그대로 유지되어야 한다. */
      const [ox, oz] = picked[0].pos;
      return {
        ...state,
        clipboard: {
          kind,
          items: picked.map((p) => ({ ...p, dx: p.pos[0] - ox, dz: p.pos[1] - oz })),
        },
        hint: `${picked.length}개 복사됨 — Ctrl+V 로 붙여넣기`,
      };
    }

    case 'PASTE_AT': {
      const cb = state.clipboard;
      if (!cb?.items?.length) return state;
      let seq = state.seq;
      const made = cb.items.map((it) => {
        const { dx, dz, uid: _drop, ...rest } = it;
        return {
          ...rest,
          uid: `${cb.kind === 'pillar' ? 'P' : 'E'}${seq++}`,
          pos: [clean(action.pos[0] + dx), clean(action.pos[1] + dz)],
          name: `${rest.name ?? ''} 사본`.trim(),
        };
      });
      const sel = made.map((m) => ({ kind: cb.kind === 'pillar' ? 'pillar' : 'equip', uid: m.uid }));
      return {
        ...state,
        seq,
        placed: cb.kind === 'pillar' ? state.placed : [...state.placed, ...made],
        pillars: cb.kind === 'pillar' ? [...state.pillars, ...made] : state.pillars,
        selected: normalizeSel(sel),
      };
    }

    /* ---- 시나리오 -------------------------------------------------------
     *  도면 한 벌과 그 도면으로 돌린 성적표의 짝. 도면이 아니므로 되돌리기에
     *  들어가지 않는다(DOC_KEYS 밖). 저장은 EditorProvider 의 효과가 맡는다. */
    case 'SCENARIO_ADD': {
      const uid = `S${state.seq}`;
      return {
        ...state,
        seq: state.seq + 1,
        scenarios: [
          ...state.scenarios,
          {
            uid,
            name: action.name?.trim() || `배치 ${state.scenarios.length + 1}`,
            at: Date.now(),
            layout: layoutSnapshot(state),
            run: action.run ?? null,
          },
        ],
      };
    }

    /** 지금 돌린 성적을 그 시나리오에 박제한다 (도면도 지금 것으로 갱신) */
    case 'SCENARIO_RECORD':
      return {
        ...state,
        scenarios: state.scenarios.map((s) =>
          (s.uid === action.uid ? { ...s, layout: layoutSnapshot(state), run: action.run, at: Date.now() } : s)),
      };

    case 'SCENARIO_RENAME':
      return {
        ...state,
        scenarios: state.scenarios.map((s) => (s.uid === action.uid ? { ...s, name: action.name } : s)),
      };

    case 'SCENARIO_DELETE':
      return { ...state, scenarios: state.scenarios.filter((s) => s.uid !== action.uid) };

    /** 꼭짓점 편집 시작·끝 (target 이 null 이면 끝) */
    case 'EDIT_SHAPE':
      return { ...state, editShape: action.target ?? null };

    case 'SELECT':
      return { ...state, selected: normalizeSel(action.selected) };

    case 'SELECT_FILTER': {
      /* 목록에서 그룹 이름을 눌렀을 때 — 그 종류만 남긴다.
         섞어 고른 뒤 "설비만" 으로 좁히는 것이 목록을 다시 훑는 것보다 빠르다. */
      const items = selItems(state.selected).filter((i) => i.kind === action.kind);
      if (!items.length) return state;
      return { ...state, selected: normalizeSel(items) };
    }

    /** Ctrl+클릭 — 종류를 가리지 않고 더하고 뺀다 */
    case 'SELECT_TOGGLE': {
      const one = { kind: action.kind, uid: action.uid, edge: action.edge };
      const cur = selItems(state.selected);
      const has = cur.some((i) => sameItem(i, one));
      const next = has ? cur.filter((i) => !sameItem(i, one)) : [...cur, one];
      return { ...state, selected: normalizeSel(next) };
    }

    case 'SELECT_MANY': {
      /* 예전 형태({ kind, uids })도 받는다 — 부르는 곳이 여러 군데다 */
      const items = action.items ?? (action.uids ?? []).map((uid) => ({ kind: action.kind, uid }));
      return { ...state, selected: normalizeSel(items) };
    }

    /**
     * 골라 둔 벽·기둥의 규격을 한꺼번에 맞춘다.
     * -----------------------------------------------------------------------
     *  두께가 제각각인 벽 여러 장을 골라 두께를 바꾸면 **전부 같은 값**이 된다.
     *  "각자 비율대로" 가 아니라 "같게" 인 이유는, 이 기능을 쓰는 상황이 거의
     *  언제나 "저 벽들 두께 좀 맞춰 줘" 이기 때문이다.
     *
     *  영역의 벽면은 변별 덮어쓰기(edges)로, 내벽은 자기 값으로 들어간다.
     */
    case 'PATCH_MANY': {
      const items = action.items ?? [];
      const { sizeX, sizeZ, ...patch } = action.patch ?? {};
      const wallUids = new Set(items.filter((i) => i.kind === 'wall').map((i) => i.uid));
      const pillarUids = new Set(items.filter((i) => i.kind === 'pillar').map((i) => i.uid));

      /* 기둥의 가로·세로는 한 배열에 들어 있어서 한쪽만 고치려면 나머지를
         알아야 한다. 각 기둥이 자기 값을 들고 있으므로 여기서 합친다. */
      const resize = (p) => {
        if (sizeX === undefined && sizeZ === undefined) return null;
        return [sizeX ?? p.size[0], sizeZ ?? p.size[1]];
      };

      /* 영역 벽면 — 영역별로 어느 변을 고쳤는지 모아 한 번에 적용한다 */
      const byArea = new Map();
      for (const i of items) {
        if (i.kind !== 'area' || !i.edge) continue;
        if (!byArea.has(i.uid)) byArea.set(i.uid, []);
        byArea.get(i.uid).push(i.edge);
      }

      return {
        ...state,
        walls: wallUids.size
          ? state.walls.map((w) => (wallUids.has(w.uid) ? { ...w, ...patch } : w))
          : state.walls,
        pillars: pillarUids.size
          ? state.pillars.map((p) => {
              if (!pillarUids.has(p.uid)) return p;
              const size = resize(p);
              return { ...p, ...patch, ...(size ? { size } : {}) };
            })
          : state.pillars,
        areas: byArea.size
          ? state.areas.map((a) => {
              const keys = byArea.get(a.uid);
              if (!keys) return a;
              const edges = { ...a.edges };
              for (const k of keys) edges[k] = { ...(edges[k] ?? {}), ...patch };
              return { ...a, edges };
            })
          : state.areas,
      };
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
        openings: action.data.openings ?? [],
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
        areas: [], walls: [], pillars: [], zones: [], openings: [],
        selected: null, connectFrom: null, pathDraft: null, polyDraft: null, wallDraft: null,
      };

    default:
      return state;
  }
}

/* ==========================================================================
 * 되돌리기 / 다시 실행
 * ==========================================================================
 *  ── 무엇을 기억하는가 ─────────────────────────────────────────────────────
 *  **도면만** 기억한다. 지금 어떤 도구를 들고 있는지, 무엇을 골라 뒀는지, 카메라가
 *  어디를 보는지는 되돌릴 대상이 아니다. Ctrl+Z 로 도구가 바뀌면 "내가 뭘 되돌린
 *  거지" 가 되고, 실수로 두 번 누르면 방금 그린 것 대신 도구만 왔다 갔다 한다.
 *
 *  ── 어떤 동작을 한 칸으로 세는가 ──────────────────────────────────────────
 *  액션 종류로 가리지 않고 **도면이 실제로 바뀌었는지** 를 본다. 상태가 전부
 *  불변으로 갱신되므로 참조 비교 한 번이면 되고, 새 액션을 추가할 때 이 목록을
 *  갱신하는 것을 잊어 기록이 새는 일이 없다.
 *
 *  ── 끌고 있는 동안은 한 칸 ────────────────────────────────────────────────
 *  설비를 끌면 프레임마다 MOVE 가 나가고 슬라이더는 값마다 UPDATE 가 나간다.
 *  그대로 쌓으면 Ctrl+Z 를 수십 번 눌러야 원래 자리로 돌아온다. 같은 조작이
 *  이어지는 동안(같은 tag · 0.5초 이내)은 **처음 스냅샷 하나만** 남긴다.
 * ======================================================================== */

/** 되돌릴 대상 — 도면을 이루는 값들 */
const DOC_KEYS = ['placed', 'links', 'carts', 'areas', 'walls', 'pillars', 'zones', 'openings', 'seq'];
const HISTORY_LIMIT = 100;
/** 같은 조작으로 묶는 시간(ms) */
const COALESCE_MS = 500;

const docOf = (s) => {
  const d = {};
  for (const k of DOC_KEYS) d[k] = s[k];
  return d;
};
const sameDoc = (a, b) => DOC_KEYS.every((k) => a[k] === b[k]);

/** 연속 조작을 묶는 이름. null 이면 항상 새 칸으로 센다. */
function coalesceTag(action) {
  switch (action.type) {
    case 'MOVE':
    case 'MOVE_MANY':
      return `move:${action.uid ?? action.kind ?? ''}`;
    case 'UPDATE_PLACED':
    case 'UPDATE_LINK':
    case 'UPDATE_CART':
    case 'UPDATE_WALL':
    case 'UPDATE_PILLAR':
    case 'UPDATE_ZONE':
    case 'PATCH_MANY':
      return `PATCH_MANY:${Object.keys(action.patch ?? {}).join(',')}`;
    case 'UPDATE_AREA':
      /* 두께를 조절하다 높이로 넘어가면 다른 조작이다 — 항목 이름까지 넣는다 */
      return `${action.type}:${action.uid}:${Object.keys(action.patch ?? {}).join(',')}`;
    case 'UPDATE_AREA_EDGE':
      return `${action.type}:${action.uid}:${action.edge}:${Object.keys(action.patch ?? {}).join(',')}`;
    /* 꼭짓점 하나를 끄는 동안(끼워 넣고 곧바로 끄는 것까지) 한 칸으로 센다.
       지우기는 그 한 번으로 끝나는 조작이라 따로 센다 — 빠르게 두 점을 지웠는데
       Ctrl+Z 한 번에 둘 다 돌아오면 무엇이 취소된 것인지 알 수 없다. */
    case 'SHAPE_VERTEX':
      return action.op === 'remove' ? null : `vertex:${action.kind}:${action.uid}`;
    case 'SHAPE_COMMIT':
      return `vertex:${action.kind}:${action.uid}`;
    default:
      return null;
  }
}

/**
 * 꼭짓점 편집은 **그 도형 하나를 고른 동안만** 이어진다.
 *  다른 것을 고르거나, 도구를 바꾸거나, 그 도형이 사라지면 저절로 끝난다.
 *  액션마다 따로 끄면 새 액션을 더할 때 빠뜨리게 되므로, 모든 액션이 지나가는
 *  자리에서 조건 하나로 본다 — "지금도 그 도형을 혼자 고른 상태인가".
 */
function keepEditShape(next) {
  const e = next.editShape;
  if (!e) return next;
  const sel = next.selected;
  const alive = (e.kind === 'zone' ? next.zones : next.areas).some((x) => x.uid === e.uid);
  const still =
    alive &&
    next.tool === TOOL.SELECT &&
    sel?.kind === e.kind &&
    sel.uid === e.uid &&
    (sel.items?.length ?? 1) === 1;
  return still ? next : { ...next, editShape: null };
}

/** 되돌리기·다시 실행으로 넘어갈 때 정리할 "그리는 중" 값들 */
const CLEAR_DRAFTS = {
  connectFrom: null,
  pathDraft: null,
  polyDraft: null,
  wallDraft: null,
  editShape: null,
  /* 되돌린 뒤에도 옛 uid 를 들고 있으면 인스펙터가 사라진 것을 가리킨다 */
  selected: null,
};

function withHistory(base) {
  return (state, action) => {
    if (action.type === 'UNDO') {
      const prev = state.past[state.past.length - 1];
      if (!prev) return state;
      return {
        ...state,
        ...prev.doc,
        ...CLEAR_DRAFTS,
        past: state.past.slice(0, -1),
        future: [{ doc: docOf(state), tag: prev.tag }, ...state.future],
      };
    }
    if (action.type === 'REDO') {
      const next = state.future[0];
      if (!next) return state;
      return {
        ...state,
        ...next.doc,
        ...CLEAR_DRAFTS,
        past: [...state.past, { doc: docOf(state), tag: next.tag, at: 0 }],
        future: state.future.slice(1),
      };
    }

    const next = base(state, action);

    /* 부팅 복원은 "사용자가 한 일" 이 아니다. 이걸 기록하면 Ctrl+Z 한 번에
       불러온 도면이 통째로 사라진다. */
    if (action.type === 'LOAD_LAYOUT') return { ...next, past: [], future: [] };

    const before = docOf(state);
    if (sameDoc(before, docOf(next))) return next;

    const tag = coalesceTag(action);
    const now = Date.now();
    const last = state.past[state.past.length - 1];
    if (tag && last?.tag === tag && now - last.at < COALESCE_MS) {
      // 이어지는 조작 — 처음 스냅샷을 유지한 채 시각만 민다
      return {
        ...next,
        past: [...state.past.slice(0, -1), { ...last, at: now }],
        future: [],
      };
    }
    return {
      ...next,
      past: [...state.past, { doc: before, tag, at: now }].slice(-HISTORY_LIMIT),
      future: [],                                  // 새로 손대면 앞으로 갈 길은 사라진다
    };
  };
}

const historyReducer = withHistory((state, action) => keepEditShape(reducer(state, action)));

export function EditorProvider({ children }) {
  const [state, dispatch] = useReducer(historyReducer, initialState);
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

  /* ---- 따라 하기: 어디까지 왔는지 이 브라우저에 남긴다 -------------------
   *  'welcome' 일 때는 저장하지 않는다. 아직 아무것도 고르지 않은 상태라,
   *  띄워 놓은 채 새로고침했다고 환영 창을 영영 못 보게 되면 곤란하다.
   *  여는 길이 여럿(환영 창 · 툴바)이라 저장은 이 한 곳에서만 한다. */
  useEffect(() => {
    if (state.guide !== 'welcome') saveGuidePhase(state.guide);
  }, [state.guide]);

  /* ---- 시나리오도 이 브라우저에 남긴다 (도면과는 따로) --------------------
   *  도면을 초기화해도 비교 기록은 남아야 한다 — 배치를 바꿔 가며 견주는 일이
   *  곧 초기화의 연속이기 때문이다. */
  useEffect(() => { saveScenarios(state.scenarios); }, [state.scenarios]);

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
