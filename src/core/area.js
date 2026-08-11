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

/**
 * 개구부(출입구·게이트).
 * ---------------------------------------------------------------------------
 *  벽에 뚫는 구멍이다. 트럭이 드나드는 게이트가 주 용도라 기본값을 크게 잡았다.
 *  sill(밑턱)을 올리면 창이 되고, 0 이면 바닥까지 트인 출입구가 된다.
 *
 *  어느 벽에 붙었는지를 **벽 이름(key)으로 기억하지 않는다.** 영역 모양이 바뀌면
 *  변이 통째로 다시 만들어져 이름이 날아가기 때문이다. 대신 월드 좌표 한 점만
 *  들고 있다가, 그릴 때 그 점이 얹힌 벽을 찾는다 — 벽이 조금 움직여도 따라오고,
 *  벽이 사라지면 조용히 안 그려진다.
 */
export const OPENING_DEFAULTS = { width: 4.0, height: 4.0, sill: 0 };
export const MIN_OPENING = 0.3;
/** 개구부가 이 벽에 얹혔다고 보는 수직 거리 여유(m) */
export const OPENING_ATTACH_TOL = 1.2;

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

/* ── 꼭짓점 편집 ────────────────────────────────────────────────────────── */

/**
 * 그려 놓은 면의 모양 고치기.
 * ---------------------------------------------------------------------------
 *  영역·구역은 한 번 그리면 끝이었다. 벽 한 장을 3m 물리려고 도형을 통째로
 *  다시 그리는 것은 도면 작업이라 할 수 없다. 그래서 **꼭짓점 자체를 손잡이로**
 *  내어 준다 — 끌어 옮기고, 변의 중점을 끌면 그 자리에 꼭짓점이 생기고,
 *  Alt+클릭으로 지운다(경로 편집 손잡이와 같은 규칙이다).
 *
 *  ── 주소 ──────────────────────────────────────────────────────────────────
 *  MultiPolygon 안의 한 점을 가리키려면 세 숫자가 필요하다.
 *
 *      addr = { poly, ring, i }      조각 · 고리(0=바깥, 그 밖은 구멍) · 몇 번째
 *
 *  i 는 **닫는 중복점을 뺀** 목록에서 센다. 저장된 고리는 첫 점 == 끝 점이라
 *  그대로 세면 같은 자리에 손잡이가 둘 생기고, 그 둘을 따로 끌면 고리가 찢어진다.
 *
 *  ── 끄는 동안에는 정리하지 않는다 ─────────────────────────────────────────
 *  union 을 한 번 통과시키면 스스로 교차한 자리가 풀리지만, 고리가 통째로 다시
 *  만들어져 **꼭짓점 순서가 바뀐다.** 끄는 중에 그러면 잡고 있던 점이 손에서
 *  빠져나가 엉뚱한 점이 따라온다. 그래서 정리는 손을 뗄 때(normalizeMP) 한 번만.
 */

const samePt = (p, q) => p[0] === q[0] && p[1] === q[1];

/** 닫는 중복점을 뗀 목록 */
function openRing(ring) {
  const r = (ring ?? []).slice();
  while (r.length > 1 && samePt(r[0], r[r.length - 1])) r.pop();
  return r;
}

/** 고리 위를 한 바퀴 도는 인덱스 접근 */
const atWrap = (v, i) => v[((i % v.length) + v.length) % v.length];

/** 끌 수 있는 꼭짓점 전부 — [{ poly, ring, i, at, hole }] */
export function mpVertices(mp) {
  const out = [];
  (mp ?? []).forEach((poly, p) => {
    poly.forEach((ring, r) => {
      openRing(ring).forEach((at, i) => out.push({ poly: p, ring: r, i, at, hole: r > 0 }));
    });
  });
  return out;
}

/**
 * 변의 중점 — 여기를 끌면 그 자리에 꼭짓점이 새로 생긴다.
 *  i 는 **새 점이 들어갈 자리**다(변 i-1 → i 사이). 마지막 변에서는 목록 끝에
 *  붙으므로 i === 길이가 되고, 그대로 splice 에 넣으면 맞다.
 */
