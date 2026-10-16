import { shell } from 'electron';
import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron/main';
import type { MenuItemConstructorOptions, WebContents } from 'electron/main';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { cliRequestFrom, runCli } from './cli.js';
import {
   applyEnvFile,
   bundledNodeBin,
   findRepoRoot,
   localStack,
   REPO_DESKTOP_ENV_KEYS,
   resolveStack,
   startLocalStack,
   type RunningStack,
} from './stack.js';
import { externalHttpUrl, inAppNavigation, parseStartUrl, type StartUrl } from './url.js';

const RETRY_CHANNEL = 'berry-desktop:retry';
const RUN_CLI_CHANNEL = 'berry-desktop:run-cli';

app.setName('Berry');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
   app.quit();
}

const session: { start: StartUrl | null } = { start: null };
let local: RunningStack | null = null;

function readExplicitStart(): StartUrl | null {
   const raw = process.env.BERRY_DESKTOP_URL;
   if (raw === undefined || raw.trim() === '') return null;
   try {
      return parseStartUrl(raw);
   } catch (error) {
      const message = error instanceof Error ? error.message : 'BERRY_DESKTOP_URL is invalid.';
      dialog.showErrorBox('Berry', message);
      app.exit(1);
      throw error;
   }
}

let window: BrowserWindow | null = null;

function openOutside(target: string): void {
   const external = externalHttpUrl(target);
   if (external === null) return;
   void shell.openExternal(external).catch(() => undefined);
}

function attachNavigation(contents: WebContents): void {
   contents.setWindowOpenHandler(({ url }) => {
      if (session.start !== null && inAppNavigation(url, session.start.origin)) return { action: 'allow' };
      openOutside(url);
      return { action: 'deny' };
   });
   contents.on('will-navigate', (event, url) => {
      if (session.start !== null && inAppNavigation(url, session.start.origin)) return;
      event.preventDefault();
      openOutside(url);
   });
}

function offlineHtml(detail: string): string {
   const safe = detail.replace(/[&<>"]/g, (char) => {
      if (char === '&') return '&amp;';
      if (char === '<') return '&lt;';
      if (char === '>') return '&gt;';
      return '&quot;';
   });
   return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Berry</title>
<style>
   body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #18181b;
      color: #F8F8F4;
      font-family: "JetBrains Mono", ui-monospace, monospace;
      font-size: 0.8125rem;
      line-height: 1.2;
   }
   main { width: min(28rem, calc(100% - 3rem)); }
   h1 {
      font-family: "JetBrains Mono", ui-monospace, monospace;
      font-size: 1.125rem;
      font-weight: 500;
      line-height: 1.333;
      margin: 0 0 0.5rem;
   }
   p { margin: 0 0 1rem; }
   button {
      font: inherit;
      height: 36px;
      padding: 8px 16px;
      border-radius: 8px;
      border: 0;
      background: #C74A5E;
      color: #ffffff;
   }
</style>
</head>
<body>
<main>
   <h1>Berry is not open</h1>
   <p>The window loads the web app at ${safe}. Start it, then try again.</p>
   <button type="button" onclick="berryDesktop.retry()">Try again</button>
</main>
</body>
</html>`;
}

function showOffline(contents: WebContents, detail: string): void {
   void contents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(offlineHtml(detail))}`);
}

function appIconPath(): string {
   return path.join(path.dirname(fileURLToPath(import.meta.url)), 'icon.png');
}

function createWindow(): void {
   const preload = path.join(path.dirname(fileURLToPath(import.meta.url)), 'preload.cjs');
   const created = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 960,
      minHeight: 640,
      title: 'Berry',
      backgroundColor: '#18181b',
      icon: appIconPath(),
      show: false,
      webPreferences: {
         preload,
         contextIsolation: true,
         sandbox: true,
         nodeIntegration: false,
         nodeIntegrationInWorker: false,
         nodeIntegrationInSubFrames: false,
         webviewTag: false,
      },
   });
   window = created;
   created.once('ready-to-show', () => {
      created.show();
   });
   created.on('closed', () => {
      if (window === created) window = null;
   });
   created.webContents.on('did-fail-load', (_event, errorCode, _description, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return;
      let failedApp = false;
      try {
         failedApp = session.start !== null && new URL(validatedURL).origin === session.start.origin;
      } catch {
         failedApp = false;
      }
      if (!failedApp) return;
      showOffline(created.webContents, session.start?.href ?? '');
   });
   if (session.start !== null) void created.loadURL(session.start.href);
}

