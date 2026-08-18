/**
 * =============================================================================
 *  물류 동선 — **얼마나 멀리, 얼마나 자주 나르나**
 * =============================================================================
 *  배치를 고치는 이유의 절반은 이것이다. 그런데 이 도구는 지금까지 「얼마나
 *  만드나」(balance)와 「얼마가 드나」(cost)만 답했다. 정작 **배치를 바꿔서
 *  줄일 수 있는 것**은 세 번째다 — 물건이 오가는 거리.
 *
 *  ── 한 숫자로 줄인다: 운반 작업량 ────────────────────────────────────────
 *      운반 작업량 = Σ (시간당 개수 × 그 구간 거리)      [m·개/시]
 *
 *  이것이 배치 계획의 고전적인 목적 함수다. 설비를 옮겨 이 값이 내려가면 그
 *  배치가 나은 것이고, 어느 구간이 무거운지 보면 **무엇을 붙여 놓아야 하는지**가
 *  바로 나온다. 「A와 B를 가까이」 는 감이 아니라 이 표에서 나오는 말이다.
 *
 *  ── 돌리지 않고 낸다 ─────────────────────────────────────────────────────
 *  `balance` 가 라인 천장을 내고 설비마다 **배수**(최종 1개에 내 것이 몇 개
 *  드나)를 안다. 그러면 각 구간이 나르는 양은 곱하기 한 번이다. 돌려서 세면
 *  화면의 천장과 여기 숫자가 갈리므로, **같은 근거에서** 나오게 둔다.
 *
 *  ── 거리는 두 가지가 다르다 ──────────────────────────────────────────────
 *  벨트는 **깔린 길이** 그대로다(꺾인 만큼 길다). 카트는 다르다 — 한 바퀴를
 *  돌지만 **물건이 실제로 실려 가는 구간**은 실은 곳에서 내리는 곳까지다.
 *  빈 차로 돌아오는 구간은 물건이 안 탔으므로 운반 작업량에 안 들어간다.
 *  (그 빈 구간이 아까우면 그건 `lapSec` 을 통해 이미 수송 능력에 반영돼 있다)
 * ---------------------------------------------------------------------------
 */

import { isTruck } from '../data/library.js';
import { cartPath, cartStations, haulPerMinute, isLoadStation } from './cart.js';

/** 이보다 가벼운 구간은 표에 안 올린다 (개/시) — 반올림 부스러기 */
export const MIN_RATE = 0.01;

const nameOf = (placed, uid) => placed.find((p) => p.uid === uid)?.name ?? uid;

/**
 * 닫힌 경로에서 **가는 방향으로** 잰 거리.
 *  왕복(열린) 경로는 되짚어 오므로 그냥 차이다.
 */
export function arcBetween(from, to, length, closed) {
  const d = to - from;
  if (!closed) return Math.abs(d);
  const L = Math.max(1e-9, length);
  return ((d % L) + L) % L;
}

/**
 * 구간별 물류량.
 *
 *  @param d.rows     `lineBalance(...).rows` — 여기서 설비별 **배수**를 얻는다
 *  @param d.capacity `lineBalance(...).capacity` — 라인 천장 (개/분)
 *  @param d.placed · d.links · d.carts
 *  @param d.lengthOf (link) => m — 벨트가 **깔린 길이**. 경로 계산은 화면 층의
 *                    일이라(link.js 의 linkPath 는 모델 규격을 본다) 받아 쓴다.
 *                    안 넘기면 벨트 구간은 거리 0 으로 남는다
 *  @param itemOf
 *  @returns [{ kind, uid, from, to, fromName, toName, perHour, meters, work }]
 *           무거운 순
 */
