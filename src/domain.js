/** The hours of day at which izlaznost is reported, in checklist order. */
export const SLOTS = [8, 10, 12, 14, 16, 18, 19, 20];

/** The hour as always two digits, as used in the message text. */
export function slotLabel(slot) {
  return String(slot).padStart(2, "0");
}

/** The cards of the main screen, in the order of the day. */
export const CARDS = ["upisani", "izlaznost", "vanBm", "rezultati"];

/** All sendable action kinds. */
export const ACTIONS = ["upisani", "izlaznost", "vanBm", "komisija", "rezultati"];

/** A whole number 0–99999; leading zeros are dropped. */
export function parseCount(text) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!/^[0-9]+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (!Number.isSafeInteger(n) || n < 0 || n > 99999) return null;
  return n;
}

/** 1–4 digits, kept exactly as typed ("07" stays "07"). */
export function normalizeBm(text) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  return /^[0-9]{1,4}$/.test(trimmed) ? trimmed : null;
}

/** Trimmed, inner whitespace collapsed to one space; blank is invalid. */
export function normalizeName(text) {
  if (typeof text !== "string") return null;
  const collapsed = text.trim().replace(/\s+/g, " ");
  return collapsed.length > 0 ? collapsed : null;
}

/**
 * 6–15 digits after removing spaces, dashes, dots, slashes ("064/123-4567") and parentheses, and the
 * invisible direction marks that contacts and copied text can carry; one leading + is allowed.
 */
