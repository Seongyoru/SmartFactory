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
import { PORT_KIND, PORT_ZONE_REACH } from './ports.js';
import { canonKind, isShelf, isStillage } from '../data/library.js';
import { inputCapOf, isSource, outputKindOf, recipeOf } from './bom.js';
import { ZONE, perRow, rowGroupOf, shelfCapacity, shelfZones } from './shelf.js';
import { stillageCapacity } from './stillage.js';
import { rotateXZ } from './grid.js';
import { getSpec } from './modelStore.js';

/**
 * 역으로 인정하는 거리 — 경로가 **설비의 면에서** 이만큼 안으로 지나가야 한다(m).
 * ---------------------------------------------------------------------------
 *  3.5m 였다. 그 정도면 카트가 통로 건너편을 지나가도 역이 되어, 옆 통로를 스치는
 *  경로 하나가 선반 여러 장을 한꺼번에 물었다. 실제로 짐을 주고받으려면 카트가
 *  그 앞에 바짝 붙어야 하므로 1m 로 줄인다 — 카트 폭이 1.4m 쯤이니, 경로가 면에서
 *  1m 면 차체는 사실상 면에 닿아 지나간다.
 *
 *  기준이 **면**이라는 점이 중요하다. 설비 포트와 선반의 입출고 구역은 좌표
 *  자체가 면 위에 있어 그냥 재면 되지만, 적치대는 중심 좌표만 있으므로 상판의
 *  반너비를 빼고 잰다(아래). 안 그러면 같은 1m 가 적치대에서만 "중심에서 1m"
 *  = 면에서 0.25m 가 되어 사실상 아무 경로도 안 걸린다.
 */
export const STATION_DIST = 1.0;

/**
 * 적치대만 더 넉넉하게.
 * ---------------------------------------------------------------------------
 *  선반은 앞면이 길게 뻗어 있어 카트가 그 앞을 스치듯 지나간다. 적치대는 1.5m
 *  짜리 상자 하나뿐이라 같은 1m 를 주면 **바닥에 깔린 초록 띠(포트 구역)보다도
 *  안쪽**으로 들어가야 잡힌다 — 눈에 보이는 자리를 지나가는데도 서지 않으니,
 *  도면이 거짓말을 하는 셈이다.
 *
 *  그래서 그 띠의 바깥 끝(포트에서 `PORT_ZONE_REACH` = 1.6m)까지를 기준으로 삼고
 *  조금 여유를 둔다. 보이는 만큼 잡힌다.
 */
export const STILLAGE_DIST = PORT_ZONE_REACH + 0.4;

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

/**
 * 이번 역에서 몇 개나 더 실을 수 있는가.
 * ---------------------------------------------------------------------------
 *  ── 카트 (topUp = false) ─────────────────────────────────────────────────
 *  **비어 있을 때만** 싣는다. 한 곳에서 받아 다른 곳에 옮기는 것이 카트의 일이라,
 *  가는 길에 이것저것 주워 담으면 어디에 무엇을 내려놓아야 하는지가 흐려진다.
 *  실을 양은 그 역이 권하는 값(want)을 따른다.
 *
 *  ── 트럭 (topUp = true) ──────────────────────────────────────────────────
 *  하는 일이 "밖으로 내보내기" 하나뿐이라 목적지가 갈리지 않는다. 첫 역에서 다
 *  못 채웠는데 그대로 나가면 반쯤 빈 차가 왕복하게 되므로, **자리가 남는 동안
 *  다음 역에서 마저 채운다.** 다 차면 0 이 되어 남은 역을 그냥 지나친다.
 *
 *  @param want 그 역이 권하는 양 (선반의 dispatch · 설비의 count). 트럭은 안 본다
 */
export function loadRoom(carried, capacity, topUp, want) {
  if (topUp) return Math.max(0, capacity - carried);
  return carried === 0 ? Math.max(0, want ?? 0) : 0;
}

