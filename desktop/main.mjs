import { app, BrowserWindow, ipcMain, Tray, Menu, globalShortcut, Notification, shell, nativeImage } from 'electron';
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
      // Oba klienty čítajú TEN ISTÝ súbor, takže musia poznať to isté meno kľúča.
      // `bin/hades` (a jeho README) používa `token`; pôvodná verzia tu čítala len
      // `ui_token`, takže kto si config nastavil podľa README, tomu okno token
      // nenašlo, spadlo na `.env` a v okne skončilo mlčanlivé 401.
      if (config.token) return config.token;
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
      preload: path.join(__dirname, 'preload.cjs')
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

  // Bezpečnosť: čokoľvek mimo NÁŠHO ORIGINU otvor v systémovom prehliadači.
  //
  // Porovnáva sa parsovaný origin, nie prefix reťazca. `startsWith(hadesUrl)`
  // považovalo za vlastné aj `http://localhost:8080.evil.com/` a
  // `http://localhost:8080@evil.com/`, takže nalákaná navigácia (redirect alebo
  // odkaz v obsahu, ktorý spoluvytvára model) prepla dôveryhodné okno appky na
  // cudzí origin a `will-navigate` ju nezastavil. Token sa naň neposielal, ale
  // obsah útočníka sa vykreslil v okne, ktoré token nosí.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!isOwnOrigin(url, hadesUrl)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isOwnOrigin(url, hadesUrl)) {
      event.preventDefault();
      shell.openExternal(url);
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
 * Je URL na tom istom origine ako appka?
 *
 * Neparsovateľná URL je „cudzia" — fail-closed. `about:blank` a `devtools://`
 * sem nechodia, tie Electron rieši vlastnými kanálmi.
 */
function isOwnOrigin(url, hadesUrl) {
  try {
    return new URL(url).origin === new URL(hadesUrl).origin;
  } catch {
    return false;
  }
}

/**
 * Vytvor tray ikonu.
 *
 * Ikona je vložená ako data URL a nie ako súbor v `assets/`: pôvodná verzia
 * ukazovala na `../assets/tray-icon.png`, ktorý v repozitári NIE JE, a `new Tray()`
 * na nenačítateľný obrázok vyhodí výnimku. Padla priamo v handleri `ready` za
 * `createWindow()`, takže sa už nezavolala registrácia globálnej skratky — tray aj
 * Ctrl+Alt+H boli mŕtve a v hlavnom procese ležala neodchytená výnimka.
 *
 * Preto aj `try/catch`: appka bez tray ikony je použiteľná, appka, ktorá kvôli
 * ikone nenaštartuje, nie.
 */
function createTray() {
  // 16×16 PNG so značkovou zlatou bodkou vedomia; vložené, aby klient nezávisel
  // od súboru, ktorý sa dá zmazať alebo zabudnúť pri kopírovaní priečinka.
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAX0lEQVR4AWMY'
    + 'BaNgFIyCUTAKRsEoGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBaNgFIyCUTAKRsEoGAWjYBSMglEw'
    + 'CkbBKBgFo2AUjIJRMApGwSgYBaMAAAOaAAFrJHrPAAAAAElFTkSuQmCC'
  );

  try {
    trayIcon = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  } catch (error) {
    console.error('Tray ikonu sa nepodarilo vytvoriť, appka beží bez nej:', error.message);

    return;
  }

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
