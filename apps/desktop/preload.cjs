"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dashdialerDesktop", {
  isDesktop: true,
  getLicenseStatus: () => ipcRenderer.invoke("license:status"),
  activateLicense: (key) => ipcRenderer.invoke("license:activate", key),
  clearLicense: () => ipcRenderer.invoke("license:clear"),
  refreshLicense: () => ipcRenderer.invoke("license:refresh"),
  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url),
});
