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

/* ==========================================================================
 *  좁은 화면 — 패널을 서랍으로 접는다
 * ==========================================================================
 *  실측(창 폭 = 자리 폭, 배율 1):
 *      1440 → 264·292 · 씬 884   (예전과 같다)
 *      1200 → 233·258 · 씬 709   (예전 644 · +65)
 *      1024 → 199·220 · 씬 605   (예전 468 · +137)
 *       820 → 접힘   · 씬 820   (예전 264 — 편집기라 부를 수 없었다)
 *       390 → 접힘   · 씬 390 · 가로 스크롤 0
 */

const { NARROW_AT, isNarrow, panelMode, panelClass, PANEL_CLASS } =
  await import(`${SRC}ui/narrow.js`);

const app = await readSrc('App.jsx');
const lib = await readSrc('ui/LibraryPanel.jsx');
const insp = await readSrc('ui/Inspector.jsx');
const narrowSrc = await readSrc('ui/narrow.js');

t('좁은지 판정의 경계가 분명하다', () => {
  assert.equal(isNarrow(NARROW_AT - 1), true);
  assert.equal(isNarrow(NARROW_AT), false, '경계값은 넓은 쪽이다');
  assert.equal(isNarrow(NARROW_AT + 1), false);
});

t('**아직 못 쟀으면 넓은 것으로 본다** — 안 그러면 넓은 화면에서 서랍이 번쩍인다', () => {
  for (const v of [0, -5, NaN, undefined, null, Infinity]) {
    assert.equal(isNarrow(v), false, `isNarrow(${v}) 가 참이다`);
  }
});

t('넓으면 서랍이라는 개념이 없다 — 열린 채 넓어지면 패널이 도면 위에 뜬다', () => {
  assert.equal(panelMode(false, true), 'side');
  assert.equal(panelMode(false, false), 'side');
  assert.equal(panelMode(true, false), 'closed');
  assert.equal(panelMode(true, true), 'open');
});

t('접히면 사라지고, 열리면 **도면을 덮는다** — 밀어내면 접은 보람이 없다', () => {
  assert.match(panelClass('lib', 'closed'), /hidden/);
  assert.match(panelClass('insp', 'closed'), /hidden/);
  for (const w of ['lib', 'insp']) {
    assert.match(panelClass(w, 'open'), /absolute/, `${w} 서랍이 자리를 차지한다`);
    assert.match(panelClass(w, 'open'), /z-30/, `${w} 서랍이 도면 밑에 깔린다`);
  }
});

t('못 보던 값이 와도 패널은 보인다 — 사라지는 것이 제일 나쁘다', () => {
  for (const bad of ['', null, undefined, 'wat']) {
    assert.equal(panelClass('lib', bad), PANEL_CLASS.lib.side);
  }
  assert.equal(panelClass('없는패널', 'side'), '');
});

t('넓은 쪽 폭은 **예전 그대로다** — 좁아질 때만 같이 줄어든다', () => {
  assert.match(PANEL_CLASS.lib.side, /264px\)\]/, '라이브러리 최대폭이 264 가 아니다');
  assert.match(PANEL_CLASS.insp.side, /292px\)\]/, '속성 패널 최대폭이 292 가 아니다');
});

t('**패널 폭은 % 다 — vw 가 아니다.** vw 는 배율을 무시한다', () => {
  for (const w of ['lib', 'insp']) {
    for (const m of ['side', 'closed', 'open']) {
      assert.ok(!/\dvw/.test(PANEL_CLASS[w][m]),
        `${w}.${m} 이 vw 를 쓴다 — 배율 2 에서 패널이 자리의 두 배를 먹는다`);
    }
  }
});

t('**중단점(sm: md: lg:)을 안 쓴다** — 미디어 쿼리도 배율을 무시한다', () => {
  const all = Object.values(PANEL_CLASS).flatMap((o) => Object.values(o)).join(' ');
  assert.ok(!/\b(sm|md|lg|xl|2xl):/.test(all), `중단점을 쓴다: ${all}`);
  assert.match(narrowSrc, /offsetWidth|재서/, 'narrow.js 가 자리를 재는 방식임을 안 밝힌다');
});

t('App 이 두 패널에 꼴을 넘긴다', () => {
  assert.match(app, /<LibraryPanel mode=\{panelMode\(narrow, drawer === 'lib'\)\} \/>/);
  assert.match(app, /<Inspector mode=\{panelMode\(narrow, drawer === 'insp'\)\} \/>/);
  assert.match(lib, /panelClass\('lib', mode\)/, '라이브러리가 꼴을 안 쓴다');
  assert.match(insp, /panelClass\('insp', mode\)/, '속성 패널이 꼴을 안 쓴다');
});

