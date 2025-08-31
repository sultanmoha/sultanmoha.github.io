// sync/googleDriveSync.js
(() => {
    'use strict';

    // ====== CONFIG ======
    const OAUTH_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
    const CLIENT_ID = 'YOUR_GOOGLE_OAUTH_CLIENT_ID'; // ← replace with your Web client ID

    // internal storage (never uploaded)
    const TOKEN_KEY = 'gdsync.token';
    const DEVICE_KEY = 'gdsync.deviceId';
    const FIRSTLOAD = 'gdsync.toastShown';

    // ====== DOM ======
    const $ = (id) => document.getElementById(id);
    const btn = $('cloudSyncBtn');
    const menu = $('cloudSyncMenu');
    const chip = $('cloudStatusChip');
    const passI = $('cloudPassphrase');

    if (!btn || !menu || !chip) { console.warn('[GDSync] UI not found'); return; }

    // ====== STATE ======
    let accessToken = null;
    let tokenExpireAt = 0;
    let tokenClient = null;
    let isSyncing = false;
    let queued = false;
    let backoffMs = 0;

    // ====== UTIL ======
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    const now = () => Date.now();
    const deviceId = (() => {
        let d = localStorage.getItem(DEVICE_KEY);
        if (!d) { d = crypto.randomUUID(); localStorage.setItem(DEVICE_KEY, d); }
        return d;
    })();

    function setChip(state, text) {
        chip.classList.remove('cloud-chip-muted', 'cloud-chip-sync', 'cloud-chip-ok', 'cloud-chip-off', 'cloud-chip-err');
        chip.classList.add({
            muted: 'cloud-chip-muted', sync: 'cloud-chip-sync', ok: 'cloud-chip-ok', off: 'cloud-chip-off', err: 'cloud-chip-err'
        }[state] || 'cloud-chip-muted');
        chip.textContent = text;
    }

    function refreshMenuState() {
        const signedIn = !!accessToken;
        const q = (a) => menu.querySelector(`.cloud-item[data-action="${a}"]`);
        const setDis = (el, dis) => { if (el) { el.disabled = dis; el.classList.toggle('opacity-50', !!dis); } };
        setDis(q('signin'), signedIn);
        setDis(q('signout'), !signedIn);
        setDis(q('sync'), !signedIn);
        setDis(q('restore'), !signedIn);
        setDis(q('view'), !signedIn);
    }

    function showMenu(show) {
        if (show) {
            menu.classList.remove('hidden');
            btn.setAttribute('aria-expanded', 'true');
            const first = menu.querySelector('.cloud-item');
            if (first) first.focus();
        } else {
            menu.classList.add('hidden');
            btn.setAttribute('aria-expanded', 'false');
        }
        refreshMenuState();
    }

    // ====== Crypto (AES-GCM via PBKDF2) ======
    function b64(bytes) { return btoa(String.fromCharCode(...new Uint8Array(bytes))); }
    function b64d(str) { const bin = atob(str); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++)u[i] = bin.charCodeAt(i); return u.buffer; }
    async function deriveKey(pass, salt) {
        const base = await crypto.subtle.importKey('raw', enc.encode(pass), { name: 'PBKDF2' }, false, ['deriveKey']);
        return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
            base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    }
    async function maybeEncrypt(json, pass) {
        if (!pass) return { mime: 'application/json', body: enc.encode(json) };
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const key = await deriveKey(pass, salt);
        const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(json));
        const env = JSON.stringify({ v: 1, enc: 'aes-gcm', salt: b64(salt), iv: b64(iv), data: b64(ct) });
        return { mime: 'application/json', body: enc.encode(env) };
    }
    async function maybeDecrypt(bytes, pass) {
        if (!pass) return dec.decode(bytes);
        const env = JSON.parse(dec.decode(bytes));
        const key = await deriveKey(pass, new Uint8Array(b64d(env.salt)));
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(b64d(env.iv)) }, key, b64d(env.data));
        return dec.decode(pt);
    }

    // ====== GIS token (PKCE) ======
    async function loadGIS() {
        if (window.google?.accounts?.oauth2) return;
        await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://accounts.google.com/gsi/client';
            s.async = true; s.defer = true;
            s.onload = res; s.onerror = () => rej(new Error('Failed to load Google Identity Services'));
            document.head.appendChild(s);
        });
    }
    async function ensureToken(interactive = false) {
        if (navigator.onLine === false) { setChip('off', 'Offline'); queued = true; throw new Error('Offline'); }
        if (accessToken && tokenExpireAt - now() > 5 * 60 * 1000) return accessToken; // reuse if >5m left

        await loadGIS();
        if (!tokenClient) {
            tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: CLIENT_ID,
                scope: OAUTH_SCOPE,
                prompt: interactive ? 'consent' : '',
                callback: () => { }
            });
        }
        const token = await new Promise((resolve, reject) => {
            tokenClient.callback = (resp) => resp?.access_token ? resolve(resp) : reject(new Error(resp?.error || 'Auth failed'));
            try { tokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '' }); } catch (e) { reject(e); }
        });
        accessToken = token.access_token;
        tokenExpireAt = now() + (token.expires_in ? token.expires_in * 1000 : 3600 * 1000);
        try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ accessToken, tokenExpireAt })); } catch { }
        setChip('ok', 'Signed in');
        refreshMenuState();
        return accessToken;
    }
    function revokeToken() {
        const tok = accessToken || (JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null')?.accessToken);
        if (tok && window.google?.accounts?.oauth2?.revoke) google.accounts.oauth2.revoke(tok, () => { });
        accessToken = null; tokenExpireAt = 0;
        try { sessionStorage.removeItem(TOKEN_KEY); } catch { }
        setChip('muted', 'Needs sign-in');
        refreshMenuState();
    }

    // ====== Drive helpers (REST via fetch) ======
    async function driveFetch(path, opts = {}) {
        const tok = await ensureToken(false).catch(() => null);
        if (!tok) throw new Error('Not signed in');
        const res = await fetch(`https://www.googleapis.com${path}`, {
            ...opts, headers: { 'Authorization': `Bearer ${tok}`, ...(opts.headers || {}) }
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Drive ${res.status}: ${text || res.statusText}`);
        }
        return res;
    }
    async function listAppDataFiles({ q = '', pageSize = 100, orderBy = 'modifiedTime desc' } = {}) {
        const params = new URLSearchParams({
            spaces: 'appDataFolder',
            fields: 'files(id,name,modifiedTime,createdTime,size)',
            pageSize: String(pageSize),
            q, orderBy
        });
        const res = await driveFetch(`/drive/v3/files?${params.toString()}`, { method: 'GET' });
        return res.json();
    }
    async function getFileByName(name) {
        const q = `name='${name.replace(/'/g, "\\'")}'`;
        const { files } = await listAppDataFiles({ q, pageSize: 1 });
        return files?.[0] || null;
    }
    async function downloadFile(fileId) {
        const res = await driveFetch(`/drive/v3/files/${fileId}?alt=media`, { method: 'GET' });
        const buf = await res.arrayBuffer(); return new Uint8Array(buf);
    }
    function multipartBody(metadata, bytes, mime) {
        const boundary = 'gdsync_' + Math.random().toString(16).slice(2);
        const meta = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`;
        const data = `--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`;
        const end = `\r\n--${boundary}--`;
        const b1 = enc.encode(meta), b2 = enc.encode(data), b3 = bytes, b4 = enc.encode(end);
        const full = new Uint8Array(b1.length + b2.length + b3.length + b4.length);
        full.set(b1, 0); full.set(b2, b1.length); full.set(b3, b1.length + b2.length); full.set(b4, b1.length + b2.length + b3.length);
        return { body: full, boundary };
    }
    async function createOrUpdate(name, bytes, mime) {
        const existing = await getFileByName(name);
        const metadata = existing ? {} : { name, parents: ['appDataFolder'] };
        const { body, boundary } = multipartBody(metadata, bytes, mime);
        if (existing) {
            await driveFetch(`/upload/drive/v3/files/${existing.id}?uploadType=multipart`, {
                method: 'PATCH', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body
            });
            return existing.id;
        } else {
            const res = await driveFetch(`/upload/drive/v3/files?uploadType=multipart`, {
                method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body
            });
            const j = await res.json(); return j.id;
        }
    }
    async function deleteFile(fileId) { await driveFetch(`/drive/v3/files/${fileId}`, { method: 'DELETE' }); }

    // ====== Snapshot ======
    function collectLocalSnapshot() {
        const data = {};
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i); if (!k) continue;
            if (k.startsWith('gdsync.')) continue; // skip internal
            data[k] = localStorage.getItem(k);
        }
        return { meta: { updatedAt: Date.now(), deviceId, version: 1 }, data: { localStorage: data } };
    }
    function applyLocalSnapshot(snap) {
        if (!snap?.data?.localStorage) throw new Error('Invalid snapshot');
        const map = snap.data.localStorage;
        for (const [k, v] of Object.entries(map)) localStorage.setItem(k, v);
        try { if (typeof render === 'function') render(); } catch { }
    }

    // ====== Sync core ======
    async function listBackups(limit = 5) {
        const { files } = await listAppDataFiles({ q: "name contains 'backup-'", pageSize: limit, orderBy: 'modifiedTime desc' });
        return files || [];
    }
    async function restoreLatest() {
        setChip('sync', 'Restoring…');
        const cur = await getFileByName('current.json');
        if (!cur) { setChip('err', 'Error'); showToast?.('No cloud backup found', 'error'); return; }
        const buf = await downloadFile(cur.id);
        const json = await maybeDecrypt(buf, passI?.value || '');
        const snap = JSON.parse(json);
        applyLocalSnapshot(snap);
        setChip('ok', 'Up to date'); showToast?.('Restored from cloud', 'success');
    }
    async function syncNow() {
        if (isSyncing) return;
        isSyncing = true; setChip('sync', 'Syncing…');
        try {
            await ensureToken(false);
            // read remote meta if present
            let remoteMeta = null;
            try {
                const cur = await getFileByName('current.json');
                if (cur) {
                    const buf = await downloadFile(cur.id);
                    const json = await maybeDecrypt(buf, passI?.value || '');
                    remoteMeta = JSON.parse(json).meta || null;
                }
            } catch { }
            const localSnap = collectLocalSnapshot();
            const dtR = remoteMeta?.updatedAt || 0, dtL = localSnap.meta.updatedAt;

            if (dtR && Math.abs(dtR - dtL) <= 10_000) {
                const chooseLocal = await new Promise((resolve) => {
                    if (window.showConfirmModal) {
                        showConfirmModal('A recent cloud change was detected. Use Local or Cloud version?', () => resolve(true), 'Conflict detected');
                        const cancelBtn = document.getElementById('confirmModalCancel');
                        if (cancelBtn) cancelBtn.onclick = () => resolve(false);
                    } else { resolve(confirm('Conflict: OK=Local, Cancel=Cloud')); }
                });
                if (!chooseLocal) { await restoreLatest(); isSyncing = false; setChip('ok', 'Up to date'); return; }
            } else if (dtR && dtR > dtL) {
                await restoreLatest(); isSyncing = false; setChip('ok', 'Up to date'); return;
            }

            const json = JSON.stringify(localSnap, null, 2);
            const body = await maybeEncrypt(json, passI?.value || '');
            await createOrUpdate('current.json', new Uint8Array(body.body), body.mime);

            const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, ''); // 20250130T112233
            await createOrUpdate(`backup-${stamp}.json`, new Uint8Array(body.body), body.mime);

            // prune to last 5
            try {
                const all = await listBackups(100);
                const extra = (all || []).slice(5);
                await Promise.allSettled(extra.map(f => deleteFile(f.id)));
            } catch { }

            setChip('ok', 'Up to date'); showToast?.('Synced', 'success');
            queued = false; backoffMs = 0;
        } catch (e) {
            if (navigator.onLine === false) { setChip('off', 'Offline'); queued = true; showToast?.('Offline - will upload when back online', 'warning'); }
            else { setChip('err', 'Error'); backoffMs = Math.min(backoffMs ? backoffMs * 2 : 1000, 30000); showToast?.(e.message || 'Sync failed', 'error'); }
        } finally {
            isSyncing = false;
        }
    }

    // ====== Auto-sync hooks ======
    let debounceTimer = null;
    function scheduleAutosync() {
        if (queued) return;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => { syncNow().catch(() => { }); }, 5000);
    }
    // observe localStorage writes (no behavior change)
    (function patchLocalStorage() {
        const s = window.localStorage; if (!s) return;
        const _set = s.setItem.bind(s), _rem = s.removeItem.bind(s), _clr = s.clear?.bind(s) || (() => { });
        s.setItem = function (k, v) { _set(k, v); scheduleAutosync(); };
        s.removeItem = function (k) { _rem(k); scheduleAutosync(); };
        s.clear = function () { _clr(); scheduleAutosync(); };
    })();

    // ====== UI wiring ======
    btn.addEventListener('click', (e) => { e.stopPropagation(); showMenu(menu.classList.contains('hidden')); });
    document.addEventListener('click', (e) => { if (!menu.contains(e.target) && !btn.contains(e.target)) showMenu(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') showMenu(false); });
    menu.addEventListener('click', async (e) => {
        const item = e.target.closest('.cloud-item'); if (!item) return;
        const action = item.getAttribute('data-action');
        try {
            if (action === 'signin') await ensureToken(true);
            if (action === 'signout') revokeToken();
            if (action === 'sync') await syncNow();
            if (action === 'restore') {
                if (window.showConfirmModal) {
                    showConfirmModal('Restore the latest cloud backup? This will overwrite local data keys present in the backup.', async () => { await restoreLatest(); }, 'Restore from Cloud');
                } else if (confirm('Restore latest cloud backup?')) { await restoreLatest(); }
            }
            if (action === 'view') {
                const list = await listBackups(5);
                if (!list.length) { showToast?.('No backups found', 'warning'); return; }
                const lines = list.map((f, i) => `${i + 1}. ${f.name}  –  ${new Date(f.modifiedTime).toLocaleString()}`).join('\n');
                if (window.showAlertModal) showAlertModal(lines, 'Backups (latest first)'); else alert(lines);
            }
        } finally { showMenu(false); }
    });

    // ====== network events ======
    window.addEventListener('online', () => { if (queued) syncNow().catch(() => { }); });
    window.addEventListener('focus', () => { syncNow().catch(() => { }); });

    // ====== expose API (optional) ======
    window.GDSync = { signIn: () => ensureToken(true), signOut: revokeToken, isSignedIn: () => !!accessToken, syncNow, restoreLatest, listBackups };

    // ====== boot ======
    (function boot() {
        try {
            const cached = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null');
            if (cached?.accessToken) { accessToken = cached.accessToken; tokenExpireAt = cached.tokenExpireAt || 0; setChip('ok', 'Signed in'); }
            else setChip('muted', 'Needs sign-in');
        } catch { setChip('muted', 'Needs sign-in'); }
        refreshMenuState();
        // gentle initial sync (no prompt)
        syncNow().catch(() => { /* ignore */ });
        // first-load toast
        try {
            if (!localStorage.getItem(FIRSTLOAD)) { showToast?.('Sign in to enable automatic backups.', 'warning'); localStorage.setItem(FIRSTLOAD, '1'); }
        } catch { }
    })();

})();
