/**
 * =============================================================================
 *  민감도 — **어느 입력이 결과를 가장 크게 흔드나**
 * =============================================================================
 *  손잡이 돌리기는 한 손잡이를 골라 값을 훑는다. 그 **앞의 물음** — 애초에 어느
 *  손잡이를 잡을까 — 에는 답하지 못했다.
 *
 *  ── 여기서 지켜야 하는 것 ─────────────────────────────────────────────────
 *  **① 이웃 값으로 흔든다.** 손잡이 값이 대수·개수라 「±20%」가 안 된다.
 *  **② 흔들림 안이면 안 흔든다고 한다.** 2% 차이는 운일 수 있다 — 그걸 「가장
 *     크게 흔든다」고 세우면 엉뚱한 데를 손보게 된다.
 *  **③ 손잡이 돌리기와 같은 문턱을 쓴다.** 두 곳이 다르면 같은 도면에서
 *     「무릎은 2대인데 민감도로는 안 흔든다」 같은 말이 나온다.
 *  **④ 떨어지는 쪽이 먼저다.** 올리면 좋아지는 것은 기회고, 내리면 나빠지는
 *     것은 위험이다 — 위험이 급하다.
 * ---------------------------------------------------------------------------
 */

import assert from 'node:assert/strict';
import { SRC, group, readSrc, t } from './_harness.mjs';

group('민감도');

const S = await import(SRC + 'core/sensitivity.js');
const Sw = await import(SRC + 'core/sweep.js');

/* ---------- 어디로 흔드나 -------------------------------------------------- */
const knob = { values: () => [1, 2, 3, 4, 6, 8], now: (d) => d.n, unit: '대', label: '카트 대수' };

t('**한 칸 아래와 한 칸 위**를 본다', () => {
  assert.deepEqual(S.stepsOf(knob, { n: 3 }), { base: 3, low: 2, high: 4 });
});

t('끝에서는 **한쪽만** 본다', () => {
  assert.deepEqual(S.stepsOf(knob, { n: 1 }), { base: 1, low: null, high: 2 });
  assert.deepEqual(S.stepsOf(knob, { n: 8 }), { base: 8, low: 6, high: null });
});

t('목록에 없는 값이면 **가장 가까운 자리**로 본다', () => {
  /* 손으로 적은 도면이 있다 — 거기서 아무 말도 못 하면 기능이 반만 산다 */
  assert.deepEqual(S.stepsOf(knob, { n: 5 }), { base: 4, low: 3, high: 6 });
  /* 읽을 값이 아예 없으면 아무 말도 안 한다 */
  assert.equal(S.stepsOf(knob, {}), null);
  assert.equal(S.stepsOf({}, {}), null);
});

/* ---------- 얼마나 흔들리나 ------------------------------------------------ */
const row = (mean, runs) => ({ mean, runs, sd: 1, se: 1, half: 1, n: runs.length });
/** 판마다 거의 같은 값 — 짝지어 보면 확실히 다르다고 나온다 */
const tight = (v) => row(v, [v, v + 0.5, v - 0.5, v, v + 0.4, v - 0.4]);

t('**내려가면 음수 · 올라가면 양수**', () => {
  const s = S.swingOf({ base: tight(100), low: tight(60), high: tight(120) });
  assert.ok(Math.abs(s.drop + 0.4) < 0.02, `${s.drop}`);
  assert.ok(Math.abs(s.rise - 0.2) < 0.02, `${s.rise}`);
  assert.ok(s.sureDown && s.sureUp);
  assert.ok(Math.abs(s.span - 0.6) < 0.03);
});

t('**흔들림 안이면 폭에 안 넣는다**', () => {
  /* 운을 폭에 넣으면 세우는 순서가 매번 바뀐다.
     **문턱 바로 아래(1.5%)로 잰다** — 0.5% 로 재면 새는 값이 너무 작아서
     되돌려도 안 물린다(실제로 그렇게 안 물렸다). */
  const s = S.swingOf({ base: tight(100), low: tight(98.5), high: tight(140) });
  assert.equal(s.sureDown, false, '1.5% 차이를 흔들렸다고 한다');
  assert.ok(s.sureUp);
  assert.ok(Math.abs(s.span - 0.4) < 0.005, `폭에 운이 섞였다 (${s.span})`);
});

t('**손잡이 돌리기와 같은 문턱**을 쓴다', () => {
  /* 통계적으로 다르기만 해서는 모자란다 — 할 만큼 달라야 한다 */
  const just = 1 + Sw.SWEEP_TIE / 2;                 // 문턱의 절반만 움직였다
  const s = S.swingOf({ base: tight(100), low: tight(100 * just), high: null });
  assert.equal(s.sureDown, false, `문턱(${Sw.SWEEP_TIE})보다 작은데 흔들렸다고 한다`);
});

t('아무것도 안 나온 도면에서는 **아무 말도 안 한다**', () => {
  assert.equal(S.swingOf({ base: row(0, [0, 0, 0]) }), null);
  assert.equal(S.swingOf({}), null);
  assert.equal(S.swingOf(null), null);
});

