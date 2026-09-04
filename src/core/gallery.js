/**
 * =============================================================================
 *  공용 도면 — 저장소에 담아 두고 누구나 불러 쓴다
 * =============================================================================
 *  도면을 나눠 쓰려고 매번 JSON 파일을 주고받는 것은 비효율이다. 그런데 「올리기」
 *  를 만들려면 서버가 있어야 하는데, 이 앱은 **정적 호스팅(GitHub Pages)** 에
 *  올라간다 — 배포된 앱이 파일을 써 넣을 자리가 없다.
 *
 *  그래서 방향을 뒤집었다. **올리는 길을 만들지 않고, 담아 두는 자리를 만든다.**
 *  도면을 `public/layouts/` 에 넣고 git push 하면 그대로 배포되고, 그 주소에
 *  들어온 사람은 누구나 목록에서 골라 쓴다. 새로 붙일 인프라가 하나도 없다.
 *
 *      public/layouts/index.json    목록 — [{ id, name, note, file }]
 *      public/layouts/*.json        도면 — 「내보내기」 가 만드는 그 파일 그대로
 *
 *  ── 목록을 왜 따로 두는가 ────────────────────────────────────────────────
 *  정적 호스팅에는 **디렉터리를 훑는 방법이 없다.** 폴더에 파일을 넣어도 앱은
 *  그 이름을 알 길이 없으므로, 무엇이 있는지 적은 종이가 한 장 있어야 한다.
 *  그 대신 목록에 설명을 적을 수 있어서 「무슨 도면인지」 를 이름 밖에서 말할
 *  수 있다 — 파일 이름에 다 넣으려 들면 이름이 문장이 된다.
 *
 *  ── 없는 것이 정상이다 ───────────────────────────────────────────────────
 *  갤러리를 안 쓰는 배포도 있다. 목록 파일이 없으면 **조용히 빈 목록**으로
 *  둔다 — 없는 것을 오류로 만들면 쓰지도 않는 기능이 화면에 경고를 띄운다.
 * ---------------------------------------------------------------------------
 */

/** 목록과 도면이 놓이는 자리. 앱이 어느 경로에 올라가도 따라가도록 상대 경로로 */
export const GALLERY_DIR = 'layouts';
export const GALLERY_INDEX = `${GALLERY_DIR}/index.json`;

/** 도면이라고 부를 만한가 — 최소한 놓인 것이 있어야 한다 */
export const looksLikeLayout = (d) =>
  !!d && typeof d === 'object' && (Array.isArray(d.placed) || Array.isArray(d.areas));

/**
 * 목록 한 줄을 온전하게 — 이름이 없으면 파일 이름으로 대신한다.
 *  @returns 못 쓸 줄이면 null (파일 이름조차 없는 것)
 */
export function normalizeEntry(row, i = 0) {
  const file = typeof row?.file === 'string' ? row.file.trim() : '';
  if (!file) return null;
  /* 목록이 바깥 주소를 가리키게 두면 이 배포가 남의 서버를 부르는 통로가 된다 */
  if (/^[a-z]+:|^\/\//i.test(file) || file.includes('..')) return null;
  return {
    id: typeof row.id === 'string' && row.id.trim() ? row.id.trim() : `L${i + 1}`,
    name: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : file.replace(/\.json$/i, ''),
    note: typeof row.note === 'string' ? row.note.trim() : '',
    file,
  };
}

export function normalizeIndex(json) {
  const rows = Array.isArray(json) ? json : json?.layouts;
  return (Array.isArray(rows) ? rows : []).map(normalizeEntry).filter(Boolean);
}

/**
 * 공용 도면 목록을 읽는다.
 *  @param fetchJson 주소 하나를 읽어 JSON 으로 — 검사에서 갈아 끼우는 자리다
 *  @returns 항상 배열. 목록이 없으면 빈 배열(갤러리를 안 쓰는 배포다)
 */
export async function loadGalleryIndex(fetchJson = defaultFetchJson) {
  try {
    return normalizeIndex(await fetchJson(GALLERY_INDEX));
  } catch {
    return [];
  }
}

/**
 * 목록의 한 줄을 실제 도면으로.
 *  @throws 읽지 못했거나 도면 모양이 아니면 — **여기서는 삼키지 않는다.**
 *          고른 것을 못 열었으면 사용자에게 말해야 한다(목록이 없는 것과 다르다).
 */
export async function loadGalleryLayout(entry, fetchJson = defaultFetchJson) {
  const e = normalizeEntry(entry);
  if (!e) throw new Error('도면 항목이 올바르지 않습니다');
  const data = await fetchJson(`${GALLERY_DIR}/${e.file}`);
  if (!looksLikeLayout(data)) throw new Error(`${e.name} 은 도면 파일이 아닙니다`);
  return data;
}

/** 기본 읽기 — 앱이 놓인 자리를 기준으로 상대 경로를 푼다 */
async function defaultFetchJson(path) {
  const url = new URL(path, document.baseURI).toString();
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path} — ${res.status}`);
  return res.json();
}
