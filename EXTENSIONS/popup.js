'use strict';

const NATIVE_HOST = 'com.atikhasan.ivac_toolkit';
const CHUNK_SIZE = 512 * 1024;
const SEND_DELAY = 1200;
const $ = id => document.getElementById(id);
const VAULT_ID_KEY = 'ivacProfileVaultId';

let vaultIdPromise = null;

function isUuid(value) {
    return typeof value === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isVaultId(value) {
    return (typeof value === 'string' && /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value))) || isUuid(value);
}

function getVaultId() {
    if (vaultIdPromise) return vaultIdPromise;

    vaultIdPromise = (async () => {
        const stored = await chrome.storage.local.get(VAULT_ID_KEY);
        const existing = stored?.[VAULT_ID_KEY];

        if (isVaultId(existing)) {
            return existing.toLowerCase();
        }

        const { vaultId: created } = await nativeCall({ action: 'allocateVaultId' }, true);
        await chrome.storage.local.set({ [VAULT_ID_KEY]: created });
        return created;
    })().catch(error => {
        vaultIdPromise = null;
        throw error;
    });

    return vaultIdPromise;
}

async function setVaultId(vaultId) {
    if (!isVaultId(vaultId)) {
        throw new Error('Enter a valid numeric vault ID or legacy UUID.');
    }

    const normalized = vaultId.toLowerCase();
    const result = await nativeCall({ action: 'vaultExists', lookupVaultId: normalized }, true);
    if (!result.exists) throw new Error('Vault does not exist on this Windows account.');
    await chrome.storage.local.set({ [VAULT_ID_KEY]: normalized });
    vaultIdPromise = Promise.resolve(normalized);
    return normalized;
}

async function replaceVaultId() {
    const result = await nativeCall({ action: 'allocateVaultId' }, true);
    await chrome.storage.local.set({ [VAULT_ID_KEY]: result.vaultId });
    vaultIdPromise = Promise.resolve(result.vaultId);
    return result.vaultId;
}

let nativePort = null;
let nativeRequestId = 0;
const nativePending = new Map();

function friendlyNativeError(raw) {
    if (/native messaging host|host.*not found|forbidden/i.test(raw)) {
        return new Error(
            'Windows vault is not installed. Run windows-host\\install.bat first.'
        );
    }

    return new Error(raw || 'Windows vault connection failed.');
}

function ensureNativePort() {
    if (nativePort) return nativePort;

    const port = chrome.runtime.connectNative(NATIVE_HOST);
    nativePort = port;

    port.onMessage.addListener(response => {
        const requestId = response?.requestId;
        const pending = nativePending.get(requestId);

        if (!pending) return;
        nativePending.delete(requestId);
        clearTimeout(pending.timer);

        if (!response?.ok) {
            pending.reject(
                new Error(
                    response?.error ||
                    'Windows vault returned an error.'
                )
            );
            return;
        }

        pending.resolve(response);
    });

    port.onDisconnect.addListener(() => {
        const raw = chrome.runtime.lastError?.message ||
            'Windows vault connection closed.';
        const error = friendlyNativeError(raw);

        nativePort = null;

        for (const pending of nativePending.values()) {
            clearTimeout(pending.timer);
            pending.reject(error);
        }

        nativePending.clear();
    });

    return port;
}

async function nativeCall(message, skipVaultId = false) {
    const vaultId = skipVaultId ? undefined : await getVaultId();

    return new Promise((resolve, reject) => {
        const port = ensureNativePort();
        const requestId = `p${Date.now()}-${++nativeRequestId}`;

        const timer = setTimeout(() => {
            nativePending.delete(requestId);
            reject(new Error('Windows vault request timed out.'));
        }, 30000);

        nativePending.set(requestId, {
            resolve,
            reject,
            timer
        });

        try {
            port.postMessage({
                ...message,
                vaultId,
                requestId
            });
        } catch (error) {
            clearTimeout(timer);
            nativePending.delete(requestId);
            reject(friendlyNativeError(error?.message || String(error)));
        }
    });
}

