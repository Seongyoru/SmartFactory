/**
 * =============================================================================
 *  도면 썸네일 — 위에서 본 미니맵 (SVG)
 * =============================================================================
 *  공유 목록에서 「어느 도면인지」 를 이름만으로 가리기는 어렵다. 그림이 한 장
 *  있으면 한눈에 갈린다.
 *
 *  ── 왜 3D 화면을 캡처하지 않는가 ─────────────────────────────────────────
 *  캔버스 캡처는 **그 순간 그려져 있어야** 한다. 탑뷰였는지 3D였는지, 어디를
 *  보고 있었는지, 창이 가려져 있지는 않았는지에 따라 결과가 달라지고, 아예
 *  검게 나오기도 한다(WebGL 은 preserveDrawingBuffer 없이는 다음 프레임에
 *  버퍼를 비운다). 무엇보다 **값으로 검증할 수가 없다.**
 *
 *  도면 데이터로 직접 그리면 그 셋이 다 사라진다 — 언제 부르든 같은 그림이
 *  나오고, 순수 함수라 node 로 확인할 수 있고, 서버에서도 그릴 수 있다.
 *
 *  ── 왜 SVG 인가 ──────────────────────────────────────────────────────────
 *  글자열 하나라 만들기도 검사하기도 쉽고, 같은 그림이 PNG 보다 훨씬 작다
 *  (도면 하나에 1~3KB). `<img>` 안에서는 스크립트가 안 도므로 남이 올린 것을
 *  띄워도 안전하다.
 * ---------------------------------------------------------------------------
 */

/** 그림 크기 — 목록 카드에 들어가는 비율 */
export const THUMB_W = 320;
export const THUMB_H = 180;
/** 도면이 테두리에 닿지 않게 두는 여백(픽셀) */
const PAD = 8;

/** 설비 하나를 그릴 크기(m) — 진짜 치수는 모델에 있지만 썸네일에는 과하다 */
const EQUIP = 2.2;

const num = (v) => (Number.isFinite(v) ? v : null);

/** 도면에 들어 있는 모든 점 — 바닥·벽·설비·경로 */
function* points(d) {
  for (const a of d?.areas ?? []) {
    for (const poly of a.mp ?? []) for (const ring of poly ?? []) for (const p of ring ?? []) yield p;
  }
  for (const w of d?.walls ?? []) { if (w.a) yield w.a; if (w.b) yield w.b; }
  for (const p of d?.placed ?? []) if (p.pos) yield p.pos;
  for (const p of d?.pillars ?? []) if (p.pos) yield p.pos;
  for (const c of d?.carts ?? []) for (const p of c.points ?? []) yield p;
}

/**
 * 도면이 차지하는 네모.
 *  @returns null — 그릴 것이 하나도 없으면. 「빈 도면」과 「못 그렸다」를 가른다
 */
export function layoutBounds(d) {
  let minX = Infinity; let minZ = Infinity; let maxX = -Infinity; let maxZ = -Infinity;
  for (const p of points(d)) {
    const x = num(p?.[0]); const z = num(p?.[1]);
    if (x == null || z == null) continue;
    if (x < minX) minX = x;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (z > maxZ) maxZ = z;
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minZ, maxX, maxZ };
}

/**
 * 도면 좌표 → 그림 좌표로 옮기는 자.
 *  가로세로 **같은 배율**을 쓴다 — 따로 늘리면 정사각 설비가 직사각이 되고
 *  「좁고 긴 라인」과 「넓적한 라인」이 구별되지 않는다. 남는 쪽은 가운데로 민다.
 */
export function fitTransform(b, w = THUMB_W, h = THUMB_H, pad = PAD) {
  if (!b) return null;
  const dx = Math.max(1e-6, b.maxX - b.minX);
  const dz = Math.max(1e-6, b.maxZ - b.minZ);
  const s = Math.min((w - pad * 2) / dx, (h - pad * 2) / dz);
  return {
    s,
    ox: (w - dx * s) / 2 - b.minX * s,
    oz: (h - dz * s) / 2 - b.minZ * s,
    at: (x, z) => [x * s + (w - dx * s) / 2 - b.minX * s, z * s + (h - dz * s) / 2 - b.minZ * s],
  };
}

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n1 = (v) => (Math.round(v * 10) / 10).toString();

