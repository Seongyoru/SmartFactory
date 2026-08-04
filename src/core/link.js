/**
 * =============================================================================
 *  연결(link) 해석 — 끝점 → 실제 경로
 * =============================================================================
 *  연결은 "끝점 두 개" 로만 저장한다. 경로(길이·꺾임·타일 개수)는 저장하지 않고
 *  매번 다시 계산한다. 그래야 설비를 옮기면 컨베이어가 알아서 따라 늘어나고
 *  다시 꺾인다 — 이게 이 에디터의 핵심 동작이다.
 *
 *  끝점은 두 종류다.
 *    { uid, portId }               설비의 포트에 물린 끝
 *    { point:[x,z], y, dir:[dx,dz] } 바닥의 자유 끝 (아직 설비가 없는 자리)
 * ---------------------------------------------------------------------------
 */

import { getSpec } from './modelStore.js';
import { worldPorts } from './ports.js';
import { buildConnectorPath } from './routing.js';

/** 배치된 설비 하나의 월드 포트 목록 */
export function portsOf(placed, item) {
  const spec = item?.modelKey ? getSpec(item.modelKey) : null;
  if (!spec) return [];
  return worldPorts(placed, spec);
}

/** 도면 전체의 포트 목록 (연결 대상 후보) */
export function allPorts(placedList, itemOf) {
  const out = [];
  for (const p of placedList) out.push(...portsOf(p, itemOf(p.itemId)));
  return out;
}

/**
 * 끝점을 월드 좌표 + 방향으로 푼다. 대상이 사라졌으면 null.
 * ---------------------------------------------------------------------------
 *  끝점은 네 종류다.
 *    { uid, portId }             설비의 자재 포트 (컨베이어·레일)
 *    { uid, anchor, local, y }   설비에 붙은 부속 접점 (배관·전선)
 *                                설비 로컬 좌표로 잡아 두므로 설비를 돌려도 따라 돈다
 *    { link, t, y }              다른 배관 위의 분기점 (T·+ 자)
 *    { point:[x,z], y, dir }     바닥의 자유 끝
 *
 *  ctx.links 는 분기(T)를 풀 때 필요하다. 배관이 배관을 물고 그 배관이 또…
 *  하는 순환을 막기 위해 깊이를 제한한다.
 */
export function resolveEndpoint(ep, placedList, itemOf, ctx = {}) {
  if (!ep) return null;
  const depth = ctx.depth ?? 0;

  if (ep.point) {
    return { world: [ep.point[0], ep.y ?? 0.6, ep.point[1]], dir: ep.dir ?? [1, 0], free: true };
  }

  /* 다른 배관 위의 분기점 */
  if (ep.link) {
    if (depth > 3 || !ctx.links) return null;
    const host = ctx.links.find((l) => l.uid === ep.link);
    if (!host) return null;
    const hostPath = linkPath(host, placedList, itemOf, { ...ctx, depth: depth + 1 });
    if (!hostPath) return null;
    const f = hostPath.at(Math.max(0, Math.min(1, ep.t ?? 0.5)) * hostPath.length);
    return { world: f.pos, dir: ep.dir ?? [1, 0], branch: true };
  }

  const placed = placedList.find((p) => p.uid === ep.uid);
  if (!placed) return null;

  /* 설비에 붙은 부속 접점 — 자재 포트와 무관하게 자기 높이에 붙는다 */
  if (ep.anchor) {
    const [lx, lz] = ep.local ?? [0, 0];
    const [wx, wz] = rotateLocal([lx, lz], placed.rot);
    const [dx, dz] = rotateLocal(ep.dir ?? [1, 0], placed.rot);
    return {
      world: [placed.pos[0] + wx, (placed.y ?? 0) + (ep.y ?? 1), placed.pos[1] + wz],
      dir: [dx, dz],
      anchored: true,
    };
  }

  const ports = portsOf(placed, itemOf(placed.itemId));
  return ports.find((p) => p.id === ep.portId) ?? ports[0] ?? null;
}

/* grid.js 의 rotateXZ 와 같은 식 (순환 import 회피) */
function rotateLocal([x, z], rot) {
  switch (((rot % 4) + 4) % 4) {
    case 1: return [-z, x];
    case 2: return [-x, -z];
    case 3: return [z, -x];
    default: return [x, z];
  }
}

/* ---------------------------------------------------------------------------
 * 레이어 (층)
 * ---------------------------------------------------------------------------
 *  레일끼리 평면상 겹치면 위층으로 쌓는다. 층 간격은 벨트 한 대(≈0.4m)가
 *  아래를 지나가고도 자재가 걸리지 않을 만큼 띄운다.
 *  올라가고 내려오는 건 양 끝의 경사 구간에서만 일어나고, 가운데는 평평하다.
 *  (지지 다리는 그리지 않는다 — 가시화 목적의 모델이라 다리가 없다)
 * ------------------------------------------------------------------------- */
