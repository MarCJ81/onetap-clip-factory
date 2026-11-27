# onetap-fish-proxy

29호기 **원탭 클립 팩토리**가 브라우저에서 Fish Audio TTS(`https://api.fish.audio/v1/tts`)를
부를 때 CORS 로 막히는 문제를 푸는 **무료 Cloudflare Worker** 입니다.

- 운영 주소(앱 기본값): `https://onetap-fish-proxy.onetap-ai.workers.dev`
- 앱의 `engines/tts.js` `DEFAULT_PROXY` 값과 같습니다. 주소 칸에서 다른 프록시로 바꿀 수 있습니다.

## 무엇을 하나

| 요청 | 동작 |
|---|---|
| `GET /` 또는 `/health` | 배포 확인용 상태 JSON |
| `OPTIONS *` | CORS 프리플라이트 204 (허용 출처만) |
| `POST /v1/tts`(또는 `/`) | `https://api.fish.audio/v1/tts` 로 `Authorization`·`model`·본문을 그대로 넘기고, 오디오 응답에 CORS 헤더를 붙여 스트리밍 |

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
```
