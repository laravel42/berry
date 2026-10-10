const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('berryDesktop', {
   retry() {
      ipcRenderer.send('berry-desktop:retry');
   },
});
