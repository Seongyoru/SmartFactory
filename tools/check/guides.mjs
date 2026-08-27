/**
 * 따라 하기 — 갈래별 안내
 * ---------------------------------------------------------------------------
 *  안내가 틀리면 **틀린 것을 맞다고 말하는 도구**가 된다. 그리고 안내가 늘어날
 *  수록 「없는 버튼을 가리키는 단계」 나 「영원히 안 끝나는 단계」 가 섞이기
 *  쉬운데, 그건 화면을 띄우지 않고 잡을 수 있는 종류다.
 */
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { SRC, cut, group, readSrc, t } from './_harness.mjs';

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
const guidesSrc = await readSrc('core/guides.js');
const factsSrc = await readSrc('core/guideFacts.js');
const toolbar = await readSrc('ui/Toolbar.jsx');
const inspectorSrc = await readSrc('ui/Inspector.jsx');
const balanceSrc = await readSrc('core/balance.js');
/* 안내 글이 부르는 이름이 화면에 실제로 있는지 볼 때 쓴다 */
const UI_TEXT = inspectorSrc + toolbar + dock
  + (await readSrc('ui/OrdersDock.jsx')) + (await readSrc('ui/LibraryPanel.jsx'));

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

t('**앱을 켜 두기만 해도 체크되는 단계가 없다**', () => {
  /* 시뮬은 기본으로 돌고 있다(running: true). 그래서 페이지를 연 순간부터
     ranSec 가 쌓이는데, 그것을 「돌려 봤다」로 읽으면 아무것도 안 한 사람에게
     1/7 · 1/3 이 찍힌다 — 실제로 그렇게 나왔다. 사람이 한 일을 봐야 한다. */
  const idle = F.guideFacts({ view: 'top', ranSec: 3600, shipped: 0 }, itemOf);
  for (const { g, s } of allSteps) {
    if (s.optional) continue;
    assert.equal(s.done(idle), false, `${g.id}/${s.id} 가 켜 두기만 해도 통과다`);
  }
});
t('돈 시간(ranSec)으로는 판정하지 않는다 — 켜 두면 저절로 쌓인다', () => {
  const src = guidesSrc.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal(/f\.ranSec/.test(src), false, '아직 돈 시간으로 판정하는 단계가 있다');
});
t('체크가 왜 되어 있는지 화면이 말한다', () => {
  assert.ok(/도면에서 읽어 체크됩니다/.test(tut), '미리 체크된 이유를 안 알려 준다 — 고장으로 보인다');
});

/* ---------- 실제로 났던 버그: 없는 필드를 읽었다 -------------------------- */

const PR = await import(SRC + 'core/process.js');

