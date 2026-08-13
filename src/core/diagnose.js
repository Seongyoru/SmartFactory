/**
 * =============================================================================
 *  왜 섰는가 — 원인을 **사슬로** 따라간다
 * =============================================================================
 *  「병목」 이라고 띄우던 것은 **가장 오래 막혀 있던 설비**였다. 그런데 막힌 설비는
 *  굶은 설비와 똑같이 피해자다 — 보낼 곳이 없어서 서 있을 뿐, 느린 것은 그 뒤다.
 *  코드 주석에도 "굶은 설비는 피해자다" 라고 적어 놓고 굶음만 뺐지, 막힘은 그대로
 *  병목으로 세고 있었다. 방향만 반대일 뿐 같은 오류다.
 *
 *  실제로 이 표시 때문에 멀쩡한 제작기를 붙들고 한참을 헤맸다. 제작기는 109초 동안
 *  완벽하게 돌았고 그 뒤로는 적치대가 차서 못 보냈을 뿐인데, 화면은 끝까지
 *  「병목: 제작기 #1 82%」 라고 말했다.
 *
 *  그래서 이름을 고쳐 부르는 대신 **사슬을 보여 준다.**
 *
 *      제작기 #1 이 82% 막힘
 *        ← 보낼 곳: 적치대 #1 (200/200 가득)
 *        ← 거기서 빼가는 것: 없음
 *
 *  마지막 줄이 손볼 곳이다. 그 앞의 것들은 전부 피해자다.
 *
 *  ── 순수하게 둔다 ────────────────────────────────────────────────────────
 *   화면도 시뮬 상태도 안 만진다. 도면과 「지금 얼마나 쌓였나」 만 받아서 사슬을
 *   돌려준다 — 그래야 값으로 확인할 수 있고, 헤드리스로도 같은 답이 나온다.
 * ---------------------------------------------------------------------------
 */

import { isShelf, isStillage, isTruck, isUtility } from '../data/library.js';

import { cartPath, cartStations, haulPerMinute } from './cart.js';
import { cycleOf, perMinute } from './process.js';
import { stillageCapacity } from './stillage.js';
import { shelfCapacity } from './shelf.js';

/** 사슬 한 칸의 종류 */
export const STEP = {
  MACHINE: 'machine',   // 서 있는 설비 (피해자일 수 있다)
  STORE: 'store',       // 쌓이는 곳 — 적치대 · 선반 · 설비 입력 버퍼
  HAUL: 'haul',         // 거기서 빼가는 것 — 카트 · 트럭
  NONE: 'none',         // 빼가는 것이 없다
};

/**
 * 이 칸을 눌렀을 때 무엇을 고르고 어디를 볼 것인가.
 * ---------------------------------------------------------------------------
 *  사슬은 "저기가 문제다" 라고 말만 하고 끝나면 안 된다. 도면이 크면 이름만 보고
 *  그 설비를 찾는 데 또 한참이 걸린다 — 짚어 줬으면 데려다도 줘야 한다.
 *
 *  카트는 경로가 있고 설비는 자리가 있다. 카트는 **경로의 첫 점**을 본다(차가
 *  어디 있는지는 매 순간 달라지지만 경로는 안 변한다).
 *
 *  @returns { kind: 'equip' | 'cart', uid, at: [x, z] } · 없으면 null
 */
export function stepTarget(step, { placed = [], carts = [] } = {}) {
  if (!step?.uid) return null;
  const p = placed.find((x) => x.uid === step.uid);
  if (p?.pos) return { kind: 'equip', uid: p.uid, at: [p.pos[0], p.pos[1]] };
  const c = carts.find((x) => x.uid === step.uid);
  if (c?.points?.length) return { kind: 'cart', uid: c.uid, at: [c.points[0][0], c.points[0][1]] };
  return null;
}

/** 쌓이는 곳인가, 그렇다면 얼마나 담기는가 */
export function storeCapOf(p, itemOf, specOf = () => null) {
  const item = itemOf?.(p?.itemId);
  if (isStillage(item)) return stillageCapacity(p);
  if (isShelf(item)) return shelfCapacity(p, specOf(item));
  return 0;
}

/** 이 설비가 벨트로 보내는 곳 (없으면 null) */
export function beltSinkOf(uid, { placed, links, itemOf }) {
  const l = (links ?? []).find(
    (x) => x.from?.uid === uid && !x.from?.anchor && !x.from?.link
      && !isUtility(itemOf(x.itemId)) && itemOf(x.itemId)?.render !== 'tube',
  );
  if (!l?.to?.uid) return null;
  return (placed ?? []).find((p) => p.uid === l.to.uid) ?? null;
}

