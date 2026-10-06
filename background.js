"use strict";

const MAX_BOOST = 5;
const round1 = (value) => Math.round(value * 10) / 10;

const clamp = (value, min, max) =>
  Math.min(max, Math.max(min, Number(value) || min));

// Fallback for pages that cannot host content scripts (chrome://, etc.):
// adjust the global default instead of a per-site setting.
async function adjustGlobalBoost(delta) {
  const data = await chrome.storage.local.get({ globalBoost: 1 });
  const boost = clamp(
    round1((Number(data.globalBoost) || 1) + delta),
    0,
    MAX_BOOST
  );
  await chrome.storage.local.set({ globalBoost: boost });
}

async function toggleGlobalPower() {
  const data = await chrome.storage.local.get({ enabled: true });
  await chrome.storage.local.set({ enabled: !data.enabled });
}

chrome.commands.onCommand.addListener(async (command) => {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab?.id) return;

    // The content script knows the page origin, so it persists the change
    // as a per-site setting. Fall back to global storage when the page
    // cannot host content scripts.
    if (command === "increase-boost" || command === "decrease-boost") {
      const delta = command === "increase-boost" ? 0.1 : -0.1;
      try {
        const res = await chrome.tabs.sendMessage(tab.id, {
          type: "nudge",
          delta
        });
        if (res?.ok) return;
      } catch (_) {}

      await adjustGlobalBoost(delta);
      return;
    }

    if (command === "toggle-mute") {
      try {
        const res = await chrome.tabs.sendMessage(tab.id, {
          type: "toggle-power"
        });
        if (res?.ok) return;
      } catch (_) {}

      await toggleGlobalPower();
      return;
    }
  } catch (_) {}
});
