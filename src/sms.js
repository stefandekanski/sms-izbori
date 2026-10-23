/**
 * Formats an sms: URI for opening the system SMS app.
 *
 * iOS requires "&body=" instead of "?body=" to populate the message text.
 */
export function smsUri(number, text, ios) {
  const separator = ios ? "&" : "?";
  return `sms:${number}${separator}body=${encodeURIComponent(text)}`;
}

/**
 * Detects whether the browser environment is running on iOS (iPhone, iPod, iPad).
 */
export function isIos(nav = typeof navigator !== "undefined" ? navigator : null) {
  if (!nav) return false;
  const platform = nav.platform || "";
  const ua = nav.userAgent || "";
  const maxTouchPoints = nav.maxTouchPoints || 0;
  return /iPad|iPhone|iPod/.test(platform) ||
    /iPad|iPhone|iPod/.test(ua) ||
    (platform === "MacIntel" && maxTouchPoints > 1);
}