/**
 * 이 자리에서 물자를 **빼가는** 차량들.
 *  경로가 그 앞을 지나면서 「싣기」 역으로 잡혔는가로 본다 — 카트 인스펙터가
 *  쓰는 것과 같은 판정이다(`cartStations`).
 */
export function haulersOf(uid, { placed, carts, itemOf }) {
  const out = [];
  for (const c of carts ?? []) {
    const path = cartPath(c);
    if (!path) continue;
    const truck = isTruck(itemOf(c.itemId));
    const stations = cartStations(path, placed, itemOf, { loadOnly: truck, roles: c.roles });
    if (!stations.some((s) => s.uid === uid && (s.kind === 'shelf-out' || s.kind === 'load'))) continue;
    const h = haulPerMinute(c, path, stations, { truck });
    if (h) out.push({ uid: c.uid, name: c.name ?? c.uid, perMinute: h.perMinute });
  }
  return out;
}

/**
 * 이 차량들이 **내려놓는** 자리 중 가득 찬 것.
 *  나를 힘이 넉넉한데도 앞이 안 빠지면, 대개 내려놓을 데가 막힌 것이다.
 */
export function dropTargetsFull(haulers, ctx) {
  const { placed = [], carts = [], itemOf, specOf = () => null, getStock = () => 0 } = ctx ?? {};
  const out = [];
  const seen = new Set();
  for (const h of haulers ?? []) {
    const c = carts.find((x) => x.uid === h.uid);
    const path = c ? cartPath(c) : null;
    if (!path) continue;
    const truck = isTruck(itemOf(c.itemId));
    if (truck) continue;                          // 트럭은 밖으로 나간다 — 막힐 데가 없다
    for (const st of cartStations(path, placed, itemOf, { roles: c.roles })) {
      if (st.kind !== 'shelf-in' && st.kind !== 'unload') continue;
      if (seen.has(st.uid)) continue;
      seen.add(st.uid);
      const p = placed.find((x) => x.uid === st.uid);
      const cap = p ? storeCapOf(p, itemOf, specOf) : 0;
      if (!cap) continue;
      const have = getStock(st.uid);
      if (have >= cap) out.push({ uid: st.uid, name: p.name ?? st.uid, have, cap });
    }
  }
  return out;
}

/**
 * 막혀 선 설비의 원인 사슬.
 *
 * @param uid   서 있는 설비
 * @param ctx   { placed, links, carts, itemOf, specOf, getStock }
 * @returns { steps, culprit } · culprit 이 **손볼 곳**이다 (없으면 일시적인 막힘)
 */
export function blockChain(uid, ctx) {
  const {
    placed = [], itemOf, specOf = () => null, getStock = () => 0,
    /* 값 검사에서 수송 능력을 직접 주기 위한 이음매 — 선반·포트는 모델 치수가
       있어야 역으로 잡혀서, node 만으로는 「나를 힘이 넉넉한 카트」를 세울 수 없다 */
    haulOf = haulersOf,
  } = ctx ?? {};
  const me = placed.find((p) => p.uid === uid);
  if (!me) return { steps: [], culprit: null };

  const rate = perMinute(cycleOf(me, itemOf(me.itemId)));
  const steps = [{
    kind: STEP.MACHINE,
    uid,
    name: me.name ?? uid,
    note: `만드는 속도 ${rate.toFixed(1)} 개/분`,
  }];

  const sink = beltSinkOf(uid, ctx);
  if (!sink) {
    steps.push({ kind: STEP.NONE, name: '보낼 곳', note: '벨트가 안 물려 있습니다' });
    return { steps, culprit: steps[steps.length - 1] };
  }

  /* 쌓이는 곳인가(적치대·선반), 아니면 재료를 먹는 설비인가 */
  const cap = storeCapOf(sink, itemOf, specOf);
  const have = getStock(sink.uid);
  const isStore = cap > 0;
  const full = isStore ? have >= cap : false;

  steps.push({
    kind: STEP.STORE,
    uid: sink.uid,
    name: sink.name ?? sink.uid,
    note: isStore ? `${have}/${cap}${full ? ' 가득' : ''}` : '재료를 먹는 설비',
    full,
  });

  /* 아직 안 찼으면 지금 막힌 것은 잠깐이다 — 손볼 곳이 없다 */
  if (isStore && !full) return { steps, culprit: null };

  if (isStore) {
    const haulers = haulOf(sink.uid, ctx);
    const sum = haulers.reduce((s, h) => s + h.perMinute, 0);
    if (!haulers.length) {
      steps.push({ kind: STEP.NONE, name: '빼가는 것', note: '없습니다' });
      return { steps, culprit: steps[steps.length - 1] };
    }

    const short = sum < rate;
    steps.push({
      kind: STEP.HAUL,
      /* 눌렀을 때 데려갈 곳 — 여럿이면 첫 번째다. 여럿이 함께 모자란 것이라
         어느 하나만 고쳐서 될 일은 아니지만, 어디를 보라는 표시는 있어야 한다 */
      uid: haulers[0].uid,
      name: haulers.map((h) => h.name).join(' · '),
      note: short
        ? `${sum.toFixed(1)} 개/분 — 만드는 ${rate.toFixed(1)} 을 못 따라갑니다`
        : `${sum.toFixed(1)} 개/분 (만드는 ${rate.toFixed(1)} 보다 넉넉합니다)`,
      perMinute: sum,
      short,
    });
    /* 나를 힘은 넉넉한데도 차 있다면 **내려놓을 데**가 막힌 것이다.
       능력이 충분한 차를 손볼 곳이라고 지목하면 또 엉뚱한 데를 고치게 된다. */
    if (short) return { steps, culprit: steps[steps.length - 1] };

    const stuck = dropTargetsFull(haulers, ctx);
    if (stuck.length) {
      steps.push({
        kind: STEP.STORE,
        uid: stuck[0].uid,
        name: stuck.map((s) => s.name).join(' · '),
        note: `${stuck[0].have}/${stuck[0].cap} 가득 — 내려놓을 데가 없습니다`,
        full: true,
      });
      return { steps, culprit: steps[steps.length - 1] };
    }
    return { steps, culprit: null };
  }

  /* 재료를 먹는 설비로 보내고 있다 — 그 설비가 느리면 그쪽이 원인이다 */
  const nextRate = perMinute(cycleOf(sink, itemOf(sink.itemId)));
  steps.push({
    kind: STEP.MACHINE,
    uid: sink.uid,
    name: sink.name ?? sink.uid,
    note: `${nextRate.toFixed(1)} 개/분 (앞 설비 ${rate.toFixed(1)})`,
    short: nextRate < rate,
  });
  return { steps, culprit: nextRate < rate ? steps[steps.length - 1] : null };
}

