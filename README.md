# 전사의 성소 · RPG Engine 2.5D 데모 (`rpg-warrior-demo`)

`/home/slalglel/rpg-engine` (`diablo-109b-engine`) 엔진을 수정 없이 그대로 소비하여, **최소 공간(18×18 성소) + 단일 직업(전사 · `PC_WARRIOR`) + 최소 캐릭터 생성**으로 실제 게임이 어떻게 구동되는지 검증하는 모바일 가로모드 2.5D 웹 RPG 데모입니다.

## 주요 구성

- **코어 시뮬레이션 (`src/engine/warriorSession.ts`)**: `diablo-109b-engine` 20 Hz 틱 루프, `PlayerHooks` 전투/피격/방패 막기/드랍/상호작용, A* 길찾기(`CMD_WALKXY`), 근접 공격(`CMD_ATTACKID`), 강타(Power Cleave), 벨트 물약 소비.
- **2.5D 다관절 캐릭터 & 스튜디오 검증 (`godot_studio/`, `src/render/warriorRig2D.ts`)**: `전사.png` 원화에서 분리·알파 디프린징·인페인팅한 7파츠(망토/좌우 다리/몸통/검+오른팔/머리/방패+왼팔)를 Godot 4.7 `RiggedActor2D` 검증 후 Web Canvas2D 계층 스켈레톤으로 실시간 애니메이션 구현.
- **스토리북 2.5D 성소 렌더러 (`src/render/sanctumRenderer.ts`)**: 원화 풍의 따뜻한 세피아 잉크 + 셀 셰이딩을 반영한 3레이어 아이소메트릭 성소, 히트스톱, 감쇠 카메라 셰이크, HDR 가산 이펙트, 플로팅 데미지 & 컷인 배너.
- **모바일 가로모드 & 실시간 엔진 모니터 (`src/main.ts`)**: 가상 조이스틱 / 바닥 터치 / WASD 조작, `캐릭터/스탯`, `엔진 모니터`(`PlrMode`, 타일 좌표, `PlayerHooks` 카운터, 이벤트 로그) 제공.

## 바로 실행 / 다운로드

- **GitHub Releases**에서 `warrior-sanctum-standalone.html` 단일 파일을 내려받으면 별도 서버나 설치 없이 모바일/PC 브라우저에서 바로 열어 플레이할 수 있습니다.

## 로컬 빌드

```bash
npm install
npm run typecheck
npm test
npm run build        # dist/
npm run build:single # dist-single/index.html (오프라인 단일 파일)
```
