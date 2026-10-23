import assert from "node:assert/strict";
import { test } from "./harness.js";
import { createApp } from "../src/app.js";
import { emptyDrafts, emptyLog, record, sentIzlaznost, SETUP_ERRORS } from "../src/domain.js";

const petar = {
  bm: "22",
  name: "Petar Petrović",
  coordinatorNumber: "0641234567",
  coordinatorName: "Marko",
};

function createFakeStore(initial = {}) {
  let profile = initial.profile ?? null;
  let log = initial.log ?? emptyLog();
  let drafts = initial.drafts ?? emptyDrafts();
  let undo = initial.undo ?? null;

  return {
    loadProfile: () => profile,
    saveProfile: (p) => {
      profile = p;
    },
    loadLog: () => log,
    saveLog: (l) => {
      log = l;
    },
    loadDrafts: () => drafts,
    saveDrafts: (d) => {
      drafts = d;
    },
    loadUndo: () => undo,
    saveUndo: (u) => {
      undo = u;
    },
    get profile() {
      return profile;
    },
    set profile(v) {
      profile = v;
    },
    get log() {
      return log;
    },
    set log(v) {
      log = v;
    },
    get drafts() {
      return drafts;
    },
    set drafts(v) {
      drafts = v;
    },
    get undo() {
      return undo;
    },
    set undo(v) {
      undo = v;
    },
  };
}

function makeClock(hhmm = "10:05") {
  let [h, m] = hhmm.split(":").map(Number);
  const now = () => new Date(2026, 9, 25, h, m);
  now.set = (newHhmm) => {
    const [nh, nm] = newHhmm.split(":").map(Number);
    h = nh;
    m = nm;
  };
  now.millis = () => now().getTime();
  return now;
}

// Setup

test("AppViewModelTest.firstRun_showsSetup", () => {
  const store = createFakeStore();
  const app = createApp({ store, now: makeClock() });
  assert.equal(app.getState().showSetup, true);
  assert.equal(app.getState().profile, null);
});

test("AppViewModelTest.withProfile_showsReports", () => {
  const store = createFakeStore({ profile: petar });
  const app = createApp({ store, now: makeClock() });
  assert.equal(app.getState().showSetup, false);
  assert.deepEqual(app.getState().profile, petar);
});

