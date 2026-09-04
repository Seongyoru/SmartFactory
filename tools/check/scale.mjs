/**
 * 화면 배율 — **4K 에서 글자가 절반이 되고, 작은 노트북에서 툴바가 넘치던 것**
 * ---------------------------------------------------------------------------
 *  치수는 372곳에 px 로 박혀 있다. 전부 `rem` 으로 바꾸는 길도 있었지만 그러면
 *  글자만 커지고 여백·아이콘은 그대로라 간격이 무너진다. 루트에 CSS `zoom` 을
 *  걸어 **레이아웃째** 다시 흘리는 쪽을 골랐다 — 창이 그만큼 작아진 것과 같다.
 *
 *  실제로 재 보고 넣은 값들이다(1920×1080 창 기준).
 *      4K 3840×2160 · 200%  →  main 1364×1004  ← FHD 100% 와 **똑같다**
 *      1366×768 · 100%      →  툴바가 217px 넘침
 *      1366×768 ·  80%      →  넘침 0, 씬 1152×648
 *
 *  ── 여기서 실제로 깨졌던 것 셋 ──────────────────────────────────────────
 *  1. `getBoundingClientRect` 는 배율이 **곱해진** 값을, `offsetWidth` 는 **안
 *     곱해진** 값을 준다. 섞어 쓰면 배율이 한 번 더 곱해진다 — 배율 2 에서 띠가
 *     자리의 73% 를 먹었다.
 *  2. 갈고리는 **자식부터** 돈다. provider 의 `useEffect` 로 배율을 걸면 띠가
 *     자기 자리를 잴 때 아직 안 걸려 있어서 **한 박자 전 치수**로 잰다 — 배율을
 *     1→2 로 바꿔도 띠가 237 에 얼어붙었다(맞는 값 209).
 *  3. `ZoomIn` 아이콘을 lucide 에서 안 들여왔었다. `vite build` 는 통과한다.
 */
import assert from 'node:assert/strict';
import { group, readSrc, SRC, t } from './_harness.mjs';

group('화면 배율');

const {
  UI_SCALES, DEFAULT_UI_SCALE, clampUiScale, uiScaleLabel, zoomOf,
} = await import(`${SRC}core/uiScale.js`);
const { dockHeight } = await import(`${SRC}ui/dockLayout.js`);

const store = await readSrc('core/store.jsx');
const dock = await readSrc('ui/RunDock.jsx');
const toolbar = await readSrc('ui/Toolbar.jsx');
const tutorial = await readSrc('ui/Tutorial.jsx');
const persist = await readSrc('core/persistence.js');

/* ── 고르는 값 ─────────────────────────────────────────────────────────── */

t('배율 목록에 1 이 있다 — 되돌릴 자리가 없으면 갇힌다', () => {
  assert.ok(UI_SCALES.includes(1), `1 이 없다: ${UI_SCALES}`);
  assert.equal(DEFAULT_UI_SCALE, 1, '처음부터 키워 놓지 않는다 — 화면 크기를 모른다');
});

t('작은 쪽과 큰 쪽이 둘 다 있다 — 노트북과 4K 를 같이 구한다', () => {
  assert.ok(Math.min(...UI_SCALES) <= 0.8, `제일 작은 값 ${Math.min(...UI_SCALES)} — 1366×768 에서 툴바가 넘친다`);
  assert.ok(Math.max(...UI_SCALES) >= 1.75, `제일 큰 값 ${Math.max(...UI_SCALES)} — 4K 100% 를 못 구한다`);
});

t('목록이 오름차순이다 — 고르는 칸에서 뒤죽박죽으로 보이면 안 된다', () => {
  const sorted = [...UI_SCALES].sort((a, b) => a - b);
  assert.deepEqual(UI_SCALES, sorted);
});

t('**쓰레기가 들어와도 화면이 사라지지 않는다** — 저장값은 사람이 손댈 수 있다', () => {
  for (const bad of ['abc', '', null, undefined, NaN, Infinity, -Infinity, 0, -3, 1e9, {}, []]) {
    const z = clampUiScale(bad);
    assert.ok(UI_SCALES.includes(z), `clampUiScale(${JSON.stringify(bad)}) = ${z} — 목록 밖이다`);
    assert.ok(z > 0, `배율 ${z} — 0 이면 화면이 사라진다`);
  }
});

t('목록 사이의 값은 가장 가까운 눈금으로 붙는다 — 안 그러면 고르는 칸이 비어 보인다', () => {
  assert.equal(clampUiScale(1.2), 1.15);
  assert.equal(clampUiScale(1.6), 1.5);
  assert.equal(clampUiScale(0.83), 0.8);
});

t('사람이 읽는 꼴로 나온다', () => {
  assert.equal(uiScaleLabel(1), '100%');
  assert.equal(uiScaleLabel(1.15), '115%');
  assert.equal(uiScaleLabel(0.8), '80%');
});

/* ── 배율을 되읽는 자 ──────────────────────────────────────────────────── */

const fake = (outer, inner) => ({ offsetWidth: inner, getBoundingClientRect: () => ({ width: outer }) });

t('zoomOf 가 바깥/안쪽 비로 배율을 되찾는다', () => {
  assert.ok(Math.abs(zoomOf(fake(1086, 724)) - 1.5) < 0.01);
  assert.equal(zoomOf(fake(724, 724)), 1);
  assert.equal(zoomOf(fake(808, 404)), 2);
});

