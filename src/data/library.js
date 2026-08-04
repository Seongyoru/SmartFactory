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
  CART: 'cart',
};

export const CATEGORY_META = {
  equipment: { label: '설비', hint: '클릭해서 바닥에 배치합니다' },
  connector: { label: '연결장치', hint: '포트 → 포트로 이어 그립니다' },
  cart: { label: '카트', hint: '순찰 경로를 찍어 그립니다' },
};

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
    category: CATEGORY.CART,
    modelKey: '/models/Cart.glb',
    url: '/models/Cart.glb',
    axis: 'z',
    color: '#a78bfa',
    source: 'builtin',
  },
];

/**
 * 반송물 모델 — 라이브러리에 넣지 않는다.
 *  사용자가 직접 배치하는 물건이 아니라, 설비가 내보내고 벨트가 실어 나르는
 *  "자재" 그 자체다. 컨베이어 위를 흐르는 것도, 카트에 실리는 것도 이 모델이다.
 *  (카트 GLB 안에도 같은 형상이 OBJ 노드로 들어 있어 카트는 그쪽을 쓴다)
 */
export const PAYLOAD_ITEM = {
  id: '__PAYLOAD',
  name: '반송물',
  modelKey: '/models/OBJ.glb',
  url: '/models/OBJ.glb',
};

/** 자재 반송용(컨베이어·레일)인가 — 포트 스냅·층 쌓기 대상 */
export const isMaterialConnector = (item) =>
  item?.category === CATEGORY.CONNECTOR && !item?.utility;

/** 부속 배선/배관인가 — 자기 높이에 따로 놓이고 겹쳐도 층을 쌓지 않는다 */
export const isUtility = (item) => item?.category === CATEGORY.CONNECTOR && !!item?.utility;

export const isCart = (item) => item?.category === CATEGORY.CART;

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