/** 이 차량이 한 번에 실을 수 있는 최대치 */
export const cartCapacity = (cart, truck = false) =>
  Math.max(0, cart?.loadCount ?? (truck ? 10 : 3));

/**
 * 이 역이 권하는 실을 양 — **차량 쪽 값이 역의 값을 이긴다.**
 *  `CartView` 가 `cart.loadCount ?? a.dispatch` 로 부르는 그 규칙이다. 손으로
 *  옮겨 적으면 반드시 어긋난다 — 실제로 어긋나서 수송 능력을 20배 낮게 봤다.
 */
export function stationWant(cart, st) {
  if (!st) return 0;
  /* 설비 유출부는 그 설비가 내보내는 덩어리 크기를 따른다 (차량 값이 아니다) */
  if (st.kind === 'load') return Math.max(0, st.count ?? 0);
  if (st.kind === 'shelf-out') return Math.max(0, cart?.loadCount ?? st.dispatch ?? 0);
  return 0;
}

/**
 * 이 차량이 나를 수 있는 양 (개/분).
 * ---------------------------------------------------------------------------
 *  **설비 능력과 나란히 놓고 보라고 있는 값**이다. 만드는 속도가 나르는 속도를
 *  넘으면 쌓이는 곳이 차고, 그다음은 라인 전체가 선다. 그런데 그걸 알려면
 *  대수 · 한 번에 싣는 양 · 경로 길이 · 속도 · 정차 시간을 전부 곱해야 해서,
 *  놓고 나서 한참 돌려 보기 전에는 알 수가 없었다.
 *
 *  ── 한 바퀴에 한 번 싣고 한 번 내린다 ────────────────────────────────────
 *  카트는 **비어 있을 때만** 싣고, 내려놓아야 다시 싣는다(`loadRoom`). 그래서
 *  한 바퀴당 나르는 양이 곧 한 번에 싣는 양이다. 트럭은 자리가 찰 때까지 여러
 *  역에서 나눠 담으므로 적재량 전부를 한 바퀴로 본다.
 *
 *  정차 시간은 **실제로 주고받은 역에서만** 든다(`acted` 일 때만 선다). 카트는
 *  두 번, 트럭은 들르는 싣기 역 수만큼으로 본다.
 *
 *  @returns { perMinute, perLap, lapSec, fleet, loadStations } · 못 구하면 null
 */
export function haulPerMinute(cart, path, stations, { truck = false } = {}) {
  if (!cart || !path || !(path.length > 0)) return null;
  const list = stations ?? [];
  const loads = list.filter((s) => s.kind === 'load' || s.kind === 'shelf-out');
  const drops = list.filter((s) => s.kind === 'unload' || s.kind === 'shelf-in');
  /* 실을 데가 없으면 나를 것이 없고, 트럭이 아닌데 내릴 데가 없으면 한 바퀴만
     싣고 영영 못 내린다 — 둘 다 처리량 0 이다 */
  if (!loads.length || (!truck && !drops.length)) {
    return { perMinute: 0, perLap: 0, lapSec: 0, fleet: 0, loadStations: loads.length };
  }

  const cap = cartCapacity(cart, truck);
  const wants = loads.map((s) => stationWant(cart, s));
  /* 카트는 한 역에서 한 번만 싣는다. 역마다 값이 다르면 가장 많이 실을 수 있는
     쪽을 쓴다 — 어느 역에 먼저 닿는지는 위치에 달렸으므로 좋은 쪽으로 잡는다. */
  const perLap = truck ? cap : Math.min(cap, Math.max(0, ...wants));

  const speed = Math.max(0.01, cart.speed ?? 1.4);
  const dwell = Math.max(0, cart.dwell ?? 1.2);
  const stops = truck ? loads.length : 2;
  const lapSec = path.length / speed + stops * dwell;
  const fleet = Math.max(1, Math.round(cart.count ?? 1));

  return {
    perMinute: lapSec > 0 ? (fleet * perLap) / lapSec * 60 : 0,
    perLap,
    lapSec,
    fleet,
    loadStations: loads.length,
  };
}

