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
const failed = await S.shareLayout(LAYOUT, res(500, { error: '터졌습니다' })).catch((e) => e);
const offErr = await S.shareLayout(
  LAYOUT,
  res(501, { error: '공유 저장소가 아직 연결되지 않았습니다', how: 'Vercel → Storage → Blob' }),
).catch((e) => e);
const noId = await S.shareLayout(LAYOUT, res(200, {})).catch((e) => e);
let sentBody = null;
const uploaded = await S.shareLayout(LAYOUT, async (url, opt) => {
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
  assert.match(offErr.message, /Vercel → Storage → Blob/, '켜는 방법이 사라졌다');
});
t('id 를 안 주면 성공으로 치지 않는다', () => {
  assert.match(noId.message, /링크를 안 줬습니다/);
});
t('올릴 때 도면을 그대로 싣는다', () => {
  assert.deepEqual(sentBody, LAYOUT);
  assert.equal(uploaded.id, 'aaa111');
});
t('받아 올 때도 서버 말을 그대로 옮긴다', () => {
  assert.match(gone.message, /그런 도면이 없습니다/);
});

/* ---------- 배선 ----------------------------------------------------------- */

const toolbar = await readSrc('ui/Toolbar.jsx');
const app = await readSrc('App.jsx');
const api = await readSrc('../api/share.js');

t('**올리기 전에 묻는다** — 한 번 나간 것은 되돌릴 수 없다', () => {
  assert.ok(toolbar.includes("'ask'"), '확인 단계가 없다');
  assert.ok(/누구나<\/b> 열 수 있고/.test(toolbar), '공개된다는 말을 안 한다');
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
t('서버는 **안 켰으면 501** — 500 으로 뱉으면 고장처럼 보인다', () => {
  assert.ok(api.includes('BLOB_READ_WRITE_TOKEN'), '토큰을 안 본다');
  assert.ok(/return json\(res, 501/.test(api), '안 켠 것을 안 가려낸다');
  assert.ok(api.includes('how:'), '켜는 방법을 안 알려 준다');
});
t('서버도 도면인지 보고, 너무 크면 받지 않는다', () => {
  assert.ok(api.includes('looksLikeLayout'), '아무 JSON 이나 받는다');
  assert.ok(/MAX_BYTES/.test(api) && /413/.test(api), '크기 한도가 없다');
  assert.ok(/\^\[a-z0-9\]\{4,32\}\$/.test(api), 'id 를 그대로 믿는다');
});

/* dev 서버에는 함수가 아예 없다 — 「404」 만 보여 주면 뭘 해야 할지 모른다 */
const noServer = await S.shareLayout(LAYOUT, async () => ({
  ok: false, status: 404, json: async () => { throw new Error('본문 없음'); },
})).catch((e) => e);

t('서버 자체가 없을 때도 **무엇을 해야 하는지** 말한다', () => {
  assert.equal(noServer.code, S.SHARE_OFF);
  assert.match(noServer.message, /배포된 곳/);
});