function bytesToBase64(bytes) {
    let binary = '';
    const step = 0x8000;

    for (let i = 0; i < bytes.length; i += step) {
        binary += String.fromCharCode(
            ...bytes.subarray(i, i + step)
        );
    }

    return btoa(binary);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Profile vault identity
const vaultProfile = {
    id: $('vaultProfileId'),
    copy: $('copyVaultId'),
    use: $('useVaultId'),
    create: $('newVaultId')
};

async function renderVaultProfileId() {
    const vaultId = await getVaultId();

    if (vaultProfile.id) {
        vaultProfile.id.textContent = vaultId;
        vaultProfile.id.title = vaultId;
    }

    return vaultId;
}

if (vaultProfile.copy) {
    vaultProfile.copy.addEventListener('click', async () => {
        const vaultId = await renderVaultProfileId();
        await navigator.clipboard.writeText(vaultId);

        const original = vaultProfile.copy.textContent;
        vaultProfile.copy.textContent = 'COPIED';
        setTimeout(() => {
            vaultProfile.copy.textContent = original;
        }, 1500);
    });
}

if (vaultProfile.use) {
    vaultProfile.use.addEventListener('click', async () => {
        const current = await getVaultId();
        const requested = window.prompt(
            'Enter an existing profile vault ID to reconnect this browser:',
            current
        );

        if (requested === null || requested.trim() === current) return;

        try {
            await setVaultId(requested.trim());
            window.location.reload();
        } catch (error) {
            window.alert(error.message || 'Invalid vault ID.');
        }
    });
}

if (vaultProfile.create) {
    vaultProfile.create.addEventListener('click', async () => {
        const confirmed = window.confirm(
            'Create a new empty vault for this browser profile? The current vault will remain on disk and will not be deleted.'
        );

        if (!confirmed) return;

        await replaceVaultId();

        if (nativePort) {
            try {
                nativePort.disconnect();
            } catch (_error) {
            }

            nativePort = null;
        }

        window.location.reload();
    });
}

// Tabs
const tabs = [...document.querySelectorAll('.tab')];
const panels = {
    signin: $('signinPanel'),
    pdf: $('pdfPanel'),
    dgePay: $('dgePay')
};

tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        tabs.forEach(item => {
            item.classList.toggle('active', item === tab);
        });

        Object.entries(panels).forEach(([key, panel]) => {
            if (!panel) return;
            panel.classList.toggle('active', key === tab.dataset.tab);
        });
    });
});

// Sign-in autofill
const signin = {
    phone: $('phone'),
    password: $('password'),
    autoSubmit: $('autoSubmit'),
    save: $('save'),
    fill: $('fill'),
    fillSubmit: $('fillSubmit'),
    status: $('signinStatus')
};

function setSigninStatus(message, type = '') {
    signin.status.textContent = message;
    signin.status.className = `status${type ? ` ${type}` : ''}`;

    clearTimeout(setSigninStatus.timer);

    setSigninStatus.timer = setTimeout(() => {
        signin.status.textContent = '';
        signin.status.className = 'status';
    }, 3500);
}

async function saveSignin(forceAutoSubmit = null) {
    const autoSubmit = forceAutoSubmit === null
        ? signin.autoSubmit.checked
        : forceAutoSubmit;

    return nativeCall({
        action: 'saveSettings',
        phone: signin.phone.value.trim(),
        password: signin.password.value,
        autoSubmit
    });
}

async function activeTab() {
    const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true
    });

    return tab;
}

