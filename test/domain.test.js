import assert from "node:assert/strict";
import { test } from "./harness.js";
import {
  SLOTS,
  slotLabel,
  parseCount,
  normalizeBm,
  normalizeName,
  normalizePhone,
  header,
  messages,
  reportText,
  reportLabel,
  emptyLog,
  record,
  sentIzlaznost,
  registered,
  latestVanBm,
  suggestedSlot,
  currentCard,
  checks,
} from "../src/domain.js";

// SlotTest

test("SlotTest.slots_matchTheChecklistInOrder", () => {
  assert.deepEqual(SLOTS, [8, 10, 12, 14, 16, 18, 19, 20]);
});

test("SlotTest.label_isTwoDigits", () => {
  assert.deepEqual(SLOTS.map(slotLabel), ["08", "10", "12", "14", "16", "18", "19", "20"]);
});

// InputTest

test("InputTest.parseCount_acceptsWholeNumbers", () => {
  assert.equal(parseCount("123"), 123);
  assert.equal(parseCount("0"), 0);
  assert.equal(parseCount("99999"), 99999);
});

test("InputTest.parseCount_trimsAndDropsLeadingZeros", () => {
  assert.equal(parseCount("  0123 "), 123);
  assert.equal(parseCount("000"), 0);
});

test("InputTest.parseCount_rejectsEverythingElse", () => {
  const invalid = ["", "   ", "12a", "-5", "+5", "1 234", "1.234", "1,234", "100000", "99999999999999999999"];
  for (const it of invalid) {
    assert.equal(parseCount(it), null, `'${it}' should be rejected`);
  }
});

test("InputTest.normalizeBm_keepsDigitsAsTyped", () => {
  assert.equal(normalizeBm("22"), "22");
  assert.equal(normalizeBm(" 07 "), "07");
  assert.equal(normalizeBm("1234"), "1234");
  assert.equal(normalizeBm("0"), "0");
});

test("InputTest.normalizeBm_rejectsNonDigitsAndTooLong", () => {
  const invalid = ["", " ", "12345", "2a", "BM22", "-1", "2 2"];
  for (const it of invalid) {
    assert.equal(normalizeBm(it), null, `'${it}' should be rejected`);
  }
});

test("InputTest.normalizeName_trimsAndCollapsesSpaces", () => {
  assert.equal(normalizeName("  Petar   Petrović "), "Petar Petrović");
  assert.equal(normalizeName("Ana\tMarija  Kobaš"), "Ana Marija Kobaš");
});

test("InputTest.normalizeName_rejectsBlank", () => {
  assert.equal(normalizeName(""), null);
  assert.equal(normalizeName("   "), null);
});

test("InputTest.normalizePhone_stripsSeparators", () => {
  assert.equal(normalizePhone("064 123 4567"), "0641234567");
  assert.equal(normalizePhone("(064) 123.45.67"), "0641234567");
  assert.equal(normalizePhone("064-123-4567"), "0641234567");
  assert.equal(normalizePhone("+381 64 123-4567"), "+381641234567");
});

test("InputTest.normalizePhone_lengthLimits", () => {
  assert.equal(normalizePhone("123456"), "123456");
  assert.equal(normalizePhone("123456789012345"), "123456789012345");
  assert.equal(normalizePhone("12345"), null);
  assert.equal(normalizePhone("1234567890123456"), null);
});

test("InputTest.normalizePhone_rejectsGarbage", () => {
  const invalid = ["", "+", "abc", "++381641234567", "064+1234567", "064 123 456a", "*#06#"];
  for (const it of invalid) {
    assert.equal(normalizePhone(it), null, `'${it}' should be rejected`);
  }
});

// MessagesTest

const petar = { bm: "22", name: "Petar Petrović", coordinatorNumber: "0641234567", coordinatorName: null };

test("MessagesTest.header_isBmNumberAndName", () => {
  assert.equal(header(petar), "BM_22; Petar Petrović");
});

test("MessagesTest.header_keepsLeadingZerosOfBm", () => {
  assert.equal(header({ ...petar, bm: "07", name: "Ana Kobaš" }), "BM_07; Ana Kobaš");
});

