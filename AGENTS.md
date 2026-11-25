# RPG Warrior Demo (`rpg-warrior-demo`)

- 시뮬레이션 코어: `/home/slalglel/rpg-engine` (`diablo-109b-engine`, Read-Only) 사용 — 엔진 파일 임의 수정 금지, 어댑터/확장은 본 저장소 내부에만 작성.
- 원화/UI 에셋 파이프라인: `concept-asset-studio` (`concept-asset` CLI/MCP, 로컬 CV 오프라인 분리·9패치·아틀라스) 사용.
- 2.5D 스튜디오/VFX/렌더 검증: `godot4-game-studio` (`RiggedActor2D`, `VfxDirector`, `render_verify.sh`) 및 `blender-character-studio` 규격 적용.
- 타겟: 모바일 가로모드 최적화 웹게임 (Vite + TypeScript + Canvas2D/WebGL 2.5D 리깅, GitHub Releases 단일 HTML/ZIP 및 Pages 배포).
