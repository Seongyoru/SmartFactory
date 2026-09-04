/**
 * =============================================================================
 *  따라 하기 — 갈래별 안내
 * =============================================================================
 *  처음에는 안내가 하나였다. 「바닥 → 설비 → 벨트 → 카트 → 출하」 한 줄. 그때는
 *  그것이 이 도구의 전부였으니 맞았다.
 *
 *  그 사이 공정 시간·레시피·인력·교대·고장·원가·오더·선반 줄·나눠 쓰기가 붙었다.
 *  **한 줄로 꿸 수 있는 양이 아니고, 꿸 필요도 없다** — 원가를 알고 싶은 사람이
 *  카트 경로부터 배울 이유가 없다. 그래서 갈래로 나눈다.
 *
 *  ── 내용이 **데이터**인 이유 ─────────────────────────────────────────────
 *  본문을 JSX 로 적으면 node 가 못 읽어 검증이 안 된다. 안내가 늘어날수록
 *  「없는 버튼을 가리키는 단계」 나 「영원히 안 끝나는 단계」 가 섞이기 쉬운데,
 *  그건 **화면을 띄우지 않고 잡을 수 있는 종류**다. 그래서 글은 문자열로 두고
 *  `**굵게**` 만 표시로 쓴다. 화면이 그것을 렌더한다.
 *
 *  ── `done` 은 도면을 본다 ───────────────────────────────────────────────
 *  「눌렀는가」 가 아니라 「이루어졌는가」다(`guideFacts.js`). 버튼을 셌더니
 *  「탭은 열었는데 아무 일도 안 일어난」 상태가 통과했고, 그러면 안내가 틀린
 *  것을 맞다고 말하게 된다.
 * ---------------------------------------------------------------------------
 */

/**
 * 갈래 하나.
 *   id     저장·복원에 쓰는 이름
 *   title  목록에 뜨는 이름
 *   blurb  한 줄 설명 — 「내가 궁금한 게 이건가」 를 가리는 자리
 *   need   먼저 갖춰야 하는 것 (없으면 잠기지는 않고 안내만 뜬다)
 *   steps  [{ id, title, body, spot, done }]
 *
 * `spot` 은 지금 눌러야 할 곳을 **손이 가는 순서대로** 적는다. 화면에 있는 첫
 * 번째를 가리키므로, 탭을 누르면 표시가 저절로 그 안의 항목으로 옮겨 간다 —
 * 탭만 계속 가리키면 「탭은 열었는데 이제 뭘?」 에서 다시 막힌다.
 */
