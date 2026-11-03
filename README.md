# @yylee/hthomeservice

Hyundai HT HomeService 웹 API의 인증, 기기 조회·제어, 상태 캐시를 제공하는 Node.js용 TypeScript 라이브러리입니다.

## 실행 환경과 설치

- Node.js `^22.13.0 || ^24.0.0 || ^26.0.0`
- ESM 전용. `import`로 사용하며 TypeScript 타입 선언을 제공합니다.
- Apache-2.0 라이선스

```sh
npm install @yylee/hthomeservice@0.1.0
```

## 빠른 시작

```js
import { HTWebService, HTDeviceStore, statusOn } from "@yylee/hthomeservice";

const username = process.env.HT_USERNAME;
const password = process.env.HT_PASSWORD;
if (!username || !password) {
  throw new Error("HT_USERNAME과 HT_PASSWORD를 지정하세요.");
}

const client = new HTWebService(username, password, console);
const store = new HTDeviceStore(client);

try {
  const response = await client.getDevices({ deviceType: "light" });
  const light = response.data.deviceList[0];
  if (light) {
    const current = await store.read("light", light.id);
    console.log("전원:", statusOn(current));

    // 실제 전원을 켜려면 호출합니다.
    // await store.write("light", light.id, [{ command: "power", value: "on" }]);
  }
} finally {
  client.close();
}
```

로그인은 첫 요청 시 자동 수행하며 쿠키는 인스턴스의 메모리에만 저장합니다. 세대는 `isApproved === true`인 첫 번째 항목을 사용하고, 해당 항목이 없으면 전체 목록의 첫 번째 항목을 사용합니다. 목록이 비어 있으면 인증에 실패합니다.

장기 실행 프로그램은 같은 클라이언트와 store를 재사용합니다. 종료 시 `close()`로 세션 갱신 타이머를 해제하고 진행 중인 HTTP 요청을 취소합니다.

세션 만료 시 자동으로 다시 로그인합니다. 동시 요청은 진행 중인 인증을 함께 기다립니다. 조회 중 401 응답을 받으면 재인증 후 재시도하지만, 제어 PUT은 자동 재전송하지 않습니다. 인증 실패 후에는 30초간 재시도를 제한합니다.

## HTWebService

HTTP 통신과 인증을 담당하며 `HTDeviceApi`를 구현합니다.

```ts
new HTWebService(username, password, logger, options?)
```

`logger`는 `HTLogger`의 `debug`, `info`, `warn` 메서드를 제공해야 합니다. `console`을 사용할 수 있습니다.

| HTWebServiceOptions | 기본값                           | 설명                                   |
| ------------------- | -------------------------------- | -------------------------------------- |
| `baseUrl`           | `https://www2.hthomeservice.com` | 테스트 서버 또는 호환 서버의 기본 주소 |
| `requestTimeoutMs`  | `10000`                          | 개별 HTTP 요청 제한 시간(ms)           |

### 공통 API

| 메서드                                  | 반환값                                | 설명                                                 |
| --------------------------------------- | ------------------------------------- | ---------------------------------------------------- |
| `getDevices(query?)`                    | `Promise<HTDevicesResponse>`          | 기기 목록. `data.deviceList`, `data.totalCount` 제공 |
| `getDeviceProperties()`                 | `Promise<HTDevicePropertiesResponse>` | 기기 종류별 속성 메타데이터                          |
| `getDeviceState(type, id)`              | `Promise<HTDeviceStateResponse<T>>`   | 개별 상태. `data.statusList` 제공                    |
| `putDeviceCommands(type, id, commands)` | `Promise<HTDeviceStateResponse<T>>`   | 명령을 순서대로 전송하고 마지막 응답 반환            |
| `close()`                               | `void`                                | 타이머 해제·요청 취소. 이후 HTTP 요청 불가           |

`getDevices()`의 query는 `HTDeviceQuery`입니다. `includeStatus: true`에는 `deviceType`이 필요합니다. 미지원 기기는 목록과 메타데이터에서 제외합니다. `totalCount`는 서버 원본 값이므로 반환된 `deviceList.length`와 다를 수 있습니다.

```ts
interface HTDeviceQuery {
  deviceType?: HTDeviceType;
  includeStatus?: boolean;
}
```

명령은 `{ command: string, value: string }` 형태의 `HTStatus` 배열입니다.

```js
await client.putDeviceCommands("fan", fanId, [
  { command: "power", value: "on" },
  { command: "wind", value: "mid" },
]);
```

각 명령은 별도의 PUT으로 전송하며, 중간에 실패하면 나머지는 전송하지 않습니다. 앞서 성공한 명령은 되돌리지 않으며 PUT은 자동 재시도하지 않습니다. 로그인 요청도 자동 재시도하지 않습니다. 조회는 재시도될 수 있어 호출 전체 시간은 개별 요청 제한 시간을 넘을 수 있습니다.

### 기기별 편의 API

`id`는 기기 ID 문자열, 전원 인수는 boolean, 온도는 number입니다. 아래 메서드는 해당 기기의 `HTDeviceStateResponse`를 Promise로 반환합니다. 난방·에어컨 API는 추후 지원 예정 기능입니다.