/**
 * 도면 한 장을 미니맵 SVG 로.
 *  겹치는 순서가 곧 읽는 순서다 — 바닥 → 구역 → 경로 → 벨트 → 기둥 → 설비.
 *  설비가 맨 위여야 「무엇이 어디에 있는가」 가 먼저 보인다.
 */
/**
 * @param o.labels   설비에 **번호**를 찍는다(이름이 아니다 — 아래 주석 참고)
 * @param o.scaleBar 축척 막대. 인쇄해서 볼 때만 뜻이 있다
 */
export function layoutThumbSVG(d, { w = THUMB_W, h = THUMB_H, labels = false, scaleBar = false } = {}) {
  const b = layoutBounds(d);
  const t = fitTransform(b, w, h);
  const body = [];

  if (t) {
    /* 바닥 — 도형이 여럿일 수 있고 구멍도 있을 수 있다(multipolygon) */
    for (const a of d.areas ?? []) {
      for (const poly of a.mp ?? []) {
        const path = (poly ?? [])
          .map((ring) => (ring ?? []).map((p, i) => `${i ? 'L' : 'M'}${(t.at(p[0], p[1])).map(n1).join(' ')}`).join('') + 'Z')
          .join('');
        if (path) body.push(`<path d="${path}" fill="#e2e8f0" stroke="#94a3b8" stroke-width="1" fill-rule="evenodd"/>`);
      }
    }
    for (const z of d.zones ?? []) {
      for (const poly of z.mp ?? []) {
        const path = (poly ?? [])
          .map((ring) => (ring ?? []).map((p, i) => `${i ? 'L' : 'M'}${(t.at(p[0], p[1])).map(n1).join(' ')}`).join('') + 'Z')
          .join('');
        if (path) body.push(`<path d="${path}" fill="${esc(z.color ?? '#38bdf8')}" fill-opacity=".18"/>`);
      }
    }

    /* 카트 경로 — 라인의 뼈대라 벨트보다 아래에 흐리게 */
    for (const c of d.carts ?? []) {
      const pts = (c.points ?? []).map((p) => t.at(p[0], p[1]).map(n1).join(',')).join(' ');
      if (pts) body.push(`<polyline points="${pts}" fill="none" stroke="#a78bfa" stroke-width="1.5" stroke-dasharray="3 2"/>`);
    }

    /* 벨트 — 설비 사이를 잇는다. 좌표는 설비 위치에서 가져온다 */
    const at = new Map((d.placed ?? []).filter((p) => p.pos).map((p) => [p.uid, p.pos]));
    for (const l of d.links ?? []) {
      const a = at.get(l.from?.uid); const c = at.get(l.to?.uid);
      if (!a || !c) continue;
      const [x1, y1] = t.at(a[0], a[1]);
      const [x2, y2] = t.at(c[0], c[1]);
      body.push(`<line x1="${n1(x1)}" y1="${n1(y1)}" x2="${n1(x2)}" y2="${n1(y2)}" stroke="#0ea5e9" stroke-width="2"/>`);
    }

    for (const p of d.pillars ?? []) {
      if (!p.pos) continue;
      const [x, y] = t.at(p.pos[0], p.pos[1]);
      body.push(`<rect x="${n1(x - 2)}" y="${n1(y - 2)}" width="4" height="4" fill="#64748b"/>`);
    }
    for (const wl of d.walls ?? []) {
      if (!wl.a || !wl.b) continue;
      const [x1, y1] = t.at(wl.a[0], wl.a[1]);
      const [x2, y2] = t.at(wl.b[0], wl.b[1]);
      body.push(`<line x1="${n1(x1)}" y1="${n1(y1)}" x2="${n1(x2)}" y2="${n1(y2)}" stroke="#475569" stroke-width="2"/>`);
    }

    /* 설비 — 맨 위. 「무엇이 어디에」 가 먼저 보여야 한다 */
    const side = Math.max(3, EQUIP * t.s);
    for (const p of d.placed ?? []) {
      if (!p.pos) continue;
      const [x, y] = t.at(p.pos[0], p.pos[1]);
      body.push(`<rect x="${n1(x - side / 2)}" y="${n1(y - side / 2)}" width="${n1(side)}" height="${n1(side)}" rx="1" fill="#1e293b"/>`);
    }

    /**
     * 번호 — **이름을 안 적는 이유가 있다.**
     * -----------------------------------------------------------------------
     *  이름을 그대로 얹으면 설비가 조금만 붙어 있어도 글자끼리 겹쳐 둘 다 못
     *  읽는다. 실제 평면도가 하는 대로 **번호만 찍고 옆에 범례**를 둔다 —
     *  보고서의 설비 목록이 같은 번호를 쓰므로 표와 그림이 서로를 가리킨다.
     */
    if (labels) {
      let n = 0;
      for (const p of d.placed ?? []) {
        if (!p.pos) continue;
        n += 1;
        const [x, y] = t.at(p.pos[0], p.pos[1]);
        body.push(
          `<text x="${n1(x)}" y="${n1(y)}" text-anchor="middle" dominant-baseline="central"`
          + ` font-size="${n1(Math.max(6, Math.min(11, side * 0.62)))}" font-weight="700"`
          + ` fill="#f8fafc" stroke="#1e293b" stroke-width="2.5" paint-order="stroke">${n}</text>`,
        );
      }
    }

    /* 축척 막대 — 인쇄물에서 「이게 몇 m 짜리 공장인가」 를 알 길이 이것뿐이다.
       1·2·5·10… 중 가로폭 1/4 을 안 넘는 가장 큰 눈금을 고른다 */
    if (scaleBar) {
      const want = (w - PAD * 2) / 4 / t.s;                    // 그만큼의 미터
      const pow = 10 ** Math.floor(Math.log10(Math.max(1e-6, want)));
      const m = [10, 5, 2, 1].map((k) => k * pow).find((v) => v <= want) ?? pow;
      const px = m * t.s;
      const x0 = PAD;
      const y0 = h - PAD / 2;
      body.push(
        `<line x1="${n1(x0)}" y1="${n1(y0)}" x2="${n1(x0 + px)}" y2="${n1(y0)}" stroke="#334155" stroke-width="1.5"/>`
        + `<line x1="${n1(x0)}" y1="${n1(y0 - 3)}" x2="${n1(x0)}" y2="${n1(y0 + 3)}" stroke="#334155" stroke-width="1.5"/>`
        + `<line x1="${n1(x0 + px)}" y1="${n1(y0 - 3)}" x2="${n1(x0 + px)}" y2="${n1(y0 + 3)}" stroke="#334155" stroke-width="1.5"/>`
        + `<text x="${n1(x0 + px + 5)}" y="${n1(y0)}" dominant-baseline="central" font-size="9" fill="#475569">${m} m</text>`,
      );
    }
  } else {
    body.push(`<text x="${w / 2}" y="${h / 2}" text-anchor="middle" dominant-baseline="middle" font-size="12" fill="#94a3b8">빈 도면</text>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`
    + `<rect width="${w}" height="${h}" fill="#f8fafc"/>${body.join('')}</svg>`;
}

/** 목록 카드에 적을 한 줄 — 「설비 26 · 연결 12 · 카트 3」 */
export function layoutSummary(d) {
  const bits = [
    [(d?.placed ?? []).length, '설비'],
    [(d?.links ?? []).length, '연결'],
    [(d?.carts ?? []).reduce((s, c) => s + (c.count ?? 1), 0), '차량'],
    [(d?.orders ?? []).length, '오더'],
  ].filter(([n]) => n > 0).map(([n, w]) => `${w} ${n}`);
  return bits.length ? bits.join(' · ') : '빈 도면';
}
