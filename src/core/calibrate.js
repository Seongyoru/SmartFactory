/**
 * =============================================================================
 *  실적 보정 — **이 모델이 실제와 얼마나 맞나**
 * =============================================================================
 *  컨설팅에서 제일 먼저 받는 질문이다. 처리량 1,200개/시라고 말해 봐야, 실제
 *  라인이 850개/시로 돌고 있으면 **그 도구는 안 믿긴다.** 그리고 그게 맞다 —
 *  안 맞는 모델로 배치를 바꾸면 안 되니까.
 *
 *  ── 두 가지를 답한다 ─────────────────────────────────────────────────────
 *      ① **얼마나 어긋났나** — 실적과 모델의 차이, 그리고 그게 흔들림 안인가
 *      ② **어느 손잡이를 돌리면 맞나** — 값을 훑어 실적에 가장 가까운 자리
 *
 *  ②가 요점이다. 「41% 높습니다」로 끝내면 사람이 손으로 값을 바꿔 가며 스무 번
 *  돌려야 한다. 그 일은 **손잡이 돌리기**(\`sweep.js\`)가 이미 하고 있다 —
 *  거기서 나온 표를 「가장 큰 값」이 아니라 **「실적에 가장 가까운 값」**으로
 *  읽으면 그게 보정이다. 새 엔진을 안 만든다.
 *
 *  ── **모델을 실적에 맞추는 것이 목적이 아니다** ──────────────────────────
 *  숫자만 맞추려 들면 아무 손잡이나 비틀어 맞출 수 있다. 그러면 맞는 것은 그
 *  숫자 하나뿐이고, 배치를 바꿨을 때의 예측은 더 나빠진다.
 *
 *  그래서 **후보를 사람이 고르게** 한다. 「카트가 실제로는 두 대였다」처럼
 *  도면과 현장이 다른 것을 짚을 때만 뜻이 있다. 도구는 「그 손잡이로는 이 값에서
 *  맞습니다」까지만 말하고, 그것을 받아들일지는 사람이 정한다.
 * ---------------------------------------------------------------------------
 */

import { pairedDiffers } from './replicate.js';

/**
 * 실적과 모델이 **이 안에서 같다**고 볼 차이 (5%).
 *  계측 오차와 날마다의 흔들림이 이 정도는 된다. 더 좁히면 늘 「안 맞는다」가
 *  뜨고, 더 넓히면 진짜 어긋난 모델을 통과시킨다.
 */
export const MATCH_TIE = 0.05;

/**
 * 얼마나 어긋났나.
 *  @param model  모델이 낸 값 (개/시)
 *  @param actual 실제 라인의 값 (개/시)
 *  @returns { ok, gap, ratio, over } · gap 은 절대 차이, ratio 는 실적 대비 비율
 *           ok 는 **볼 만큼 가까운가**(MATCH_TIE 안)
 */
export function matchOf(model, actual) {
  const a = Number(actual);
  const m = Number(model);
  if (!(a > 0) || !Number.isFinite(m)) return null;
  const gap = m - a;
  const ratio = gap / a;
  return { ok: Math.abs(ratio) <= MATCH_TIE, gap, ratio, over: gap > 0 };
}

/** 「모델이 41% 높습니다 (1,200 vs 850 개/시)」 */
export function matchText(match, model, actual) {
  if (!match) return '실적을 적으면 모델과 견줍니다';
  const n = (v) => Math.round(v).toLocaleString();
  if (match.ok) return `실적과 맞습니다 — ${n(model)} vs ${n(actual)} 개/시 (차이 ${(Math.abs(match.ratio) * 100).toFixed(0)}%)`;
  return `모델이 ${(Math.abs(match.ratio) * 100).toFixed(0)}% ${match.over ? '높습니다' : '낮습니다'} — ${n(model)} vs ${n(actual)} 개/시`;
}

/**
 * 훑어 본 값들 중 **실적에 가장 가까운 자리**.
 * ---------------------------------------------------------------------------
 *  \`sweep()\` 이 낸 표를 그대로 받는다 — 「가장 큰 값」(\`bestOf\`)이 아니라
 *  「가장 가까운 값」으로 읽는 것이 다를 뿐이다.
 *
 *  **가까운 것이 여럿이면 작은 쪽**을 고른다. 같은 설명력이면 덜 바꾸는 쪽이
 *  낫고, 손잡이 값은 대개 「대수 · 개수」라 작은 쪽이 현실적이다.
 *
 *  @returns { v, mean, match } · 표가 비었으면 null
 */
export function fitOf(rows, actual) {
  const a = Number(actual);
  if (!(a > 0) || !rows?.length) return null;
  let best = null;
  for (const r of rows) {
    const d = Math.abs(r.mean - a);
    if (!best || d < best.d - 1e-9) best = { v: r.v, mean: r.mean, d, row: r };
  }
  return best ? { v: best.v, mean: best.mean, match: matchOf(best.mean, a), row: best.row } : null;
}

/**
 * 그 자리가 **정말 설명이 되나.**
 * ---------------------------------------------------------------------------
 *  가장 가까운 값이라도 실적과 한참 멀 수 있다 — 그때 「카트를 2대로 하세요」라고
 *  말하면 **틀린 확신**을 주는 것이다. 그 손잡이로는 설명이 안 된다고 말해야 한다.
 */
export function fitText(fit, knob, actual) {
  if (!fit || !knob) return '훑어 본 값이 없습니다';
  const n = (v) => Math.round(v).toLocaleString();
  if (!fit.match?.ok) {
    return `이 손잡이로는 실적이 설명되지 않습니다 — 제일 가까운 ${fit.v}${knob.unit}에서도 ${n(fit.mean)} vs ${n(actual)} 개/시`;
  }
  return `${fit.v}${knob.unit}면 실적과 맞습니다 — ${n(fit.mean)} vs ${n(actual)} 개/시`;
}

/**
 * 지금 도면 값에서 **정말 달라졌나** — 짝지어 견준다.
 *  보정으로 고른 자리가 원래 값과 통계적으로 구별이 안 되면, 그건 「바꿀 것이
 *  없다」는 뜻이다. 그 말을 안 하면 사람이 아무 뜻 없는 변경을 하게 된다.
 */
export function movedFrom(rows, now, fit) {
  if (!rows?.length || !fit) return null;
  const from = rows.find((r) => r.v === now);
  if (!from || from.v === fit.v) return null;
  const d = from.runs && fit.row?.runs ? pairedDiffers(from, fit.row) : null;
  return { from, sure: !!d?.sure };
}
