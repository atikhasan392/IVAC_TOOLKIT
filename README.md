# IVAC TOOLKIT

A Chrome/Chromium extension for streamlining repetitive tasks on the IVAC Bangladesh appointment website.

## Features

- Sign-in autofill
- Optional automatic sign-in submission
- Multiple PDF upload queue
- Drag-and-drop PDF ordering
- Persistent PDF storage
- Separate data for each browser profile
- Windows Native Messaging integration
- Windows DPAPI-protected credentials
- Encrypted local PDF storage
- DGEPAY payment number quick-copy
- Persistent data across browser and Windows restarts

## Profile Isolation

Each browser profile receives a unique Vault ID. Credentials and PDF files are stored separately for every profile, making the extension suitable for multiple GoLogin or Chromium browser profiles on the same Windows account.

## Installation

1. Download or clone the repository.
2. Keep the project in a permanent location, for example: `C:\Users\Core\IVAC_TOOLKIT`
3. Run `WINDOWS_HOST\install.bat`.
4. Open your Chromium-based browser's Extensions page.
5. Enable **Developer mode**.
6. Select **Load unpacked** and choose the `EXTENSIONS` folder.
7. Restart the browser.

For multiple GoLogin profiles, load the extension into each profile. Verify that every profile has a different **Profile Vault ID**.

## Data Storage

Profile data is stored locally under:

`%LOCALAPPDATA%\IVACToolkit\Vault\profiles\`

Credentials are protected using Windows DPAPI, while stored PDF data is encrypted locally.

No credentials or saved PDFs are intentionally stored on a remote server by the toolkit.

## Requirements

- Windows
- Chrome/Chromium-based browser
- PowerShell
- .NET Framework compiler support
- Access to `appointment.ivacbd.com`

## Disclaimer

This project is an independent utility and is not affiliated with, endorsed by, or officially connected to IVAC, the High Commission of India, or any government organization.

Use this software responsibly and at your own risk.

## Author

Developed by **ATik HaSan**

Website: `https://atikhasan.com`

## License

For personal and authorized use only.
