/**
 * =============================================================================
 *  라이브러리 카탈로그
 * =============================================================================
 *  두 탭으로 나눈다.
 *    설비(equipment)   : 한 자리를 차지하고 회전만 하는 고정 오브젝트.
 *    연결장치(connector): 두 포트 사이를 잇고, 거리에 맞춰 길이가 "연장"되는 것.
 *
 *  이 구분이 핵심인 이유는 배치 방식 자체가 다르기 때문이다.
 *    설비   → 클릭 한 번 = 한 개 배치. 그리드/면 스냅.
 *    연결장치 → 시작 포트 클릭 → 끝 포트 클릭 = 경로 생성. 길이는 계산 결과.
 *
 *  ── 항목 스키마 ────────────────────────────────────────────────────────────
 *    id        고유 id
 *    name      표시 이름
 *    category  'equipment' | 'connector'
 *    modelKey  모델 캐시 키 (GLB URL 또는 'user:<id>')
 *    url       GLB 경로 (사용자 모델은 없음 — buffer 로 들어온다)
 *    render    연결장치 렌더 방식: 'tile'(모델 반복) | 'tube'(절차적 튜브)
 *    color     아이콘/절차적 렌더 색
 *    source    'builtin' | 'user'
 * ---------------------------------------------------------------------------
 */

export const CATEGORY = {
  EQUIPMENT: 'equipment',
  CONNECTOR: 'connector',
  /** 운송/적재 — 카트와 선반이 함께 들어간다.
      둘 다 "자재를 옮기고 쌓는" 물건이라 한 탭에 두지만, 놓는 방식은 다르다.
      그래서 항목마다 kind 로 갈라 도구를 고른다. */
  LOGISTICS: 'logistics',
};

export const CATEGORY_META = {
  equipment: { label: '설비', hint: '클릭해서 바닥에 배치합니다' },
  connector: { label: '연결장치', hint: '포트 → 포트로 이어 그립니다' },
  logistics: { label: '운송/적재', hint: '카트는 경로를, 선반은 자리를 정합니다' },
};

/** 운송/적재 탭 안의 세부 종류 */
export const KIND = { CART: 'cart', SHELF: 'shelf', TRUCK: 'truck', STILLAGE: 'stillage' };

/**
 * 반송물의 갈래 — 어느 설비가 만들 수 있는지를 정한다.
 *  아래 `BUILTIN_LIBRARY` 가 바로 쓰므로 그보다 위에 있어야 한다.
 */
/**
 * 반송물의 갈래.
 * ---------------------------------------------------------------------------
 *  `SCRAP` 은 **아무 설비도 만들기로 고를 수 없는** 갈래다. 불량은 만들려고
 *  만드는 것이 아니라 나오는 것이라, 산출물 목록에 두면 「불량품을 만드는 설비」
 *  라는 말이 안 되는 도면을 그릴 수 있게 된다(`allowedOutOf` 가 막는다).
 *
 *  대신 **재료로는 고를 수 있다** — 그게 재작업 설비다. 「불량품을 먹어 제작품
 *  1을 낸다」는 레시피 한 줄이면 검사 라우팅이 끝난다. 새 배관이 없다.
 */
export const FAMILY = { PART: 'PART', ASM: 'ASM', SCRAP: 'SCRAP' };