export function flowMatrix(d = {}, itemOf = () => null) {
  const placed = d.placed ?? [];
  const capacity = Math.max(0, d.capacity ?? 0);          // 개/분
  const lengthOf = d.lengthOf ?? (() => 0);
  const multOf = new Map((d.rows ?? []).map((r) => [r.uid, r.mult ?? 1]));
  const out = [];

  /* ---- 벨트 ---- */
  for (const l of d.links ?? []) {
    const from = l.from?.uid;
    const to = l.to?.uid;
    if (!from || !to) continue;
    /* 상류 설비가 내는 양 = 라인 천장 × 그 설비의 배수 */
    const perHour = capacity * (multOf.get(from) ?? 1) * 60;
    const meters = Math.max(0, Number(lengthOf(l)) || 0);
    if (perHour < MIN_RATE) continue;
    out.push({
      kind: 'belt',
      uid: l.uid,
      from,
      to,
      fromName: nameOf(placed, from),
      toName: nameOf(placed, to),
      perHour,
      meters,
      work: perHour * meters,
    });
  }

  /* ---- 카트 ----
     **나르는 양은 「나를 수 있는 양」이 아니다.** 카트가 분당 15개를 나를 수
     있어도 라인이 5개/분이면 실제로 오가는 것은 5개다. 능력을 그대로 쓰면
     벨트 줄(실제 흐름)과 단위가 어긋나서, 더한 총계가 아무 뜻이 없어진다 —
     실제로 벨트 300개/시 옆에 카트 926개/시가 찍혔다.

     그래서 **벨트와 같은 규칙**을 쓴다: 라인 천장 × 배수. 카트의 배수는
     `lineBalance` 가 1 로 둔다(한 경로가 여러 종류를 섞어 나르므로 한쪽에
     물릴 수 없다 — balance.js 참고).

     실은 곳 → 내리는 곳이 여럿이면 **고르게 나눈다.** 어느 역의 물건이 어느
     역으로 가는지는 도면만 보고 알 수 없다(레시피가 아니라 그때그때 재고에
     달렸다). 무거운 구간을 가리는 데는 이 정도로 충분하고, 흔한 경우인
     「한 곳에서 실어 한 곳에 내린다」 에서는 **정확하다.** */
  for (const c of d.carts ?? []) {
    const truck = isTruck(itemOf(c.itemId));
    const path = cartPath(c);
    if (!path) continue;
    const st = cartStations(path, placed, itemOf, { loadOnly: truck, roles: c.roles });
    /* 실어 나를 수 있기는 한가 — 능력이 0 이면 애초에 안 오간다 */
    const h = haulPerMinute(c, path, st, { truck });
    if (!h || !(h.perMinute > 0)) continue;

    const loads = st.filter((s) => isLoadStation(s.kind));
    const drops = st.filter((s) => !isLoadStation(s.kind));
    if (!loads.length || !drops.length) continue;          // 트럭은 밖으로 나간다

    /* 라인이 요구하는 양과 카트가 낼 수 있는 양 중 **작은 쪽**이 실제로 오간다 */
    const moved = Math.min(capacity * (multOf.get(c.uid) ?? 1), h.perMinute) * 60;
    const share = moved / (loads.length * drops.length);
    for (const a of loads) {
      for (const b of drops) {
        const meters = arcBetween(a.s, b.s, path.length, !!c.closed);
        if (share < MIN_RATE) continue;
        out.push({
          kind: truck ? 'truck' : 'cart',
          uid: c.uid,
          from: a.uid ?? a.key,
          to: b.uid ?? b.key,
          fromName: a.name,
          toName: b.name,
          via: c.name ?? c.uid,
          perHour: share,
          meters,
          work: share * meters,
        });
      }
    }
  }

  out.sort((x, y) => y.work - x.work);
  return out;
}

/** 총 운반 작업량 [m·개/시] — 배치를 고쳐 줄이는 그 값 */
export const totalWork = (rows) => (rows ?? []).reduce((s, r) => s + (r.work || 0), 0);

/**
 * **한 개가 지나는 거리** — 총 작업량을 라인 산출량으로 나눈 값.
 * ---------------------------------------------------------------------------
 *  총 작업량은 라인이 빨라지기만 해도 커진다. 그러면 배치를 나쁘게 고쳐 놓고도
 *  숫자가 줄어 보이는 일이 생긴다(느려져서). **개당 거리**는 그 착시를 없앤다 —
 *  배치가 좋아져야만 내려간다.
 */
export function metersPerUnit(rows, capacity) {
  const perHour = Math.max(0, capacity ?? 0) * 60;
  if (!(perHour > 0)) return null;
  return totalWork(rows) / perHour;
}

/** 무거운 구간 몇 개 — 「무엇을 붙여 놓을까」 의 답 */
export const heaviest = (rows, n = 5) => (rows ?? []).slice(0, Math.max(0, n));

/** m·개/시 를 사람이 읽는 크기로 */
export const workText = (v) => {
  if (!Number.isFinite(v)) return '—';
  if (v >= 1e4) return `${Math.round(v / 1e3).toLocaleString()}천 m·개/시`;
  return `${Math.round(v).toLocaleString()} m·개/시`;
};