/* ---------- 세우는 순서 ---------------------------------------------------- */
const mk = (label, span, drop) => ({
  knob: { label, unit: '대' }, steps: { base: 2, low: 1, high: 3 },
  swing: { span, drop, rise: 0, sureDown: true, sureUp: false },
});

t('**크게 흔드는 순**으로 세운다', () => {
  const r = S.rankOf([mk('작다', 0.1, -0.1), mk('크다', 0.5, -0.5), mk('중간', 0.3, -0.3)]);
  assert.deepEqual(r.map((x) => x.knob.label), ['크다', '중간', '작다']);
});

t('같은 폭이면 **떨어지는 쪽이 큰 것**이 먼저', () => {
  /* 올리면 좋아지는 것은 기회고, 내리면 나빠지는 것은 위험이다 */
  const r = S.rankOf([mk('기회', 0.4, -0.05), mk('위험', 0.4, -0.4)]);
  assert.deepEqual(r.map((x) => x.knob.label), ['위험', '기회']);
});

t('흔들 것이 없으면 그렇게 말한다', () => {
  assert.match(S.tornadoText([]), /흔드는 손잡이가 없습니다/);
  assert.match(S.tornadoText(null), /흔드는 손잡이가 없습니다/);
  const flat = [{
    knob: { label: '카트 대수', unit: '대' }, steps: { base: 2, low: 1, high: 3 },
    swing: { span: 0, drop: 0, rise: 0, sureDown: false, sureUp: false },
  }];
  assert.match(S.tornadoText(flat), /눈에 띄게 안 변합니다/);
});

/* ---------- 말이 읽히나 ---------------------------------------------------- */
t('**받침에 맞는 조사**를 쓴다 — 「수용량가」로 적히면 안 된다', () => {
  assert.equal(S.josa('적치대 수용량', '이', '가'), '이');
  assert.equal(S.josa('카트 대수', '이', '가'), '가');
  assert.equal(S.josa('전환 시간', '이', '가'), '이');
  assert.equal(S.josa('벨트 속도', '이', '가'), '가');
  /* 한글이 아니면 받침 없는 쪽 — 터지지만 않으면 된다 */
  assert.equal(S.josa('belt', '이', '가'), '가');
  assert.equal(S.josa('', '이', '가'), '가');
  assert.equal(S.josa(null, '이', '가'), '가');
});

t('한 줄에 **양쪽을 다** 적는다', () => {
  const r = {
    knob: { label: '카트 대수', unit: '대' }, steps: { base: 2, low: 1, high: 3 },
    swing: { span: 0.4, drop: -0.38, rise: 0.02, sureDown: true, sureUp: false },
  };
  const line = S.swingText(r);
  assert.match(line, /1대 -38%/);
  /* 흔들림 안인 쪽은 줄표 — 「+2%」로 적으면 운을 값처럼 읽는다 */
  assert.match(line, /3대 —/);
  assert.match(S.tornadoText([r]), /카트 대수가 가장 크게 흔듭니다/);
  assert.match(S.tornadoText([r]), /1대로 내리면 -38%/);
});

/* ---------- 화면 ---------------------------------------------------------- */
const dockSrc = await readSrc('ui/RunDock.jsx');

t('실행 띠에 **값을 훑기 전의 물음**이 있다', () => {
  assert.ok(dockSrc.includes('<Col title="어느 손잡이가 흔드나"'), '민감도 칸이 없다');
  assert.ok(dockSrc.includes('<Tornado />'), '민감도를 안 그린다');
  /* 값을 훑는 칸 **옆**에 둔다 — 「먼저 이걸 보고 그다음 저기서 훑는다」 */
  assert.ok(dockSrc.indexOf('<Sweep />') < dockSrc.indexOf('<Tornado />'), '순서가 거꾸로다');
});

t('손잡이마다 **잘라서** 돌린다 — 화면이 안 멈춘다', () => {
  /* 손잡이 여섯 × 세 값 × 네 판을 한 덩어리로 하면 몇 초씩 멈춘다 */
  assert.ok(dockSrc.includes('if (++i < knobs.length) { setTimeout(tick, 0); return; }'),
    '민감도가 한 덩어리로 돈다');
});

t('민감도는 **판을 줄인다** — 순서만 가리면 된다', () => {
  /* 값을 훑는 쪽보다 돌릴 것이 몇 배 많다. 같은 판수로 하면 몇 분씩 걸린다 */
  assert.ok(dockSrc.includes('const TORNADO_REPS = 4;'), '판수를 안 줄였다');
  assert.ok(dockSrc.includes('const TORNADO_MIN = 10;'), '한 판 길이를 안 줄였다');
});

t('**흔들림 안**이 무슨 뜻인지 적어 준다', () => {
  /* 줄표만 있으면 「못 쟀다」로 읽는다 */
  assert.ok(dockSrc.includes('흔들림 안'), '줄표가 무슨 뜻인지 안 말한다');
});