/**
 * 방금 주고받은 역을 언제까지 건너뛸 것인가.
 * ---------------------------------------------------------------------------
 *  역에서 주고받고 나면 그 역을 **한 번은** 건너뛰어야 한다. 짐을 주고받은 자리에
 *  선 채로 왕복 경로의 끝을 만나 곧바로 되돌아오면, 같은 역이 그 자리에서 다시
 *  걸려 무한히 되풀이되기 때문이다.
 *
 *  ── 그런데 "다음에 다른 데서 뭔가 할 때까지" 는 너무 길었다 ────────────────
 *  예전에는 **다른 역에서 실제로 주고받아야만** 이 기억이 풀렸다. 그래서 이런
 *  교착이 생겼다.
 *
 *    1. 하역역 B 에 자리가 조금밖에 없어 **일부만** 내린다 (기억 = B, 짐이 남음)
 *    2. 적재역 A 로 간다 — 카트는 비어야 싣는데 짐이 남아 있어 아무 일도 없다
 *       (기억은 여전히 B)
 *    3. B 로 돌아온다 — **기억이 B 라서 통째로 걸러진다.** 그 사이 B 에 자리가
 *       났어도 서지 않고 그냥 지나간다
 *    4. 2 와 3 이 영원히 되풀이된다
 *
 *  기억을 풀어 주는 조건이 "다른 역에서의 성공" 이 아니라 **그 역에서 충분히
 *  멀어졌는가** 여야 한다. 멀어졌다면 그것은 새로 들르는 것이지, 방금 그 자리에
 *  머무르는 것이 아니다.
 */
export const STATION_RESET_DIST = 1.5;

export function forgetStation(lastKey, lastS, s, length, closed) {
  if (!lastKey || lastS == null) return lastKey ?? null;
  const d = Math.abs(s - lastS);
  const away = closed && length > 0 ? Math.min(d, length - d) : d;
  return away > STATION_RESET_DIST ? null : lastKey;
}

/**
 * 앞차와 지켜야 할 최소 간격 — 차체 길이에 더할 여유(m).
 *  간격의 바탕은 차체 길이다. 두 대가 붙어 설 수 있는 최소 거리가 곧 차 한 대의
 *  길이이기 때문이다. 여기에 조금 더 둔다.
 */
export const CART_MARGIN = 0.6;

/**
 * 앞차에 막혀 이번 프레임에 갈 수 있는 거리.
 * ---------------------------------------------------------------------------
 *  한 경로에 여러 대를 올리면 **출발할 때만** 등간격이었다(startS 가 경로 길이를
 *  대수로 나눈다). 그 뒤로는 유지되지 않는다 — 역에서 실제로 주고받은 차만
 *  `dwell` 만큼 서기 때문에, 선 차는 뒤처지고 뒤차는 그대로 와서 붙는다.
 *  그런데 붙어도 아무 일이 없었다. 차끼리 판정이 아예 없어서 **서로 겹쳐
 *  지나갔다.** 화면에서는 몇 대가 한 덩어리로 뭉쳐 다니는 것으로 보인다.
 *
 *  실제 AGV 라인에서 이건 그냥 보기 나쁜 것이 아니라 **처리량을 정하는 요소**다.
 *  앞차가 역에서 서 있으면 뒤차도 못 간다. 그 대기가 없으면 카트를 몇 대든
 *  올릴수록 처리량이 늘어나는 것으로 나와, 대수를 정하는 데 쓸 수 없는 숫자가
 *  된다. 그래서 겹치지 못하게 막는다 — 추월도 없다(통로가 하나다).
 *
 *  ── 마주 오는 차는 막지 않는다 ───────────────────────────────────────────
 *  왕복 경로에서는 한 대가 끝에서 돌아서면 두 대가 마주 본다. 그때도 막으면
 *  둘 다 영영 못 가는 **교착**이 된다(실제 단선 왕복 궤도에서 벌어지는 일이고,
 *  그래서 현장은 고리를 쓴다). 여기서는 서로 지나가게 두고, 대신 그 사실을
 *  적어 둔다 — 막을 수 없는 것을 막은 척하는 것보다 낫다.
 *
 *  @param me     { s, dir }
 *  @param others [{ s, dir }, …] — 자기 자신이 섞여 있어도 된다(간격 0 은 건너뛴다)
 *  @returns 갈 수 있는 거리(m). 앞이 비었으면 Infinity
 */