t('**못 재면 1 이다** — NaN 이나 0 을 내보내면 그걸로 나눈 자리가 전부 망가진다', () => {
  for (const el of [null, undefined, {}, fake(500, 0), fake(0, 724), fake(NaN, 724)]) {
    const z = zoomOf(el);
    assert.ok(Number.isFinite(z) && z > 0, `zoomOf 가 ${z} 를 냈다`);
  }
  assert.equal(zoomOf(null), 1);
});

/* ── 띠 높이가 배율을 타고 따라온다 ─────────────────────────────────────── */

t('**4K 200% 가 FHD 100% 와 같은 자리를 만든다** — 이게 이 기능의 목표다', () => {
  /* 창 3840×2160 을 배율 2 로 보면 안쪽 치수가 1920×1080 창과 같아진다 */
  assert.equal(dockHeight(1364, 1004), dockHeight(1364, 1004));
  /* 배율 2 에서 자리가 반이 되면 띠도 따라 줄어야 한다 — 안 줄면 도면을 덮는다 */
  const big = dockHeight(1364, 1004);
  const half = dockHeight(404, 464);
  assert.ok(half < big, `자리가 반이 됐는데 띠는 ${big}→${half} — 안 줄었다`);
  assert.ok(half / 464 <= 0.5, `띠가 자리의 ${Math.round(half / 464 * 100)}% 다 — 도면이 계기판보다 작다`);
});

/* ── 배선: 여기서 틀렸던 자리들 ────────────────────────────────────────── */

t('배율은 **useInsertionEffect** 로 건다 — useEffect 면 띠가 한 박자 늦게 잰다', () => {
  const m = store.match(/useInsertionEffect\(\(\) => \{[\s\S]{0,240}?style\.zoom/);
  assert.ok(m, 'store 가 zoom 을 useInsertionEffect 안에서 걸지 않는다');
  assert.ok(store.includes('useInsertionEffect,'), 'react 에서 useInsertionEffect 를 안 들여왔다');
});

t('띠는 **offsetWidth** 로 잰다 — rect 를 쓰면 배율이 한 번 더 곱해진다', () => {
  const m = dock.match(/setH\(dockHeight\(([^)]*)\)\)/);
  assert.ok(m, 'dockHeight 를 부르는 곳을 못 찾았다');
  assert.ok(/offsetWidth/.test(m[1]) && /offsetHeight/.test(m[1]),
    `dockHeight(${m[1]}) — offsetWidth/offsetHeight 가 아니다`);
  assert.ok(!/getBoundingClientRect/.test(m[1]), `dockHeight(${m[1]}) — rect 는 배율이 곱해진 값이다`);
});

t('띠를 재는 갈고리가 **배율이 바뀌면 다시 돈다** — ResizeObserver 는 안 그려질 때 안 온다', () => {
  const m = dock.match(/ro\.disconnect\(\)[\s\S]{0,400}?\}, \[([^\]]*)\]\)/);
  assert.ok(m, '띠를 재는 갈고리의 딸림값을 못 찾았다');
  assert.ok(/uiScale/.test(m[1]), `딸림값이 [${m[1]}] — 배율이 없다`);
});

t('띠를 끄는 손도 배율로 나눈다 — 안 나누면 배율 2 에서 두 배로 따라온다', () => {
  assert.ok(/const z = zoomOf\(parent\)/.test(dock), '끌기가 zoomOf 를 안 쓴다');
  assert.ok(/\(d\.y - ev\.clientY\) \/ z/.test(dock), '끌기 거리를 배율로 안 나눈다');
});

t('따라 하기 강조 상자도 배율로 나눈다 — 안 나누면 배율만큼 어긋난다', () => {
  assert.ok(/zoomOf/.test(tutorial), 'Tutorial 이 zoomOf 를 안 쓴다');
  assert.ok(/r\.left \/ z/.test(tutorial) && /r\.width \/ z/.test(tutorial),
    '강조 상자가 rect 를 그대로 쓴다');
});

t('툴바에 배율 고르는 칸이 있고 uiScale 로 이어져 있다', () => {
  assert.ok(/UI_SCALES\.map/.test(toolbar), '툴바가 UI_SCALES 를 안 펼친다');
  assert.ok(/patch: \{ uiScale: Number\(e\.target\.value\) \}/.test(toolbar),
    '고른 값이 uiScale 로 안 간다');
});

t('**툴바가 쓰는 이름을 다 들여왔다** — vite build 는 이걸 안 잡는다', () => {
  /* 들여오기 구문만 모아 놓고 그 안에서 찾는다. 본문에서 쓰는 것만 보면
     「쓰기는 쓰는데 안 들여왔다」 는 바로 그 사고를 못 잡는다. */
  const imported = (toolbar.match(/^import[\s\S]*?from '[^']+';/gm) ?? []).join('\n');
  assert.ok(imported.length > 0, '들여오기 구문을 하나도 못 찾았다');
  for (const name of ['ZoomIn', 'UI_SCALES', 'uiScaleLabel', 'clampUiScale']) {
    assert.ok(toolbar.includes(name), `툴바가 ${name} 를 안 쓴다`);
    assert.ok(imported.includes(name), `${name} 를 들여오지 않았다 — 화면이 통째로 멈춘다`);
  }
});

t('배율을 이 브라우저에 기억한다', () => {
  assert.ok(/localStorage\.setItem\(SCALE_KEY/.test(persist), '저장하지 않는다');
  assert.ok(/clampUiScale\(saved\)/.test(persist), '되읽을 때 목록으로 안 붙인다 — 손댄 값이 그대로 들어온다');
});
