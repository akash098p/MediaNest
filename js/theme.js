"use strict";

class ThemeManager {
  set(theme) {
    document.body.className = "";

    document.body.classList.add("theme-" + theme);
  }
}

window.ThemeManager = new ThemeManager();
