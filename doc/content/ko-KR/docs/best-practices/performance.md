---
title: "성능"
description: "큰 body를 스트리밍하고, 큐에 한도를 두고, failover를 신중히 고르며, 정책을 바꾸기 전에 측정합니다."
---

## 큰 body 스트리밍 [#streaming]

버퍼링하지 않아야 하는 body에는 `ReadableStream`을 보내고, 소비자가 청크를 처리할 수 있다면 큰 응답을 스트림으로 읽으세요. JSON body는 보내기 전에 전부 구체화해야 하지만, 큰 업로드는 그럴 필요가 없어요.

`onUploadProgress`와 `onDownloadProgress`는 Fetch 경계를 지나는 바이트를 관찰해요. 서버가 body를 받아들였거나 처리했다는 약속이 아니에요. 흐름 제어가 아니라 사용자 피드백에 쓰세요.

## 커질 수 있는 것에 한도 두기 [#bounds]

WebSocket 세션에는 `maxIncomingQueueSize`, SSE에는 `maxBufferSize` / `maxQueueSize`를 설정하세요. 한도는 애플리케이션 백프레셔 정책의 일부예요. 느린 소비자가 빨리 실패할지, 생산자에 압력을 가할지 정해요. 프로덕션이 쓰는 것과 같은 한도로 넘침 경로를 테스트하세요.

## failover를 의도적으로 선택 [#failover]

`withEndpointFailover`는 설정한 정책에서만 실패한 시도를 재시도해요. 시도 예산과 재시도 예산은 작게 유지하고, 서비스가 다시 보낼 수 없는 비멱등 요청을 반복하는 데 failover를 쓰지 마세요. 헬스 체크나 페널티는 실제로 쓰는 전송을 반영해야 해요.

## 튜닝 전에 측정 [#measure]

작업, 전송, 소비자를 따로 측정하세요. 너무 짧은 타임아웃은 네트워크 실패처럼 보이고, 너무 작은 큐는 버스트를 fault로 만들어요. 버퍼, 타임아웃, 재시도 횟수를 바꾸기 전에 기존 텔레메트리 hook과 부하를 재현하는 픽스처를 쓰세요.
