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
import { isShelf } from '../data/library.js';
import { ZONE, shelfCapacity, shelfZones } from './shelf.js';
import { rotateXZ } from './grid.js';
import { getSpec } from './modelStore.js';

/** 경로에서 이 거리 안으로 지나가는 포트를 역으로 삼는다(m) */
export const STATION_DIST = 3.5;

/**
 * 역의 표시 규칙 — 색과 이름의 유일한 출처.
 * ---------------------------------------------------------------------------
 *  씬의 정차역 링과 인스펙터 목록이 각자 색을 정하다가, 구역을 입고/출고로
 *  나눈 뒤에도 옛 분류를 보고 있어서 둘 다 "내리기(초록)" 로 나왔다.
 *  바닥 구역 색과도 반드시 같아야 하므로 한 곳에 모은다.
 *
 *    주황 = 카트가 **싣는** 곳  (설비 유출부 · 선반 출고 구역)
 *    초록 = 카트가 **내리는** 곳 (설비 유입부 · 선반 입고 구역)
 */
export const STATION_STYLE = {
  load: { color: '#fb923c', label: '싣기' },
  'shelf-out': { color: '#fb923c', label: '싣기' },
  unload: { color: '#34d399', label: '내리기' },
  'shelf-in': { color: '#34d399', label: '내리기' },
};

export const stationStyle = (kind) => STATION_STYLE[kind] ?? STATION_STYLE.unload;

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
      /* 한 설비의 유입·유출부는 서로 다른 역이다 — 키를 포트까지 포함해야
         "싣고 나서 곧바로 내리는" 정상 동작이 중복으로 막히지 않는다 */
      key: `${port.uid}:${port.id}`,
      name: owner?.name ?? port.uid,
      count: Math.max(0, owner?.outputCount ?? 3),
    });
  }

  /* 선반 — 입고 구역과 출고 구역을 따로 잡는다.
     구역마다 앞뒤 양면을 훑어 경로에 가장 가까운 지점을 역으로 삼는다. */
  for (const p of placedList) {
    const item = itemOf(p.itemId);
    if (!isShelf(item)) continue;
    const spec = item.modelKey ? getSpec(item.modelKey) : null;

    const best = {};   // kind → { s, dist }
    for (const z of shelfZones(p, spec)) {
      const dir = rotateXZ(z.dir, p.rot);
      const samples = Math.max(2, Math.ceil(z.w) + 1);
      for (let i = 0; i < samples; i++) {
        const lx = z.cx - z.w / 2 + (i * z.w) / (samples - 1);
        const [ox, oz] = rotateXZ([lx, z.fz], p.rot);
        const at2 = [p.pos[0] + ox, p.pos[1] + oz];
        const hit = closestOnPath(path, at2);
        if (hit.dist > STATION_DIST) continue;

        const at = path.at(hit.s).pos;
        const vx = at[0] - at2[0];
        const vz = at[2] - at2[1];
        const len = Math.hypot(vx, vz);
        if (len > 1e-3 && (vx * dir[0] + vz * dir[1]) / len < FRONT_COS) continue;
        if (!best[z.kind] || hit.dist < best[z.kind].dist) best[z.kind] = { s: hit.s, dist: hit.dist };
      }
    }

    /* 한 선반은 한 카트 경로에 대해 **역할 하나**만 갖는다.
       ---------------------------------------------------------------------
       경로 끝이 선반 옆에서 맴돌면 입고 구역과 출고 구역이 몇 미터 사이로
       둘 다 잡혀서, 같은 선반에서 실었다 내렸다를 반복하게 된다.
       경로가 더 가까이 지나가는 쪽 하나만 남긴다 — 그래야 "이 선반은 이 카트에게
       싣는 곳" 이라는 게 도면에서 한눈에 정해진다. */
    const kinds = Object.keys(best);
    if (!kinds.length) continue;
    const kind = kinds.reduce((a, b) => (best[b].dist < best[a].dist ? b : a));
    const hit = best[kind];

    out.push({
      s: hit.s,
      dist: hit.dist,
      kind: kind === ZONE.IN ? 'shelf-in' : 'shelf-out',
      uid: p.uid,
      key: p.uid,
      name: p.name ?? p.uid,
      capacity: shelfCapacity(p, spec),
      /** 빈 카트가 오면 실어 보낼 수량 */
      dispatch: Math.max(0, p.dispatchCount ?? 3),
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
 *  @param st  { s, dir, pause, lastKey }
 *  @returns   { s, dir, pause, arrived }
 *
 *  lastKey — 직전에 **실제로 자재를 주고받은** 역. 같은 역을 연달아 처리하지
 *  않기 위한 기억이다. 왕복 경로에서는 되돌아오며 같은 선반을 다시 지나는데,
 *  그때마다 반응하면 한 선반에서 넣었다 뺐다를 반복한다. 다른 역에서 무언가를
 *  주고받으면 풀린다.
 *
 *  "지나가기만 하고 아무 일도 없었던" 경우는 들른 것으로 치지 않는다.
 *  빈 카트가 입고 구역을 지났다는 이유로 바로 옆 출고 구역이 막히면 곤란하다.
 */
export function stepCart(st, { length, closed, speed, dwell }, stations, dt) {
  const L = length;
  if (!(L > 0.01)) return { s: st.s, dir: st.dir, pause: st.pause, arrived: null };

  // 정차 중이면 시간만 흘린다
  if (st.pause > 0) return { s: st.s, dir: st.dir, pause: st.pause - dt, arrived: null };

  const dir0 = st.dir;
  const step = speed * Math.min(dt, 0.1) * dir0;
  let s1 = st.s + step;
  let dir = st.dir;

  if (closed) {
    s1 = ((s1 % L) + L) % L;
  } else if (s1 > L) {
    /* 끝점을 **정확히 밟고** 다음 프레임에 되돌아간다.
       튕겨 나온 위치로 바로 접어 버리면 경로 맨 끝(s = 0 또는 L)에 있는
       정차역을 영영 지나치지 못한다. 구간 판정이 반개구간이라 끝값이 빠지기
       때문인데, 그러면 "끝에서 싣고 반대쪽 끝에서 내리는" 왕복 경로가
       한쪽만 동작해서 카트가 짐을 든 채 계속 오가게 된다. */
    s1 = L;
    dir = -1;
  } else if (s1 < 0) {
    s1 = 0;
    dir = 1;
  }

  const crossed = crossedStations(stations, st.s, s1, st.dir);
  // 직전에 "실제로 주고받은" 역은 건너뛴다
  const hit = crossed.filter((x) => (x.key ?? x.uid) !== st.lastKey);
  if (!hit.length) return { s: s1, dir, pause: 0, arrived: null };

  /* 한 프레임에 여러 역을 지났다면 마지막 것만 처리한다.
     자재가 실제로 오갔는지(수용량·재고에 달렸다)는 여기서 알 수 없으므로
     역만 알려 주고, 수량 계산과 lastKey 갱신은 호출부가 맡는다. */
  return { s: s1, dir, pause: dwell, arrived: hit[hit.length - 1] };
}
