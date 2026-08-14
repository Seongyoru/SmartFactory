/**
 * =============================================================================
 *  도면 공유 — 올리고, 링크로 연다
 * =============================================================================
 *  갤러리(`public/layouts/`)는 **내가 담아 두고 남이 쓰는** 길이다 — 올리려면
 *  저장소 권한과 git push 가 필요하다. 서로 주고받으며 테스트하려면 앱 안에서
 *  바로 올라가야 하고, 그 길이 이것이다.
 *
 *      올리기   도면 → POST /api/share → id → `…/?share=<id>`
 *      열기     주소에 ?share=<id> 가 있으면 앱이 뜰 때 그걸 불러온다
 *
 *  ── 이 링크는 **누구나 볼 수 있다** ──────────────────────────────────────
 *  인증이 없다. 링크를 가진 사람은 누구나 열고, 주소를 아는 사람은 누구나
 *  올린다. 화면이 올리기 전에 그 말을 반드시 하고 확인을 받는다 — 사내 도면이
 *  섞이는 순간 되돌릴 수 없는 일이 된다.
 *
 *  ── 안 켰으면 안 켰다고 말한다 ───────────────────────────────────────────
 *  저장소를 안 붙인 배포에서는 서버가 501 로 「아직 안 켰다」 고 답한다.
 *  그것을 「실패」 로 뭉뚱그리면 쓰는 사람이 무엇을 해야 할지 모른다 —
 *  `SHARE_OFF` 로 갈라서 켜는 방법까지 그대로 옮긴다.
 * ---------------------------------------------------------------------------
 */

export const SHARE_PARAM = 'share';
export const SHARE_API = '/api/share';
/** 「아직 안 켰다」 — 실패와 갈라 둔다 */
export const SHARE_OFF = 'SHARE_OFF';

/** 주소에서 공유 id 를 읽는다. 없으면 null */
export function sharedIdOf(search) {
  const q = new URLSearchParams(search ?? '');
  const id = (q.get(SHARE_PARAM) ?? '').trim();
  return /^[a-z0-9]{4,32}$/.test(id) ? id : null;
}

/**
 * id 로 만든 공유 주소 — 지금 열려 있는 곳을 기준으로.
 *  앞의 검색어와 해시는 **떼고** 만든다. 「?tab=cost#zoom」 이 묻어 가면 받는
 *  사람 화면이 엉뚱한 상태로 열린다.
 *
 *  브라우저 밖(검사)에서는 기준 주소가 없으므로 상대 주소로 돌려준다.
 */
export function shareUrl(id, href = globalThis.location?.href) {
  if (!href) return `?${SHARE_PARAM}=${id}`;
  const u = new URL(href);
  u.hash = '';
  u.search = '';
  u.searchParams.set(SHARE_PARAM, id);
  return u.toString();
}

/** 서버가 준 말을 그대로 옮긴다 — 우리가 지어내면 고치는 방법이 사라진다 */
async function complain(res) {
  let body = null;
  try { body = await res.json(); } catch { /* 본문이 없을 수도 있다 */ }

  /* `npm run dev` 에는 서버 함수가 아예 없다. 「404」 만 보여 주면 무엇을 해야
     하는지 알 길이 없으므로, 여기서만 그 사정을 대신 말한다. */
  if (res.status === 404 && !body?.error) {
    const err = new Error('이 주소에는 공유 서버가 없습니다 — 배포된 곳(Vercel)에서 쓸 수 있습니다');
    err.code = SHARE_OFF;
    return err;
  }

  const msg = body?.error ?? `서버가 ${res.status} 로 답했습니다`;
  const err = new Error(body?.how ? `${msg} — ${body.how}` : msg);
  if (res.status === 501) err.code = SHARE_OFF;
  return err;
}

/**
 * 도면을 올린다.
 *  @returns { id, url }
 *  @throws  못 올렸으면 — **삼키지 않는다.** 올린 줄 알고 링크를 보내면 낭패다
 */
export async function shareLayout(data, { name, note } = {}, fetchImpl = fetch) {
  const res = await fetchImpl(SHARE_API, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    /* 이름과 설명을 같이 보낸다 — 목록에서 「무엇인지」 를 가리는 것은 결국 말이다 */
    body: JSON.stringify({ name, note, layout: data }),
  });
  if (!res.ok) throw await complain(res);
  const { id, listed } = await res.json();
  if (!id) throw new Error('서버가 링크를 안 줬습니다');
  /**
   * `listed` 가 거짓이면 **올라갔지만 목록에는 못 들어갔다.** 링크는 살아 있으니
   * 실패로 치지 않되, 그 사실은 그대로 넘긴다 — 목록에 없는 것을 「없어졌다」 고
   * 오해하면 같은 도면을 계속 다시 올리게 된다.
   */
  return { id, url: shareUrl(id), listed: listed !== false };
}

/**
 * 올라와 있는 도면 목록 — 링크가 없어도 **누구나** 여기서 고른다.
 *  목록이 없거나 못 읽으면 **빈 배열**이다. 공유를 안 쓰는 배포에서 오류를
 *  띄우면 쓰지도 않는 기능이 화면을 어지럽힌다(갤러리와 같은 태도).
 */
export async function listShared(fetchImpl = fetch) {
  try {
    const res = await fetchImpl(`${SHARE_API}?list=1`, { cache: 'no-store' });
    if (!res.ok) return [];
    const body = await res.json();
    const rows = Array.isArray(body) ? body : body?.layouts;
    return (Array.isArray(rows) ? rows : []).filter((r) => /^[a-z0-9]{4,32}$/.test(r?.id ?? ''));
  } catch {
    return [];
  }
}

/** 공유 id 로 도면을 가져온다 */
export async function fetchShared(id, fetchImpl = fetch) {
  const res = await fetchImpl(`${SHARE_API}?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
  if (!res.ok) throw await complain(res);
  return res.json();
}

/**
 * 클립보드에 넣는다 — 안 되면 **실패했다고 말한다.**
 *  http 로 열었거나 권한이 없으면 clipboard 가 없다. 조용히 실패하면
 *  사용자는 붙여넣기가 안 되는 이유를 영영 모른다.
 */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