export const BUILTIN_LIBRARY = [
  {
    id: 'MACHINE_1',
    name: '제작기',
    desc: '2.83 × 4.63 × 3.92 m · 제작품을 만든다',
    category: CATEGORY.EQUIPMENT,
    modelKey: '/models/Machine_1.glb',
    url: '/models/Machine_1.glb',
    /**
     * 이 기계가 만들 수 있는 **갈래**. 제작기는 제작품만 낸다.
     * -----------------------------------------------------------------------
     *  갈래는 그 기계가 하는 일 자체라 자리마다 달라질 수 있는 값이 아니다 —
     *  조립기에게 "제작품을 만들라" 고 시킬 수 있으면 두 설비를 나눈 뜻이
     *  없어지고, 도면만 보고 어느 공정인지 읽을 수 없게 된다.
     *
     *  갈래 **안에서** 무엇을 만들지는 온전히 도면의 몫이다(`placed.recipe.out`).
     *  예전의 `payload` 는 그릴 때마다 되물어 사용자의 선택을 덮어썼지만, 이건
     *  고를 수 있는 것의 범위만 정한다 — 기본값이 아니라 **제약**이다.
     */
    makes: FAMILY.PART,
    /**
     * 한 개를 만드는 데 걸리는 시간(초). **자리마다 바꿀 수 있는 기본값**이다.
     * -----------------------------------------------------------------------
     *  조립이 제작보다 오래 걸리게 잡아 뒀다. 조립품 하나에 제작품 세 개가
     *  들어가므로(2+1), 6초짜리 제작기 세 대가 12초짜리 조립기 하나를 못 채운다 —
     *  놓아 보면 어디가 모자란지가 바로 보이는 숫자다.
     */
    cycleSec: 6,
    color: '#38bdf8',
    source: 'builtin',
  },
  {
    id: 'MACHINE_2',
    name: '조립기',
    /**
     * 유입구가 **둘**이다 (`PORT_IN@Z+1` · `PORT_IN@Z+2`, 둘 다 Z+ 면).
     * -----------------------------------------------------------------------
     *  조립은 여러 가지를 받아 하나를 만드는 일이라, 서로 다른 제작품을 나르는
     *  벨트 두 줄을 동시에 물릴 수 있어야 한다. 코드에는 손댈 것이 없었다 —
     *  포트는 처음부터 모델 노드 이름에서 읽고, 들어온 것은 종류별로 나뉜 입력
     *  버퍼에 쌓이므로(`slotShares`) 어느 구멍으로 왔는지는 상관이 없다.
     */
    desc: '3.44 × 4.00 × 4.19 m · 유입 2 · 유출 1 — 제작품 둘을 받아 조립한다',
    category: CATEGORY.EQUIPMENT,
    modelKey: '/models/Machine_2.glb',
    url: '/models/Machine_2.glb',
    makes: FAMILY.ASM,
    cycleSec: 12,
    color: '#38bdf8',
    source: 'builtin',
  },
  {
    id: 'CONVEYOR',
    name: '컨베이어 벨트',
    desc: '1.0 m 피치 · 폭 조절 · UV 구동',
    category: CATEGORY.CONNECTOR,
    modelKey: '/models/Conveyor.glb',
    url: '/models/Conveyor.glb',
    render: 'tile',
    /* 이 모델은 피치 1.000m · 폭 1.012m 로 거의 정사각형이라 bbox 로는 길이축을
       가릴 수 없다. 벨트 UV 로도 Z 가 나오지만, 기본 제공 항목이니 못 박아 둔다. */
    axis: 'z',
    color: '#f59e0b',
    source: 'builtin',
  },
  /* 모델이 없어도 되는 절차적 연결장치.
     전선·배관은 형상이 단순해서 튜브로 그리는 편이 가볍고, 곡선도 매끄럽다.

     utility:true — 자재가 흐르는 물건이 아니라 설비에 딸린 부속이다. 그래서
     컨베이어와 같은 유입/유출 포트를 쓰지 않고 자기 높이에 따로 놓인다.
     겹쳐도 층을 쌓지 않고(배관은 T·+ 로 만나는 게 정상) 서로 분기할 수 있다. */
  {
    id: 'CABLE',
    name: '전선 (케이블)',
    desc: 'Ø60mm · 처짐 · 상부 4.0m',
    category: CATEGORY.CONNECTOR,
    render: 'tube',
    utility: true,
    radius: 0.03,
    sag: 0.25,
    height: 4.0,
    color: '#fbbf24',
    source: 'builtin',
  },
  {
    id: 'PIPE',
    name: '배관 (파이프)',
    desc: 'Ø160mm · 강직 · 바닥 0.35m',
    category: CATEGORY.CONNECTOR,
    render: 'tube',
    utility: true,
    radius: 0.08,
    sag: 0,
    height: 0.35,
    color: '#94a3b8',
    source: 'builtin',
  },

  /* 카트 — 경로를 먼저 그리고 그 위를 순찰한다 */
  {
    id: 'CART',
    name: '이송 카트 (AGV)',
    desc: '1.37 × 2.15 m · 적재/하역',
    category: CATEGORY.LOGISTICS,
    kind: KIND.CART,
    modelKey: '/models/Cart.glb',
    url: '/models/Cart.glb',
    axis: 'z',
    color: '#a78bfa',
    source: 'builtin',
  },

  /* 트럭 — 카트와 같은 방식으로 경로를 그리지만 역할이 반대다.
     선반 출고 구역에서 싣고 **개구부를 지나 건물 밖으로 나가면 출하**된다.
     그래서 트럭 경로는 벽 밖까지 그려야 한다. */
  {
    id: 'TRUCK',
    name: '출하 트럭',
    desc: '선반에서 싣고 개구부로 반출',
    category: CATEGORY.LOGISTICS,
    kind: KIND.TRUCK,
    modelKey: '/models/Truck.glb',
    url: '/models/Truck.glb',
    axis: 'z',
    color: '#f59e0b',
    source: 'builtin',
  },

  /* 스틸리지 — 벨트의 **종점**. 컨베이어로 들어오기만 하고 나가지는 않는다.
     여기서 물자가 빠지는 길은 카트가 실어 가는 것 하나뿐이고, 가득 차면
     들어오는 벨트가 멈춘다(그리고 그 벨트를 먹이던 설비도 함께 선다). */
  {
    id: 'STILLAGE',
    name: '스틸리지 (적치대)',
    desc: '벨트 종점 · 카트만 반출',
    category: CATEGORY.LOGISTICS,
    kind: KIND.STILLAGE,
    modelKey: '/models/Stillage.glb',
    url: '/models/Stillage.glb',
    color: '#22d3ee',
    source: 'builtin',
  },

  /* 선반(랙) — 카트가 부린 자재를 쌓아 둔다.
     GLB 가 아직 없어도 절차적으로 그려서 바로 쓸 수 있다.
     public/models/Shelf.glb 를 넣으면 그때부터 그 모델을 한 칸씩 이어 붙인다.
     (optional: 파일이 없어도 조용히 넘어가라는 표시) */
  {
    id: 'SHELF',
    name: '선반 (랙)',
    desc: '길이 조절 · 3단 · 자재 적재',
    category: CATEGORY.LOGISTICS,
    kind: KIND.SHELF,
    modelKey: '/models/Shelf.glb',
    url: '/models/Shelf.glb',
    optional: true,
    color: '#34d399',
    source: 'builtin',
  },
];