| 종류           | 조회                      | 제어                                                                                                                       |
| -------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `light`        | `getLightState(id)`       | `putLightPower(id, power)`                                                                                                 |
| `fan`          | `getFanState(id)`         | `putFanPower(id, power)`, `putFanWind(id, wind)`                                                                           |
| `heating`      | `getHeaterState(id)`      | `putHeaterPower(id, power)`, `putHeaterTemperature(id, temperature)`                                                       |
| `aircon`       | `getAirconState(id)`      | `putAirconPower(id, power)`, `putAirconTemperature(id, temperature)`, `putAirconMode(id, mode)`, `putAirconWind(id, wind)` |
| `wallsocket`   | `getWallSocketState(id)`  | `putWallSocketPower(id, power)`                                                                                            |
| `multi_switch` | `getMultiSwitchState(id)` | `putMultiSwitchLightsOut(id, lightsOut)`                                                                                   |
| `gas`          | `getGasState(id)`         | `putGasClose(id)`                                                                                                          |

### 기기별 지원·검증 현황

2026-11-03 기준입니다. ✅ 확인 완료

| 기기                    | 조회 | 제어 | 사용할 수 있는 기능                 |
| ----------------------- | :--: | :--: | ----------------------------------- |
| 조명 `light`            |  ✅  |  ✅  | 켜기·끄기                           |
| 환기 `fan`              |  ✅  |  ✅  | 켜기·끄기, 약·중·강 풍량 설정       |
| 콘센트 `wallsocket`     |  ✅  |  ✅  | 전원 공급·차단                      |
| 일괄소등 `multi_switch` |  ✅  |  ✅  | 모든 조명 끄기, 소등 전 상태로 복원 |
| 가스 `gas`              |  ✅  |  ✅  | 밸브 닫기                           |

✅는 확인한 기기와 동작 범위에 한정됩니다.

- 콘센트는 월패드의 수동 차단 모드에서 원격 제어가 적용되지 않을 수 있습니다. 소비전력은 단위와 갱신 주기가 확인되지 않았습니다.
- 가스 밸브는 원격으로 닫기만 가능합니다. 다시 열려면 현장에서 조작해야 합니다.

#### 추후 지원 예정

- **난방 `heating`**: 켜기·끄기, 목표 온도 설정
- **에어컨 `aircon`**: 켜기·끄기, 목표 온도·운전 모드·풍량 설정

관련 API는 구현되어 있으나, 실기기 제어 검증 후 정식 지원할 예정입니다.

### 허용 명령

| 종류                                                              | command          | value                                                    |
| ----------------------------------------------------------------- | ---------------- | -------------------------------------------------------- |
| `light`, `fan`, `heating`, `aircon`, `wallsocket`, `multi_switch` | `power`          | `on`, `off`                                              |
| `gas`                                                             | `power`          | `off` (닫기만 지원)                                      |
| `fan`, `aircon`                                                   | `wind`           | `light`, `mid`, `pow` (`HTWind`)                         |
| `heating`, `aircon`                                               | `setTemperature` | 5~40 사이 정수의 문자열                                  |
| `aircon`                                                          | `mode`           | `auto`, `cool`, `dehumidify`, `airwash` (`HTAirconMode`) |

`putMultiSwitchLightsOut(id, true)`는 `power: on`으로 일괄소등을 활성화하고, `false`는 `power: off`로 해제하여 소등 전 조명 상태를 복원합니다. 조회는 `statusOn(response.data, "light")`로 일괄소등 상태를 읽습니다. 일괄스위치를 통한 가스 제어는 제공하지 않습니다.

`putGasClose(id)`는 `power: off`로 가스 밸브를 닫습니다. 가스 밸브의 `power`와 일괄스위치의 `gas`는 `on`이면 열림, `off`이면 닫힘입니다. 현장에서 수동으로 연 상태도 조회에 반영됩니다. 일괄스위치의 가스 상태는 `statusOn(response.data, "gas")`로 읽을 수 있습니다.

가스 밸브 열기·자동 차단 설정·환기 자동 모드 등 확인되지 않은 제어 명령은 제공하지 않습니다.

## HTDeviceStore

기기 종류별 조회 공유·캐시와 동일 기기의 제어 직렬화를 제공합니다.

```ts
new HTDeviceStore(api: HTDeviceApi, ttlMs = 5000)
```

| 메서드                      | 반환값                            | 설명                                                        |
| --------------------------- | --------------------------------- | ----------------------------------------------------------- |
| `read(type, id)`            | `Promise<HTDevice>`               | 종류별 상태 포함 목록을 공유해 기기 조회                    |
| `write(type, id, commands)` | `Promise<HTDevice>`               | 동일 기기의 제어를 순서대로 실행하고 새 상태 조회           |
| `invalidate(type)`          | `void`                            | 해당 종류의 캐시 무효화                                     |
| `setProperties(response)`   | `void`                            | `getDeviceProperties()` 응답을 저장해 온도 범위 검증에 사용 |
| `temperatureRange(type)`    | `{ minValue, maxValue, minStep }` | 메타데이터를 반영한 온도 범위                               |

