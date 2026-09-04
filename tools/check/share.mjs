/**
 * 도면 나눠 쓰기 — 담아 두기(갤러리)와 올리기(공유)
 * ---------------------------------------------------------------------------
 *  둘 다 **밖으로 나가는 길**이다. 조용히 실패하면 올린 줄 알고 링크를 보내게
 *  되고, 남의 주소를 부르게 두면 이 배포가 통로가 된다. 그래서 「안 된 것을
 *  안 됐다고 말하는가」 와 「받은 것을 그대로 믿지 않는가」 를 함께 본다.
 */
import assert from 'node:assert/strict';
import { SRC, group, readSrc, t } from './_harness.mjs';

group('도면 나눠 쓰기');

const G = await import(SRC + 'core/gallery.js');
const S = await import(SRC + 'core/share.js');

/* 값은 검사 밖에서 받아 둔다 — 하네스가 async 검사를 막는다(그러면 조용히 통과한다) */
const apiGone = await import('node:fs/promises')
  .then((fs) => fs.readFile(new URL('../../api/share.js', import.meta.url)))
  .then(() => false)
  .catch(() => true);

const LAYOUT = { placed: [{ uid: 'E1' }], areas: [], links: [] };

/* ---------- 갤러리 — 저장소에 담아 둔 것 ---------------------------------- */

t('도면인지 최소한은 본다', () => {
  assert.equal(G.looksLikeLayout(LAYOUT), true);
  assert.equal(G.looksLikeLayout({ areas: [] }), true, '바닥만 있어도 도면이다');
  assert.equal(G.looksLikeLayout({ hello: 1 }), false);
  assert.equal(G.looksLikeLayout(null), false);
  assert.equal(G.looksLikeLayout('{"placed":[]}'), false, '글자는 도면이 아니다');
});
t('이름이 없으면 파일 이름으로 대신한다', () => {
  const e = G.normalizeEntry({ file: 'line-a.json' });
  assert.equal(e.name, 'line-a');
  assert.equal(e.id, 'L1');
});
t('**바깥 주소나 상위 폴더는 버린다** — 이 배포가 통로가 되면 안 된다', () => {
  for (const bad of ['https://evil.example/x.json', '//evil.example/x.json', '../../secret.json', 'file:///etc/passwd']) {
    assert.equal(G.normalizeEntry({ file: bad }), null, `${bad} 를 받아들였다`);
  }
  assert.equal(G.normalizeEntry({ file: '' }), null);
  assert.equal(G.normalizeEntry({}), null, '파일이 없는 줄은 버린다');
});
t('목록은 두 모양을 다 받는다 — 배열이든 { layouts: [] } 든', () => {
  const rows = [{ file: 'a.json' }, { file: 'b.json' }];
  assert.equal(G.normalizeIndex(rows).length, 2);
  assert.equal(G.normalizeIndex({ layouts: rows }).length, 2);
  assert.deepEqual(G.normalizeIndex(null), []);
});
/* 값은 **파일 맨 위에서** 받아 둔다 — t() 안에서 await 하면 검사가 조용히
   통과해 버린다(하네스가 그것을 막아 준다). */
const emptyIndex = await G.loadGalleryIndex(() => { throw new Error('404'); });
const readPaths = [];
const gotLayout = await G.loadGalleryLayout({ file: 'a.json' }, (path) => { readPaths.push(path); return LAYOUT; });
const notLayout = await G.loadGalleryLayout({ file: 'x.json' }, () => ({ hello: 1 })).catch((e) => e);
const badEntry = await G.loadGalleryLayout({ file: '' }, async () => LAYOUT).catch((e) => e);