/**
 * 반송물 모델 — 라이브러리에 넣지 않는다.
 *  사용자가 직접 배치하는 물건이 아니라, 설비가 내보내고 벨트가 실어 나르는
 *  "자재" 그 자체다. 컨베이어 위를 흐르는 것도, 카트에 실리는 것도 이 모델이다.
 *  (카트 GLB 안에도 같은 형상이 OBJ 노드로 들어 있어 카트는 그쪽을 자리로 쓴다)
 */
/**
 *  ── 두 갈래 · 여섯 종류 ──────────────────────────────────────────────────
 *  **제작품**(제작기가 원자재에서 깎아 낸다)과 **조립품**(조립기가 제작품을 붙여
 *  만든다). 갈래마다 셋이고, 갈래는 **형상**으로, 종류는 **색**으로 갈린다.
 *
 *      제작품 1·2·3   OBJ_1.glb    빨강 · 초록 · 파랑
 *      조립품 1·2·3   Assembly.glb 청록 · 자홍 · 노랑
 *
 *  형상과 색을 이렇게 나눈 것이 핵심이다. 벨트 위를 흐르는 것을 멀리서 봐도
 *  **모양만으로 어느 공정 뒤의 물건인지** 알 수 있고, 가까이 가면 색으로 어느
 *  갈래인지가 갈린다. 여섯 개를 전부 색으로만 갈랐다면 축소한 도면에서 구분이
 *  안 된다.
 *
 *  ── 모델은 셋이 아니라 하나씩이다 ────────────────────────────────────────
 *  갈래마다 GLB 는 **한 개**고, 색만 다른 사본을 셋 만든다. `modelKey` 가 URL 과
 *  다른 것이 그 장치다 — 키가 다르면 같은 파일이 한 번 더 읽혀 재질이 독립된
 *  사본이 생기고, 그래야 이쪽만 물들일 수 있다(modelStore 의 applyTint).
 *  물들이기는 **텍스처의 색을 먼저 없앤 뒤** 곱하므로, 밑바탕이 무슨 색이든
 *  (Assembly 의 텍스처는 노랗다) 고른 색 그대로 나온다.
 *
 *  ── 키를 바꾸지 말 것 ────────────────────────────────────────────────────
 *  키는 저장된 도면 안에 들어 있다 — 설비 레시피의 `in`·`out`, 카트의 `pickKind`.
 *  모델 파일을 바꿀 때는 **키는 그대로 두고 `url` 만** 바꾼다.
 *  (옛 이름 OBJ·OBJ2·OBJ3 은 아래 `KIND_ALIAS` 가 받아 준다)
 */