test("AppViewModelTest.saveSetup_valid_normalizesAndSaves", () => {
  const store = createFakeStore();
  const app = createApp({ store, now: makeClock() });
  const errors = app.saveSetup({
    bm: " 22 ",
    name: " Petar   Petrović ",
    coordinatorNumber: "064 123 4567",
    coordinatorName: "Marko",
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(store.profile, petar);
  assert.deepEqual(app.getState().profile, petar);
  assert.equal(app.getState().showSetup, false);
});

test("AppViewModelTest.saveSetup_blankCoordinatorName_isNull", () => {
  const store = createFakeStore();
  const app = createApp({ store, now: makeClock() });
  app.saveSetup({
    bm: "22",
    name: "Petar Petrović",
    coordinatorNumber: "0641234567",
    coordinatorName: "  ",
  });
  assert.equal(store.profile?.coordinatorName, null);
});

test("AppViewModelTest.saveSetup_invalid_returnsEveryError_savesNothing", () => {
  const store = createFakeStore();
  const app = createApp({ store, now: makeClock() });
  const errors = app.saveSetup({
    bm: "2a",
    name: " ",
    coordinatorNumber: "123",
  });
  assert.deepEqual(errors, ["bm", "name", "number"]);
  assert.equal(store.profile, null);
  assert.equal(app.getState().showSetup, true);
});

test("AppViewModelTest.setupErrorTexts", () => {
  assert.equal(SETUP_ERRORS.bm, "Upiši broj biračkog mesta, samo cifre.");
  assert.equal(SETUP_ERRORS.name, "Upiši ime i prezime.");
  assert.equal(SETUP_ERRORS.number, "Upiši ispravan broj telefona koordinatora.");
});

test("AppViewModelTest.setupOpen_isNotKept_aNewAppOpensSetupOnlyWithoutProfile", () => {
  const storeWithProfile = createFakeStore({ profile: petar });
  const app = createApp({ store: storeWithProfile, now: makeClock() });
  app.openSetup();
  assert.equal(app.getState().showSetup, true);

  const fresh = createApp({ store: storeWithProfile, now: makeClock() });
  assert.equal(fresh.getState().showSetup, false);

  const storeWithoutProfile = createFakeStore({ profile: null });
  const freshWithout = createApp({ store: storeWithoutProfile, now: makeClock() });
  assert.equal(freshWithout.getState().showSetup, true);
});

test("AppViewModelTest.openAndCloseSetup", () => {
  const store = createFakeStore({ profile: petar });
  const app = createApp({ store, now: makeClock() });
  app.openSetup();
  assert.equal(app.getState().showSetup, true);
  app.closeSetup();
  assert.equal(app.getState().showSetup, false);
});

test("AppViewModelTest.closeSetup_onFirstRun_staysOpen", () => {
  const store = createFakeStore();
  const app = createApp({ store, now: makeClock() });
  app.closeSetup();
  assert.equal(app.getState().showSetup, true);
});

test("AppViewModelTest.clearReports_keepsProfile", () => {
  const initialLog = record(emptyLog(), { type: "izlaznost", slot: 8, count: 50 }, 1);
  const initialDrafts = { ...emptyDrafts(), mi: "5" };
  const store = createFakeStore({ profile: petar, log: initialLog, drafts: initialDrafts });
  const app = createApp({ store, now: makeClock() });
  app.send("komisija");
  app.clearReports();
  assert.deepEqual(store.log, emptyLog());
  assert.deepEqual(store.drafts, emptyDrafts());
  assert.deepEqual(store.profile, petar);
  assert.deepEqual(app.getState().log, emptyLog());
  assert.equal(app.getState().undo, null);
  assert.equal(store.undo, null);
});

// Drafts

test("AppViewModelTest.setters_keepOnlyDigits_upToFive", () => {
  const store = createFakeStore({ profile: petar });
  const app = createApp({ store, now: makeClock() });
  app.setIzlaznost("12a3");
  assert.equal(app.getState().drafts.izlaznost, "123");
  app.setIzlaznost("1234567");
  assert.equal(app.getState().drafts.izlaznost, "12345");
  app.setUpisani(" 1.234 ");
  assert.equal(app.getState().drafts.upisani, "1234");
  assert.deepEqual(app.getState().drafts, store.drafts);
});

test("AppViewModelTest.everySetter_savesItsField", () => {
  const store = createFakeStore({ profile: petar });
  const app = createApp({ store, now: makeClock("10:05") });
  app.setUpisani("1");
  app.setUpisaniVanBm("2");
  app.setIzlaznost("3");
  app.selectSlot(14);
  app.setVanBm("4");
  app.setMi("5");
  app.setOni("6");
  assert.deepEqual(store.drafts, {
    upisani: "1",
    upisaniVanBm: "2",
    izlaznost: "3",
    izlaznostSlot: 14,
    vanBm: "4",
    mi: "5",
    oni: "6",
    izlaznostSlotFor: 10,
  });
});

test("AppViewModelTest.drafts_surviveANewViewModel", () => {
  const store = createFakeStore({ profile: petar });
  createApp({ store, now: makeClock() }).setMi("600");
  assert.equal(createApp({ store, now: makeClock() }).getState().drafts.mi, "600");
});

// Slot and current card

test("AppViewModelTest.selectedSlot_followsTheClock", () => {
  const now = makeClock("09:00");
  const store = createFakeStore({ profile: petar });
  const app = createApp({ store, now });
  assert.equal(app.getState().selectedSlot, 8);
  now.set("09:50");
  app.refresh();
  assert.equal(app.getState().selectedSlot, 10);
});

test("AppViewModelTest.chosenSlot_holdsOnlyUntilTheSuggestionMoves", () => {
  const now = makeClock("09:00");
  const store = createFakeStore({ profile: petar });
  const app = createApp({ store, now });
  app.selectSlot(12);
  now.set("09:30");
  app.refresh();
  assert.equal(app.getState().selectedSlot, 12);
  now.set("09:50");
  app.refresh();
  assert.equal(app.getState().selectedSlot, 10);
  assert.equal(app.getState().drafts.izlaznostSlot, null);
});

test("AppViewModelTest.choosingTheSuggestedSlot_isNotAChoice", () => {
  const now = makeClock("08:10");
  const store = createFakeStore({ profile: petar });
  const app = createApp({ store, now });
  app.selectSlot(8);
  assert.equal(app.getState().drafts.izlaznostSlot, null);
  now.set("10:00");
  app.refresh();
  assert.equal(app.getState().selectedSlot, 10);
});

test("AppViewModelTest.chosenSlot_survivesANewViewModel_whileTheSuggestionHolds", () => {
  const store = createFakeStore({ profile: petar });
  createApp({ store, now: makeClock("10:05") }).selectSlot(8);
  assert.equal(createApp({ store, now: makeClock("10:20") }).getState().selectedSlot, 8);
  assert.equal(createApp({ store, now: makeClock("11:50") }).getState().selectedSlot, 12);
});

test("AppViewModelTest.currentCard_followsTheClock", () => {
  const now = makeClock("06:00");
  const store = createFakeStore({ profile: petar });
  const app = createApp({ store, now });
  assert.equal(app.getState().currentCard, "upisani");
  now.set("07:30");
  app.refresh();
  assert.equal(app.getState().currentCard, "izlaznost");
});

// Sending

test("AppViewModelTest.send_upisani", () => {
  const store = createFakeStore({ profile: petar });
  const now = makeClock("06:10");
  const app = createApp({ store, now });
  app.setUpisani("1234");
  const request = app.send("upisani");
  assert.deepEqual(request, {
    number: "0641234567",
    text: "BM_22; Petar Petrović\nBroj upisanih birača: 1234",
  });
  assert.deepEqual(store.log.upisani, {
    value: { type: "upisani", upisani: 1234, vanBm: null },
    at: now.millis(),
  });
  assert.deepEqual(store.log, app.getState().log);
  assert.equal(store.drafts.upisani, "");
  assert.deepEqual(app.getState().undo, { type: "upisani", upisani: 1234, vanBm: null });
  assert.equal(app.getState().currentCard, "izlaznost");
});

test("AppViewModelTest.send_upisani_withVanBm", () => {
  const store = createFakeStore({ profile: petar });
  const app = createApp({ store, now: makeClock() });
  app.setUpisani("1234");
  app.setUpisaniVanBm("5");
  assert.equal(
    app.send("upisani")?.text,
    "BM_22; Petar Petrović\nBroj upisanih birača: 1234\nPrijavljeni van BM: 5",
  );
  assert.equal(app.getState().drafts.upisaniVanBm, "");
});

test("AppViewModelTest.send_upisani_invalid", () => {
  const store = createFakeStore({ profile: petar });
  const app = createApp({ store, now: makeClock() });
  assert.equal(app.send("upisani"), null);
  assert.deepEqual(app.getState().issues.upisani, {
    kind: "invalid",
    text: "Upiši broj upisanih birača.",
  });
  app.setUpisani("0");
  assert.equal(app.send("upisani"), null);
  assert.deepEqual(app.getState().issues.upisani, {
    kind: "invalid",
    text: "Broj upisanih mora biti veći od nule.",
  });
  assert.deepEqual(store.log, emptyLog());
  assert.equal(app.getState().undo, null);
});

test("AppViewModelTest.send_izlaznost_usesSuggestedSlot_thenMovesOn", () => {
  const store = createFakeStore({ profile: petar });
  const now = makeClock("10:05");
  const app = createApp({ store, now });
  assert.equal(app.getState().selectedSlot, 10);
  app.setIzlaznost("150");
  assert.deepEqual(app.send("izlaznost"), {
    number: "0641234567",
    text: "BM_22; Petar Petrović\nIzlaznost do 10: 150",
  });
  assert.deepEqual(sentIzlaznost(store.log), { 10: 150 });
  assert.equal(app.getState().selectedSlot, 12);
  assert.equal(store.drafts.izlaznost, "");
  assert.equal(store.drafts.izlaznostSlot, null);
});

test("AppViewModelTest.send_izlaznost_chosenSlot", () => {
  const store = createFakeStore({ profile: petar });
  const now = makeClock("10:05");
  const app = createApp({ store, now });
  app.selectSlot(8);
  app.setIzlaznost("40");
  assert.equal(app.send("izlaznost")?.text, "BM_22; Petar Petrović\nIzlaznost do 08: 40");
  assert.equal(app.getState().selectedSlot, 10);
});

test("AppViewModelTest.send_izlaznost_empty_namesTheSlot", () => {
  const store = createFakeStore({ profile: petar });
  const now = makeClock("10:05");
  const app = createApp({ store, now });
  assert.equal(app.send("izlaznost"), null);
  assert.deepEqual(app.getState().issues.izlaznost, {
    kind: "invalid",
    text: "Upiši koliko je glasalo do 10h.",
  });
});

test("AppViewModelTest.send_izlaznost_warning_thenConfirm", () => {
  const initialLog = record(emptyLog(), { type: "izlaznost", slot: 10, count: 150 }, 1);
  const store = createFakeStore({ profile: petar, log: initialLog });
  const now = makeClock("12:05");
  const app = createApp({ store, now });
  app.setIzlaznost("100");
  assert.equal(app.send("izlaznost"), null);
  assert.deepEqual(app.getState().issues.izlaznost, {
    kind: "warnings",
    warnings: [
      { type: "lowerThanEarlier", slot: 10, value: 150, text: "Manje nego do 10h (150). Proveri broj." },
    ],
  });
  assert.deepEqual(sentIzlaznost(store.log), { 10: 150 });

  const request = app.send("izlaznost", true);
  assert.equal(request?.text, "BM_22; Petar Petrović\nIzlaznost do 12: 100");
  assert.deepEqual(sentIzlaznost(store.log), { 10: 150, 12: 100 });
  assert.equal(app.getState().issues.izlaznost, undefined);
});

test("AppViewModelTest.editingAField_hidesItsIssueOnly", () => {
  const store = createFakeStore({ profile: petar });
  const app = createApp({ store, now: makeClock() });
  app.send("izlaznost");
  app.send("rezultati");
  app.setIzlaznost("5");
  assert.equal(app.getState().issues.izlaznost, undefined);
  assert.deepEqual(app.getState().issues.rezultati, {
    kind: "invalid",
    text: "Upiši oba broja, MI i ONI.",
  });
});

test("AppViewModelTest.selectingASlot_hidesIzlaznostIssue", () => {
  const store = createFakeStore({ profile: petar });
  const app = createApp({ store, now: makeClock() });
  app.send("izlaznost");
  app.selectSlot(12);
  assert.equal(app.getState().issues.izlaznost, undefined);
});

test("AppViewModelTest.send_izlaznost_checksAgainstRegisteredAndLaterSlots", () => {
  let log = emptyLog();
  log = record(log, { type: "upisani", upisani: 1234, vanBm: null }, 1);
  log = record(log, { type: "izlaznost", slot: 14, count: 190 }, 2);
  const store = createFakeStore({ profile: petar, log });
  const now = makeClock("14:20");
  const app = createApp({ store, now });
  app.selectSlot(12);
  app.setIzlaznost("1300");
  assert.equal(app.send("izlaznost"), null);
  assert.deepEqual(app.getState().issues.izlaznost, {
    kind: "warnings",
    warnings: [
      { type: "higherThanLater", slot: 14, value: 190, text: "Više nego do 14h (190). Proveri broj." },
      { type: "moreThanRegistered", registered: 1234, text: "Više od broja upisanih (1234). Proveri broj." },
    ],
  });
});

test("AppViewModelTest.send_vanBm", () => {
  const initialLog = record(emptyLog(), { type: "upisani", upisani: 1234, vanBm: null }, 1);
  const store = createFakeStore({ profile: petar, log: initialLog });
  const app = createApp({ store, now: makeClock() });
  app.setVanBm("7");
  assert.equal(app.send("vanBm")?.text, "BM_22; Petar Petrović\nPrijavljeni van BM: 7");
  assert.equal(store.log.vanBm?.value?.count, 7);
  app.setVanBm("2000");
  assert.equal(app.send("vanBm"), null);
  assert.deepEqual(app.getState().issues.vanBm, {
    kind: "warnings",
    warnings: [
      { type: "moreThanRegistered", registered: 1234, text: "Više od broja upisanih (1234). Proveri broj." },
    ],
  });
});

test("AppViewModelTest.send_vanBm_empty", () => {
  const store = createFakeStore({ profile: petar });
  const app = createApp({ store, now: makeClock() });
  assert.equal(app.send("vanBm"), null);
  assert.deepEqual(app.getState().issues.vanBm, {
    kind: "invalid",
    text: "Upiši broj prijavljenih za glasanje van BM.",
  });
});

test("AppViewModelTest.send_komisija_needsNoInput_andCanBeResent", () => {
  const store = createFakeStore({ profile: petar });
  const app = createApp({ store, now: makeClock() });
  assert.equal(app.send("komisija")?.text, "BM_22; Petar Petrović\nKomisija za glasanje van BM formirana");
  assert.deepEqual(store.log.komisija?.value, { type: "komisija" });
  assert.deepEqual(app.getState().undo, { type: "komisija" });
  assert.equal(app.send("komisija")?.text, "BM_22; Petar Petrović\nKomisija za glasanje van BM formirana");
});

test("AppViewModelTest.send_rezultati", () => {
  const store = createFakeStore({ profile: petar });
  const now = makeClock("21:40");
  const app = createApp({ store, now });
  app.setMi("600");
  app.setOni("0");
  assert.equal(app.send("rezultati")?.text, "BM_22; Petar Petrović\n\nMI - 600\nONI - 0");
  assert.deepEqual(store.log.rezultati?.value, { type: "rezultati", mi: 600, oni: 0 });
  assert.equal(store.drafts.mi, "");
  assert.equal(store.drafts.oni, "");
});

test("AppViewModelTest.send_rezultati_needsBothNumbers", () => {
  const store = createFakeStore({ profile: petar });
  const app = createApp({ store, now: makeClock() });
  app.setMi("600");
  assert.equal(app.send("rezultati"), null);
  assert.deepEqual(app.getState().issues.rezultati, {
    kind: "invalid",
    text: "Upiši oba broja, MI i ONI.",
  });
});

test("AppViewModelTest.send_rezultati_checksAgainstTwentyPlusLatestVanBm", () => {
  let log = emptyLog();
  log = record(log, { type: "upisani", upisani: 1234, vanBm: 5 }, 1);
  log = record(log, { type: "vanBm", count: 10 }, 2);
  log = record(log, { type: "izlaznost", slot: 20, count: 1250 }, 3);
  const store = createFakeStore({ profile: petar, log });
  const now = makeClock("21:40");
  const app = createApp({ store, now });
  app.setMi("600");
  app.setOni("700");
  assert.equal(app.send("rezultati"), null);
  assert.deepEqual(app.getState().issues.rezultati, {
    kind: "warnings",
    warnings: [
      {
        type: "resultsAboveTurnout",
        sum: 1300,
        voted: 1260,
        text: "MI i ONI zajedno (1300) više nego što je glasalo (1260). Proveri brojeve.",
      },
    ],
  });
  assert.equal(app.send("rezultati", true)?.text, "BM_22; Petar Petrović\n\nMI - 600\nONI - 700");
});

test("AppViewModelTest.send_withoutProfile_doesNothing", () => {
  const store = createFakeStore();
  const app = createApp({ store, now: makeClock() });
  assert.equal(app.send("komisija"), null);
  assert.deepEqual(store.log, emptyLog());
});

test("AppViewModelTest.send_usesTheCurrentCoordinator", () => {
  const store = createFakeStore({ profile: petar });
  const app = createApp({ store, now: makeClock() });
  app.openSetup();
  app.saveSetup({ bm: "22", name: "Petar Petrović", coordinatorNumber: "+381 60 111 2222" });
  assert.equal(app.send("komisija")?.number, "+381601112222");
});

// Undo

test("AppViewModelTest.undo_restoresPreviousValueAndDraft", () => {
  const earlier = record(emptyLog(), { type: "izlaznost", slot: 10, count: 150 }, 1);
  const store = createFakeStore({ profile: petar, log: earlier });
  const now = makeClock("10:20");
  const app = createApp({ store, now });
  app.selectSlot(10);
  app.setIzlaznost("155");
  app.send("izlaznost");
  assert.deepEqual(sentIzlaznost(store.log), { 10: 155 });

  app.undo();
  assert.deepEqual(store.log, earlier);
  assert.deepEqual(app.getState().log, earlier);
  assert.equal(store.drafts.izlaznost, "155");
  assert.equal(store.drafts.izlaznostSlot, 10);
  assert.equal(app.getState().selectedSlot, 10);
  assert.equal(app.getState().undo, null);
});

test("AppViewModelTest.undo_isAboutTheLatestSendOnly", () => {
  const store = createFakeStore({ profile: petar });
  const app = createApp({ store, now: makeClock() });
  app.setVanBm("7");
  app.send("vanBm");
  app.send("komisija");
  assert.deepEqual(app.getState().undo, { type: "komisija" });
  app.undo();
  assert.equal(store.log.komisija, null);
  assert.equal(store.log.vanBm?.value?.count, 7);
  assert.equal(app.getState().undo, null);
});

test("AppViewModelTest.undo_survivesANewViewModel", () => {
  const store = createFakeStore({ profile: petar });
  const now = makeClock("10:05");
  const first = createApp({ store, now });
  first.setVanBm("7");
  first.send("vanBm");

  const again = createApp({ store, now });
  assert.deepEqual(again.getState().undo, { type: "vanBm", count: 7 });
  again.undo();
  assert.equal(store.log.vanBm, null);
  assert.equal(store.drafts.vanBm, "7");
  assert.equal(store.undo, null);
  assert.equal(again.getState().undo, null);
});

test("AppViewModelTest.dismissUndo_isRemembered", () => {
  const store = createFakeStore({ profile: petar });
  const now = makeClock("10:05");
  const app = createApp({ store, now });
  app.send("komisija");
  app.dismissUndo();
  assert.equal(store.undo, null);
  assert.equal(createApp({ store, now }).getState().undo, null);
});

// Editing a sent Upisani

test("AppViewModelTest.editUpisani_prefillsTheSentNumbers", () => {
  const log = record(emptyLog(), { type: "upisani", upisani: 1234, vanBm: 5 }, 1);
  const store = createFakeStore({ profile: petar, log });
  const now = makeClock("06:30");
  const app = createApp({ store, now });
  assert.equal(app.getState().editingUpisani, false);
  app.editUpisani();
  assert.equal(app.getState().editingUpisani, true);
  assert.equal(app.getState().drafts.upisani, "1234");
  assert.equal(app.getState().drafts.upisaniVanBm, "5");
});

test("AppViewModelTest.editUpisani_keepsWhatWasAlreadyTyped", () => {
  const log = record(emptyLog(), { type: "upisani", upisani: 1234, vanBm: 5 }, 1);
  const drafts = { ...emptyDrafts(), upisani: "1240" };
  const store = createFakeStore({ profile: petar, log, drafts });
  const now = makeClock("06:30");
  const app = createApp({ store, now });
  app.editUpisani();
  assert.equal(app.getState().drafts.upisani, "1240");
  assert.equal(app.getState().drafts.upisaniVanBm, "");
});

test("AppViewModelTest.editUpisani_staysOpenUntilASendSucceeds", () => {
  const log = record(emptyLog(), { type: "upisani", upisani: 1234, vanBm: 5 }, 1);
  const store = createFakeStore({ profile: petar, log });
  const now = makeClock("06:30");
  const app = createApp({ store, now });
  app.editUpisani();
  app.setUpisani("");
  assert.equal(app.send("upisani"), null);
  assert.equal(app.getState().editingUpisani, true);
  app.setUpisani("1240");
  assert.equal(
    app.send("upisani")?.text,
    "BM_22; Petar Petrović\nBroj upisanih birača: 1240\nPrijavljeni van BM: 5",
  );
  assert.equal(app.getState().editingUpisani, false);
});

test("AppViewModelTest.cancelEditUpisani_closesAndClearsTheFields", () => {
  const log = record(emptyLog(), { type: "upisani", upisani: 1234, vanBm: 5 }, 1);
  const store = createFakeStore({ profile: petar, log });
  const now = makeClock("06:30");
  const app = createApp({ store, now });
  app.editUpisani();
  app.setUpisani("");
  assert.equal(app.send("upisani"), null);
  app.cancelEditUpisani();
  assert.equal(app.getState().editingUpisani, false);
  assert.equal(store.drafts.upisani, "");
  assert.equal(store.drafts.upisaniVanBm, "");
  assert.equal(app.getState().issues.upisani, undefined);
});

test("AppViewModelTest.dismissUndo_keepsTheLog", () => {
  const store = createFakeStore({ profile: petar });
  const app = createApp({ store, now: makeClock("10:05") });
  app.send("komisija");
  app.dismissUndo();
  assert.equal(app.getState().undo, null);
  assert.deepEqual(store.log.komisija?.value, { type: "komisija" });
  app.undo();
  assert.deepEqual(store.log.komisija?.value, { type: "komisija" });
});
