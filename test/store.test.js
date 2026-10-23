import assert from "node:assert/strict";
import { test } from "./harness.js";
import { createStore } from "../src/store.js";
import { emptyDrafts, emptyLog, record } from "../src/domain.js";

function createFakeStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

let fullLog = emptyLog();
fullLog = record(fullLog, { type: "upisani", upisani: 1234, vanBm: null }, 1000);
fullLog = record(fullLog, { type: "izlaznost", slot: 8, count: 50 }, 2000);
fullLog = record(fullLog, { type: "izlaznost", slot: 19, count: 900 }, 3000);
fullLog = record(fullLog, { type: "vanBm", count: 7 }, 4000);
fullLog = record(fullLog, { type: "komisija" }, 5000);
fullLog = record(fullLog, { type: "rezultati", mi: 600, oni: 0 }, 6000);

test("PrefsStoreTest.freshStore_isEmpty", () => {
  const s = createStore(createFakeStorage());
  assert.equal(s.loadProfile(), null);
  assert.deepEqual(s.loadLog(), emptyLog());
  assert.deepEqual(s.loadDrafts(), emptyDrafts());
  assert.equal(s.loadUndo(), null);
});

test("PrefsStoreTest.profile_roundTrip_withAndWithoutCoordinatorName", () => {
  const s = createStore(createFakeStorage());
  const withName = {
    bm: "07",
    name: "Đorđe Šćekić",
    coordinatorNumber: "+381641234567",
    coordinatorName: "Marko Ž.",
  };
  s.saveProfile(withName);
  assert.deepEqual(s.loadProfile(), withName);

  const withoutName = { ...withName, coordinatorName: null };
  s.saveProfile(withoutName);
  assert.deepEqual(s.loadProfile(), withoutName);
});

test("PrefsStoreTest.log_roundTrip_survivesANewInstance", () => {
  const storage = createFakeStorage();
  createStore(storage).saveLog(fullLog);
  assert.deepEqual(createStore(storage).loadLog(), fullLog);
});

test("PrefsStoreTest.log_roundTrip_upisaniWithVanBm", () => {
  const storage = createFakeStorage();
  const log = record(emptyLog(), { type: "upisani", upisani: 1234, vanBm: 0 }, 1000);
  createStore(storage).saveLog(log);
  assert.deepEqual(createStore(storage).loadLog(), log);
});

test("PrefsStoreTest.log_savingASmallerLog_dropsWhatIsGone", () => {
  const storage = createFakeStorage();
  const s = createStore(storage);
  s.saveLog(fullLog);
  const smaller = record(emptyLog(), { type: "izlaznost", slot: 10, count: 150 }, 9000);
  s.saveLog(smaller);
  assert.deepEqual(s.loadLog(), smaller);
  s.saveLog(emptyLog());
  assert.deepEqual(s.loadLog(), emptyLog());
});

test("PrefsStoreTest.drafts_roundTrip", () => {
  const storage = createFakeStorage();
  const s = createStore(storage);
  const drafts = {
    upisani: "1234",
    upisaniVanBm: "5",
    izlaznost: "12",
    izlaznostSlot: 14,
    vanBm: "8",
    mi: "600",
    oni: "",
    izlaznostSlotFor: 12,
  };
  s.saveDrafts(drafts);
  assert.deepEqual(s.loadDrafts(), drafts);
  s.saveDrafts(emptyDrafts());
  assert.deepEqual(s.loadDrafts(), emptyDrafts());
});

test("PrefsStoreTest.undo_roundTrip_everyReportKind", () => {
  const storage = createFakeStorage();
  const s = createStore(storage);
  const pending = {
    report: { type: "izlaznost", slot: 10, count: 155 },
    log: fullLog,
    drafts: { ...emptyDrafts(), izlaznost: "155", izlaznostSlot: 10, izlaznostSlotFor: 12 },
  };
  s.saveUndo(pending);
  assert.deepEqual(s.loadUndo(), pending);

  const reports = [
    { type: "upisani", upisani: 1234, vanBm: null },
    { type: "upisani", upisani: 1, vanBm: 0 },
    { type: "vanBm", count: 7 },
    { type: "komisija" },
    { type: "rezultati", mi: 1, oni: 2 },
  ];
  for (const it of reports) {
    s.saveUndo({ ...pending, report: it });
    assert.deepEqual(s.loadUndo()?.report, it);
  }
  s.saveUndo({ ...pending, log: emptyLog(), drafts: emptyDrafts() });
  assert.deepEqual(s.loadUndo()?.log, emptyLog());
  assert.deepEqual(s.loadUndo()?.drafts, emptyDrafts());
  s.saveUndo(null);
  assert.equal(s.loadUndo(), null);
});

