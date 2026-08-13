/**
 * =============================================================================
 *  선반(랙) — 규격 · 슬롯 · 적재
 * =============================================================================
 *  선반은 설비처럼 바닥에 놓이지만, 형상이 모델이 아니라 **설정값**에서 나온다.
 *  칸 수 · 한 칸 길이 · 단 수 · 단 간격 · 한 단 적재수를 모두 사용자가 정하고,
 *  모델은 "판 한 장과 기둥" 이라는 부품으로만 쓰인다.
 *
 *  그래서 여기 있는 함수들이 형상의 사실상 유일한 출처다. 렌더(ShelfView),
 *  풋프린트(grid), 카트 정차역(cart) 이 모두 같은 값을 보고 움직여야
 *  "보이는 곳" 과 "판정되는 곳" 이 어긋나지 않는다.
 *
 *  ── 채우는 순서 ────────────────────────────────────────────────────────────
 *   아래 단을 가로로 다 채우고 위 단으로 올라간다. 위 칸이 먼저 차는 건
 *   물리적으로 어색해서, 보이는 대로 납득되는 순서를 골랐다.
 * ---------------------------------------------------------------------------
 */

import { getSpec } from './modelStore.js';
import { PAYLOAD_ITEM } from '../data/library.js';

/** 모델을 못 읽었을 때 쓰는 기본 규격(m) — 절차적으로 그릴 치수이기도 하다 */
export const FALLBACK = {
  pitch: 2.6,
  depth: 0.9,
  baseTop: 0.3,
  spacing: 1.4,
  usable: 2.5,
  boardTop: 0.3,
  postHeight: 3.4,
  boardThickness: 0.08,
  postSize: 0.09,
  levels: [0.3, 1.7, 3.1],
};

export const SHELF_SLOT_GAP = 0.16;

/* 조절 범위 */
export const MIN_BAYS = 1;
export const MAX_BAYS = 10;
export const DEFAULT_BAYS = 2;
export const MIN_LEVELS = 1;
export const MAX_LEVELS = 10;
export const DEFAULT_LEVELS = 3;
export const MIN_BAY_LENGTH = 1.0;
export const MAX_BAY_LENGTH = 6.0;
export const MIN_LEVEL_GAP = 0.4;
export const MAX_LEVEL_GAP = 3.0;

/* ---- 줄(row) --------------------------------------------------------------
 *  같은 규격의 랙을 앞뒤로 여러 줄 세운 것을 **한 덩어리로** 다룬다. 예전에는
 *  줄을 늘리려면 선반을 새로 그려 위치와 설정을 손으로 맞춰야 했다 — 번거롭고
 *  틀리기 쉬웠다.
 *
 *  줄이 생기면 **줄마다 받을 종류를 정할 수 있다**(1번 줄은 제작품 1, 2번 줄은
 *  조립품 2 …). 안 정한 줄은 예전처럼 섞어 받는다.
 * -------------------------------------------------------------------------- */
export const MIN_ROWS = 1;
export const MAX_ROWS = 8;
export const DEFAULT_ROWS = 1;
/** 줄과 줄 **사이**의 빈 폭(m) — 통로 */
export const MIN_ROW_GAP = 0.2;
export const MAX_ROW_GAP = 8.0;
export const DEFAULT_ROW_GAP = 1.4;
/** 한 단에 넣을 수 있는 최대 개수.
 *  길이(최대 60m)를 자재 폭으로 나누면 70개가 넘게 나온다. 예전 값 40 은
 *  이 자동 계산을 잘라 버려서 "길이를 늘려도 개수가 안 늘어나는" 상한이 됐다.
 *  형상이 감당하는 값을 그대로 쓰도록 넉넉히 둔다. */
export const MAX_PER_LEVEL = 500;

/**
 * 자재 한 개의 폭(m) — 적재수 계산의 기준.
 * ---------------------------------------------------------------------------
 *  호출부마다 "안 넘기면 0.7" 이던 것이 문제였다. 인스펙터는 0.7 로 34개라
 *  적고, 씬은 실측 폭(≈0.68)으로 35개를 그려서 표시와 실제가 어긋났다.
 *  기준은 언제나 **실제 모델의 폭** 하나뿐이어야 한다.
 */
