import { emptyDrafts, emptyLog } from "./domain.js";

const PROFILE_KEY = "sms_izbori.profile";
const LOG_KEY = "sms_izbori.log";
const DRAFTS_KEY = "sms_izbori.drafts";
const UNDO_KEY = "sms_izbori.undo";

function safeGet(storage, key) {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeSet(storage, key, value) {
  try {
    storage?.setItem(key, value);
  } catch {}
}

function safeRemove(storage, key) {
  try {
    storage?.removeItem(key);
  } catch {}
}

function mergeLog(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return emptyLog();
  }
  const empty = emptyLog();
  return {
    upisani: parsed.upisani !== undefined ? parsed.upisani : empty.upisani,
    izlaznost: {
      ...empty.izlaznost,
      ...(parsed.izlaznost && typeof parsed.izlaznost === "object" ? parsed.izlaznost : {}),
    },
    vanBm: parsed.vanBm !== undefined ? parsed.vanBm : empty.vanBm,
    komisija: parsed.komisija !== undefined ? parsed.komisija : empty.komisija,
    rezultati: parsed.rezultati !== undefined ? parsed.rezultati : empty.rezultati,
  };
}

function mergeDrafts(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return emptyDrafts();
  }
  return {
    ...emptyDrafts(),
    ...parsed,
  };
}

function mergeUndo(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !parsed.report) {
    return null;
  }
  return {
    ...parsed,
    log: parsed.log ? mergeLog(parsed.log) : emptyLog(),
    drafts: parsed.drafts ? mergeDrafts(parsed.drafts) : emptyDrafts(),
  };
}

/**
 * Creates a store backed by localStorage or a Storage-compatible interface.
 *
 * Every access is wrapped in try/catch so storage issues never block sending.
 */
export function createStore(storage = typeof localStorage !== "undefined" ? localStorage : null) {
  return {
    loadProfile() {
      const raw = safeGet(storage, PROFILE_KEY);
      if (raw == null) return null;
      try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },

    saveProfile(profile) {
      if (profile == null) {
        safeRemove(storage, PROFILE_KEY);
      } else {
        safeSet(storage, PROFILE_KEY, JSON.stringify(profile));
      }
    },

    loadLog() {
      const raw = safeGet(storage, LOG_KEY);
      if (raw == null) return emptyLog();
      try {
        return mergeLog(JSON.parse(raw));
      } catch {
        return emptyLog();
      }
    },

    saveLog(log) {
      safeSet(storage, LOG_KEY, JSON.stringify(log));
    },

    loadDrafts() {
      const raw = safeGet(storage, DRAFTS_KEY);
      if (raw == null) return emptyDrafts();
      try {
        return mergeDrafts(JSON.parse(raw));
      } catch {
        return emptyDrafts();
      }
    },

    saveDrafts(drafts) {
      safeSet(storage, DRAFTS_KEY, JSON.stringify(drafts));
    },

    loadUndo() {
      const raw = safeGet(storage, UNDO_KEY);
      if (raw == null) return null;
      try {
        return mergeUndo(JSON.parse(raw));
      } catch {
        return null;
      }
    },

    saveUndo(undo) {
      if (undo == null) {
        safeRemove(storage, UNDO_KEY);
      } else {
        safeSet(storage, UNDO_KEY, JSON.stringify(undo));
      }
    },
  };
}
