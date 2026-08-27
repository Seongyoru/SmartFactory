/**
 * 벨트 한 줄의 흐름 — 자리 계산과 재료 셈.
 *  예전에는 BeltItems.jsx 에서 블록을 떼어 돌렸다. 이제 `core/belt.js` 라 그냥 부른다.
 *  여기서 나오는 수가 그대로 재고와 처리량이 되므로, 개수가 새거나 늘면 안 된다.
 */
import assert from 'node:assert/strict';
import { SRC, group, readSrc, t } from './_harness.mjs';

group('벨트 흐름');

const B = await import(SRC + 'core/belt.js');

/** 한 프레임 굴리기 — 기본 도면: 길이 30, 간격 3 → 칸 11개 */
const setup = ({ length = 30, step = 3 } = {}) => B.makeBelt(B.beltCount(length, step));
const run = (st, d, opt = {}) =>
  B.advanceBelt(st, { d, step: 3, length: 30, ...opt });

/** 벨트 위에 실제로 보이는 물건 수 */
const onBelt = (st, { step = 3, length = 30 } = {}) => {
  let n = 0;
  for (let k = 0; k < st.fill.length; k++) {
    if (B.beltOffset(st, step) + k * step <= length && B.beltHas(st, k)) n++;
  }
  return n;
};

/* ---------- 칸 수 ---------- */
t('길이 ÷ 간격 + 1 칸', () => {
  assert.equal(B.beltCount(30, 3), 11);
  assert.equal(B.beltCount(10, 3), 4);        // 0, 3, 6, 9
});
t('길이가 0 이면 칸이 없다', () => {
  assert.equal(B.beltCount(0, 3), 0);
  assert.equal(B.beltCount(30, 0), 0);
});
t('아주 촘촘해도 상한을 넘지 않는다', () => {
  assert.equal(B.beltCount(1000, 0.4), B.MAX_ITEMS);
});

/* ---------- 올라타기 ---------- */
t('처음 한 걸음에 첫 덩어리가 올라탄다', () => {
  const st = setup();
  run(st, 1);
  assert.equal(st.born, 0);
  assert.equal(onBelt(st), 1);
  assert.ok(Math.abs(B.beltOffset(st, 3) - 1) < 1e-9);
});
t('간격을 지날 때마다 한 덩어리씩 는다', () => {
  const st = setup();
  for (let i = 0; i < 9; i++) run(st, 1);       // 9m
  assert.equal(onBelt(st), 4);                  // 0, 3, 6, 9 자리
});
t('한 프레임에 여러 덩어리가 올라타도 안 빠뜨린다', () => {
  const st = setup();
  run(st, 7);                                   // 0 → 7 은 3, 6 두 경계 + 첫 덩어리
  assert.equal(st.born, 2);
  assert.equal(onBelt(st), 3);
});

/* ---------- 끝에 닿기 ---------- */
t('벨트 길이만큼 가면 첫 덩어리가 도착한다', () => {
  const st = setup();
  let got = 0;
  for (let i = 0; i < 31; i++) got += run(st, 1);
  assert.equal(got, 1);
});
t('한 프레임에 여러 개가 지나가도 안 빠뜨린다', () => {
  const st = setup();
  for (let i = 0; i < 30; i++) run(st, 1);       // 벨트를 꽉 채웠다
  const got = run(st, 9);                        // 세 칸치를 한 번에
  assert.equal(got, 3);
});
t('넣은 만큼만 나온다 — 오래 돌려도 개수가 안 샌다', () => {
  const st = setup();
  let out = 0;
  for (let i = 0; i < 2000; i++) out += run(st, 0.37);
  const total = st.born + 1;                     // 지금까지 올라탄 덩어리 수
  assert.equal(out + onBelt(st), total, `나간 ${out} + 위 ${onBelt(st)} ≠ 올라탄 ${total}`);
});

