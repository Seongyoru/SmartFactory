/**
 * =============================================================================
 *  작업 영역 — 바닥 다각형 · 벽 · 기둥 · 구역
 * =============================================================================
 *  설비를 놓기 전에 "건물" 을 먼저 그린다. 여기서 다루는 것은 네 가지다.
 *
 *    영역(area)  바닥이 되는 다각형. 겹쳐 그리면 하나로 합쳐진다.
 *    벽(wall)    영역의 바깥 테두리를 따라 자동으로 서고, 내벽은 따로 긋는다.
 *    기둥(pillar) 사각 기둥 하나.
 *    구역(zone)  바닥 위에만 그릴 수 있는 색 오버레이. 이름이 바닥에 찍힌다.
 *
 *  ── 왜 다각형인가 ──────────────────────────────────────────────────────────
 *  사각형을 여러 번 끌어 그리는 게 가장 손에 익지만, 겹친 사각형을 그대로 두면
 *  내부에 벽이 남아 도면이 아니라 상자 더미가 된다. 그래서 그리는 즉시
 *  **합집합(union)** 을 취해 바깥 윤곽 하나만 남긴다. 안쪽에 뚫린 구멍은
 *  구멍 고리(hole ring)로 그대로 유지된다 — ㅁ자 건물이 실제로 존재하므로.
 *
 *  좌표는 언제나 월드 XZ 의 [x, z] 쌍이고, 다각형 표현은 polygon-clipping 의
 *  MultiPolygon 규약을 그대로 쓴다.
 *
 *      MultiPolygon = Polygon[]      한 영역이 여러 조각으로 나뉠 수 있다
 *      Polygon      = Ring[]         [0] 이 바깥, 나머지는 구멍
 *      Ring         = [x, z][]       닫힌 고리 (첫 점 == 끝 점)
 *
 *  ── 바깥쪽이 어느 쪽인가 ──────────────────────────────────────────────────
 *  벽을 세우고(바깥면), 3D 에서 앞 벽을 감추려면 변마다 **바깥 방향**을 알아야
 *  한다. 고리의 회전 방향(CW/CCW)으로 판정하면 라이브러리가 어떤 방향으로
 *  내보내는지에 코드가 매이므로, 대신 변의 중점에서 살짝 밀어 낸 점이 도형
 *  안에 있는지 직접 재서 정한다. 규약이 아니라 사실을 보고 정하는 쪽이 안전하다.
 * ---------------------------------------------------------------------------
 */

import polygonClipping from 'polygon-clipping';
import { clean } from './grid.js';

/* ── 기본값 ─────────────────────────────────────────────────────────────── */

export const WALL_DEFAULTS = {
  thickness: 0.3,
  height: 4.0,
  color: '#c8ccd4',
};

/**
 * 바닥 색은 고정이다.
 *  바닥은 도면의 배경이지 표현 대상이 아니다. 색을 자유롭게 하면 그 위에 깔리는
 *  구역 오버레이·그리드·설비 그림자의 대비가 도면마다 달라져, 어떤 배색에서는
 *  구역이 안 보이고 어떤 배색에서는 눈금이 사라진다. 한 값으로 못 박아 둔다.
 */
export const FLOOR_COLOR = '#c8c8c8';

export const AREA_DEFAULTS = {
  ...WALL_DEFAULTS,
};

export const PILLAR_DEFAULTS = {
  size: [0.6, 0.6],
  height: 4.0,
  color: '#aeb4c0',
};

export const ZONE_DEFAULTS = {
  color: '#38bdf8',
  opacity: 0.28,
  /** 외곽선 — 반투명 면만으로는 옆 구역과 경계가 어디인지 흐려진다 */
  outline: true,
  outlineColor: '#0ea5e9',
  outlineWidth: 0.14,
};

/** 벽 끝점이 다른 벽·모서리에 달라붙는 거리(m) */
export const WALL_SNAP_DIST = 0.8;

/** 최소 크기 — 이보다 작게 끌면 실수로 본다 */
export const MIN_AREA_SIDE = 0.5;

/* ── 다각형 기본기 ──────────────────────────────────────────────────────── */

const R = (v) => Math.round(v * 1e4) / 1e4;