t('한 번에 내보내는 개수는 **`outputCount`** 다 — `layers` 라는 필드는 없다', () => {
  /* 화면에서는 「층」이라 부르지만 코드에 그런 필드는 없다. `p.layers` 를 읽는
     바람에 따라 하기 단계가 안 넘어가고, 라인 능력의 벨트가 3배 낮게 나왔다. */
  assert.equal(PR.bundleOf({ outputCount: 4 }), 4);
  assert.equal(PR.bundleOf({}), PR.DEFAULT_BUNDLE, '안 적은 설비는 기본값이다');
  assert.equal(PR.bundleOf({ layers: 8 }), PR.DEFAULT_BUNDLE, 'layers 를 읽고 있다');
  assert.equal(PR.bundleOf(null), PR.DEFAULT_BUNDLE);
});
t('읽는 자리를 하나로 모았다 — 세 번째 실수를 막는다', () => {
  for (const [name, src] of [['balance.js', balanceSrc], ['guideFacts.js', factsSrc]]) {
    assert.equal(/\.layers\b/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')), false, `${name} 이 없는 필드를 읽는다`);
    assert.ok(/bundleOf\(/.test(src), `${name} 이 공용 접근자를 안 쓴다`);
  }
});
t('개수를 바꾸면 그 단계가 넘어간다', () => {
  const p = { uid: 'M', itemId: 'MACHINE_1', pos: [0, 0] };
  assert.equal(F.guideFacts({ placed: [p] }, itemOf).layered, false, '안 건드렸는데 통과다');
  assert.equal(F.guideFacts({ placed: [{ ...p, outputCount: 4 }] }, itemOf).layered, true, '바꿨는데 안 넘어간다');
  assert.equal(F.guideFacts({ placed: [{ ...p, outputCount: 1 }] }, itemOf).layered, true, '줄인 것도 손댄 것이다');
});

/* ---------- 실제로 났던 버그: **없는 기능**을 안내했다 -------------------- */

t('**사용자가 정할 수 있는 값으로만 판정한다**', () => {
  /* 「적치대 자리를 종류별로 나누기」라는 단계를 넣었는데, 그 값(p.slots)은
     레시피에서 자동으로 나오는 것이라 정하는 UI가 아예 없었다 — 영원히 안
     끝나는 단계였다. 없는 기능을 안내한 셈이다.
     그래서 판정이 읽는 **설비 속성**은 화면 어딘가에서 쓸 수 있어야 한다. */
  const src = factsSrc.replace(/\/\*[\s\S]*?\*\//g, '');
  /* guideFacts 가 읽는 placed 속성들 — `p.xxx` 꼴 */
  const read = new Set([...src.matchAll(/\bp\.(\w+)/g)].map((m) => m[1]));
  /* 화면이 UPDATE_PLACED 로 쓰는 속성들 */
  /* 쓰는 길이 두 가지다 — `patch: { key` 와, 그것을 감싼 `set({ key` */
  const written = new Set([
    ...[...inspectorSrc.matchAll(/patch:\s*\{\s*(\w+)/g)].map((m) => m[1]),
    ...[...inspectorSrc.matchAll(/\bset\(\{\s*(\w+)/g)].map((m) => m[1]),
  ]);
  /* 도면 구조에서 오는 것(uid·itemId·pos…)은 사용자가 「쓰는」 값이 아니다 */
  const structural = new Set(['uid', 'itemId', 'pos', 'rot', 'y', 'points', 'slots']);
  const unreachable = [...read].filter((k) => !written.has(k) && !structural.has(k));
  assert.deepEqual(unreachable, [],
    `화면에서 정할 수 없는 값으로 판정한다: ${unreachable.join(', ')}`);
});
t('그 단계가 실제 도면으로 끝난다 — 적치대 수용량', () => {
  const bare = { placed: [{ uid: 'S', itemId: 'STILLAGE', pos: [0, 0] }] };
  assert.equal(F.guideFacts(bare, itemOf).stillageTuned, false, '안 건드렸는데 통과다');
  const tuned = { placed: [{ uid: 'S', itemId: 'STILLAGE', pos: [0, 0], capacity: 80 }] };
  assert.equal(F.guideFacts(tuned, itemOf).stillageTuned, true, '바꿨는데 안 넘어간다');
});
t('안내 글이 **화면에 있는 이름**을 부른다', () => {
  /* 「자리 나누기」라는 칸은 없는데 그렇게 적어 두었다. 글이 가리키는 굵은
     낱말 중 화면에 없는 것이 있으면 사람이 그 자리를 못 찾는다. */
  const ui = UI_TEXT;
  /**
   * 낱말만 봐서는 **칸 이름과 강조 어구를 못 가른다**(「막혀서 섭니다」도 굵게
   * 쓴다). 그래서 **뒤에 오는 말**로 가른다 — 칸을 가리킬 때는 「… 칸」 ·
   * 「… 탭」 · 「… 버튼」 · 「…에서」 처럼 쓰기 때문이다.
   *
   * 실제로 없던 「**자리 나누기**에서」 가 이 규칙에 걸린다.
   */
  /**
   * 「**X** 칸」 이라고 썼으면 X 는 **진짜 칸 이름**이어야 한다.
   *  낱말이 화면 어딘가에 있기만 하면 통과시켰더니 「**역할** 칸」 이 새어 나갔다 —
   *  실제 칸 이름은 「정차역」 이고, 「역할」 은 그 칸의 **설명문**에만 있었다.
   *  그래서 `<Section title=…>` 에 실제로 걸린 이름인지를 본다.
   */
  const sections = new Set([
    ...[...ui.matchAll(/<Section title="([^"]+)"/g)].map((m) => m[1]),
    /* 제목이 식인 것들 — `{`정차역 ${n}개`}` 처럼 */
    ...[...ui.matchAll(/<Section title=\{`([^$`]+)/g)].map((m) => m[1].trim()),
    ...[...ui.matchAll(/<Section title=\{[^}]*'([^']+)'/g)].map((m) => m[1]),
  ]);
  const missing = [];
  for (const { g, s } of allSteps) {
    for (const m of s.body.matchAll(/\*\*([^*]+)\*\*\s*(칸|탭|버튼|에서)/g)) {
      const w = m[1].trim();
      const where = m[2];
      /* 「… 칸」 은 인스펙터의 칸 이름이어야 한다. 탭·버튼은 이름이 여러 곳에
         흩어져 있어 낱말이 있는지만 본다. */
      const ok = where === '칸' ? [...sections].some((t) => t.includes(w)) : ui.includes(w);
      if (!ok) missing.push(`${g.id}/${s.id} → 「${w}」`);
    }
  }
  assert.deepEqual(missing, [], `화면에 없는 이름을 부른다:\n  ${missing.join('\n  ')}`);
});

t('역할은 **두 갈래 버튼**으로 고른다 — 돌려 누르면 어디로 가는지 모른다', () => {
  /* 처음에는 눌러서 자동 → 싣기 → 내리기 로 도는 한 개짜리 버튼이었다.
     눌러야 하는 것인지 표시인지 알 수 없고, 원하는 값까지 몇 번을 눌러야 했다.
     그다음 셋을 늘어놓았더니 이번에는 「자동이면 지금 뭐라는 거지?」 가 남았다 —
     자동은 고르는 값이 아니라 **처음 값**이므로 버튼에서 뺐다. */
  assert.ok(/const setRole = \(key, role\)/.test(inspectorSrc), '곧바로 정하는 길이 없다');
  assert.equal(/cycleRole/.test(inspectorSrc), false, '아직 돌려 누른다');
  for (const label of ['싣기', '내리기']) {
    assert.ok(inspectorSrc.includes(`'${label}'`), `「${label}」 버튼이 없다`);
  }
});

t('안내가 없어진 「자동」 버튼을 부르지 않는다', () => {
  /* 화면에 없는 것을 누르라고 하면 그 걸음에서 막힌다 — 앞서 「역할 칸」으로 한 번
     겪었다. 역할을 다루는 걸음의 본문만 본다(다른 걸음의 「자동으로 정해집니다」는
     설명이지 누르라는 말이 아니다). */
  const step = G.GUIDES.flatMap((g) => g.steps).find((s) => s.id === 'roles');
  assert.ok(step, '역할 걸음이 없어졌다');
  assert.equal(/\*\*[^*]*자동[^*]*\*\*/.test(step.body), false, '없는 버튼을 굵게 부른다');
});

/* ---------- 「먼저 갖춰야 할 것」 — 안 갖췄을 때만 뜬다 ------------------- */

t('「골라 주세요」 는 **가리킬 칸이 화면에 없을 때만** 뜬다', () => {
  /* 처음에는 갈래를 여는 내내 떠 있었다. 선반을 이미 골라 놓고 1단계까지
     끝낸 뒤에도 노란 띠가 「적치대나 선반을 놓고 골라 주세요」 라고 붙어
     있었다 — 읽을 값이 없는 문구가 되면 정작 필요할 때도 안 읽는다. */
  const track = cut(tut, 'function Track(', '\nfunction ', 'Track');
  assert.ok(/const needShown =/.test(track), '띄울지 말지를 안 따진다');
  assert.match(track, /needShown[^\n]*!spotBox/, '가리킬 칸이 있어도 띄운다');
  assert.equal(/\{guide\.need && current >= 0 && \(/.test(track), false, '옛 조건이 남아 있다');
});

t('테두리와 「골라 주세요」 는 **한 값**을 본다 — 둘 다 뜨면 말이 안 된다', () => {
  assert.ok(/function useSpotBox\(/.test(tut), '자리를 재는 곳이 훅으로 안 나뉘었다');
  const track = cut(tut, 'function Track(', '\nfunction ', 'Track');
  assert.match(track, /const spotBox = useSpotBox\(step\?\.spot\)/, '자리를 안 재고 그린다');
  assert.match(track, /<Spot box=\{spotBox\} \/>/, '테두리가 딴 값을 본다');
});

t('갈래가 아니라 **걸음마다** 다를 수 있다', () => {
  /* 「인력·교대」가 그랬다 — 1단계는 설비를 골라야 칸이 나오고, 2단계는
     반대로 선택을 풀어야 나온다. 갈래 하나에 문구를 하나만 두면 둘 중
     하나는 반드시 틀린 말이 된다. */
  const track = cut(tut, 'function Track(', '\nfunction ', 'Track');
  assert.match(track, /const need = step\?\.need \?\? guide\.need/, '걸음의 문구를 안 본다');
  assert.match(track, /<Rich text=\{need\} \/>/, '걸음 문구를 안 그린다');
});

t('선택을 **서로 반대로** 요구하는 이웃 걸음에는 각자 문구가 있다', () => {
  /* 화면에서 실제로 확인한 것: panel-crew 는 고른 게 있어야 나오고,
     panel-shifts 는 고른 게 없어야 나온다(도면 요약 안에 있다). */
  const byId = new Map();
  for (const g of G.GUIDES) for (const s of g.steps) byId.set(`${g.id}/${s.id}`, { g, s });
  for (const key of ['crew/crewNeed', 'crew/shift', 'cost/power', 'plan/report']) {
    const hit = byId.get(key);
    assert.ok(hit, `${key} 걸음이 없어졌다`);
    assert.ok(hit.s.need, `${key} 는 화면에 늘 있지 않은 칸을 가리키는데 이유를 안 말한다`);
  }
  assert.notEqual(byId.get('crew/crewNeed').s.need, byId.get('crew/shift').s.need,
    '반대를 요구하는 두 걸음이 같은 말을 한다');
});

t('가리킬 곳이 없는 걸음에는 「먼저 …」 를 안 붙인다', () => {
  /* spot 이 없으면 가리킬 것도 없으니 띄울 근거가 없다 — needShown 이
     spot 길이를 함께 보는 이유다 */
  const track = cut(tut, 'function Track(', '\nfunction ', 'Track');
  assert.match(track, /step\?\.spot\?\.length \?\? 0\) > 0/, 'spot 없는 걸음에도 띄운다');
});

/* ==========================================================================
 *  다섯 갈래를 **글로** 읽고 나온 것들
 * --------------------------------------------------------------------------
 *  앞선 확인은 「가리키는 칸이 그때 화면에 있는가」였다. 이번에는 문장을 순서대로
 *  읽었다 — 「그 순서로 따라갔을 때 말이 되는가」. 넷이 나왔고 넷 다 고쳤다.
 * ======================================================================== */

t('셀 것이 없는 갈래를 열어도 「다 했습니다」가 아니다', () => {
  /* 「나눠 쓰기」는 세 걸음이 다 「해 보기」라 분모가 0 이다. 고르는 화면은
     이미 「읽어 보기」로 갈라 두었는데 **갈래 안이 안 따라와 있었다** —
     열자마자 마지막 걸음이 펼쳐지고 아래에 「이 안내를 다 했습니다」가 붙었다. */
  const share = G.guideById('share');
  assert.equal(G.guideProgress(share, {}).total, 0, '전제가 바뀌었다 — share 에 셀 걸음이 생겼다');
  const track = cut(tut, 'function Track(', '\nfunction ', 'Track');
  assert.match(track, /const readOnly = p\.total === 0;/, '갈래 안에서 안 가른다');
  assert.match(track, /const openIdx = readOnly \? 0 :/, '읽기만 하는 갈래가 마지막 걸음을 편다');
  assert.match(track, /\{!readOnly && current < 0 && \(/, '안 한 갈래에 「다 했습니다」를 띄운다');
  assert.match(track, /readOnly \? '읽어 보기'/, '0\/0 단계라고 적는다');
});

t('한 갈래 안에서 **다른 것을 골라야 하는** 걸음은 각자 말한다', () => {
  /* 「쌓는 곳」이 그랬다. 걸음 1·2 는 선반, 걸음 3 은 적치대인데 문구가 갈래에
     하나뿐이라, 적치대만 골라 둔 사람에게 「선반을 고르고」만 떴다. */
  const store = G.guideById('store');
  const need = (id) => store.steps.find((s) => s.id === id)?.need ?? '';
  assert.match(need('shelfRows'), /선반/, '선반 걸음이 무엇을 고르라는지 안 말한다');
  assert.match(need('stillage'), /적치대/, '적치대 걸음이 무엇을 고르라는지 안 말한다');
  assert.notEqual(need('shelfRows'), need('stillage'), '다른 것을 요구하는 두 걸음이 같은 말을 한다');
});

t('한 걸음이 시킨 일을 다른 걸음이 또 시키지 않는다', () => {
  /* 「원가 보기」 1번이 자재비까지 바꾸라고 해서, 그대로 하면 3번(자재비)이
     **손도 안 댔는데 체크**됐다(materialSet = rates.material > 0). */
  const rates = G.guideById('cost').steps.find((s) => s.id === 'rates');
  assert.equal(/자재비/.test(rates.body), false, '단가 걸음이 자재비까지 시킨다');
});

t('같은 자리에서 할 일은 붙여 둔다 — 띠 → 설비 → 띠 로 튀지 않는다', () => {
  const ids = G.guideById('cost').steps.map((s) => s.id);
  assert.deepEqual(ids, ['rates', 'material', 'power'], '원가 갈래가 화면을 오간다');
});

t('보고서 걸음은 **실제로 필요한 것**을 말한다', () => {
  /* done 은 `shipped > 0` 인데 문구는 「조금 돌려 주세요」였다. 트럭도 개구부도
     없으면 아무리 돌려도 안 넘어가는데 이유를 안 알려 준다 —
     「0 ± 0 개/시」와 같은 종류의 거짓말이다. */
  const rep = G.guideById('plan').steps.find((s) => s.id === 'report');
  assert.match(rep.need, /밖으로 나가야|트럭/, '돌리기만 하면 되는 것처럼 말한다');
});

/* ---------- 설비 인스펙터의 **차례** ---------------------------------------- *
 *  설비를 고르는 이유는 대개 둘이다 — 「이게 뭘 만들지」와 「얼마나 빨리 만들지」.
 *  그 둘의 차례가 뒤집혀 있었다. 무엇을 만드는지 모르는 채로 처리량부터 읽게
 *  했고, 「만드는 것」은 인력·고장 사이에 끼어 있었다.
 *
 *  차례를 재는 검사가 하나도 없었다 — 구역을 하나 옮기면 아무도 모른다.
 * -------------------------------------------------------------------------- */

const insp = await readSrc('ui/Inspector.jsx');

t('설비 인스펙터 — **무엇을 만드나**가 처리량보다 위다', () => {
  const at = (s) => insp.indexOf(s);
  const 설비 = at('<Section title="설비">');
  const 만드는것 = at('<RecipeSection key={placed.uid}');
  const 생산 = at('<Section title="생산" data-guide="panel-production">');
  const 인력 = at('<CrewFields placed={placed} />');

  assert.ok(설비 > 0 && 만드는것 > 0 && 생산 > 0 && 인력 > 0, '구역을 못 찾았다');
  assert.ok(설비 < 만드는것, '이름·ID 보다 위로 올라갔다 — 「무엇을 고쳤나」를 먼저 확인한다');
  assert.ok(만드는것 < 생산, '처리량이 「만드는 것」보다 위다 — 답을 모르는 채로 속도를 읽는다');
  assert.ok(생산 < 인력, '생산이 인력 아래로 내려갔다');
});

t('설비를 바꾸면 고른 품종도 처음으로 — key 가 살아 있다', () => {
  /* 옮기다 key 를 흘리면, 앞 설비에서 2번 품종을 보던 상태가 그대로 남아
     다른 설비의 2번이 열린다. 값은 멀쩡하고 화면만 거짓말한다. */
  assert.match(insp, /<RecipeSection key=\{placed\.uid\}/, 'key 가 없다');
});

t('「만드는 것」이 한 벌만 있다 — 옮기다 두 벌이 되면 둘 다 그려진다', () => {
  const n = insp.split('<RecipeSection key={placed.uid}').length - 1;
  assert.equal(n, 1, `${n}벌`);
});

/* ---------- 오른쪽 패널의 머리 고정 ---------------------------------------- *
 *  아래로 내려가 손잡이를 만지다 보면 「지금 무엇을 고치고 있더라」를 잃는다.
 *  이름이 맨 위에 있는데 그것이 제일 먼저 밀려 올라가기 때문이다.
 *
 *  패널들은 프래그먼트를 돌려주므로 `Section` 들이 곧 `aside` 의 자식이다.
 *  첫 자식 하나만 짚으면 열두 패널에 한꺼번에 먹는다 — 나중에 패널을 더
 *  만들어도 따로 손댈 것이 없다. 그 성질에 기대고 있으므로 못 박아 둔다.
 * -------------------------------------------------------------------------- */

t('오른쪽 패널의 첫 구역이 위에 붙는다', () => {
  assert.match(insp, /\[&>div:first-child\]:sticky/, '첫 구역이 안 붙는다');
  assert.match(insp, /\[&>div:first-child\]:top-0/, '붙는 자리가 없다');
});

t('붙은 머리가 **아래와 색이 다르다** — 어디까지가 고정인지 보이게', () => {
  /* 바탕이 아예 없으면 밑으로 지나가는 글자가 비쳐 보인다. 바탕을 주되 아래
     (`bg-panel`)와 **같은 색이면** 어디까지가 붙어 있는 것인지 안 보인다.
     `bg-head` 는 상단 툴바와 대화상자 머리가 쓰는 색이라 두 테마 모두에서
     갈린다(밝은쪽 #ffffff 대 #f7f9fc · 어두운쪽 #0f172a 대 #0b1322). */
  assert.match(insp, /\[&>div:first-child\]:bg-head/, '머리와 아래가 같은 색이다');
  assert.match(insp, /\[&>div:first-child\]:z-10/, '아래 내용이 머리 위로 지나간다');
  assert.match(insp, /\[&>div:first-child\]:shadow-/, '떠 있다는 느낌이 없다');
});

t('머리 모양을 **배열로 잇는다** — 여러 줄 className 은 CRLF 를 품는다', () => {
  /* 여러 줄로 쓰면 문자열 안에 줄바꿈이 그대로 들어가고, 이 저장소의 작업
     파일은 CRLF 라 캐리지리턴까지 섞인다. 브라우저는 공백으로 넘기지만 번들
     내용이 달라져 **로컬과 CI 의 빌드 해시가 갈린다** — 그것 때문에 「배포가
     안 됐다」고 한참 헤맸다. */
  assert.match(insp, /const STUCK_HEAD = \[/, '머리 모양이 상수로 안 묶여 있다');
  assert.match(insp, /\]\.join\(' '\)/, '배열로 안 잇는다');
  const at = insp.indexOf('className={`w-[292px]');
  assert.ok(at > 0, 'aside 의 className 을 못 찾았다');
  assert.equal(/\n/.test(insp.slice(at, insp.indexOf('}', at))), false,
    'className 이 여러 줄이다 — 줄바꿈이 클래스 문자열에 들어간다');
});

t('머리가 패널을 다 먹지 않는다 — 낮은 창에서 볼 자리가 남아야 한다', () => {
  /* 실측: 644px 패널에서 첫 구역이 275px(43%) 다. 상한이 없으면 창이 낮을수록
     비율이 커져 정작 고칠 손잡이가 안 보인다. */
  assert.match(insp, /\[&>div:first-child\]:max-h-\[\d+%\]/, '머리 높이에 상한이 없다');
  assert.match(insp, /\[&>div:first-child\]:overflow-y-auto/, '상한에 걸리면 내용이 잘려 안 보인다');
});

t('모든 패널이 **구역으로 시작한다** — 이 방식이 기대는 성질이다', () => {
  /* 어느 패널이 다른 것으로 시작하면 그 패널만 머리가 안 붙는다.
     조건부(`{x && <Section`)로 시작해도 그 조건이 거짓일 때 어긋난다. */
  const panels = [...insp.matchAll(/^function (\w*Panel|Summary)\(/gm)].map((m) => m[1]);
  assert.ok(panels.length >= 10, `패널을 ${panels.length}개만 찾았다`);
  for (const name of panels) {
    const at = insp.indexOf(`function ${name}(`);
    const body = insp.slice(at, at + 9000);
    const ret = body.indexOf('return (');
    assert.ok(ret > 0, `${name}: return 을 못 찾았다`);
    const head = body.slice(ret, ret + 400);
    assert.match(head, /<(Section|>)/, `${name} 이 구역으로 시작하지 않는다 — 머리가 안 붙는다`);
  }
});

/* ---------- 머리를 붙일 패널을 **고르는 규칙** ------------------------------ *
 *  붙이는 값은 「아래로 내려가도 무엇을 고치는지 알고, 손잡이를 만지며 위에서
 *  결과를 보는 것」이다. 그러려면 아래에 만질 것이 많아야 한다. 짧은 패널에서는
 *  얻는 것 없이 자리만 먹는다 — 붙은 머리가 패널의 45%까지 간다.
 *
 *  그래서 **「붙이는 목록」으로 적는다.** 빼는 쪽으로 적으면 패널을 새로 만들
 *  때마다 여기 와서 빼 줘야 하고, 잊으면 짧은 패널이 조용히 붙는다. 붙이는
 *  쪽으로 적으면 잊었을 때 **안 붙을 뿐**이다 — 틀리는 방향이 안전한 쪽이다.
 * -------------------------------------------------------------------------- */

/**
 * 인스펙터의 판정을 그대로 떼어 와 값으로 굴린다.
 *  **그 한 문장만** 떼어야 한다 — 범위를 넓게 잡으면 옆에 있는 훅까지 딸려 와
 *  `useRef is not defined` 로 터진다(실제로 겪었다).
 */
const stickLine = insp.match(/ {2}const stickHead = [^;]+;/)?.[0];
const stickOf = (() => {
  assert.ok(stickLine, '판정 문장을 못 찾았다 — 이름이 바뀌었으면 이 검사도 고칠 것');
  return new Function('multi', 'placed', 'cart', 'link', `${stickLine}\n return stickHead;`);
})();

t('설비 · 카트 · 컨베이어에는 붙인다 — 길고 만질 것이 많다', () => {
  assert.equal(stickOf(null, {}, null, null), true, '설비(선반·적치대 포함)');
  assert.equal(stickOf(null, null, {}, null), true, '카트 · 트럭');
  assert.equal(stickOf(null, null, null, {}), true, '컨베이어 · 연결장치');
});

t('짧은 패널에는 **안 붙인다** — 벽 · 기둥 · 개구부 · 구역 · 도면 요약', () => {
  /* 이 패널들은 셋 중 어느 것도 아니라 판정이 전부 거짓으로 떨어진다 */
  assert.equal(stickOf(null, null, null, null), false);
});

t('여럿 골랐을 때는 안 붙인다 — 첫 구역이 목록이라 붙일 것이 아니다', () => {
  assert.equal(stickOf([1, 2], {}, null, null), false, '설비 여럿을 골라도 목록이 먼저다');
});

t('**빼는 목록이 아니라 붙이는 목록이다** — 잊었을 때 안 붙는 쪽으로 틀린다', () => {
  /* 이 방향이 이 규칙의 요점이다. 부정으로 적기 시작하면 패널이 늘 때마다
     여기를 손봐야 하고, 잊으면 짧은 패널이 조용히 붙는다. */
  assert.match(stickLine, /!!\(placed \|\| cart \|\| link\)/, '붙이는 목록이 아니다');
  assert.equal(/wall|pillar|opening|zone|area/.test(stickLine), false,
    '빼는 쪽으로 적혀 있다 — 패널이 늘 때마다 손봐야 한다');
});

t('선반과 적치대는 **설비로 함께 걸린다** — 따로 적을 필요가 없다', () => {
  /* 둘 다 `placed` 에서 갈라져 나온 것이라 placed 하나면 셋이 다 걸린다 */
  assert.match(insp, /const shelf = placed && isShelf/);
  assert.match(insp, /const stillage = placed && isStillage/);
});

/* ---------- 고른 것이 바뀌면 스크롤을 맨 위로 ------------------------------- *
 *  아래까지 내려가 손잡이를 만지다가 다른 설비를 고르면, 내용은 통째로 바뀌는데
 *  스크롤만 그 자리에 남는다. 새로 고른 설비의 이름도, 무엇을 만드는지도 화면
 *  밖이라 **엉뚱한 데를 보고 있게 된다.**
 * -------------------------------------------------------------------------- */

t('고른 것이 바뀌면 스크롤을 되돌린다', () => {
  assert.match(insp, /bodyRef\.current\.scrollTop = 0/, '스크롤을 안 되돌린다');
  assert.match(insp, /<aside\s*\n\s*ref=\{bodyRef\}/, '되돌릴 그릇에 안 물려 있다');
});

t('되돌리는 열쇠가 **고른 것들의 목록**이다 — 값이 바뀔 때마다 튀면 안 된다', () => {
  /* 이름이나 손잡이 값이 바뀌었다고 되돌리면 만지는 도중에 화면이 튄다.
     「무엇을 고르고 있나」가 바뀔 때만 되돌려야 한다. */
  assert.match(insp, /const selKey = selected\.map/, '열쇠를 목록에서 안 만든다');
  assert.match(insp, /\}, \[selKey\]\);/, '열쇠 말고 다른 것에 매여 있다');
});

t('벽은 **한 면씩** 고르므로 edge 까지 본다', () => {
  /* 같은 벽의 옆면으로 옮기면 uid 는 그대로다 — edge 를 안 보면 안 되돌아간다 */
  const line = insp.match(/const selKey = [^;]+;/)?.[0] ?? '';
  assert.match(line, /i\.edge/, 'edge 를 안 본다 — 옆면으로 옮겨도 스크롤이 남는다');
  assert.match(line, /i\.kind/, 'kind 를 안 본다 — 종류가 달라도 uid 가 같을 수 있다');
});
