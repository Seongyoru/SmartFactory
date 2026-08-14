/**
 * =============================================================================
 *  도면 올리기 — 올리면 **공용 목록에 들어간다**
 * =============================================================================
 *  처음에는 링크만 돌려줬다. 그러면 링크를 받은 사람만 열 수 있고, 링크를 잃으면
 *  그 도면은 있어도 없는 것이 된다. 올린 것이 **목록에 남아야** 나중에 온 사람도
 *  「무엇이 올라와 있나」 를 보고 고를 수 있다.
 *
 *      POST /api/share          도면 → { id, url }   · 목록에도 같이 넣는다
 *      GET  /api/share?id=…     그 도면
 *      GET  /api/share?list=1   목록 — [{ id, name, at, size, thumb }]
 *
 *  ── 왜 목록 파일을 따로 두는가 ───────────────────────────────────────────
 *  `list()` 로 훑으면 이름과 크기와 시각은 나오지만 **이름과 썸네일이 없다.**
 *  그렇다고 목록을 열 때마다 도면을 전부 내려받아 이름을 캐면, 도면 하나가
 *  18KB 인데 스무 개면 360KB 를 매번 읽는 셈이다.
 *
 *  그래서 카드에 필요한 것만 모은 `index.json` 을 따로 쓴다. 목록을 여는 값은
 *  **파일 하나 읽기**로 끝나고, 썸네일은 공개 주소라 브라우저가 CDN 에서 직접
 *  받아 간다(함수를 안 거친다).
 *
 *  ── 목록이 깨지면 다시 세운다 ────────────────────────────────────────────
 *  두 사람이 같은 순간에 올리면 목록이 서로를 덮을 수 있다. 그때를 위해 목록이
 *  없거나 못 읽으면 `list()` 로 **다시 세운다** — 이름과 썸네일은 잃지만 도면이
 *  목록에서 사라지지는 않는다. 있는 것이 안 보이는 쪽이 더 나쁘다.
 *
 *  ── 누가 올릴 수 있나 ────────────────────────────────────────────────────
 *  **인증이 없다.** 주소를 아는 사람은 누구나 올리고, 올라간 것은 누구나 본다.
 *  사내 도면을 다루게 되면 이 문 앞에 자물쇠부터 달아야 한다.
 * ---------------------------------------------------------------------------
 */

/**
 * 썸네일 그리기는 **필요할 때 불러온다.**
 *  `src/` 는 앱 쪽 코드라, 함수 번들이 그것을 못 물어오면 맨 위 import 로는
 *  **함수가 통째로 안 뜬다.** 그러면 그림 하나 때문에 공유가 전부 죽는다.
 *  여기서 불러오면 최악이 「썸네일 없는 공유」 로 끝난다.
 */
async function drawing() {
  try {
    return await import('../src/core/thumb.js');
  } catch (e) {
    console.error('[share] 썸네일 모듈을 못 불러왔다', e);
    return null;
  }
}

/** 도면 하나가 이보다 크면 받지 않는다 — 실수로 다른 파일을 올리는 것을 막는다 */
const MAX_BYTES = 2 * 1024 * 1024;
/** 목록에 남기는 최대 개수 — 오래된 것부터 목록에서 빠진다(파일은 남는다) */
const MAX_INDEX = 200;
/** 링크에 들어갈 id — 짧고, 헷갈리는 글자(0/O, 1/l)를 뺀다 */
const ALPHABET = '23456789abcdefghijkmnpqrstuvwxyz';
const ID_LEN = 10;
const ID_RE = /^[a-z0-9]{4,32}$/;

const SHARES = 'shares';
const THUMBS = 'thumbs';
const INDEX = 'index.json';

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

