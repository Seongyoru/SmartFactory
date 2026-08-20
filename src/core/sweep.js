/**
 * =============================================================================
 *  손잡이 돌리기 — 「얼마가 좋은가」
 * =============================================================================
 *  「카트를 몇 대 두면 되나?」 「버퍼를 얼마로 잡아야 하나?」 「로트를 얼마로?」
 *  이것이 계획하는 사람이 실제로 묻는 질문인데, 지금까지는 **값을 손으로 바꾸고
 *  다시 돌리기를 되풀이**해야 답할 수 있었다. 여섯 번 바꾸려면 여섯 번 손을
 *  움직이고, 그 사이에 앞의 값이 뭐였는지 잊는다.
 *
 *  화면 없이 판을 돌릴 수 있게 되었으니(`core/replicate.js` · `core/lineup.js`),
 *  이제 **도구가 값을 바꿔 가며 돌려 보고 표로 낼 수 있다.**
 *
 *  ── 반드시 지켜야 하는 셋 ─────────────────────────────────────────────────
 *
 *  **① 같은 난수를 먹인다** (common random numbers). 값마다 다른 운을 주면
 *  곡선이 들쭉날쭉해져서 「4대에서 꺾인다」가 운인지 실력인지 알 수 없다.
 *  씨앗을 고정하면 값 사이의 차이만 남는다 — `replicate` 가 이미 그렇게 한다.
 *
 *  **완전히 같은 조건이 되지는 않는다.** 값이 달라지면 라인이 다르게 돌아서
 *  난수를 먹는 자리도 어긋난다(버퍼가 크면 덜 막히고, 덜 막히면 다음 난수를
 *  다른 시점에 쓴다). 그래서 짝짓기가 상쇄해 주는 것은 **운의 일부**이고,
 *  차이가 작으면 여전히 「모른다」가 나온다 — 적치대 40 → 80(+4.2%)이 그랬다.
 *  더 확실히 하려면 판을 늘리는 수밖에 없다.
 *
 *  **② 「더 늘어도 안 는다」를 구간으로 말한다.** 표만 내면 사람이 눈으로
 *  0.3 개/시 차이를 「늘었다」고 읽는다. 이웃한 두 값이 **정말 다른지**를
 *  `differs`(Welch)로 물어서, 안 다르면 **거기가 무릎**이다.
 *
 *  **③ 없는 손잡이는 없다고 한다.** 카트가 없는 도면에서 「카트 대수」를 돌리면
 *  전부 같은 값이 나오는데, 그걸 표로 내면 「대수를 늘려도 소용없다」로 읽힌다.
 *  실제로는 **돌릴 것이 없는 것**이다.
 * ---------------------------------------------------------------------------
 */

import { differs, pairedDiffers, replicate } from './replicate.js';

/** 한 값마다 몇 판을 돌리나 — 곡선의 **모양**을 보는 자리라 판을 적게 둔다 */
export const SWEEP_REPS = 6;
/** 손잡이 하나에 몇 값까지 — 이보다 많으면 표를 읽는 대신 훑게 된다 */
export const MAX_VALUES = 8;

/**
 * 이만큼도 안 늘면 **안 는 것으로 본다** (2%).
 * ---------------------------------------------------------------------------
 *  짝지어 견주면(같은 난수) 판정이 아주 예민해진다 — 좋은 일이지만 **너무**
 *  예민하다. 실제로 카트 2대 1276 · 4대 1281 에서 0.4% 차이를 「늘었다」고 잡아
 *  **트럭을 두 대 더 사라**고 했다. 통계적으로 다른 것과 **할 만한 것**은 다르다.
 *
 *  `optimize.js` 의 `GAIN_TIE`, `improve.js` 의 `UNIT_TIE` 와 같은 생각이다.
 */
export const SWEEP_TIE = 0.02;

/**
 * 돌릴 수 있는 손잡이들.
 * ---------------------------------------------------------------------------
 *  고른 기준은 **「사람이 실제로 정하는 값인가」**다. 공정 시간이나 레시피처럼
 *  물건이 정하는 값은 안 넣는다 — 돌려 봐야 「빠르면 좋다」밖에 안 나온다.
 *
 *  `patch` 는 **도면을 통째로 새로 만들어** 돌려준다(원본을 안 건드린다).
 *  `has` 가 false 면 그 도면에는 그 손잡이가 없다.
 */
/**
 * 손잡이 하나.
 *  `now` 는 **지금 도면이 어디 있나** — 실적 보정이 「바꿀 만한 차이인가」를
 *  물을 때 기준으로 쓴다(`calibrate.js` 의 `movedFrom`). 없으면 「지금 값과
 *  구별이 안 된다」는 말을 아예 못 해서, 뜻 없는 변경을 권하게 된다.
 */