export const GUIDES = [
  {
    id: 'basics',
    title: '도면 그리기',
    blurb: '바닥부터 출하까지 — 자재가 한 바퀴 도는 라인 한 벌',
    steps: [
      {
        id: 'area',
        title: '바닥 그리기',
        body: '**작업영역** 탭의 **영역**을 고르고 바닥을 끌어 그리세요. 테두리를 따라 벽이 저절로 섭니다.\n설비는 **바닥 위에만** 놓입니다 — 그래서 이것이 첫 단계입니다.',
        spot: ['[data-guide="tool-area"]', '[data-guide="tab-build"]'],
        done: (f) => f.areas > 0,
      },
      {
        id: 'machine',
        title: '설비 놓기',
        body: '**기계설비** 탭에서 **제작기**를 고르고 바닥을 클릭하세요.\n놓기 전 **R** 로 90° 돌릴 수 있습니다.',
        spot: ['[data-guide="item-MACHINE_1"]', '[data-guide="tab-equipment"]'],
        done: (f) => f.equip > 0,
      },
      {
        id: 'stillage',
        title: '쌓을 곳 놓기',
        body: '**운송적재** 탭의 **적치대**를 설비 옆에 놓으세요.\n만든 물건이 갈 곳이 없으면 설비는 곧 **막혀서 섭니다**.',
        spot: ['[data-guide="item-STILLAGE"]', '[data-guide="tab-logistics"]'],
        done: (f) => f.stillage > 0,
      },
      {
        id: 'belt',
        title: '컨베이어로 잇기',
        body: '**연결장치** 탭에서 **컨베이어**를 고르고, 설비의 **유출부**(주황)를 누른 뒤 적치대를 누르세요.\n벨트가 적치대에 닿아야 물건이 쌓이기 시작합니다.',
        spot: ['[data-guide="item-CONVEYOR"]', '[data-guide="tab-connector"]'],
        done: (f) => f.beltToStillage,
      },
      {
        id: 'shelf',
        title: '선반 놓기',
        body: '**운송적재** 탭의 **선반**을 조금 떨어진 곳에 놓으세요.\n적치대에 쌓인 것을 카트가 여기로 나릅니다. **[ ]** 로 길이를 바꿉니다.',
        spot: ['[data-guide="item-SHELF"]', '[data-guide="tab-logistics"]'],
        done: (f) => f.shelf > 0,
      },
      {
        id: 'cart',
        title: '카트 경로 그리기',
        body: '**운송적재** 탭의 **카트**를 고르고 바닥을 눌러 경유점을 찍으세요. **Enter** 로 끝냅니다.\n경로가 적치대와 선반의 **띠 위를 지나야** 정차역이 생깁니다 — 안 생기면 경로를 조금 붙여 보세요.',
        spot: ['[data-guide="item-CART"]', '[data-guide="tab-logistics"]'],
        done: (f) => f.cartLinked > 0,
      },
      {
        id: 'run',
        title: '돌려 보기',
        body: '위쪽 **▶** 를 누르고 배속을 올려 보세요. 벨트가 돌고 카트가 움직입니다.\n**Tab** 으로 3D 를 한 번 보고 오세요.',
        spot: ['[data-guide="view-iso"]'],
        /* 돈 시간(ranSec)은 못 쓴다 — 시뮬은 **기본으로 돌고 있어서** 페이지를
           연 순간부터 쌓인다. 아무것도 안 했는데 체크되면 안내가 아니다.
           3D 를 봤거나, 물건이 실제로 나갔거나 — 둘 다 사람이 한 일이다. */
        done: (f) => f.view === 'iso' || f.shipped > 0,
      },
    ],
  },

  {
    id: 'equip',
    title: '설비 다루기',
    blurb: '공정 시간 · 레시피 · 한 번에 몇 층 · 고장과 불량',
    need: '설비를 하나 놓고 **클릭해서 고른** 뒤에 진행하세요',
    steps: [
      {
        id: 'cycle',
        title: '공정 시간 정하기',
        body: '설비를 고르면 오른쪽에 **생산** 칸이 나옵니다. **만드는 시간(초/개)** 을 바꿔 보세요.\n이 값 하나가 그 설비의 능력을 정합니다 — 3초/개면 분당 20개입니다.',
        spot: ['[data-guide="panel-production"]'],
        done: (f) => f.cycleTuned,
      },
      {
        id: 'layers',
        title: '한 번에 몇 개씩 내보낼까',
        body: '**한 번에 나가는 층**을 올리면 여러 개를 한 덩어리로 내보냅니다.\n벨트 위 **간격은 자동으로** 정해집니다 — 만드는 시간과 층 수에서 나옵니다.',
        spot: ['[data-guide="panel-production"]'],
        done: (f) => f.layered,
      },
      {
        id: 'recipe',
        title: '재료를 먹는 설비 만들기',
        body: '**조립기**를 놓고 **만드는 것** 칸에서 재료를 고르세요. 유입부가 둘이라 두 가지를 받습니다.\n재료가 안 오면 설비는 **굶어서** 섭니다 — 막힌 것과 다른 상태입니다.',
        spot: ['[data-guide="panel-recipe"]', '[data-guide="item-MACHINE_2"]'],
        done: (f) => f.hasRecipe,
      },
      {
        id: 'fault',
        title: '고장과 불량 넣기',
        body: '**고장 · 불량** 칸에서 **평균 고장 간격(MTBF)** 이나 **불량률**을 올려 보세요.\n고장 시점은 지수분포로 뽑습니다 — 주기로 두면 여러 대가 박자를 맞춰 서 버립니다.',
        spot: ['[data-guide="panel-fault"]'],
        done: (f) => f.mtbfSet || f.scrapSet,
      },
    ],
  },

  {
    id: 'store',
    title: '쌓는 곳 다루기',
    blurb: '선반을 줄로 늘리고 종류별로 받기 · 적치대 수용량 정하기',
    need: '적치대나 선반을 놓고 **골라** 주세요',
    steps: [
      {
        id: 'shelfRows',
        title: '선반을 줄로 늘리기',
        body: '선반을 고르고 **줄** 칸에서 줄 수를 올려 보세요. 같은 랙이 뒤로 덧붙습니다.\n**앞면은 안 움직입니다** — 이미 그려 둔 카트 경로가 그대로 삽니다.',
        spot: ['[data-guide="panel-shelfrows"]'],
        need: '**선반**을 하나 골라 주세요 — 줄은 선반의 칸입니다',
        done: (f) => f.shelfRows,
      },
      {
        id: 'shelfSplit',
        title: '줄마다 받는 것 나누기',
        body: '줄마다 **받을 종류**를 정하면 그 줄에는 그것만 쌓입니다. 안 정하면 지금처럼 섞어 받습니다.\n종류를 갈라 두면 찾으러 가는 거리가 짧아집니다.',
        spot: ['[data-guide="panel-shelfrows"]'],
        need: '**선반**을 하나 골라 주세요 — 앞 걸음에서 줄을 늘려 두면 나뉩니다',
        done: (f) => f.shelfSplit,
      },
      {
        id: 'stillage',
        title: '적치대 수용량 정하기',
        body: '적치대를 고르고 **적재** 칸의 **최대 적재량**을 바꿔 보세요. 아래 **반출**에서 빈 차에 실어 보낼 수량도 정합니다.\n적치대는 **완충**이지 속도가 아닙니다 — 가득 찬다는 것은 「작다」가 아니라 **「비우는 쪽이 느리다」**는 뜻입니다.',
        spot: ['[data-guide="panel-stillage"]'],
        need: '이번에는 **적치대**를 골라 주세요 — 선반과는 다른 칸입니다',
        done: (f) => f.stillageTuned,
      },
    ],
  },

  {
    id: 'haul',
    title: '나르기',
    blurb: '카트 대수와 적재량 · 정차역 · 트럭으로 출하',
    need: '카트 경로를 하나 그려 두세요',
    steps: [
      {
        id: 'fleet',
        title: '카트 대수와 적재량',
        body: '카트 경로를 고르고 **대수**와 **한 번에 싣는 개수**를 올려 보세요.\n아래에 **수송 능력(개/분)** 이 바로 나옵니다 — 이 값이 라인 능력보다 낮으면 카트가 병목입니다.',
        spot: ['[data-guide="panel-cart"]'],
        done: (f) => f.cartFleet > 1,
      },
      {
        id: 'roles',
        title: '어디서 싣고 어디에 내릴지 정하기',
        body: '**정차역** 칸에서 선반마다 **싣기 / 내리기**를 눌러 바꿉니다.\n경로를 그릴 때 가까운 쪽으로 이미 정해 두었으니, 한쪽만 남지 않게만 보면 됩니다 — 싣기만 있으면 내려놓을 데가 없어 나르는 양이 0 이 됩니다.',
        spot: ['[data-guide="panel-cart"]'],
        done: (f) => f.cartRoles,
      },
      {
        id: 'truck',
        title: '트럭으로 내보내기',
        body: '**운송적재** 탭의 **트럭**을 놓고, 벽에 **개구부**를 뚫어 밖으로 나가는 경로를 그리세요.\n트럭이 실어 낸 것이 **출하 누계**가 됩니다 — 오더의 완료 지점이기도 합니다.',
        spot: ['[data-guide="item-TRUCK"]', '[data-guide="tab-logistics"]'],
        done: (f) => f.truckLinked > 0,
      },
    ],
  },

  {
    id: 'crew',
    title: '인력 · 교대',
    blurb: '설비에 몇 명이 붙나 · 교대조를 짜면 무엇이 달라지나',
    steps: [
      {
        id: 'crewNeed',
        title: '설비에 사람 붙이기',
        body: '설비를 고르고 **작업자** 칸에서 인원을 올리세요.\n사람이 모자라면 그 설비는 **무인**으로 섭니다 — 배치를 고쳐도 안 풀리는 유일한 정지 이유입니다.',
        spot: ['[data-guide="panel-crew"]'],
        need: '설비를 하나 **골라** 주세요 — 고른 설비의 칸입니다',
        done: (f) => f.crewNeed > 0,
      },
      {
        id: 'shift',
        title: '교대조 짜기',
        body: '오른쪽 **인력** 칸에서 조의 길이와 정원을 정하세요. **+ 조 추가** 로 2교대·3교대를 만듭니다.\n인원 **0** 은 사람이 없다는 뜻이 아니라 **인력을 안 따진다**는 뜻입니다.',
        spot: ['[data-guide="panel-shifts"]'],
        /* 앞 걸음과 **반대**다 — 고른 것이 있으면 그 상세가 자리를 차지한다 */
        need: '빈 바닥을 눌러 **선택을 풀면** 오른쪽에 인력 칸이 나옵니다',
        done: (f) => f.shiftsStaffed,
      },
    ],
  },

  {
    id: 'cost',
    title: '원가 보기',
    blurb: '단가를 내 숫자로 · 개당 원가와 놀면서 타는 돈',
    steps: [
      {
        id: 'rates',
        title: '단가를 자기 숫자로',
        body: '아래 띠의 **원가** 탭에서 **전기**와 **인건비**를 바꾸세요. 슬라이더로도, **직접 적어서도** 됩니다.\n기본값 그대로면 그 공장의 원가가 아닙니다 — 화면이 그 사실을 밝힙니다.',
        spot: ['[data-guide="dock-cost"]'],
        done: (f) => f.ratesTuned,
      },
      {
        id: 'material',
        title: '자재비 넣기',
        body: '**원가** 탭의 **자재비**에 개당 재료비를 적으세요.\n모르면 0으로 두고 **가공비만** 봐도 됩니다 — 배치끼리 견주는 데는 그걸로 충분합니다.',
        spot: ['[data-guide="dock-cost"]'],
        done: (f) => f.materialSet,
      },
      {
        id: 'power',
        title: '설비 전력 정하기',
        body: '설비를 고르고 **전력 · 고정비** 칸에서 **가동 kW** 와 **서 있을 때 kW** 를 나눠 정하세요.\n한 값만 쓰면 서 있는 설비가 공짜가 되고, 그러면 **잔뜩 깔고 놀리는 배치가 원가에서 이깁니다**.',
        spot: ['[data-guide="panel-power"]'],
        need: '설비를 하나 **골라** 주세요 — 고른 설비의 칸입니다',
        done: (f) => f.powerTuned,
      },
    ],
  },

  {
    id: 'plan',
    title: '계획과 결과',
    blurb: '오더·납기를 걸고 돌린 뒤 보고서로 꺼내기',
    steps: [
      {
        id: 'order',
        title: '생산 오더 걸기',
        body: '왼쪽 아래 **생산 오더**에서 **+ 오더 추가** 를 누르고 종류와 수량을 정하세요.\n완료 지점을 **출하**로 둘지 **저장소 통과**로 둘지 고를 수 있습니다.',
        spot: ['[data-guide="dock-orders"]'],
        done: (f) => f.orders > 0,
      },
      {
        id: 'due',
        title: '납기 정하기',
        body: '오더에 **납기(분)** 를 적으면 예상 완료 시각과 견주어 **여유/초과**가 나옵니다.\n속도는 앞 20초를 버리고 잽니다 — 라인이 차기 전 속도로 예측하면 터무니없어집니다.',
        spot: ['[data-guide="dock-orders"]'],
        done: (f) => f.ordersDue > 0,
      },
      {
        id: 'report',
        title: '보고서 꺼내기',
        body: '조금 돌린 뒤 아래 띠 **실행** 탭의 **보고서** 를 누르세요. 브라우저로 열어 **Ctrl+P** 하면 PDF 가 됩니다.\n엑셀에서 다시 따지려면 옆의 **CSV** 입니다.',
        spot: ['[data-guide="dock-report"]'],
        /* 안 돌렸으면 버튼이 아예 없다(ReportButtons 의 ran<=0 조기 반환) —
           가리킬 것이 없는 이유를 말해 주지 않으면 고장으로 읽힌다 */
        need: '먼저 ▶ 로 돌려 **물건이 밖으로 나가야** 합니다 — 트럭과 개구부가 있어야 보고서에 적을 것이 생깁니다',
        /* 버튼을 눌렀는지는 도면으로 알 수 없다. 대신 **꺼낼 것이 생겼는지**를 본다 —
           물건이 하나라도 나가야 보고서에 적을 것이 있다 */
        done: (f) => f.shipped > 0,
      },
    ],
  },

  {
    id: 'share',
    title: '나눠 쓰기',
    blurb: '도면을 파일로 꺼내기 · 공용 도면 열기 · 남에게 건네기',
    steps: [
      {
        id: 'export',
        title: '파일로 꺼내 두기',
        body: '위쪽 **내보내기** 를 누르면 JSON 파일이 받아집니다.\n이 브라우저를 지워도 남는 **유일한 사본**입니다 — 중요한 도면은 꼭 꺼내 두세요.',
        spot: ['[data-guide="btn-export"]'],
        done: () => false,
        optional: true,
      },
      {
        id: 'gallery',
        title: '공용 도면 열어 보기',
        body: '**공용 도면** 을 누르면 올라와 있는 도면이 뜹니다. 고르면 오른쪽에 **속**이 펼쳐집니다.\n여는 순간 지금 도면이 덮이므로, 그 자리에서 **먼저 내보내기** 를 할 수 있습니다.',
        spot: ['[data-guide="btn-gallery"]'],
        done: () => false,
        optional: true,
      },
      {
        /* 예전에는 「올리면 링크가 나온다」 고 가르쳤다. 지금 배포에는 그 서버가
           없어서 **가르친 대로 하면 안 된다** — 안내가 거짓말을 하면 안내가
           아니라 함정이다. 실제로 되는 길을 가르친다.
           짚는 자리도 「공유」 에서 「내보내기」 로 옮겼다. 보기 전용에서는
           공유 단추가 아예 안 그려지는데, 안내는 그것을 찾다 멈춰 버린다. */
        id: 'upload',
        title: '남에게 건네기',
        body: '이 배포에는 올리는 서버가 없습니다. **내보내기** 로 받은 JSON 파일을 그대로 보내면,\n받은 사람이 **불러오기** 로 엽니다.\n여럿이 두고 볼 도면이면 저장소의 public/layouts/ 에 넣어 **공용 도면**으로 올리세요.',
        spot: ['[data-guide="btn-export"]'],
        done: () => false,
        optional: true,
      },
    ],
  },
];

export const guideById = (id) => GUIDES.find((g) => g.id === id) ?? null;

/**
 * 그 갈래를 얼마나 했는가.
 *  **해 볼 수만 있는 단계(`optional`)는 분모에서 뺀다** — 「내보내기를 눌렀는가」
 *  는 도면을 봐서 알 수 없으므로, 세면 영원히 안 끝나는 갈래가 된다.
 */
export function guideProgress(guide, facts) {
  const steps = (guide?.steps ?? []).filter((s) => !s.optional);
  const done = steps.filter((s) => s.done(facts)).length;
  return { done, total: steps.length, ratio: steps.length ? done / steps.length : 1 };
}

/** 아직 안 끝난 첫 단계 — 여기서 이어서 한다. 다 했으면 -1 */
export function nextStep(guide, facts) {
  return (guide?.steps ?? []).findIndex((s) => !s.optional && !s.done(facts));
}