t('손잡이와 바닥은 **좁을 때만** 나온다', () => {
  assert.match(app, /\{narrow && drawer && \(/, '바닥이 좁을 때만 나오지 않는다');
  assert.match(app, /\{narrow && \(\s*<>/, '손잡이가 좁을 때만 나오지 않는다');
  assert.match(app, /onClick=\{\(\) => setDrawer\(null\)\}/, '바닥을 눌러도 안 닫힌다');
});

t('**넓어지면 서랍을 닫는다** — 안 닫으면 패널이 도면 위에 겹쳐 남는다', () => {
  assert.match(app, /if \(!narrow\) setDrawer\(null\)/, '넓어질 때 서랍을 안 닫는다');
});

t('한 번에 하나만 열린다 — 둘 다 열면 좁은 화면에 도면이 없다', () => {
  assert.match(app, /setDrawer\(\(d\) => \(d === which \? null : which\)\)/,
    '서랍이 하나만 열리는 구조가 아니다');
});

t('자리를 재는 갈고리가 **루트의 style 도 지켜본다** — 배율은 그것으로 바뀐다', () => {
  assert.match(app, /new MutationObserver/, '배율 변화를 못 받는다');
  assert.match(app, /attributeFilter: \['style'\]/, '무엇이 바뀌는지 안 좁혔다');
  assert.match(app, /new ResizeObserver/, '창 크기 변화를 못 받는다');
});

t('**클래스 이름을 조립하지 않는다** — Tailwind 는 조립된 이름을 못 만든다', () => {
  const at = app.indexOf('function DrawerTab');
  assert.ok(at > 0, 'DrawerTab 을 못 찾았다');
  /* **주석을 걷어내고 본다.** 안 걷으면 「이렇게 쓰면 안 된다」 고 적어 둔
     예시 자체가 걸린다 — 실제로 걸렸다. */
  const body = app.slice(at, app.indexOf('\nfunction ', at + 10))
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  /* 실제로 저질렀던 꼴을 그대로 짚는다. 「조립처럼 보이는 것」 을 통째로 잡으려
     들면 `${place}` 같은 **멀쩡한** 자리까지 걸린다 — 한 번 그렇게 걸렸다.
     클래스 조각 뒤에 바로 `${` 가 붙는 것만이 Tailwind 가 못 보는 꼴이다. */
  const bad = body.match(/[a-z](-|:)\$\{/);
  assert.equal(bad, null, `클래스 이름을 조립한다: ${bad?.[0]}`);
  assert.match(body, /rounded-r-md/, '왼쪽 손잡이 모서리 클래스가 통짜가 아니다');
  assert.match(body, /rounded-l-md/, '오른쪽 손잡이 모서리 클래스가 통짜가 아니다');
});

/* 화면을 그리는 파일 전부 — 새 파일이 늘면 여기에 더한다.
   검사는 async 로 못 쓰므로(뼈대가 막는다) 값을 여기서 받아 둔다. */
const SCREENS = ['App.jsx', 'ui/CadDialog.jsx', 'ui/Toolbar.jsx', 'ui/Tutorial.jsx',
  'ui/Inspector.jsx', 'ui/LibraryPanel.jsx', 'ui/RunDock.jsx', 'ui/Scenarios.jsx',
  'ui/ImportDialog.jsx', 'ui/OrdersDock.jsx', 'ui/ZoneLayers.jsx', 'ui/common.jsx'];
const screenSrc = Object.fromEntries(
  await Promise.all(SCREENS.map(async (f) => [f, await readSrc(f)])));

t('**높이를 vh 로 막은 자리는 배율로 되나눈다** — 안 그러면 대화상자가 화면보다 커진다', () => {
  /* 배율 2 에서 `max-h-[88vh]` 는 화면의 176% 다 — 아래쪽 단추에 손이 안 닿는다.
     `100dvh` 도 `position:fixed` 의 `height:100%` 도 안 통한다(셋 다 재 봤다).
     되는 것은 `calc(88vh/var(--z,1))` 하나뿐이다. */
  let seen = 0;
  for (const [f, src] of Object.entries(screenSrc)) {
    for (const m of src.matchAll(/\[[^\]]*?\d+(?:\.\d+)?[vd]h[^\]]*?\]/g)) {
      seen += 1;
      assert.match(m[0], /var\(--z/,
        `${f} 의 ${m[0]} — vh 는 배율을 무시한다. calc(Nvh/var(--z,1)) 로 적을 것`);
    }
  }
  /* 하나도 못 찾았으면 검사가 아무것도 안 보고 통과한 것이다 */
  assert.ok(seen >= 3, `vh 로 막은 자리를 ${seen}곳만 찾았다 — 정규식이 안 맞는다`);
});

t('store 가 --z 를 내놓는다 — 없으면 위의 calc 이 늘 1 로 계산된다', () => {
  assert.match(store, /setProperty\('--z', String\(z\)\)/, '--z 를 안 건다');
});

t('--z 에 기본값 1 을 준다 — 없으면 calc 이 무효가 되어 상한이 사라진다', () => {
  let seen = 0;
  for (const [f, src] of Object.entries(screenSrc)) {
    for (const m of src.matchAll(/var\(--z[^)]*\)/g)) {
      seen += 1;
      assert.match(m[0], /var\(--z,\s*1\)/, `${f} 의 ${m[0]} — 기본값이 없다`);
    }
  }
  assert.ok(seen >= 3, `--z 를 쓰는 자리를 ${seen}곳만 찾았다`);
});

/* ==========================================================================
 *  3D 캔버스 — **배율을 넣으면서 내가 깨뜨린 두 곳**
 * ==========================================================================
 *  실측(창 1600×900, 씬 자리 1044×587 기준):
 *
 *    ① 캔버스가 배율배로 커져 잘렸다
 *         배율 1.5 → 담는 곳 630×334 에 캔버스 946×501   (정확히 1.5배)
 *         배율 2   → 담는 곳 800×184 에 캔버스 1600×368  (정확히 2배)
 *       도면이 왼쪽 위 귀퉁이만 보였다. r3f 가 rect(배율 곱해진 값)로 재서
 *       style.width(배율 안 곱해진 값)에 그대로 적기 때문.
 *
 *    ② 집는 자리가 배율만큼 어긋났다 — **①을 고쳐도 안 낫는다**
 *       캔버스 한가운데를 눌렀을 때 r3f 가 읽은 NDC:
 *         배율 1   → ( 0.0,  0.0)   맞다
 *         배율 0.8 → (-0.2,  0.2)
 *         배율 1.5 → ( 0.5, -0.5)
 *         배율 2   → ( 1.0, -1.0)   **오른쪽 아래 끝으로 읽었다**
 *       고친 뒤에는 네 배율 모두 (0, 0) 이다.
 */

const scene = await readSrc('scene/EditorScene.jsx');

t('**캔버스를 offsetSize 로 잰다** — rect 로 재면 배율배로 커져 도면이 잘린다', () => {
  assert.match(scene, /resize=\{\{ offsetSize: true \}\}/,
    'Canvas 에 resize={{ offsetSize: true }} 가 없다');
});

t('**집는 자리를 rect 로 계산한다** — r3f 기본값(offsetX)은 배율만큼 어긋난다', () => {
  const at = scene.indexOf('s.setEvents({');
  assert.ok(at > 0, 'onCreated 에서 compute 를 갈아 끼우지 않는다');
  const body = scene.slice(at, at + 700);
  assert.match(body, /getBoundingClientRect/, 'compute 가 rect 를 안 쓴다');
  assert.match(body, /st\.pointer\.set/, 'compute 가 pointer 를 안 채운다');
  assert.match(body, /raycaster\.setFromCamera/, 'compute 가 광선을 안 세운다');
  assert.ok(!/offsetX/.test(body), 'compute 가 아직 offsetX 를 쓴다 — 배율이 곱해진 값이다');
});

t('씬이 직접 하는 광선도 rect + clientX 다 — 두 계산이 같은 자를 써야 한다', () => {
  /* PointerDriver 의 ground(). 여기가 offsetWidth 로 바뀌면 compute 와 갈라진다 */
  assert.match(scene, /ndc\.set\(\(\(e\.clientX - r\.left\) \/ r\.width\)/,
    'ground 가 rect + clientX 꼴이 아니다');
});

t('탑뷰 팬도 배율로 나눈다 — 안 나누면 배율 2 에서 도면이 두 배로 따라온다', () => {
  assert.match(scene, /uiZ = zoomOf\(el\)/, '탑뷰가 zoomOf 를 안 쓴다');
  const hits = [...scene.matchAll(/camera\.position\.[xz] -= [^;]*;/g)].map((m) => m[0]);
  assert.ok(hits.length >= 2, `카메라를 미는 자리를 ${hits.length}곳만 찾았다`);
  for (const h of hits) {
    assert.match(h, /camera\.zoom \* uiZ/, `${h} — 화면 배율로 안 나눈다`);
  }
});