/* ---------- 재료를 못 낼 때 = **빈칸**이 흐른다 ---------- */
t('재료를 하나도 못 내면 빈칸만 지나간다 — 벨트는 계속 간다', () => {
  const st = setup();
  const calls = [];
  for (let i = 0; i < 30; i++) run(st, 1, { spawn: (k) => { calls.push(k); return 0; } });
  assert.equal(onBelt(st), 0, '빈 벨트여야 한다');
  assert.ok(Math.abs(st.trav - 30) < 1e-9, `벨트가 섰다: trav=${st.trav}`);
  assert.ok(calls.length > 0, '청구는 계속 해야 한다');
});
t('굶는 동안에는 도착이 없다', () => {
  const st = setup();
  let got = 0;
  for (let i = 0; i < 200; i++) got += run(st, 1, { spawn: () => 0 });
  assert.equal(got, 0);
});
t('feeding=false 면 청구조차 안 한다', () => {
  const st = setup();
  let asked = 0;
  for (let i = 0; i < 30; i++) run(st, 1, { feeding: false, spawn: () => { asked++; return 9; } });
  assert.equal(asked, 0);
  assert.equal(onBelt(st), 0);
  assert.ok(Math.abs(st.trav - 30) < 1e-9);
});
t('두 개 중 하나만 냈으면 하나는 물건, 하나는 빈칸', () => {
  const st = setup();
  run(st, 7, { spawn: () => 1 });                // 세 덩어리치가 올라탈 자리
  assert.equal(onBelt(st), 1);
});
t('음수·undefined 를 돌려주면 0 으로 본다', () => {
  const a = setup();
  run(a, 10, { spawn: () => -5 });
  assert.equal(onBelt(a), 0);
  const b = setup();
  run(b, 10, { spawn: () => undefined });
  assert.equal(onBelt(b), 0);
});
t('낸 것보다 많이 돌려줘도 청구한 수를 안 넘는다', () => {
  const st = setup();
  run(st, 7, { spawn: () => 999 });
  assert.equal(onBelt(st), 3);                   // 올라탄 자리 수만큼만
});
t('spawn 이 없으면 달라는 대로 다 만든다 (공급원)', () => {
  const st = setup();
  run(st, 7);
  assert.equal(onBelt(st), 3);
});

/* ---------- 이게 이번에 고친 자리 ---------- */
t('굶다가 재료가 오면, 앞머리만 비어 있고 뒤는 그대로 흘러 나간다', () => {
  const st = setup();
  /* ① 벨트를 물건으로 꽉 채운다 */
  for (let i = 0; i < 30; i++) run(st, 1);
  const before = onBelt(st);
  assert.ok(before >= 10, `채워졌어야 한다: ${before}`);

  /* ② 앞 설비가 선다 — 벨트는 계속 돈다 */
  let got = 0;
  for (let i = 0; i < 30; i++) got += run(st, 1, { feeding: false });

  assert.equal(got, 10, `이미 올라타 있던 것이 다 나가야 한다 (나간 것 ${got})`);
  assert.equal(onBelt(st), 0, '벨트가 비어야 한다');
});
t('막혀 섰다 풀리면 서 있던 자리에서 이어 간다', () => {
  const st = setup();
  for (let i = 0; i < 20; i++) run(st, 1);
  const held = onBelt(st);
  const head = B.beltOffset(st, 3);

  /* 막힌 동안에는 advanceBelt 를 아예 안 부른다 (running=false) */
  assert.equal(onBelt(st), held, '서 있는 동안 물건이 사라졌다');
  assert.equal(B.beltOffset(st, 3), head, '서 있는 동안 줄이 움직였다');

  run(st, 1);                                    // 풀렸다
  assert.ok(Math.abs(B.beltOffset(st, 3) - ((head + 1) % 3)) < 1e-9, '이어 가지 않았다');
});

/* ---------- 굴러도 안 새는지 ---------- */
t('아주 짧은 벨트를 한 번에 지나가도 개수가 안 늘어난다', () => {
  const st = setup({ length: 2, step: 3 });      // 칸 1개
  const got = B.advanceBelt(st, { d: 20, step: 3, length: 2 });
  assert.ok(got <= st.fill.length, `${got} 개가 한 프레임에 나왔다`);
  assert.ok(got >= 0);
});
t('trav 가 커지면 되감아도 자리가 그대로다', () => {
  const st = setup();
  st.trav = 1e6 - 1;
  st.born = Math.floor(st.trav / 3);
  st.gone = Math.floor((st.trav - 30) / 3);
  st.fill.fill(1);
  const before = onBelt(st);
  run(st, 2);
  assert.ok(st.trav < 1e6, `되감기지 않았다: ${st.trav}`);
  assert.equal(st.born, Math.floor(st.trav / 3), 'born 이 trav 와 어긋났다');
  assert.ok(Math.abs(onBelt(st) - before) <= 1, '되감기가 줄을 흐트러뜨렸다');
});

