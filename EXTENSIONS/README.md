# IVAC TOOLKIT 6.1.0

This build stores sign-in credentials and queued PDF files in a separate encrypted Windows vault for each browser profile.

## Main behavior

- One extension installation source can be loaded into many GoLogin browser profiles.
- Each browser profile receives its own persistent numeric vault ID in `chrome.storage.local`.
- Every Native Messaging request includes that vault ID.
- The Windows host routes data to a dedicated profile vault.
- Closing the popup, browser, GoLogin, or Windows does not delete saved data.
- Removing the native host does not delete vault data.
- PDF files and credentials remain until you explicitly remove them or delete the corresponding vault.

## Vault layout

```text
%LOCALAPPDATA%\IVACToolkit\Vault\
    profiles\
        <profile-vault-id>\
            state.dat
            master-key.dat
            files\
                <file-uuid>\
                    00000000.bin
                    00000001.bin
                    ...
```

Any old legacy files directly under `%LOCALAPPDATA%\IVACToolkit\Vault` are left untouched by this version.

## Install or update

1. Keep this project at `C:\Users\Core\IVAC TOOLKIT` if that is your preferred location.
2. Open `windows-host`.
3. Run `install.bat`.
4. In every GoLogin browser profile, open the extensions page.
5. Reload the unpacked `IVAC TOOLKIT` extension or load this folder again.
6. Close and reopen all GoLogin browser windows after installing the native host.
7. Open the extension popup once in each profile and confirm that each browser shows a different `PROFILE VAULT` ID.

The extension ID remains fixed as:

```text
ppkhmbhihbhbkcgghgmkldadliemhfdl
```

The manifest public key is intentionally retained so the extension ID does not change.

## Profile Vault controls

The popup shows the active profile vault ID.

- `COPY ID` copies the ID. Keep it if you want a recovery reference.
- `USE ID` reconnects the current browser profile to an existing vault ID.
- `NEW ID` creates a new empty vault link for the current browser profile. It does not delete the previous vault from disk.

If a GoLogin clone ever copies another profile's extension local storage and therefore has the same ID, use `NEW ID` in the cloned browser. After that, the clone uses an independent vault.

## Credential storage

`state.dat` is protected with Windows DPAPI using `CurrentUser` scope. It contains the phone number, password, Auto Submit setting, and PDF metadata.

## PDF storage

Each browser profile has its own `master-key.dat`. The master key is protected with Windows DPAPI. PDF chunks are encrypted with AES-256-CBC and authenticated with HMAC-SHA256 before being written to disk.

## Useful Windows Host tools

- `install.bat` - compile and register the native host.
- `test-host.bat` - verify that the compiled host responds over the Native Messaging protocol.
- `show-vaults.bat` - list saved profile vault IDs.
- `delete-profile-vault.bat` - permanently delete one profile vault after explicit confirmation.
- `delete-all-vault-data.bat` - permanently delete all IVAC TOOLKIT vault data after explicit confirmation.
- `uninstall-host.bat` - remove the native host registration and executable while keeping all encrypted vault data.

## Updating existing GoLogin profiles

Existing GoLogin profiles running version 5 do not yet have `ivacProfileVaultId` in extension local storage. After version 6 is loaded, each existing browser profile allocates a new numeric ID independently when the service worker, sign-in page, or popup first accesses the vault.

Do not use `NEW ID` repeatedly unless you intentionally want to switch the browser to a new empty vault. Old vault folders are retained until explicitly deleted.

## Important limitation

A browser profile can only locate its existing encrypted vault automatically while its extension local storage still contains the corresponding vault ID. If browser profile data is deleted, use a previously copied ID with `USE ID` to reconnect to the old vault.

## Sequential profile IDs and recovery

New profile IDs are allocated atomically by the Windows native host as `1`, `2`, `3`, and so on. The persistent counter is `%LOCALAPPDATA%\IVACToolkit\Vault\next-profile-id.txt`; back it up with the Vault folder. Deleted numeric IDs are not reassigned while this counter remains intact. Existing legacy UUID vault folders are retained and can still be recovered via `USE ID`. To recover, type the exact saved ID; the host checks that its folder exists before changing the active profile. A cloned browser profile that copied local extension storage may inherit an ID: use `NEW ID` on that clone before saving anything.
