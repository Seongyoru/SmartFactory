/**
 * =============================================================================
 *  흔들림의 모양 — 확률 분포
 * =============================================================================
 *  이 도구는 이미 여러 판을 돌려 ± 를 내고 Welch 로 「정말 다른가」까지 답한다.
 *  그런데 입력이 **균등분포 하나뿐**이면 그 통계가 반쪽이다 — 나오는 ± 는
 *  「이 배치가 얼마나 흔들리나」가 아니라 「내가 균등분포를 가정했을 때」다.
 *
 *  ── 여기서 지켜야 하는 것 ─────────────────────────────────────────────────
 *  **넷 다 평균이 1 이어야 한다.** 모양을 바꿔도 라인의 천장이 안 움직여야
 *  두 배치를 견줄 때 「배치 차이인지 분포 차이인지」를 가를 수 있다. 이 성질이
 *  깨지면 이 도구가 하려는 일이 통째로 무너진다.
 * ---------------------------------------------------------------------------
 */

import assert from 'node:assert/strict';
import { SRC, group, readSrc, t } from './_harness.mjs';

group('흔들림의 모양');

const R = await import(SRC + 'core/random.js');
const P = await import(SRC + 'core/process.js');
const Rep = await import(SRC + 'core/replicate.js');

const N = 200_000;
/** 씨앗을 고정해 돌린다 — 검사가 그날 운에 달리면 안 된다 */
const sample = (shape, r, n = N) => {
  const rand = Rep.seeded(12345);
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = R.drawShape(r, rand, shape);
  return out;
};
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
/* 스프레드로 최대·최소를 구하면 표본 20만 개에서 스택이 터진다 — 접어서 센다 */
const hi = (xs) => xs.reduce((a, x) => (x > a ? x : a), -Infinity);
const lo = (xs) => xs.reduce((a, x) => (x < a ? x : a), Infinity);
const sd = (xs) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
};

/* ---------- 평균이 1 이다 (이 파일에서 제일 중요한 것) -------------------- */
t('**넷 다 평균이 1 이다** — 모양을 바꿔도 천장이 안 움직인다', () => {
  for (const s of R.SHAPES) {
    for (const r of [0.1, 0.3, 0.5]) {
      const m = mean(sample(s.id, r, 60_000));
      assert.ok(Math.abs(m - 1) < 0.01, `${s.id} ±${r}: 평균이 ${m.toFixed(3)} 이다`);
    }
  }
});

t('퍼짐이 0 이면 흔들리지 않는다 — 정확히 1', () => {
  for (const s of R.SHAPES) {
    assert.equal(R.drawShape(0, Math.random, s.id), 1, `${s.id} 가 0 인데 흔들린다`);
  }
});

t('퍼짐을 키우면 흔들림도 커진다', () => {
  for (const s of R.SHAPES) {
    const a = sd(sample(s.id, 0.1, 40_000));
    const b = sd(sample(s.id, 0.4, 40_000));
    assert.ok(b > a * 2, `${s.id}: 퍼짐을 네 배로 했는데 흔들림이 ${(b / a).toFixed(1)}배다`);
  }
});

/* ---------- 모양이 실제로 다른가 ------------------------------------------ */
t('**「고르게」와 「최소·보통·최대」는 꼬리가 없다** — ± 밖으로 안 나간다', () => {
  for (const s of ['flat', 'peak']) {
    const xs = sample(s, 0.3);
    assert.ok(hi(xs) <= 1.3 + 1e-9, `${s} 가 ± 밖으로 나갔다`);
    assert.ok(lo(xs) >= 0.7 - 1e-9, `${s} 가 ± 밖으로 나갔다`);
  }
});

t('**「가끔 길게」는 오른쪽 꼬리가 있다** — 버퍼가 필요한 이유', () => {
  /* 꼬리 없는 분포로 돌리면 버퍼를 실제보다 작게 잡게 된다 */
  const tail = sample('tail', 0.3);
  const flat = sample('flat', 0.3);
  assert.ok(hi(tail) > 1.3, `꼬리가 없다 (최대 ${hi(tail).toFixed(2)})`);
  assert.ok(hi(tail) > hi(flat) * 1.2, '고르게보다 꼬리가 안 길다');
  /* 그리고 **왼쪽으로는 0 밑으로 안 간다** */
  assert.ok(lo(tail) > 0, '음수가 나온다');
});

