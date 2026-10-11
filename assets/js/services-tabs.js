(function () {
  var tabs = Array.prototype.slice.call(document.querySelectorAll(".svc-tab"));
  if (!tabs.length) return;
  document.documentElement.classList.add("js-tabs");
  var aliases = { "event-growth": "events", "media-pr": "pr" };
  var ids = tabs.map(function (t) { return t.getAttribute("aria-controls"); });
  function select(id, focus, push) {
    if (ids.indexOf(id) < 0) id = ids[0];
    tabs.forEach(function (t) {
      var on = t.getAttribute("aria-controls") === id;
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
      if (on && focus) t.focus();
    });
    if (push && location.hash !== "#" + id) history.replaceState(null, "", "#" + id);
  }
  function fromHash() {
    var h = location.hash.replace("#", "");
    h = aliases[h] || h;
    select(h, false, ids.indexOf(h) >= 0);
  }
  tabs.forEach(function (t, i) {
    t.addEventListener("click", function (e) { e.preventDefault(); select(t.getAttribute("aria-controls"), false, true); });
    t.addEventListener("keydown", function (e) {
      var n = null;
      if (e.key === "ArrowRight") n = (i + 1) % tabs.length;
      else if (e.key === "ArrowLeft") n = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === "Home") n = 0;
      else if (e.key === "End") n = tabs.length - 1;
      if (n === null) return;
      e.preventDefault();
      select(tabs[n].getAttribute("aria-controls"), true, true);
    });
  });
  window.addEventListener("hashchange", fromHash);
  fromHash();
})();