/** 고리를 닫고 좌표를 정리한다 (부동소수 잔여물이 union 을 어지럽힌다) */
export function closeRing(pts) {
  const r = pts.map(([x, z]) => [R(x), R(z)]);
  const a = r[0];
  const b = r[r.length - 1];
  if (!a || (a[0] === b[0] && a[1] === b[1])) return r;
  return [...r, [a[0], a[1]]];
}

/** 두 점을 대각으로 하는 사각형 → MultiPolygon */
export function rectMP(a, b) {
  const x0 = Math.min(a[0], b[0]);
  const x1 = Math.max(a[0], b[0]);
  const z0 = Math.min(a[1], b[1]);
  const z1 = Math.max(a[1], b[1]);
  return [[closeRing([[x0, z0], [x1, z0], [x1, z1], [x0, z1]])]];
}

/** 점 목록(펜 툴) → MultiPolygon. 삼각형 미만이면 null */
export function penMP(points) {
  if (!points || points.length < 3) return null;
  const ring = closeRing(points);
  if (ring.length < 4) return null;
  /* 스스로 교차한 선(8자 모양 등)도 union 을 한 번 통과시키면
     정상적인 다각형으로 정리된다 */
  try {
    const out = polygonClipping.union([ring]);
    return out.length ? out : null;
  } catch {
    return null;
  }
}

export function unionMP(...mps) {
  const list = mps.filter((m) => m && m.length);
  if (!list.length) return [];
  if (list.length === 1) return list[0];
  try {
    return polygonClipping.union(list[0], ...list.slice(1));
  } catch {
    return list[0];
  }
}

export function intersectMP(a, b) {
  if (!a?.length || !b?.length) return [];
  try {
    return polygonClipping.intersection(a, b);
  } catch {
    return [];
  }
}

export function differenceMP(a, b) {
  if (!a?.length) return [];
  if (!b?.length) return a;
  try {
    return polygonClipping.difference(a, b);
  } catch {
    return a;
  }
}

/** 서로 닿거나 겹치는가 — 합칠지 판단하는 기준 */
export const mpOverlaps = (a, b) => intersectMP(a, b).length > 0;

/** 점이 다각형 안에 있는가 (짝수-홀수 판정) */
export function pointInMP(mp, [px, pz]) {
  if (!mp) return false;
  for (const poly of mp) {
    let insideOuter = false;
    for (let r = 0; r < poly.length; r++) {
      if (ringContains(poly[r], px, pz)) {
        if (r === 0) insideOuter = true;
        else return false;              // 구멍에 빠졌다
      }
    }
    if (insideOuter) return true;
  }
  return false;
}

function ringContains(ring, px, pz) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** 다각형 전체를 감싸는 사각형 */
export function mpBounds(mp) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const poly of mp ?? []) {
    for (const [x, z] of poly[0] ?? []) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };
}

/** 넓이(㎡) — 구멍은 뺀다 */
export function mpArea(mp) {
  let total = 0;
  for (const poly of mp ?? []) {
    poly.forEach((ring, i) => {
      const a = Math.abs(ringArea(ring));
      total += i === 0 ? a : -a;
    });
  }
  return total;
}

function ringArea(ring) {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    s += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return s / 2;
}

/** 다각형 안쪽에서 이름표를 놓기 좋은 점 — 무게중심이 밖이면 가장 큰 조각의 중심 */
export function mpLabelPoint(mp) {
  const b = mpBounds(mp);
  if (!b) return null;
  if (pointInMP(mp, [b.cx, b.cz])) return [b.cx, b.cz];
  /* 무게중심이 ㄱ자 밖으로 나가는 경우: 가로선을 하나 그어 가장 긴 구간의 중앙 */
  const zs = [];
  for (const poly of mp) for (const [, z] of poly[0]) zs.push(z);
  zs.sort((p, q) => p - q);
  for (const z of [b.cz, ...zs.map((z, i, a) => (z + (a[i + 1] ?? z)) / 2)]) {
    const hit = scanX(mp, z, b);
    if (hit) return hit;
  }
  return [b.cx, b.cz];
}