export function followDistance(me, others, { length, closed, gap }) {
  let room = Infinity;
  for (const o of others ?? []) {
    if (!o || o === me) continue;
    if (o.dir !== me.dir) continue;                 // 마주 오는 차
    let ahead = (o.s - me.s) * me.dir;
    if (closed && length > 0) ahead = ((ahead % length) + length) % length;
    if (ahead <= 1e-6) continue;                    // 뒤에 있거나 같은 자리
    room = Math.min(room, ahead - gap);
  }
  return Math.max(0, room);
}

/**
 * 이 경로에 이 대수가 들어가는가.
 * ---------------------------------------------------------------------------
 *  차끼리 겹치지 못하게 막고 나면 **짧은 고리에 여러 대를 올릴 수 없다.** 대수 ×
 *  간격이 경로 길이를 넘으면 모두가 앞차에 막혀 한 대도 못 움직인다 — 실제로도
 *  그렇지만(그래서 현장은 고리를 길게 잡는다), 화면에서는 그냥 전부 얼어붙은 것
 *  으로만 보인다. 얼기 전에 미리 말해 줄 수 있어야 한다.
 *
 *  @returns { fits, need } — need 는 이 대수가 돌려면 필요한 최소 경로 길이(m)
 */
export function fleetFits(length, count, gap) {
  const need = Math.max(0, count) * Math.max(0, gap);
  return { fits: !(count > 1) || length > need, need };
}

/**
 * 이 카트가 가져올 종류들 — 비어 있으면 **가리지 않는다.**
 * ---------------------------------------------------------------------------
 *  처음에는 한 종류만 고를 수 있었다(`pickKind`). 그런데 조립 설비 하나가 재료를
 *  여럿 먹으므로, 한 종류만 고를 수 있으면 **재료 가짓수만큼 카트를 따로 놓아야**
 *  한다 — 같은 길을 도는 차가 셋이 되고 서로 막기까지 한다. "이것 아니면 저것"
 *  을 한 번에 말할 수 있어야 한 바퀴에 필요한 것을 다 실어 온다.
 *
 *  옛 도면의 `pickKind`(문자열 하나)도 그대로 읽는다 — 안 받으면 골라 둔 것이
 *  조용히 풀려 카트가 아무거나 실어 나른다.
 */
export function pickSet(cart) {
  const list = Array.isArray(cart?.pickKinds)
    ? cart.pickKinds
    : (cart?.pickKind ? [cart.pickKind] : []);
  const out = new Set();
  for (const k of list) {
    const c = canonKind(k);
    if (c) out.add(c);
  }
  return out;
}

export function cartPath(cart) {
  if (!cart?.points || cart.points.length < 2) return null;
  return buildFreePath(cart.points, {
    closed: cart.closed,
    radius: cart.radius ?? 1.2,
    y: cart.y ?? 0,
  });
}

/** 점에서 경로까지의 최단 지점을 호 길이로 찾는다 (간단히 촘촘히 훑는다) */
/**
 * 이 점에 가장 가까운 경로 위의 자리.
 *
 * @param accept 쓸 만한 자리인지 — **가장 가까운 한 점만 보면 안 되는 경우**가 있다.
 * ---------------------------------------------------------------------------
 *  선반을 한 바퀴 도는 경로가 그렇다. 경로의 어느 구간은 선반 앞면을 제대로
 *  지나가는데, 반대편(또는 안쪽) 구간이 **더 가깝다는 이유로** 뽑히고, 그 자리가
 *  "면의 정면이 아니다" 로 걸려 정차역이 통째로 사라졌다.
 *
 *  실제로 겪은 그림이다 — 줄을 늘려 선반이 커지자 경로 한쪽이 선반 안으로
 *  들어갔고, 바깥을 지나는 구간이 멀쩡히 있는데도 역이 안 생겼다.
 *
 *  그래서 **조건을 만족하는 것들 중** 가장 가까운 자리를 고른다.
 */
