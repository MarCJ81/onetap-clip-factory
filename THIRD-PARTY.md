# 함께 쓰는 라이브러리 (vendored)

이 앱은 런타임에 CDN을 부르지 않습니다. 아래 파일을 `assets/vendor/`에 그대로 넣어 씁니다.

| 파일 | 프로젝트 | 라이선스 | 원본 |
|---|---|---|---|
| `mediabunny.min.mjs` (1.66.2) | Mediabunny — Vanilagy | MPL-2.0 | https://github.com/Vanilagy/mediabunny |
| `wavesurfer.min.js` | wavesurfer.js — katspaugh and contributors | BSD-3-Clause | https://github.com/katspaugh/wavesurfer.js |
| `jszip.min.js` | JSZip — Stuart Knightley, David Duponchel, Franz Buchinger, António Afonso | MIT (또는 GPLv3) | https://github.com/Stuk/jszip |
| `assets/fonts/plexkr-*.woff2` | IBM Plex Sans KR — IBM | SIL Open Font License 1.1 | https://github.com/IBM/plex |

## 고지

- **Mediabunny** — Mozilla Public License 2.0. 이 앱은 배포된 빌드를 수정하지 않고 사용합니다. MPL-2.0 전문은 위 저장소의 `LICENSE`에 있습니다.
- **wavesurfer.js** — BSD 3-Clause License. Copyright (c) 2012-2024 katspaugh and contributors. 재배포 시 저작권 고지와 라이선스 문구를 유지합니다.
- **JSZip** — MIT License. Copyright (c) 2009-2016 Stuart Knightley, David Duponchel, Franz Buchinger, António Afonso.
- **IBM Plex Sans KR** — SIL Open Font License 1.1.

전체 라이선스 문구가 필요하면 각 프로젝트 저장소의 `LICENSE` 파일을 확인하세요.
이 앱의 자체 코드(`core.js`·`media.js`·`render.js`·`demo.js`·`app.js`·`engines/pro-studio.js`)는 이 프로젝트에 속합니다.
Pro 커넥터(`engines/pro-api-connector.js`)와 무료 AI 클라이언트(`engines/free-ai.js`), V2 모듈(`engines/gemini-core.js`·`engines/blog-source.js`·`engines/tts.js`·`engines/bgm.js`)도 자체 코드입니다.

## 외부 서비스 (라이브러리가 아니라, 사용자가 버튼을 누를 때만 닿는 곳)

| 서비스 | 쓰임 | 언제 |
|---|---|---|
| `free-ai-taste.onetap-ai.workers.dev` | 무료 AI 맛보기(텍스트) | AI 버튼을 누를 때 |
| `generativelanguage.googleapis.com` | 내 Gemini 키로 텍스트 생성 | Gemini 키를 넣고 AI를 쓸 때 |
| `r.jina.ai` | 블로그 글 읽기 프록시 | URL 읽기를 누를 때 |
| `images.weserv.nl` | 블로그 사진 중계(CORS·캔버스 오염 방지) | 글 사진을 장면에 넣을 때 |
| `api.pexels.com` | 장면 사진 검색(무료 키) | Pexels로 찾기를 누를 때 |
| `api.fish.audio` (또는 사용자 프록시) | 성우 더빙 | Fish 모드로 더빙/렌더할 때 |

이 서비스들은 각자의 약관·개인정보 정책을 따릅니다. 앱은 이들에 영상·음성을 보내지 않습니다(텍스트·URL·이미지 주소만).