function scanX(mp, z, b) {
  const step = Math.max((b.maxX - b.minX) / 64, 0.05);
  let best = null;
  let runStart = null;
  for (let x = b.minX; x <= b.maxX; x += step) {
    const inside = pointInMP(mp, [x, z]);
    if (inside && runStart === null) runStart = x;
    if ((!inside || x + step > b.maxX) && runStart !== null) {
      const len = x - runStart;
      if (!best || len > best.len) best = { len, x: (runStart + x) / 2 };
      runStart = null;
    }
  }
  return best && best.len > step ? [best.x, z] : null;
}

/* ── 변(벽이 설 자리) ───────────────────────────────────────────────────── */

/**
 * 다각형의 모든 변을 벽 정보로 편다.
 *  key — 좌표에서 만든 안정된 이름. 면마다 두께/높이를 따로 줄 때 쓴다.
 *        도형이 바뀌면 옛 key 는 그냥 안 맞게 되고 기본값으로 돌아간다.
 *        (자동 생성 형상에 영구 id 를 붙이려면 어차피 매칭이 필요해서,
 *         "좌표가 그대로면 설정도 그대로" 라는 규칙이 가장 예측 가능하다)
 *  nx,nz — 바깥 방향 단위벡터.
 */
export function mpEdges(mp) {
  const out = [];
  for (const poly of mp ?? []) {
    for (const ring of poly) {
      const first = out.length;                 // 이 고리의 첫 변 위치 (이웃 찾기용)
      const n = ring.length - 1;
      for (let i = 0; i < n; i++) {
        const a = ring[i];
        const b = ring[i + 1];
        const dx = b[0] - a[0];
        const dz = b[1] - a[1];
        const len = Math.hypot(dx, dz);
        if (len < 1e-6) continue;

        /* 변에 수직인 두 방향 중 도형 밖으로 나가는 쪽을 고른다.
           고리의 회전 방향에 기대지 않으므로 구멍(안뜰)에서도 옳게 나온다. */
        let nx = dz / len;
        let nz = -dx / len;
        const mx = (a[0] + b[0]) / 2;
        const mz = (a[1] + b[1]) / 2;
        const probe = 0.02;
        if (pointInMP(mp, [mx + nx * probe, mz + nz * probe])) {
          nx = -nx;
          nz = -nz;
        }
        out.push({
          key: edgeKey(a, b),
          a: [a[0], a[1]],
          b: [b[0], b[1]],
          mid: [mx, mz],
          len,
          nx,
          nz,
          angle: Math.atan2(dx, dz),        // three 의 rotation.y 로 바로 쓴다
          ring: [first, n],                 // 이 고리가 out 에서 차지하는 구간
          idx: i,
        });
      }
    }
  }
  /* 고리 안에서 앞뒤로 이어지는 변을 서로 가리키게 한다.
     코너에서 벽을 이웃의 두께만큼 늘여 붙이려면 옆 변이 얼마나 두꺼운지
     알아야 하기 때문이다. (변이 길이 0 이라 건너뛴 자리가 있어도 out 안에서만
     이웃을 찾으므로 어긋나지 않는다) */
  const byRing = new Map();
  out.forEach((e, i) => {
    const k = e.ring[0];
    if (!byRing.has(k)) byRing.set(k, []);
    byRing.get(k).push(i);
  });
  for (const list of byRing.values()) {
    list.forEach((gi, j) => {
      out[gi].prev = out[list[(j - 1 + list.length) % list.length]];
      out[gi].next = out[list[(j + 1) % list.length]];
    });
  }
  return out;
}

/**
 * 코너에서 벽을 얼마나 늘일 것인가.
 * ---------------------------------------------------------------------------
 *  벽은 경계선에서 **바깥으로 두께의 반** 만큼 밀어 세운다. 그래서 90° 코너의
 *  귀퉁이(두께 × 두께 칸)를 채우려면 각 벽이 꼭짓점 너머로 **이웃의 두께만큼**
 *  더 나가야 한다. 반만 늘이면 볼록한 모서리는 우연히 메워지지만 오목한
 *  모서리(ㄱ자 안쪽)에는 정확히 반 칸짜리 구멍이 남는다 — 그 구멍이 도면에서
 *  "벽이 안 붙은" 것처럼 보이던 것이다.
 */
export function edgeExtension(area, edge) {
  return {
    atA: edgeSpec(area, edge.prev?.key).thickness,
    atB: edgeSpec(area, edge.next?.key).thickness,
  };
}

