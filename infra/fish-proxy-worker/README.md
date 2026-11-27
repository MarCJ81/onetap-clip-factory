# onetap-fish-proxy

29호기 **원탭 클립 팩토리**의 **무료 음성 프록시** 입니다. 두 가지를 합니다.

1. `POST /v1/tts` — Fish Audio TTS(`https://api.fish.audio/v1/tts`) 중계 (내 키, CORS 해결)
2. `POST /v1/edge-tts` — **Microsoft Edge 신경망 성우 TTS (키 없이 무료)**

- 운영 주소(앱 기본값): `https://onetap-fish-proxy.onetap-ai.workers.dev`
- 앱의 `engines/tts.js` `DEFAULT_PROXY` 값과 같습니다. 주소 칸에서 다른 프록시로 바꿀 수 있습니다.

## 무엇을 하나

| 요청 | 동작 |
|---|---|
| `GET /` 또는 `/health` | 배포 확인용 상태 JSON |
| `OPTIONS *` | CORS 프리플라이트 204 (허용 출처만) |
| `POST /v1/tts`(또는 `/`) | `https://api.fish.audio/v1/tts` 로 `Authorization`·`model`·본문을 그대로 넘기고, 오디오 응답에 CORS 헤더를 붙여 스트리밍 |
| `POST /v1/edge-tts` | `{text, voice, rate, pitch, volume}` → `audio/mpeg` 스트림 (최대 2000자) |
| `GET /v1/edge-tts?text=…&voice=…` | 같은 합성을 URL 로 (미리듣기·curl 확인) |
| `GET /v1/edge-tts/voices` | 쓸 수 있는 성우 목록(9종) |

## Edge TTS 는 어떻게 붙나 (v1.2.0)

브라우저에서 `wss://speech.platform.bing.com/...` 로 직접 붙으면 마이크로소프트가 거절합니다(실측).
Workers 의 `new WebSocket()` 은 User-Agent 를 지정할 수 없어 403 이고, `fetch(wss://)` 는
`Fetch API cannot load` 로 실패합니다. 그래서 이 Worker 는:

1. `connect()` 로 `speech.platform.bing.com:443` 에 **TLS 소켓**을 열고
2. WebSocket 핸드셰이크를 **직접** 작성합니다 (Edge UA·Origin·Sec-WebSocket-Key 포함)
3. `Sec-MS-GEC v2` 토큰(`<CS64 16hex>-<SHA256 64hex>`)을 계산해 붙입니다
   — edge-tts 7.x 와 같은 상수·알고리즘이며, 같은 시각 입력에 같은 문자열이 나오는 것을 확인했습니다
4. 받은 WebSocket 프레임에서 `Path:audio` 만 골라 MP3 로 흘려보냅니다

성우: `ko-KR-SunHiNeural`(선히·여성), `ko-KR-InJoonNeural`(인준·남성),
`ko-KR-HyunsuMultilingualNeural`, `en-US-EmmaMultilingualNeural`, `en-US-AndrewMultilingualNeural`,
`en-US-AvaMultilingualNeural`, `en-US-BrianMultilingualNeural`, `ja-JP-NanamiNeural`, `zh-CN-XiaoxiaoNeural`.

## 원칙

- **키를 저장하지 않습니다.** 사용자가 브라우저에 넣은 Fish 키가 `Authorization: Bearer …` 헤더로
  이 워커를 지나 Fish Audio 로 갈 뿐이고, 서버(Worker)에는 아무 값도 남지 않습니다.
- **열린 프록시가 아닙니다.** `x-fish-target` 을 보내도 `https://api.fish.audio/v1/tts` 하나만 허용하고,
  나머지는 400 `bad_target` 으로 거절합니다. 본문은 64KB 까지.
- **허용 출처만** 받습니다: `https://marcj81.github.io`, `http://localhost:*`, `http://127.0.0.1:*`,
  `null`(file://). 그 밖의 출처는 프리플라이트 403 · POST 403.

## 직접 배포하기

```bash
cd infra/fish-proxy-worker
npx wrangler deploy          # 무료 플랜, 결제 정보 필요 없음
```

배포 후 나온 `https://<이름>.<서브도메인>.workers.dev` 를 앱의 프록시 주소 칸에 넣으면 됩니다.
출처를 바꾸려면 `worker.js` 의 `ALLOWED_ORIGINS` 를 고치고 다시 배포하세요.

## 확인 방법

```bash
U=https://onetap-fish-proxy.onetap-ai.workers.dev
curl -s -i -X OPTIONS "$U/v1/tts" -H "Origin: https://marcj81.github.io" \
  -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: authorization,model,x-fish-target"
# → 204 + access-control-allow-origin: https://marcj81.github.io

curl -s -i -X POST "$U/v1/tts" -H "Origin: https://marcj81.github.io" \
  -H "Authorization: Bearer <내 Fish 키>" -H "model: s2.1-pro-free" -H "Content-Type: application/json" \
  -d '{"text":"안녕하세요","format":"mp3"}' --output out.mp3
# → 200 + audio/mpeg (키가 틀리면 Fish Audio 의 401 이 CORS 오류 없이 그대로 온다)

curl -s -X POST "$U/v1/edge-tts" -H "Origin: https://marcj81.github.io" \
  -H "Content-Type: application/json" \
  -d '{"text":"안녕하세요. 무료 성우입니다.","voice":"ko-KR-SunHiNeural"}' --output edge.mp3
# → 200 + audio/mpeg (첫 4바이트가 FF F3 … 이면 정상 MP3)

curl -s "$U/v1/edge-tts/voices" -H "Origin: https://marcj81.github.io"
```
