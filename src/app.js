import {
  checks,
  currentCard,
  ELECTION_DAY,
  emptyDrafts,
  emptyLog,
  entryFor,
  latestVanBm,
  normalizeBm,
  normalizeName,
  normalizePhone,
  parseCount,
  record,
  registered,
  reportText,
  sentIzlaznost,
  sentSince,
  sentSlots,
  slotLabel,
  suggestedSlot,
} from "./domain.js";

function getMinutes(now) {
  const d = now();
  return d.getHours() * 60 + d.getMinutes();
}

function digits(text) {
  return String(text ?? "").replace(/[^0-9]/g, "").slice(0, 5);
}

function withoutIssue(issues, action) {
  const next = { ...issues };
  delete next[action];
  return next;
}

function calculateWithClock(currentState, store, now) {
  const minutes = getMinutes(now);
  const suggested = suggestedSlot(minutes, sentSlots(currentState.log));
  // A chosen hour holds until the suggestion moves on; an hour with a count typed for it holds until the
  // count is sent or cleared, so a count typed at 18:44 for 18h isn't sent as 19h at 18:45.
  const expired =
    currentState.drafts.izlaznostSlot != null &&
    currentState.drafts.izlaznostSlotFor !== suggested &&
    !currentState.drafts.izlaznost;
  let nextDrafts = currentState.drafts;
  if (expired) {
    nextDrafts = { ...nextDrafts, izlaznostSlot: null, izlaznostSlotFor: null };
    store.saveDrafts(nextDrafts);
  }
  return {
    ...currentState,
    drafts: nextDrafts,
    selectedSlot: nextDrafts.izlaznostSlot ?? suggested,
    currentCard: currentCard(minutes, currentState.log),
  };
}

function clearDraftsForAction(drafts, action) {
  switch (action) {
    case "upisani":
      return { ...drafts, upisani: "", upisaniVanBm: "" };
    case "izlaznost":
      return { ...drafts, izlaznost: "", izlaznostSlot: null, izlaznostSlotFor: null };
    case "vanBm":
      return { ...drafts, vanBm: "" };
    case "komisija":
      return drafts;
    case "rezultati":
      return { ...drafts, mi: "", oni: "" };
    default:
      return drafts;
  }
}

function prepareUpisani(drafts) {
  const upisani = parseCount(drafts.upisani);
  if (upisani == null) {
    return { kind: "bad", text: "Upiši broj upisanih birača." };
  }
  if (upisani < 1) {
    return { kind: "bad", text: "Broj upisanih mora biti veći od nule." };
  }
  return {
    kind: "ready",
    report: { type: "upisani", upisani, vanBm: parseCount(drafts.upisaniVanBm) },
    warnings: [],
  };
}

function prepareIzlaznost(current) {
  const slot = current.selectedSlot;
  const count = parseCount(current.drafts.izlaznost);
  if (count == null) {
    return { kind: "bad", text: `Upiši koliko je glasalo do ${slotLabel(slot)}h.` };
  }
  const warnings = checks.izlaznost(
    slot,
    count,
    sentIzlaznost(current.log),
    registered(current.log),
  );
  return {
    kind: "ready",
    report: { type: "izlaznost", slot, count },
    warnings,
  };
}

function prepareVanBm(current) {
  const count = parseCount(current.drafts.vanBm);
  if (count == null) {
    return { kind: "bad", text: "Upiši broj prijavljenih za glasanje van BM." };
  }
  const warnings = checks.vanBm(count, registered(current.log));
  return {
    kind: "ready",
    report: { type: "vanBm", count },
    warnings,
  };
}

function prepareRezultati(current) {
  const mi = parseCount(current.drafts.mi);
  const oni = parseCount(current.drafts.oni);
  if (mi == null || oni == null) {
    return { kind: "bad", text: "Upiši oba broja, MI i ONI." };
  }
  const warnings = checks.rezultati(
    mi,
    oni,
    sentIzlaznost(current.log),
    latestVanBm(current.log),
  );
  return {
    kind: "ready",
    report: { type: "rezultati", mi, oni },
    warnings,
  };
}

/**
 * Creates the app state and actions controller, ported from AppViewModel.
 */
