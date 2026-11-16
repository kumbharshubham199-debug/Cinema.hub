# CINEMA HUB — first working build

A small friends-and-family media library. It includes account registration, admin approval, login, a file-based media catalogue, range-based video streaming, and a request box.

## Important limits

- This is a **starter build**, not a finished public production service. Test locally first.
- The computer holding the media must be ON and connected while people stream from it. A public website URL alone does not keep a laptop-hosted media server online.
- Do not expose the server directly to the internet yet. First test locally; then configure HTTPS, a secure tunnel/reverse proxy, rate limiting and backups.
- Only add media you own or are authorised to distribute. Do not publicly share copyrighted shows without the required rights.
- The app stores account and request data in `data/store.json`. Back it up and never commit it to GitHub.

## Requirements

- Windows 10/11
- Node.js 20 or newer

## 1. First setup

1. Extract the ZIP.
2. Install Node.js LTS from https://nodejs.org/
3. Open the extracted `cinema-hub` folder.
4. Copy `config.example.json` to `config.json`.
5. Open `config.json` and set `mediaDirectory` to the folder containing your authorised media.
   - Example Windows path: `S:/CinemaMedia`
   - Keep media outside the GitHub repository.
6. Open Command Prompt in this folder.

## 2. Create the admin account

In Command Prompt, set these environment variables (use your own email and a strong password of at least 12 characters):

```bat
set ADMIN_EMAIL=you@example.com
set ADMIN_PASSWORD=Use-A-Long-Unique-Password
```

Then start the server:

```bat
npm start
```

Open http://localhost:3000 and sign in using that admin email/password.

**Keep the same environment variables when starting the server for the first time.** The admin account is created once in `data/store.json`; after that, the stored account remains.

## 3. Add media

Place authorised media files in the configured media folder. Supported video types: MP4, M4V, WebM, MOV, MKV. Supported image types: JPG, JPEG, PNG, WEBP, GIF.

Refresh the library page to rescan the folder. The scanner is read-only; it does not rename, move, download or delete media.

## 4. GitHub

Upload the source files to a **private GitHub repository**. Do not upload:
- `data/store.json`
- `config.json`
- media files
- passwords, tokens or private keys

The `.gitignore` excludes these by default. Confirm before every commit that no private data or media is staged.

## 5. Current endpoints

- `POST /api/register` — create account (awaits admin approval)
- `POST /api/login`, `POST /api/logout`, `GET /api/me`
- `GET /api/library` — approved users only
- `GET /api/media/:id` — approved users only; supports HTTP byte ranges
- `POST /api/requests`, `GET /api/requests`
- `GET /api/admin/users`, `POST /api/admin/users`
- `POST /api/admin/requests`

## Known limitations for this first build

- JSON file storage is suitable only for a small local test; it is not a robust multi-user production database.
- No password reset, email verification, invitation codes, CSRF protection, audit log or brute-force protection yet.
- Session cookies are configured for local HTTP testing. Before any public deployment, HTTPS and secure-cookie handling must be added and security-reviewed.
- The app currently displays files as a simple list; it does not infer seasons/episodes from filenames or generate artwork.
- MKV/MOV playback depends on the viewer's browser/device codec support.
- No remote hosting or laptop-off streaming is included.

## Troubleshooting

- `node is not recognized`: close and reopen Command Prompt after installing Node.js.
- Port already in use: change `port` in `config.json`.
- Empty library: check `mediaDirectory`, file extensions, and read permissions.
- Admin not created: confirm `ADMIN_EMAIL` and `ADMIN_PASSWORD` were set in the same Command Prompt before the first `npm start`.
