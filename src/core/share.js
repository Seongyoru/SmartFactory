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
 *  ── **지금 이 배포에는 서버가 없다** ────────────────────────────────────
 *  GitHub Pages 는 정적 호스팅이라 `/api/*` 가 영영 안 뜬다. 예전에 있던
 *  서버 함수(api/share.js)는 지웠다 — 배포되지도 않으면서 개발 서버만
 *  어지럽혔다.
 *
 *  그래서 **주소가 정해져 있지 않으면 요청 자체를 안 한다**(`shareOn()`).
 *  눌러 놓고 404 를 받아 「실패했습니다」 라고 말하는 것보다, 처음부터
 *  「이 배포에는 없습니다」 라고 말하는 편이 정직하다.
 *
 *  다시 붙이고 싶으면 **소스를 안 고쳐도 된다** — 빌드할 때
 *  `VITE_SHARE_API=https://…/api/share` 를 주면 아래 길이 그대로 살아난다.
 *  올리고 받는 코드는 그때를 위해 남겨 두었다.
 * ---------------------------------------------------------------------------
 */

export const SHARE_PARAM = 'share';

/**
 * 공유 서버의 주소. **정해져 있지 않으면 null 이고, 그게 기본값이다.**
 * ---------------------------------------------------------------------------
 *  예전에는 `'/api/share'` 라고 박아 두었는데, 그건 **뿌리 절대경로**라
 *  이 저장소가 못 박은 「하위 경로 배포」 결정(vite.config.js 의 `base: './'`)을
 *  혼자 어기고 있었다. `…github.io/SmartFactory/` 에서 열어도 요청은
 *  `…github.io/api/share` 로 — **앱이 놓인 곳이 아니라 계정 뿌리로** 나갔다.
 *  서버를 붙여도 안 닿는 주소였다는 뜻이다.
 *
 *  이제는 빌드할 때 통째로 받는다. 하위 경로든 딴 도메인이든 적는 사람이 정한다.
 */
export const SHARE_API = import.meta.env?.VITE_SHARE_API || null;

/** 이 배포에 공유 서버가 있는가 — 없으면 **요청을 아예 안 한다** */
export const shareOn = () => !!SHARE_API;

/** 「아직 안 켰다」 — 실패와 갈라 둔다 */
export const SHARE_OFF = 'SHARE_OFF';

/** 서버가 없을 때 사람에게 하는 말. 한 곳에 두고 화면들이 같이 쓴다 */
export const SHARE_OFF_TEXT =
  '이 배포에는 공유 서버가 없습니다 — 도면은 「내보내기」 로 파일을 주고받으세요.';

/** 서버가 없을 때 던지는 것. `code` 로 갈라야 화면이 실패와 구분한다 */
export function shareOffError() {
  const err = new Error(SHARE_OFF_TEXT);
  err.code = SHARE_OFF;
  return err;
}

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
    const err = new Error('이 주소에는 공유 서버가 없습니다 — 도면은 「내보내기」로 파일을 주고받으세요');
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
