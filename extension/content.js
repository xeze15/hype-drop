/*
 * Content script — runs on real Pokémon Center / Queue-it pages the user loads.
 * Because this is a genuine browsing session it has already passed Akamai, so
 * the DOM it sees is ground truth. It classifies the page and reports to the
 * background worker, which updates state and notifies.
 */
(function () {
  'use strict';

  function report() {
    try {
      var result = self.HDDetect.classifyDocument(document, location, document.cookie);
      chrome.runtime.sendMessage({ type: 'page-observed', result: result }).catch(function () {});
    } catch (e) {
      /* ignore */
    }
  }

  // Report shortly after load, and again a moment later to catch client-side
  // (JS) redirects into a Queue-it waiting room.
  report();
  setTimeout(report, 2500);

  // Queue-it waiting rooms update the DOM as the line moves; re-check on changes,
  // throttled, so we notice if the page flips into or out of a queue.
  var last = 0;
  var observer = new MutationObserver(function () {
    var now = Date.now();
    if (now - last > 4000) {
      last = now;
      report();
    }
  });
  try {
    observer.observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {
    /* ignore */
  }
})();
