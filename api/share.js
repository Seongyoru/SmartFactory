/**
 * =============================================================================
 *  도면 올리기 — 링크 하나로 서로 테스트
 * =============================================================================
 *  갤러리(`public/layouts/`)는 **내가 담아 두고 남이 쓰는** 길이라, 올리려면
 *  저장소 권한과 git push 가 필요하다. 서로 주고받으며 테스트하려면 앱 안에서
 *  바로 올라가야 한다 — 그게 여기다.
 *
 *      POST /api/share   도면(JSON) → { id, url }
 *      GET  /api/share?id=…   그 도면을 돌려준다
 *
 *  ── 왜 프록시로 돌려주는가 ───────────────────────────────────────────────
 *  Blob 이 주는 공개 주소는 저장소마다 호스트가 달라서 앱이 짐작할 수 없다.
 *  그래서 **짧고 안 변하는 주소**(`?share=<id>`)를 앱이 쓰게 하고, 실제 위치는
 *  이 함수만 안다. 저장소를 나중에 갈아도 링크가 안 죽는다.
 *
 *  ── 안 붙였으면 안 붙였다고 말한다 ───────────────────────────────────────
 *  Blob 저장소를 연결하지 않으면 `BLOB_READ_WRITE_TOKEN` 이 없다. 그때 500 을
 *  뱉으면 「고장」 처럼 보이므로, **501 로 「아직 안 켰다」** 고 분명히 말한다.
 *  화면은 그 말을 그대로 사용자에게 옮긴다.
 *
 *  ── 누가 올릴 수 있나 ────────────────────────────────────────────────────
 *  **인증이 없다.** 주소를 아는 사람은 누구나 올릴 수 있고, 올라간 것은 링크를
 *  가진 사람 누구나 본다. 사내 도면을 다루게 되면 이 문 앞에 자물쇠부터 달아야
 *  한다(로그인 · 또는 사내망에서만 열리는 배포).
 * ---------------------------------------------------------------------------
 */

/** 도면 하나가 이보다 크면 받지 않는다 — 실수로 다른 파일을 올리는 것을 막는다 */
const MAX_BYTES = 2 * 1024 * 1024;
/** 링크에 들어갈 id — 짧고, 헷갈리는 글자(0/O, 1/l)를 뺀다 */
const ALPHABET = '23456789abcdefghijkmnpqrstuvwxyz';
const ID_LEN = 10;

const newId = () => {
  const r = new Uint8Array(ID_LEN);
  crypto.getRandomValues(r);
  return [...r].map((n) => ALPHABET[n % ALPHABET.length]).join('');
};

/** 도면이라고 부를 만한가 — 최소한 놓인 것이 있어야 한다 (gallery.js 와 같은 잣대) */
const looksLikeLayout = (d) =>
  !!d && typeof d === 'object' && (Array.isArray(d.placed) || Array.isArray(d.areas));

const json = (res, code, body) => {
  res.statusCode = code;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
};

export default async function handler(req, res) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return json(res, 501, {
      error: '공유 저장소가 아직 연결되지 않았습니다',
      how: 'Vercel 프로젝트 → Storage → Blob 을 만들면 BLOB_READ_WRITE_TOKEN 이 자동으로 들어갑니다',
    });
  }

  /* 패키지가 없으면 배포가 통째로 죽지 않도록 여기서만 불러온다 */
  let put;
  try {
    ({ put } = await import('@vercel/blob'));
  } catch {
    return json(res, 501, {
      error: '@vercel/blob 이 설치되지 않았습니다',
      how: 'npm i @vercel/blob 뒤 다시 배포하세요',
    });
  }

  if (req.method === 'GET') {
    const id = String(req.query?.id ?? '').trim();
    if (!/^[a-z0-9]{4,32}$/.test(id)) return json(res, 400, { error: 'id 가 올바르지 않습니다' });
    const { list } = await import('@vercel/blob');
    const found = await list({ prefix: `shares/${id}.json`, limit: 1 });
    const hit = found.blobs?.[0];
    if (!hit) return json(res, 404, { error: '그런 도면이 없습니다 — 링크가 만료됐거나 지워졌습니다' });
    const r = await fetch(hit.url, { cache: 'no-store' });
    if (!r.ok) return json(res, 502, { error: '도면을 가져오지 못했습니다' });
    /* 링크를 눌러 여는 길이라 잠깐 캐시해도 된다 — 같은 id 는 안 바뀐다 */
    res.setHeader('cache-control', 'public, max-age=300');
    return json(res, 200, await r.json());
  }

  if (req.method !== 'POST') {
    res.setHeader('allow', 'GET, POST');
    return json(res, 405, { error: 'GET 또는 POST 만 받습니다' });
  }

  const data = typeof req.body === 'string' ? safeParse(req.body) : req.body;
  if (!looksLikeLayout(data)) return json(res, 400, { error: '도면 파일이 아닙니다' });

  const text = JSON.stringify(data);
  if (text.length > MAX_BYTES) {
    return json(res, 413, { error: `도면이 너무 큽니다 (${Math.round(text.length / 1024)}KB · 한도 ${MAX_BYTES / 1024}KB)` });
  }

  const id = newId();
  /* addRandomSuffix 를 끄면 경로가 id 그대로라 나중에 찾기 쉽다 */
  await put(`shares/${id}.json`, text, {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    token,
  });
  return json(res, 200, { id });
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}