test("MessagesTest.upisani_withoutVanBm", () => {
  assert.equal(messages.upisani(petar, 1234, null), "BM_22; Petar Petrović\nBroj upisanih birača: 1234");
});

test("MessagesTest.upisani_withVanBm_addsLine", () => {
  assert.equal(
    messages.upisani(petar, 1234, 5),
    "BM_22; Petar Petrović\nBroj upisanih birača: 1234\nPrijavljeni van BM: 5",
  );
});

test("MessagesTest.upisani_withZeroVanBm_stillAddsLine", () => {
  assert.equal(
    messages.upisani(petar, 1234, 0),
    "BM_22; Petar Petrović\nBroj upisanih birača: 1234\nPrijavljeni van BM: 0",
  );
});

test("MessagesTest.izlaznost_usesTwoDigitHour", () => {
  assert.equal(messages.izlaznost(petar, 8, 123), "BM_22; Petar Petrović\nIzlaznost do 08: 123");
  assert.equal(messages.izlaznost(petar, 19, 0), "BM_22; Petar Petrović\nIzlaznost do 19: 0");
});

test("MessagesTest.vanBm", () => {
  assert.equal(messages.vanBm(petar, 7), "BM_22; Petar Petrović\nPrijavljeni van BM: 7");
});

test("MessagesTest.komisija", () => {
  assert.equal(messages.komisija(petar), "BM_22; Petar Petrović\nKomisija za glasanje van BM formirana");
});

test("MessagesTest.rezultati_hasBlankLineAfterHeader", () => {
  assert.equal(messages.rezultati(petar, 123, 456), "BM_22; Petar Petrović\n\nMI - 123\nONI - 456");
});

test("MessagesTest.coordinatorDoesNotAppearInMessages", () => {
  const withName = { ...petar, coordinatorName: "Marko" };
  assert.equal(messages.komisija(petar), messages.komisija(withName));
});

// ReportTest

test("ReportTest.text_delegatesToMessages", () => {
  assert.equal(reportText({ type: "upisani", upisani: 1234, vanBm: 5 }, petar), messages.upisani(petar, 1234, 5));
  assert.equal(reportText({ type: "izlaznost", slot: 10, count: 123 }, petar), messages.izlaznost(petar, 10, 123));
  assert.equal(reportText({ type: "vanBm", count: 7 }, petar), messages.vanBm(petar, 7));
  assert.equal(reportText({ type: "komisija" }, petar), messages.komisija(petar));
  assert.equal(reportText({ type: "rezultati", mi: 123, oni: 456 }, petar), messages.rezultati(petar, 123, 456));
});

test("ReportTest.label_isShortHumanSummary", () => {
  assert.equal(reportLabel({ type: "upisani", upisani: 1234, vanBm: 5 }), "Broj upisanih (1234)");
  assert.equal(reportLabel({ type: "izlaznost", slot: 10, count: 123 }), "Izlaznost do 10h (123)");
  assert.equal(reportLabel({ type: "vanBm", count: 7 }), "Prijavljeni van BM (7)");
  assert.equal(reportLabel({ type: "komisija" }), "Komisija van BM formirana");
  assert.equal(reportLabel({ type: "rezultati", mi: 123, oni: 456 }), "Rezultati (MI 123, ONI 456)");
});

// ReportLogTest

test("ReportLogTest.emptyLog", () => {
  const log = emptyLog();
  assert.equal(log.upisani, null);
  assert.deepEqual(sentIzlaznost(log), {});
  assert.equal(registered(log), null);
  assert.equal(latestVanBm(log), null);
  assert.equal(log.vanBm, null);
  assert.equal(log.komisija, null);
  assert.equal(log.rezultati, null);
});

test("ReportLogTest.record_upisani", () => {
  const log = record(emptyLog(), { type: "upisani", upisani: 1234, vanBm: 5 }, 1000);
  assert.deepEqual(log.upisani, { value: { type: "upisani", upisani: 1234, vanBm: 5 }, at: 1000 });
  assert.equal(registered(log), 1234);
  assert.equal(latestVanBm(log), 5);
});