async function sendSignin(action) {
    const tab = await activeTab();

    if (
        !tab?.id ||
        !/^https:\/\/appointment\.ivacbd\.com\/signin(?:[/?#]|$)/i.test(
            tab.url || ''
        )
    ) {
        setSigninStatus(
            'Open the IVAC sign-in page first.',
            'error'
        );
        return;
    }

    try {
        const response = await chrome.tabs.sendMessage(
            tab.id,
            { action }
        );

        if (!response?.success) {
            throw new Error('Sign-in fields were not found.');
        }

        setSigninStatus(
            action === 'fill'
                ? 'Fields filled from Windows vault.'
                : 'Submitted normally.',
            'success'
        );
    } catch (error) {
        setSigninStatus(
            error.message || 'Could not reach the sign-in page.',
            'error'
        );
    }
}

signin.save.addEventListener('click', async () => {
    try {
        await saveSignin();
        setSigninStatus('Saved to Windows vault.', 'success');
    } catch (error) {
        setSigninStatus(error.message, 'error');
    }
});

signin.fill.addEventListener('click', async () => {
    try {
        await saveSignin();
        await sendSignin('fill');
    } catch (error) {
        setSigninStatus(error.message, 'error');
    }
});

signin.fillSubmit.addEventListener('click', async () => {
    try {
        signin.autoSubmit.checked = true;
        await saveSignin(true);
        await sendSignin('fillAndSubmit');
    } catch (error) {
        setSigninStatus(error.message, 'error');
    }
});

// DGEPAY copy to clipboard
const dgePayPanel = $('dgePay');

function setDgePayStatus(message, type = '') {
    if (!dgePayPanel) return;

    const status = dgePayPanel.querySelector('#dgePayStatus');
    if (!status) return;

    status.textContent = message;
    status.className = `status${type ? ` ${type}` : ''}`;

    clearTimeout(setDgePayStatus.timer);

    setDgePayStatus.timer = setTimeout(() => {
        status.textContent = '';
        status.className = 'status';
    }, 2000);
}

async function copyDgePayNumber(row) {
    const number = row.dataset.copyNumber;
    if (!number) return;

    try {
        await navigator.clipboard.writeText(number);

        const rows = dgePayPanel.querySelectorAll('[data-copy-number]');

        rows.forEach(item => {
            item.classList.remove('copied');
            const copyStatus = item.querySelector('.copy-status');
            if (copyStatus) copyStatus.textContent = 'COPY';
        });

        row.classList.add('copied');
        const copyStatus = row.querySelector('.copy-status');
        if (copyStatus) copyStatus.textContent = 'COPIED';

        setDgePayStatus(`${number} copied to clipboard.`, 'success');

        setTimeout(() => {
            row.classList.remove('copied');
            if (copyStatus) copyStatus.textContent = 'COPY';
        }, 2000);
    } catch (error) {
        console.error(error);
        setDgePayStatus('Could not copy the number.', 'error');
    }
}

if (dgePayPanel) {
    dgePayPanel
        .querySelectorAll('[data-copy-number]')
        .forEach(row => {
            row.addEventListener('click', () => copyDgePayNumber(row));
        });
}

// PDF queue backed by Windows native vault
const pdf = {
    files: $('files'),
    dropzone: $('dropzone'),
    fileCount: $('fileCount'),
    clear: $('clear'),
    fileList: $('fileList'),
    orderHint: $('orderHint'),
    upload: $('upload'),
    status: $('pdfStatus')
};

let queue = [];
let draggingId = null;

const formatBytes = bytes => {
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(0)} KB`;
    }

    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

function setPdfStatus(message, type = '') {
    pdf.status.textContent = message;
    pdf.status.className = `status${type ? ` ${type}` : ''}`;
}

function renderQueue() {
    const total = queue.reduce((sum, item) => sum + item.size, 0);

    pdf.fileCount.textContent = queue.length
        ? `${queue.length} FILE${queue.length === 1 ? '' : 'S'} · ${formatBytes(total)}`
        : 'NO SAVED FILES';

    pdf.clear.hidden = !queue.length;
    pdf.fileList.hidden = !queue.length;
    pdf.orderHint.hidden = queue.length < 2;
    pdf.upload.disabled = !queue.length;
    pdf.fileList.replaceChildren();

    queue.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'file-row';
        row.draggable = true;
        row.dataset.id = item.id;

        const number = document.createElement('span');
        number.className = 'order-number';
        number.textContent = index + 1;

        const info = document.createElement('div');
        info.className = 'file-info';

        const name = document.createElement('span');
        name.className = 'file-name';
        name.textContent = item.name;
        name.title = item.name;

        const size = document.createElement('span');
        size.className = 'file-size';
        size.textContent = formatBytes(item.size);

        info.append(name, size);

        const controls = document.createElement('div');
        controls.className = 'row-controls';

        [
            ['↑', -1],
            ['↓', 1]
        ].forEach(([label, delta]) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = label;
            button.disabled = delta < 0
                ? index === 0
                : index === queue.length - 1;

            button.addEventListener('click', () => {
                move(index, index + delta);
            });

            controls.append(button);
        });

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'remove';
        remove.textContent = '×';

        remove.addEventListener('click', async () => {
            try {
                await nativeCall({
                    action: 'deleteFile',
                    id: item.id
                });

                queue.splice(index, 1);
                renderQueue();
                setPdfStatus('File removed from Windows vault.', 'success');
            } catch (error) {
                setPdfStatus(error.message, 'error');
            }
        });

        controls.append(remove);

        row.addEventListener('dragstart', () => {
            draggingId = item.id;
            row.classList.add('dragging');
        });

        row.addEventListener('dragend', () => {
            draggingId = null;
            row.classList.remove('dragging');
        });

        row.addEventListener('dragover', event => {
            event.preventDefault();
        });

        row.addEventListener('drop', async event => {
            event.preventDefault();

            const from = queue.findIndex(file => file.id === draggingId);
            const to = queue.findIndex(file => file.id === item.id);

            if (from >= 0 && to >= 0 && from !== to) {
                await move(from, to);
            }
        });

        row.append(number, info, controls);
        pdf.fileList.append(row);
    });
}

async function move(from, to) {
    const original = [...queue];
    const [item] = queue.splice(from, 1);
    queue.splice(to, 0, item);
    renderQueue();

    try {
        await nativeCall({
            action: 'reorderFiles',
            ids: queue.map(file => file.id)
        });
    } catch (error) {
        queue = original;
        renderQueue();
        setPdfStatus(error.message, 'error');
    }
}

async function saveFileToVault(file) {
    const id = crypto.randomUUID();
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

    await nativeCall({
        action: 'beginFile',
        id,
        name: file.name,
        type: file.type || 'application/pdf',
        size: file.size,
        lastModified: file.lastModified
    });

    try {
        for (let index = 0; index < totalChunks; index++) {
            const start = index * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, file.size);
            const buffer = await file.slice(start, end).arrayBuffer();

            await nativeCall({
                action: 'putFileChunk',
                id,
                index,
                data: bytesToBase64(new Uint8Array(buffer))
            });

            const percent = Math.round(((index + 1) / totalChunks) * 100);
            setPdfStatus(`Saving ${percent}% · ${file.name}`);
        }

        const response = await nativeCall({
            action: 'commitFile',
            id
        });

        return response.file;
    } catch (error) {
        await nativeCall({
            action: 'cancelFile',
            id
        }).catch(() => {});

        throw error;
    }
}

async function addFiles(files) {
    const pdfs = [...files].filter(file =>
        file.type === 'application/pdf' ||
        file.name.toLowerCase().endsWith('.pdf')
    );

    if (!pdfs.length) {
        setPdfStatus('Please select PDF files.', 'error');
        return;
    }

    try {
        for (const file of pdfs) {
            const saved = await saveFileToVault(file);
            queue.push(saved);
            renderQueue();
        }

        setPdfStatus(
            `${pdfs.length} file(s) saved to Windows vault.`,
            'success'
        );
    } catch (error) {
        setPdfStatus(error.message || 'Could not save PDF.', 'error');
    }
}

function send(tabId, message) {
    return chrome.tabs.sendMessage(tabId, message);
}

async function sendFile(tabId, item, position, total) {
    const transferId = crypto.randomUUID();

    await send(tabId, {
        type: 'MPU_FILE_START',
        id: transferId,
        meta: {
            name: item.name,
            type: item.type,
            size: item.size,
            lastModified: item.lastModified
        }
    });

    try {
        for (let index = 0; index < item.chunks; index++) {
            const vaultChunk = await nativeCall({
                action: 'readFileChunk',
                id: item.id,
                index
            });

            const response = await send(tabId, {
                type: 'MPU_FILE_CHUNK',
                id: transferId,
                data: vaultChunk.data
            });

            if (!response?.ok) {
                throw new Error(
                    response?.error || 'Chunk transfer failed.'
                );
            }

            const percent = item.chunks
                ? Math.round(((index + 1) / item.chunks) * 100)
                : 100;

            setPdfStatus(
                `${position}/${total} · ${percent}% · ${item.name}`
            );
        }

        const response = await send(tabId, {
            type: 'MPU_FILE_COMMIT',
            id: transferId
        });

        if (!response?.ok) {
            throw new Error(
                response?.error || 'File commit failed.'
            );
        }
    } catch (error) {
        await send(tabId, {
            type: 'MPU_FILE_ABORT',
            id: transferId
        }).catch(() => {});

        throw error;
    }
}

// PDF events
pdf.files.addEventListener('change', async () => {
    await addFiles(pdf.files.files);
    pdf.files.value = '';
});

['dragenter', 'dragover'].forEach(type => {
    pdf.dropzone.addEventListener(type, event => {
        event.preventDefault();
        pdf.dropzone.classList.add('dragging');
    });
});

['dragleave', 'drop'].forEach(type => {
    pdf.dropzone.addEventListener(type, event => {
        event.preventDefault();
        pdf.dropzone.classList.remove('dragging');
    });
});

pdf.dropzone.addEventListener('drop', event => {
    addFiles(event.dataTransfer.files);
});

pdf.clear.addEventListener('click', async () => {
    try {
        await nativeCall({ action: 'clearFiles' });
        queue = [];
        renderQueue();
        setPdfStatus('Windows vault queue cleared.', 'success');
    } catch (error) {
        setPdfStatus(error.message, 'error');
    }
});

pdf.upload.addEventListener('click', async () => {
    pdf.upload.disabled = true;

    try {
        const tab = await activeTab();

        if (
            !tab?.id ||
            !/^https:\/\/appointment\.ivacbd\.com\//i.test(tab.url || '')
        ) {
            throw new Error('Open an IVAC page first.');
        }

        const ping = await send(tab.id, { type: 'MPU_PING' });

        if (!ping?.ok) {
            throw new Error('No PDF file input found on this page.');
        }

        for (let i = 0; i < queue.length; i++) {
            await sendFile(tab.id, queue[i], i + 1, queue.length);

            if (i + 1 < queue.length) {
                await sleep(SEND_DELAY);
            }
        }

        setPdfStatus(
            `Finished ${queue.length} file(s).`,
            'success'
        );
    } catch (error) {
        setPdfStatus(
            error.message || 'Upload failed.',
            'error'
        );
    } finally {
        pdf.upload.disabled = !queue.length;
    }
});

// Initial load
(async () => {
    try {
        await renderVaultProfileId();
        const response = await nativeCall({ action: 'getState' });
        const settings = response.settings || {};

        signin.phone.value = settings.phone || '';
        signin.password.value = settings.password || '';
        signin.autoSubmit.checked = settings.autoSubmit !== false;

        queue = Array.isArray(response.files)
            ? response.files
            : [];

        renderQueue();
        setPdfStatus(
            queue.length
                ? 'Windows vault queue restored.'
                : 'Windows vault connected.',
            'success'
        );
    } catch (error) {
        console.error(error);
        renderQueue();
        setSigninStatus(error.message, 'error');
        setPdfStatus(error.message, 'error');
    }
})();
