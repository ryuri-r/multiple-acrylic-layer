# Multiple Acrylic Layer

투명 PNG 이미지를 아크릴 면으로 쌓아 3D로 확인하는 정적 웹 앱입니다.

## 주요 기능

- 1면으로 시작해 최대 20면까지 추가
- 여러 이미지를 한 번에 선택하면 빈 면을 채우고 필요한 면을 자동 생성
- 빈 면을 먼저 추가한 뒤 각 면에 이미지를 개별 업로드 가능
- 면별 PNG, WEBP, JPG 업로드
- 왼쪽, 오른쪽, 위쪽, 아래쪽 옆면을 선택적으로 추가
- 전면 레이어 전체 깊이에 맞춰 옆면 길이 자동 계산
- 드래그 순서 변경, 표시/숨김, 삭제
- 아크릴 크기, 두께, 면 간격, 분리 보기 조절
- 정면, 입체, 측면 시점
- 현재 3D 화면 PNG 저장
- Y축 좌우 왕복 또는 360° 회전 GIF 저장
- 업로드 이미지는 서버로 전송하지 않고 브라우저 안에서 처리

기본 GIF 모드는 전면 인쇄와 옆면이 자연스럽게 보이는 `Y축 좌우 왕복`입니다.

## 로컬 실행

ES Module을 사용하므로 파일을 직접 더블클릭하지 말고 로컬 서버로 실행합니다.

```powershell
node serve.mjs
```

또는 VS Code Live Server를 사용할 수 있습니다.

## GitHub Pages 배포

1. 이 폴더의 파일을 GitHub 저장소 루트에 업로드합니다.
2. 저장소 `Settings > Pages`로 이동합니다.
3. `Deploy from a branch`를 선택합니다.
4. 배포 브랜치의 `/ (root)`를 선택합니다.

별도 빌드 과정은 필요하지 않습니다.

## 파일 구조

```text
index.html
styles.css
app.js
vendor/
  three.module.js
  OrbitControls.js
```