const res = (status, body) => async () => ({ ok: status < 400, status, json: async () => body });
const failed = await S.shareLayout(LAYOUT, { name: 'A라인', note: '2단 조립' }, res(500, { error: '터졌습니다' })).catch((e) => e);
const offErr = await S.shareLayout(
  LAYOUT, { name: 'A라인', note: '2단 조립' },
  /* `how` 는 **서버가 준 말**이다. 여기 적힌 것은 그것을 그대로 옮기는지
     보려고 넣은 시험용 값일 뿐, 특정 서비스를 뜻하지 않는다. */
  res(501, { error: '공유 저장소가 아직 연결되지 않았습니다', how: '저장소를 연결하세요' }),
).catch((e) => e);
const noId = await S.shareLayout(LAYOUT, { name: 'A라인', note: '2단 조립' }, res(200, {})).catch((e) => e);
let sentBody = null;
const uploaded = await S.shareLayout(LAYOUT, { name: 'A라인', note: '2단 조립' }, async (url, opt) => {
  sentBody = JSON.parse(opt.body);
  return { ok: true, status: 200, json: async () => ({ id: 'aaa111' }) };
});
const gone = await S.fetchShared('abc123', res(404, { error: '그런 도면이 없습니다' })).catch((e) => e);

t('목록이 없으면 **조용히 빈 목록** — 안 쓰는 배포가 경고를 띄우면 안 된다', () => {
  assert.deepEqual(emptyIndex, []);
});
t('고른 것을 못 열면 **말한다** — 목록이 없는 것과 다르다', () => {
  assert.match(notLayout.message, /도면 파일이 아닙니다/);
  assert.ok(badEntry instanceof Error, '못 쓸 항목을 그냥 넘겼다');
});
t('제대로 된 것은 그대로 돌려준다', () => {
  assert.deepEqual(gotLayout, LAYOUT);
  assert.deepEqual(readPaths, ['layouts/a.json'], '엉뚱한 곳을 읽는다');
});

/* ---------- 공유 — 앱에서 바로 올리기 ------------------------------------- */

t('주소의 공유 id 를 읽는다 — 이상한 것은 안 받는다', () => {
  assert.equal(S.sharedIdOf('?share=abc123xy'), 'abc123xy');
  assert.equal(S.sharedIdOf('?a=1&share=zz99'), 'zz99');
  assert.equal(S.sharedIdOf('?share='), null);
  assert.equal(S.sharedIdOf(''), null);
  assert.equal(S.sharedIdOf('?share=../etc'), null, '경로를 섞은 것을 받았다');
  assert.equal(S.sharedIdOf(`?share=${'x'.repeat(64)}`), null, '너무 긴 것을 받았다');
});
t('공유 주소는 **깨끗하게** 만든다 — 앞의 검색어·해시가 묻어 가지 않는다', () => {
  assert.equal(S.shareUrl('abc123', 'https://app.example/path/?tab=cost#zoom'),
    'https://app.example/path/?share=abc123');
});
t('못 올렸으면 **던진다** — 올린 줄 알고 링크를 보내면 낭패다', () => {
  assert.ok(failed instanceof Error);
  assert.match(failed.message, /터졌습니다/);
});
t('**아직 안 켠 것**은 실패와 갈라서 켜는 법까지 옮긴다', () => {
  assert.equal(offErr.code, S.SHARE_OFF, '「안 켰다」 를 못 가려낸다');
  assert.match(offErr.message, /저장소를 연결하세요/, '켜는 방법이 사라졌다');
});
t('id 를 안 주면 성공으로 치지 않는다', () => {
  assert.match(noId.message, /링크를 안 줬습니다/);
});
t('올릴 때 도면과 **이름**을 같이 싣는다', () => {
  /* 이름이 없으면 목록이 「(이름 없음)」 으로 뒤덮여 고를 수가 없다 */
  assert.deepEqual(sentBody.layout, LAYOUT);
  assert.equal(sentBody.name, 'A라인');
  assert.equal(sentBody.note, '2단 조립', '설명을 안 싣는다');
  assert.equal(uploaded.id, 'aaa111');
});
t('받아 올 때도 서버 말을 그대로 옮긴다', () => {
  assert.match(gone.message, /그런 도면이 없습니다/);
});

/* ---------- 배선 ----------------------------------------------------------- */

const toolbar = await readSrc('ui/Toolbar.jsx');
const app = await readSrc('App.jsx');
const store = await readSrc('core/store.jsx');
const shareSrc = await readSrc('core/share.js');
const inspectorSrc = await readSrc('ui/Inspector.jsx');
const commonSrc = await readSrc('ui/common.jsx');
/** 주석을 걷어낸 소스 — 「여기서는 안 부른다」 를 볼 때 주석 속 이름에 걸린다 */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