test("PrefsStoreTest.undo_isSeparateFromTheLogAndDrafts", () => {
  const storage = createFakeStorage();
  const s = createStore(storage);
  const drafts = { ...emptyDrafts(), mi: "1" };
  s.saveLog(emptyLog());
  s.saveDrafts(drafts);
  s.saveUndo({ report: { type: "komisija" }, log: fullLog, drafts: { ...emptyDrafts(), vanBm: "9" } });
  assert.deepEqual(s.loadLog(), emptyLog());
  assert.deepEqual(s.loadDrafts(), drafts);
  s.saveLog(fullLog);
  s.saveUndo(null);
  assert.deepEqual(s.loadLog(), fullLog);
});

test("PrefsStoreTest.savingOneThing_keepsTheOthers", () => {
  const storage = createFakeStorage();
  const s = createStore(storage);
  const profile = { bm: "22", name: "Petar Petrović", coordinatorNumber: "0641234567", coordinatorName: null };
  const drafts = { ...emptyDrafts(), mi: "1" };
  s.saveProfile(profile);
  s.saveLog(fullLog);
  s.saveDrafts(drafts);

  s.saveProfile({ ...profile, name: "Ana Kobaš" });
  assert.deepEqual(s.loadLog(), fullLog);
  assert.deepEqual(s.loadDrafts(), drafts);

  s.saveLog(emptyLog());
  assert.equal(s.loadProfile()?.name, "Ana Kobaš");
  assert.deepEqual(s.loadDrafts(), drafts);
});

test("PrefsStoreTest.brokenJson_loadsDefaults", () => {
  const storage = createFakeStorage();
  storage.setItem("sms_izbori.profile", "broken json {");
  storage.setItem("sms_izbori.log", "{ not: json");
  storage.setItem("sms_izbori.drafts", "invalid JSON");
  storage.setItem("sms_izbori.undo", "{");
  const s = createStore(storage);
  assert.equal(s.loadProfile(), null);
  assert.deepEqual(s.loadLog(), emptyLog());
  assert.deepEqual(s.loadDrafts(), emptyDrafts());
  assert.equal(s.loadUndo(), null);
});

test("PrefsStoreTest.getItemThrowing_loadsDefaults", () => {
  const storage = {
    getItem: () => {
      throw new Error("Storage blocked");
    },
    setItem: () => {},
    removeItem: () => {},
  };
  const s = createStore(storage);
  assert.equal(s.loadProfile(), null);
  assert.deepEqual(s.loadLog(), emptyLog());
  assert.deepEqual(s.loadDrafts(), emptyDrafts());
  assert.equal(s.loadUndo(), null);
});

test("PrefsStoreTest.setItemThrowing_doesNotThrowOutOfSave", () => {
  const storage = {
    getItem: () => null,
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
    removeItem: () => {
      throw new Error("Storage blocked");
    },
  };
  const s = createStore(storage);
  assert.doesNotThrow(() => {
    s.saveProfile({ bm: "22", name: "Petar", coordinatorNumber: "0641234567", coordinatorName: null });
    s.saveLog(emptyLog());
    s.saveDrafts(emptyDrafts());
    s.saveUndo(null);
    s.saveProfile(null);
  });
});

test("PrefsStoreTest.olderSavedValues_getTheMissingFields", () => {
  const storage = createFakeStorage();
  storage.setItem("sms_izbori.drafts", JSON.stringify({ izlaznost: "12", izlaznostSlot: 10 }));
  storage.setItem("sms_izbori.log", JSON.stringify({ komisija: { value: { type: "komisija" }, at: 5 } }));
  const s = createStore(storage);
  assert.deepEqual(s.loadDrafts(), { ...emptyDrafts(), izlaznost: "12", izlaznostSlot: 10 });
  assert.deepEqual(s.loadLog(), record(emptyLog(), { type: "komisija" }, 5));
});