t('「가운데로」는 좌우가 비슷하다 — 대칭', () => {
  const xs = sample('bell', 0.3);
  const over = xs.filter((x) => x > 1).length / xs.length;
  assert.ok(Math.abs(over - 0.5) < 0.02, `한쪽으로 쏠렸다 (${(over * 100).toFixed(0)}%)`);
});

t('가운데가 흔한 모양은 **고르게보다 덜 흔들린다**', () => {
  /* 같은 ± 라도 가운데로 모이면 표준편차가 작다 — 모양이 결과를 바꾼다는 증거 */
  const flat = sd(sample('flat', 0.3));
  assert.ok(sd(sample('peak', 0.3)) < flat, '삼각이 균등보다 안 좁다');
  assert.ok(sd(sample('bell', 0.3)) < flat, '정규가 균등보다 안 좁다');
});

t('0 이나 음수 시간은 안 나온다', () => {
  for (const s of R.SHAPES) {
    const xs = sample(s.id, 0.9, 40_000);
    assert.ok(lo(xs) >= R.MIN_MULT, `${s.id} 에서 ${lo(xs)} 가 나왔다`);
  }
});

/* ---------- 되풀이할 수 있는가 -------------------------------------------- */
t('씨앗이 같으면 **같은 값이 나온다** — 반복 실행이 이것에 기댄다', () => {
  for (const s of R.SHAPES) {
    const a = sample(s.id, 0.3, 500);
    const b = sample(s.id, 0.3, 500);
    assert.deepEqual(a, b, `${s.id} 가 씨앗을 고정해도 다르다`);
  }
});

/* ---------- 모르는 값은 예전 그대로 --------------------------------------- */
t('모르는 모양은 **예전 그대로**다 — 이미 그린 도면이 안 바뀐다', () => {
  assert.equal(R.shapeOf(undefined), 'flat');
  assert.equal(R.shapeOf('없는것'), 'flat');
  assert.equal(R.DEFAULT_SHAPE, 'flat');
  /* 그리고 기본값으로 뽑은 값이 옛 식과 같아야 한다 */
  const rand = Rep.seeded(7);
  const old = (r, f) => Math.max(0.05, 1 + r * (f() * 2 - 1));
  const a = R.drawShape(0.3, rand, 'flat');
  const b = old(0.3, Rep.seeded(7));
  assert.ok(Math.abs(a - b) < 1e-12, `기본값이 옛 식과 다르다 (${a} vs ${b})`);
});

/* ---------- 라인에 실제로 붙었는가 ---------------------------------------- */
t('공정 시간이 모양을 쓴다', () => {
  const one = (shape) => {
    P.resetWork();
    const rand = Rep.seeded(3);
    let made = 0;
    const t0 = 600;
    for (let s = 0; s < t0; s += 0.1) {
      made += P.runMachine('X', 0.1, { cycleSec: 6, cycleVar: 0.5, room: 99, rand, shape });
    }
    return made;
  };
  /* 모양이 다르면 **같은 씨앗이라도 다른 라인이 나온다** — 안 그러면 안 쓰이는 것 */
  assert.notEqual(one('flat'), one('tail'), '모양을 바꿔도 결과가 같다 — 안 쓰이고 있다');
});

t('설비가 고른 모양을 읽는다', () => {
  assert.equal(P.shapeOf({}, {}), 'flat');
  assert.equal(P.shapeOf({ varShape: 'tail' }, {}), 'tail');
  assert.equal(P.shapeOf({ varShape: '없는것' }, {}), 'flat');
});

/* ---------- 수리 시간도 흔들리는가 ---------------------------------------- */
const F = await import(SRC + 'core/faults.js');