/** 이름은 사용자가 적는다 — 길이를 자르고 줄바꿈을 없앤다 */
const cleanName = (v, fallback) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return s || fallback;
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
  let blob;
  try {
    blob = await import('@vercel/blob');
  } catch {
    return json(res, 501, {
      error: '@vercel/blob 이 설치되지 않았습니다',
      how: 'npm i @vercel/blob 뒤 다시 배포하세요',
    });
  }
  const { list, put } = blob;

  const findUrl = async (path) => (await list({ prefix: path, limit: 1, token })).blobs?.[0]?.url ?? null;
  const readJson = async (path) => {
    const url = await findUrl(path);
    if (!url) return null;
    const r = await fetch(url, { cache: 'no-store' });
    return r.ok ? r.json() : null;
  };

  if (req.method === 'GET') {
    /* ---- 목록 ---- */
    if (req.query?.list != null) {
      let rows = await readJson(INDEX).catch(() => null);
      if (!Array.isArray(rows)) {
        /* 목록이 없거나 깨졌다 — 파일에서 다시 세운다. 이름·썸네일은 못 살리지만
           **도면이 목록에서 사라지는 것**보다는 낫다. */
        const found = await list({ prefix: `${SHARES}/`, limit: MAX_INDEX, token });
        rows = (found.blobs ?? []).map((b) => ({
          id: b.pathname.replace(`${SHARES}/`, '').replace(/\.json$/, ''),
          name: '(이름 없음)',
          at: Date.parse(b.uploadedAt) || Date.now(),
          size: b.size ?? 0,
          thumb: null,
        }));
      }
      res.setHeader('cache-control', 'public, max-age=30');
      return json(res, 200, { layouts: rows.filter((r) => ID_RE.test(r?.id ?? '')) });
    }

    /* ---- 도면 하나 ---- */
    const id = String(req.query?.id ?? '').trim();
    if (!ID_RE.test(id)) return json(res, 400, { error: 'id 가 올바르지 않습니다' });
    const data = await readJson(`${SHARES}/${id}.json`);
    if (!data) return json(res, 404, { error: '그런 도면이 없습니다 — 링크가 만료됐거나 지워졌습니다' });
    res.setHeader('cache-control', 'public, max-age=300');
    return json(res, 200, data);
  }

  if (req.method !== 'POST') {
    res.setHeader('allow', 'GET, POST');
    return json(res, 405, { error: 'GET 또는 POST 만 받습니다' });
  }

  /* ---- 올리기 ----
     본문은 { name, layout } 또는 도면 그대로. 뒤엣것은 예전 판이 보내던 모양이라
     계속 받는다 — 올리는 쪽이 먼저 배포되는 경우가 있다. */
  const body = typeof req.body === 'string' ? safeParse(req.body) : req.body;
  const data = looksLikeLayout(body?.layout) ? body.layout : body;
  if (!looksLikeLayout(data)) return json(res, 400, { error: '도면 파일이 아닙니다' });

  const text = JSON.stringify(data);
  if (text.length > MAX_BYTES) {
    return json(res, 413, { error: `도면이 너무 큽니다 (${Math.round(text.length / 1024)}KB · 한도 ${MAX_BYTES / 1024}KB)` });
  }

  const id = newId();
  const name = cleanName(body?.name, `도면 ${new Date().toLocaleDateString('ko-KR')}`);

  /* addRandomSuffix 를 끄면 경로가 id 그대로라 나중에 찾기 쉽다 */
  await put(`${SHARES}/${id}.json`, text, {
    access: 'public', contentType: 'application/json', addRandomSuffix: false, token,
  });

  /* 썸네일 — 도면 데이터로 그린다(화면 캡처가 아니라). 실패해도 올리기는 살린다 */
  const draw = await drawing();
  let thumb = null;
  let summary = '';
  try {
    if (draw) {
      summary = draw.layoutSummary(data);
      const up = await put(`${THUMBS}/${id}.svg`, draw.layoutThumbSVG(data), {
        access: 'public', contentType: 'image/svg+xml', addRandomSuffix: false, token,
      });
      thumb = up.url;
    }
  } catch (e) {
    console.error('[share] 썸네일 실패', e);
  }

  /* 목록에 앞에 끼운다 — 새것이 위로 */
  try {
    const rows = (await readJson(INDEX).catch(() => null)) ?? [];
    const next = [
      { id, name, at: Date.now(), size: text.length, thumb, summary },
      ...(Array.isArray(rows) ? rows : []),
    ].slice(0, MAX_INDEX);
    await put(INDEX, JSON.stringify(next), {
      access: 'public', contentType: 'application/json', addRandomSuffix: false, token,
    });
  } catch (e) {
    /* 목록에 못 넣어도 도면은 올라갔다 — 링크는 살아 있으므로 실패로 치지 않는다 */
    console.error('[share] 목록 갱신 실패', e);
  }

  return json(res, 200, { id });
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}
