/**
 * =============================================================================
 *  민감도 — **어느 입력이 결과를 가장 크게 흔드나**
 * =============================================================================
 *  손잡이 돌리기는 **한 손잡이**를 골라 값을 훑는다. 「카트를 몇 대 둘까」에는
 *  답하지만, 그 앞의 물음에는 답하지 못한다 — **애초에 어느 손잡이를 잡을까.**
 *
 *  손잡이가 여섯이면 여섯 번 훑어야 하고, 그러면 사람이 표 여섯 개를 눈으로
 *  견줘야 한다. 그 일을 도구가 한다.
 *
 *  ── **이웃 값으로 한 칸씩** 흔든다 ───────────────────────────────────────
 *  「±20%」로 흔들 수가 없다. 손잡이 값이 대개 **대수 · 개수**라 2.4대 같은 것이
 *  없기 때문이다. 그래서 지금 값의 **바로 아래와 바로 위**를 본다.
 *
 *      카트 2대 → 1대 로 내리면 −38% · 3대 로 올리면 +2%
 *
 *  이게 더 정직하기도 하다. 실제로 할 수 있는 변경이 그것이고, 「20% 늘리면」은
 *  현장에서 못 하는 말이다.
 *
 *  ── 흔들림 안이면 **안 흔든다고 말한다** ─────────────────────────────────
 *  판마다 결과가 흔들리므로 2% 차이는 운일 수 있다. 손잡이 돌리기가 무릎을 찾을
 *  때 쓰는 잣대(`SWEEP_TIE`)를 그대로 쓴다 — 두 곳이 다른 문턱을 쓰면 같은
 *  도면에서 「무릎은 2대인데 민감도로는 안 흔든다」 같은 말이 나온다.
 *
 *  ── 세우는 순서는 **떨어지는 쪽**이 먼저다 ───────────────────────────────
 *  「올리면 좋아지는 것」과 「내리면 나빠지는 것」 중 **뒤쪽이 급하다.** 앞쪽은
 *  기회고 뒤쪽은 위험이다 — 카트 한 대가 고장 나면 라인이 38% 빠진다는 말은
 *  그대로 예비 대수의 근거가 된다.
 * ---------------------------------------------------------------------------
 */

import { pairedDiffers } from './replicate.js';
import { SWEEP_TIE } from './sweep.js';

/**
 * 이 손잡이를 한 칸씩 흔들면 어디로 가나.
 * ---------------------------------------------------------------------------
 *  지금 값이 목록에 없으면(손으로 적은 값) **가장 가까운 자리**로 본다.
 *  @returns { base, low, high } · 끝이면 low 나 high 가 null
 */
export function stepsOf(knob, layout) {
  if (!knob?.values) return null;
  const values = knob.values(layout);
  if (!values?.length) return null;
  const now = knob.now?.(layout);
  let at = values.indexOf(now);
  if (at < 0) {
    /* 목록에 없는 값 — 가장 가까운 자리를 지금 자리로 본다 */
    if (!Number.isFinite(now)) return null;
    let best = 0;
    for (let i = 1; i < values.length; i++) {
      if (Math.abs(values[i] - now) < Math.abs(values[best] - now)) best = i;
    }
    at = best;
  }
  return {
    base: values[at],
    low: at > 0 ? values[at - 1] : null,
    high: at < values.length - 1 ? values[at + 1] : null,
  };
}

/**
 * 한 손잡이의 흔들림.
 * ---------------------------------------------------------------------------
 *  @param rows { base, low, high } — 각각 `replicate` 의 결과(runs 를 들고 있다)
 *  @returns { drop, rise, span, sureDown, sureUp }
 *           drop 내리면 몇 % 빠지나 (음수) · rise 올리면 몇 % 느나 (양수)
 *           span 둘을 합친 폭 — 세우는 순서가 이 값이다
 */