/** 방향과 무관하게 같은 변이면 같은 이름이 나오도록 두 끝점을 정렬해서 만든다 */
export function edgeKey(a, b) {
  const p = `${R(a[0])},${R(a[1])}`;
  const q = `${R(b[0])},${R(b[1])}`;
  return p < q ? `${p}~${q}` : `${q}~${p}`;
}

/** 변 하나에 실제로 적용될 두께/높이/색 (면별 덮어쓰기 → 영역 기본값) */
export function edgeSpec(area, key) {
  const o = area?.edges?.[key] ?? {};
  return {
    thickness: o.thickness ?? area?.thickness ?? WALL_DEFAULTS.thickness,
    height: o.height ?? area?.height ?? WALL_DEFAULTS.height,
    color: o.color ?? area?.color ?? WALL_DEFAULTS.color,
  };
}

/* ── 내벽 ──────────────────────────────────────────────────────────────── */

/**
 * 내벽 끝점 스냅.
 *  가까운 곳에 다른 벽의 끝점이나 영역 모서리의 꼭짓점이 있으면 정확히 그 점으로
 *  당긴다. "거의 붙었다" 상태로 두면 렌더에서 실오라기 같은 틈이 남고, 벽이
 *  이어져 보이지 않는다.
 */
export function snapWallPoint(pt, { walls = [], areas = [] } = {}, dist = WALL_SNAP_DIST) {
  let best = null;
  /* 꼭짓점이 선분보다 먼저다 — 코너 근처에서는 "코너에 물리고 싶다" 가 보통이고,
     선분에 붙여 버리면 몇 cm 어긋난 채 코너가 어긋나 보인다. */
  const consider = (c, rank) => {
    const d = Math.hypot(c[0] - pt[0], c[1] - pt[1]);
    if (d > dist) return;
    if (!best || rank < best.rank || (rank === best.rank && d < best.d)) {
      best = { d, rank, p: [clean(c[0]), clean(c[1])] };
    }
  };

  for (const w of walls) {
    consider(w.a, 0);
    consider(w.b, 0);
  }
  for (const ar of areas) {
    for (const poly of ar.mp ?? []) for (const ring of poly) for (const v of ring) consider(v, 0);
  }

  /* 벽면(선분) 위의 가장 가까운 점.
     영역의 외벽은 경계선에서 바깥으로 세워지므로 **경계선이 곧 외벽의 안쪽
     면**이다. 내벽 끝을 경계선에 정확히 얹으면 겹치지도, 뜨지도 않고 딱 붙는다. */
  const segment = (a, b) => {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const L2 = dx * dx + dz * dz;
    if (L2 < 1e-9) return;
    let t = ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dz) / L2;
    t = Math.max(0, Math.min(1, t));
    consider([a[0] + dx * t, a[1] + dz * t], 1);
  };
  for (const ar of areas) {
    for (const poly of ar.mp ?? []) {
      for (const ring of poly) {
        for (let i = 0; i < ring.length - 1; i++) segment(ring[i], ring[i + 1]);
      }
    }
  }
  for (const w of walls) segment(w.a, w.b);

  return best ? best.p : [clean(pt[0]), clean(pt[1])];
}

/**
 * 내벽이 바닥에서 차지하는 네모 (기울어질 수 있다).
 *  충돌 판정에 쓴다. 벽은 자기 선을 가운데 두고 두께만큼 벌어진 직사각형이다.
 */
export function wallFootprint(w) {
  const g = wallBox(w);
  const h = (w.thickness ?? WALL_DEFAULTS.thickness) / 2;
  const ux = g.len ? (w.b[0] - w.a[0]) / g.len : 1;   // 길이 방향
  const uz = g.len ? (w.b[1] - w.a[1]) / g.len : 0;
  const px = -uz;                                     // 두께 방향
  const pz = ux;
  const corner = (s, t) => [
    g.mid[0] + ux * (s * g.len) / 2 + px * t * h,
    g.mid[1] + uz * (s * g.len) / 2 + pz * t * h,
  ];
  return [closeRing([corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)])];
}

/** 기둥이 바닥에서 차지하는 네모 */
export function pillarFootprint(p) {
  const [w, d] = p.size ?? PILLAR_DEFAULTS.size;
  return rectMP([p.pos[0] - w / 2, p.pos[1] - d / 2], [p.pos[0] + w / 2, p.pos[1] + d / 2]);
}