/* ---------- 칸마다 제 색으로 ---------------------------------------------- *
 *  `beltKind` 는 오래전부터 있었고 값도 맞게 나왔다. 그런데 **부르는 곳이
 *  없었다.** 그리는 쪽은 벨트 한 줄에 규격 하나를 잡고 「이 칸에 뭐가 있나」만
 *  물었다 — 「무엇인가」를 안 물었다.
 *
 *  그래서 여기서 둘을 함께 못 박는다. 값이 맞게 나오는가, 그리고 **그리는 쪽이
 *  실제로 그 값을 읽는가.** 값만 재면 이 버그가 그대로 다시 난다.
 * -------------------------------------------------------------------------- */

const items = await readSrc('scene/BeltItems.jsx');
const scene = await readSrc('scene/EditorScene.jsx');

t('칸마다 실린 종류가 다르게 나온다 — 두 품종을 번갈아 태워서', () => {
  const st = B.makeBelt(8, 1);
  const seen = [];
  for (let i = 0; i < 8; i += 1) {
    const kind = i % 2 === 0 ? 'PART_R' : 'PART_G';
    B.advanceBelt(st, {
      d: 1, step: 1, length: 8, feeding: true, kind,
      spawn: () => ({ made: 1, kind }),
    });
  }
  /* 줄 전체를 훑는다. **한 종류로 얼어붙지 않는다**는 것이 요점이다 —
     화면이 못 보고 있던 값이 바로 이것이다. */
  const on = Array.from({ length: 8 }, (_, k) => B.beltKind(st, k));
  seen.push(...on);
  assert.ok(on.includes('PART_R'), `빨강이 없다 — ${JSON.stringify(on)}`);
  assert.ok(on.includes('PART_G'), `초록이 없다 — ${JSON.stringify(on)}`);
  /* 이웃한 칸이 서로 다르다 — 번갈아 태웠으니 */
  const flips = on.slice(1).filter((v, i) => v && on[i] && v !== on[i]).length;
  assert.ok(flips >= 3, `이웃이 거의 같다 — ${JSON.stringify(on)}`);
});

t('빈칸은 종류가 없다 — 「모르겠다」와 「없다」를 가른다', () => {
  const st = B.makeBelt(4, 1);
  assert.equal(B.beltKind(st, 0), null);
});

t('**그리는 쪽이 그 값을 읽는다** — 값만 맞고 안 읽으면 화면은 그대로다', () => {
  assert.match(items, /beltKind\(belt, k\)/, 'BeltItems 가 칸의 종류를 안 묻는다');
});

t('있는지와 무엇인지를 **따로** 묻는다', () => {
  /* fill 과 kinds 는 다른 배열이다. 이름표 하나로 둘을 겸하면 이름표가 빈
     칸의 물건이 통째로 사라진다 */
  assert.match(items, /!beltHas\(belt, k\)/, '있는지를 안 묻는다 — 물건이 사라질 수 있다');
});

t('종류마다 규격을 따로 잡는다 — 줄 하나에 규격 하나면 색이 얼어붙는다', () => {
  assert.match(items, /usePayloadSpecs\(\)/, '종류별 규격을 안 읽는다');
  assert.match(items, /slot\.made/, '칸마다 종류별 사본을 안 들고 있다');
});

t('갈래가 하나면 그 종류로 그린다 — 불량품 벨트가 양품 색이 되지 않게', () => {
  /* `outKind` 는 **첫 레시피**의 산출이다. 불량품만 빼내는 벨트에 그것을 주면
     화면이 불량품을 양품 색으로 그린다 — 갈래가 하나뿐이면 그 종류를 쓴다. */
  assert.ok(scene.includes('payloadByKey(kinds?.length === 1 ? kinds[0] : outKind)'),
    '갈래가 잡힌 벨트도 첫 레시피 색으로 그린다');
});