export function createApp({ store, now = () => new Date(), electionDay = ELECTION_DAY }) {
  const initialProfile = store.loadProfile();
  const pendingUndo = store.loadUndo();

  let state = calculateWithClock(
    {
      profile: initialProfile,
      showSetup: initialProfile == null,
      log: store.loadLog(),
      drafts: store.loadDrafts(),
      selectedSlot: 8,
      currentCard: "upisani",
      issues: {},
      undo: pendingUndo?.report ?? null,
      editingUpisani: false,
    },
    store,
    now,
  );

  let currentPendingUndo = pendingUndo;
  const listeners = new Set();

  // From election day on, the reports sent before it were tests (sending one the evening before was
  // advised), and the day's real ones must not look done already: they are dropped, and a question
  // still open about one of them with them. Before the day nothing changes, so a test shows as sent.
  // What was typed before the day, or put back by "Odustani" after a test, is cleared once when the
  // day begins, or a test count would wait in its field, holding its hour (20h the evening before).
  function withoutTests(s) {
    if (now().getTime() < electionDay) return s;
    let next = s;
    if (!store.loadDayStarted()) {
      store.saveDayStarted();
      store.saveDrafts(emptyDrafts());
      next = { ...next, drafts: emptyDrafts(), issues: {}, editingUpisani: false };
    }
    const log = sentSince(next.log, electionDay);
    if (log === next.log) return next;
    store.saveLog(log);
    let undo = next.undo;
    if (undo != null && entryFor(log, undo) == null) {
      currentPendingUndo = null;
      store.saveUndo(null);
      undo = null;
    }
    return { ...next, log, undo };
  }

  state = calculateWithClock(withoutTests(state), store, now);

  function update(change) {
    state = calculateWithClock(withoutTests(change(state)), store, now);
    for (const listener of listeners) {
      listener(state);
    }
  }

  function edit(action, change) {
    const nextDrafts = change(state.drafts);
    store.saveDrafts(nextDrafts);
    update((s) => ({
      ...s,
      drafts: nextDrafts,
      issues: withoutIssue(s.issues, action),
    }));
  }

  return {
    getState() {
      return state;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    saveSetup(input) {
      const bm = normalizeBm(input.bm);
      const name = normalizeName(input.name);
      const number = normalizePhone(input.coordinatorNumber);
      if (bm == null || name == null || number == null) {
        const errors = [];
        if (bm == null) errors.push("bm");
        if (name == null) errors.push("name");
        if (number == null) errors.push("number");
        return errors;
      }
      const coordinatorName = input.coordinatorName != null ? normalizeName(input.coordinatorName) : null;
      const profile = {
        bm,
        name,
        coordinatorNumber: number,
        coordinatorName,
      };
      store.saveProfile(profile);
      update((s) => ({ ...s, profile, showSetup: false }));
      return [];
    },

    openSetup() {
      update((s) => ({ ...s, showSetup: true }));
    },

    closeSetup() {
      if (state.profile == null) return;
      update((s) => ({ ...s, showSetup: false }));
    },

    clearReports() {
      currentPendingUndo = null;
      store.saveUndo(null);
      const newLog = emptyLog();
      const newDrafts = emptyDrafts();
      store.saveLog(newLog);
      store.saveDrafts(newDrafts);
      update((s) => ({
        ...s,
        log: newLog,
        drafts: newDrafts,
        issues: {},
        undo: null,
      }));
    },

    setUpisani(text) {
      edit("upisani", (d) => ({ ...d, upisani: digits(text) }));
    },

    setUpisaniVanBm(text) {
      edit("upisani", (d) => ({ ...d, upisaniVanBm: digits(text) }));
    },

    setIzlaznost(text) {
      const count = digits(text);
      // The hour on screen when a count is typed is kept with it (see calculateWithClock).
      edit("izlaznost", (d) =>
        count === "" || d.izlaznostSlot != null
          ? { ...d, izlaznost: count }
          : { ...d, izlaznost: count, izlaznostSlot: state.selectedSlot, izlaznostSlotFor: state.selectedSlot },
      );
    },

    setVanBm(text) {
      edit("vanBm", (d) => ({ ...d, vanBm: digits(text) }));
    },

    setMi(text) {
      edit("rezultati", (d) => ({ ...d, mi: digits(text) }));
    },

    setOni(text) {
      edit("rezultati", (d) => ({ ...d, oni: digits(text) }));
    },

    selectSlot(slot) {
      const minutes = getMinutes(now);
      const suggested = suggestedSlot(minutes, sentSlots(state.log));
      // Tapping the suggested hour is no choice, except with a count typed: that keeps its hour.
      if (slot === suggested && !state.drafts.izlaznost) {
        edit("izlaznost", (d) => ({ ...d, izlaznostSlot: null, izlaznostSlotFor: null }));
      } else {
        edit("izlaznost", (d) => ({ ...d, izlaznostSlot: slot, izlaznostSlotFor: suggested }));
      }
    },

    editUpisani() {
      const current = state;
      const sent = current.log.upisani?.value;
      let drafts = current.drafts;
      if (sent != null && drafts.upisani === "" && drafts.upisaniVanBm === "") {
        drafts = {
          ...drafts,
          upisani: String(sent.upisani),
          upisaniVanBm: sent.vanBm != null ? String(sent.vanBm) : "",
        };
        store.saveDrafts(drafts);
      }
      update((s) => ({ ...s, drafts, editingUpisani: true }));
    },

    cancelEditUpisani() {
      const drafts = { ...state.drafts, upisani: "", upisaniVanBm: "" };
      store.saveDrafts(drafts);
      update((s) => ({
        ...s,
        drafts,
        editingUpisani: false,
        issues: withoutIssue(s.issues, "upisani"),
      }));
    },

    // Every minute and on coming back. The installed app and a browser tab share what is saved, so
    // what another copy sent or answered in the meantime is read again first.
    refresh() {
      const savedUndo = store.loadUndo();
      currentPendingUndo = savedUndo;
      update((s) => ({
        ...s,
        profile: store.loadProfile() ?? s.profile,
        log: store.loadLog(),
        drafts: store.loadDrafts(),
        undo: savedUndo?.report ?? null,
      }));
    },

    send(action, confirmed = false) {
      const current = state;
      const profile = current.profile;
      if (profile == null) return null;

      let prepared;
      switch (action) {
        case "upisani":
          prepared = prepareUpisani(current.drafts);
          break;
        case "izlaznost":
          prepared = prepareIzlaznost(current);
          break;
        case "vanBm":
          prepared = prepareVanBm(current);
          break;
        case "komisija":
          prepared = { kind: "ready", report: { type: "komisija" }, warnings: [] };
          break;
        case "rezultati":
          prepared = prepareRezultati(current);
          break;
        default:
          return null;
      }

      if (prepared.kind === "bad") {
        update((s) => ({
          ...s,
          issues: { ...s.issues, [action]: { kind: "invalid", text: prepared.text } },
        }));
        return null;
      }

      if (prepared.warnings.length > 0 && !confirmed) {
        update((s) => ({
          ...s,
          issues: { ...s.issues, [action]: { kind: "warnings", warnings: prepared.warnings } },
        }));
        return null;
      }

      const report = prepared.report;
      const at = now().getTime();
      const nextLog = record(current.log, report, at);
      const nextDrafts = clearDraftsForAction(current.drafts, action);

      currentPendingUndo = {
        report,
        log: current.log,
        drafts: current.drafts,
      };
      store.saveUndo(currentPendingUndo);
      store.saveLog(nextLog);
      store.saveDrafts(nextDrafts);

      update((s) => ({
        ...s,
        log: nextLog,
        drafts: nextDrafts,
        issues: withoutIssue(s.issues, action),
        undo: report,
        editingUpisani: s.editingUpisani && action !== "upisani",
      }));

      return {
        number: profile.coordinatorNumber,
        text: reportText(report, profile),
      };
    },

    undo() {
      const previous = currentPendingUndo;
      if (!previous) return;
      currentPendingUndo = null;
      store.saveUndo(null);
      store.saveLog(previous.log);
      store.saveDrafts(previous.drafts);
      // A cancelled change to a sent Upisani stays open, so the number put back in its field is seen.
      update((s) => ({
        ...s,
        log: previous.log,
        drafts: previous.drafts,
        undo: null,
        editingUpisani: s.editingUpisani || (previous.report.type === "upisani" && previous.log.upisani != null),
      }));
    },

    dismissUndo() {
      currentPendingUndo = null;
      store.saveUndo(null);
      update((s) => ({
        ...s,
        undo: null,
      }));
    },
  };
}