function closestOnPath(path, [x, z], step = 0.25, accept = null) {
  const L = path.length;
  let bestS = 0;
  let bestD = Infinity;
  const n = Math.max(2, Math.ceil(L / step));
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * L;
    const p = path.at(s).pos;
    const d = Math.hypot(p[0] - x, p[2] - z);
    if (d >= bestD) continue;
    if (accept && !accept(p, d)) continue;
    bestD = d;
    bestS = s;
  }
  return { s: bestS, dist: bestD };
}

/**
 * 선반에서 이 카트가 무엇을 할지 — 카트가 역마다 직접 정한 값.
 * ---------------------------------------------------------------------------
 *  선반은 앞면이 반반으로 입고 구역·출고 구역으로 갈려 있다. 처음에는 그것만으로
 *  역할을 정했다 — 경로가 어느 쪽 반을 지나느냐로 싣기와 내리기가 갈렸다.
 *
 *  그런데 그 규칙은 **경로를 구역에 맞춰 그리게 만든다.** 한 선반에 내려놓고
 *  다른 선반에서 실으려면 카트가 매번 선반의 왼쪽 반과 오른쪽 반을 찾아
 *  지그재그로 돌아야 한다 — 짐을 옮기는 데 쓰이지 않는 동선이 그만큼 늘어난다.
 *
 *  역할은 선반의 성질이 아니라 **이 카트가 그 선반에서 하는 일**이다. 같은
 *  선반이라도 A 카트는 채우고 B 카트는 비워 갈 수 있다. 그래서 카트가 역마다
 *  들고 있게 했다.
 *
 *      cart.roles = { [선반 uid]: 'load' | 'unload' }
 *
 *  적어 두지 않은 역은 예전 규칙(가까운 쪽 구역) 그대로다 — 이미 그린 도면이
 *  갑자기 다르게 움직이면 안 된다.
 */
export const STATION_ROLE = { LOAD: 'load', UNLOAD: 'unload' };

/** 역 하나의 역할을 다음 상태로 넘긴다 (자동 → 싣기 → 내리기 → 자동) */
export function nextRole(role) {
  if (!role) return STATION_ROLE.LOAD;
  return role === STATION_ROLE.LOAD ? STATION_ROLE.UNLOAD : null;
}

/**
 * 경로 위의 정차역 목록.
 *  { s, kind:'load'|'unload'|'shelf-in'|'shelf-out', uid, portId, count }
 *  count 는 그 설비가 한 번에 내보내는 수량이다(적재 시에만 의미).
 *
 *  @param roles 선반에서의 역할을 카트가 직접 정한 값 (위 참고)
 */
