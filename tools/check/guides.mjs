/**
 * 따라 하기 — 갈래별 안내
 * ---------------------------------------------------------------------------
 *  안내가 틀리면 **틀린 것을 맞다고 말하는 도구**가 된다. 그리고 안내가 늘어날
 *  수록 「없는 버튼을 가리키는 단계」 나 「영원히 안 끝나는 단계」 가 섞이기
 *  쉬운데, 그건 화면을 띄우지 않고 잡을 수 있는 종류다.
 */
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { SRC, group, readSrc, t } from './_harness.mjs';

group('따라 하기');

const G = await import(SRC + 'core/guides.js');
const F = await import(SRC + 'core/guideFacts.js');
const lib = await import(SRC + 'data/library.js');
const itemOf = (id) => lib.BUILTIN_LIBRARY.find((i) => i.id === id) ?? null;

const allSteps = G.GUIDES.flatMap((g) => g.steps.map((s) => ({ g, s })));

/* ---------- 짜임새 ---------------------------------------------------------- */

t('갈래와 단계 이름이 겹치지 않는다', () => {
  const ids = G.GUIDES.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length, `갈래 이름이 겹친다: ${ids}`);
  for (const g of G.GUIDES) {
    const s = g.steps.map((x) => x.id);
    assert.equal(new Set(s).size, s.length, `${g.id} 안에서 단계 이름이 겹친다`);
  }
});
t('모든 갈래가 제목·설명·단계를 갖췄다', () => {
  for (const g of G.GUIDES) {
    assert.ok(g.title?.trim(), `${g.id} 에 제목이 없다`);
    assert.ok(g.blurb?.trim(), `${g.id} 에 한 줄 설명이 없다 — 고를 수가 없다`);
    assert.ok(g.steps.length > 0, `${g.id} 에 단계가 없다`);
  }
});
t('모든 단계가 제목·본문·판정을 갖췄다', () => {
  for (const { g, s } of allSteps) {
    assert.ok(s.title?.trim(), `${g.id}/${s.id} 제목 없음`);
    assert.ok(s.body?.trim(), `${g.id}/${s.id} 본문 없음`);
    assert.equal(typeof s.done, 'function', `${g.id}/${s.id} 판정 없음`);
  }
});
t('굵게 표시가 짝이 맞는다 — 안 맞으면 별표가 그대로 찍힌다', () => {
  for (const { g, s } of allSteps) {
    const n = (s.body.match(/\*\*/g) ?? []).length;
    assert.equal(n % 2, 0, `${g.id}/${s.id} 의 ** 가 홀수다`);
  }
});

/* ---------- **없는 곳을 가리키지 않는가** ---------------------------------- */

/* 화면에 박혀 있는 손잡이. `item-` · `tab-` · `tool-` 은 템플릿으로 만들어지므로
   접두사만 보고, 나머지는 이름이 그대로 있어야 한다. */
const anchors = new Set(
  execSync('grep -rho \'data-guide="[^"]*"\' src/ --include=*.jsx')
    .toString().split('\n').filter(Boolean).map((s) => s.match(/"(.*)"/)[1]),
);
const dock = await readSrc('ui/RunDock.jsx');
for (const m of dock.matchAll(/export const DOCK_\w+ = '([^']+)'/g)) anchors.add(m[1]);
const itemIds = new Set(lib.BUILTIN_LIBRARY.map((i) => i.id));

t('**단계가 가리키는 곳이 화면에 있다** — 없으면 안내가 조용히 헛돈다', () => {
  const missing = [];
  for (const { g, s } of allSteps) {
    for (const sel of s.spot ?? []) {
      const key = sel.match(/data-guide="(.*?)"/)?.[1];
      if (!key) { missing.push(`${g.id}/${s.id} → ${sel} (모양이 이상하다)`); continue; }
      if (anchors.has(key)) continue;
      /* 템플릿으로 만들어지는 것들 */
      if (key.startsWith('item-') && itemIds.has(key.slice(5))) continue;
      if (/^(tab|tool)-/.test(key) && anchors.has(`${key.split('-')[0]}-\${`) === false) {
        /* tab-/tool- 은 LibraryPanel 이 템플릿으로 만든다 — 이름까지는 못 본다 */
        continue;
      }
      missing.push(`${g.id}/${s.id} → ${key}`);
    }
  }
  assert.deepEqual(missing, [], `가리키는 곳이 없다:\n  ${missing.join('\n  ')}`);
});
t('라이브러리 항목을 가리키는 단계는 **있는 항목**을 가리킨다', () => {
  for (const { g, s } of allSteps) {
    for (const sel of s.spot ?? []) {
      const key = sel.match(/data-guide="item-(.*?)"/)?.[1];
      if (key) assert.ok(itemIds.has(key), `${g.id}/${s.id} 가 없는 항목 ${key} 를 가리킨다`);
    }
  }
});

/* ---------- **끝날 수 있는가** --------------------------------------------- */

const empty = F.guideFacts({}, itemOf);

