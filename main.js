const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const http = require('http');
const https = require('https');
const fs = require('fs');

let mainWindow = null;
let ollamaBaseUrl = 'http://127.0.0.1:11434';

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 820,
        minWidth: 640,
        minHeight: 500,
        frame: false,
        icon: path.join(__dirname, 'icon.ico'),
        titleBarStyle: 'hidden',
        backgroundColor: '#0a0a0a',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        },
        show: false
    });

    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    mainWindow.on('maximize', () => {
        mainWindow.webContents.send('window-maximized-changed', true);
    });

    mainWindow.on('unmaximize', () => {
        mainWindow.webContents.send('window-maximized-changed', false);
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.on('window-minimize', () => {
    if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
    if (mainWindow) {
        mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
    }
});

ipcMain.on('window-close', () => {
    if (mainWindow) mainWindow.close();
});

ipcMain.handle('window-is-maximized', () => {
    return mainWindow ? mainWindow.isMaximized() : false;
});

function httpRequest(url, method, body, timeout) {
    method = method || 'GET';
    timeout = timeout || 8000;
    return new Promise((resolve, reject) => {
        try {
            const parsed = new URL(url);
            const lib = parsed.protocol === 'https:' ? https : http;
            const options = {
                hostname: parsed.hostname,
                port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
                path: parsed.pathname + parsed.search,
                method: method,
                headers: { 'Content-Type': 'application/json' },
                timeout: timeout
            };
            const req = lib.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    try {
                        resolve({ status: res.statusCode, data: JSON.parse(data) });
                    } catch (e) {
                        resolve({ status: res.statusCode, data: data });
                    }
                });
            });
            req.on('error', (err) => reject(err));
            req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
            if (body) req.write(JSON.stringify(body));
            req.end();
        } catch (err) {
            reject(err);
        }
    });
}

ipcMain.handle('ollama-ping', async (event, customUrl) => {
    const baseUrl = customUrl || ollamaBaseUrl;
    try {
        const result = await httpRequest(baseUrl + '/api/tags', 'GET', null, 5000);
        if (result.status === 200) return { success: true, url: baseUrl };
        return { success: false, error: 'HTTP ' + result.status };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('ollama-set-url', async (event, url) => {
    ollamaBaseUrl = url.replace(/\/+$/, '');
    return { success: true, url: ollamaBaseUrl };
});

ipcMain.handle('ollama-get-url', async () => {
    return ollamaBaseUrl;
});

ipcMain.handle('ollama-list-models', async () => {
    try {
        const result = await httpRequest(ollamaBaseUrl + '/api/tags');
        if (result.status === 200 && result.data && result.data.models) {
            return {
                success: true,
                models: result.data.models.map(m => ({
                    name: m.name,
                    size: m.size || 0,
                    modified: m.modified_at,
                    digest: m.digest,
                    details: m.details || {}
                }))
            };
        }
        return { success: false, error: 'Bad response', models: [] };
    } catch (err) {
        return { success: false, error: err.message, models: [] };
    }
});

ipcMain.handle('ollama-model-show', async (event, modelName) => {
    try {
        const result = await httpRequest(ollamaBaseUrl + '/api/show', 'POST', { name: modelName });
        if (result.status === 200) {
            return { success: true, data: result.data };
        }
        return { success: false, error: 'HTTP ' + result.status };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('ollama-chat-start', async (event, { model, messages, requestId }) => {
    try {
        const parsed = new URL(ollamaBaseUrl + '/api/chat');
        const lib = parsed.protocol === 'https:' ? https : http;
        const body = JSON.stringify({ model, messages, stream: true });
        const options = {
            hostname: parsed.hostname,
            port: parsed.port || 80,
            path: parsed.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        };

        return new Promise((resolve) => {
            const req = lib.request(options, (res) => {
                if (res.statusCode !== 200) {
                    let errData = '';
                    res.on('data', chunk => errData += chunk);
                    res.on('end', () => {
                        if (mainWindow) mainWindow.webContents.send('ollama-chat-error', { requestId, error: 'HTTP ' + res.statusCode + ': ' + errData });
                    });
                    resolve({ success: false });
                    return;
                }

                let buffer = '';
                res.on('data', (chunk) => {
                    if (!mainWindow) return;
                    buffer += chunk.toString();
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed) continue;
                        try {
                            const json = JSON.parse(trimmed);
                            if (json.message && json.message.content) {
                                mainWindow.webContents.send('ollama-chat-token', { requestId, token: json.message.content });
                            }
                            if (json.done) {
                                mainWindow.webContents.send('ollama-chat-done', { requestId, total_duration: json.total_duration, eval_count: json.eval_count });
                            }
                        } catch (e) {}
                    }
                });

                res.on('end', () => {
                    if (buffer.trim() && mainWindow) {
                        try {
                            const json = JSON.parse(buffer.trim());
                            if (json.message && json.message.content) {
                                mainWindow.webContents.send('ollama-chat-token', { requestId, token: json.message.content });
                            }
                            if (json.done) {
                                mainWindow.webContents.send('ollama-chat-done', { requestId, total_duration: json.total_duration, eval_count: json.eval_count });
                            }
                        } catch (e) {}
                    }
                    if (mainWindow) mainWindow.webContents.send('ollama-chat-end', { requestId });
                });

                global['req_' + requestId] = req;
                resolve({ success: true });
            });

            req.on('error', (err) => {
                if (mainWindow) mainWindow.webContents.send('ollama-chat-error', { requestId, error: err.message });
                resolve({ success: false });
            });

            global['req_' + requestId] = req;
            req.write(body);
            req.end();
        });
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('ollama-chat-abort', async (event, requestId) => {
    const req = global['req_' + requestId];
    if (req) {
        req.destroy();
        delete global['req_' + requestId];
        return { success: true };
    }
    return { success: false };
});

ipcMain.handle('open-file-dialog', async (event, opts) => {
    try {
        const filters = [];
        if (opts && opts.type === 'image') {
            filters.push({ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] });
        } else {
            filters.push({ name: 'All Files', extensions: ['*'] });
        }

        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openFile'],
            filters: filters
        });

        if (result.canceled || !result.filePaths.length) return { canceled: true };

        const fp = result.filePaths[0];
        const name = path.basename(fp);
        const ext = path.extname(fp).toLowerCase();
        const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext);
        const data = fs.readFileSync(fp);
        const base64 = data.toString('base64');
        const mime = isImage ? 'image/' + (ext === '.jpg' ? 'jpeg' : ext.slice(1)) : 'application/octet-stream';

        return {
            canceled: false,
            name: name,
            ext: ext,
            isImage: isImage,
            base64: base64,
            mime: mime,
            size: data.length,
            path: fp
        };
    } catch (e) {
        return { canceled: true, error: e.message };
    }
});