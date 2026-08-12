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

export const BUILTIN_LIBRARY = [
  {
    id: 'MACHINE_1',
    name: 'Machine 1',
    desc: '2.83 × 4.63 × 3.92 m · 포트 2',
    category: CATEGORY.EQUIPMENT,
    modelKey: '/models/Machine_1.glb',
    url: '/models/Machine_1.glb',
    color: '#38bdf8',
    source: 'builtin',
  },
  {
    id: 'MACHINE_2',
    name: 'Machine 2',
    category: CATEGORY.EQUIPMENT,
    modelKey: '/models/Machine_2.glb',
    url: '/models/Machine_2.glb',
    /** 이 설비가 사출하는 반송물 (PAYLOAD_ITEMS 의 키) */
    payload: 'OBJ2',
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
 *  (카트 GLB 안에도 같은 형상이 OBJ 노드로 들어 있어 카트는 그쪽을 쓴다)
 */
/**
 *  ── 모델 파일을 바꿀 때 ──────────────────────────────────────────────────
 *  **키(OBJ · OBJ2)는 그대로 두고 경로만 바꾼다.** 이 키는 저장된 도면 안에
 *  들어 있다 — 적치대·선반의 재고가 자리마다 종류를 이 이름으로 기억하고
 *  (simStore 의 lots), 설비 항목의 `payload` 도 이 이름을 가리킨다. 키를 바꾸면
 *  옛 도면을 열었을 때 재고의 종류를 알아볼 수 없게 된다.
 */
export const PAYLOAD_ITEMS = {
  OBJ: {
    id: '__PAYLOAD',
    name: '반송물',
    /* 2026-08-11 OBJ.glb(3.2 MB · 892면) → OBJ_1.glb(23 KB · 76면).
       바닥에 놓이는 물건이라 화면에 수십 개가 동시에 뜬다 — 면과 텍스처를
       줄인 쪽이 눈에 띄게 가볍다. 치수는 0.65 × 0.30 × 0.65 m 로 거의 같다. */
    modelKey: '/models/OBJ_1.glb',
    url: '/models/OBJ_1.glb',
    /* 조각(프리미티브) 6개를 한 메시로 합쳐서 받는다 — 재질이 하나뿐이라
       그림은 그대로고 드로우콜만 1/6 이 된다. 벨트 하나에 60개까지 올라가는
       모델이라 이 차이가 크다. 반송물에는 이름으로 찾는 노드가 없어 안전하다.
       (modelStore 의 mergeByMaterial) */
    merge: true,
    /* 목록에 찍는 색 견본 — 모델 텍스처의 평균색에 맞춰 둔다.
       모델을 바꾸면 이 값도 같이 손봐야 화면과 목록이 어긋나지 않는다.
       (새 텍스처를 디코드해 실제로 잰 값 — 옛 모델은 #4f5558 이었다) */
    color: '#999999',
  },
  OBJ2: {
    id: '__PAYLOAD2',
    name: '반송물 2',
    /* 2026-08-11 OBJ2.glb(8.5 MB) → OBJ_2.glb(24 KB) */
    modelKey: '/models/OBJ_2.glb',
    url: '/models/OBJ_2.glb',
    merge: true,
    color: '#dddf22',
  },
  /**
   * 조립품 — **모델이 아니라 색이 다르다.**
   * -------------------------------------------------------------------------
   *  조립(BOM)이 뜻을 가지려면 "A + B → C" 의 C 가 A·B 와 구분되어야 한다.
   *  그런데 모델러가 준 반송물은 둘뿐이다. 종류 하나를 늘리자고 모델을 새로
   *  그리라고 할 일은 아니라서, 회색 반송물을 **물들여** 세 번째로 쓴다.
   *
   *  `modelKey` 가 URL 과 다른 것이 핵심이다 — 키가 다르면 같은 파일이 한 번 더
   *  읽혀 재질이 독립된 사본이 생기고, 그래야 이쪽만 물들일 수 있다
   *  (modelStore 의 applyTint). 밑바탕이 밝은 회색인 OBJ_1 을 쓰는 것도 이유가
   *  있다 — 색은 텍스처에 곱해지므로 노란 모델을 물들이면 탁해진다.
   *
   *  진짜 조립품 모델이 생기면 `url` 만 그 파일로 바꾸고 `tint` 를 지우면 된다.
   *  **키(OBJ3)는 그대로 두어야** 이미 그린 도면의 레시피가 살아남는다.
   */
  OBJ3: {
    id: '__PAYLOAD3',
    name: '조립품',
    modelKey: 'tint:OBJ3',
    url: '/models/OBJ_1.glb',
    merge: true,
    tint: '#f43f5e',
    color: '#f43f5e',
  },
};

/** 지정이 없을 때의 반송물 */
export const PAYLOAD_ITEM = PAYLOAD_ITEMS.OBJ;

/**
 * 이 설비가 내보내는 반송물.
 *  설비마다 만들어 내는 물건이 다르므로 라이브러리 항목이 `payload` 로 고른다.
 *  없으면 기본 반송물 — 기존 설비들은 손대지 않아도 그대로 동작한다.
 */
export const payloadOf = (item) => PAYLOAD_ITEMS[item?.payload] ?? PAYLOAD_ITEM;

/** 재고에 함께 적어 둘 종류 이름 (simStore 가 개수와 같이 들고 다닌다) */
export const payloadKeyOf = (item) => (PAYLOAD_ITEMS[item?.payload] ? item.payload : 'OBJ');

/** 종류 이름 → 반송물 항목. 모르는 이름이면 기본값. */
export const payloadByKey = (key) => PAYLOAD_ITEMS[key] ?? PAYLOAD_ITEM;

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