export function mpMidpoints(mp) {
  const out = [];
  (mp ?? []).forEach((poly, p) => {
    poly.forEach((ring, r) => {
      const v = openRing(ring);
      v.forEach((a, i) => {
        const b = atWrap(v, i + 1);
        out.push({ poly: p, ring: r, i: i + 1, at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], hole: r > 0 });
      });
    });
  });
  return out;
}

/** 이 꼭짓점과 양옆 — 편집이 실제로 건드리는 범위를 재는 데 쓴다 */
export function vertexNeighbors(mp, addr) {
  const v = openRing(mp?.[addr.poly]?.[addr.ring]);
  if (!v.length || addr.i >= v.length) return null;
  return { at: v[addr.i], prev: atWrap(v, addr.i - 1), next: atWrap(v, addr.i + 1) };
}

/** 고리 하나만 바꾼다. 삼각형 미만이 되면 거절(null) */
function editRing(mp, addr, fn) {
  const ring = mp?.[addr.poly]?.[addr.ring];
  if (!ring) return null;
  const v = fn(openRing(ring));
  if (!v || v.length < 3) return null;
  return mp.map((poly, p) =>
    p !== addr.poly ? poly : poly.map((r0, r) => (r !== addr.ring ? r0 : closeRing(v))),
  );
}

/**
 * 꼭짓점 옮기기.
 *  옆 꼭짓점과 같은 자리로는 못 간다 — 길이 0 인 변이 생기면 그 변의 바깥
 *  방향을 정할 수 없어(mpEdges 가 건너뛴다) 벽 한 장이 소리 없이 사라진다.
 */
export function moveVertex(mp, addr, pt) {
  const p = [clean(pt[0]), clean(pt[1])];
  return editRing(mp, addr, (v) => {
    if (addr.i >= v.length) return null;
    if (samePt(p, atWrap(v, addr.i - 1)) || samePt(p, atWrap(v, addr.i + 1))) return null;
    const n = v.slice();
    n[addr.i] = p;
    return n;
  });
}

export function insertVertex(mp, addr, pt) {
  const p = [clean(pt[0]), clean(pt[1])];
  return editRing(mp, addr, (v) => {
    if (samePt(p, atWrap(v, addr.i - 1)) || samePt(p, atWrap(v, addr.i))) return null;
    const n = v.slice();
    n.splice(addr.i, 0, p);
    return n;
  });
}

/** 꼭짓점 지우기 — 세 점은 남긴다(면이 아니게 된다) */
export function removeVertex(mp, addr) {
  return editRing(mp, addr, (v) => (v.length <= 3 ? null : v.filter((_, i) => i !== addr.i)));
}

/**
 * 편집이 끝난 도형 정리 — 스스로 교차한 자리를 풀고 겹친 조각을 합친다.
 *  꼭짓점을 옆 변 너머로 끌면 8자로 접힌 고리가 나올 수 있다. 그대로 두면
 *  넓이도 벽의 바깥 방향도 뒤집힌 채로 남으므로, 손을 뗄 때 한 번 통과시킨다.
 */
export function normalizeMP(mp) {
  if (!mp?.length) return null;
  try {
    const out = polygonClipping.union(mp);
    return out.length ? out : null;
  } catch {
    return mp;
  }
}

/**
 * 꼭짓점을 건드린 뒤 면별 설정을 새 이름으로 옮긴다.
 * ---------------------------------------------------------------------------
 *  면마다 따로 준 두께·높이·색·이름은 변의 key(= 두 끝점 좌표)에 매달려 있다.
 *  코너를 조금 미는 것만으로 그 이름이 바뀌므로, 옮겨 주지 않으면 설정이 조용히
 *  기본값으로 돌아간다 — 사용자가 한 일을 편집기가 지우는 셈이다.
 *
 *  key 가 **좌표에서 나온다**는 점이 여기서 도움이 된다. 건드린 꼭짓점에 붙은
 *  두 변만 이름이 바뀌고 나머지는 그대로이므로, 옮길 것도 그 둘뿐이다.
 *
 *    move   : (앞─점) · (점─뒤) 두 변이 각각 새 이름을 얻는다
 *    insert : 갈라진 변의 설정을 **두 토막 모두** 물려받는다 (한 장이던 벽을
 *             꺾은 것이지, 그중 하나만 원래 벽인 것은 아니다)
 *    remove : 두 변이 하나로 합쳐진다 — 어느 쪽 설정을 물려줄지 말할 수 없어
 *             둘 다 버리고 영역 기본값으로 돌린다
 */
