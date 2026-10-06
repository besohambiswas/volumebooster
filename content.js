(() => {
  "use strict";

  const MAX_BOOST = 5;
  const EPSILON = 0.001;
  const round1 = (value) => Math.round(value * 10) / 10;

  const state = {
    audioContext: null,
    mediaNodes: new WeakMap(),
    gainNodes: new WeakMap(),
    protectedMedia: new WeakSet(),
    routedMedia: new Set(),
    mediaObserver: null,
    origin: "",
    globalBoost: 1,
    globalEnabled: true,
    siteSettings: {},
    boost: 1,
    enabled: true,
    initialized: false,
    activationArmed: false
  };

  const clamp = (value, min, max) =>
    Math.min(max, Math.max(min, Number(value) || min));

  function extensionAlive() {
    try {
      return Boolean(chrome.runtime && chrome.runtime.id);
    } catch (_) {
      return false;
    }
  }

  function pageOrigin() {
    try {
      const origin = location.origin;
      return /^https?:/.test(origin) ? origin : "";
    } catch (_) {
      return "";
    }
  }

  function needsRouting() {
    return state.enabled && Math.abs(state.boost - 1) > EPSILON;
  }

  function effectiveSettings() {
    const site = state.origin ? state.siteSettings[state.origin] : null;
    if (site && typeof site === "object") {
      return {
        boost: clamp(site.boost, 0, MAX_BOOST),
        enabled: Boolean(site.enabled),
        hasOverride: true
      };
    }

    return {
      boost: clamp(state.globalBoost, 0, MAX_BOOST),
      enabled: Boolean(state.globalEnabled),
      hasOverride: false
    };
  }

  function getContext() {
    if (state.audioContext) return state.audioContext;

    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;

      const ctx = new Ctx();

      ctx.onstatechange = () => {
        if (ctx.state === "running" && needsRouting()) {
          updateAll();
        }
      };

      state.audioContext = ctx;
      return ctx;
    } catch (_) {
      return null;
    }
  }

  async function resumeContext() {
    const ctx = getContext();
    if (!ctx) return false;

    try {
      if (ctx.state === "suspended") {
        await ctx.resume();
      }
      return ctx.state === "running";
    } catch (_) {
      return false;
    }
  }

  function armActivationHooks() {
    if (state.activationArmed) return;
    state.activationArmed = true;

    const onGesture = () => {
      window.removeEventListener("pointerdown", onGesture, true);
      window.removeEventListener("keydown", onGesture, true);
      state.activationArmed = false;

      resumeContext().then(() => {
        if (needsRouting()) {
          updateAll();
        }
      });
    };

    window.addEventListener("pointerdown", onGesture, true);
    window.addEventListener("keydown", onGesture, true);
  }

  function disconnectMedia(media) {
    const source = state.mediaNodes.get(media);
    const gain = state.gainNodes.get(media);
    if (!source || !gain) return;

    try {
      source.disconnect();
    } catch (_) {}

    try {
      gain.disconnect();
    } catch (_) {}

    state.routedMedia.delete(media);
  }

  function shouldSkipMedia(media) {
    if (!(media instanceof HTMLMediaElement)) return true;
    if (state.protectedMedia.has(media)) return true;
    if (media.mediaKeys) return true;
    return false;
  }

  function connectMedia(media) {
    if (!(media instanceof HTMLMediaElement)) return;
    if (!needsRouting()) return;
    if (shouldSkipMedia(media)) return;
    if (state.mediaNodes.has(media)) {
      updateGain(media);
      return;
    }

    if (media.readyState === HTMLMediaElement.HAVE_NOTHING) {
      media.addEventListener(
        "loadedmetadata",
        () => {
          connectMedia(media);
        },
        { once: true }
      );
      return;
    }

    const ctx = getContext();
    if (!ctx) return;

    if (ctx.state !== "running") {
      armActivationHooks();
      resumeContext();
      return;
    }

    try {
      const source = ctx.createMediaElementSource(media);
      const gain = ctx.createGain();

      source.connect(gain);
      gain.connect(ctx.destination);

      state.mediaNodes.set(media, source);
      state.gainNodes.set(media, gain);
      state.routedMedia.add(media);

      updateGain(media);
    } catch (_) {
      // A media element can already be controlled by page code or may be
      // protected. Leave it untouched rather than risking silence.
    }
  }

  function updateGain(media) {
    const gain = state.gainNodes.get(media);
    if (!gain) return;

    try {
      const target = needsRouting() ? clamp(state.boost, 0, MAX_BOOST) : 1;
      const now = gain.context.currentTime;

      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(target, now, 0.015);
    } catch (_) {}
  }

  function updateAll() {
    const mediaList = document.querySelectorAll("audio, video");

    if (!needsRouting()) {
      for (const media of state.routedMedia) {
        updateGain(media);
        disconnectMedia(media);
      }
      return;
    }

    for (const media of mediaList) {
      connectMedia(media);
      updateGain(media);
    }
  }

  function setupObserver() {
    if (state.mediaObserver) return;

    state.mediaObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;

          if (node.matches?.("audio, video")) {
            connectMedia(node);
          }

          node.querySelectorAll?.("audio, video").forEach(connectMedia);
        }
      }
    });

    state.mediaObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function setupMediaEvents() {
    document.addEventListener(
      "encrypted",
      (event) => {
        const media = event.target;
        if (media instanceof HTMLMediaElement) {
          state.protectedMedia.add(media);
          disconnectMedia(media);
        }
      },
      true
    );

    document.addEventListener(
      "play",
      async (event) => {
        const media = event.target;
        if (!(media instanceof HTMLMediaElement)) return;

        await resumeContext();
        connectMedia(media);
        updateGain(media);
      },
      true
    );

    document.addEventListener(
      "volumechange",
      (event) => {
        const media = event.target;
        if (media instanceof HTMLMediaElement) {
          updateGain(media);
        }
      },
      true
    );

    document.addEventListener(
      "emptied",
      (event) => {
        const media = event.target;
        if (media instanceof HTMLMediaElement) {
          disconnectMedia(media);
        }
      },
      true
    );
  }

  async function persist(patch) {
    if (!extensionAlive()) return;

    try {
      await chrome.storage.local.set(patch);
    } catch (_) {}
  }

  async function saveSiteSetting(patch) {
    if (!state.origin || Object.keys(patch).length === 0) {
      return false;
    }

    const current =
      state.siteSettings[state.origin] &&
      typeof state.siteSettings[state.origin] === "object"
        ? state.siteSettings[state.origin]
        : {};

    state.siteSettings[state.origin] = { ...current, ...patch };

    await persist({ siteSettings: state.siteSettings });
    applyEffective();
    return true;
  }

  async function clearSiteSetting() {
    if (!state.origin) return false;

    if (state.siteSettings[state.origin]) {
      delete state.siteSettings[state.origin];
      await persist({ siteSettings: state.siteSettings });
    }

    applyEffective();
    return true;
  }

  async function saveGlobalSetting(patch) {
    if ("boost" in patch) {
      state.globalBoost = clamp(patch.boost, 0, MAX_BOOST);
    }

    if ("enabled" in patch) {
      state.globalEnabled = Boolean(patch.enabled);
    }

    await persist({
      globalBoost: state.globalBoost,
      enabled: state.globalEnabled
    });

    applyEffective();
  }

  function applyEffective() {
    const effective = effectiveSettings();
    state.boost = effective.boost;
    state.enabled = effective.enabled;
    updateAll();

    if (needsRouting()) {
      resumeContext();
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!extensionAlive()) return undefined;

    (async () => {
      try {
        if (message?.type === "get-state") {
          const effective = effectiveSettings();

          sendResponse({
            ok: true,
            boost: effective.boost,
            enabled: effective.enabled,
            hasSiteOverride: effective.hasOverride,
            origin: state.origin,
            supported: Boolean(
              window.AudioContext || window.webkitAudioContext
            )
          });
          return;
        }

        if (message?.type === "set-state") {
          const patch = {};

          if ("boost" in message) {
            patch.boost = clamp(message.boost, 0, MAX_BOOST);
          }

          if ("enabled" in message) {
            patch.enabled = Boolean(message.enabled);
          }

          const saved = await saveSiteSetting(patch);
          if (!saved) {
            await saveGlobalSetting(patch);
          }

          await resumeContext();

          sendResponse({
            ok: true,
            boost: state.boost,
            enabled: state.enabled,
            hasSiteOverride: effectiveSettings().hasOverride
          });
          return;
        }

        if (message?.type === "set-global") {
          await saveGlobalSetting({
            boost: message.boost,
            enabled: message.enabled
          });

          await resumeContext();

          sendResponse({
            ok: true,
            boost: state.boost,
            enabled: state.enabled
          });
          return;
        }

        if (message?.type === "nudge") {
          const delta = clamp(message.delta, -MAX_BOOST, MAX_BOOST);
          const next = clamp(round1(state.boost + delta), 0, MAX_BOOST);

          const saved = state.origin
            ? await saveSiteSetting({ boost: next })
            : false;

          if (!saved) {
            await saveGlobalSetting({ boost: next });
          }

          await resumeContext();

          sendResponse({
            ok: true,
            boost: state.boost,
            enabled: state.enabled
          });
          return;
        }

        if (message?.type === "toggle-power") {
          const next = !state.enabled;

          const saved = state.origin
            ? await saveSiteSetting({ enabled: next })
            : false;

          if (!saved) {
            await saveGlobalSetting({ enabled: next });
          }

          await resumeContext();

          sendResponse({
            ok: true,
            boost: state.boost,
            enabled: state.enabled
          });
          return;
        }

        if (message?.type === "reset-site") {
          await clearSiteSetting();
          await resumeContext();

          sendResponse({
            ok: true,
            boost: state.boost,
            enabled: state.enabled,
            hasSiteOverride: false
          });
          return;
        }

        if (message?.type === "wake") {
          await resumeContext();
          applyEffective();
          sendResponse({ ok: true });
          return;
        }

        sendResponse({ ok: false, error: "Unknown message" });
      } catch (_) {
        sendResponse({ ok: false, error: "Operation failed" });
      }
    })();

    return true;
  });

  if (extensionAlive()) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;

      if (changes.globalBoost) {
        state.globalBoost = clamp(changes.globalBoost.newValue, 0, MAX_BOOST);
      }

      if (changes.enabled) {
        state.globalEnabled = Boolean(changes.enabled.newValue);
      }

      if (changes.siteSettings) {
        state.siteSettings =
          changes.siteSettings.newValue &&
          typeof changes.siteSettings.newValue === "object"
            ? changes.siteSettings.newValue
            : {};
      }

      applyEffective();
    });
  }

  async function init() {
    if (state.initialized) return;
    state.initialized = true;

    state.origin = pageOrigin();
    await loadSettings();
    setupObserver();
    setupMediaEvents();
    updateAll();

    if (needsRouting()) {
      await resumeContext();
      updateAll();
    }
  }

  init();
})();