/**
 * 사슬을 한 줄로 — 화면과 CSV 가 같은 문장을 쓰도록.
 *  「제작기 #1 → 적치대 #1 (200/200 가득) → 빼가는 것: 없습니다」
 */
export const chainText = (steps) =>
  (steps ?? []).map((s) => `${s.name}${s.note ? ` (${s.note})` : ''}`).join(' → ');

/**
 * 이 설비가 원인인가, 피해자인가.
 *  사슬 끝이 자기 자신이면 원인이고, 뒤에 뭔가 더 있으면 피해자다.
 */
export const isVictim = (uid, steps) =>
  (steps?.length ?? 0) > 1 && steps[steps.length - 1].uid !== uid;

/**
 * 재료가 없어 굶은 설비도 원인이 아니다 — **앞이** 못 대주고 있다.
 *  굶음은 예전부터 병목에서 뺐지만, "그럼 어디를 봐야 하나" 는 말해 주지 않았다.
 */
export function starveChain(uid, ctx) {
  const { placed = [], links = [], itemOf } = ctx ?? {};
  const me = placed.find((p) => p.uid === uid);
  if (!me) return { steps: [], culprit: null };

  const rate = perMinute(cycleOf(me, itemOf(me.itemId)));
  const steps = [{
    kind: STEP.MACHINE, uid, name: me.name ?? uid,
    note: `재료가 없습니다 (돌면 ${rate.toFixed(1)} 개/분)`,
  }];

  /* 이 설비로 들어오는 벨트의 주인 = 앞 공정 */
  const feeders = links
    .filter((l) => l.to?.uid === uid && l.from?.uid)
    .map((l) => placed.find((p) => p.uid === l.from.uid))
    .filter(Boolean);

  if (!feeders.length) {
    /* 카트가 넣어 주는 자리일 수도 있다 — 그것도 없으면 아무도 안 대준다 */
    const feed = haulersOf(uid, ctx);
    steps.push(feed.length
      ? { kind: STEP.HAUL, name: feed.map((h) => h.name).join(' · '), note: '카트가 대줍니다' }
      : { kind: STEP.NONE, name: '대주는 것', note: '없습니다' });
    return { steps, culprit: steps[steps.length - 1] };
  }

  /* 가장 느린 앞 공정이 이 설비를 굶긴다 */
  let worst = null;
  for (const f of feeders) {
    const r = perMinute(cycleOf(f, itemOf(f.itemId)));
    if (!worst || r < worst.rate) worst = { p: f, rate: r };
  }
  steps.push({
    kind: STEP.MACHINE,
    uid: worst.p.uid,
    name: worst.p.name ?? worst.p.uid,
    note: `${worst.rate.toFixed(1)} 개/분 (여기서 ${rate.toFixed(1)} 필요)`,
    short: worst.rate < rate,
  });
  return { steps, culprit: worst.rate < rate ? steps[steps.length - 1] : null };
}