/**
 * 설비 풋프린트가 내벽·기둥과 겹치는가.
 * ---------------------------------------------------------------------------
 *  기둥은 축에 나란하지만 내벽은 아무 각도로나 설 수 있다. 두 경우를 따로
 *  구현하면 대각선 벽에서 판정이 헐거워지므로, 둘 다 다각형으로 바꿔 교집합이
 *  있는지 본다 — 이미 영역 합치기에 쓰는 계산 그대로다.
 *
 *  면끼리 딱 맞닿는 것은 겹침이 아니다(벽에 붙여 세우는 게 정상이다). 그래서
 *  설비 쪽을 아주 조금 줄여서 잰다.
 */
export function hitsObstacle(rect, { walls = [], pillars = [] } = {}, eps = 1e-3) {
  const r = rectMP([rect.minX + eps, rect.minZ + eps], [rect.maxX - eps, rect.maxZ - eps]);
  for (const w of walls) if (intersectMP(r, wallFootprint(w)).length) return true;
  for (const p of pillars) if (intersectMP(r, pillarFootprint(p)).length) return true;
  return false;
}

/** 반대 방향 — 새로 놓을 벽·기둥이 이미 있는 설비와 겹치는가 */
export function obstacleHitsRects(mp, rects, eps = 1e-3) {
  for (const r of rects) {
    const box = rectMP([r.minX + eps, r.minZ + eps], [r.maxX - eps, r.maxZ - eps]);
    if (intersectMP(mp, box).length) return true;
  }
  return false;
}

/** 내벽을 상자로 그리기 위한 값 */
export function wallBox(w) {
  const dx = w.b[0] - w.a[0];
  const dz = w.b[1] - w.a[1];
  const len = Math.hypot(dx, dz);
  return {
    len,
    mid: [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2],
    angle: Math.atan2(dx, dz),
    nx: len ? dz / len : 1,
    nz: len ? -dx / len : 0,
  };
}

/* ── 구역 ──────────────────────────────────────────────────────────────── */

/**
 * 구역을 바닥 안으로 자른다.
 *  바닥 밖에 뜬 구역은 "어느 작업장의 구역인지" 를 말할 수 없어서 의미가 없다.
 *  그래서 막는 대신 **영역과의 교집합만 남긴다** — 대충 크게 끌어도 알아서
 *  바닥 모양대로 잘리니 손이 편하다. 남는 게 없으면 null 을 돌려 거절한다.
 */
export function clipZoneToAreas(mp, areas) {
  if (!areas?.length) return null;
  const floor = unionMP(...areas.map((a) => a.mp));
  const cut = intersectMP(mp, floor);
  return cut.length ? cut : null;
}

/** 배치물이 이 구역 안에 있는가 — 중심점 기준 */
export const inZone = (zone, pos) => pointInMP(zone.mp, pos);

/* ── 놓을 수 있는 바닥인가 ─────────────────────────────────────────────── */

/** 모든 영역을 합친 바닥. 영역이 하나도 없으면 null */
export function floorOf(areas) {
  if (!areas?.length) return null;
  const mp = unionMP(...areas.map((a) => a.mp));
  return mp.length ? mp : null;
}

/**
 * 사각 풋프린트가 바닥 안에 **완전히** 들어가는가.
 * ---------------------------------------------------------------------------
 *  네 꼭짓점만 검사하면 ㄱ자 바닥의 오목한 모서리를 가로지르는 설비가 통과해
 *  버린다(꼭짓점 넷은 다 안에 있는데 가운데가 밖으로 삐져나온 경우). 그래서
 *  "풋프린트에서 바닥을 빼고 남는 게 있는가" 로 정확하게 판정한다.
 *
 *  영역이 하나도 없으면 놓을 바닥 자체가 없다. 설비는 언제나 작업장 안에
 *  있어야 하므로 건물을 먼저 그리게 한다.
 */
export function rectInFloor(rect, floor, eps = 1e-3) {
  if (!floor) return false;
  const r = rectMP(
    [rect.minX + eps, rect.minZ + eps],
    [rect.maxX - eps, rect.maxZ - eps],
  );
  return differenceMP(r, floor).length === 0;
}
