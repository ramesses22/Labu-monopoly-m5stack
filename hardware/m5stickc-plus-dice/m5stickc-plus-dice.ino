#include <M5StickCPlus.h>
#include <math.h>
#include <string.h>
#include "usb_icon_bitmap.h"

constexpr float SHAKE_THRESHOLD_G = 0.8f;

bool shakeSentForPress = false;
bool frontButtonWasPressed = false;
bool gameConnected = false;
char hostCommand[16];
size_t hostCommandLength = 0;

void sendEvent(const char *event) {
  Serial.println(event);
}

void showUsbIcon() {
  M5.Lcd.setRotation(0);
  M5.Lcd.fillScreen(TFT_WHITE);
  const int16_t x = (M5.Lcd.width() - USB_ICON_WIDTH) / 2;
  const int16_t y = (M5.Lcd.height() - USB_ICON_HEIGHT) / 2;
  constexpr uint8_t rowBytes = (USB_ICON_WIDTH + 7) / 8;
  for (int16_t row = 0; row < USB_ICON_HEIGHT; ++row) {
    int16_t runStart = -1;
    for (int16_t column = 0; column <= USB_ICON_WIDTH; ++column) {
      const bool black = column < USB_ICON_WIDTH &&
          (pgm_read_byte(&USB_ICON_BITMAP[row * rowBytes + column / 8]) & (0x80 >> (column % 8)));
      if (black && runStart < 0) runStart = column;
      if (!black && runStart >= 0) {
        M5.Lcd.drawFastHLine(x + runStart, y + row, column - runStart, TFT_BLACK);
        runStart = -1;
      }
    }
  }
}

void processHostCommands() {
  while (Serial.available() > 0) {
    const char value = static_cast<char>(Serial.read());
    if (value == '\r') continue;
    if (value == '\n') {
      hostCommand[hostCommandLength] = '\0';
      if (strcmp(hostCommand, "CONNECT") == 0 && !gameConnected) {
        gameConnected = true;
        showUsbIcon();
      } else if (strcmp(hostCommand, "DISCONNECT") == 0 && gameConnected) {
        gameConnected = false;
        M5.Lcd.fillScreen(TFT_BLACK);
      }
      hostCommandLength = 0;
    } else if (hostCommandLength < sizeof(hostCommand) - 1) {
      hostCommand[hostCommandLength++] = value;
    } else {
      hostCommandLength = 0;
    }
  }
}

void setup() {
  M5.begin();
  M5.IMU.Init();
  M5.Lcd.setRotation(0);
  M5.Lcd.fillScreen(TFT_BLACK);
  Serial.begin(115200);
}

void loop() {
  M5.update();
  processHostCommands();

  if (M5.BtnB.wasPressed()) sendEvent("NEXT");

  const bool buttonPressed = M5.BtnA.isPressed();
  if (!buttonPressed) {
    if (frontButtonWasPressed && !shakeSentForPress) sendEvent("SELECT");
    frontButtonWasPressed = false;
    shakeSentForPress = false;
    delay(20);
    return;
  }
  frontButtonWasPressed = true;

  float ax, ay, az;
  M5.IMU.getAccelData(&ax, &ay, &az);

  const float magnitude = sqrtf(ax * ax + ay * ay + az * az);
  const float dynamicAcceleration = fabsf(magnitude - 1.0f);

  if (!shakeSentForPress && dynamicAcceleration >= SHAKE_THRESHOLD_G) {
    sendEvent("SHAKE");
    shakeSentForPress = true;
  }

  delay(20);
}