export function normalizePhone(text) {
  if (typeof text !== "string") return null;
  const stripped = text.replace(/[\s\-.()/\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "");
  return /^\+?[0-9]{6,15}$/.test(stripped) ? stripped : null;
}

/** The header starting every message: "BM_{bm}; {name}". */
export function header(profile) {
  return `BM_${profile.bm}; ${profile.name}`;
}

/** The exact SMS texts for each report kind (SPEC: The messages). */
export const messages = {
  /** The van BM line is added only when that field was filled. */
  upisani(profile, upisani, vanBm) {
    const text = `${header(profile)}\nBroj upisanih birača: ${upisani}`;
    return vanBm != null ? `${text}\nPrijavljeni van BM: ${vanBm}` : text;
  },

  /** Izlaznost with two-digit hour. */
  izlaznost(profile, slot, count) {
    return `${header(profile)}\nIzlaznost do ${slotLabel(slot)}: ${count}`;
  },

  /** Van BM count when reported separately. */
  vanBm(profile, count) {
    return `${header(profile)}\nPrijavljeni van BM: ${count}`;
  },

  /** Formed commission report. */
  komisija(profile) {
    return `${header(profile)}\nKomisija za glasanje van BM formirana`;
  },

  /** Results message with a blank line after the header. */
  rezultati(profile, mi, oni) {
    return `${header(profile)}\n\nMI - ${mi}\nONI - ${oni}`;
  },
};

/** Short label for a report, shown in the "sent" bar and history. */
export function reportLabel(report) {
  switch (report.type) {
    case "upisani":
      return `Broj upisanih (${report.upisani})`;
    case "izlaznost":
      return `Izlaznost do ${slotLabel(report.slot)}h (${report.count})`;
    case "vanBm":
      return `Prijavljeni van BM (${report.count})`;
    case "komisija":
      return "Komisija van BM formirana";
    case "rezultati":
      return `Rezultati (MI ${report.mi}, ONI ${report.oni})`;
    default:
      return "";
  }
}

/** The full SMS message for a report. */
export function reportText(report, profile) {
  switch (report.type) {
    case "upisani":
      return messages.upisani(profile, report.upisani, report.vanBm);
    case "izlaznost":
      return messages.izlaznost(profile, report.slot, report.count);
    case "vanBm":
      return messages.vanBm(profile, report.count);
    case "komisija":
      return messages.komisija(profile);
    case "rezultati":
      return messages.rezultati(profile, report.mi, report.oni);
    default:
      return "";
  }
}

/** An empty report log with no reports sent yet. */
/**
 * When election day starts for the app: 3 in the morning of 2026-10-25, on the phone's clock. Nobody uses
 * it then (polling stations open at 7), so a test sent around midnight doesn't vanish from a screen in
 * use. The clocks go back from 3 to 2 that night: the hour after 2 comes twice, and then 3 comes once.
 */
export const ELECTION_DAY = new Date(2026, 9, 25, 3, 0).getTime();

/**
 * The log without the reports sent before `since` (epoch ms), or the same log when there are none.
 * A test sent before election day must not count as the real report on the day.
 */
export function sentSince(log, since) {
  const keep = (entry) => entry == null || entry.at >= since;
  const izlaznost = Object.fromEntries(Object.entries(log.izlaznost ?? {}).filter(([, entry]) => keep(entry)));
  const dropped =
    !keep(log.upisani) || !keep(log.vanBm) || !keep(log.komisija) || !keep(log.rezultati) ||
    Object.keys(izlaznost).length !== Object.keys(log.izlaznost ?? {}).length;
  if (!dropped) return log;
  return {
    ...log,
    upisani: keep(log.upisani) ? log.upisani : null,
    izlaznost,
    vanBm: keep(log.vanBm) ? log.vanBm : null,
    komisija: keep(log.komisija) ? log.komisija : null,
    rezultati: keep(log.rezultati) ? log.rezultati : null,
  };
}

/** The log's entry for a report, by its type (and hour). */
export function entryFor(log, report) {
  return report.type === "izlaznost" ? log.izlaznost?.[report.slot] : log[report.type];
}

export function emptyLog() {
  return {
    upisani: null,
    izlaznost: {},
    vanBm: null,
    komisija: null,
    rezultati: null,
  };
}

/** Returns a new log with the report recorded at the given epoch timestamp. */
export function record(log, report, at) {
  switch (report.type) {
    case "upisani":
      return { ...log, upisani: { value: report, at } };
    case "izlaznost":
      return {
        ...log,
        izlaznost: {
          ...log.izlaznost,
          [report.slot]: { value: report, at },
        },
      };
    case "vanBm":
      return { ...log, vanBm: { value: report, at } };
    case "komisija":
      return { ...log, komisija: { value: report, at } };
    case "rezultati":
      return { ...log, rezultati: { value: report, at } };
    default:
      return log;
  }
}

/** Map of slot numbers to counts for all sent izlaznost reports. */
export function sentIzlaznost(log) {
  const res = {};
  if (log?.izlaznost) {
    for (const [slot, entry] of Object.entries(log.izlaznost)) {
      if (entry?.value != null) {
        res[slot] = entry.value.count;
      }
    }
  }
  return res;
}

/** The registered voter count if sent, else null. */
export function registered(log) {
  return log?.upisani?.value?.upisani ?? null;
}

/** The latest sent van BM count from either the Upisani report or the Van BM report. */
export function latestVanBm(log) {
  const fromUpisani = log?.upisani?.value?.vanBm != null ? log.upisani : null;
  const fromVanBm = log?.vanBm ?? null;
  if (!fromUpisani) return fromVanBm?.value?.count ?? null;
  if (!fromVanBm || fromUpisani.at > fromVanBm.at) return fromUpisani.value.vanBm;
  return fromVanBm.value.count;
}

/** Sorted list of slot numbers that have been sent. */
export function sentSlots(log) {
  if (!log?.izlaznost) return [];
  return Object.keys(log.izlaznost)
    .map(Number)
    .filter((s) => !Number.isNaN(s))
    .sort((a, b) => a - b);
}

/** Which izlaznost slot to preselect based on the current time and sent slots. */
export function suggestedSlot(minutes, sentSlots = []) {
  const sent = new Set(sentSlots);
  let due;
  if (minutes < 300) {
    due = 20;
  } else {
    due = 8;
    for (let i = SLOTS.length - 1; i >= 0; i--) {
      const s = SLOTS[i];
      if (minutes >= s * 60 - 15) {
        due = s;
        break;
      }
    }
  }
  if (!sent.has(due)) return due;
  const dueIndex = SLOTS.indexOf(due);
  for (let i = dueIndex + 1; i < SLOTS.length; i++) {
    if (!sent.has(SLOTS[i])) return SLOTS[i];
  }
  return due;
}

/** Which card is active ("Sada") based on time of day and reports sent. */
export function currentCard(minutes, log) {
  if (minutes < 300) return "rezultati";
  if (minutes < 420) return log?.upisani ? "izlaznost" : "upisani";
  if (minutes < 1200) return "izlaznost";
  const twentySent = Boolean(log?.izlaznost && (log.izlaznost[20] || log.izlaznost["20"]));
  if (minutes < 1230 && !twentySent) return "izlaznost";
  return "rezultati";
}

/** Sanity checks run when the user taps Send; they only warn. */
export const checks = {
  /**
   * Compares with earlier and later sent slots, then with upisani.
   * Names the latest earlier slot that is higher and the earliest later slot that is lower.
   */
  izlaznost(slot, count, sent = {}, upisani = null) {
    const warnings = [];
    const slotNum = Number(slot);
    let higherEarlier = null;
    let lowerLater = null;

    for (const [key, value] of Object.entries(sent)) {
      const s = Number(key);
      if (s === slotNum) continue;
      if (s < slotNum && value > count) {
        if (higherEarlier === null || s > higherEarlier.slot) {
          higherEarlier = { slot: s, value };
        }
      }
      if (s > slotNum && value < count) {
        if (lowerLater === null || s < lowerLater.slot) {
          lowerLater = { slot: s, value };
        }
      }
    }

    if (higherEarlier) {
      warnings.push({
        type: "lowerThanEarlier",
        slot: higherEarlier.slot,
        value: higherEarlier.value,
        text: `Manje nego do ${slotLabel(higherEarlier.slot)}h (${higherEarlier.value}). Proveri broj.`,
      });
    }
    if (lowerLater) {
      warnings.push({
        type: "higherThanLater",
        slot: lowerLater.slot,
        value: lowerLater.value,
        text: `Više nego do ${slotLabel(lowerLater.slot)}h (${lowerLater.value}). Proveri broj.`,
      });
    }
    if (upisani != null && count > upisani) {
      warnings.push({
        type: "moreThanRegistered",
        registered: upisani,
        text: `Više od broja upisanih (${upisani}). Proveri broj.`,
      });
    }
    return warnings;
  },

  /** Warns when the van BM count exceeds registered voters. */
  vanBm(count, upisani = null) {
    if (upisani != null && count > upisani) {
      return [
        {
          type: "moreThanRegistered",
          registered: upisani,
          text: `Više od broja upisanih (${upisani}). Proveri broj.`,
        },
      ];
    }
    return [];
  },

  /** Compared only with izlaznost do 20 (plus the latest van BM). */
  rezultati(mi, oni, sentIzlaznost = {}, vanBm = null) {
    const turnoutAtTwenty = sentIzlaznost[20] ?? sentIzlaznost["20"];
    if (turnoutAtTwenty == null) return [];
    const voted = turnoutAtTwenty + (vanBm ?? 0);
    const sum = mi + oni;
    if (sum > voted) {
      return [
        {
          type: "resultsAboveTurnout",
          sum,
          voted,
          text: `MI i ONI zajedno (${sum}) više nego što je glasalo (${voted}). Proveri brojeve.`,
        },
      ];
    }
    return [];
  },
};

/** Empty field drafts for each card. */
export function emptyDrafts() {
  return {
    upisani: "",
    upisaniVanBm: "",
    izlaznost: "",
    izlaznostSlot: null,
    izlaznostSlotFor: null,
    vanBm: "",
    mi: "",
    oni: "",
  };
}

/** Validation error messages for the setup screen. */
export const SETUP_ERRORS = {
  bm: "Upiši broj biračkog mesta, samo cifre.",
  name: "Upiši ime i prezime.",
  number: "Upiši ispravan broj telefona koordinatora.",
};