/* ---------- 몇 개 실렸나 ---------------------------------------------------- *
 *  덩어리가 늘 꽉 차지는 않는다. 로트 4개를 3개씩 내보내면 3 + 1 로 나뉜다.
 *  그런데 화면은 늘 층 수만큼 쌓아 그렸다 — 1개 실린 칸이 3단으로 보이고,
 *  그것이 적치대에 1개로 들어가니 「두 개가 사라졌다」로 읽혔다.
 *
 *  **사라진 것은 없었다.** 애초에 1개였고 그림만 거짓말을 했다. 그래서 여기서
 *  둘을 함께 못 박는다 — 값이 맞는가, 그리고 그리는 쪽이 그 값을 읽는가.
 * -------------------------------------------------------------------------- */

t('자투리 덩어리는 **적게 실린다** — 로트 4개를 3개씩 내보내면 3 + 1', () => {
  const st = B.makeBelt(8, 3);
  for (const count of [3, 1]) {
    B.advanceBelt(st, {
      d: 1, step: 1, length: 8, feeding: true, kind: 'PART_R',
      spawn: () => ({ made: 1, kind: 'PART_R', count }),
    });
  }
  /* 줄 전체를 훑는다 — 첫 걸음에는 칸이 둘 생기고 하나만 채워지므로
     「방금 실린 칸」을 색인으로 집으면 어긋난다 */
  const loads = Array.from({ length: 8 }, (_, k) => B.beltLoad(st, k)).filter(Boolean).sort();
  assert.deepEqual(loads, [1, 3], `실린 개수가 덩어리 크기를 안 따라간다 — ${JSON.stringify(loads)}`);
});

t('빈칸은 0 이다 — 「없다」와 「한 개」를 가른다', () => {
  const st = B.makeBelt(4, 3);
  assert.equal(B.beltLoad(st, 0), 0);
});

t('개수를 안 적어 준 옛 상태는 **한 개**로 본다 — 도착 셈과 같은 규칙', () => {
  const st = B.makeBelt(4, 3);
  B.advanceBelt(st, {
    d: 1, step: 1, length: 4, feeding: true, kind: 'PART_R',
    spawn: () => ({ made: 1, kind: 'PART_R' }),      // count 없음
  });
  const loads = Array.from({ length: 4 }, (_, k) => B.beltLoad(st, k)).filter(Boolean);
  assert.deepEqual(loads, [1], `${JSON.stringify(loads)}`);
});

t('도착 셈과 어긋나지 않는다 — **실린 만큼** 도착한다', () => {
  /* 이 둘이 갈리면 「보이는 것」과 「쌓이는 것」이 달라진다. 그게 이 버그였다.
     도착 종류별 개수는 `belt.out` 에 실린다(sim.js 의 runBelt 가 그것을 읽는다). */
  const st = B.makeBelt(3, 3);
  let got = null;
  for (let i = 0; i < 6; i += 1) {
    B.advanceBelt(st, {
      d: 1, step: 1, length: 3, feeding: true, kind: 'PART_R',
      spawn: () => ({ made: 1, kind: 'PART_R', count: 2 }),
    });
    if (st.out?.PART_R) got = st.out.PART_R;
  }
  assert.equal(got, 2, '실린 개수와 도착 개수가 다르다');
});

t('**그리는 쪽이 그 값을 읽는다** — 값만 맞고 안 읽으면 그림은 그대로 거짓말한다', () => {
  assert.match(items, /const load = beltLoad\(belt, k\)/, '몇 개 실렸는지 안 묻는다');
  assert.match(items, /tiers\[i\]\.visible = load >= i \+ 2/, '실린 만큼만 세우지 않는다');
});

t('층을 **따로** 들고 있는다 — children 색인은 층 번호가 아니다', () => {
  /* cloneScene 은 사본을 통째로 주므로 자식을 이미 달고 온다. children 으로
     층을 끄면 1개 실린 칸에서 물건이 통째로 사라진다 — 버그보다 나쁘다. */
  assert.match(items, /group\.userData\.tiers = tiers/, '층 목록을 안 남긴다');
});