const PART_MODEL = '/models/OBJ_1.glb';
const ASM_MODEL = '/models/Assembly.glb';

/**
 * 색 견본은 **화면에 실제로 보이는 색**이다.
 *  물들이기가 텍스처를 평균 0.82 밝기의 회색으로 맞춘 뒤 곱하므로, 순색을 주면
 *  화면에는 그 0.82 배가 나온다(0xff × 0.82 ≈ 0xd1). 견본을 순색으로 찍어 두면
 *  목록이 화면보다 밝아 서로 다른 색으로 보인다.
 */
const shade = (r, g, b) => `#${[r, g, b].map((v) => (v ? 'd1' : '00')).join('')}`;

const payload = (key, name, family, model, tint, rgb) => ({
  id: `__${key}`,
  name,
  /** 어느 갈래인가 — 어떤 설비가 이걸 만들 수 있는지가 여기서 갈린다 */
  family,
  /* 캐시 키는 **표시 이름이 아니라 종류 키**에서 만든다. 이름은 언제든 바뀔 수
     있는 화면 문구이고, 캐시 키가 그걸 따라 흔들리면 이름을 고칠 때마다 같은
     모델을 한 벌씩 더 읽게 된다. */
  modelKey: `tint:${key}`,
  url: model,
  /* 조각난 프리미티브를 한 메시로 합쳐서 받는다 — 재질이 하나뿐이라 그림은
     그대로고 드로우콜만 조각 수만큼 줄어든다. 벨트 하나에 60개까지 올라가는
     모델이라 이 차이가 크다. 반송물에는 이름으로 찾는 노드가 없어 안전하다.
     (modelStore 의 mergeByMaterial) */
  merge: true,
  tint,
  color: shade(...rgb),
});

/** 만들 수 있는 것들 — 불량품은 여기서 파생된다(`scrapKinds`) */
const MAKEABLE = {
  PART_R: payload('PART_R', '제작품 1', FAMILY.PART, PART_MODEL, '#ff0000', [1, 0, 0]),
  PART_G: payload('PART_G', '제작품 2', FAMILY.PART, PART_MODEL, '#00ff00', [0, 1, 0]),
  PART_B: payload('PART_B', '제작품 3', FAMILY.PART, PART_MODEL, '#0000ff', [0, 0, 1]),
  ASM_C: payload('ASM_C', '조립품 1', FAMILY.ASM, ASM_MODEL, '#00ffff', [0, 1, 1]),
  ASM_M: payload('ASM_M', '조립품 2', FAMILY.ASM, ASM_MODEL, '#ff00ff', [1, 0, 1]),
  ASM_Y: payload('ASM_Y', '조립품 3', FAMILY.ASM, ASM_MODEL, '#ffff00', [1, 1, 0]),
};

/**
 * 품종마다 하나씩 만드는 **불량품 종류.**
 * ---------------------------------------------------------------------------
 *  모양은 원래 것과 같고(불량이라고 생김새가 바뀌지는 않는다) **색만 죽인다** —
 *  화면에서 「저건 불량이구나」가 바로 읽혀야 한다.
 *
 *  `PAYLOAD_ITEMS` 를 다 만든 뒤에 부르면 **TDZ 로 터진다**(초기화 중인 것을
 *  읽게 된다). 그래서 만들 수 있는 것들(`MAKEABLE`)을 먼저 세우고 여기서 판다.
 */
/**
 * 색을 죽인다 — 회색 쪽으로 절반 당긴다.
 *  **`tint` 에서 판다.** 만들어진 항목에는 `rgb` 가 안 남아 있다(`payload` 가
 *  `color` 로 바꿔 넣는다) — 그걸 읽으려다 불량품 여섯이 **전부 같은 색**이
 *  될 뻔했다. 되돌리기 테스트가 그 자리에서 터져 드러났다.
 */
