"use strict";

class LoadingManager {
  constructor() {
    this.loadingScreen = document.getElementById("loadingScreen");
    this.app = document.getElementById("app");
  }

  show() {
    if (this.loadingScreen) {
      this.loadingScreen.style.display = "flex";
    }
    if (this.app) {
      this.app.style.display = "none";
    }
  }

  hide() {
    if (this.loadingScreen) {
      this.loadingScreen.style.display = "none";
    }
    if (this.app) {
      this.app.style.display = "block";
    }
  }

  // Simulate loading
  async load() {
    this.show();
    // Simulate loading time
    await new Promise((resolve) => setTimeout(resolve, 1500));
    this.hide();
  }
}

window.LoadingManager = new LoadingManager();

// Auto start loading on document load
document.addEventListener("DOMContentLoaded", () => {
  window.LoadingManager.load();
});
