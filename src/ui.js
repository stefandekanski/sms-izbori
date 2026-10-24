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
  reportLabel,
  reportText,
  latestVanBm,
  SETUP_ERRORS,
} from "./domain.js";
import { createStore } from "./store.js";
import { createApp } from "./app.js";
import { smsUri, isIos } from "./sms.js";

// The own browsers of Viber, Facebook, Instagram and Line, and other Android web views. On an
// iPhone, Safari and the other browsers all name Safari in their user agent and an app's own
// browser usually doesn't (Viber names nothing, as on Android); the home screen app doesn't
// either, so it is left out.
const IN_APP_BROWSER =
  typeof navigator !== "undefined" &&
  (/; wv\)|FBAN|FBAV|FB_IAB|Instagram|Viber|Line\//i.test(navigator.userAgent || "") ||
    (isIos(navigator) && !/Safari\//.test(navigator.userAgent || "") && !isStandalone()));
// Viber's browser on Android doesn't name itself: its user agent is the plain WebView one (seen on a
// Pixel with Viber 29.2). The kontrolori share the link on Viber, so any Android web view that
// isn't a known other app counts as Viber's.
const VIBER =
  typeof navigator !== "undefined" &&
  (/Viber/i.test(navigator.userAgent || "") ||
    (/; wv\)/.test(navigator.userAgent || "") &&
      !/FBAN|FBAV|FB_IAB|Instagram|Line\/|Telegram/i.test(navigator.userAgent || "")));

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

// Setup has changes not saved yet; set by SetupScreen.
let setupDirty = false;

// Register service worker on load if supported
if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").then((registration) => {
      // An installed app that comes back from the background doesn't load the page again, so the
      // browser wouldn't look for a new version; look every time the page shows.
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") registration.update().catch(() => {});
      });
    }).catch(() => {});
  });
  reloadOnNewVersion();
}

// sw.js lets a new version take over as soon as it holds every file, but this page still runs the
// old code. Load the page again when that loses nothing: at once, unless a field has focus or Setup
// has changes not saved yet (the profile, reports and drafts are in localStorage and survive a
// reload); otherwise the next time the page is hidden, such as when the messaging app opens.
function reloadOnNewVersion() {
  // On the first visit the worker takes charge of a page that already runs the newest code.
  if (!navigator.serviceWorker.controller) return;
  let reloading = false;
  const reload = () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  };
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (document.visibilityState === "hidden" || !(isTextField(document.activeElement) || setupDirty)) {
      reload();
      return;
    }
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") reload();
    });
  });
}

// Chrome offers installing only through this event, which can come before the screen that wants it
// is shown, so it is kept here for every screen.
let installPrompt = null;
// "none", "installing" or "installed".
let installStage = "none";
let alreadyInstalled = false;
const installListeners = new Set();
function changeInstall(change) {
  change();
  installListeners.forEach((listener) => listener());
}

// Accepting the install, and even Chrome's appinstalled, come before Chrome has built the app and
// its icon is on the phone, which takes 5 to 12 seconds; until then the page says it is installing,
// so nobody goes looking for an icon that isn't there yet.
const INSTALL_SECONDS = 10;
function startInstalling() {
  if (installStage !== "none") return;
  changeInstall(() => {
    installPrompt = null;
    installStage = "installing";
  });
  setTimeout(() => changeInstall(() => {
    installStage = "installed";
  }), INSTALL_SECONDS * 1000);
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    changeInstall(() => {
      installPrompt = event;
    });
  });
  window.addEventListener("appinstalled", startInstalling);
  // Chrome on Android tells an installed web app's own pages that it is installed (the manifest
  // names it under related_applications); then there is nothing to install.
  if (!isStandalone()) {
    navigator.getInstalledRelatedApps?.()
      .then((apps) => {
        if (apps.length > 0) changeInstall(() => {
          alreadyInstalled = true;
        });
      })
      .catch(() => {});
  }
}

function useInstall() {
  const [, setVersion] = useState(0);
  useEffect(() => {
    const listener = () => setVersion((v) => v + 1);
    installListeners.add(listener);
    return () => installListeners.delete(listener);
  }, []);
  return { prompt: installPrompt, stage: installStage, alreadyInstalled };
}