test("ReportLogTest.record_izlaznost_keyedBySlot_resendReplaces", () => {
  let log = emptyLog();
  log = record(log, { type: "izlaznost", slot: 8, count: 50 }, 1000);
  log = record(log, { type: "izlaznost", slot: 10, count: 150 }, 2000);
  log = record(log, { type: "izlaznost", slot: 10, count: 140 }, 3000);
  assert.deepEqual(sentIzlaznost(log), { 8: 50, 10: 140 });
  assert.deepEqual(log.izlaznost[10], { value: { type: "izlaznost", slot: 10, count: 140 }, at: 3000 });
});

test("ReportLogTest.record_vanBm_komisija_rezultati", () => {
  let log = emptyLog();
  log = record(log, { type: "vanBm", count: 7 }, 1000);
  log = record(log, { type: "komisija" }, 2000);
  log = record(log, { type: "rezultati", mi: 123, oni: 456 }, 3000);
  assert.deepEqual(log.vanBm, { value: { type: "vanBm", count: 7 }, at: 1000 });
  assert.deepEqual(log.komisija, { value: { type: "komisija" }, at: 2000 });
  assert.deepEqual(log.rezultati, { value: { type: "rezultati", mi: 123, oni: 456 }, at: 3000 });
});

test("ReportLogTest.latestVanBm_isTheLaterOfUpisaniAndVanBm", () => {
  const upisaniFirst = record(
    record(emptyLog(), { type: "upisani", upisani: 1234, vanBm: 5 }, 1000),
    { type: "vanBm", count: 9 },
    2000,
  );
  assert.equal(latestVanBm(upisaniFirst), 9);

  const vanBmFirst = record(
    record(emptyLog(), { type: "vanBm", count: 9 }, 1000),
    { type: "upisani", upisani: 1234, vanBm: 5 },
    2000,
  );
  assert.equal(latestVanBm(vanBmFirst), 5);

  const upisaniWithoutVanBm = record(
    record(emptyLog(), { type: "vanBm", count: 9 }, 1000),
    { type: "upisani", upisani: 1234, vanBm: null },
    2000,
  );
  assert.equal(latestVanBm(upisaniWithoutVanBm), 9);
});

test("ReportLogTest.record_doesNotTouchOtherReports", () => {
  const before = record(
    record(emptyLog(), { type: "upisani", upisani: 1234, vanBm: null }, 1000),
    { type: "izlaznost", slot: 8, count: 50 },
    2000,
  );
  const after = record(before, { type: "rezultati", mi: 1, oni: 2 }, 3000);
  assert.deepEqual(before.upisani, after.upisani);
  assert.deepEqual(before.izlaznost, after.izlaznost);
});

// ScheduleTest

function atMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

test("ScheduleTest.beforeTheFirstWindow_suggestsEight", () => {
  assert.equal(suggestedSlot(atMinutes("05:30"), []), 8);
  assert.equal(suggestedSlot(atMinutes("07:44"), []), 8);
});

test("ScheduleTest.slotBecomesDueFifteenMinutesEarly", () => {
  assert.equal(suggestedSlot(atMinutes("07:45"), []), 8);
  assert.equal(suggestedSlot(atMinutes("09:44"), []), 8);
  assert.equal(suggestedSlot(atMinutes("09:45"), []), 10);
  assert.equal(suggestedSlot(atMinutes("18:44"), []), 18);
  assert.equal(suggestedSlot(atMinutes("18:45"), []), 19);
  assert.equal(suggestedSlot(atMinutes("19:45"), []), 20);
});

test("ScheduleTest.afterTheLastSlot_staysOnTwenty", () => {
  assert.equal(suggestedSlot(atMinutes("21:30"), []), 20);
  assert.equal(suggestedSlot(atMinutes("23:59"), []), 20);
});

test("ScheduleTest.dueSlotAlreadySent_movesToNextUnsent", () => {
  assert.equal(suggestedSlot(atMinutes("08:05"), [8]), 10);
  assert.equal(suggestedSlot(atMinutes("08:05"), [8, 10]), 12);
  assert.equal(suggestedSlot(atMinutes("08:05"), [8, 12]), 10);
});