export function cartStations(path, placedList, itemOf, { loadOnly = false, roles = null } = {}) {
  if (!path) return [];
  const out = [];
  for (const port of allPorts(placedList, itemOf)) {
    if (port.kind !== PORT_KIND.IN && port.kind !== PORT_KIND.OUT) continue;
    /* 적치대는 아래에서 따로 다룬다 — 포트는 벨트를 받는 입구지만, 카트에게는
       **싣는 곳**이다. 포트 종류(유입)를 그대로 따르면 카트가 거기에 자재를
       내려놓게 되는데, 적치대에서 물자가 빠지는 길은 카트뿐이라 정반대다. */
    if (isStillage(itemOf(placedList.find((p) => p.uid === port.uid)?.itemId))) continue;
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
      /* 이 설비가 만드는 물건 — 카트가 실으면 그대로 따라가서 선반에 쌓인다 */
      payloadKind: outputKindOf(owner, itemOf(owner?.itemId)),
      /**
       * 이 설비의 레시피 — 카트가 유입부에 내려놓을 때와 유출부에서 실을 때
       * 둘 다 필요하다.
       *   유입부: 이 설비가 **쓰는 종류만** 받는다. 안 쓰는 것을 받아 두면 버퍼가
       *           영영 안 빠지는 것으로 차서, 멀쩡한 재료가 들어올 자리가 없어진다
       *   유출부: 실어 갈 만큼의 재료를 실제로 낼 수 있을 때만 싣는다
       * 원자재 공급원이면 null 이라 예전 그대로 동작한다.
       */
      recipe: isSource(recipeOf(owner)) ? null : recipeOf(owner),
      /** 유입부에 내려놓을 수 있는 양 (입력 버퍼) */
      capacity: inputCapOf(owner),
    });
  }

  /**
   * 선반 — **앞면 전체가 하나의 역**이다.
   * -------------------------------------------------------------------------
   *  앞뒤 양면의 구역을 전부 훑어 경로가 가장 가까이 지나는 한 지점을 역으로
   *  삼는다. 한 선반이 한 경로에 대해 역할을 둘 가질 수는 없다 — 경로 끝이
   *  선반 옆에서 맴돌면 실었다 내렸다를 반복하게 되기 때문이다.
   *
   *  역할은 카트가 정한다(roles). 정한 것이 없으면 예전 규칙대로 **더 가까이
   *  지나간 쪽 구역**을 따른다.
   */
  for (const p of placedList) {
    const item = itemOf(p.itemId);
    if (!isShelf(item)) continue;
    const spec = item.modelKey ? getSpec(item.modelKey) : null;

    let near = null;   // { s, dist, zone } — 구역을 가리지 않은 최단 접근
    for (const z of shelfZones(p, spec)) {
      const dir = rotateXZ(z.dir, p.rot);
      const samples = Math.max(2, Math.ceil(z.w) + 1);
      for (let i = 0; i < samples; i++) {
        const lx = z.cx - z.w / 2 + (i * z.w) / (samples - 1);
        const [ox, oz] = rotateXZ([lx, z.fz], p.rot);
        const at2 = [p.pos[0] + ox, p.pos[1] + oz];
        /* 정면 판정을 **찾는 동안** 한다 — 뒤에서 거르면, 더 가까운 엉뚱한 구간
           하나 때문에 제대로 지나가는 구간이 통째로 묻힌다(closestOnPath 주석) */
        const hit = closestOnPath(path, at2, 0.25, (q) => {
          const vx = q[0] - at2[0];
          const vz = q[2] - at2[1];
          const len = Math.hypot(vx, vz);
          return len <= 1e-3 || (vx * dir[0] + vz * dir[1]) / len >= FRONT_COS;
        });
        if (hit.dist > STATION_DIST) continue;
        if (!near || hit.dist < near.dist) near = { s: hit.s, dist: hit.dist, zone: z.kind };
      }
    }
    if (!near) continue;

    const role = roles?.[p.uid] ?? null;
    const kind = role
      ? (role === STATION_ROLE.LOAD ? 'shelf-out' : 'shelf-in')
      : (near.zone === ZONE.IN ? 'shelf-in' : 'shelf-out');

    out.push({
      s: near.s,
      dist: near.dist,
      kind,
      /** 카트가 직접 정한 값인가 (인스펙터가 「자동」과 구분해 보여 준다) */
      role,
      /** 역할을 고를 수 있는 역인가 — 선반뿐이다.
          적치대는 벨트로 들어와 카트로 나가는 것이 정의라 방향이 하나고,
          설비 포트는 유입·유출이 형상으로 정해져 있다. */
      canRole: true,
      uid: p.uid,
      key: p.uid,
      name: p.name ?? p.uid,
      capacity: shelfCapacity(p, spec),
      /** 빈 카트가 오면 실어 보낼 수량 */
      dispatch: Math.max(0, p.dispatchCount ?? 3),
      /**
       * 줄을 나눈 선반이면 **어느 통에 얼마나** 들어가는지.
       * ---------------------------------------------------------------------
       *  「1번 줄은 제작품 1」 같은 지정을 지키려면 내려놓는 쪽이 그 규칙을
       *  알아야 한다. 규칙은 shelf.js 한 곳에 있고 여기서는 그것을 싸서 넘긴다 —
       *  CartView 가 줄 계산을 다시 하면 그리는 자리와 어긋난다.
       */
      binOf: (kind) => {
        const g = rowGroupOf(p, kind);
        return { id: g.rows.length ? g.id : null, cap: g.rows.length * perRow(p, spec) };
      },
    });
  }

  /* 적치대 — 카트에게는 **싣는 곳** 하나뿐이다.
     선반처럼 입고/출고로 나누지 않는다. 벨트로 들어오고 카트로 나가는 것이
     이 물건의 정의라, 방향이 하나로 정해져 있기 때문이다. */
  for (const p of placedList) {
    const item = itemOf(p.itemId);
    if (!isStillage(item)) continue;
    /* 적치대만 좌표가 **중심**이다(포트도 구역도 없다). 다른 것들과 같은 잣대로
       재려면 상판의 반너비를 빼서 면에서 잰 거리로 바꿔야 한다. 상판이
       정사각형(1.5 × 1.5)이라 방향과 무관하게 반너비 하나면 된다. */
    const size = item.modelKey ? getSpec(item.modelKey)?.bbox?.size : null;
    const half = Math.max(size?.[0] ?? 1.5, size?.[2] ?? 1.5) / 2;
    const hit = closestOnPath(path, p.pos);
    if (hit.dist - half > STILLAGE_DIST) continue;
    out.push({
      s: hit.s,
      dist: hit.dist,
      kind: 'shelf-out',                       // 싣기 — 재고에서 꺼내 온다
      uid: p.uid,
      key: p.uid,
      name: p.name ?? p.uid,
      capacity: stillageCapacity(p),
      dispatch: Math.max(0, p.dispatchCount ?? 3),
    });
  }

  /**
   * 출하 차량은 **싣기만** 한다.
   * ---------------------------------------------------------------------------
   *  트럭이 하는 일은 공장 안의 물건을 밖으로 내보내는 것 하나뿐이라, 방향이
   *  처음부터 정해져 있다. 그래서 경로가 선반의 입고 구역(초록) 쪽을 지나가도
   *  거기서 내리는 것이 아니라 **실어서** 나간다 — 어느 쪽 면을 지나느냐로
   *  역할이 갈리는 것은 공장 안을 오가는 카트의 규칙이다.
   *
   *  설비 유입부는 아예 뺀다. 거기에는 실을 것이 없다(자재가 들어가는 입구다).
   *  카트라면 내려놓을 자리지만 트럭에게는 아무것도 아니어서, 남겨 두면 트럭이
   *  이유 없이 멈춰 서기만 한다.
   */
  const list = loadOnly
    ? out
        .filter((st) => st.kind !== 'unload')
        .map((st) => (st.kind === 'shelf-in' ? { ...st, kind: 'shelf-out' } : st))
    : settleShelfRoles(out);

  return list.sort((a, b) => a.s - b.s);
}