function installMenu(): void {
   const view: MenuItemConstructorOptions = {
      label: 'View',
      submenu: [
         { role: 'reload' },
         { role: 'forceReload' },
         { type: 'separator' },
         { role: 'resetZoom' },
         { role: 'zoomIn' },
         { role: 'zoomOut' },
         { type: 'separator' },
         { role: 'togglefullscreen' },
      ],
   };
   if (!app.isPackaged) {
      const submenu = view.submenu;
      if (Array.isArray(submenu)) {
         submenu.splice(2, 0, { role: 'toggleDevTools' }, { type: 'separator' });
      }
   }
   const template: MenuItemConstructorOptions[] = [
      {
         label: app.name,
         submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
         ],
      },
      { role: 'editMenu' },
      view,
      { role: 'windowMenu' },
   ];
   Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

if (gotLock) {
   app.on('second-instance', () => {
      if (window === null) return;
      if (window.isMinimized()) window.restore();
      window.focus();
   });

   app.on('web-contents-created', (_event, contents) => {
      attachNavigation(contents);
   });

   ipcMain.on(RETRY_CHANNEL, (event) => {
      const owner = BrowserWindow.fromWebContents(event.sender);
      if (owner === null || owner.isDestroyed() || session.start === null) return;
      void owner.loadURL(session.start.href);
   });

   ipcMain.handle(RUN_CLI_CHANNEL, (event, payload: unknown) => {
      const owner = BrowserWindow.fromWebContents(event.sender);
      let origin = '';
      try {
         origin = new URL(event.sender.getURL()).origin;
      } catch {
         origin = '';
      }
      if (owner === null || owner.isDestroyed() || session.start === null || origin !== session.start.origin) {
         throw new Error('CLI is only available from the Berry window.');
      }
      return runCli(cliRequestFrom(payload));
   });

   let quitting = false;
   app.on('before-quit', (event) => {
      if (quitting || local === null) return;
      event.preventDefault();
      quitting = true;
      const running = local;
      local = null;
      void running.stop().finally(() => {
         app.quit();
      });
   });

   void app.whenReady().then(async () => {
      if (process.platform === 'darwin') app.dock?.setIcon(appIconPath());
      installMenu();
      applyEnvFile(path.join(app.getPath('userData'), 'desktop.env'), process.env);
      const here = path.dirname(fileURLToPath(import.meta.url));
      for (const start of [process.cwd(), process.resourcesPath, here]) {
         if (start === undefined || start === '') continue;
         const root = findRepoRoot(start);
         if (root === null) continue;
         applyEnvFile(path.join(root, '.env'), process.env, REPO_DESKTOP_ENV_KEYS);
         break;
      }
      const explicit = readExplicitStart();
      if (explicit !== null) {
         session.start = explicit;
      } else {
         const layout = resolveStack({
            start: here,
            resourcesPath: process.resourcesPath,
            cwd: process.cwd(),
            env: process.env,
         });
         if (layout === null) {
            dialog.showErrorBox(
               'Berry',
               'The desktop app could not find a Berry server bundle or a git checkout.',
            );
            app.quit();
            return;
         }
         try {
            const nodeBin = bundledNodeBin(layout, app.isPackaged ? process.execPath : 'node');
            local = await startLocalStack(layout, localStack(app.getPath('userData')), {
               nodeBin,
               electronAsNode: app.isPackaged && nodeBin === process.execPath,
            });
            session.start = parseStartUrl(local.webOrigin);
         } catch (error) {
            const message = error instanceof Error ? error.message : 'The local server did not start.';
            dialog.showErrorBox('Berry', message);
            app.quit();
            return;
         }
      }
      createWindow();
      app.on('activate', () => {
         if (BrowserWindow.getAllWindows().length === 0) createWindow();
      });
   });

   app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') app.quit();
   });
}