export function remapEdgeSpecs(edges, oldRing, newRing, op, i) {
  const src = edges ?? {};
  const vo = openRing(oldRing);
  const vn = openRing(newRing);
  if (!vo.length) return src;

  const before = [edgeKey(atWrap(vo, i - 1), atWrap(vo, i)), edgeKey(atWrap(vo, i), atWrap(vo, i + 1))];
  let moves = [];
  if (op === 'move') {
    moves = [
      [before[0], edgeKey(atWrap(vn, i - 1), atWrap(vn, i))],
      [before[1], edgeKey(atWrap(vn, i), atWrap(vn, i + 1))],
    ];
  } else if (op === 'insert') {
    /* 갈라진 변은 (앞 ─ 새 점) 하나뿐이다. i 는 새 점이 들어간 자리다. */
    const from = edgeKey(atWrap(vo, i - 1), atWrap(vo, i));
    moves = [
      [from, edgeKey(atWrap(vn, i - 1), atWrap(vn, i))],
      [from, edgeKey(atWrap(vn, i), atWrap(vn, i + 1))],
    ];
  } else {
    moves = [[before[0], null], [before[1], null]];
  }

  /* 값을 먼저 집어 두고 옛 이름을 지운 뒤 새 이름에 놓는다 — 순서를 바꾸면
     이름이 그대로인 경우(움직이지 않은 축)에 방금 놓은 것을 지운다. */
  const carried = moves.filter(([from, to]) => to && src[from]).map(([from, to]) => [to, src[from]]);
  const out = { ...src };
  for (const [from] of moves) delete out[from];
  for (const [to, spec] of carried) out[to] = { ...(out[to] ?? {}), ...spec };
  return out;
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
 *  벽은 경계선에서 **바깥으로 두께의 반** 만큼 밀어 세운다.
 *
 *  ── 볼록한 코너 (건물 바깥 모서리) ─────────────────────────────────────────
 *  귀퉁이(두께 × 두께 칸)가 비므로, 각 벽이 꼭짓점 너머로 **이웃의 두께만큼**
 *  더 나가야 두 벽의 바깥면이 만난다. 반만 늘이면 반 칸짜리 구멍이 남는다.
 *
 *  ── 오목한 코너 (ㄱ자 안쪽) ────────────────────────────────────────────────
 *  여기서는 **늘이면 안 된다.** 두 벽이 이미 귀퉁이 칸을 서로 덮고 있어서 뺄
 *  것이 없는데, 그 위에 더 늘이면 그 부분이 **방 안쪽으로 튀어나온 돌기**가
 *  된다. 도면에서 모서리마다 十자 모양 혹이 붙어 보이던 것이 이것이다.
 *
 *  ── 어느 쪽인지 판정 ──────────────────────────────────────────────────────
 *  고리의 회전 방향(CW/CCW)으로 가리지 않는다. 대신 **늘어날 자리 자체가 방
 *  안인지** 직접 재 본다. 안이면 늘이지 않는다. 바깥 방향을 정할 때와 같은
 *  방식(규약이 아니라 사실을 보는 것)이라, 구멍 고리나 펜으로 그린 비스듬한
 *  도형에서도 똑같이 맞는다.
 */
function extensionAt(mp, edge, toward, ext, thickness) {
  if (!(ext > 0)) return 0;
  const v = toward > 0 ? edge.b : edge.a;
  const dx = Math.sin(edge.angle) * toward;
  const dz = Math.cos(edge.angle) * toward;
  /* 늘어난 토막의 한가운데 — 꼭짓점 너머로 절반, 바깥으로 두께의 절반 */
  const px = v[0] + dx * (ext / 2) + edge.nx * (thickness / 2);
  const pz = v[1] + dz * (ext / 2) + edge.nz * (thickness / 2);
  return pointInMP(mp, [px, pz]) ? 0 : ext;
}

export function edgeExtension(mp, area, edge) {
  const t = edgeSpec(area, edge.key).thickness;
  return {
    atA: extensionAt(mp, edge, -1, edgeSpec(area, edge.prev?.key).thickness, t),
    atB: extensionAt(mp, edge, +1, edgeSpec(area, edge.next?.key).thickness, t),
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

  /**
   * 가까운 쪽이 이긴다. 꼭짓점에는 아주 작은 가산점만 준다.
   * -------------------------------------------------------------------------
   *  꼭짓점을 무조건 앞세우면, 벽 **가운데**를 겨냥해도 스냅 거리 안에 코너가
   *  있는 한 끝점이 코너로 끌려간다. 그러면 T 자로 대려던 벽이 매번 모서리에
   *  가서 붙어, 붙이려던 자리와 붙은 자리가 달라진다.
   *  코너를 노렸을 때는 어차피 그쪽이 더 가까우므로, 가산점은 "거의 같은
   *  거리일 때 코너를 고른다" 정도면 충분하다.
   */
  const VERTEX_BONUS = 0.12;

  const consider = (c, rank) => {
    const d = Math.hypot(c[0] - pt[0], c[1] - pt[1]);
    if (d > dist) return;
    const score = rank === 0 ? d - VERTEX_BONUS : d;
    if (!best || score < best.score) {
      best = { d, score, p: [clean(c[0]), clean(c[1])] };
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

/**
 * 내벽의 코너 채움.
 * ---------------------------------------------------------------------------
 *  내벽은 자기 선을 **가운데 두고** 서므로(외벽처럼 바깥으로 밀지 않는다),
 *  두 벽이 꼭짓점에서 만나면 귀퉁이에 **네 쪽 중 한 쪽**이 빈다.
 *
 *      A 가 x<0 에서 와서 원점에서 끝나고, B 가 원점에서 z>0 으로 간다면
 *      x∈(0, tB/2] · z∈[−tA/2, 0) 칸을 아무도 덮지 않는다 → 엇갈려 보인다.
 *
 *  그래서 각자 상대 두께의 **절반만큼** 꼭짓점 너머로 더 나간다. 외벽이 이웃
 *  두께의 "전부" 만큼 나가는 것과 다른 이유는, 외벽은 경계선 바깥으로 이미
 *  반 두께 밀려 있어 메워야 할 칸이 두 배 크기 때문이다.
 *
 *  ── 외벽에 닿는 끝 ────────────────────────────────────────────────────────
 *  내벽 끝이 영역 경계선에 얹히면 그 자리는 **외벽의 안쪽 면**이다. 딱 붙기는
 *  하지만 T 자 이음매가 선으로 남아 "댄 것" 처럼 보인다. 외벽 두께만큼 더
 *  밀어 넣어 몸통에 잠기게 하면 한 덩어리로 읽힌다.
 */
/**
 * 코너에서 얼마나 더 나가야 귀퉁이가 채워지는가 — **각도를 보고 정한다.**
 * ---------------------------------------------------------------------------
 *  두 벽이 꼭짓점에서 각 θ 로 만난다고 할 때(둘 다 꼭짓점에서 뻗어 나가는
 *  방향으로 잰다), 상대 벽의 반두께 h 를 덮으려면
 *
 *      e = h / tan(θ/2)
 *
 *  만큼 꼭짓점 너머로 나가야 한다. θ = 90° 면 tan45° = 1 이라 e = h — 지금까지
 *  쓰던 "상대 두께의 절반" 이 여기서 나온 특수한 경우다. 일직선(θ = 180°)이면
 *  e = 0 이고, 예각일수록 급격히 커진다.
 *
 *  ── 마이터 한계 ────────────────────────────────────────────────────────────
 *  아주 뾰족한 각에서는 e 가 발산해서 벽이 창처럼 길게 튀어나온다. 실제 도면용
 *  스트로크 렌더러들이 그러듯 상한을 둔다. 상한에 걸리면 귀퉁이가 조금 덜
 *  채워지지만, 화면 밖까지 뻗는 가시(spike)보다는 낫다.
 */
const MITER_LIMIT = 4;

function jointExtension(ourDir, otherDir, halfOther, ourThickness) {
  const dot = Math.max(-1, Math.min(1, ourDir[0] * otherDir[0] + ourDir[1] * otherDir[1]));
  const theta = Math.acos(dot);
  if (theta < 1e-3) return halfOther;           // 겹쳐 누움 — 더 볼 것이 없다
  const t = Math.tan(theta / 2);
  if (!(t > 1e-6)) return 0;                    // 일직선으로 이어짐
  return Math.min(halfOther / t, MITER_LIMIT * ourThickness);
}

export function wallJoints(wall, { walls = [], areas = [] } = {}, eps = 0.05) {
  const near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= eps;
  const dirFrom = (from, to) => {
    const dx = to[0] - from[0];
    const dz = to[1] - from[1];
    const l = Math.hypot(dx, dz) || 1;
    return [dx / l, dz / l];
  };
  const t0 = wall.thickness ?? WALL_DEFAULTS.thickness;

  const at = (end, other) => {
    const ourDir = dirFrom(end, other);          // 이 끝에서 벽이 뻗어 나가는 방향
    let ext = 0;

    /* 다른 내벽과 끝을 맞댄 코너 */
    for (const w of walls) {
      if (w.uid === wall.uid) continue;
      const meetsA = near(end, w.a);
      const meetsB = near(end, w.b);
      if (!meetsA && !meetsB) continue;
      const otherDir = meetsA ? dirFrom(w.a, w.b) : dirFrom(w.b, w.a);
      const h = (w.thickness ?? WALL_DEFAULTS.thickness) / 2;
      ext = Math.max(ext, jointExtension(ourDir, otherDir, h, t0));
    }

    /* 영역의 외벽에 닿은 끝 — 벽 몸통 속으로 넣는다.
       외벽은 경계선 바깥으로 반 두께 밀려 있으므로 두께 전부만큼 들어가야
       바깥면까지 닿는다(각도와 무관하다 — 면에 파묻는 것이라서). */
    for (const ar of areas) {
      for (const e of mpEdges(ar.mp)) {
        const p = projectOn({ a: e.a, b: e.b }, end);
        if (p && p.dist <= eps) ext = Math.max(ext, edgeSpec(ar, e.key).thickness);
      }
    }
    return ext;
  };

  return { atA: at(wall.a, wall.b), atB: at(wall.b, wall.a) };
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

/* ── 개구부 ────────────────────────────────────────────────────────────── */

/**
 * 도면 위의 모든 벽선 목록 — 영역 외벽 + 내벽.
 *  개구부를 어디에 붙일지 찾을 때와, 클릭한 자리를 벽에 맞춰 앉힐 때 쓴다.
 *  외벽의 기준선은 **영역 경계선**이다(벽은 거기서 바깥으로 밀려 서 있다).
 */
export function wallLines(areas = [], walls = []) {
  const out = [];
  for (const ar of areas) {
    for (const e of mpEdges(ar.mp)) {
      out.push({ kind: 'area', areaUid: ar.uid, key: e.key, a: e.a, b: e.b, spec: edgeSpec(ar, e.key) });
    }
  }
  for (const w of walls) {
    out.push({ kind: 'wall', wallUid: w.uid, key: w.uid, a: w.a, b: w.b, spec: w });
  }
  return out;
}

/** 선분 위로 점을 내린 결과 { u, dist, t } — u 는 a 에서 잰 길이 */
function projectOn(line, [px, pz]) {
  const dx = line.b[0] - line.a[0];
  const dz = line.b[1] - line.a[1];
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return null;
  const u = ((px - line.a[0]) * dx + (pz - line.a[1]) * dz) / len;
  const cu = Math.max(0, Math.min(len, u));
  const qx = line.a[0] + (dx / len) * cu;
  const qz = line.a[1] + (dz / len) * cu;
  return { u: cu, len, dist: Math.hypot(px - qx, pz - qz), at: [clean(qx), clean(qz)] };
}

/**
 * 클릭한 자리에서 가장 가까운 벽을 찾아 그 위에 앉힌다.
 *  개구부는 벽에 뚫는 것이라 "벽에서 몇 cm 떨어진 개구부" 같은 것은 없다.
 *  못 찾으면 null — 호출부가 이유를 알려 준다.
 */
export function snapToWall(pt, { areas = [], walls = [] } = {}, maxDist = 3) {
  let best = null;
  for (const line of wallLines(areas, walls)) {
    const p = projectOn(line, pt);
    if (!p || p.dist > maxDist) continue;
    if (!best || p.dist < best.dist) best = { ...p, line };
  }
  return best;
}

/**
 * 이 벽선에 얹힌 개구부들 — 벽을 토막 낼 때 쓴다.
 *  u 는 벽의 a 끝에서 잰 거리다. 벽 두께의 절반에 여유를 더한 범위 안에 있는
 *  것만 이 벽의 것으로 본다(옆 벽에 뚫은 구멍이 딸려 오면 안 된다).
 */
export function openingsOn(line, openings = []) {
  const out = [];
  for (const o of openings) {
    const p = projectOn(line, o.at);
    if (!p) continue;
    const tol = (line.spec?.thickness ?? WALL_DEFAULTS.thickness) / 2 + OPENING_ATTACH_TOL;
    if (p.dist > tol) continue;
    /* 끝을 살짝 벗어난 것은 버린다 — 코너 너머 벽까지 뚫리는 것을 막는다 */
    if (p.u < -o.width / 2 || p.u > p.len + o.width / 2) continue;
    out.push({ uid: o.uid, u: p.u, width: o.width, height: o.height, sill: o.sill ?? 0 });
  }
  return out.sort((a, b) => a.u - b.u);
}

/**
 * 개구부를 반영한 벽 토막 목록.
 * ---------------------------------------------------------------------------
 *  벽 하나를 상자 하나로 그리면 구멍을 낼 수 없다. 길이 방향으로 잘라
 *  **기둥(구멍 사이의 벽) · 인방(구멍 위) · 밑턱(구멍 아래)** 으로 나눠 그린다.
 *  실제 건축이 그렇게 생겼기도 하고, 상자만으로 표현할 수 있어 형상이 가볍다.
 *
 *  @param u0,u1  이 벽이 차지하는 길이 구간 (코너 연장을 포함한 값)
 *  @returns [{ u0, u1, y0, y1 }]
 */
export function wallPieces(u0, u1, height, openings = []) {
  const holes = openings
    .map((o) => ({ ...o, s: o.u - o.width / 2, e: o.u + o.width / 2 }))
    .filter((o) => o.e > u0 && o.s < u1)
    .sort((a, b) => a.s - b.s);

  if (!holes.length) return [{ u0, u1, y0: 0, y1: height }];

  const out = [];
  let cursor = u0;
  for (const h of holes) {
    const s = Math.max(u0, h.s);
    const e = Math.min(u1, h.e);
    if (s > cursor) out.push({ u0: cursor, u1: s, y0: 0, y1: height });   // 구멍 사이 벽

    const top = Math.min(height, h.sill + h.height);
    if (h.sill > 0) out.push({ u0: s, u1: e, y0: 0, y1: h.sill });        // 밑턱(창)
    if (top < height) out.push({ u0: s, u1: e, y0: top, y1: height });    // 인방(구멍 위)

    cursor = Math.max(cursor, e);
  }
  if (cursor < u1) out.push({ u0: cursor, u1, y0: 0, y1: height });
  return out.filter((p) => p.u1 - p.u0 > 1e-4 && p.y1 - p.y0 > 1e-4);
}

/**
 * 개구부를 "드나들 수 있는 문" 목록으로 편다.
 *  트럭이 벽을 뚫고 나가지 못하게 하려면 나가는 자리가 문인지 알아야 한다.
 *  { at:[x,z], r } — 문 중심과 그 반경(폭의 절반에 차체 여유를 더한 값).
 */
export function openingGates(openings = [], lines = [], margin = 1.0) {
  const out = [];
  for (const o of openings) {
    for (const line of lines) {
      const hit = openingsOn(line, [o]);
      if (!hit.length) continue;
      const dx = line.b[0] - line.a[0];
      const dz = line.b[1] - line.a[1];
      const len = Math.hypot(dx, dz) || 1;
      out.push({
        uid: o.uid,
        at: [line.a[0] + (dx / len) * hit[0].u, line.a[1] + (dz / len) * hit[0].u],
        r: o.width / 2 + margin,
      });
      break;
    }
  }
  return out;
}

/** 이 지점이 어떤 문 안인가 */
export const inGate = (gates, [x, z]) =>
  gates.some((g) => Math.hypot(g.at[0] - x, g.at[1] - z) <= g.r);

/**
 * 선분이 바닥 경계를 넘는 자리들.
 * ---------------------------------------------------------------------------
 *  두 점을 훑으며 "안 → 밖" 또는 "밖 → 안" 으로 바뀌는 지점을 모은다.
 *  다각형과 선분의 교점을 정확히 푸는 대신 촘촘히 찍어 보는 이유는, 바닥이
 *  구멍 있는 다각형일 수도 있고 여러 조각일 수도 있어서 안팎 판정 자체를
 *  이미 pointInMP 에 맡기고 있기 때문이다. 같은 잣대를 쓰는 편이 안전하다.
 */
export function boundaryCrossings(a, b, floor, step = 0.15) {
  if (!floor) return [];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(1, Math.ceil(len / step));
  const out = [];
  let prevIn = pointInMP(floor, a);
  let prev = a;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const inside = pointInMP(floor, p);
    if (inside !== prevIn) out.push([(prev[0] + p[0]) / 2, (prev[1] + p[1]) / 2]);
    prevIn = inside;
    prev = p;
  }
  return out;
}

/**
 * 이 선분이 **벽을 뚫고** 지나가는가.
 * ---------------------------------------------------------------------------
 *  경계를 넘는 것 자체는 죄가 아니다 — 문으로 넘으면 된다. 그래서 "밖에 있는가"
 *  가 아니라 "넘는 자리가 문인가" 를 본다.
 *
 *  이 구분이 중요한 이유: 점 하나가 문에서 멀리 떨어졌다는 이유로 막으면,
 *  문을 통과해 **바깥 멀리까지** 이어지는 트럭 경로를 아예 그릴 수 없다.
 *  정작 막아야 할 것은 벽 한복판을 가로지르는 선이다.
 */
export function crossesWall(a, b, floor, gates = []) {
  if (!floor) return false;
  return boundaryCrossings(a, b, floor).some((p) => !inGate(gates, p));
}

/**
 * 이 벽의 이 지점에 걸린 개구부.
 * ---------------------------------------------------------------------------
 *  개구부는 벽에서 **빠진 자리**라 집을 덩어리가 없다. 바닥에 깐 문지방 띠에
 *  클릭을 걸어 뒀지만, 탑뷰에서는 문 위 인방(벽 조각)이 레이캐스트에 먼저
 *  걸려 이벤트를 가져가 버린다 — 위에서 내려다보면 인방이 더 가깝기 때문이다.
 *
 *  그래서 **벽이 클릭을 받은 자리**를 보고, 그 자리가 문의 폭 안이면 벽 대신
 *  문을 고른다. 보이는 대로(문을 눌렀으니 문이 잡힌다) 동작하고, 탑뷰든 3D든
 *  같은 규칙이라는 점도 좋다.
 */
export function openingAtPoint(line, openings = [], pt) {
  const p = projectOn(line, pt);
  if (!p) return null;
  for (const o of openingsOn(line, openings)) {
    if (Math.abs(p.u - o.u) <= o.width / 2) return openings.find((x) => x.uid === o.uid) ?? null;
  }
  return null;
}

/**
 * 개구부를 벽을 따라 옮긴다.
 *  벽에서 떼어 낼 수는 없으므로 **선 위로 내린 값**만 받고, 문이 벽 밖으로
 *  삐져나가지 않도록 양 끝에서 폭의 절반만큼 물려 둔다.
 */
export function slideOpening(line, opening, pt) {
  const p = projectOn(line, pt);
  if (!p) return null;
  const half = opening.width / 2;
  const u = Math.max(Math.min(half, p.len / 2), Math.min(p.len - half, Math.max(half, p.u)));
  const dx = line.b[0] - line.a[0];
  const dz = line.b[1] - line.a[1];
  const len = Math.hypot(dx, dz) || 1;
  return [clean(line.a[0] + (dx / len) * u), clean(line.a[1] + (dz / len) * u)];
}

/** 개구부가 바닥에서 차지하는 네모 (설비 간섭 판정·바닥 표시용) */
export function openingFootprint(o, line) {
  const p = projectOn(line, o.at);
  if (!p) return null;
  const dx = line.b[0] - line.a[0];
  const dz = line.b[1] - line.a[1];
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len;
  const uz = dz / len;
  const t = (line.spec?.thickness ?? WALL_DEFAULTS.thickness);
  return { center: p.at, ux, uz, width: o.width, depth: t, angle: Math.atan2(dx, dz) };
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
