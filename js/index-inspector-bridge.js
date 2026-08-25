"use strict";

// Bridge the existing index inspector area to the unified InspectorManager.
// This is intentionally separate so index.html does not need to duplicate inspector logic.
(function () {
  function mount() {
    if (!window.InspectorManager) return;
    const sidebar = document.getElementById("rightSidebar");
    const legacy = document.getElementById("clipInspector");
    if (!sidebar) return;

    let host = document.getElementById("sonicInspectorHost");
    if (!host) {
      host = document.createElement("div");
      host.id = "sonicInspectorHost";
      host.innerHTML = "<h2>Clip Inspector</h2>";
      const body = document.createElement("div");
      body.id = "sonicInspectorHostBody";
      host.appendChild(body);
      sidebar.appendChild(host);
    }

    const panel = document.getElementById("sonicInspectorPanel");
    if (panel) {
      panel.style.position = "static";
      panel.style.top = "auto";
      panel.style.right = "auto";
      panel.style.width = "auto";
      panel.style.maxHeight = "none";
      panel.style.boxShadow = "none";
      panel.style.background = "transparent";
      panel.style.padding = "0";
      const body = panel.querySelector("#siBody");
      const head = panel.querySelector(".si-head");
      if (head) head.style.display = "none";
      if (body)
        document.getElementById("sonicInspectorHostBody").appendChild(body);
      panel.remove();
    }

    if (legacy) legacy.style.display = "none";
    if (window.InspectorManager.render) window.InspectorManager.render();
  }

  const start = () => setTimeout(mount, 0);
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
  window.addEventListener("sonicstudio:clip-selected", mount);
  setInterval(mount, 500);
})();