export const DEFAULT_ITEM_WIDTH = 0.7;
export const payloadWidth = () =>
  getSpec(PAYLOAD_ITEM.modelKey)?.bbox?.size?.[0] || DEFAULT_ITEM_WIDTH;

/**
 * 입출고 구역.
 * ---------------------------------------------------------------------------
 *  선반을 길이 방향으로 반 갈라, 한쪽은 **입고(카트가 내려놓는 곳)**,
 *  다른 쪽은 **출고(카트가 실어 가는 곳)** 로 쓴다.
 *
 *  나누지 않으면 카트가 선반 옆을 지날 때마다 상황에 따라 싣거나 부려서,
 *  같은 선반에서 넣었다 뺐다 하는 동작이 된다. 자리를 갈라 두면 "어디로
 *  지나가느냐" 가 곧 "무엇을 할 것이냐" 가 되어 도면만 보고도 흐름이 읽힌다.
 *
 *  앞뒤 양면에 모두 둔다 — 랙은 양쪽에서 접근하는 게 보통이고, 카트 경로를
 *  어느 쪽으로 그리든 동작해야 하기 때문이다.
 */
export const ZONE = { IN: 'in', OUT: 'out' };

/** 구역 표시가 바닥에 깔리는 폭(m) */
export const ZONE_BAND = 0.6;

/**
 * 로컬 좌표 기준 구역 목록.
 *  { kind, cx, cz, fz, w, d, dir }
 *    cz — 바닥 표시 띠의 중심 (그리기용)
 *    fz — 선반의 옆면 (판정용)
 *
 *  판정을 띠 중심에서 하면, 경로가 띠 위에 겹칠 때 몇 mm 차이로 "안쪽" 이 되어
 *  정차역에서 빠진다. 선반 면을 기준으로 재면 바깥쪽 어디를 지나든 인정된다.
 */
