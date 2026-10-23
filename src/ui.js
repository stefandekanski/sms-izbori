import {
  html,
  render,
  useState,
  useEffect,
  useRef,
} from "../vendor/preact-htm-3.1.1.js";
import {
  SLOTS,
  slotLabel,
  parseCount,
  normalizeBm,
  normalizeName,
  messages,
  reportLabel,
  latestVanBm,
  SETUP_ERRORS,
} from "./domain.js";
import { createStore } from "./store.js";
import { createApp } from "./app.js";
import { smsUri, isIos } from "./sms.js";

// The own browsers of Viber, Facebook, Instagram and Line, and other Android web views.
const IN_APP_BROWSER =
  typeof navigator !== "undefined" &&
  /; wv\)|FBAN|FBAV|FB_IAB|Instagram|Viber|Line\//i.test(navigator.userAgent || "");
const VIBER = typeof navigator !== "undefined" && /Viber/i.test(navigator.userAgent || "");

// Storage wrapper handling privacy mode and persist request
let storageFailed = false;
let rawStorage;
try {
  rawStorage = window.localStorage;
  const testKey = "__sms_izbori_test__";
  rawStorage.setItem(testKey, testKey);
  rawStorage.removeItem(testKey);
} catch {
  storageFailed = true;
  const memoryMap = new Map();
  rawStorage = {
    getItem(k) {
      return memoryMap.has(k) ? memoryMap.get(k) : null;
    },
    setItem(k, v) {
      memoryMap.set(k, String(v));
    },
    removeItem(k) {
      memoryMap.delete(k);
    },
  };
}

let storagePersisted = false;
function requestPersistStorageOnce() {
  if (!storagePersisted) {
    storagePersisted = true;
    navigator.storage?.persist?.().catch?.(() => {});
  }
}

const baseStore = createStore(rawStorage);
const store = {
  ...baseStore,
  saveProfile(profile) {
    baseStore.saveProfile(profile);
    if (profile != null) requestPersistStorageOnce();
  },
  saveLog(log) {
    baseStore.saveLog(log);
    requestPersistStorageOnce();
  },
  saveDrafts(drafts) {
    baseStore.saveDrafts(drafts);
    requestPersistStorageOnce();
  },
  saveUndo(undo) {
    baseStore.saveUndo(undo);
  },
};

const app = createApp({ store });
if (typeof window !== "undefined") {
  window.__app = app;
}

// Register service worker on load if supported
if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

/** Formats epoch timestamp as 24h HH:mm. */
function formatTime(epochMillis) {
  const date = new Date(epochMillis);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/** Check if the web app runs in standalone display mode. */
function isStandalone() {
  if (typeof window === "undefined") return false;
  return Boolean(
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
      navigator.standalone === true
  );
}

/**
 * Root component that manages subscription to createApp state and screen switching.
 */
function App() {
  const [state, setState] = useState(() => app.getState());

  useEffect(() => {
    return app.subscribe(setState);
  }, []);

  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === "visible") {
        app.refresh();
      }
    }

    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        app.refresh();
      }
    }, 60000);

    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  const profile = state.profile;
  const isEditingSetup = state.showSetup || profile == null;

  return html`
    <div class="screen-container">
      ${isEditingSetup
        ? html`<${SetupScreen} app=${app} profile=${profile} storageFailed=${storageFailed} />`
        : html`<${ReportsScreen} app=${app} state=${state} profile=${profile} storageFailed=${storageFailed} />`}
    </div>
  `;
}

/**
 * Setup screen for entering BM, voter name, and coordinator phone number.
 */