export const KNOBS = [
  {
    id: 'cartCount',
    label: '카트 대수',
    unit: '대',
    why: '한 경로에 몇 대를 올릴까 — 늘려도 안 늘면 카트가 병목이 아니다',
    has: (d) => (d.carts ?? []).length > 0,
    values: () => [1, 2, 3, 4, 6, 8],
    now: (d) => Math.max(1, Math.round((d.carts ?? [])[0]?.count ?? 1)),
    patch: (d, v) => ({ ...d, carts: (d.carts ?? []).map((c) => ({ ...c, count: v })) }),
  },
  {
    id: 'stillageCap',
    label: '적치대 수용량',
    unit: '개',
    why: '완충을 얼마나 둘까 — 늘려도 안 늘면 완충이 병목이 아니다',
    has: (d) => (d.placed ?? []).some((p) => d.isStillage?.(p)),
    values: () => [10, 20, 40, 80, 160],
    now: (d) => (d.placed ?? []).find((p) => d.isStillage?.(p))?.capacity ?? null,
    patch: (d, v) => ({
      ...d,
      placed: (d.placed ?? []).map((p) => (d.isStillage?.(p) ? { ...p, capacity: v } : p)),
    }),
  },
  {
    id: 'lotSize',
    label: '로트 크기',
    unit: '개',
    why: '몇 개마다 전환할까 — 크게 잡으면 전환이 싸지고 재공이 는다',
    has: (d) => (d.placed ?? []).some((p) => (p.setupSec ?? 0) > 0),
    values: () => [5, 10, 20, 40, 80, 160],
    now: (d) => (d.placed ?? []).find((p) => (p.setupSec ?? 0) > 0)?.lotSize ?? null,
    patch: (d, v) => ({
      ...d,
      placed: (d.placed ?? []).map((p) => ((p.setupSec ?? 0) > 0 ? { ...p, lotSize: v } : p)),
    }),
  },
  {
    id: 'setupSec',
    label: '전환 시간',
    unit: '초',
    why: '빠르게 바꾸면(SMED) 얼마나 좋아지나 — 설비를 더 사기 전에 볼 값이다',
    has: (d) => (d.placed ?? []).some((p) => (p.lotSize ?? 0) > 0),
    values: () => [0, 60, 120, 300, 600],
    now: (d) => (d.placed ?? []).find((p) => (p.lotSize ?? 0) > 0)?.setupSec ?? null,
    patch: (d, v) => ({
      ...d,
      placed: (d.placed ?? []).map((p) => ((p.lotSize ?? 0) > 0 ? { ...p, setupSec: v } : p)),
    }),
  },
  {
    id: 'beltSpeed',
    label: '벨트 속도',
    unit: 'm/s',
    why: '벨트를 빠르게 하면 — **돈이 안 드는 병목**인지 여기서 갈린다',
    has: (d) => (d.links ?? []).length > 0,
    values: () => [0.3, 0.45, 0.6, 0.9, 1.2, 1.8],
    now: (d) => d.beltSpeed ?? null,
    patch: (d, v) => ({ ...d, beltSpeed: v }),
  },
  {
    id: 'headcount',
    label: '교대 정원',
    unit: '명',
    why: '몇 명이면 도나 — 사람이 모자라면 배치를 고쳐도 안 풀린다',
    has: (d) => (d.shifts ?? []).length > 0,
    values: () => [0, 1, 2, 3, 4, 6, 8],
    now: (d) => (d.shifts ?? [])[0]?.headcount ?? null,
    patch: (d, v) => ({ ...d, shifts: (d.shifts ?? []).map((s) => ({ ...s, headcount: v })) }),
  },
];

export const knobOf = (id) => KNOBS.find((k) => k.id === id) ?? null;
/** 이 도면에서 돌릴 수 있는 손잡이들 */
export const knobsFor = (d) => KNOBS.filter((k) => k.has(d));

/**
 * 손잡이 하나를 돌려 가며 여러 판씩 돌린다.
 *
 *  @param d.knob   손잡이 id
 *  @param d.layout 지금 도면 (`patch` 에 넘길 것 — 원본은 안 바뀐다)
 *  @param d.build  patch 한 도면 → `{ world, flow }`. 화면 층이 준다
 *                  (모델 규격은 브라우저만 안다 — `ui/useLineWorld.js` 참고)
 *  @param d.pick   한 판에서 무엇을 볼지
 *  @returns { ok, why, knob, rows, best, knee }
 */
