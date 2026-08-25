"use strict";

/**
 * SonicStudio Database Manager
 * Browser-compatible persistent storage using localStorage and IndexedDB
 */

class DatabaseManager {
  constructor() {
    this.data = {
      projects: [],
      exportHistory: [],
      themes: ["Dark", "Light", "Midnight", "Neon"],
      settings: {
        autoSave: true,
        maxHistory: 50,
        theme: "Dark",
      },
    };
    this.indexedDB = null;
    this.initDatabase();
  }

  initDatabase() {
    this.loadFromStorage();
    this.initIndexedDB();
    console.log("Database initialized successfully");
  }

  async initIndexedDB() {
    if (typeof indexedDB !== "undefined") {
      try {
        this.indexedDB = await this.openIndexedDB();
        console.log("IndexedDB ready");
      } catch (error) {
        console.warn("IndexedDB unavailable, using localStorage:", error);
      }
    }
  }

  openIndexedDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("SonicStudioDB", 1);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains("projects")) {
          db.createObjectStore("projects", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("exports")) {
          db.createObjectStore("exports", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("settings")) {
          db.createObjectStore("settings", { keyPath: "key" });
        }
      };
    });
  }

  saveProject(project) {
    const projects = this.getAllProjects();
    const existingIndex = projects.findIndex((p) => p.id === project.id);

    if (existingIndex >= 0) {
      projects[existingIndex] = project;
    } else {
      projects.push(project);
    }

    this.data.projects = projects;
    this._saveToStorage();
    this._saveToIndexedDB("projects", project);
    console.log("Project saved successfully");
  }

  getProject(id) {
    const projects = this.getAllProjects();
    return projects.find((p) => p.id === id) || null;
  }

  getAllProjects() {
    return this.data.projects;
  }

  deleteProject(id) {
    this.data.projects = this.data.projects.filter((p) => p.id !== id);
    this._saveToStorage();
    this._deleteFromIndexedDB("projects", id);
    console.log("Project deleted successfully");
  }

  addExportHistory(exportData) {
    this.data.exportHistory.push({
      ...exportData,
      timestamp: new Date().toISOString(),
    });
    this._saveToStorage();
    this._saveToIndexedDB("exports", {
      id: Date.now().toString(),
      ...exportData,
      timestamp: new Date().toISOString(),
    });
  }

  getExportHistory() {
    return this.data.exportHistory;
  }

  updateSetting(key, value) {
    this.data.settings[key] = value;
    this._saveToStorage();
    this._saveToIndexedDB("settings", { key, value });
  }

  getSetting(key) {
    return this.data.settings[key] || null;
  }

  _saveToStorage() {
    try {
      const storageData = JSON.stringify(this.data);
      localStorage.setItem("sonicstudio_db", storageData);
    } catch (error) {
      console.error("Database save error:", error);
    }
  }

  loadFromStorage() {
    try {
      const storedData = localStorage.getItem("sonicstudio_db");
      if (storedData) {
        this.data = JSON.parse(storedData);
      }
    } catch (error) {
      console.error("Database load error:", error);
      this.data = {
        projects: [],
        exportHistory: [],
        themes: ["Dark", "Light", "Midnight", "Neon"],
        settings: { autoSave: true, maxHistory: 50, theme: "Dark" },
      };
    }
  }

  async _saveToIndexedDB(storeName, data) {
    if (!this.indexedDB) return;
    try {
      const transaction = this.indexedDB.transaction([storeName], "readwrite");
      const store = transaction.objectStore(storeName);
      store.put(data);
    } catch (error) {
      console.warn("IndexedDB save failed:", error);
    }
  }

  async _deleteFromIndexedDB(storeName, id) {
    if (!this.indexedDB) return;
    try {
      const transaction = this.indexedDB.transaction([storeName], "readwrite");
      const store = transaction.objectStore(storeName);
      store.delete(id);
    } catch (error) {
      console.warn("IndexedDB delete failed:", error);
    }
  }
}

window.DatabaseManager = new DatabaseManager();
