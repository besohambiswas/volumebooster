(() => {
  "use strict";

  const MAX_BOOST = 5;

  const slider = document.getElementById("slider");
  const value = document.getElementById("value");
  const power = document.getElementById("power");
  const reset = document.getElementById("reset");
  const status = document.getElementById("status");
  const siteName = document.getElementById("site-name");
  const scopeSite = document.getElementById("scope-site");
  const scopeGlobal = document.getElementById("scope-global");

  let scope = "global"; // "site" | "global"
  let origin = ""; // origin of the active tab ("" = not a normal page)
  let hasOverride = false; // does this site have its own saved setting?
  let global = { boost: 1, enabled: true };
  let site = { boost: 1, enabled: true }; // effective values for the site
  let boost = 1;
  let enabled = true;

  const clampBoost = (raw) =>
    Math.max(0, Math.min(MAX_BOOST, Number(raw) || 0));

  function hostLabel(originUrl) {
    try {
      return new URL(originUrl).hostname.replace(/^www\./, "");
    } catch (_) {
      return "this site";
    }
  }

  function render() {
    value.textContent = `${Math.round(boost * 100)}%`;
    slider.value = String(Math.round(boost * 100));
    power.textContent = enabled ? "ON" : "OFF";
    power.classList.toggle("on", enabled);

    scopeSite.classList.toggle("active", scope === "site");
    scopeGlobal.classList.toggle("active", scope === "global");
    scopeSite.disabled = !origin;

    siteName.textContent = origin ? hostLabel(origin) : "All sites";

    reset.textContent =
      scope === "site"
        ? hasOverride
          ? "Forget this site's setting"
          : "Use global setting here"
        : "Reset to 100%";
  }

  function renderScopeValues() {
    const source = scope === "site" ? site : global;
    boost = clampBoost(source.boost);
    enabled = Boolean(source.enabled);
    render();
  }

  async function getTab() {
    const tabs = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });
    return tabs[0];
  }

  function originOf(tab) {
    try {
      const url = new URL(tab.url || "");
      return /^https?:/.test(url.protocol) ? url.origin : "";
    } catch (_) {
      return "";
    }
  }

  // If the extension was (re)loaded after the page opened, its content
  // script may be missing. activeTab access from the popup lets us inject
  // it on demand instead of asking for a page refresh.
  async function ensureContentScript(tab) {
    if (!tab?.id) return false;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "get-state" });
      return true;
    } catch (_) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content.js"]
        });
        return true;
      } catch (_) {
        return false;
      }
    }
  }

  async function save() {
    boost = clampBoost(Number(slider.value) / 100);

    if (scope === "site" && origin) {
      const tab = await getTab();
      try {
        const res = await chrome.tabs.sendMessage(tab.id, {
          type: "set-state",
          boost,
          enabled
        });
        if (res?.ok) {
          hasOverride = Boolean(res.hasSiteOverride);
          site = {
            boost: clampBoost(res.boost),
            enabled: Boolean(res.enabled)
          };
          boost = site.boost;
          enabled = site.enabled;
          status.textContent = "Saved for this site";
          render();
          return;
        }
      } catch (_) {}

      status.textContent = "This page can't be controlled";
      render();
      return;
    }

    try {
      await chrome.storage.local.set({
        globalBoost: boost,
        enabled
      });
      global = { boost, enabled };
      status.textContent = "Saved for all sites";
    } catch (_) {
      status.textContent = "Could not save settings";
    }
    render();
  }

  async function loadGlobal() {
    const data = await chrome.storage.local.get({
      globalBoost: 1,
      enabled: true
    });
    global = {
      boost: clampBoost(data.globalBoost),
      enabled: Boolean(data.enabled)
    };
  }

  async function init() {
    try {
      await loadGlobal();

      const tab = await getTab();
      origin = originOf(tab || {});
      scope = origin ? "site" : "global";
      site = { ...global };

      if (origin && tab?.id && (await ensureContentScript(tab))) {
        try {
          const res = await chrome.tabs.sendMessage(tab.id, {
            type: "get-state"
          });
          if (res?.ok) {
            hasOverride = Boolean(res.hasSiteOverride);
            site = {
              boost: clampBoost(res.boost),
              enabled: Boolean(res.enabled)
            };
            status.textContent = "Ready";
          }
        } catch (_) {
          status.textContent = "This page can't be controlled";
        }
      } else if (tab?.id) {
        // Not a normal webpage: only global edits make sense here.
        try {
          await chrome.tabs.sendMessage(tab.id, { type: "wake" });
          status.textContent = "Ready";
        } catch (_) {
          status.textContent = "This page can't be controlled";
        }
      }
    } catch (_) {
      status.textContent = "Ready";
    }

    renderScopeValues();
    render();
  }

  slider.addEventListener("input", () => {
    boost = clampBoost(Number(slider.value) / 100);
    render();
  });

  slider.addEventListener("change", save);

  power.addEventListener("click", async () => {
    enabled = !enabled;
    slider.value = String(Math.round(boost * 100));
    await save();
  });

  reset.addEventListener("click", async () => {
    if (scope === "site" && origin) {
      const tab = await getTab();
      try {
        const res = await chrome.tabs.sendMessage(tab.id, {
          type: "reset-site"
        });
        if (res?.ok) {
          hasOverride = false;
          site = {
            boost: clampBoost(res.boost),
            enabled: Boolean(res.enabled)
          };
          status.textContent = "Using the global setting here";
          renderScopeValues();
          return;
        }
      } catch (_) {}

      status.textContent = "This page can't be controlled";
      render();
      return;
    }

    try {
      await chrome.storage.local.set({ globalBoost: 1, enabled: true });
      global = { boost: 1, enabled: true };
      status.textContent = "Reset to 100%";
    } catch (_) {
      status.textContent = "Could not save settings";
    }
    renderScopeValues();
  });

  scopeSite.addEventListener("click", () => {
    if (!origin) return;
    scope = "site";
    renderScopeValues();
  });

  scopeGlobal.addEventListener("click", () => {
    scope = "global";
    renderScopeValues();
  });

  document.querySelectorAll("[data-value]").forEach((button) => {
    button.addEventListener("click", async () => {
      slider.value = button.dataset.value;
      await save();
    });
  });

  init();
})();