/**
 * 역할을 정하지 않은 선반의 기본값을 **경로 전체를 보고** 정한다.
 * ---------------------------------------------------------------------------
 *  선반 하나만 놓고 보면 어느 쪽 반을 지나느냐로 싣기·내리기가 갈린다. 그런데 그
 *  판정은 **경로에 무엇이 더 있는지를 모른다.** 적치대에서 싣고 선반에 내려놓는,
 *  가장 흔한 구성에서 이런 일이 생긴다.
 *
 *    적치대 — 싣기 하나뿐이다(방향이 형상으로 정해져 있다)
 *    선반   — 하필 출고 구역 쪽을 지나가서 **싣기**로 잡힌다
 *    → 싣는 곳만 둘. 카트는 한 번 실으면 내릴 데가 없어 짐을 진 채 계속 돈다
 *
 *  방향이 형상으로 **정해진** 역이 한쪽뿐이라면, 고르지 않은 선반은 반대쪽이어야
 *  경로가 말이 된다 — 적치대에서 실었으면 선반은 내려놓는 곳이다. 그렇게 두면
 *  경로를 그리자마자 자재가 돈다.
 *
 *  직접 정한 선반(role)은 건드리지 않는다. 정해진 역이 양쪽 다 있거나 하나도
 *  없으면(선반끼리 나르는 경우) 판단할 근거가 없으므로 가까운 쪽 구역을 따른다.
 */
