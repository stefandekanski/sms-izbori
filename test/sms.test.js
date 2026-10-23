import assert from "node:assert/strict";
import { test } from "./harness.js";
import { isIos, smsUri } from "../src/sms.js";

const text = "BM_22; Petar Petrović\nIzlaznost do 08: 123";
const body = "BM_22%3B%20Petar%20Petrovi%C4%87%0AIzlaznost%20do%2008%3A%20123";

test("smsUri on Android puts the body after ?", () => {
  assert.equal(smsUri("0641234567", text, false), `sms:0641234567?body=${body}`);
});

test("smsUri on iOS puts the body after &", () => {
  assert.equal(smsUri("0641234567", text, true), `sms:0641234567&body=${body}`);
});

test("smsUri keeps the leading + of the number", () => {
  assert.equal(smsUri("+381641234567", "x", false), "sms:+381641234567?body=x");
});

test("smsUri keeps the blank line of the results message", () => {
  assert.ok(smsUri("0641234567", "BM_1; A\n\nMI - 1\nONI - 2", false).endsWith("A%0A%0AMI%20-%201%0AONI%20-%202"));
});

test("isIos: iPhone", () => {
  assert.equal(isIos({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", platform: "iPhone", maxTouchPoints: 5 }), true);
});

test("isIos: iPad that reports a Mac", () => {
  assert.equal(isIos({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", maxTouchPoints: 5 }), true);
});

test("isIos: a real Mac is not iOS", () => {
  assert.equal(isIos({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", maxTouchPoints: 0 }), false);
});

test("isIos: Android is not iOS", () => {
  assert.equal(isIos({ userAgent: "Mozilla/5.0 (Linux; Android 16; Pixel 8a)", platform: "Linux armv8l", maxTouchPoints: 5 }), false);
});