export function swingOf(rows) {
  const base = rows?.base;
  if (!base || !(base.mean > 0)) return null;
  const rel = (r) => (r ? (r.mean - base.mean) / base.mean : null);
  /* **정말 흔들렸나** — 판마다의 값을 짝지어 견준다(같은 씨앗을 먹였다) */
  const sure = (r) => {
    if (!r?.runs || !base.runs) return false;
    const d = pairedDiffers(base, r);
    return !!d.sure && Math.abs((r.mean - base.mean) / base.mean) > SWEEP_TIE;
  };
  const drop = rel(rows.low);
  const rise = rel(rows.high);
  const sureDown = sure(rows.low);
  const sureUp = sure(rows.high);
  /* 흔들림 안인 쪽은 **0으로 본다** — 운을 폭에 넣으면 순서가 매번 바뀐다 */
  const d = sureDown && drop != null ? drop : 0;
  const u = sureUp && rise != null ? rise : 0;
  return { drop, rise, span: Math.abs(d) + Math.abs(u), sureDown, sureUp };
}

/**
 * 크게 흔드는 순으로 세운다.
 *  같은 폭이면 **떨어지는 쪽이 큰 것**을 앞세운다 — 기회보다 위험이 급하다.
 */
export function rankOf(list) {
  return [...(list ?? [])]
    .filter((x) => x?.swing)
    .sort((a, b) => {
      const g = b.swing.span - a.swing.span;
      if (Math.abs(g) > 1e-9) return g;
      return Math.abs(b.swing.drop ?? 0) - Math.abs(a.swing.drop ?? 0);
    });
}

const pct = (v) => `${v > 0 ? '+' : ''}${(v * 100).toFixed(0)}%`;

/**
 * 받침에 맞는 조사 — 「적치대 수용량**이**」 · 「카트 대수**가**」.
 * ---------------------------------------------------------------------------
 *  손잡이 이름이 도면에서 오므로 조사를 박아 둘 수가 없다. 「수용량가」로 적히면
 *  읽는 사람이 문장을 두 번 읽게 되고, 그만큼 도구가 덜 미덥다.
 *
 *  한글 음절은 0xAC00 부터 28개씩 묶여 있고 그 안에서의 자리가 곧 받침이다.
 */
export function josa(word, withFinal, withoutFinal) {
  const last = String(word ?? '').trim().slice(-1);
  const code = last.charCodeAt(0) - 0xac00;
  if (!(code >= 0 && code <= 11171)) return withoutFinal;   // 한글이 아니면 받침 없는 쪽
  return code % 28 ? withFinal : withoutFinal;
}

/** 「카트 대수가 가장 크게 흔듭니다 — 1대로 내리면 38%가 빠집니다」 */
export function tornadoText(ranked) {
  const top = ranked?.[0];
  if (!top) return '흔드는 손잡이가 없습니다';
  if (top.swing.span <= 0) {
    return '어느 손잡이를 한 칸 흔들어도 **눈에 띄게 안 변합니다** — 지금 값들이 다 여유롭습니다';
  }
  const parts = [];
  if (top.swing.sureDown) parts.push(`${top.steps.low}${top.knob.unit}로 내리면 ${pct(top.swing.drop)}`);
  if (top.swing.sureUp) parts.push(`${top.steps.high}${top.knob.unit}로 올리면 ${pct(top.swing.rise)}`);
  return `${top.knob.label}${josa(top.knob.label, '이', '가')} 가장 크게 흔듭니다 — ${parts.join(' · ')}`;
}

/** 한 줄짜리 설명 — 「2대 → 1대 −38% · 3대 +2%」 */
export function swingText(row) {
  if (!row?.swing) return '';
  const s = row.swing;
  const bits = [];
  if (row.steps.low != null) {
    bits.push(s.sureDown ? `${row.steps.low}${row.knob.unit} ${pct(s.drop)}` : `${row.steps.low}${row.knob.unit} —`);
  }
  if (row.steps.high != null) {
    bits.push(s.sureUp ? `${row.steps.high}${row.knob.unit} ${pct(s.rise)}` : `${row.steps.high}${row.knob.unit} —`);
  }
  return bits.join(' · ');
}
