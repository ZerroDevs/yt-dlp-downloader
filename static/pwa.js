let deferredInstallPrompt = null;

function isStandaloneApp() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  });
}

function createInstallButton() {
  if (isStandaloneApp()) return;

  const sidebarNav = document.querySelector('.sidebar-nav');
  if (!sidebarNav || document.getElementById('pwaInstallBtn')) return;

  const installBtn = document.createElement('button');
  installBtn.id = 'pwaInstallBtn';
  installBtn.className = 'pwa-install-btn hidden';
  installBtn.type = 'button';
  installBtn.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
      <polyline points="7 10 12 15 17 10"></polyline>
      <line x1="12" y1="15" x2="12" y2="3"></line>
    </svg>
    <span>Install App</span>
  `;
  installBtn.title = 'Install on your PC';

  installBtn.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;

    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;

    if (outcome === 'accepted') {
      installBtn.classList.add('hidden');
    }
  });

  sidebarNav.insertAdjacentElement('afterend', installBtn);
  return installBtn;
}

function initInstallPrompt() {
  const installBtn = createInstallButton();

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    installBtn?.classList.remove('hidden');
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    installBtn?.classList.add('hidden');
  });
}

function updateAppLogo() {
  const logo = document.querySelector('.sidebar-header .logo');
  if (!logo || logo.querySelector('.logo-icon')) return;

  logo.innerHTML = `
    <img src="/static/logo.webp" alt="YT Downloader" class="logo-icon" width="32" height="32">
    <span>YT Downloader</span>
  `;
}

registerServiceWorker();

function initPwa() {
  initInstallPrompt();
  updateAppLogo();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPwa);
} else {
  initPwa();
}
