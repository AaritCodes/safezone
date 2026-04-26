// js/modules/notifications.js

export function showStatus(text) {
  let el = document.getElementById('statusIndicator');
  if (!el) {
    el = document.createElement('div');
    el.id = 'statusIndicator';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.style.cssText = 'position:fixed;top:75px;left:50%;transform:translateX(-50%);z-index:1002;background:rgba(99,102,241,0.9);backdrop-filter:blur(20px);color:white;padding:8px 20px;border-radius:30px;font-size:13px;font-weight:600;font-family:Inter,sans-serif;display:none;transition:all 0.3s ease;box-shadow:0 4px 16px rgba(0,0,0,0.3);';
    document.body.appendChild(el);
  }

  if (text) {
    el.textContent = text;
    el.style.display = 'block';
  } else {
    el.style.display = 'none';
  }
}

export function showNotification(message, type = 'info', duration = 3000) {
  const container = document.getElementById('notificationContainer') || createNotificationContainer();

  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.setAttribute('role', 'alert');
  notification.setAttribute('aria-live', 'assertive');
  notification.textContent = message;

  container.appendChild(notification);

  setTimeout(() => notification.classList.add('show'), 10);

  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => notification.remove(), 300);
  }, duration);
}

export function createNotificationContainer() {
  const container = document.createElement('div');
  container.id = 'notificationContainer';
  container.style.cssText = 'position:fixed;top:20px;right:20px;z-index:10000;display:flex;flex-direction:column;gap:10px;max-width:400px;';
  document.body.appendChild(container);
  return container;
}
