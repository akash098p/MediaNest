"use strict";

class StorageManager {
  constructor() {
    this.storageKey = "medianest-projects";
  }

  save(projectKey, data) {
    try {
      const projects = this._loadAll();
      projects[projectKey] = JSON.stringify({
        ...projects[projectKey],
        ...data,
        savedAt: new Date().toISOString(),
      });
      this._saveAll(projects);
      return true;
    } catch (e) {
      console.error("Storage save failed:", e);
      return false;
    }
  }

  load(projectKey) {
    try {
      const projects = this._loadAll();
      const stored = projects[projectKey];
      if (stored) {
        const parsed = JSON.parse(stored);
        delete parsed.savedAt;
        return parsed;
      }
      return null;
    } catch (e) {
      console.error("Storage load failed:", e);
      return null;
    }
  }

  deleteProject(projectKey) {
    try {
      const projects = this._loadAll();
      if (projects[projectKey]) {
        delete projects[projectKey];
        this._saveAll(projects);
        return true;
      }
      return false;
    } catch (e) {
      console.error("Storage delete failed:", e);
      return false;
    }
  }

  listProjects() {
    try {
      return Object.keys(this._loadAll())
        .filter((k) => k !== "default")
        .map((k) => ({
          key: k,
          name: k.replace(/([A-Z][a-z])/g, " $1").trim(),
          modified: new Date(this._loadAll()[k].savedAt),
        }));
    } catch (e) {
      console.error("Listing projects failed:", e);
      return [];
    }
  }

  _loadAll() {
    const data = localStorage.getItem(this.storageKey);
    return data ? JSON.parse(data) : {};
  }

  _saveAll(projects) {
    localStorage.setItem(this.storageKey, JSON.stringify(projects));
  }

  clearAll() {
    localStorage.removeItem(this.storageKey);
  }
}

window.StorageManager = new StorageManager();
