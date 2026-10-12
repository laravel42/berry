const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('berryDesktop', {
   retry() {
      ipcRenderer.send('berry-desktop:retry');
   },
   runCli(request) {
      return ipcRenderer.invoke('berry-desktop:run-cli', request);
   },
});
