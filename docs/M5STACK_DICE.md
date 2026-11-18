# M5Stack 搖動擲骰

遊戲可透過 USB Web Serial 接收 M5Stack 傳來的 `SHAKE` 訊息。遊戲端仍負責擲骰點數與規則；裝置只報告搖動，不會決定點數。硬體範例尚未在所有 M5Stack 型號上實機驗證，請先確認型號具有支援的 IMU。

## 使用方式

1. 在 M5Stack 的 Arduino IDE 專案安裝 M5Unified，將下方範例燒錄至支援的 M5Stack。
2. 以 USB 將裝置接到執行遊戲的電腦，使用桌面版 Chrome 或 Edge 開啟遊戲。Web Serial 需要 HTTPS 或 localhost；瀏覽器會要求使用者明確選取序列埠。
3. 按遊戲標題列的 🎲 按鈕，選擇 M5Stack 序列埠。序列速度為 115200 baud。
4. 輪到自己且遊戲可擲骰時，搖動 M5Stack；其他回合、移動中、等待落地操作或遊戲結束時，搖動不會產生遊戲動作。
5. 一回合內最多接受一次硬體擲骰。連線按鈕可中斷裝置；斷線時仍可使用遊戲原有的畫面擲骰按鈕。

此方式以 USB Serial 為傳輸，不是 BLE。連接失敗時請檢查資料線是否支援資料傳輸、序列埠是否被 Arduino Serial Monitor 等程式占用，以及瀏覽器權限。

## M5Unified 範例韌體

以下範例以加速度相鄰樣本的變化偵測搖動。搖動後必須穩定一段時間才重新待命，並設冷卻時間避免一次動作重複送出。`SHAKE_DELTA` 與靜止時間須依裝置型號及實際手感調校；請先用 Serial Monitor 確認裝置確實輸出 `SHAKE`，再關閉 Serial Monitor 連線遊戲。

```cpp
#include <M5Unified.h>
#include <cmath>

constexpr float SHAKE_DELTA = 12.0f;
constexpr float QUIET_DELTA = 2.5f;
constexpr uint32_t QUIET_MS = 600;
constexpr uint32_t COOLDOWN_MS = 800;

float previousX = 0;
float previousY = 0;
float previousZ = 0;
bool hasPrevious = false;
bool armed = true;
uint32_t quietSince = 0;
uint32_t lastShakeAt = 0;

void setup() {
  M5.begin();
  Serial.begin(115200);
  if (!M5.Imu.isEnabled()) {
    Serial.println("IMU unavailable");
  }
}

void loop() {
  M5.update();
  const auto imu = M5.Imu.getImuData();
  const float x = imu.accel.x;
  const float y = imu.accel.y;
  const float z = imu.accel.z;
  const uint32_t now = millis();

  if (hasPrevious) {
    const float dx = x - previousX;
    const float dy = y - previousY;
    const float dz = z - previousZ;
    const float delta = sqrtf(dx * dx + dy * dy + dz * dz);

    if (armed && delta >= SHAKE_DELTA && now - lastShakeAt >= COOLDOWN_MS) {
      Serial.println("SHAKE");
      lastShakeAt = now;
      armed = false;
      quietSince = 0;
    } else if (!armed && delta <= QUIET_DELTA) {
      if (quietSince == 0) quietSince = now;
      if (now - quietSince >= QUIET_MS) armed = true;
    } else {
      quietSince = 0;
    }
  }

  previousX = x;
  previousY = y;
  previousZ = z;
  hasPrevious = true;
  delay(20);
}
```

若 IMU 初始化失敗，請確認實際型號及其 IMU 支援狀況；不同 M5Stack 型號的感測器和座標方向可能不同。若太容易觸發，調高 `SHAKE_DELTA` 或延長 `QUIET_MS`；若很難觸發，先確認序列輸出及加速度變化，再小幅調低閾值。

## 遊戲端防重複與回合權限

- 序列輸入只接受完整的 `SHAKE` 行，可處理分段抵達的資料。
- 每個遊戲回合只接受一次搖動事件；僅在 `canAct()` 為真且階段為 `roll` 時，呼叫與畫面按鈕相同的 `roll` 動作。
- 多人房仍由房間伺服器驗證玩家、回合和骰點；不是目前操作者的搖動不會送出命令。
- 中斷連線不會停用畫面擲骰按鈕；重連不會重播之前的序列資料。

## 瀏覽器支援與隱私

Web Serial 需要支援該 API 的桌面 Chrome／Edge 與安全來源（HTTPS 或 localhost）；瀏覽器必須在使用者按下連線按鈕後才能顯示序列埠選擇器。手機瀏覽器的支援情形不同，請先確認實際裝置。遊戲不會自動選取、掃描或保存序列埠；未連接時不影響一般遊玩。

本功能只有本機 USB 序列資料，不使用 Wi-Fi、雲端或裝置憑證。若要改用 BLE 或網路中介，需另行設計配對、驗證與傳輸安全，不能直接把房間憑證或金鑰寫入公開程式碼。