export function sweep(d = {}) {
  const knob = knobOf(d.knob);
  if (!knob) return { ok: false, why: 'no-knob', rows: [] };
  if (!knob.has(d.layout ?? {})) return { ok: false, why: 'not-here', knob, rows: [] };

  const values = (d.values ?? knob.values(d.layout)).slice(0, MAX_VALUES);
  const reps = Math.max(2, Math.round(d.reps ?? SWEEP_REPS));
  const rows = [];

  for (const v of values) {
    const layout = knob.patch(d.layout, v);
    const built = d.build?.(layout);
    if (!built?.world) continue;
    /**
     * **씨앗을 값마다 같게 준다** (common random numbers). 다른 운을 주면
     * 곡선이 들쭉날쭉해서 「여기서 꺾인다」가 운인지 실력인지 모르게 된다.
     */
    const r = replicate({
      reps, seconds: d.seconds ?? 1800, seed: d.seed ?? 1,
      world: built.world, flow: built.flow, pick: d.pick,
    });
    /* 판별 값을 그대로 들고 간다 — **짝지어 견주려면** 판마다의 값이 있어야 한다 */
    rows.push({ v, mean: r.mean, sd: r.sd, se: r.se, half: r.half, n: r.n, runs: r.runs });
  }

  if (!rows.length) return { ok: false, why: 'no-run', knob, rows: [] };
  if (!rows.some((x) => x.mean > 0)) return { ok: false, why: 'all-zero', knob, rows };

  return { ok: true, why: null, knob, rows, best: bestOf(rows), knee: kneeOf(rows) };
}

/** 가장 큰 값 (같으면 **작은 손잡이 값**이 이긴다 — 싼 쪽이다) */
export function bestOf(rows) {
  let top = null;
  for (const r of rows) if (!top || r.mean > top.mean) top = r;
  return top;
}

/**
 * **어디서부터 안 느는가.**
 * ---------------------------------------------------------------------------
 *  이것이 이 기능이 내놓는 답이다. 표만 내면 사람이 0.3 개/시 차이를 「늘었다」고
 *  읽는다. 이웃한 두 값이 **정말 다른지**를 Welch 로 묻고(`differs`), 그다음부터
 *  쭉 안 다르면 거기가 무릎이다.
 *
 *  「그다음부터 쭉」이 중요하다 — 한 번 안 늘었다고 바로 무릎이라고 하면,
 *  우연히 겹친 한 칸 때문에 아직 한참 오를 곡선을 잘라 버린다.
 *
 *  @returns { v, mean } · 끝까지 계속 늘면 null (「더 늘려 볼 값이 있다」)
 */
export function kneeOf(rows) {
  if (!rows || rows.length < 2) return null;
  for (let i = 0; i < rows.length - 1; i++) {
    let flat = true;
    for (let j = i + 1; j < rows.length; j++) {
      /**
       * **짝지어 견준다.** 값마다 같은 난수를 먹였으므로 판끼리 짝이 맞고,
       * 짝을 지어 빼면 「그날 운」이 상쇄된다. 남남으로 보면(Welch) ± 가
       * 넓어 못 가른다 — 실제로 적치대 691 → 821 을 「안 늘었다」고 했다.
       */
      const paired = rows[j].runs && rows[i].runs;
      const d = paired ? pairedDiffers(rows[i], rows[j]) : differs(rows[j], rows[i]);
      /* 뒤쪽이 **의미 있게 더 크면** 아직 무릎이 아니다 */
      /* 통계적으로 다른 것만으로는 모자란다 — **할 만큼** 늘어야 한다 */
      const worth = rows[j].mean > rows[i].mean * (1 + SWEEP_TIE);
      if (d.sure && worth) { flat = false; break; }
    }
    if (flat) return { v: rows[i].v, mean: rows[i].mean };
  }
  return null;
}

/**
 * 「**2대면 충분합니다** — 더 늘려도 안 늡니다」
 * ---------------------------------------------------------------------------
 *  **가장 큰 값이 아니라 무릎을 앞세운다.** 표에서 제일 큰 값은 흔들림 안에서
 *  우연히 위로 튄 것일 수 있다 — 실제로 카트 2대(1282 ± 209)와 4대(1284 ± 207)
 *  가 나왔을 때 「최고는 4대」라고 말하면 두 대를 괜히 더 사게 된다.
 *  무릎은 「이만큼이면 충분하다」라서 **그대로 실행할 수 있는 답**이다.
 */
export function kneeText(knee, knob) {
  if (!knee || !knob) return '끝까지 계속 늘고 있습니다 — 더 큰 값도 볼 만합니다';
  return `${knee.v}${knob.unit}면 충분합니다 — 더 늘려도 안 늡니다`;
}
