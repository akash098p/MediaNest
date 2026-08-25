"use strict";

class ProjectManager {
  newProject() {
    console.log("New Project");
  }

  saveProject() {
    console.log("Save Project");
  }

  openProject() {
    console.log("Open Project");
  }
}

window.ProjectManager = new ProjectManager();