t('**올리기 전에 묻는다** — 한 번 나간 것은 되돌릴 수 없다', () => {
  assert.ok(toolbar.includes("'ask'"), '확인 단계가 없다');
  /* 문구는 다듬어도 되지만 **두 가지 뜻은 반드시** 남아야 한다 */
  assert.ok(/<b>누구나<\/b>/.test(toolbar), '공개된다는 말을 안 한다');
  assert.ok(/되돌릴 수 없/.test(toolbar), '되돌릴 수 없다는 말을 안 한다');
  assert.ok(toolbar.includes('취소'), '무를 길이 없다');
});
t('링크로 들어오면 **알아서 열린다** — 받은 사람이 할 일이 없어야 한다', () => {
  assert.ok(app.includes('sharedIdOf(window.location.search)'), '주소를 안 본다');
  assert.ok(/dispatch\(\{ type: 'LOAD_LAYOUT', data \}\)/.test(app), '열지 않는다');
});
t('열고 나면 주소에서 지운다 — 새로고침마다 원본으로 돌아가면 안 된다', () => {
  assert.ok(app.includes('searchParams.delete(SHARE_PARAM)'), '주소에 계속 남는다');
  assert.ok(app.includes('history.replaceState'), '뒤로 가기 기록이 더러워진다');
});
/**
 * **서버 쪽 검사는 지웠다** — 서버가 없어졌기 때문이다.
 * ---------------------------------------------------------------------------
 *  api/share.js(239줄)는 Vercel 시절의 함수였다. GitHub Pages 는 정적이라
 *  `/api/*` 가 영영 안 뜨고, vite build 산출물에도 안 들어가고, @vercel/blob 은
 *  package.json 에 아예 없었다 — **어디에서도 실행되지 않는 코드**였다.
 *  그런데 개발 서버에서는 앱이 뜰 때마다 그 파일을 모듈로 변환하려다 실패해
 *  오류 오버레이로 화면을 덮었다.
 *
 *  아래에 남은 것은 **서버가 있든 없든 뜻이 있는 것들**이다 — 클라이언트가
 *  서버 말을 그대로 옮기는가, 주소를 제대로 거르는가, 화면이 무엇을 말하는가.
 *  서버를 다시 붙이면(VITE_SHARE_API) 그 검사들이 그대로 다시 값을 한다.
 */

/* dev 서버에는 함수가 아예 없다 — 「404」 만 보여 주면 뭘 해야 할지 모른다 */
const noServer = await S.shareLayout(LAYOUT, { name: 'A라인', note: '2단 조립' }, async () => ({
  ok: false, status: 404, json: async () => { throw new Error('본문 없음'); },
})).catch((e) => e);

t('서버 자체가 없을 때도 **무엇을 해야 하는지** 말한다', () => {
  assert.equal(noServer.code, S.SHARE_OFF);
  assert.match(noServer.message, /내보내기/);
});

/* ---------- 올린 것이 **목록에 남는다** ----------------------------------- */

const T = await import(SRC + 'core/thumb.js');

const listed = await S.listShared(async () => ({
  ok: true, status: 200,
  json: async () => ({ layouts: [
    { id: 'aaa111', name: 'A라인', at: 1, size: 100, thumb: 'https://x/t.svg' },
    { id: '../evil', name: '나쁜 것' },
  ] }),
}));
const listOff = await S.listShared(async () => ({ ok: false, status: 501, json: async () => ({}) }));
const listBroke = await S.listShared(async () => { throw new Error('끊김'); });