test("ScheduleTest.neverGoesBackToAStaleUnsentSlot", () => {
  assert.equal(suggestedSlot(atMinutes("10:30"), []), 10);
  assert.equal(suggestedSlot(atMinutes("10:30"), [10]), 12);
  assert.equal(suggestedSlot(atMinutes("10:30"), [8]), 10);
});

test("ScheduleTest.everythingFromDueOnSent_keepsDueSlot", () => {
  assert.equal(suggestedSlot(atMinutes("20:10"), [20]), 20);
  assert.equal(suggestedSlot(atMinutes("19:10"), [19, 20]), 19);
  assert.equal(suggestedSlot(atMinutes("21:00"), SLOTS), 20);
});

test("ScheduleTest.afterMidnight_countingNight_staysOnTwenty", () => {
  assert.equal(suggestedSlot(atMinutes("00:15"), []), 20);
  assert.equal(suggestedSlot(atMinutes("04:59"), [8, 10]), 20);
  assert.equal(suggestedSlot(atMinutes("05:00"), []), 8);
});

test("ScheduleTest.currentCard_beforeOpening_isUpisaniUntilSent", () => {
  assert.equal(currentCard(atMinutes("05:00"), emptyLog()), "upisani");
  assert.equal(currentCard(atMinutes("06:59"), emptyLog()), "upisani");
  const sent = record(emptyLog(), { type: "upisani", upisani: 1234, vanBm: null }, 1);
  assert.equal(currentCard(atMinutes("06:30"), sent), "izlaznost");
});

test("ScheduleTest.currentCard_duringVoting_isIzlaznost", () => {
  assert.equal(currentCard(atMinutes("07:00"), emptyLog()), "izlaznost");
  assert.equal(currentCard(atMinutes("19:59"), emptyLog()), "izlaznost");
});

test("ScheduleTest.currentCard_afterClosing_izlaznostUntilTwentySentOrHalfPast", () => {
  assert.equal(currentCard(atMinutes("20:00"), emptyLog()), "izlaznost");
  assert.equal(currentCard(atMinutes("20:29"), emptyLog()), "izlaznost");
  assert.equal(currentCard(atMinutes("20:30"), emptyLog()), "rezultati");
  assert.equal(currentCard(atMinutes("23:00"), emptyLog()), "rezultati");
  assert.equal(currentCard(atMinutes("02:00"), emptyLog()), "rezultati");
  assert.equal(currentCard(atMinutes("04:59"), emptyLog()), "rezultati");
  const twentySent = record(emptyLog(), { type: "izlaznost", slot: 20, count: 900 }, 1);
  assert.equal(currentCard(atMinutes("20:05"), twentySent), "rezultati");
});

test("ScheduleTest.currentCard_otherSlotsSentDoNotEndIzlaznostAtTwenty", () => {
  const nineteenSent = record(emptyLog(), { type: "izlaznost", slot: 19, count: 800 }, 1);
  assert.equal(currentCard(atMinutes("20:05"), nineteenSent), "izlaznost");
});

// ChecksTest

test("ChecksTest.izlaznost_noHistory_noWarnings", () => {
  assert.deepEqual(checks.izlaznost(8, 50, {}, null), []);
});

test("ChecksTest.izlaznost_growingNumbers_noWarnings", () => {
  const sent = { 8: 50, 10: 150 };
  assert.deepEqual(checks.izlaznost(12, 150, sent, 1234), []);
  assert.deepEqual(checks.izlaznost(12, 300, sent, 1234), []);
});

test("ChecksTest.izlaznost_lowerThanEarlier_namesLatestEarlierHigherSlot", () => {
  const sent = { 8: 120, 10: 150 };
  assert.deepEqual(checks.izlaznost(12, 100, sent, null), [
    { type: "lowerThanEarlier", slot: 10, value: 150, text: "Manje nego do 10h (150). Proveri broj." },
  ]);

  const dip = { 8: 120, 10: 90 };
  assert.deepEqual(checks.izlaznost(12, 100, dip, null), [
    { type: "lowerThanEarlier", slot: 8, value: 120, text: "Manje nego do 08h (120). Proveri broj." },
  ]);
});