export const LAYER_HEIGHT = 1.0;
export const LAYER_RAMP = 3.0;
export const MAX_LAYER = 8;

export const layerLift = (layer) => (layer ?? 0) * LAYER_HEIGHT;

/**
 * 연결 하나의 경로를 만든다.
 *  radius(코너 반경)·layer(층)는 연결마다 따로 조절할 수 있게 링크에 저장돼 있다.
 */
export function linkPath(link, placedList, itemOf, ctx = {}) {
  let from = resolveEndpoint(link.from, placedList, itemOf, ctx);
  let to = resolveEndpoint(link.to, placedList, itemOf, ctx);
  if (!from || !to) return null;

  /* 배관·전선의 설치 높이를 나중에 바꾼 경우.
     끝점에는 만들 당시의 높이가 적혀 있으므로, 링크에 높이가 따로 지정돼
     있으면 그쪽이 이긴다. 다른 배관에 물린 분기점은 그 배관을 따라가야 하니
     건드리지 않는다. */
  if (link.height != null) {
    const lift = (e) => (e.branch ? e : { ...e, world: [e.world[0], link.height, e.world[2]] });
    from = lift(from);
    to = lift(to);
  }
  return buildConnectorPath(from, to, {
    radius: link.radius ?? 1,
    stub: link.stub ?? 0.5,
    waypoints: link.waypoints,
    lift: layerLift(link.layer),
    rampLen: LAYER_RAMP,
  });
}

/* ---------------------------------------------------------------------------
 * 경로 겹침 판정
 * ---------------------------------------------------------------------------
 *  교차(X 자)만 보면 나란히 겹쳐 달리는 경우를 놓친다. 그래서 한쪽 경로를
 *  일정 간격으로 찍어 다른 경로까지의 최단 거리를 재고, 폭 안으로 들어오면
 *  겹친 것으로 본다.
 *
 *  양 끝 근처는 제외한다. 같은 설비의 포트에서 갈라져 나가는 두 벨트는 출발
 *  지점이 가까울 수밖에 없는데, 그걸 겹침으로 세면 멀쩡한 연결이 자꾸 위층으로
 *  올라간다.
 * ------------------------------------------------------------------------- */

/** 점에서 선분까지의 거리 */
function distToSegment([px, pz], [ax, az], [bx, bz]) {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

const distToPath = (p, path) => {
  let best = Infinity;
  for (let i = 1; i < path.pts.length; i++) {
    const d = distToSegment(p, path.pts[i - 1], path.pts[i]);
    if (d < best) best = d;
  }
  return best;
};

const nearEnds = (p, path, r) => {
  const a = path.pts[0];
  const b = path.pts[path.pts.length - 1];
  return Math.hypot(p[0] - a[0], p[1] - a[1]) < r || Math.hypot(p[0] - b[0], p[1] - b[1]) < r;
};

export function pathsOverlap(a, b, clearance = 1.0, ignoreEnds = 1.5) {
  if (!a || !b || a.length < 1e-3 || b.length < 1e-3) return false;
  const step = Math.max(0.35, clearance * 0.5);
  const n = Math.ceil(a.length / step);
  for (let i = 0; i <= n; i++) {
    const p2 = a.at((i / n) * a.length).pos;
    const p = [p2[0], p2[2]];
    if (nearEnds(p, a, ignoreEnds) || nearEnds(p, b, ignoreEnds)) continue;
    if (distToPath(p, b) < clearance) return true;
  }
  return false;
}

/**
 * 새 연결이 놓일 층을 정한다.
 *  0층부터 올라가면서, 그 층에 이미 있는 레일과 겹치지 않는 첫 층을 고른다.
 *  경로의 높이는 층에 따라 달라지지만 평면 형상은 같으므로 경로를 다시 만들
 *  필요 없이 평면 겹침만 보면 된다.
 */
export function autoLayer(newPath, existing, clearance = 1.0) {
  for (let layer = 0; layer < MAX_LAYER; layer++) {
    const busy = existing.filter((e) => (e.link.layer ?? 0) === layer);
    if (!busy.some((e) => pathsOverlap(newPath, e.path, clearance))) return layer;
  }
  return MAX_LAYER;
}

/**
 * 커서에서 가장 가까운 포트 (스냅 후보).
 *  이미 다른 연결이 물려 있는 포트도 후보로 둔다 — 분기(合流)를 막을 이유가 없다.
 *  accept 로 후보를 걸러낼 수 있다. 연결 중에는 이걸로 유입↔유입 같은
 *  불가능한 조합을 아예 스냅 대상에서 빼서, 붙었다가 거절당하는 일이 없게 한다.
 */
export function nearestPort(ports, [x, z], maxDist, exclude = null, accept = null) {
  let best = null;
  let bestD = maxDist;
  for (const p of ports) {
    if (exclude && p.key === exclude) continue;
    if (accept && !accept(p)) continue;
    const d = Math.hypot(p.world[0] - x, p.world[2] - z);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}