t('빈 도면에서는 아무 단계도 안 끝나 있다 — 처음부터 체크되면 안내가 아니다', () => {
  for (const { g, s } of allSteps) {
    if (s.optional) continue;
    assert.equal(s.done(empty), false, `${g.id}/${s.id} 가 빈 도면에서 이미 통과다`);
  }
});
t('**해 볼 수만 있는 단계는 분모에서 뺀다** — 안 그러면 영원히 안 끝난다', () => {
  for (const g of G.GUIDES) {
    const p = G.guideProgress(g, empty);
    assert.equal(p.total, g.steps.filter((s) => !s.optional).length, `${g.id} 의 분모가 이상하다`);
    /* 전부 「해 보기」인 갈래는 처음부터 다 한 것으로 나온다 — 그건 맞다 */
    if (p.total > 0) assert.equal(p.done, 0);
  }
});
t('사실을 채우면 그 단계가 끝난다 — 판정이 실제로 움직이는가', () => {
  /* 각 갈래의 첫 단계를 채워 본다. 하나도 안 움직이면 판정이 죽은 것이다 */
  const moved = [];
  for (const g of G.GUIDES) {
    const s = g.steps.find((x) => !x.optional);
    if (!s) continue;
    /* 모든 사실을 넉넉히 채운 상태 */
    const full = { ...empty };
    for (const k of Object.keys(full)) {
      if (typeof full[k] === 'number') full[k] = 9;
      if (typeof full[k] === 'boolean') full[k] = true;
    }
    full.view = 'iso';
    if (s.done(full)) moved.push(g.id);
  }
  assert.deepEqual(moved.sort(), G.GUIDES.filter((g) => g.steps.some((x) => !x.optional)).map((g) => g.id).sort(),
    '어떤 갈래의 첫 단계가 무엇을 해도 안 끝난다');
});
t('다 채우면 갈래가 끝난 것으로 나온다', () => {
  const full = { ...empty };
  for (const k of Object.keys(full)) {
    if (typeof full[k] === 'number') full[k] = 9;
    if (typeof full[k] === 'boolean') full[k] = true;
  }
  full.view = 'iso';
  for (const g of G.GUIDES) {
    const p = G.guideProgress(g, full);
    assert.equal(p.done, p.total, `${g.id} 가 다 채워도 안 끝난다`);
    assert.equal(G.nextStep(g, full), -1);
  }
});
t('이어서 할 단계는 **아직 안 끝난 첫 번째**다', () => {
  const g = G.guideById('basics');
  assert.equal(G.nextStep(g, empty), 0);
  const one = { ...empty, areas: 1 };
  assert.equal(G.nextStep(g, one), 1, '끝난 것을 또 시키고 있다');
});

/* ---------- 사실 ------------------------------------------------------------ */

t('빈 도면의 사실은 전부 0/false — 교대만 기본 한 조', () => {
  assert.equal(empty.areas, 0);
  assert.equal(empty.equip, 0);
  assert.equal(empty.beltToStillage, false);
  assert.equal(empty.shifts, 1, '교대는 기본값으로 채워진다');
  assert.equal(empty.shiftsStaffed, false, '기본 「상시」 는 인원을 안 따진다');
  assert.equal(empty.ratesTuned, false, '기본 단가는 손댄 것이 아니다');
});
t('단가를 손대면 그 사실이 선다', () => {
  const f = F.guideFacts({ rates: { power: 999 } }, itemOf);
  assert.equal(f.ratesTuned, true);
  assert.equal(F.guideFacts({ rates: { power: 130 } }, itemOf).ratesTuned, false, '기본값과 같은데 손댔다고 한다');
});
t('공정 시간은 **기본값에서 바뀌었을 때만** 손댄 것으로 본다', () => {
  const p = { uid: 'M', itemId: 'MACHINE_1', pos: [0, 0] };
  assert.equal(F.guideFacts({ placed: [p] }, itemOf).cycleTuned, false);
  assert.equal(F.guideFacts({ placed: [{ ...p, cycleSec: 2 }] }, itemOf).cycleTuned, true);
});

/* ---------- 배선 ------------------------------------------------------------ */

const tut = await readSrc('ui/Tutorial.jsx');
const toolbar = await readSrc('ui/Toolbar.jsx');

t('12시 버튼은 **고르는 화면**을 연다 — 바로 한 갈래로 들어가면 나머지를 모른다', () => {
  assert.ok(/guide: state\.guide \? null : 'pick'/.test(toolbar), '옛 단일 안내로 들어간다');
});
t('모르는 이름이 남아 있어도 안 죽는다 — 옛 판이 적어 둔 값', () => {
  assert.ok(/if \(!guide\) return <Picker/.test(tut), '모르는 갈래에서 빈 화면이 된다');
});
t('본문의 굵게 표시를 화면이 렌더한다 — 안 하면 별표가 그대로 찍힌다', () => {
  assert.ok(/function Rich/.test(tut), '렌더가 없다');
  assert.ok(/\\*\\*\[\^\*\]\+\\*\\*/.test(tut) || /\*\\*/.test(tut), '굵게 표시를 안 가른다');
});

t('셀 것이 없는 갈래는 **「다 했습니다」가 아니다**', () => {
  /* 전부 「해 보기」인 갈래는 분모가 0이라 비율이 1로 나온다. 손도 안 댄 안내가
     다 한 것으로 보이면 열어 볼 이유가 사라진다. */
  const readOnly = G.GUIDES.filter((g) => G.guideProgress(g, empty).total === 0);
  if (readOnly.length) {
    assert.ok(/읽어 보기/.test(tut), '셀 것 없는 갈래를 「다 했습니다」로 보여 준다');
    assert.ok(/const readOnly = p\.total === 0/.test(tut), '그 경우를 안 가른다');
  }
});