async function promptInstall() {
  const event = installPrompt;
  if (!event) return;
  // A prompt can be shown only once.
  changeInstall(() => {
    installPrompt = null;
  });
  event.prompt();
  try {
    const choice = await event.userChoice;
    if (choice?.outcome === "accepted") startInstalling();
    return choice?.outcome;
  } catch {}
  return null;
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

/** The guide (uputstvo.html), from the top bar. It is a page of its own, so that it can also be sent
 * as a link and opens without the app. */
function GuideLink({ onClick }) {
  return html`
    <a class="btn-icon" href="uputstvo.html" aria-label="Uputstvo" onClick=${onClick}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path
          d="M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z"
        />
      </svg>
    </a>
  `;
}

// What was typed in the first Setup, kept for this tab while the guide is open; nothing is saved yet
// then, and coming back loads the app anew.
const SETUP_DRAFT_KEY = "sms_izbori.setupDraft";

function keepSetupDraft(draft) {
  try {
    sessionStorage.setItem(SETUP_DRAFT_KEY, JSON.stringify(draft));
  } catch {}
}

function takeSetupDraft() {
  try {
    const draft = JSON.parse(sessionStorage.getItem(SETUP_DRAFT_KEY));
    sessionStorage.removeItem(SETUP_DRAFT_KEY);
    return draft;
  } catch {
    return null;
  }
}

/**
 * Root component that manages subscription to createApp state and screen switching.
 */
function App() {
  const [state, setState] = useState(() => app.getState());
  const [inBrowser, setInBrowser] = useState(() => rawStorage.getItem("sms_izbori.welcome") === "browser");

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

  // In a browser the app is installed first. Whoever already set it up in the browser, or went on
  // without installing (see WelcomeScreen), uses it there.
  if (profile == null && !isStandalone() && !inBrowser) {
    return html`
      <div class="screen-container">
        <${WelcomeScreen}
          onContinue=${() => {
            rawStorage.setItem("sms_izbori.welcome", "browser");
            setInBrowser(true);
          }}
        />
      </div>
    `;
  }

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
  const [draft] = useState(() => (profile == null ? takeSetupDraft() : null));
  const [bm, setBm] = useState(profile ? profile.bm : draft?.bm ?? "");
  const [name, setName] = useState(profile ? profile.name : draft?.name ?? "");
  const [number, setNumber] = useState(profile ? profile.coordinatorNumber : draft?.number ?? "");
  const [pickedName, setPickedName] = useState(profile ? profile.coordinatorName : draft?.pickedName ?? null);
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

  // A new version holds back its reload while this form has changes (see reloadOnNewVersion).
  useEffect(() => {
    setupDirty = profile == null ? Boolean(bm || name || number) : changed;
  });
  useEffect(() => () => {
    setupDirty = false;
  }, []);

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

  return html`
    <header class="top-bar">
      ${canClose
        ? html`
            <div class="top-bar-nav">
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
            </div>
          `
        : html`<img class="top-bar-icon" src="icons/icon-any.svg" alt="" width="28" height="28" aria-hidden="true" />`}
      <div class="top-bar-title">
        <h1>Podešavanje</h1>
      </div>
      <div class="top-bar-actions">
        ${profile == null
          ? html`<${GuideLink} onClick=${() => keepSetupDraft({ bm, name, number, pickedName })} />`
          : null}
      </div>
    </header>

    ${storageFailed
      ? html`<div class="storage-warning" role="alert">Ovaj pretraživač ne čuva podatke. Otvori stranicu u Chrome-u ili Safariju.</div>`
      : null}

    <main class="content-scroll">
      <${InAppBrowserWarning} />

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
      <img class="top-bar-icon" src="icons/icon-any.svg" alt="" width="28" height="28" aria-hidden="true" />
      <div class="top-bar-title">
        <h1>BM ${profile.bm} · ${profile.name}</h1>
        <div class="top-bar-subtitle">Šalje se: ${recipient}</div>
      </div>
      <div class="top-bar-actions">
        <${GuideLink} />
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
      ? html`<div class="storage-warning" role="alert">Ovaj pretraživač ne čuva podatke. Otvori stranicu u Chrome-u ili Safariju.</div>`
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
            profile=${profile}
            onConfirm=${() => app.dismissUndo()}
            onCancel=${() => app.undo()}
          />
        `
      : null}
  `;
}

/** First screen in a browser: the app, and installing it, so that it is then used like any other
 * app. An app's own browser can't install, so there it only leads on to Chrome or Safari. Colors
 * mean here what they mean in the rest of the app: blue is what to do, green is done, red a problem. */
function WelcomeScreen({ onContinue }) {
  const install = useInstall();
  const done = install.stage !== "none" || install.alreadyInstalled;
  // Chrome sends its offer soon after the page loads; until then the menu steps would only flash.
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setWaited(true), 2000);
    return () => clearTimeout(timer);
  }, []);
  // Going on without installing is offered only once the ways to install have failed: the app's
  // browser didn't hand the page on, Chrome's offer was turned down, or the steps have been on
  // screen for a while and nothing got installed. Sending works in any browser. The same everywhere:
  // one app for everybody, installed (Android once offered it from the start; taken back 2026-10-24).
  const [stuck, setStuck] = useState(false);
  // Chrome doesn't offer again after its offer was turned down, so the menu steps come at once.
  const onStuck = () => {
    setStuck(true);
    setWaited(true);
  };
  const goOn = stuck && !done ? "Ne uspevaš? Nastavi iz pretraživača" : null;
  return html`
    <header class="welcome-hero">
      <img class="welcome-icon" src="icons/icon-any.svg" alt="" width="48" height="48" />
      <h1>SMS Izbori</h1>
    </header>

    <main class="content-scroll">
      ${IN_APP_BROWSER || done
        ? null
        : html`
            <p class="welcome-intro">Šalje javljanja koordinatoru kao SMS. Radi i bez interneta.</p>
            <a class="guide-link" href="uputstvo.html">Kako se koristi? Kratko uputstvo</a>
          `}
      ${IN_APP_BROWSER
        ? html`<${InAppBrowserWarning} welcome onStuck=${onStuck} />`
        : html`<${InstallSteps} waited=${waited} onStuck=${onStuck} />`}
      ${goOn
        ? html`
            <button type="button" class="btn-text btn-full-width" onClick=${onContinue}>${goOn}</button>
          `
        : null}
    </main>
  `;
}

// How long the install steps stay on screen, with nothing installed, before going on without is offered.
const STUCK_SECONDS = 60;

/** Installing, the way the browser this page runs in allows it. */
function InstallSteps({ waited, onStuck }) {
  const install = useInstall();
  const showingSteps =
    install.stage === "none" && !install.alreadyInstalled && (isIos(navigator) || (!install.prompt && waited));
  useEffect(() => {
    if (!showingSteps) return;
    const timer = setTimeout(onStuck, STUCK_SECONDS * 1000);
    return () => clearTimeout(timer);
  }, [showingSteps]);

  if (install.alreadyInstalled) return html`<${InstalledCard} stage="installed" already />`;
  if (install.stage !== "none") return html`<${InstalledCard} stage=${install.stage} />`;

  // No page can start this on an iPhone. The home screen app keeps its data apart from Safari, so
  // it is set up there.
  if (isIos(navigator)) {
    return html`
      <section class="flow-card flow-card-steps install-card">
        <h2>Dodaj aplikaciju na telefon</h2>
        <ol class="steps">
          <li>
            <div>
              Dodirni dugme za deljenje <${ShareIcon} /> na dnu ili vrhu ekrana. Ako ga ne vidiš, prvo dodirni <${Key}>•••<//>.
            </div>
          </li>
          <li>
            <div>Pomeri spisak nadole i dodirni <${MenuItem} sr="Dodaj na početni ekran" en="Add to Home Screen" />.</div>
          </li>
          <li>
            <div>U gornjem desnom uglu dodirni <${MenuItem} sr="Dodaj" en="Add" />.</div>
          </li>
          <li>
            <div>Izađi na početni ekran, dodirni novu plavu ikonicu <${AppIcon} small /> „SMS Izbori“ i tamo upiši podatke.</div>
          </li>
        </ol>
      </section>
    `;
  }

  if (install.prompt) {
    return html`
      <section class="flow-card flow-card-action install-card">
        <button
          type="button"
          class="btn-primary"
          onClick=${async () => {
            if ((await promptInstall()) === "dismissed") onStuck();
          }}
        >
          Instaliraj aplikaciju
        </button>
      </section>
    `;
  }

  if (!waited) return null;

  // Firefox never sends the offer, and Chrome doesn't for a while after it was turned down.
  return html`
    <section class="flow-card flow-card-steps install-card">
      <h2>Instaliraj aplikaciju iz menija</h2>
      <ol class="steps">
        <li>
          <div>Dodirni meni pretraživača <${Key}>⋮<//> ili <${Key}>≡<//> u uglu ekrana.</div>
        </li>
        <li>
          <div>
            Dodirni <${MenuItem} sr="Instaliraj aplikaciju" en="Install app" /> ili <${MenuItem} sr="Dodaj na početni ekran" en="Add to home screen" /> i potvrdi.
          </div>
        </li>
      </ol>
    </section>
  `;
}

/** After installing. Where the launcher puts the icon is up to the phone, so the card shows the
 * icon instead of saying where to look. */
function InstalledCard({ stage, already = false }) {
  if (stage === "installing") {
    return html`
      <section class="flow-card flow-card-action install-card" role="status">
        <div class="flow-card-title">
          <span class="flow-spinner" aria-hidden="true"></span>
          <h2>Aplikacija se instalira…</h2>
        </div>
        <p>Sačekaj nekoliko sekundi.</p>
      </section>
    `;
  }
  return html`
    <section class="flow-card flow-card-done install-card" role="status">
      <div class="flow-card-title">
        <${CheckIcon} />
        <h2>${already ? "Aplikacija je već na telefonu" : "Aplikacija je spremna"}</h2>
      </div>
      <p><strong>Dalje radiš u aplikaciji:</strong></p>
      <ol class="steps">
        <li>
          <div>Izađi na početni ekran telefona.</div>
        </li>
        <li>
          <div>Nađi ovu plavu ikonicu i dodirni je:</div>
        </li>
      </ol>
      <div class="app-preview">
        <${AppIcon} />
        <strong>SMS Izbori</strong>
      </div>
      ${isIos(navigator)
        ? null
        : html`<p class="flow-hint">Ili u Chrome-u: ⋮ → „Otvori SMS Izbori“ (Open).</p>`}
    </section>
  `;
}

/** A menu item as the phone shows it: in Serbian, and in English for phones set to English. */
function MenuItem({ sr, en }) {
  return html`<strong>„${sr}“</strong> <span class="menu-en">(${en})</span>`;
}

/** A browser button drawn as a key: ⋮, ≡ or •••. */
function Key({ children }) {
  return html`<span class="key-chip">${children}</span>`;
}

/** The app's icon, as the home screen shows it; small sits inline in a line of text. */
function AppIcon({ small = false }) {
  const size = small ? 28 : 56;
  return html`<img class=${small ? "app-icon-small" : null} src="icons/icon-any.svg" alt="" width=${size} height=${size} />`;
}

/** Safari's Share button, in Safari's blue. */
function ShareIcon() {
  return html`
    <span class="icon-chip">
      <svg class="share-icon" viewBox="0 0 24 24" role="img" aria-label="dugme za deljenje">
        <path d="M8.5 9.5H6.5V20.5H17.5V9.5H15.5" />
        <path d="M12 2.5V14M8.5 6L12 2.5L15.5 6" />
      </svg>
    </span>
  `;
}

function CheckIcon() {
  return html`
    <svg class="flow-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
    </svg>
  `;
}

function WarningIcon() {
  return html`
    <svg class="flow-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
    </svg>
  `;
}

/** An app's own browser. On the welcome screen it is the way to install: its button hands the page
 * on, on Android through an intent: link to Chrome first, where the contact picker also works;
 * whether the app lets that through is up to the app, so the steps through its menu follow. On
 * Setup and the main screen, for whoever set the app up in there, it warns that the data stays
 * apart from Chrome and Safari. */
function InAppBrowserWarning({ welcome = false, onStuck = () => {} }) {
  if (!IN_APP_BROWSER) return null;
  const ios = isIos(navigator);

  // x-safari-https: opens Safari from some apps' browsers on iOS 17 and later; not tried in Viber.
  const inSafari = `x-safari-${location.protocol.replace(":", "")}://${location.host}${location.pathname}`;

  const scheme = location.protocol.replace(":", "");
  const intentUrl = (pkg) =>
    `intent://${location.host}${location.pathname}#Intent;scheme=${scheme};` +
    (pkg ? `package=${pkg};` : "") +
    `S.browser_fallback_url=${encodeURIComponent(location.href)};end`;
  const inChrome = intentUrl("com.android.chrome");

  // After a tap of the button, runs `run` after `ms` if the page is still on screen, that is if
  // nothing took it. Leaving the page cancels it, and a timer that ran late because the page was in
  // the background counts for nothing.
  function whileStillHere() {
    const started = Date.now();
    const timers = [];
    const cancel = () => timers.forEach(clearTimeout);
    document.addEventListener("visibilitychange", cancel, { once: true });
    window.addEventListener("pagehide", cancel, { once: true });
    window.addEventListener("blur", cancel, { once: true });
    return (ms, run) =>
      timers.push(setTimeout(() => {
        if (document.visibilityState === "visible" && Date.now() - started < ms + 1500) run();
      }, ms));
  }

  function openElsewhere(event) {
    event.preventDefault();
    const later = whileStillHere();
    location.href = inChrome;
    // The app finds nothing to hand the link to when Chrome is missing, and the page stays on
    // screen; then ask for any browser: the default one, or Android's "Open with" list.
    later(1500, () => {
      location.href = intentUrl(null);
    });
    later(4500, onStuck);
  }

  const button = ios
    ? html`<a class="btn-primary in-app-open" href=${inSafari} onClick=${() => whileStillHere()(4500, onStuck)}>Otvori u Safariju</a>`
    : html`<a class="btn-primary in-app-open" href=${inChrome} onClick=${openElsewhere}>Otvori u Chrome-u</a>`;

  if (!welcome) {
    return html`
      <section class="flow-card flow-card-alert in-app-warning" role="alert">
        <div class="flow-card-title">
          <${WarningIcon} />
          <h2>Otvoreno unutar druge aplikacije</h2>
        </div>
        <p>
          ${ios
            ? "Podaci upisani ovde nisu vidljivi u Safariju."
            : "Podaci upisani ovde nisu vidljivi u Chrome-u, a biranje broja iz imenika ne radi."}
        </p>
        ${button}
      </section>
    `;
  }

  return html`
    <section class="flow-card flow-card-action in-app-warning">
      <h2>${ios ? "Prvo pređi u Safari" : "Prvo pređi u Chrome"}</h2>
      <p>${VIBER && !ios ? "Iz Vibera nije moguće instalirati aplikaciju." : "Odavde nije moguće instalirati aplikaciju."}</p>
      ${button}
    </section>
    <section class="flow-card flow-card-fallback in-app-steps">
      <h2>Ako se ništa ne desi:</h2>
      ${ios
        ? html`
            <ol class="steps">
              <li>
                <div>Dodirni meni ovog pretraživača (<${Key}>•••<//> ili <${ShareIcon} />) u uglu ekrana.</div>
              </li>
              <li>
                <div>Dodirni <${MenuItem} sr="Otvori u Safariju" en="Open in Safari" />.</div>
              </li>
            </ol>
          `
        : VIBER
          ? html`<${ViberMenuSteps} />`
          : html`
              <ol class="steps">
                <li>
                  <div>Dodirni meni <${Key}>⋮<//> u uglu ekrana.</div>
                </li>
                <li>
                  <div>Dodirni <${MenuItem} sr="Otvori u pretraživaču" en="Open in browser" />.</div>
                </li>
              </ol>
            `}
    </section>
  `;
}

/** Viber's own way out, one action per step. The dots are Viber's menu button as measured on a
 * Pixel (size, spacing and color), on a patch of the page's color so they look the same in both of
 * Viber's themes; the menu item is Viber's own text in Serbian and English (Viber 29.2). */
function ViberMenuSteps() {
  return html`
    <ol class="steps">
      <li>
        <div>
          Pronađi tri ljubičaste tačke u gornjem desnom uglu:
          <span class="viber-menu-chip">
            <svg class="viber-menu-dots" viewBox="0 0 11 42" role="img" aria-label="tri ljubičaste tačke">
              <circle cx="5.5" cy="5.5" r="5.5" />
              <circle cx="5.5" cy="21" r="5.5" />
              <circle cx="5.5" cy="36.5" r="5.5" />
            </svg>
          </span>
        </div>
      </li>
      <li>
        <div>Dodirni ih da se otvori meni.</div>
      </li>
      <li>
        <div>Dodirni <${MenuItem} sr="Otvori u spoljašnjem pretraživaču" en="Open in external browser" />.</div>
      </li>
    </ol>
  `;
}

/** Card on the main screen for whoever set the app up in the browser before it asked to install. */
function InstallHintCard() {
  const install = useInstall();
  const [dismissed, setDismissed] = useState(() => {
    return rawStorage.getItem("sms_izbori.installHint") === "dismissed";
  });

  if (isStandalone() || dismissed) return null;

  function dismiss() {
    rawStorage.setItem("sms_izbori.installHint", "dismissed");
    setDismissed(true);
  }

  if (install.stage !== "none") {
    const installing = install.stage === "installing";
    return html`
      <section class="flow-card ${installing ? "flow-card-action" : "flow-card-done"} install-card" role="status">
        <div class="flow-card-title">
          ${installing ? html`<span class="flow-spinner" aria-hidden="true"></span>` : html`<${CheckIcon} />`}
          <h2>${installing ? "Aplikacija se instalira…" : "Aplikacija je na telefonu"}</h2>
        </div>
        <p>${installing ? "Sačekaj nekoliko sekundi." : "Otvori plavu ikonicu „SMS Izbori“ kao svaku drugu aplikaciju."}</p>
        <div class="install-card-actions">
          <button type="button" class="btn-text" onClick=${dismiss}>Zatvori</button>
        </div>
      </section>
    `;
  }

  if (install.prompt) {
    return html`
      <section class="flow-card flow-card-action install-card">
        <h2>Instaliraj „SMS Izbori“ na telefon</h2>
        <p>Otvara se brže i uvek je pri ruci.</p>
        <div class="install-card-actions">
          <button type="button" class="btn-primary" onClick=${promptInstall}>Instaliraj</button>
          <button type="button" class="btn-text" onClick=${dismiss}>Ne sada</button>
        </div>
      </section>
    `;
  }

  if (isIos(navigator) && !IN_APP_BROWSER) {
    return html`
      <section class="flow-card flow-card-action install-card">
        <h2>Dodaj „SMS Izbori“ na telefon</h2>
        <p>
          Dodirni <${ShareIcon} /> → <${MenuItem} sr="Dodaj na početni ekran" en="Add to Home Screen" /> → <${MenuItem} sr="Dodaj" en="Add" />.
        </p>
        <p class="flow-note">Važno: u instaliranoj aplikaciji moraš ponovo da upišeš podatke.</p>
        <div class="install-card-actions">
          <button type="button" class="btn-text" onClick=${dismiss}>Ne sada</button>
        </div>
      </section>
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
                at=${sent.at}
                detail=${`${sent.value.upisani} upisanih${sent.value.vanBm != null ? `, ${sent.value.vanBm} van BM` : ""}`}
                awaiting=${awaitingConfirmation(state, "upisani")}
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
                <${SendArea}
                  label="Pripremi SMS: broj upisanih"
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
              ${sentCount == null
                ? null
                : awaitingConfirmation(state, "izlaznost", s)
                  ? html`
                      <span class="slot-chip-sent awaiting" aria-label=${`nije potvrđeno, ${sentCount}`}>
                        ⏳ ${sentCount}
                      </span>
                    `
                  : html`
                      <span
                        class="slot-chip-sent"
                        aria-label=${`poslato, ${sentCount}`}
                      >
                        ✓ ${sentCount}
                      </span>
                    `}
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
          <${SendArea}
            label=${`Pripremi SMS: izlaznost do ${slotLabel(slot)}h`}
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
          <${SendArea}
            label="Pripremi SMS: broj prijavljenih"
            issue=${state.issues["vanBm"]}
            onSend=${() => onSend("vanBm", false)}
            onConfirm=${() => onSend("vanBm", true)}
          />
        `}
      <//>
      ${log.vanBm
        ? html`
            <${SentLine}
              at=${log.vanBm.at}
              detail=${`${log.vanBm.value.count} prijavljenih`}
              awaiting=${awaitingConfirmation(state, "vanBm")}
            />
          `
        : null}

      <hr class="divider" />
      <button
        type="button"
        class="btn-secondary"
        onClick=${() => onSend("komisija", false)}
      >
        ${log.komisija == null
          ? "Komisija je formirana"
          : "Ponovo javi da je komisija formirana"}
      </button>
      ${log.komisija
        ? html`
            <${SentLine}
              text=${`Javljeno u ${formatTime(log.komisija.at)}`}
              awaiting=${awaitingConfirmation(state, "komisija")}
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
          <${SendArea}
            label="Pripremi SMS: rezultati"
            issue=${state.issues["rezultati"]}
            onSend=${() => onSend("rezultati", false)}
            onConfirm=${() => onSend("rezultati", true)}
          />
        `}
      <//>
      ${sent
        ? html`
            <${SentLine}
              at=${sent.at}
              detail=${`MI ${sent.value.mi}, ONI ${sent.value.oni}`}
              awaiting=${awaitingConfirmation(state, "rezultati")}
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
          Broj je tačan, pripremi SMS
        </button>
      </div>
    `;
  }

  return null;
}

/** What Messages shows: the text still in the box where one types, and the send arrow at its right,
 * circled. Drawn with the start of the person's own message, so that it looks like what they saw. */
function ComposeDrawing({ profile }) {
  return html`
    <svg class="compose-drawing" viewBox="0 0 320 96" role="img" aria-label="Tekst u polju za pisanje, strelica za slanje desno od njega">
      <rect class="compose-box" x="2" y="26" width="236" height="44" rx="22" />
      <text class="compose-text" x="20" y="53">BM_${profile.bm}; …</text>
      <circle class="compose-ring" cx="276" cy="48" r="38" />
      <circle class="compose-send" cx="276" cy="48" r="26" />
      <path class="compose-arrow" transform="translate(264 36)" d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
    </svg>
  `;
}

/** Whether this is the report just sent, whose sending hasn't been confirmed yet (see SentBar). */
function awaitingConfirmation(state, type, slot = null) {
  return state.undo?.type === type && (slot == null || state.undo.slot === slot);
}

/** Green check and text for a sent report: "Poslato u {at}: {detail}", or the given text. Until the
 * sending is confirmed, an amber line that asks for that instead, since a green check before then was
 * read as "the app sent it" (2026-10-24). */
function SentLine({ text, at, detail, awaiting = false }) {
  if (awaiting) {
    return html`
      <div class="sent-line awaiting">
        <span class="sent-check" aria-hidden="true">⏳</span>
        <span class="sent-text">Potvrdi dole da je poruka poslata${detail ? ` (${detail})` : ""}</span>
      </div>
    `;
  }
  return html`
    <div class="sent-line">
      <span class="sent-check" aria-label="poslato">✓</span>
      <span class="sent-text">${text ?? `Poslato u ${formatTime(at)}: ${detail}`}</span>
    </div>
  `;
}

/** After a send, whether the SMS went. The page opens Messages with the text filled in and can't see
 * whether it was sent there, so the report shows as sent only once this is answered. It covers the
 * page, so that it isn't missed: the bar it was before was overlooked while looking at the card. It asks
 * about the tap on the arrow, with a drawing of it, not whether the message went: an older tester who
 * left the text in Messages believed it had gone and said so. For the same reason the blue button, the
 * one tapped without reading, is the safe answer: Messages again, where a second SMS does no harm. */
function SentBar({ undo, profile, onConfirm, onCancel }) {
  return html`
    <div class="sent-backdrop">
      <aside class="sent-bar" role="dialog" aria-modal="true" aria-labelledby="sent-bar-title">
        <h2 id="sent-bar-title" class="sent-bar-title">Da li je u Porukama dodirnuta strelica?</h2>
        <div class="sent-bar-text" aria-live="polite">${reportLabel(undo)}</div>
        <${ComposeDrawing} profile=${profile} />
        <div class="sent-bar-actions">
          <a class="btn-primary" href=${smsUri(profile.coordinatorNumber, reportText(undo, profile), isIos(navigator))}>
            Nije — otvori Poruke ponovo
          </a>
          <button type="button" class="btn-secondary" onClick=${onConfirm}>Da, dodirnuta je</button>
          <button type="button" class="btn-text btn-full-width" onClick=${onCancel}>Odustani od slanja</button>
        </div>
      </aside>
    </div>
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