온도 제어에 서버 메타데이터의 범위를 적용하려면 먼저 `store.setProperties(await client.getDeviceProperties())`를 호출합니다.

캐시는 기본 5초이며 실패한 조회는 캐시하지 않습니다. 제어 전후 해당 종류의 캐시를 무효화하며, 제어 전 시작된 조회가 오래된 상태를 복원하지 않도록 처리합니다.

`read()`는 `NORMAL`, `INIT`, `UNKNOWN` 상태를 반환할 수 있으며 기기가 없거나 `ERROR` 상태이면 실패합니다. `write()`는 `NORMAL` 상태에서만 허용합니다. 기본 온도 범위는 5~40, 간격은 1이며 메타데이터가 있으면 범위를 좁힙니다. 정수 온도·간격 1 이외의 범위는 지원하지 않습니다.

`HTWebService`를 직접 호출하면 store의 캐시·제어 직렬화를 거치지 않습니다. 직접 제어와 store를 함께 사용한다면 `invalidate(type)`로 캐시를 무효화해야 합니다. 캐시 만료만으로 조회가 발생하지 않습니다. 외부 상태 변경을 확인하려면 호출하는 쪽에서 주기적으로 `read()`를 실행해야 합니다. 주기적인 기기 폴링과 WebSocket 연결은 제공하지 않습니다.

## 상태 값 파서와 오류 처리

파서는 `{ statusList: HTStatus[] }` 형태를 받습니다. `HTDevice` 또는 상태 응답의 `data`를 전달할 수 있습니다.

| 함수                                  | 반환값    | 허용 값                                  |
| ------------------------------------- | --------- | ---------------------------------------- |
| `statusValue(device, command)`        | `string`  | 해당 command의 원본 문자열               |
| `statusNumber(device, command)`       | `number`  | 비어 있지 않고 유한한 숫자로 변환되는 값 |
| `statusOn(device, command = "power")` | `boolean` | `on` → true, `off` → false               |
| `statusDetected(device, command)`     | `boolean` | `detected` → true, `undetected` → false  |

값이 없거나 허용 형식이 아니면 `HTValidationError`가 발생합니다. 누락 값을 꺼짐·미감지·0으로 취급하지 않습니다. 잘못된 명령·응답, 기기 누락·통신 오류 상태, 제어 불가 상태도 이 오류를 사용합니다. 인증·HTTP·타임아웃·요청 취소는 다른 오류로 전달될 수 있습니다. 오류 메시지 문자열로 분기하지 말고 `instanceof HTValidationError`로 구분합니다.

```js
import { HTValidationError, statusNumber } from "@yylee/hthomeservice";

try {
  const response = await client.getHeaterState(heaterId);
  console.log(statusNumber(response.data, "currTemperature"));
} catch (error) {
  if (error instanceof HTValidationError) {
    console.warn("기기 응답 또는 요청 값을 확인하세요.", error.message);
  } else {
    throw error;
  }
}
```

제어 요청이 실패해도 기기에 명령이 적용되었을 수 있습니다. 여러 명령 중 일부만 적용되거나, 제어 성공 후 상태 재조회에서 실패할 수도 있습니다. 제어 전체를 바로 재전송하지 말고 상태를 다시 조회하여 확인합니다.

요청 오류에는 쿠키 등 HTTP 요청 정보가 포함될 수 있으므로 원본 오류 전체를 로그나 외부 응답에 노출하지 않습니다.

## 공개 타입

패키지 루트에서 다음 타입과 기기별 상태 응답 타입을 import할 수 있습니다.

- 클라이언트 계약: `HTDeviceApi`, `HTWebServiceOptions`, `HTLogger`
- 기기: `HTDevice`, `HTDeviceType`, `HTWritableDeviceType`, `HTDeviceState`
- 요청·명령: `HTDeviceQuery`, `HTStatus`, `HTStatusPower`, `HTWind`, `HTAirconMode`
- 응답: `HTResponse`, `HTDevicesResponse`, `HTDeviceStateResponse`, `HTStateResponse`, `HTHouseholdResponse`
- 메타데이터: `HTProperty`, `HTDevicePropertiesResponse`

## 개발

소스 저장소에서 작업할 때는 먼저 의존성을 설치하고 빌드합니다.

```sh
npm ci
npm run build
```

| 명령                   | 동작                                                               |
| ---------------------- | ------------------------------------------------------------------ |
| `npm ci`               | 잠금 파일에 맞춰 의존성 설치                                       |
| `npm run clean`        | `dist` 삭제                                                        |
| `npm run build`        | clean 후 TypeScript 7로 JavaScript·타입 선언·원본 포함 소스맵 생성 |
| `npm run lint`         | Oxlint와 Oxfmt 검사. 경고도 실패 처리                              |
| `npm run format`       | 기본 Oxfmt 서식으로 정리                                           |
| `npm run format:check` | 파일 변경 없이 서식 검사                                           |
| `npm test`             | 빌드 후 로컬 mock HTTP 서버 기반 테스트                            |

테스트는 실제 계정이나 기기를 사용하지 않습니다.
