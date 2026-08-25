"use strict";

class ShortcutsManager {
  init() {
    document.addEventListener("keydown", (e) => {
      console.log(e.key);
    });
  }
}

window.ShortcutsManager = new ShortcutsManager();
