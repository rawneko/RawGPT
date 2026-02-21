const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close: () => ipcRenderer.send('window-close'),
    isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
    onMaximizedChanged: (cb) => {
        ipcRenderer.on('window-maximized-changed', (_e, v) => cb(v));
    },

    ollamaPing: (url) => ipcRenderer.invoke('ollama-ping', url),
    ollamaSetUrl: (url) => ipcRenderer.invoke('ollama-set-url', url),
    ollamaGetUrl: () => ipcRenderer.invoke('ollama-get-url'),
    ollamaListModels: () => ipcRenderer.invoke('ollama-list-models'),
    ollamaModelShow: (name) => ipcRenderer.invoke('ollama-model-show', name),
    ollamaChatStart: (data) => ipcRenderer.invoke('ollama-chat-start', data),
    ollamaChatAbort: (id) => ipcRenderer.invoke('ollama-chat-abort', id),

    openFileDialog: (opts) => ipcRenderer.invoke('open-file-dialog', opts || {}),

    onChatToken: (cb) => ipcRenderer.on('ollama-chat-token', (_e, d) => cb(d)),
    onChatDone: (cb) => ipcRenderer.on('ollama-chat-done', (_e, d) => cb(d)),
    onChatEnd: (cb) => ipcRenderer.on('ollama-chat-end', (_e, d) => cb(d)),
    onChatError: (cb) => ipcRenderer.on('ollama-chat-error', (_e, d) => cb(d)),

    removeAllChatListeners: () => {
        ipcRenderer.removeAllListeners('ollama-chat-token');
        ipcRenderer.removeAllListeners('ollama-chat-done');
        ipcRenderer.removeAllListeners('ollama-chat-end');
        ipcRenderer.removeAllListeners('ollama-chat-error');
    }
});