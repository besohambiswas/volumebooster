CLEAN VOLUME BOOSTER
=====================

INSTALLATION
1. Extract the extension ZIP.
2. Open Chrome.
3. Visit chrome://extensions
4. Enable "Developer mode".
5. Click "Load unpacked".
6. Select the extracted "volume_booster_extension" folder.

USAGE
- Open a webpage containing audio/video.
- Click the extension icon.
- Settings apply to the current site by default ("This site"); switch the
  scope toggle to "All sites" to change the global default.
- Set Boost from 0% to 500%.
- Click ON/OFF to enable or disable amplification.
- Every site remembers its own boost and ON/OFF state.
- "Forget this site's setting" removes the per-site override so the site
  falls back to the global default.

SHORTCUTS
Alt+Shift+Up     Increase boost
Alt+Shift+Down   Decrease boost
Alt+Shift+M      Toggle booster

SAFETY DESIGN
- No page DOM manipulation.
- No iframe rewriting.
- No page reloads.
- Media is rerouted only when a non-neutral boost is requested; at 100%
  (or while switched off) media elements stay completely untouched.
- OFF means bypass to normal volume, not mute.
- DRM/protected media (EME/"encrypted" events, mediaKeys) is never rerouted,
  so sites like Netflix/Spotify keep playing normally.
- Media is never connected while the AudioContext is suspended; connection
  waits for a user gesture or play event, which prevents total silence.
- Unsupported/protected media fails silently.
- Gain changes use a short ramp to reduce clicks/pops.
- MutationObserver only watches for newly added audio/video elements.
- Boost values from keyboard shortcuts are rounded to 0.1 steps to avoid
  floating-point drift in stored settings.
- Per-site settings are stored per origin in chrome.storage.local; nothing
  leaves the browser.

ICONS
icons/ contains 16/32/48/128 px PNGs (blue/violet gradient tile, white
speaker). Regenerate with: node scripts/make-icons.js

TESTING CHECKLIST
1. YouTube (normal video)
   - Play a video, set Boost to 150%: audio gets louder, video keeps
     playing, page controls stay responsive.
   - Reload the page: 150% reapplies automatically for youtube.com.
   - Open the popup on another site: it shows that site's own value.
2. DRM site (Netflix, Disney+, Spotify web player)
   - With the booster at 100%, play protected content: audio must play
     normally (protected media is never rerouted).
   - Try to boost while DRM audio plays: nothing breaks; protected
     streams are skipped by design.
3. Keyboard shortcuts
   - Alt+Shift+Up / Down while audio plays: smooth change, no clicks or
     pops, and the value is remembered for the current site.
   - Alt+Shift+M toggles the booster on the current site.
4. Edge cases
   - chrome:// page: popup says "This page can't be controlled"; nothing
     breaks.
   - Reload the extension in chrome://extensions, then open the popup on
     an already-open tab: the content script is injected on demand and
     the page is controllable without a manual refresh.
   - Two sites with different boosts, both reloaded: each keeps its own.

LIMITATIONS
Chrome-protected pages such as chrome:// pages cannot be controlled.
Some DRM/protected media may reject Web Audio routing.
Some websites use unusual audio architectures that may not expose
their media through HTMLMediaElement.
