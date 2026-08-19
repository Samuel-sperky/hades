import { app, BrowserWindow, ipcMain, Tray, Menu, globalShortcut, Notification } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow = null;
let trayIcon = null;
let isQuitting = false;

/**
 * Token sa hľadá v poradí:
 * 1. HADES_UI_TOKEN environment variable
 * 2. ~/.hades/config.json
 * 3. .env v rodiči aplikácie (vyťahujeme nahor z worktrí k /config/hades/ui.php)
 */
function getToken() {
  // 1. Env variable
  if (process.env.HADES_UI_TOKEN) {
    return process.env.HADES_UI_TOKEN;
  }

  // 2. ~/.hades/config.json
  try {
    const configPath = path.join(os.homedir(), '.hades', 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.ui_token) return config.ui_token;
    }
  } catch (err) {
    // Ignoruj parseError
  }

  // 3. .env v rodiči projektu — stúpaj nahor, kým nenájdeš artisan
  try {
    let cwd = path.resolve(__dirname, '..');
    while (cwd !== path.dirname(cwd)) {
      if (fs.existsSync(path.join(cwd, 'artisan'))) {
        const envPath = path.join(cwd, '.env');
        if (fs.existsSync(envPath)) {
          const envContent = fs.readFileSync(envPath, 'utf-8');
          const match = envContent.match(/HADES_UI_TOKEN=(.+)/);
          if (match) return match[1].trim();
        }
        break;
      }
      cwd = path.dirname(cwd);
    }
  } catch (err) {
    // Ignoruj chyby
  }

  return null;
}

/**
 * HADES_URL — default http://localhost:8080
 */
function getHadesUrl() {
  return process.env.HADES_URL || 'http://localhost:8080';
}

/**
 * Načítaj uloženú geometriu okna
 */
function loadWindowState() {
  try {
    const userDataPath = app.getPath('userData');
    const stateFile = path.join(userDataPath, 'window-state.json');
    if (fs.existsSync(stateFile)) {
      return JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    }
  } catch (err) {
    // Ignoruj chyby
  }
  return {
    x: undefined,
    y: undefined,
    width: 1200,
    height: 800
  };
}

/**
 * Ulož geometriu okna
 */
function saveWindowState(window) {
  try {
    const bounds = window.getBounds();
    const userDataPath = app.getPath('userData');
    const stateFile = path.join(userDataPath, 'window-state.json');
    fs.mkdirSync(userDataPath, { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height
    }), 'utf-8');
  } catch (err) {
    // Ignoruj chyby
  }
}

/**
 * Vytvor hlavné okno
 */
function createWindow() {
  const state = loadWindowState();

  mainWindow = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.mjs')
    }
  });

  const hadesUrl = getHadesUrl();
  mainWindow.loadURL(`${hadesUrl}/console`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      // Zatvára sa len skrytím na Windows
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('move', () => saveWindowState(mainWindow));
  mainWindow.on('resize', () => saveWindowState(mainWindow));

  // Bezpečnosť: links mimo tohto originu otvor v systémovom prehliadači
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(hadesUrl)) {
      require('electron').shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(hadesUrl)) {
      event.preventDefault();
      require('electron').shell.openExternal(url);
    }
  });

  // Vloženie tokenu — len na náš origin
  const token = getToken();
  if (token) {
    mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
      { urls: [`${hadesUrl}/*`] },
      (details, callback) => {
        details.requestHeaders['X-Hades-Ui-Token'] = token;
        callback({ requestHeaders: details.requestHeaders });
      }
    );
  }
}

/**
 * Vytvor tray ikonu
 */
function createTray() {
  // Použij minimal tray ikonu (text alebo OS default)
  trayIcon = new Tray(path.join(__dirname, '..', 'assets', 'tray-icon.png'));

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Otvoriť konzolu',
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      }
    },
    { type: 'separator' },
    {
      label: 'Skryť',
      click: () => {
        mainWindow.hide();
      }
    },
    {
      label: 'Ukončiť',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  trayIcon.setContextMenu(contextMenu);
  trayIcon.on('click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

/**
 * Registruj globálnu skratku Ctrl+Alt+H
 */
function registerGlobalShortcut() {
  const ret = globalShortcut.register('Control+Alt+H', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });

  if (!ret) {
    console.log('[HADES-CONSOLE] Globálna skratka Ctrl+Alt+H sa nepodarila zaregistrovať (konflikt?).');
  }
}

/**
 * Počúvaj správy z preload skriptu o #run-announce
 */
ipcMain.on('announce-result', (event, text) => {
  if (mainWindow && !mainWindow.isFocused()) {
    const notification = new Notification({
      title: 'Hades — Odpoveď',
      body: text,
      silent: false
    });
    notification.show();
  }
});

/**
 * Inicializuj app
 */
app.on('ready', () => {
  createWindow();
  createTray();
  registerGlobalShortcut();
});

app.on('window-all-closed', () => {
  // Na macOS okno ostane otvorené, kým užívateľ explicitne neskončí app
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
