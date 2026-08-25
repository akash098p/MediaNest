"use strict";

class NotificationManager {
  constructor() {
    this.container = document.getElementById("notificationContainer");
    this.notifications = [];
  }

  show(message, type = "info", duration = 3000) {
    if (!this.container) return;

    const notification = document.createElement("div");
    notification.className = `notification ${type}`;
    notification.innerHTML = `<span>${message}</span><button class="close-notification">&times;</button>`;

    this.container.appendChild(notification);
    this.notifications.push(notification);

    // Show animation
    setTimeout(() => notification.classList.add("show"), 10);

    // Close button
    const closeBtn = notification.querySelector(".close-notification");
    closeBtn.addEventListener("click", () => this.remove(notification));

    // Auto remove
    setTimeout(() => {
      this.remove(notification);
    }, duration);
  }

  remove(notification) {
    if (notification && notification.parentNode) {
      notification.classList.remove("show");
      notification.addEventListener(
        "transitionend",
        () => {
          if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
          }
        },
        { once: true },
      );
    }
  }

  info(message, duration) {
    this.show(message, "info", duration);
  }

  success(message, duration) {
    this.show(message, "success", duration);
  }

  warning(message, duration) {
    this.show(message, "warning", duration);
  }

  error(message, duration) {
    this.show(message, "error", duration);
  }
}

// Create instance and attach to all possible global names
const notificationManager = new NotificationManager();
window.NotificationManager = notificationManager;
window.notificationManager = notificationManager;