function SetupScreen({ app, profile, storageFailed }) {
  const [bm, setBm] = useState(profile ? profile.bm : "");
  const [name, setName] = useState(profile ? profile.name : "");
  const [number, setNumber] = useState(profile ? profile.coordinatorNumber : "");
  const [pickedName, setPickedName] = useState(profile ? profile.coordinatorName : null);
  const [errors, setErrors] = useState([]);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [noContactsApp, setNoContactsApp] = useState(false);

  const canClose = profile != null;
  const changed =
    profile != null &&
    (bm !== profile.bm ||
      name !== profile.name ||
      number !== profile.coordinatorNumber ||
      (pickedName || null) !== (profile.coordinatorName || null));

  function save() {
    if (document.activeElement && typeof document.activeElement.blur === "function") {
      document.activeElement.blur();
    }
    const errs = app.saveSetup({
      bm,
      name,
      coordinatorNumber: number,
      coordinatorName: pickedName,
    });
    setErrors(errs);
    if (errs.length === 0) {
      leavingRef.current = true;
      popSetupEntry();
      return true;
    }
    return false;
  }

  const leavingRef = useRef(false);

  function leave() {
    if (changed) {
      setConfirmLeave(true);
    } else {
      leavingRef.current = true;
      popSetupEntry();
      app.closeSetup();
    }
  }

  useEffect(() => {
    if (!canClose) return;
    function handlePopState() {
      if (leavingRef.current) return;
      setupEntryPushed = false;
      if (changed) {
        history.pushState({ setup: true }, "");
        setupEntryPushed = true;
        setConfirmLeave(true);
      } else {
        app.closeSetup();
      }
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [canClose, changed]);

  // Web views report the contact picker but can't open it (seen in Viber's browser), so the
  // button would only lead to an error there.
  const hasContacts =
    !IN_APP_BROWSER &&
    typeof navigator !== "undefined" &&
    "contacts" in navigator &&
    typeof window !== "undefined" &&
    "ContactsManager" in window;

  async function handlePickContact() {
    if (document.activeElement && typeof document.activeElement.blur === "function") {
      document.activeElement.blur();
    }
    try {
      const contacts = await navigator.contacts.select(["name", "tel"], { multiple: false });
      if (contacts && contacts.length > 0) {
        const contact = contacts[0];
        const tel = contact.tel && contact.tel.length > 0 ? contact.tel[0] : "";
        const contactName =
          contact.name && contact.name.length > 0 ? contact.name[0].trim() : null;
        if (tel) {
          setNumber(tel);
          setPickedName(contactName || null);
          setNoContactsApp(false);
          setErrors((prev) => prev.filter((e) => e !== "number"));
        } else {
          setErrors((prev) => [...prev.filter((e) => e !== "number"), "number"]);
        }
      }
    } catch {
      setNoContactsApp(true);
    }
  }

  const validBm = normalizeBm(bm);
  const validName = normalizeName(name);

  return html`
    <header class="top-bar">
      <div class="top-bar-nav">
        ${canClose
          ? html`
              <button
                type="button"
                class="btn-icon"
                aria-label="Nazad"
                onClick=${leave}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
                </svg>
              </button>
            `
          : null}
      </div>
      <div class="top-bar-title">
        <h1>Podešavanje</h1>
      </div>
      <div class="top-bar-actions"></div>
    </header>

    ${storageFailed
      ? html`<div class="storage-warning" role="alert">Ovaj preglednik ne čuva podatke. Otvori stranicu u Chrome-u ili Safariju.</div>`
      : null}

    <main class="content-scroll">
      <${InAppBrowserWarning} />
      <div>Upiši ovo jednom. Posle svako javljanje ide jednim dodirom.</div>

      <${SetupField}
        id="field-bm"
        tag="bm"
        label="Broj biračkog mesta"
        value=${bm}
        onInput=${(v) => {
          setBm(v);
          setErrors((prev) => prev.filter((e) => e !== "bm"));
        }}
        inputmode="numeric"
        error=${errors.includes("bm") ? SETUP_ERRORS.bm : null}
      />

      <${SetupField}
        id="field-name"
        tag="name"
        label="Tvoje ime i prezime"
        value=${name}
        onInput=${(v) => {
          setName(v);
          setErrors((prev) => prev.filter((e) => e !== "name"));
        }}
        autocapitalize="words"
        error=${errors.includes("name") ? SETUP_ERRORS.name : null}
      />

      <${SetupField}
        id="field-coordinatorNumber"
        tag="coordinatorNumber"
        label="Broj telefona koordinatora"
        value=${number}
        onInput=${(v) => {
          setNumber(v);
          setPickedName(null);
          setNoContactsApp(false);
          setErrors((prev) => prev.filter((e) => e !== "number"));
        }}
        type="tel"
        error=${errors.includes("number") ? SETUP_ERRORS.number : null}
      />

      ${pickedName ? html`<div class="picked-coordinator">Koordinator: ${pickedName}</div>` : null}

      ${hasContacts
        ? html`
            <button
              type="button"
              class="btn-secondary"
              onClick=${handlePickContact}
            >
              Izaberi koordinatora iz imenika
            </button>
          `
        : null}

      ${noContactsApp
        ? html`<div class="field-error-text">Imenik nije dostupan. Upiši broj ručno.</div>`
        : null}

      ${validBm != null && validName != null
        ? html`
            <div class="header-preview">
              <div>Poruke će počinjati ovako:</div>
              <div class="header-preview-text">BM_${validBm}; ${validName}</div>
            </div>
          `
        : null}

      <button
        type="button"
        class="btn-primary"
        onClick=${() => save()}
      >
        Sačuvaj
      </button>

      ${canClose
        ? html`
            <button
              type="button"
              class="btn-text btn-danger"
              onClick=${() => setConfirmClear(true)}
            >
              Obriši sva javljanja
            </button>
          `
        : null}
    </main>

    ${confirmLeave
      ? html`
          <${AlertDialog}
            text="Sačuvati izmene?"
            confirmText="Da, sačuvaj"
            onConfirm=${() => {
              setConfirmLeave(false);
              save();
            }}
            dismissText="Ne, odbaci"
            onCancel=${() => setConfirmLeave(false)}
            onDismiss=${() => {
              leavingRef.current = true;
              setConfirmLeave(false);
              popSetupEntry();
              app.closeSetup();
            }}
          />
        `
      : null}

    ${confirmClear
      ? html`
          <${AlertDialog}
            text="Obrisati sva javljanja? Ovo ne može da se vrati."
            confirmText="Da, obriši"
            onConfirm=${() => {
              leavingRef.current = true;
              setConfirmClear(false);
              app.clearReports();
              popSetupEntry();
              app.closeSetup();
            }}
            dismissText="Odustani"
            onDismiss=${() => setConfirmClear(false)}
          />
        `
      : null}
  `;
}

/** Single field on the setup screen with visible label and supporting error text. */
function SetupField({ id, tag, label, value, onInput, error, inputmode, autocapitalize, type = "text" }) {
  return html`
    <div class="field-container ${error ? "has-error" : ""}">
      <label for=${id} class="field-label">${label}</label>
      <div class="field-input-box">
        <input
          id=${id}
          type=${type}
          inputmode=${inputmode}
          autocapitalize=${autocapitalize}
          autocomplete="off"
          class="field-input"
          data-tag=${tag}
          value=${value}
          onInput=${(e) => onInput(e.target.value)}
        />
      </div>
      ${error ? html`<div class="field-error-text" role="alert">${error}</div>` : null}
    </div>
  `;
}

/** Whether the gear pushed a history entry for Setup that is still there; only that entry may be popped. */
let setupEntryPushed = false;

/** Pops the Setup history entry if this page pushed it, so leaving Setup never leaves the page. */
function popSetupEntry() {
  if (!setupEntryPushed) return;
  setupEntryPushed = false;
  history.back();
}

function isTextField(element) {
  return Boolean(element?.isConnected && (element.tagName === "INPUT" || element.tagName === "TEXTAREA"));
}

/**
 * Main screen displaying election reports cards, live previews, and the sent confirmation bar.
 */
function ReportsScreen({ app, state, profile, storageFailed }) {
  const [fieldFocused, setFieldFocused] = useState(false);
  const lastScrolledCardRef = useRef(null);

  function scrollToCard(cardName) {
    const el = document.getElementById(`card-${cardName}`);
    if (el) {
      el.scrollIntoView({ block: "start" });
      lastScrolledCardRef.current = cardName;
    }
  }

  useEffect(() => {
    scrollToCard(state.currentCard);
  }, []);

  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === "visible") {
        if (state.currentCard !== lastScrolledCardRef.current) {
          scrollToCard(state.currentCard);
        }
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [state.currentCard]);

  // The sent bar hides while a field has focus (the keyboard is up), as on Android. A focused input that a render
  // removes fires no focusout in Chrome, so the real focus is read again after every commit, and after each focus
  // change once it has settled.
  const readFocus = () => setFieldFocused(isTextField(document.activeElement));
  useEffect(readFocus);
  useEffect(() => {
    const later = () => setTimeout(readFocus, 0);
    document.addEventListener("focusin", later);
    document.addEventListener("focusout", later);
    return () => {
      document.removeEventListener("focusin", later);
      document.removeEventListener("focusout", later);
    };
  }, []);

  function handleSend(action, confirmed = false) {
    if (document.activeElement && typeof document.activeElement.blur === "function") {
      document.activeElement.blur();
    }
    setFieldFocused(false);
    const request = app.send(action, confirmed);
    if (request) {
      location.href = smsUri(request.number, request.text, isIos(navigator));
    }
  }

  function handleOpenSetup() {
    history.pushState({ setup: true }, "");
    setupEntryPushed = true;
    app.openSetup();
  }

  const recipient = profile.coordinatorName
    ? `${profile.coordinatorName} (${profile.coordinatorNumber})`
    : profile.coordinatorNumber;

  const showSentBar = state.undo != null && !fieldFocused;

  return html`
    <header class="top-bar">
      <div class="top-bar-title">
        <h1>BM ${profile.bm} · ${profile.name}</h1>
        <div class="top-bar-subtitle">Šalje se: ${recipient}</div>
      </div>
      <div class="top-bar-actions">
        <button
          type="button"
          class="btn-icon"
          aria-label="Podešavanja"
          onClick=${handleOpenSetup}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path
              fill-rule="evenodd"
              d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"
            />
          </svg>
        </button>
      </div>
    </header>

    ${storageFailed
      ? html`<div class="storage-warning" role="alert">Ovaj preglednik ne čuva podatke. Otvori stranicu u Chrome-u ili Safariju.</div>`
      : null}

    <main class="content-scroll ${showSentBar ? "with-sent-bar" : ""}">
      <${InAppBrowserWarning} />
      <${InstallHintCard} />

      <${UpisaniCard} state=${state} profile=${profile} app=${app} onSend=${handleSend} />
      <${IzlaznostCard} state=${state} profile=${profile} app=${app} onSend=${handleSend} />
      <${VanBmCard} state=${state} profile=${profile} app=${app} onSend=${handleSend} />
      <${RezultatiCard} state=${state} profile=${profile} app=${app} onSend=${handleSend} />
    </main>

    ${showSentBar
      ? html`
          <${SentBar}
            undo=${state.undo}
            onUndo=${() => app.undo()}
            onDismiss=${() => app.dismissUndo()}
          />
        `
      : null}
  `;
}

/** Warning banner shown inside web views of social networks. On Android its button hands the
 * page on through an intent: link, to Chrome first, where the contact picker works; whether the
 * app lets that through is up to the app. */
function InAppBrowserWarning() {
  if (!IN_APP_BROWSER) return null;

  if (isIos(navigator)) {
    return html`
      <div class="in-app-warning" role="alert">
        Bolje otvori ovu stranicu u Chrome-u ili Safariju (meni ⋮ → Otvori u pregledniku): ovaj preglednik čuva upisane podatke odvojeno od njih.
      </div>
    `;
  }

  const scheme = location.protocol.replace(":", "");
  const intentUrl = (pkg) =>
    `intent://${location.host}${location.pathname}#Intent;scheme=${scheme};` +
    (pkg ? `package=${pkg};` : "") +
    `S.browser_fallback_url=${encodeURIComponent(location.href)};end`;
  const inChrome = intentUrl("com.android.chrome");

  function openElsewhere(event) {
    event.preventDefault();
    const started = Date.now();
    let timer;
    const cancel = () => clearTimeout(timer);
    document.addEventListener("visibilitychange", cancel, { once: true });
    window.addEventListener("pagehide", cancel, { once: true });
    window.addEventListener("blur", cancel, { once: true });
    location.href = inChrome;
    // The app finds nothing to hand the link to when Chrome is missing, and the page stays on
    // screen; then ask for any browser: the default one, or Android's "Open with" list.
    timer = setTimeout(() => {
      if (document.visibilityState === "visible" && Date.now() - started < 3000) {
        location.href = intentUrl(null);
      }
    }, 1500);
  }

  return html`
    <div class="in-app-warning" role="alert">
      <div>Bolje otvori ovu stranicu u Chrome-u: ovaj preglednik čuva upisane podatke odvojeno i ne otvara imenik.</div>
      <a class="in-app-open" href=${inChrome} onClick=${openElsewhere}>Otvori u Chrome-u</a>
      ${VIBER
        ? html`<${ViberMenuSteps} />`
        : html`<div>Ako se ništa ne desi: meni ⋮ → Otvori u pregledniku.</div>`}
    </div>
  `;
}

/** Viber's own way out, step by step, for when the button does nothing. The dots are Viber's menu
 * button as measured on a Pixel (size, spacing and color), alone so that they match both of
 * Viber's themes; the menu item is Viber's own text in Serbian and English (Viber 29.2). */
function ViberMenuSteps() {
  return html`
    <div class="in-app-steps">
      <div>Ako se ništa ne desi:</div>
      <ol>
        <li>
          Gore desno na ekranu nađi tri ljubičaste tačke:
          <svg class="viber-menu-dots" viewBox="0 0 11 42" role="img" aria-label="tri ljubičaste tačke">
            <circle cx="5.5" cy="5.5" r="5.5" />
            <circle cx="5.5" cy="21" r="5.5" />
            <circle cx="5.5" cy="36.5" r="5.5" />
          </svg>
        </li>
        <li>Dodirni ih. Otvoriće se meni.</li>
        <li>U meniju dodirni „Otvori u spoljašnjem pretraživaču“ (na engleskom: „Open in external browser“).</li>
      </ol>
    </div>
  `;
}

/** Card prompting the user to install the PWA or add it to the home screen. */
function InstallHintCard() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [installed, setInstalled] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    return rawStorage.getItem("sms_izbori.installHint") === "dismissed";
  });

  useEffect(() => {
    function handlePrompt(e) {
      e.preventDefault();
      setDeferredPrompt(e);
    }
    function handleInstalled() {
      setDeferredPrompt(null);
      setInstalled(true);
    }
    window.addEventListener("beforeinstallprompt", handlePrompt);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handlePrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  if (isStandalone() || dismissed) return null;

  function dismiss() {
    rawStorage.setItem("sms_izbori.installHint", "dismissed");
    setDismissed(true);
  }

  const ios = isIos(navigator);

  // The launcher decides where the icon goes; with every home screen page full it lands only in
  // the app list, so say where to look.
  if (installed) {
    return html`
      <div class="install-card" role="status">
        <h2 class="install-card-title">Aplikacija je dodata</h2>
        <div>Ako ikonica „SMS Izbori“ nije na početnom ekranu, nađi je među svim aplikacijama: prevuci prstom nagore od dna ekrana.</div>
        <div class="install-card-actions">
          <button type="button" class="btn-text" onClick=${dismiss}>
            U redu
          </button>
        </div>
      </div>
    `;
  }

  if (deferredPrompt) {
    return html`
      <div class="install-card">
        <h2 class="install-card-title">Dodaj na početni ekran</h2>
        <div class="install-card-actions">
          <button
            type="button"
            class="btn-primary"
            onClick=${async () => {
              deferredPrompt.prompt();
              setDeferredPrompt(null);
              try {
                const choice = await deferredPrompt.userChoice;
                if (choice?.outcome === "accepted") setInstalled(true);
              } catch {}
            }}
          >
            Dodaj na početni ekran
          </button>
          <button type="button" class="btn-text" onClick=${dismiss}>
            Ne sada
          </button>
        </div>
      </div>
    `;
  }

  if (ios) {
    return html`
      <div class="install-card">
        <h2 class="install-card-title">Dodaj na početni ekran</h2>
        <div>U Safariju dodirni Podeli, pa „Dodaj na početni ekran“.</div>
        <div class="install-card-actions">
          <button type="button" class="btn-text" onClick=${dismiss}>
            Ne sada
          </button>
        </div>
      </div>
    `;
  }

  return null;
}

/** Card for voters registered before polling opens. */
function UpisaniCard({ state, profile, app, onSend }) {
  const drafts = state.drafts;
  const sent = state.log.upisani;
  const isCurrent = state.currentCard === "upisani";

  return html`
    <${ReportCard} title="Pre otvaranja" tag="upisani" isCurrent=${isCurrent}>
      ${sent && !state.editingUpisani
        ? html`
            <div class="sent-block">
              <${SentLine}
                text=${`Poslato u ${formatTime(sent.at)}: ${sent.value.upisani} upisanih${
                  sent.value.vanBm != null ? `, ${sent.value.vanBm} van BM` : ""
                }`}
              />
              <button
                type="button"
                class="btn-text"
                onClick=${() => app.editUpisani()}
              >
                Izmeni
              </button>
            </div>
          `
        : html`
            <${InputArea}>
              ${(revealRef) => html`
                <${CountField}
                  value=${drafts.upisani}
                  onInput=${(v) => app.setUpisani(v)}
                  label="Broj upisanih birača"
                  tag="upisani"
                  revealRef=${revealRef}
                />
                <${CountField}
                  value=${drafts.upisaniVanBm}
                  onInput=${(v) => app.setUpisaniVanBm(v)}
                  label="Prijavljeni za glasanje van BM (ako ih ima)"
                  tag="upisaniVanBm"
                  revealRef=${revealRef}
                />
                ${(() => {
                  const upisani = parseCount(drafts.upisani);
                  if (upisani != null && upisani >= 1) {
                    const text = messages.upisani(
                      profile,
                      upisani,
                      parseCount(drafts.upisaniVanBm)
                    );
                    return html`<${MessagePreview} text=${text} />`;
                  }
                  return null;
                })()}
                <${SendArea}
                  label="Pošalji broj upisanih"
                  issue=${state.issues["upisani"]}
                  onSend=${() => onSend("upisani", false)}
                  onConfirm=${() => onSend("upisani", true)}
                />
                ${sent
                  ? html`
                      <button
                        type="button"
                        class="btn-text btn-full-width"
                        onClick=${() => app.cancelEditUpisani()}
                      >
                        Odustani
                      </button>
                    `
                  : null}
              `}
            <//>
          `}
    <//>
  `;
}

/** Card for periodic turnout numbers with interactive slot chips. */
function IzlaznostCard({ state, profile, app, onSend }) {
  const slot = state.selectedSlot;
  const drafts = state.drafts;
  const isCurrent = state.currentCard === "izlaznost";

  return html`
    <${ReportCard} title="Izlaznost" tag="izlaznost" isCurrent=${isCurrent}>
      <div class="slots-flow">
        ${SLOTS.map((s) => {
          const sentCount = state.log.izlaznost?.[s]?.value?.count;
          const isSelected = s === slot;
          return html`
            <button
              key=${s}
              type="button"
              class="slot-chip ${isSelected ? "selected" : ""}"
              data-tag=${`slot_${slotLabel(s)}`}
              role="radio"
              aria-checked=${isSelected}
              onClick=${() => app.selectSlot(s)}
            >
              <span class="slot-chip-label">${slotLabel(s)}h</span>
              ${sentCount != null
                ? html`
                    <span
                      class="slot-chip-sent"
                      aria-label=${`poslato, ${sentCount}`}
                    >
                      ✓ ${sentCount}
                    </span>
                  `
                : null}
            </button>
          `;
        })}
      </div>
      <${InputArea}>
        ${(revealRef) => html`
          <${CountField}
            value=${drafts.izlaznost}
            onInput=${(v) => app.setIzlaznost(v)}
            label=${`Koliko je glasalo do ${slotLabel(slot)}h`}
            tag="izlaznost"
            revealRef=${revealRef}
          />
          ${(() => {
            const count = parseCount(drafts.izlaznost);
            if (count != null) {
              const text = messages.izlaznost(profile, slot, count);
              return html`<${MessagePreview} text=${text} />`;
            }
            return null;
          })()}
          <${SendArea}
            label=${`Pošalji izlaznost do ${slotLabel(slot)}h`}
            issue=${state.issues["izlaznost"]}
            onSend=${() => onSend("izlaznost", false)}
            onConfirm=${() => onSend("izlaznost", true)}
          />
        `}
      <//>
    <//>
  `;
}

/** Card for voting outside the polling station and commission formation. */
function VanBmCard({ state, profile, app, onSend }) {
  const drafts = state.drafts;
  const log = state.log;
  const isCurrent = state.currentCard === "vanBm";
  const latest = latestVanBm(log);

  return html`
    <${ReportCard} title="Glasanje van BM" tag="vanBm" isCurrent=${isCurrent}>
      <${InputArea}>
        ${(revealRef) => html`
          <${CountField}
            value=${drafts.vanBm}
            onInput=${(v) => app.setVanBm(v)}
            label="Broj prijavljenih za glasanje van BM"
            tag="vanBm"
            supportingText=${latest != null ? `Poslednje javljeno: ${latest}` : null}
            revealRef=${revealRef}
          />
          ${(() => {
            const count = parseCount(drafts.vanBm);
            if (count != null) {
              const text = messages.vanBm(profile, count);
              return html`<${MessagePreview} text=${text} />`;
            }
            return null;
          })()}
          <${SendArea}
            label="Pošalji broj prijavljenih"
            issue=${state.issues["vanBm"]}
            onSend=${() => onSend("vanBm", false)}
            onConfirm=${() => onSend("vanBm", true)}
          />
        `}
      <//>
      ${log.vanBm
        ? html`
            <${SentLine}
              text=${`Poslato u ${formatTime(log.vanBm.at)}: ${log.vanBm.value.count} prijavljenih`}
            />
          `
        : null}

      <hr class="divider" />
      <h3 class="subtitle">Komisija za glasanje van BM</h3>
      <button
        type="button"
        class="btn-secondary"
        onClick=${() => onSend("komisija", false)}
      >
        ${log.komisija == null
          ? "Komisija je formirana"
          : "Pošalji ponovo da je komisija formirana"}
      </button>
      ${log.komisija
        ? html`
            <${SentLine}
              text=${`Javljeno u ${formatTime(log.komisija.at)}`}
            />
          `
        : null}
    <//>
  `;
}

/** Card for closing results (MI / ONI counts). */
function RezultatiCard({ state, profile, app, onSend }) {
  const drafts = state.drafts;
  const isCurrent = state.currentCard === "rezultati";
  const sent = state.log.rezultati;

  return html`
    <${ReportCard} title="Rezultati" tag="rezultati" isCurrent=${isCurrent}>
      <${InputArea}>
        ${(revealRef) => html`
          <div class="rezultati-row">
            <${CountField}
              value=${drafts.mi}
              onInput=${(v) => app.setMi(v)}
              label="MI"
              tag="mi"
              revealRef=${revealRef}
            />
            <${CountField}
              value=${drafts.oni}
              onInput=${(v) => app.setOni(v)}
              label="ONI"
              tag="oni"
              revealRef=${revealRef}
            />
          </div>
          ${(() => {
            const mi = parseCount(drafts.mi);
            const oni = parseCount(drafts.oni);
            if (mi != null && oni != null) {
              const text = messages.rezultati(profile, mi, oni);
              return html`<${MessagePreview} text=${text} />`;
            }
            return null;
          })()}
          <${SendArea}
            label="Pošalji rezultate"
            issue=${state.issues["rezultati"]}
            onSend=${() => onSend("rezultati", false)}
            onConfirm=${() => onSend("rezultati", true)}
          />
        `}
      <//>
      ${sent
        ? html`
            <${SentLine}
              text=${`Poslato u ${formatTime(sent.at)}: MI ${sent.value.mi}, ONI ${sent.value.oni}`}
            />
          `
        : null}
    <//>
  `;
}

/** Generic card container with "Sada" badge. */
function ReportCard({ title, tag, isCurrent, children }) {
  const testTag = tag === "vanBm" ? "card_vanbm" : `card_${tag}`;
  return html`
    <section
      id=${`card-${tag}`}
      class="report-card ${isCurrent ? "current" : ""}"
      data-tag=${testTag}
    >
      <div class="card-header">
        <h2 class="card-title">${title}</h2>
        ${isCurrent ? html`<span class="badge-sada">Sada</span>` : null}
      </div>
      <div class="card-content">
        ${children}
      </div>
    </section>
  `;
}

/**
 * Wraps fields, preview, and send area, passing its element ref to children for focus-reveals.
 */
function InputArea({ children }) {
  const areaRef = useRef(null);
  return html`
    <div class="input-area" ref=${areaRef}>
      ${typeof children === "function" ? children(areaRef) : children}
    </div>
  `;
}

/** Waits for the keyboard animation, so the block lands above the keyboard and not under it. */
const KEYBOARD_SETTLE_MS = 300;

/**
 * Whole-number field keeping only digits. While it has focus it keeps the card's input block (fields, preview, send
 * button) above the keyboard, as the Android app does: again after every digit, since the preview appears with the
 * first one, and whenever the keyboard changes the visible height. A block taller than the screen keeps the field.
 */
function CountField({ value, onInput, label, tag, supportingText, revealRef }) {
  const inputRef = useRef(null);
  const timerRef = useRef(null);
  const focusedRef = useRef(false);

  function reveal() {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const block = revealRef?.current;
      if (!focusedRef.current || !block) return;
      const visible = globalThis.visualViewport?.height ?? globalThis.innerHeight;
      if (block.getBoundingClientRect().height > visible) {
        inputRef.current?.scrollIntoView({ block: "nearest" });
      } else {
        block.scrollIntoView({ block: "nearest" });
      }
    }, KEYBOARD_SETTLE_MS);
  }

  useEffect(() => {
    if (focusedRef.current) reveal();
  }, [value]);

  useEffect(() => {
    const viewport = globalThis.visualViewport;
    const onResize = () => {
      if (focusedRef.current) reveal();
    };
    viewport?.addEventListener("resize", onResize);
    return () => {
      viewport?.removeEventListener("resize", onResize);
      clearTimeout(timerRef.current);
    };
  }, []);

  function handleFocus() {
    focusedRef.current = true;
    reveal();
  }

  function handleBlur() {
    focusedRef.current = false;
    clearTimeout(timerRef.current);
  }

  function handleInput(e) {
    const raw = e.target.value;
    const stripped = raw.replace(/[^0-9]/g, "").slice(0, 5);
    if (raw !== stripped) {
      e.target.value = stripped;
    }
    onInput(stripped);
  }

  const id = `field-${tag}`;

  return html`
    <div class="field-container">
      <label for=${id} class="field-label">${label}</label>
      <div class="field-input-box">
        <input
          id=${id}
          ref=${inputRef}
          type="text"
          inputmode="numeric"
          pattern="[0-9]*"
          autocomplete="off"
          class="field-input"
          data-tag=${tag}
          value=${value}
          onInput=${handleInput}
          onFocus=${handleFocus}
          onBlur=${handleBlur}
        />
      </div>
      ${supportingText ? html`<div class="field-supporting-text">${supportingText}</div>` : null}
    </div>
  `;
}

