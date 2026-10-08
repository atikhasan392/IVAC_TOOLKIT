(() => {
    'use strict';

    if (window.__MPU_V2__) return;
    window.__MPU_V2__ = true;

    const PDF_SELECTOR = 'input[type="file"]';
    const MARKER = 'data-mpu-enhanced';
    const chunks = new Map();

    const isPdfInput = input => {
        const accept = (input.getAttribute('accept') || '').toLowerCase();
        return accept.includes('pdf') || accept.includes('application/pdf');
    };

    const findInput = () => [...document.querySelectorAll(PDF_SELECTOR)].find(isPdfInput) || null;

    function setSingleFile(input, file) {
        const transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
        input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    }

    function enhance(input) {
        if (!isPdfInput(input) || input.dataset.mpuEnhanced) return;
        input.dataset.mpuEnhanced = '1';

        const wrapper = document.createElement('div');
        wrapper.className = 'mpu-wrapper';
        wrapper.dataset.mpuUi = '1';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'mpu-button';
        button.textContent = 'Select PDFs';

        const status = document.createElement('span');
        status.className = 'mpu-status';
        status.textContent = 'Ready';

        const picker = document.createElement('input');
        picker.type = 'file';
        picker.accept = '.pdf,application/pdf';
        picker.multiple = true;
        picker.className = 'mpu-picker';

        button.addEventListener('click', () => picker.click());
        picker.addEventListener('change', async () => {
            const files = [...picker.files].filter(file => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
            button.disabled = true;
            try {
                for (let i = 0; i < files.length; i++) {
                    status.textContent = `${i + 1}/${files.length}: ${files[i].name}`;
                    setSingleFile(input, files[i]);
                    if (i + 1 < files.length) await new Promise(resolve => setTimeout(resolve, 1200));
                }
                status.textContent = files.length ? `Done: ${files.length}` : 'No PDFs selected';
            } finally {
                button.disabled = false;
                picker.value = '';
            }
        });

        wrapper.append(button, status, picker);
        input.insertAdjacentElement('afterend', wrapper);
    }

    function scan(root = document) {
        if (root instanceof HTMLInputElement) enhance(root);
        if (root.querySelectorAll) root.querySelectorAll(PDF_SELECTOR).forEach(enhance);
    }

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (!message?.type?.startsWith('MPU_')) return;

        try {
            if (message.type === 'MPU_PING') {
                sendResponse({ ok: Boolean(findInput()) });
                return;
            }

            if (message.type === 'MPU_FILE_START') {
                chunks.set(message.id, { meta: message.meta, parts: [], bytes: 0 });
                sendResponse({ ok: true });
                return;
            }

            if (message.type === 'MPU_FILE_CHUNK') {
                const entry = chunks.get(message.id);
                if (!entry) throw new Error('Upload buffer was not initialized.');
                const binary = atob(message.data);
                const part = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) part[i] = binary.charCodeAt(i);
                entry.parts.push(part);
                entry.bytes += part.byteLength;
                sendResponse({ ok: true });
                return;
            }

            if (message.type === 'MPU_FILE_COMMIT') {
                const entry = chunks.get(message.id);
                if (!entry) throw new Error('Upload buffer was lost.');
                const input = findInput();
                if (!input) throw new Error('No PDF file input found on this page.');

                const blob = new Blob(entry.parts, { type: entry.meta.type || 'application/pdf' });
                const file = new File([blob], entry.meta.name, {
                    type: entry.meta.type || 'application/pdf',
                    lastModified: entry.meta.lastModified || Date.now()
                });
                setSingleFile(input, file);
                chunks.delete(message.id);
                sendResponse({ ok: true });
                return;
            }

            if (message.type === 'MPU_FILE_ABORT') {
                chunks.delete(message.id);
                sendResponse({ ok: true });
            }
        } catch (error) {
            if (message.id) chunks.delete(message.id);
            sendResponse({ ok: false, error: error.message });
        }
    });

    scan();

    let queued = false;
    const observer = new MutationObserver(records => {
        if (queued) return;
        if (!records.some(record => record.addedNodes.length)) return;
        queued = true;
        requestAnimationFrame(() => {
            queued = false;
            for (const record of records) {
                for (const node of record.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) scan(node);
                }
            }
        });
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
})();
