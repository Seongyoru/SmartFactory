/**
 * =============================================================================
 *  그리드 · 스냅 · 충돌
 * =============================================================================
 *  배치 규칙(스타크래프트 건물 짓기 감각)
 *   - 모든 좌표는 미터. 바닥 평면은 XZ, 높이는 Y.
 *   - 설비는 항상 그리드 교점(또는 셀 중심)에 스냅되고, 회전은 90° 단위다.
 *     "오차 없이" 배치돼야 하므로 마우스 좌표를 그대로 쓰지 않고 반드시
 *     snap() 을 통과시킨 값만 상태에 저장한다. 화면에 보이는 위치 = 저장된 값.
 *   - 회전은 라디안이 아니라 0..3 정수(×90°)로 저장한다. 부동소수 누적 오차가
 *     생기지 않고, 회전된 풋프린트를 정수 연산으로 계산할 수 있다.
 * ---------------------------------------------------------------------------
 */

/** 선택 가능한 스냅 간격(m). 기본 0.25m = 25cm */
export const GRID_SIZES = [0.05, 0.1, 0.25, 0.5, 1];
export const DEFAULT_GRID = 0.25;

/** 바닥(도면) 한 변의 크기(m). 이 밖으로는 배치할 수 없다. */
export const FLOOR_SIZE = 120;
export const FLOOR_HALF = FLOOR_SIZE / 2;

/** 굵은 보조선 간격(m) — 5m 마다 굵게 그어 거리 감각을 준다 */
export const MAJOR_GRID = 5;

/**
 * 설비를 다른 설비 옆에 붙일 때 자동으로 딱 맞춰 주는 거리(m).
 *  이 값보다 가까우면 면끼리 정확히 맞닿게 끌어당긴다. 그리드 스냅만으로는
 *  "1셀 틈"이 남는 경우가 많아서, 벽처럼 붙여 세울 때 이 보정이 필요하다.
 */
export const EDGE_SNAP_DIST = 0.6;

/** 컨베이어 끝점이 설비 포트에 달라붙는 거리(m) */
export const PORT_SNAP_DIST = 2.0;

/** 값을 그리드에 스냅 */
export const snap = (v, g = DEFAULT_GRID) => Math.round(v / g) * g;

/** 부동소수 잔여물 제거 (0.30000000000000004 → 0.3) */
export const clean = (v) => Math.round(v * 1e6) / 1e6;

export const snapPoint = ([x, z], g = DEFAULT_GRID) => [clean(snap(x, g)), clean(snap(z, g))];

/** 0..3 회전값을 라디안으로 */
export const rotToRad = (rot) => (rot % 4) * (Math.PI / 2);

/** 90° 단위 회전에서의 축 방향 벡터. rot 0 = +X */
export const ROT_DIRS = [
  [1, 0],
  [0, -1],
  [-1, 0],
  [0, 1],
];

/**
 * 로컬 XZ 벡터를 rot(0..3) 만큼 회전.
 *  three.js 의 Y축 회전과 부호를 맞춘다: rotY=θ 일 때 +X → (cosθ, -sinθ).
 *  θ = rot*90° 이므로 정수 회전은 성분 교환/부호반전으로만 끝난다(오차 0).
 */
export function rotateXZ([x, z], rot) {
  switch (((rot % 4) + 4) % 4) {
    case 1: return [-z, x];
    case 2: return [-x, -z];
    case 3: return [z, -x];
    default: return [x, z];
  }
}

/**
 * 배치된 설비의 바닥 풋프린트(축 정렬 사각형).
 *  모델 로컬 bbox 를 rot 만큼 회전시키면 90° 단위에서는 폭/깊이가 교환될 뿐이라
 *  결과도 축 정렬 사각형이다. 반환값은 월드 XZ 기준 min/max.
 */
export function footprintOf(placed, item) {
  const bb = item?.bbox;
  if (!bb) return { minX: placed.pos[0], maxX: placed.pos[0], minZ: placed.pos[1], maxZ: placed.pos[1] };

  // 로컬 bbox 의 네 모서리를 회전시켜 다시 min/max 를 취한다
  const corners = [
    [bb.min[0], bb.min[2]],
    [bb.max[0], bb.min[2]],
    [bb.max[0], bb.max[2]],
    [bb.min[0], bb.max[2]],
  ].map((c) => rotateXZ(c, placed.rot));

  const xs = corners.map((c) => c[0]);
  const zs = corners.map((c) => c[1]);
  return {
    minX: clean(placed.pos[0] + Math.min(...xs)),
    maxX: clean(placed.pos[0] + Math.max(...xs)),
    minZ: clean(placed.pos[1] + Math.min(...zs)),
    maxZ: clean(placed.pos[1] + Math.max(...zs)),
  };
}

/** 두 사각형이 겹치는가 (경계선끼리 맞닿는 건 겹침으로 보지 않는다) */
export function rectsOverlap(a, b, eps = 1e-4) {
  return (
    a.minX < b.maxX - eps &&
    a.maxX > b.minX + eps &&
    a.minZ < b.maxZ - eps &&
    a.maxZ > b.minZ + eps
  );
}

/** 도면 밖으로 나갔는지 */
export function outOfBounds(rect) {
  return rect.minX < -FLOOR_HALF || rect.maxX > FLOOR_HALF || rect.minZ < -FLOOR_HALF || rect.maxZ > FLOOR_HALF;
}

/**
 * 인접 설비에 면을 맞춰 붙이는 보정.
 * ---------------------------------------------------------------------------
 *  그리드 스냅이 끝난 좌표를 받아, 근처(EDGE_SNAP_DIST 이내) 설비의 면과
 *  나란히 놓일 수 있으면 그 면에 정확히 맞닿도록 위치를 당긴다.
 *  X·Z 축을 독립적으로 판정하므로 모서리에서 두 축 동시 정렬도 된다.
 *
 *  "겹치는 구간이 있을 때만" 당긴다. 저 멀리 떨어진 설비의 X면에 끌려가면
 *  오히려 배치가 어긋나므로, 다른 축에서 실제로 마주보고 있을 때만 적용한다.
 */
export function edgeSnap(rect, others, dist = EDGE_SNAP_DIST) {
  let dx = 0;
  let dz = 0;
  let bestX = dist;
  let bestZ = dist;

  for (const o of others) {
    const facingZ = rect.minZ < o.maxZ + dist && rect.maxZ > o.minZ - dist;
    const facingX = rect.minX < o.maxX + dist && rect.maxX > o.minX - dist;

    if (facingZ) {
      // 내 왼쪽 면 ↔ 상대 오른쪽 면 / 내 오른쪽 면 ↔ 상대 왼쪽 면
      for (const [mine, theirs] of [[rect.minX, o.maxX], [rect.maxX, o.minX], [rect.minX, o.minX], [rect.maxX, o.maxX]]) {
        const d = theirs - mine;
        if (Math.abs(d) < bestX) { bestX = Math.abs(d); dx = d; }
      }
    }
    if (facingX) {
      for (const [mine, theirs] of [[rect.minZ, o.maxZ], [rect.maxZ, o.minZ], [rect.minZ, o.minZ], [rect.maxZ, o.maxZ]]) {
        const d = theirs - mine;
        if (Math.abs(d) < bestZ) { bestZ = Math.abs(d); dz = d; }
      }
    }
  }
  return [clean(dx), clean(dz)];
}