test("ChecksTest.izlaznost_higherThanLater_namesEarliestLaterLowerSlot", () => {
  const sent = { 14: 190, 16: 250 };
  assert.deepEqual(checks.izlaznost(12, 200, sent, null), [
    { type: "higherThanLater", slot: 14, value: 190, text: "Više nego do 14h (190). Proveri broj." },
  ]);
  assert.deepEqual(checks.izlaznost(12, 260, sent, null), [
    { type: "higherThanLater", slot: 14, value: 190, text: "Više nego do 14h (190). Proveri broj." },
  ]);
  assert.deepEqual(checks.izlaznost(12, 190, sent, null), []);
});

test("ChecksTest.izlaznost_resendingTheSameSlot_ignoresItsOldValue", () => {
  const sent = { 10: 150 };
  assert.deepEqual(checks.izlaznost(10, 140, sent, null), []);
});

test("ChecksTest.izlaznost_moreThanRegistered", () => {
  assert.deepEqual(checks.izlaznost(20, 1235, {}, 1234), [
    { type: "moreThanRegistered", registered: 1234, text: "Više od broja upisanih (1234). Proveri broj." },
  ]);
  assert.deepEqual(checks.izlaznost(20, 1234, {}, 1234), []);
});

test("ChecksTest.izlaznost_orderOfWarnings_historyFirstThenRegistered", () => {
  const sent = { 18: 1300 };
  assert.deepEqual(checks.izlaznost(20, 1250, sent, 1234), [
    { type: "lowerThanEarlier", slot: 18, value: 1300, text: "Manje nego do 18h (1300). Proveri broj." },
    { type: "moreThanRegistered", registered: 1234, text: "Više od broja upisanih (1234). Proveri broj." },
  ]);
});

test("ChecksTest.vanBm_moreThanRegistered", () => {
  assert.deepEqual(checks.vanBm(5, 1234), []);
  assert.deepEqual(checks.vanBm(5, null), []);
  assert.deepEqual(checks.vanBm(2000, 1234), [
    { type: "moreThanRegistered", registered: 1234, text: "Više od broja upisanih (1234). Proveri broj." },
  ]);
});

test("ChecksTest.rezultati_noTurnoutSent_noWarnings", () => {
  assert.deepEqual(checks.rezultati(900, 900, {}, null), []);
});

test("ChecksTest.rezultati_onlyEarlierSlotsSent_noWarnings", () => {
  const sent = { 18: 1000, 19: 1100 };
  assert.deepEqual(checks.rezultati(600, 700, sent, null), []);
});

test("ChecksTest.rezultati_aboveTurnoutAtTwenty", () => {
  const sent = { 20: 1250 };
  assert.deepEqual(checks.rezultati(600, 700, sent, null), [
    { type: "resultsAboveTurnout", sum: 1300, voted: 1250, text: "MI i ONI zajedno (1300) više nego što je glasalo (1250). Proveri brojeve." },
  ]);
  assert.deepEqual(checks.rezultati(600, 650, sent, null), []);
  assert.deepEqual(checks.rezultati(600, 650, { ...sent, 18: 1400 }, null), []);
});

test("ChecksTest.rezultati_countsVanBmVoters", () => {
  const sent = { 18: 1000, 20: 1250 };
  assert.deepEqual(checks.rezultati(600, 660, sent, 10), []);
  assert.deepEqual(checks.rezultati(600, 700, sent, 10), [
    { type: "resultsAboveTurnout", sum: 1300, voted: 1260, text: "MI i ONI zajedno (1300) više nego što je glasalo (1260). Proveri brojeve." },
  ]);
});

test("ChecksTest.warningTexts", () => {
  const w1 = checks.izlaznost(12, 100, { 10: 150 }, null)[0];
  assert.equal(w1?.text, "Manje nego do 10h (150). Proveri broj.");

  const w2 = checks.izlaznost(12, 200, { 14: 90 }, null)[0];
  assert.equal(w2?.text, "Više nego do 14h (90). Proveri broj.");

  const w3 = checks.vanBm(2000, 1234)[0];
  assert.equal(w3?.text, "Više od broja upisanih (1234). Proveri broj.");

  const w4 = checks.rezultati(600, 700, { 20: 1250 }, null)[0];
  assert.equal(w4?.text, "MI i ONI zajedno (1300) više nego što je glasalo (1250). Proveri brojeve.");
});