function settleShelfRoles(list) {
  if (!list.some((st) => st.canRole && !st.role)) return list;

  const fixed = list.filter((st) => !st.canRole);
  const takesOnly = fixed.some((st) => st.kind === 'shelf-out' || st.kind === 'load');
  const givesOnly = fixed.some((st) => st.kind === 'shelf-in' || st.kind === 'unload');
  if (takesOnly === givesOnly) return list;          // 둘 다거나 둘 다 아니면 그대로

  const kind = takesOnly ? 'shelf-in' : 'shelf-out';
  return list.map((st) =>
    (st.canRole && !st.role ? { ...st, kind, settled: true } : st));
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
export function stepCart(st, { length, closed, oneWay, speed, dwell }, stations, dt) {
  const L = length;
  if (!(L > 0.01)) return { s: st.s, dir: st.dir, pause: st.pause, arrived: null };

  // 정차 중이면 시간만 흘린다
  if (st.pause > 0) return { s: st.s, dir: st.dir, pause: st.pause - dt, arrived: null };

  const dir0 = st.dir;
  /* dt 는 **시뮬 시간**이다 — 배속과 프레임 상한은 clock.simStep 이 이미 적용했다.
     여기서 또 자르면 배속이 통째로 무시된다. */
  const step = speed * dt * dir0;
  let s1 = st.s + step;
  let dir = st.dir;

  if (closed) {
    /* 고리 — 어느 방향으로 돌든 감긴다 (dir 이 −1 이면 반대로 돈다) */
    s1 = ((s1 % L) + L) % L;
  } else if (oneWay && (s1 > L || s1 < 0)) {
    /* 편도 주행(트럭) — 끝에 닿으면 사라지고 **반대쪽 끝**에서 새 차가 나온다.
       왕복으로 되돌아오면 빈 트럭이 공장 안을 거슬러 올라오는 그림이 되는데,
       출하 차량의 흐름은 한 방향이라 그쪽이 실제와 맞지 않는다.
       끝점은 정확히 밟고 나서 보낸다 — 끝에 있는 정차역을 놓치지 않기
       위해서다(아래 왕복 처리와 같은 이유).
       거꾸로 달리는 차(dir < 0)는 0 에서 사라져 L 에서 다시 나온다. */
    const end = dir0 > 0 ? L : 0;
    if (st.s !== end) { s1 = end; }
    else return { s: dir0 > 0 ? 0 : L, dir: dir0, pause: 0, arrived: null, recycled: true };
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

  /* 한 프레임에 여러 역을 지났다면 **가장 마지막에 지난** 역을 처리한다.
     stations 는 s 오름차순이라, 정방향이면 목록의 끝이 마지막에 지난 역이고
     거꾸로 달리면 목록의 앞이 그렇다 — 방향을 안 보면 반대쪽을 집는다.
     (그 사이의 역은 이 프레임에서 놓친다. 한 프레임 이동 거리는 speed × 0.1 이
      상한이라 역이 그보다 촘촘할 때만 생기는 일이다.)

     자재가 실제로 오갔는지(수용량·재고에 달렸다)는 여기서 알 수 없으므로
     역만 알려 주고, 수량 계산과 lastKey 갱신은 호출부가 맡는다. */
  return { s: s1, dir, pause: dwell, arrived: st.dir >= 0 ? hit[hit.length - 1] : hit[0] };
}
