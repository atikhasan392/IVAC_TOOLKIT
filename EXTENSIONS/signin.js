(() => {
    'use strict';

    let filled = false;
    let submitted = false;

    function setNativeValue(element, value) {
        const setter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value'
        )?.set;

        if (setter) {
            setter.call(element, value);
        } else {
            element.value = value;
        }

        element.dispatchEvent(new Event('input', {
            bubbles: true
        }));

        element.dispatchEvent(new Event('change', {
            bubbles: true
        }));

        element.dispatchEvent(new Event('blur', {
            bubbles: true
        }));
    }

    function getSubmitButton(form) {
        return (
            form.querySelector('button[type="submit"]') ||
            form.querySelector('input[type="submit"]') ||
            form.querySelector('button')
        );
    }

    async function getSettings() {
        try {
            const response = await chrome.runtime.sendMessage({
                type: 'IVAC_GET_SIGNIN_SETTINGS'
            });

            if (!response?.ok) {
                return null;
            }

            return response.settings || null;
        } catch (_error) {
            return null;
        }
    }

    async function fillAndSubmit(autoSubmit = true) {
        const phone = document.querySelector('input[name="phone"]');
        const password = document.querySelector('input[name="password"]');

        if (!phone || !password) {
            return false;
        }

        const data = await getSettings();

        if (!data?.phone || !data?.password) {
            return false;
        }

        if (!filled) {
            setNativeValue(phone, data.phone);
            setNativeValue(password, data.password);
            filled = true;
        }

        if (
            autoSubmit &&
            data.autoSubmit !== false &&
            !submitted
        ) {
            const form = phone.closest('form');

            if (form) {
                submitted = true;

                setTimeout(() => {
                    const submitButton = getSubmitButton(form);

                    if (submitButton) {
                        submitButton.click();
                    } else {
                        form.requestSubmit();
                    }
                }, 500);
            }
        }

        return true;
    }

    function startObserver() {
        fillAndSubmit();

        const observer = new MutationObserver(() => {
            if (!filled) {
                fillAndSubmit();
            }
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
    }

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message.action === 'fill') {
            filled = false;
            submitted = false;

            fillAndSubmit(false).then(result => {
                sendResponse({ success: result });
            });

            return true;
        }

        if (message.action === 'fillAndSubmit') {
            filled = false;
            submitted = false;

            fillAndSubmit(true).then(result => {
                sendResponse({ success: result });
            });

            return true;
        }
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startObserver);
    } else {
        startObserver();
    }
})();