t('목록은 서버가 준 줄을 **거르고** 받는다', () => {
  assert.equal(listed.length, 1, 'id 가 이상한 줄을 그대로 받았다');
  assert.equal(listed[0].id, 'aaa111');
});
t('목록을 못 읽으면 **빈 배열** — 안 쓰는 배포가 오류를 띄우면 안 된다', () => {
  assert.deepEqual(listOff, []);
  assert.deepEqual(listBroke, []);
});
t('화면이 두 곳을 **한 목록**으로 보여 준다', () => {
  /* 서버가 없으면 **부르지도 않는다** — 예전에는 앱이 뜰 때마다 죽은 요청을
     한 번씩 쏘았고, 개발 서버에서는 그것이 오류 오버레이로 화면을 덮었다.
     그래도 갤러리와 한 목록으로 합치는 구조는 그대로다. */
  assert.ok(/shareOn\(\) \? listShared\(\) : Promise\.resolve\(\[\]\)/.test(toolbar),
    '서버가 없을 때도 죽은 요청을 쏜다');
  assert.ok(/Promise\.all\(\[\s*loadGalleryIndex\(\),/.test(toolbar), '두 곳을 한 목록으로 안 합친다');
  assert.ok(toolbar.includes("from: 'share'") && toolbar.includes("from: 'repo'"), '어디서 온 것인지 안 가린다');
  assert.ok(toolbar.includes('<LayoutCard'), '카드로 안 보여 준다');
  assert.ok(/row\.thumb/.test(toolbar), '썸네일을 안 쓴다');
});

/* ---------- 썸네일 그리기 -------------------------------------------------- */

const BOX = { areas: [{ mp: [[[[-10, -5], [10, -5], [10, 5], [-10, 5], [-10, -5]]]] }], placed: [{ uid: 'E', pos: [0, 0] }] };

t('도면이 차지하는 네모를 잰다', () => {
  assert.deepEqual(T.layoutBounds(BOX), { minX: -10, minZ: -5, maxX: 10, maxZ: 5 });
  assert.equal(T.layoutBounds({}), null, '그릴 것이 없으면 null');
  assert.equal(T.layoutBounds({ placed: [{ uid: 'E' }] }), null, '좌표 없는 것은 안 센다');
});
t('**가로세로 배율이 같다** — 따로 늘리면 라인 모양이 거짓말을 한다', () => {
  const t2 = T.fitTransform(T.layoutBounds(BOX), 320, 180);
  const [x1, y1] = t2.at(-10, -5);
  const [x2, y2] = t2.at(10, 5);
  const sx = (x2 - x1) / 20;
  const sy = (y2 - y1) / 10;
  assert.ok(Math.abs(sx - sy) < 1e-9, `가로 ${sx} ≠ 세로 ${sy}`);
});
t('남는 쪽은 가운데로 민다', () => {
  const t2 = T.fitTransform(T.layoutBounds(BOX), 320, 180);
  const [cx, cy] = t2.at(0, 0);
  assert.ok(Math.abs(cx - 160) < 1e-6 && Math.abs(cy - 90) < 1e-6, `가운데가 아니다 (${cx}, ${cy})`);
});
t('그림은 한 장으로 닫힌다 — 바깥 것을 안 부르고 스크립트도 없다', () => {
  const svg = T.layoutThumbSVG(BOX);
  assert.ok(svg.startsWith('<svg xmlns='));
  assert.equal(/<script|href=|url\(/.test(svg), false, '바깥 것을 부른다');
});
t('빈 도면도 **그림은 나온다** — 깨진 이미지가 뜨면 고장으로 보인다', () => {
  const svg = T.layoutThumbSVG({});
  assert.ok(svg.startsWith('<svg') && svg.includes('빈 도면'));
});
t('이름에 태그를 적어도 그림이 안 무너진다', () => {
  const svg = T.layoutThumbSVG({ ...BOX, zones: [{ mp: BOX.areas[0].mp, color: '"><script>x</script>' }] });
  assert.equal(svg.includes('<script>'), false, '구역 색으로 태그가 들어갔다');
});
t('한 줄 요약이 무엇이 든 도면인지 말한다', () => {
  assert.equal(T.layoutSummary({ placed: [1, 2], links: [1] }), '설비 2 · 연결 1');
  assert.equal(T.layoutSummary({ carts: [{ count: 3 }] }), '차량 3');
  assert.equal(T.layoutSummary({}), '빈 도면');
});

/* ---------- 고르는 창 · 덮어쓰기 전 확인 ---------------------------------- */

t('목록은 **화면 가운데 창**으로 뜬다 — 툴바에 매달면 잘린다', () => {
  assert.ok(/fixed inset-0 z-40 flex items-center justify-center/.test(toolbar), '가운데 창이 아니다');
  /* 그리드에 두면 칸이 항목에 맞춰 늘어나 max-w-full 의 100% 가 자기 자신을
     가리킨다 — 좁은 창에서 실제로 620px 이 그대로 넘쳤다 */
  assert.equal(/z-40 grid place-items-center/.test(toolbar), false, '그리드로 가운데 정렬하면 폭이 안 잡힌다');
  assert.ok(/w-\[900px\] max-w-full/.test(toolbar), '좁은 화면에서 넘친다');
});
t('썸네일이 **왼쪽**, 정보가 오른쪽', () => {
  const card = toolbar.slice(toolbar.indexOf('function LayoutCard'), toolbar.indexOf('function GalleryButton'));
  assert.ok(/flex w-full items-stretch/.test(card), '가로로 안 눕혔다');
  assert.ok(card.indexOf('row.thumb') < card.indexOf('row.name'), '그림이 이름보다 뒤에 있다');
});
t('**고른다고 바로 열리지 않는다** — 모르고 눌러 몇 시간 그린 것이 날아가면 안 된다', () => {
  assert.ok(/onPick=\{\(\) => choose\(r\)\}/.test(toolbar), '카드를 누르면 바로 열린다');
  assert.ok(/onClick=\{\(\) => open2\(sel\)\}/.test(toolbar), '확인 뒤 여는 길이 없다');
  assert.ok(toolbar.includes('덮어쓰고 열기'), '무엇이 일어나는지 안 적혀 있다');
});
t('그 자리에서 **내보내기**까지 준다 — 말만 하고 길을 안 주면 소용없다', () => {
  assert.ok(toolbar.includes('먼저 내보내기'), '내보내기 버튼이 없다');
  assert.ok(/onExport/.test(toolbar), '내보내기가 이어져 있지 않다');
});
t('「저장」 버튼은 없앴다 — 자동 저장과 같은 일을 하고 있었다', () => {
  /* 도면은 고칠 때마다 이미 저장된다(store 의 효과). 진짜 「저장」 은 내보내기다.
     같은 낱말이 둘을 가리키면 정작 내보내야 할 때 저장을 눌러 놓고 안심한다. */
  assert.equal(/<Save size=/.test(toolbar), false, '저장 버튼이 되살아났다');
  assert.equal(/saveLayout\(/.test(code(toolbar)), false, '툴바가 저장을 직접 부른다');
  assert.ok(toolbar.includes('내보내기'), '꺼내는 길까지 사라졌다');
});

/* ---------- 다 채워 멈췄을 때 -------------------------------------------- */

const dock = await readSrc('ui/OrdersDock.jsx');

t('스스로 멈춘 것을 **상태로 남긴다** — 화면이 얼면 고장으로 보인다', () => {
  assert.ok(/haltedByOrders: true/.test(dock), '멈춘 이유를 안 남긴다');
  assert.ok(/haltedByOrders: false/.test(dock), '다시 돌아도 강조가 안 꺼진다');
  assert.ok(/haltedByOrders: false/.test(store), '기본값이 없다');
});
t('멈춘 이유와 **다시 도는 길**을 같이 말한다', () => {
  assert.ok(dock.includes('오더를 전부 채워서 멈췄습니다'), '왜 멈췄는지 안 적는다');
  assert.ok(/고장이 아닙니다/.test(dock), '고장이 아니라는 말이 없다');
  assert.ok(/border-emerald-500/.test(dock), '오더 칸을 안 짚어 준다');
  assert.ok(/ring-emerald-500/.test(toolbar), '재생 버튼을 안 짚어 준다');
  assert.ok(/다시 돌리기/.test(toolbar), '버튼 설명이 그대로다');
});

/* ---------- 실제로 났던 버그(서버) ----------------------------------------
 *  「목록이 첫 번째에서 멈췄다」 · 「목록이 스스로 아문다」 · 「덮어쓰기」 —
 *  셋 다 api/share.js 를 짚던 검사였다. 서버와 함께 지웠다. 다시 붙일 때는
 *  git 기록(이 커밋의 부모)에서 그대로 되살릴 수 있다.
 */

t('올릴 때 **이름과 설명**을 받는다', () => {
  assert.ok(/placeholder="도면 이름/.test(toolbar), '이름 칸이 없다');
  assert.ok(/placeholder="설명 —/.test(toolbar), '설명 칸이 없다');
  assert.ok(/JSON\.stringify\(\{ name, note, layout: data \}\)/.test(shareSrc),
    '이름과 설명을 안 싣는다');
});
t('보고서·CSV 버튼이 **눈에 띈다** — 들고 나가는 유일한 길이다', () => {
  assert.ok(/ring-sky-500\/40/.test(inspectorSrc), '테두리가 없다');
  assert.ok(/hover:bg-sky-500 hover:text-white/.test(inspectorSrc), '손이 닿아도 안 채워진다');
  assert.equal(/rounded bg-kbd px-1\.5 py-0\.5 text-\[10\.5px\] text-ink4/.test(inspectorSrc), false,
    '옛 흐린 모양이 남아 있다');
});
t('**높이를 못 박는다** — 한글과 라틴은 글자 높이가 달라 줄이 어긋난다', () => {
  /* 「보고서」와 「CSV」에 안쪽 여백만 맞췄더니 두 버튼이 1~2px 어긋났다.
     leading-none 으로 글자 높이를 지우고 상자 높이를 직접 준다. */
  assert.ok(/const OUT_H = 'flex h-\[26px\] items-center'/.test(inspectorSrc), '높이를 안 박았다');
  assert.ok(/leading-none/.test(inspectorSrc), '글자 높이가 살아 있어 어긋난다');
  /* 다 같은 자를 쓴다 — 하나만 고치면 또 어긋난다.
     **개수를 못 박지 않는다.** 버튼은 늘어난다(도면 보고서가 그랬다). 지킬 것은
     「몇 개인가」가 아니라 **「그 모양을 손으로 다시 적은 데가 없는가」** 다. */
  assert.ok((inspectorSrc.match(/className=\{OUT_BTN\}/g) ?? []).length >= 2, '같은 자를 쓰는 버튼이 없다');
  assert.equal((inspectorSrc.match(/ring-1 ring-sky-500\/40/g) ?? []).length, 1,
    '같은 모양을 손으로 다시 적은 데가 있다 — OUT_BTN 을 쓸 것');
  assert.ok(/\$\{OUT_H\} w-\[26px\]/.test(inspectorSrc), '다시 재기만 높이가 다르다');
});
t('**켜져 있는 버튼도 손이 닿으면 반응한다**', () => {
  /* 일시정지·그리드·면 맞춤은 켜져 있어 active 였는데, active 에 hover 가 아예
     없어서 미동도 없었다 — 눌리는 것인지 그냥 표시인지 알 수가 없었다. */
  const common = commonSrc.slice(commonSrc.indexOf('export function Btn'), commonSrc.indexOf('export function Section'));
  const active = [...common.matchAll(/bg-sky-500 text-white[^']*/g)].map((m) => m[0]);
  assert.ok(active.length >= 2, 'Btn·IconBtn 의 켠 모양을 못 찾았다');
  for (const a of active) assert.ok(/hover:bg-sky-600/.test(a), `켠 채로는 반응이 없다 — ${a}`);
  assert.ok(/hover:bg-raiseh/.test(toolbar), '스냅 고르개가 반응하지 않는다');
});

t('설명은 **두 줄까지** 보인다 — 한 줄로 자르면 요점이 잘려 나간다', () => {
  /* 「테스트 도면입니다. 안녕하세요 이 텍스트는…」 에서 끊기면 정작 무엇을
     시험한 배치인지가 안 보인다. 그렇다고 다 펴면 카드 높이가 제각각이 되어
     목록이 훑어지지 않는다 — 두 줄이 그 사이다. */
  const card = toolbar.slice(toolbar.indexOf('function LayoutCard'), toolbar.indexOf('function GalleryButton'));
  assert.ok(/line-clamp-2/.test(card), '설명이 한 줄에서 잘린다');
  assert.equal(/truncate text-\[10\.5px\] text-ink3/.test(card), false, '옛 한 줄 자르기가 남아 있다');
  /* 이름은 한 줄로 남는다 — 이름까지 두 줄이 되면 카드가 흔들린다 */
  assert.ok(/truncate text-\[12\.5px\] font-medium/.test(card), '이름이 한 줄이 아니다');
});

/* ---------- 열기 전에 속을 편다 ------------------------------------------- */

const LI = await import(SRC + 'core/layoutInfo.js');

t('넓이는 **구멍을 뺀다** — 다 더하면 뚫린 자리를 두 번 센다', () => {
  const ring = [[-30, -30], [30, -30], [30, 30], [-30, 30]];
  const hole = [[-10, -10], [10, -10], [10, 10], [-10, 10]];
  assert.equal(LI.ringArea(ring), 3600);
  assert.equal(LI.mpArea([[ring]]), 3600);
  assert.equal(LI.mpArea([[ring, hole]]), 3200, '구멍이 안 빠졌다');
  assert.equal(LI.mpArea([[ring], [hole]]), 4000, '도형 둘은 더해야 한다');   // 3600 + 20×20
  assert.equal(LI.mpArea(null), 0);
  assert.equal(LI.ringArea([[0, 0], [1, 1]]), 0, '점 둘로는 면이 안 된다');
});
t('**선반·적치대는 설비에서 뺀다** — 섞으면 규모가 부풀어 보인다', () => {
  const itemOf = (id) => ({ M: { id: 'M' }, S: { id: 'S', kind: 'shelf' }, T: { id: 'T', kind: 'stillage' } })[id] ?? null;
  const info = LI.layoutInfo({
    placed: [{ uid: 'a', itemId: 'M' }, { uid: 'b', itemId: 'M' }, { uid: 'c', itemId: 'S' }, { uid: 'd', itemId: 'T' }],
  }, itemOf);
  assert.equal(info.scale.machines, 2);
  assert.equal(info.scale.stores, 2);
});
t('설비 구성은 **많은 것부터** — 라인의 성격은 가장 많은 설비가 정한다', () => {
  const itemOf = (id) => ({ A: { id: 'A', name: '조립기' }, M: { id: 'M', name: '제작기' } })[id] ?? null;
  const info = LI.layoutInfo({
    placed: [{ itemId: 'A' }, { itemId: 'M' }, { itemId: 'M' }, { itemId: 'M' }],
  }, itemOf);
  assert.deepEqual(info.kinds.map((k) => [k.name, k.n]), [['제작기', 3], ['조립기', 1]]);
});
t('차량은 **대수**로 센다 — 경로 수와 다르다', () => {
  const info = LI.layoutInfo({ carts: [{ count: 3 }, { count: 2 }, {}] });
  assert.equal(info.scale.paths, 3);
  assert.equal(info.scale.vehicles, 6, 'count 없는 경로는 1대로 본다');
});
t('빈 도면도 터지지 않는다', () => {
  const info = LI.layoutInfo({});
  assert.equal(info.scale.machines, 0);
  assert.equal(info.building.floor, 0);
  assert.equal(info.crew.shifts.length, 1, '교대는 기본값으로 채워진다');
});
t('**돌려야 나오는 값은 없다** — 있는 척하면 그게 더 나쁘다', () => {
  const info = LI.layoutInfo({ placed: [{ itemId: 'M' }] });
  for (const k of ['throughput', 'oee', 'cost', 'uptime']) {
    assert.equal(k in info, false, `${k} 는 도면만 보고 알 수 없다`);
  }
});
t('고르면 **미리 읽어** 속을 보여 준다 — 열 때 쓸 그 파일이다', () => {
  assert.ok(/const choose = async \(row\)/.test(toolbar), '고를 때 안 읽는다');
  assert.ok(/setDetail\(\{ row, data: await fetchOne\(row\) \}\)/.test(toolbar), '읽은 것을 안 넘긴다');
  /* 미리 읽어 둔 것을 열 때 다시 받으면 미리 읽은 뜻이 없다 */
  assert.ok(/onPick\(await fetchOne\(row\), row\)/.test(toolbar), '열 때 또 받는다');
  assert.ok(/if \(cache\.current\.has\(key\)\) return cache\.current\.get\(key\)/.test(toolbar), '들고 있지 않는다');
  assert.ok(/cache\.current\.set\(`repo:\$\{e\.id\}`/.test(toolbar), '썸네일용으로 읽은 것을 못 쓴다');
});
t('속을 못 읽어도 **창은 산다** — 목록까지 죽으면 안 된다', () => {
  assert.ok(/setDetail\(\{ row, error:/.test(toolbar), '못 읽은 것을 안 알린다');
  assert.ok(/error\}/.test(toolbar) && /text-rose-500/.test(toolbar), '오류가 안 보인다');
});

/* ---------- 서버가 없다는 것을 **정직하게** 말한다 ------------------------- */

t('공유 주소는 **빌드 때 받는다** — 뿌리 절대경로를 박지 않는다', () => {
  /* 예전에는 `'/api/share'` 였는데, 그건 이 저장소가 못 박은 「하위 경로 배포」
     결정(vite.config.js 의 base: './')을 혼자 어기는 자리였다. …/SmartFactory/
     에서 열어도 요청은 계정 뿌리로 나갔다 — 서버를 붙여도 안 닿았다. */
  assert.ok(!/SHARE_API = '\/api\/share'/.test(shareSrc), '뿌리 절대경로를 다시 박았다');
  assert.match(shareSrc, /import\.meta\.env\?\.VITE_SHARE_API \|\| null/, '환경변수에서 안 받는다');
});

t('**기본값은 꺼짐이다** — 지금 이 배포에는 서버가 없다', () => {
  assert.match(shareSrc, /export const shareOn = \(\) => !!SHARE_API;/, '켜졌는지 묻는 길이 없다');
  assert.equal(S.shareOn(), false, '검사 환경에서 켜져 있다 — 기본값이 꺼짐이 아니다');
});

t('안 켰으면 **누르자마자** 말한다 — 다 적게 해 놓고 무르지 않는다', () => {
  assert.match(toolbar, /state === 'ask' && !shareOn\(\)/, '서버가 없을 때의 갈래가 없다');
  const at = toolbar.indexOf("state === 'ask' && !shareOn()");
  const off = toolbar.slice(at, toolbar.indexOf("state === 'ask' && shareOn()", at));
  assert.match(off, /SHARE_OFF_TEXT/, '무엇이 없는지 안 말한다');
  assert.ok(!/placeholder="도면 이름/.test(off), '서버가 없는데 이름을 받는다');
});

t('안 켰으면 **링크로 들어와도 요청을 안 한다** — 그래도 주소는 치운다', () => {
  assert.match(app, /if \(!shareOn\(\)\) \{/, '서버가 없을 때도 부른다');
  const at = app.indexOf('if (!shareOn()) {');
  const off = app.slice(at, at + 400);
  assert.match(off, /searchParams\.delete\(SHARE_PARAM\)/, '주소를 안 치운다 — 새로고침마다 같은 말이 뜬다');
  assert.match(off, /SHARE_OFF_TEXT/, '왜 안 되는지 안 말한다');
});

t('서버가 없다는 말이 **한 곳에** 있다 — 화면마다 다르게 말하면 안 된다', () => {
  assert.match(shareSrc, /export const SHARE_OFF_TEXT =/, '문구가 상수가 아니다');
  assert.match(shareSrc, /내보내기/, '무엇을 대신 쓰라는지 안 말한다');
});

t('**서버 파일이 사라졌다** — 배포도 안 되면서 개발 서버만 어지럽혔다', () => {
  assert.ok(apiGone, 'api/share.js 가 아직 있다 — 정적 배포에서는 영영 안 돈다');
});