const dullHex = (hex) => {
  const n = parseInt(String(hex).slice(1), 16);
  const mix = (v) => Math.round(v * 0.45 + 0x7a * 0.55);
  const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
  return { hex: `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`, rgb: [r / 255, g / 255, b / 255] };
};

const SCRAP_ITEMS = Object.fromEntries(
  Object.entries(MAKEABLE).map(([key, it]) => {
    const k = `SCRAP_${key}`;
    const c = dullHex(it.tint);
    /* `shade` 는 0/1 깃발을 받아 d1/00 으로 찍는다 — 죽인 색을 넣으면 세 칸이
       다 켜져서 **여섯이 전부 같은 회색**이 된다. 견본 색은 그냥 넣어 준다. */
    return [k, { ...payload(k, `불량품 (${it.name})`, FAMILY.SCRAP, it.url, c.hex, c.rgb), color: c.hex }];
  }),
);

export const PAYLOAD_ITEMS = {
  ...MAKEABLE,
  /**
   * 불량품 — **검사에서 걸러진 것.**
   *  설비가 「불량을 내보내기」로 잡혀 있을 때만 생긴다(기본은 버림이라 이미
   *  그린 도면에는 한 개도 안 나온다). 벨트로 빼내 재작업 설비에 먹이거나
   *  폐기 적치대에 쌓는다 — 그 길을 그리는 것이 검사 라우팅이다.
   *
   *  ── 갈래 없는 것 하나 + **품종마다 하나** ────────────────────────────────
   *  아래 `SCRAP` 은 **옛 도면**의 것이다. 처음에는 불량을 한 종류로 합쳤는데,
   *  그러면 「제작품 1 불량」과 「조립품 2 불량」이 같은 줄에 섞여 흘러서 재작업
   *  설비가 무엇을 고치는지 알 수가 없다 — 갈래로 가를 수도 없다.
   *
   *  그래서 품종마다 하나씩 둔다(`scrapKindOf`). **고르개가 길어지는 문제**는
   *  다른 데서 푼다 — 재료 고르개는 「이 도면에 실제로 나오는 불량품」만 보여
   *  준다. 불량을 안 내보내는 도면에는 한 줄도 안 는다.
   */
  SCRAP: payload('SCRAP', '불량품', FAMILY.SCRAP, PART_MODEL, '#7a7a7a', [0.48, 0.48, 0.48]),
  ...SCRAP_ITEMS,
};

/** 이 품종의 불량품 종류 이름 — 「제작품 1」 → 「불량품 (제작품 1)」 */
export const scrapKindOf = (kind) => (PAYLOAD_ITEMS[`SCRAP_${kind}`] ? `SCRAP_${kind}` : 'SCRAP');

/** 그 불량품이 원래 무엇이었나 — 갈래 없는 옛 불량품이면 null */
export const baseKindOf = (kind) => {
  const m = /^SCRAP_(.+)$/.exec(String(kind ?? ''));
  return m && PAYLOAD_ITEMS[m[1]] ? m[1] : null;
};

/**
 * 옛 이름 → 지금 이름.
 * ---------------------------------------------------------------------------
 *  종류를 여섯으로 다시 짜면서 키가 바뀌었다. 그런데 옛 키는 **이미 저장된 도면
 *  안에** 들어 있다(레시피의 `in`·`out`, 카트의 `pickKind`). 그대로 두면 도면을
 *  열었을 때 레시피가 조용히 비고, 설비가 이유 없이 굶는다 — 사용자에게는
 *  "고쳐 놨더니 라인이 안 돈다" 로만 보인다.
 *
 *  갈래가 맞는 쪽으로 옮긴다. 옛 반송물 둘은 제작품이었고, 옛 조립품은 조립품이다.
 */
const KIND_ALIAS = { OBJ: 'PART_R', OBJ2: 'PART_G', OBJ3: 'ASM_C' };

/** 아는 종류 이름으로 바꾼다 — 모르는 이름이면 null */
export const canonKind = (key) =>
  (PAYLOAD_ITEMS[key] ? key : KIND_ALIAS[key] ?? null);

/**
 * 종류를 알 수 없을 때 쓰는 이름.
 *  이름을 여기저기 문자열로 박아 두면, 목록에서 사라진 이름이 재고나 레시피에만
 *  남아 그리는 쪽이 아무것도 못 그리게 된다. 기준을 한 곳에 둔다.
 */
export const DEFAULT_KIND = 'PART_R';