export function shelfZones(p, spec) {
  const L = shelfLength(p, spec);
  /* 줄이 여럿이면 **바깥 면**이 접근 면이다 — 안쪽 줄은 통로로 못 닿는다 */
  const d = shelfDepth(p, spec);
  const half = L / 2;
  const zones = [];
  /* 첫 줄 바깥면은 안 움직이고, 반대쪽만 줄 수를 따라 밀려난다 */
  for (const [fz, side] of [[shelfNearZ(p, spec), -1], [shelfFarZ(p, spec), 1]]) {
    const common = { fz, cz: fz + side * (ZONE_BAND / 2), w: half, d: ZONE_BAND, dir: [0, side] };
    zones.push({ kind: ZONE.IN, cx: -half / 2, ...common });
    zones.push({ kind: ZONE.OUT, cx: half / 2, ...common });
  }
  return zones;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** 모델 분석 결과에서 규격을 꺼낸다 (없으면 기본값) */
export const shelfSpec = (spec) => spec?.shelf ?? FALLBACK;

export const shelfBays = (p) => clamp(Math.round(p?.bays ?? DEFAULT_BAYS), MIN_BAYS, MAX_BAYS);
export const shelfLevelCount = (p) => clamp(Math.round(p?.levels ?? DEFAULT_LEVELS), MIN_LEVELS, MAX_LEVELS);

/** 한 칸 길이(m) — 지정이 없으면 모델의 기둥 간격 */
export const bayLength = (p, spec) =>
  clamp(p?.bayLength ?? shelfSpec(spec).pitch, MIN_BAY_LENGTH, MAX_BAY_LENGTH);

/** 단 간격(m) — 지정이 없으면 모델의 판 간격 */
export const levelGap = (p, spec) =>
  clamp(p?.levelGap ?? shelfSpec(spec).spacing, MIN_LEVEL_GAP, MAX_LEVEL_GAP);

/** 전체 길이(m) */
export const shelfLength = (p, spec) => shelfBays(p) * bayLength(p, spec);

/** i 단의 높이(자재를 올리는 면) */
export const levelY = (i, p, spec) => shelfSpec(spec).baseTop + i * levelGap(p, spec);

/** 자동 계산한 한 단 적재수 — 자재 폭으로 나눈 값 */
export function autoPerLevel(p, spec, itemWidth = payloadWidth()) {
  const inner = shelfLength(p, spec) - SHELF_SLOT_GAP;
  return Math.max(1, Math.floor(inner / (itemWidth + SHELF_SLOT_GAP)));
}

/** 한 단 적재수 — 지정이 없으면 자동 */
export const perLevel = (p, spec, itemWidth = payloadWidth()) =>
  clamp(Math.round(p?.perLevel ?? autoPerLevel(p, spec, itemWidth)), 1, MAX_PER_LEVEL);

/* ---- 줄 ------------------------------------------------------------------ */

export const shelfRows = (p) => clamp(Math.round(p?.rows ?? DEFAULT_ROWS), MIN_ROWS, MAX_ROWS);
/** 줄 사이의 통로 폭(m) */
export const rowGap = (p) => clamp(p?.rowGap ?? DEFAULT_ROW_GAP, MIN_ROW_GAP, MAX_ROW_GAP);
/** 줄 중심 사이의 거리 = 랙 깊이 + 통로 */
export const rowPitch = (p, spec) => shelfSpec(spec).depth + rowGap(p);
/** 줄을 세운 전체 깊이(m) */
export const shelfDepth = (p, spec) => {
  const n = shelfRows(p);
  return shelfSpec(spec).depth * n + rowGap(p) * (n - 1);
};
/**
 * r 번째 줄의 중심 z (로컬) — **첫 줄은 제자리, 나머지는 뒤로 덧붙는다.**
 * ---------------------------------------------------------------------------
 *  처음에는 가운데를 기준으로 양쪽으로 자라게 했다. 그랬더니 줄을 늘리는 순간
 *  **양쪽 면이 모두 바깥으로 밀려나서**, 앞을 지나던 카트 경로가 선반 **안쪽**으로
 *  들어가 버렸다 — 정차역이 통째로 사라지고 선반이나 경로를 옮겨야 다시 붙었다
 *  (실측: 3줄이면 경로가 면보다 1.7m 안쪽).
 *
 *  줄은 **덧붙이는 것**이다. 첫 줄을 원래 자리에 두면 그쪽 면이 안 움직이므로
 *  이미 그려 둔 경로가 그대로 산다. 실제로 랙을 늘릴 때도 기존 열은 안 옮긴다.
 */
export const rowZ = (r, p, spec) => r * rowPitch(p, spec);

/** 안 움직이는 면 (첫 줄 바깥쪽) — 카트 경로가 기대는 기준 */
export const shelfNearZ = (p, spec) => -shelfSpec(spec).depth / 2;
/** 줄을 늘리면 밀려나는 면 */
export const shelfFarZ = (p, spec) => shelfNearZ(p, spec) + shelfDepth(p, spec);

/** 한 줄이 담는 개수 */
export const perRow = (p, spec, itemWidth = payloadWidth()) =>
  perLevel(p, spec, itemWidth) * shelfLevelCount(p);

/** 총 수용량 — 줄 수만큼 곱한다 */
export const shelfCapacity = (p, spec, itemWidth = payloadWidth()) =>
  perRow(p, spec, itemWidth) * shelfRows(p);

/**
 * 줄마다 받을 종류 — 길이를 줄 수에 맞춘 배열. 안 정한 칸은 null.
 *  줄 수를 줄이면 뒤쪽 지정은 버려지고, 늘리면 새 줄은 「안 정함」으로 시작한다.
 */
export function rowKinds(p) {
  const n = shelfRows(p);
  const src = Array.isArray(p?.rowKinds) ? p.rowKinds : [];
  return Array.from({ length: n }, (_, r) => src[r] ?? null);
}

/**
 * 이 종류가 들어갈 **줄 묶음**.
 * ---------------------------------------------------------------------------
 *  제 몫으로 지정된 줄이 있으면 거기만 쓴다. 없으면 **안 정한 줄들**을 함께
 *  쓴다(예전처럼 섞여 쌓인다). 아무 줄도 안 정했으면 전부가 공용이다.
 *
 *  묶음을 id 로 돌려주는 이유는 자리 수를 셀 때 **공용은 한 통으로** 봐야 하기
 *  때문이다 — 종류마다 따로 세면 공용 칸이 종류 수만큼 뻥튀기된다.
 */
export function rowGroupOf(p, kind) {
  const kinds = rowKinds(p);
  const mine = kinds.map((k, r) => (k === kind ? r : -1)).filter((r) => r >= 0);
  if (mine.length) return { id: `k:${kind}`, rows: mine };
  const free = kinds.map((k, r) => (k == null ? r : -1)).filter((r) => r >= 0);
  return { id: 'shared', rows: free };
}

/**
 * 지금 쌓인 것을 **줄에 앉힌다** — 그리기와 자리 계산이 함께 쓰는 하나의 답.
 * ---------------------------------------------------------------------------
 *  재고는 종류 배열 하나(`lots`)로만 들고 있다. "몇 번째 줄에 있는가" 를 따로
 *  저장하지 않는 이유는, 종류만 알면 갈 줄이 정해지기 때문이다(rowGroupOf).
 *  그래서 목록을 앞에서부터 훑으며 묶음마다 자리를 하나씩 내주면, 같은 재고에
 *  대해 **언제나 같은 그림**이 나온다.
 *
 *  @returns [{ kind, row, level, col, pos:[x,y,z] }, …] · 자리가 없으면 뺀다
 */
export function layoutShelf(lots, p, spec, itemWidth = payloadWidth()) {
  const n = perLevel(p, spec, itemWidth);
  const levels = shelfLevelCount(p);
  const cap = perRow(p, spec, itemWidth);
  const L = shelfLength(p, spec);
  const pitch = L / n;
  const used = new Map();                    // 묶음 id → 지금까지 쓴 자리 수
  const out = [];

  for (const kind of lots ?? []) {
    const g = rowGroupOf(p, kind);
    if (!g.rows.length) continue;            // 받을 줄이 없다
    const k = used.get(g.id) ?? 0;
    if (k >= g.rows.length * cap) continue;  // 그 묶음이 다 찼다
    used.set(g.id, k + 1);

    const row = g.rows[Math.floor(k / cap)];
    const within = k % cap;
    const level = Math.min(levels - 1, Math.floor(within / n));
    const col = within % n;
    out.push({
      kind,
      row,
      level,
      col,
      pos: [-L / 2 + pitch * (col + 0.5), levelY(level, p, spec), rowZ(row, p, spec)],
    });
  }
  return out;
}

/** 이 종류를 몇 개 더 받을 수 있는가 (줄 지정을 지킨다) */
export function shelfRoom(lots, p, spec, kind, itemWidth = payloadWidth()) {
  const g = rowGroupOf(p, kind);
  if (!g.rows.length) return 0;
  const cap = g.rows.length * perRow(p, spec, itemWidth);
  let used = 0;
  for (const k of lots ?? []) if (rowGroupOf(p, k).id === g.id) used += 1;
  return Math.max(0, cap - used);
}

/**
 * i 번째 자재가 놓일 자리 (선반 로컬 좌표).
 *  길이축 X · 앞뒤 Z · 단 Y. 줄이 하나일 때의 옛 계산 그대로다 —
 *  줄이 여럿이면 `layoutShelf` 를 쓴다(종류에 따라 줄이 갈리므로 번호만으로는
 *  자리를 못 정한다).
 */
export function slotPosition(index, p, spec, itemWidth = payloadWidth()) {
  const n = perLevel(p, spec, itemWidth);
  const level = Math.min(shelfLevelCount(p) - 1, Math.floor(index / n));
  const col = index % n;

  const L = shelfLength(p, spec);
  const pitch = L / n;                       // 길이를 적재수로 균등 분할
  return [-L / 2 + pitch * (col + 0.5), levelY(level, p, spec), rowZ(0, p, spec)];
}

/** 실제 자재 간격(m) — 너무 촘촘하면 겹친다는 걸 보여 주기 위해 */
export const slotPitch = (p, spec, itemWidth = payloadWidth()) =>
  shelfLength(p, spec) / perLevel(p, spec, itemWidth);

/** 랙 전체 높이 */
export const shelfHeight = (p, spec) =>
  levelY(shelfLevelCount(p) - 1, p, spec) + 0.3;

/** 선반이 차지하는 로컬 바운딩 박스 (풋프린트·충돌 계산용) */
export function shelfBBox(p, spec) {
  const L = shelfLength(p, spec);
  /* 줄을 세운 전체 깊이 — 풋프린트·충돌이 줄 수를 반영해야 겹쳐 놓이지 않는다 */
  const d = shelfDepth(p, spec);
  const h = shelfHeight(p, spec);
  const z0 = shelfNearZ(p, spec);
  const z1 = shelfFarZ(p, spec);
  return { min: [-L / 2, 0, z0], max: [L / 2, h, z1], size: [L, h, d], center: [0, h / 2, (z0 + z1) / 2] };
}
