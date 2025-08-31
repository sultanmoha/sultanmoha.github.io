(() => {
    'use strict';

    // ====== CONFIG ======
    const OAUTH_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
    const CLIENT_ID = '4853441079-chf1qiv8a06pfjk6a2c1b6eq4uosi765.apps.googleusercontent.com'; // ← put your OAuth 2.0 Web client ID here
    // Storage keys (never uploaded in snapshots)
    const TOKEN_KEY = 'gdsync.token';        // access token + expiry
    const DEVICE_KEY = 'gdsync.deviceId';
    const FIRSTLOAD = 'gdsync.toastShown';
    const PASS_HINT = 'gdsync.passphrase.hint'; // not used for encryption; optional UX hint only

    // ====== STATE ======
    let accessToken = null;
    let tokenExpireAt = 0;
    let tokenClient = null;
    let backoffMs = 0;
    let pendingUpload = false;
    let isSyncing = false;

    const $ = (id) => document.getElementById(id);
    const btn = $('cloudSyncBtn');
    const menu = $('cloudSyncMenu');
    const chip = $('cloudStatusChip');
    const passEl = $('cloudPassphrase');

    // ====== UTIL ======
    const now = () => Date.now();
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const fmtDate = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\..+/, '').slice(0, 15); // 20250130T112233
    const deviceId = (() => {
        let d = localStorage.getItem(DEVICE_KEY);
        if (!d) { d = crypto.randomUUID(); localStorage.setItem(DEVICE_KEY, d); }
        return d;
    })();

    function setChip(state, text) {
        if (!chip) return;
        chip.classList.remove('cloud-chip-muted', 'cloud-chip-sync', 'cloud-chip-ok', 'cloud-chip-off', 'cloud-chip-err');
        chip.textContent = text;
        chip.classList.add({
            muted: 'cloud-chip-muted', sync: 'cloud-chip-sync', ok: 'cloud-chip-ok',
            off: 'cloud-chip-off', err: 'cloud-chip-err'
        }[state] || 'cloud-chip-muted');
    }

    function showMenu(show) {
        if (!menu || !btn) return;
        if (show) {
            menu.classList.remove('hidden');
            btn.setAttribute('aria-expanded', 'true');
            // focus first item
            const first = menu.querySelector('[role="menuitem"]');
            if (first) first.focus();
        } else {
            menu.classList.add('hidden');
            btn.setAttribute('aria-expanded', 'false');
        }
    }

    function safeJSON(obj) {
        return JSON.stringify(obj, null, 2);
    }

    // ---- Crypto helpers (AES-GCM with PBKDF2) ----
    const enc = new TextEncoder();
    const dec = new TextDecoder();

    async function deriveKey(passphrase, salt) {
        const baseKey = await crypto.subtle.importKey(
            'raw', enc.encode(passphrase), { name: 'PBKDF2' }, false, ['deriveKey']
        );
        return crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
            baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
        );
    }
    function b64(bytes) { return btoa(String.fromCharCode(...new Uint8Array(bytes))); }
    function b64d(str) {
        const bin = atob(str); const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes.buffer;
    }

    async function maybeEncrypt(json, passphrase) {
        if (!passphrase) return { mime: 'application/json', body: enc.encode(json) };
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const key = await deriveKey(passphrase, salt);
        const data = enc.encode(json);
        const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
        const envelope = JSON.stringify({
            v: 1, enc: 'aes-gcm', salt: b64(salt), iv: b64(iv), data: b64(ct)
        });
        return { mime: 'application/json', body: enc.encode(envelope) };
    }

    async function maybeDecrypt(bytes, passphrase) {
        if (!passphrase) return dec.decode(bytes);
        const envelope = JSON.parse(dec.decode(bytes));
        if (!envelope || envelope.enc !== 'aes-gcm') throw new Error('Unsupported encryption');
        const salt = new Uint8Array(new Uint8Array(b64d(envelope.salt)));
        const iv = new Uint8Array(new Uint8Array(b64d(envelope.iv)));
        const key = await deriveKey(passphrase, salt);
        const ct = b64d(envelope.data);
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
        return dec.decode(pt);
    }

    // ---- Load Google libraries lazily ----
    async function loadGIS() {
        if (window.google && google.accounts && google.accounts.oauth2) return;
        await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://accounts.google.com/gsi/client';
            s.async = true; s.defer = true; s.onload = res; s.onerror = () => rej(new Error('GIS load failed'));
            document.head.appendChild(s);
        });
    }

    async function ensureToken(interactive = false) {
        if (navigator.onLine === false) {
            setChip('off', 'Offline');
            pendingUpload = true;
            throw new Error('Offline');
        }
        // reuse if not expired (5 min skew)
        if (accessToken && tokenExpireAt - now() > 5 * 60 * 1000) return accessToken;

        await loadGIS();
        if (!tokenClient) {
            tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: CLIENT_ID,
                scope: OAUTH_SCOPE,
                prompt: interactive ? 'consent' : '',
                callback: (resp) => { }
            });
        }
        const token = await new Promise((resolve, reject) => {
            tokenClient.callback = (resp) => {
                if (resp.error) reject(new Error(resp.error));
                else resolve(resp);
            };
            try {
                tokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '' });
            } catch (e) { reject(e); }
        });

        accessToken = token.access_token;
        tokenExpireAt = now() + (token.expires_in ? (token.expires_in * 1000) : (3600 * 1000));
        try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ accessToken, tokenExpireAt })); } catch { }
        return accessToken;
    }

    function revokeToken() {
        const tok = accessToken || (JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null')?.accessToken);
        if (tok && window.google?.accounts?.oauth2?.revoke) {
            google.accounts.oauth2.revoke(tok, () => { });
        }
        accessToken = null; tokenExpireAt = 0;
        try { sessionStorage.removeItem(TOKEN_KEY); } catch { }
    }

    // ---- Drive helpers (REST via fetch) ----
    async function driveFetch(path, opts = {}) {
        const tok = await ensureToken(false).catch(() => null);
        if (!tok) throw new Error('Not signed in');
        const res = await fetch(`https://www.googleapis.com${path}`, {
            ...opts,
            headers: {
                'Authorization': `Bearer ${tok}`,
                ...(opts.headers || {})
            }
        });
        if (!res.ok) {
            const txt = await res.text().catch(() => '');
            throw new Error(`Drive API ${res.status}: ${txt || res.statusText}`);
        }
        return res;
    }

    async function listAppDataFiles(q, pageSize = 100) {
        const params = new URLSearchParams({
            spaces: 'appDataFolder',
            fields: 'files(id,name,modifiedTime,createdTime,size)',
            pageSize: String(pageSize),
            q
        });
        const res = await driveFetch(`/drive/v3/files?${params.toString()}`, { method: 'GET' });
        return res.json();
    }

    async function getFileByName(name) {
        const { files } = await listAppDataFiles(`name='${name.replace(/'/g, "\\'")}'`);
        return files?.[0] || null;
    }

    async function downloadFile(fileId) {
        const res = await driveFetch(`/drive/v3/files/${fileId}?alt=media`, { method: 'GET' });
        const buf = await res.arrayBuffer();
        return new Uint8Array(buf);
    }

    function multipartBody(metadata, bytes, mime) {
        const boundary = 'gdsync_' + Math.random().toString(16).slice(2);
        const pre = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`;
        const mid = `--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`;
        const post = `\r\n--${boundary}--`;
        const metaBytes = enc.encode(pre);
        const midBytes = enc.encode(mid);
        const postBytes = enc.encode(post);
        const full = new Uint8Array(metaBytes.length + midBytes.length + bytes.length + postBytes.length);
        full.set(metaBytes, 0);
        full.set(midBytes, metaBytes.length);
        full.set(bytes, metaBytes.length + midBytes.length);
        full.set(postBytes, metaBytes.length + midBytes.length + bytes.length);
        return { body: full, boundary };
    }

    async function createOrUpdate(name, bytes, mime) {
        const existing = await getFileByName(name);
        const meta = existing ? {} : { name, parents: ['appDataFolder'] };
        const { body, boundary } = multipartBody(meta, bytes, mime);
        if (existing) {
            await driveFetch(`/upload/drive/v3/files/${existing.id}?uploadType=multipart`, {
                method: 'PATCH',
                headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
                body
            });
            return existing.id;
        } else {
            const res = await driveFetch(`/upload/drive/v3/files?uploadType=multipart`, {
                method: 'POST',
                headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
                body
            });
            const j = await res.json();
            return j.id;
        }
    }

    async function deleteFile(fileId) {
        await driveFetch(`/drive/v3/files/${fileId}`, { method: 'DELETE' });
    }

    // ---- Snapshot build/apply ----
    function collectLocalSnapshot() {
        const data = {};
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k) continue;
            if (k.startsWith('gdsync.')) continue; // never upload internal tokens or hints
            data[k] = localStorage.getItem(k);
        }
        return {
            meta: { updatedAt: now(), deviceId, version: 1 },
            data: { localStorage: data }
        };
    }

    function applyLocalSnapshot(snap) {
        if (!snap || !snap.data || !snap.data.localStorage) throw new Error('Invalid snapshot');
        // Overwrite: set all keys from snapshot (do not rename)
        const map = snap.data.localStorage;
        // (Optionally clear only known keys, but we keep existing unknown keys intact)
        for (const [k, v] of Object.entries(map)) localStorage.setItem(k, v);
        // Ask the app to refresh itself if it has a global render(); otherwise no-op
        try { if (typeof render === 'function') render(); } catch { }
    }

    // ---- Public API ----
    async function signIn() {
        await ensureToken(true);
        setChip('ok', 'Signed in');
        showToast?.('Signed in', 'success');
        // first-time: if cloud has data and local is empty, prompt restore
        try {
            const cur = await getFileByName('current.json');
            const localEmpty = localStorage.length === 0;
            if (localEmpty && cur) {
                showConfirmModal?.('A cloud backup exists. Restore it to this device?', () => {
                    restoreLatest();
                }, 'Restore from Cloud', 'default');
            } else {
                // otherwise upload immediately
                syncNow();
            }
        } catch { }
    }

    function signOut() {
        revokeToken();
        setChip('muted', 'Needs sign-in');
        showToast?.('Signed out', 'warning');
    }

    async function listBackups(limit = 5) {
        const { files } = await listAppDataFiles(`name contains 'backup-' order by createdTime desc`);
        return (files || []).slice(0, limit);
    }

    async function downloadBackup(id) {
        return downloadFile(id);
    }

    async function restoreLatest() {
        try {
            setChip('sync', 'Restoring…');
            const cur = await getFileByName('current.json');
            if (!cur) throw new Error('No cloud backup found');
            const buf = await downloadFile(cur.id);
            const json = await maybeDecrypt(buf, passEl?.value || '');
            const snap = JSON.parse(json);
            applyLocalSnapshot(snap);
            setChip('ok', 'Up to date');
            showToast?.('Restored from cloud', 'success');
        } catch (e) {
            setChip(navigator.onLine ? 'err' : 'off', navigator.onLine ? 'Error' : 'Offline');
            showToast?.(e.message || 'Restore failed', 'error');
            throw e;
        }
    }

    // Debounced autosync
    let autosyncTimer = null;
    const scheduleAutosync = () => {
        if (pendingUpload) return;
        clearTimeout(autosyncTimer);
        autosyncTimer = setTimeout(() => { syncNow().catch(() => { }); }, 5000);
    };

    // Monkey-patch localStorage to detect writes (no behavior change)
    (function monkeyPatchLocalStorage() {
        const s = window.localStorage;
        if (!s) return;
        const _set = s.setItem.bind(s);
        const _rem = s.removeItem.bind(s);
        const _clr = s.clear?.bind(s) || (() => { });
        s.setItem = function (k, v) { _set(k, v); scheduleAutosync(); };
        s.removeItem = function (k) { _rem(k); scheduleAutosync(); };
        s.clear = function () { _clr(); scheduleAutosync(); };
    })();

    // Sync core
    async function resolveConflict(remoteMeta, localMeta) {
        if (!remoteMeta) return 'local';
        const dtRemote = remoteMeta.updatedAt || 0;
        const dtLocal = localMeta.updatedAt || 0;
        const diff = Math.abs(dtRemote - dtLocal);
        if (dtLocal > dtRemote) return 'local';
        if (dtRemote > dtLocal && diff > 10_000) return 'remote';
        // near-tie: ask user
        return await new Promise((resolve) => {
            showConfirmModal?.(
                'A recent cloud change was detected. Use Local or Cloud version?',
                () => resolve('local'),
                'Conflict detected',
                'default'
            );
            // Add a secondary button behavior: if user cancels, pick cloud
            const cancelBtn = document.getElementById('confirmModalCancel');
            if (cancelBtn) cancelBtn.onclick = () => { resolve('remote'); };
        });
    }

    async function syncNow() {
        if (isSyncing) return;
        isSyncing = true;
        setChip('sync', 'Syncing…');
        try {
            await ensureToken(false);
            const passphrase = passEl?.value || '';

            // Compare with remote meta (if exists)
            let remoteMeta = null;
            try {
                const cur = await getFileByName('current.json');
                if (cur) {
                    const buf = await downloadFile(cur.id);
                    const json = await maybeDecrypt(buf, passphrase);
                    const snap = JSON.parse(json);
                    remoteMeta = snap.meta || null;
                }
            } catch { }

            const localSnap = collectLocalSnapshot();
            const winner = await resolveConflict(remoteMeta, localSnap.meta);
            if (winner === 'remote') {
                await restoreLatest();
                isSyncing = false;
                pendingUpload = false;
                setChip('ok', 'Up to date');
                return;
            }

            // Upload current.json
            const json = safeJSON(localSnap);
            const body = await maybeEncrypt(json, passphrase);
            await createOrUpdate('current.json', new Uint8Array(body.body), body.mime);

            // Create rolling backup (keep last 5)
            const stamp = fmtDate(now());
            const bname = `backup-${stamp}.json`;
            await createOrUpdate(bname, new Uint8Array(body.body), body.mime);
            // prune
            try {
                const all = await listBackups(100);
                const toDelete = (all || []).slice(5);
                await Promise.allSettled(toDelete.map(f => deleteFile(f.id)));
            } catch { }

            setChip('ok', 'Up to date');
            showToast?.('Synced', 'success');
            pendingUpload = false;
            backoffMs = 0;
        } catch (e) {
            if (navigator.onLine === false) {
                setChip('off', 'Offline');
                pendingUpload = true;
                showToast?.('Offline - will upload when back online', 'warning');
            } else {
                setChip('err', 'Error');
                backoffMs = Math.min(backoffMs ? backoffMs * 2 : 1000, 30_000);
                showToast?.(e.message || 'Sync failed', 'error');
            }
        } finally {
            isSyncing = false;
        }
    }

    function signInIfNeededToast() {
        try {
            if (!localStorage.getItem(FIRSTLOAD)) {
                showToast?.('Sign in to enable automatic backups.', 'warning');
                localStorage.setItem(FIRSTLOAD, '1');
            }
        } catch { }
    }

    // ---- UI wiring ----
    function bindUI() {
        if (!btn || !menu) return;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            showMenu(menu.classList.contains('hidden'));
        });
        menu.addEventListener('click', async (e) => {
            const b = e.target.closest('.cloud-item');
            if (!b) return;
            const action = b.getAttribute('data-action');
            try {
                if (action === 'signin') { await signIn(); }
                if (action === 'signout') { signOut(); }
                if (action === 'sync') { await syncNow(); }
                if (action === 'restore') {
                    showConfirmModal?.('Restore the latest cloud backup to this device? This will overwrite local data keys present in the backup.', async () => {
                        await restoreLatest();
                    }, 'Restore from Cloud', 'default');
                }
                if (action === 'view') {
                    const backups = await listBackups(5);
                    if (!backups.length) { showToast?.('No backups found', 'warning'); return; }
                    // simple chooser via confirm modal cycling
                    const items = backups.map((f, i) => `${i + 1}. ${f.name} (${new Date(f.modifiedTime).toLocaleString()})`).join('\n');
                    showAlertModal?.(items, 'Backups (latest first)');
                }
            } finally {
                showMenu(false);
            }
        });
        // outside click / esc close
        document.addEventListener('click', (e) => {
            if (!menu.contains(e.target) && !btn.contains(e.target)) showMenu(false);
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') showMenu(false);
        });
    }

    // ---- Offline/online handling + window focus ----
    window.addEventListener('online', () => { if (pendingUpload) syncNow().catch(() => { }); });
    window.addEventListener('focus', () => { syncNow().catch(() => { }); });

    // ---- Expose minimal API ----
    window.GDSync = {
        signIn, signOut,
        isSignedIn: () => !!accessToken,
        syncNow, restoreLatest, listBackups, downloadBackup
    };

    // ---- Boot ----
    (function boot() {
        try {
            const cached = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null');
            if (cached && cached.accessToken) { accessToken = cached.accessToken; tokenExpireAt = cached.tokenExpireAt || 0; }
        } catch { }
        setChip('muted', 'Needs sign-in');
        bindUI();
        signInIfNeededToast();
        // initial gentle sync attempt (non-interactive; will no-op if not signed-in)
        syncNow().catch(() => { });
    })();

})();