/** 지정이 없을 때의 반송물 (선반 칸 너비를 재는 기준이기도 하다) */
export const PAYLOAD_ITEM = PAYLOAD_ITEMS[DEFAULT_KIND];

/** 종류 이름 → 반송물 항목. 모르는 이름이면 기본값. */
export const payloadByKey = (key) => PAYLOAD_ITEMS[canonKind(key)] ?? PAYLOAD_ITEM;

/**
 * 이 설비가 내보낼 수 있는 종류들.
 * ---------------------------------------------------------------------------
 *  **제작기는 제작품만, 조립기는 조립품만** 내보낸다. 갈래는 그 기계가 하는 일
 *  자체라 자리마다 달라질 수 있는 값이 아니다 — 조립기를 놓고 "제작품을 만들라"
 *  고 시킬 수 있으면 두 설비를 나눈 뜻이 없어지고, 도면만 보고 어느 공정인지
 *  읽을 수 없게 된다.
 *
 *  이건 **기본값이 아니라 제약**이다. 기본값(옛 `payload`)은 사용자가 고른 값을
 *  덮어써서 도면을 거짓말하게 만들었지만, 제약은 고를 수 있는 것의 범위를 정할
 *  뿐 그 안에서의 선택은 온전히 도면의 것이다.
 *
 *  `makes` 를 말하지 않은 항목(사용자가 올린 GLB)은 제약이 없다 — 무엇을 만드는
 *  기계인지 우리가 알 수 없으므로 단정하지 않는다.
 */
export const allowedOutOf = (item) => {
  /* 불량품은 **만들기로 고를 수 없다** — 나오는 것이지 만드는 것이 아니다 */
  const all = Object.keys(PAYLOAD_ITEMS).filter((k) => PAYLOAD_ITEMS[k].family !== FAMILY.SCRAP);
  if (!item?.makes) return all;
  const list = all.filter((k) => PAYLOAD_ITEMS[k].family === item.makes);
  return list.length ? list : all;
};

/** 불량품인가 — 만들 수는 없고 먹을 수만 있는 종류 */
export const isScrapKind = (kind) => PAYLOAD_ITEMS[kind]?.family === FAMILY.SCRAP;

/**
 * 이 설비를 놓을 때 레시피의 산출물로 심어 줄 종류 — 갈래의 첫 번째.
 *  **놓는 순간 한 번만** 쓰인다. 그 뒤로는 도면(`placed.recipe.out`)이 사실이고,
 *  라이브러리는 위의 갈래 제약으로만 관여한다.
 */
export const defaultOutOf = (item) => allowedOutOf(item)[0] ?? null;

/** 자재 반송용(컨베이어·레일)인가 — 포트 스냅·층 쌓기 대상 */
export const isMaterialConnector = (item) =>
  item?.category === CATEGORY.CONNECTOR && !item?.utility;

/** 부속 배선/배관인가 — 자기 높이에 따로 놓이고 겹쳐도 층을 쌓지 않는다 */
export const isUtility = (item) => item?.category === CATEGORY.CONNECTOR && !!item?.utility;

export const isCart = (item) => item?.kind === KIND.CART;
export const isTruck = (item) => item?.kind === KIND.TRUCK;
export const isStillage = (item) => item?.kind === KIND.STILLAGE;
/** 경로를 그려서 그 위를 달리는 것 — 카트와 트럭은 같은 방식으로 놓는다 */
export const isVehicle = (item) => isCart(item) || isTruck(item);
export const isShelf = (item) => item?.kind === KIND.SHELF;

/** 바닥에 클릭해서 놓는 물건인가 (설비 + 선반) */
export const isPlaceable = (item) =>
  item?.category === CATEGORY.EQUIPMENT || isShelf(item) || isStillage(item);

export const isConnector = (item) => item?.category === CATEGORY.CONNECTOR;

/** 사용자 GLB 를 라이브러리 항목으로 변환 */
export function userItem({ id, name, category, render, color, axis }) {
  return {
    id,
    name,
    category,
    modelKey: `user:${id}`,
    render: category === CATEGORY.CONNECTOR ? render ?? 'tile' : undefined,
    axis: category === CATEGORY.CONNECTOR ? axis ?? undefined : undefined,
    color: color ?? (category === CATEGORY.CONNECTOR ? '#f59e0b' : '#38bdf8'),
    source: 'user',
  };
}