t('**수리 시간도 흔들린다** — 지금까지는 고정값이었다', () => {
  const one = (repairVar) => {
    F.resetFaults();
    const rand = Rep.seeded(5);
    const eq = [{ uid: 'M', mtbf: 60, mttr: 300, repairVar, shape: 'tail' }];
    let downTicks = 0;
    for (let s = 0; s < 20_000; s += 1) {
      const down = F.stepFaults(1, eq, rand);
      if (down.has('M')) downTicks++;
    }
    return downTicks;
  };
  /* 평균은 그대로라 **선 시간의 총합은 비슷**하지만 값이 달라야 한다 */
  const fixed = one(0);
  const varied = one(0.5);
  assert.notEqual(fixed, varied, '수리 편차를 줘도 결과가 같다 — 안 쓰이고 있다');
  assert.ok(Math.abs(varied - fixed) / fixed < 0.25, `평균이 크게 어긋났다 (${fixed} vs ${varied})`);
});

t('수리 편차를 안 주면 예전 그대로', () => {
  const run = () => {
    F.resetFaults();
    const rand = Rep.seeded(9);
    let n = 0;
    for (let s = 0; s < 5000; s += 1) if (F.stepFaults(1, [{ uid: 'M', mtbf: 60, mttr: 300 }], rand).has('M')) n++;
    return n;
  };
  const a = run();
  const b = run();
  assert.equal(a, b, '같은 씨앗인데 다르다');
});

/* ---------- 배선 ---------------------------------------------------------- */
const lineupSrc = await readSrc('core/lineup.js');
const simSrc = await readSrc('core/sim.js');
const inspSrc = await readSrc('ui/Inspector.jsx');
const sceneSrc = await readSrc('scene/EditorScene.jsx');
const faultSrc = await readSrc('core/faults.js');

t('모양이 굴리는 쪽까지 간다', () => {
  assert.ok(lineupSrc.includes('shape: shapeOf(p, item)'), '설비 목록이 모양을 안 싣는다');
  assert.ok(simSrc.includes('shape: m.shape'), 'sim 이 모양을 안 넘긴다');
  assert.ok(faultSrc.includes('drawShape(e.repairVar ?? 0, rand, e.shape)'), '수리 시간이 안 흔들린다');
});

t('**화면과 헤드리스가 같은 값을 넘긴다**', () => {
  /* 갈리면 눈으로 본 라인과 여러 판이 돌린 라인이 달라진다.
     `/shape:/` 로 보면 안 된다 — 이 파일에는 **구역의 shape** 도 있어서
     고장 쪽을 통째로 지워도 통과한다(되돌리기 테스트로 확인했다). */
  assert.ok(lineupSrc.includes('shape: m.shape'), '헤드리스가 모양을 안 넘긴다');
  assert.ok(lineupSrc.includes('repairVar: m.at?.repairVar'), '헤드리스가 수리 편차를 안 넘긴다');
  assert.ok(sceneSrc.includes('shape: varShapeOf(p, itemOf(p.itemId))'), '화면이 모양을 안 넘긴다');
  assert.ok(sceneSrc.includes('repairVar: p.repairVar ?? FAULT_DEFAULTS.repairVar'), '화면이 수리 편차를 안 넘긴다');
});

t('화면이 모양을 고르게 해 준다 — 그리고 **평균은 같다**고 말한다', () => {
  assert.ok(inspSrc.includes("patch: { varShape: s.id }"), '모양을 저장 안 한다');
  assert.ok(inspSrc.includes('흔들리는 모양'), '고르는 칸이 없다');
  assert.ok(inspSrc.includes('천장은 안 바뀌고 흔들림만 달라집니다'), '평균이 같다는 것을 안 말한다');
  assert.ok(inspSrc.includes('label="수리 시간 편차"'), '수리 편차 칸이 없다');
});

t('모양 이름이 **무슨 일이 벌어지나**로 적혀 있다', () => {
  /* 로그정규를 아는 사람만 쓰는 도구가 아니다 — 통계 이름은 곁들이는 말이다 */
  const labels = R.SHAPES.map((s) => s.label);
  assert.deepEqual(labels, ['고르게', '가운데로', '가끔 길게', '최소·보통·최대']);
  for (const s of R.SHAPES) {
    assert.ok(s.stat && s.why, `${s.id} 에 설명이 없다`);
    assert.notEqual(s.label, s.stat, `${s.id} 의 이름이 통계 용어다`);
  }
});