/** Card send button accompanied by its validation or sanity issue block. */
function SendArea({ label, issue, onSend, onConfirm }) {
  const sendAreaRef = useRef(null);

  useEffect(() => {
    if (issue) {
      sendAreaRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [issue]);

  return html`
    <div class="send-area" ref=${sendAreaRef}>
      <button type="button" class="btn-primary" onClick=${onSend}>
        ${label}
      </button>
      <${IssueBlock} issue=${issue} onConfirm=${onConfirm} />
    </div>
  `;
}

/** Displays errors or warnings resulting from a send attempt. */
function IssueBlock({ issue, onConfirm }) {
  if (!issue) return null;

  if (issue.kind === "invalid") {
    return html`
      <div class="field-error-text" role="status" aria-live="polite">
        ${issue.text}
      </div>
    `;
  }

  if (issue.kind === "warnings") {
    return html`
      <div class="warnings-block">
        ${issue.warnings.map(
          (w, idx) => html`
            <div key=${idx} class="field-error-text" role="status" aria-live="polite">
              ${w.text}
            </div>
          `
        )}
        <button
          type="button"
          class="btn-primary btn-error"
          onClick=${onConfirm}
        >
          Broj je tačan, pošalji
        </button>
      </div>
    `;
  }

  return null;
}

/** Displays the exact message with a copy button. */
function MessagePreview({ text }) {
  const [copied, setCopied] = useState(false);
  const textRef = useRef(null);

  function selectPreviewText() {
    if (!textRef.current) return;
    const range = document.createRange();
    range.selectNodeContents(textRef.current);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function handleCopy() {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(
        () => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        },
        () => {
          selectPreviewText();
        }
      );
    } else {
      selectPreviewText();
    }
  }

  return html`
    <div class="message-preview">
      <div class="preview-label">Poruka:</div>
      <div class="preview-box">
        <pre class="preview-text" ref=${textRef}>${text}</pre>
      </div>
      <button type="button" class="btn-text btn-copy" onClick=${handleCopy}>
        ${copied ? "Kopirano" : "Kopiraj"}
      </button>
    </div>
  `;
}

/** Green check indicator and text for sent reports. */
function SentLine({ text }) {
  return html`
    <div class="sent-line">
      <span class="sent-check" aria-label="poslato">✓</span>
      <span class="sent-text">${text}</span>
    </div>
  `;
}

/** Bottom confirmation bar displayed after a report is sent. */
function SentBar({ undo, onUndo, onDismiss }) {
  return html`
    <aside class="sent-bar" role="region" aria-label="Poslata poruka">
      <div class="sent-bar-text" aria-live="polite">
        Označeno kao poslato: ${reportLabel(undo)}
      </div>
      <div class="sent-bar-actions">
        <button type="button" class="btn-text btn-sent-bar" onClick=${onUndo}>
          Nije poslato
        </button>
        <button type="button" class="btn-text btn-sent-bar" onClick=${onDismiss}>
          U redu
        </button>
      </div>
    </aside>
  `;
}

/** Modal alert dialog with Escape and focus management. */
function AlertDialog({ text, confirmText, onConfirm, dismissText, onDismiss, onCancel = onDismiss }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const prevActive = document.activeElement;
    const firstButton = dialogRef.current?.querySelector("button");
    firstButton?.focus();

    function handleKeyDown(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (prevActive && typeof prevActive.focus === "function") {
        prevActive.focus();
      }
    };
  }, [onCancel]);

  return html`
    <div class="dialog-backdrop" onClick=${onCancel}>
      <div
        class="dialog"
        role="dialog"
        aria-modal="true"
        ref=${dialogRef}
        onClick=${(e) => e.stopPropagation()}
      >
        <div class="dialog-text">${text}</div>
        <div class="dialog-actions">
          ${dismissText
            ? html`
                <button type="button" class="btn-text" onClick=${onDismiss}>
                  ${dismissText}
                </button>
              `
            : null}
          ${confirmText
            ? html`
                <button type="button" class="btn-text" onClick=${onConfirm}>
                  ${confirmText}
                </button>
              `
            : null}
        </div>
      </div>
    </div>
  `;
}

// Mount Preact app into DOM
const rootContainer = document.getElementById("app") || document.body;
render(html`<${App} />`, rootContainer);
