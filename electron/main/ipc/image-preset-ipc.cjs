/** 调色预设的 IPC：就 load / save 两个方法，save 是整份覆盖。 */
function registerImagePresetIpc({ ipcMain, presetStore }) {
  ipcMain.handle('image-presets:load', async () => presetStore.load());
  ipcMain.handle('image-presets:save', async (_event, payload) => presetStore.save(payload));
}

module.exports = { registerImagePresetIpc };
