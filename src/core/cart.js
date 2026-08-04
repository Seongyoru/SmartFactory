/**
 * =============================================================================
 *  카트 — 경로 · 정차역
 * =============================================================================
 *  카트는 연결장치와 반대로 "경로를 먼저 그리고" 그 위를 왕복한다.
 *  경로는 사용자가 찍은 경유점 그대로이고(직교 라우팅을 하지 않는다),
 *  모서리만 둥글린다.
 *
 *  정차역은 따로 찍지 않는다. 경로가 설비 포트 옆을 지나가면 그 지점이
 *  자동으로 역이 된다 — 유출부 옆이면 싣고, 유입부 옆이면 내린다.
 *  이렇게 하면 "카트 경로를 설비 옆으로 지나가게 그린다" 는 행동 하나로
 *  적재·하역이 정의되어, 따로 배선할 게 없다.
 * ---------------------------------------------------------------------------
 */

import { buildFreePath } from './routing.js';
import { allPorts } from './link.js';
import { PORT_KIND } from './ports.js';

/** 경로에서 이 거리 안으로 지나가는 포트를 역으로 삼는다(m) */
export const STATION_DIST = 3.5;

/**
 * 포트 정면으로 인정하는 범위(코사인).
 *  거리만 보면 설비 옆구리를 스쳐 지나가는 경로까지 역이 되어 버린다.
 *  설비 하나의 유입·유출부는 앞뒤 면에 붙어 있으므로, 옆을 지나가면 두 포트가
 *  동시에 걸려 싣자마자 내리는 우스운 동작이 된다.
 *  포트가 열린 방향 쪽으로 지나갈 때만 역으로 본다(약 ±69°).
 */
const FRONT_COS = 0.35;

export function cartPath(cart) {
  if (!cart?.points || cart.points.length < 2) return null;
  return buildFreePath(cart.points, {
    closed: cart.closed,
    radius: cart.radius ?? 1.2,
    y: cart.y ?? 0,
  });
}

/** 점에서 경로까지의 최단 지점을 호 길이로 찾는다 (간단히 촘촘히 훑는다) */
function closestOnPath(path, [x, z], step = 0.25) {
  const L = path.length;
  let bestS = 0;
  let bestD = Infinity;
  const n = Math.max(2, Math.ceil(L / step));
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * L;
    const p = path.at(s).pos;
    const d = Math.hypot(p[0] - x, p[2] - z);
    if (d < bestD) { bestD = d; bestS = s; }
  }
  return { s: bestS, dist: bestD };
}

/**
 * 경로 위의 정차역 목록.
 *  { s, kind:'load'|'unload', uid, portId, count }
 *  count 는 그 설비가 한 번에 내보내는 수량이다(적재 시에만 의미).
 */
export function cartStations(path, placedList, itemOf) {
  if (!path) return [];
  const out = [];
  for (const port of allPorts(placedList, itemOf)) {
    if (port.kind !== PORT_KIND.IN && port.kind !== PORT_KIND.OUT) continue;
    const { s, dist } = closestOnPath(path, [port.world[0], port.world[2]]);
    if (dist > STATION_DIST) continue;

    // 포트 정면을 지나가는가
    const at = path.at(s).pos;
    const vx = at[0] - port.world[0];
    const vz = at[2] - port.world[2];
    const len = Math.hypot(vx, vz);
    if (len > 1e-3) {
      const cos = (vx * port.dir[0] + vz * port.dir[1]) / len;
      if (cos < FRONT_COS) continue;
    }

    const owner = placedList.find((p) => p.uid === port.uid);
    out.push({
      s,
      dist,
      kind: port.kind === PORT_KIND.OUT ? 'load' : 'unload',
      uid: port.uid,
      portId: port.id,
      name: owner?.name ?? port.uid,
      count: Math.max(0, owner?.outputCount ?? 3),
    });
  }
  return out.sort((a, b) => a.s - b.s);
}

/**
 * 이번 프레임에 지나친 역들.
 *  닫힌 경로에서는 끝을 넘어 감기므로 s1 < s0 가 될 수 있다. 그 경우를
 *  "구간이 두 토막" 으로 보고 걸러 낸다.
 */
export function crossedStations(stations, s0, s1, dir) {
  if (!stations.length) return [];
  if (dir >= 0) {
    return s1 >= s0
      ? stations.filter((st) => st.s > s0 && st.s <= s1)
      : stations.filter((st) => st.s > s0 || st.s <= s1);
  }
  return s1 <= s0
    ? stations.filter((st) => st.s < s0 && st.s >= s1)
    : stations.filter((st) => st.s < s0 || st.s >= s1);
}

/**
 * 한 프레임만큼 카트를 전진시킨다.
 * ---------------------------------------------------------------------------
 *  useFrame 안에 두면 눈으로만 확인할 수 있어서 순수 함수로 뺐다.
 *  들어온 상태를 바꾸지 않고 다음 상태를 돌려준다.
 *
 *  @param st  { s, dir, pause, carried }
 *  @returns   같은 모양 + { arrived } (이번에 도착한 역, 없으면 null)
 */
export function stepCart(st, { length, closed, speed, dwell }, stations, dt) {
  const L = length;
  if (!(L > 0.01)) return { ...st, arrived: null };

  // 정차 중이면 시간만 흘린다
  if (st.pause > 0) return { ...st, pause: st.pause - dt, arrived: null };

  const step = speed * Math.min(dt, 0.1) * st.dir;
  let s1 = st.s + step;
  let dir = st.dir;

  if (closed) {
    s1 = ((s1 % L) + L) % L;
  } else if (s1 > L) {
    s1 = Math.max(0, L - (s1 - L));   // 끝에서 되돌아온다
    dir = -1;
  } else if (s1 < 0) {
    s1 = Math.min(L, -s1);
    dir = 1;
  }

  const hit = crossedStations(stations, st.s, s1, st.dir);
  if (!hit.length) return { s: s1, dir, pause: 0, carried: st.carried, arrived: null };

  // 한 프레임에 여러 역을 지났다면 마지막 것이 최종 상태다
  const last = hit[hit.length - 1];
  return {
    s: s1,
    dir,
    pause: dwell,
    carried: last.kind === 'load' ? last.count : 0,
    arrived: last,
  };
}
