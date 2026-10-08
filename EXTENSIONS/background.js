'use strict';

const NATIVE_HOST = 'com.atikhasan.ivac_toolkit';
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

        const response = await chrome.runtime.sendNativeMessage(NATIVE_HOST, { action: 'allocateVaultId' });
        if (!response?.ok || !isVaultId(response.vaultId)) {
            throw new Error(response?.error || 'Could not allocate profile ID.');
        }
        const created = response.vaultId;
        await chrome.storage.local.set({ [VAULT_ID_KEY]: created });
        return created;
    })().catch(error => {
        vaultIdPromise = null;
        throw error;
    });

    return vaultIdPromise;
}

async function sendNative(message) {
    const vaultId = await getVaultId();
    const response = await chrome.runtime.sendNativeMessage(
        NATIVE_HOST,
        {
            ...message,
            vaultId
        }
    );

    if (!response?.ok) {
        throw new Error(
            response?.error ||
            'Windows vault returned an error.'
        );
    }

    return response;
}

chrome.runtime.onInstalled.addListener(() => {
    getVaultId().catch(() => {});
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes[VAULT_ID_KEY]) {
        vaultIdPromise = null;
    }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'IVAC_GET_SIGNIN_SETTINGS') {
        return;
    }

    sendNative({ action: 'getSettings' })
        .then(response => {
            sendResponse({
                ok: true,
                settings: response.settings || null
            });
        })
        .catch(error => {
            sendResponse({
                ok: false,
                error: error.message || 'Windows vault is unavailable.'
            });
        });

    return true;
});
