// sync/googleDriveSync.js
(() => {
  'use strict';

  // ====== CONFIG ======
  const OAUTH_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  const CLIENT_ID   = '4853441079-chf1qiv8a06pfjk6a2c1b6eq4uosi765.apps.googleusercontent.com'; // ← replace with your Web client ID

  // Internal storage (never uploaded)
  const TOKEN_KEY   = 'gdsync.token';
  const DEVICE_KEY  = 'gdsync.deviceId';
  const FIRSTLOAD   = 'gdsync.toastShown';

  // ====== DOM ======
  const $ = (id) => document.getElementById(id);
  const btn   = $('cloudSyncBtn');
  const menu  = $('cloudSyncMenu');
  const chip  = $('cloudStatusChip');
  const passI = $('cloudPassphrase');

  if (!btn || !menu || !chip) { console.warn('[GDSync] UI not found'); return; }

  // Inline backups panel inside the dropdown
  let backupsPanel = menu.querySelector('#cloudBackupsPanel');
  if (!backupsPanel) {
    backupsPanel = document.createElement('div');
    backupsPanel.id = 'cloudBackupsPanel';
    backupsPanel.className = 'mt-2 rounded-md border border-neutral-200 dark:border-neutral-700 hidden';
    backupsPanel.setAttribute('role','group');
    menu.appendChild(backupsPanel);
  }

  // ====== STATE ======
  let accessToken   = null;
  let tokenExpireAt = 0;
  let tokenClient   = null;
  let isSyncing     = false;
  let queued        = false;
  let backoffMs     = 0;

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
    chip.classList.remove('cloud-chip-muted','cloud-chip-sync','cloud-chip-ok','cloud-chip-off','cloud-chip-err');
    chip.classList.add({
      muted:'cloud-chip-muted', sync:'cloud-chip-sync', ok:'cloud-chip-ok', off:'cloud-chip-off', err:'cloud-chip-err'
    }[state] || 'cloud-chip-muted');
    chip.textContent = text;
  }

  function updateSignInMenuLabel() {
    const item = menu.querySelector('.cloud-item[data-action="signin"]');
    if (!item) return;
    if (accessToken) {
      item.innerHTML = `<i class="fa-solid fa-circle-check w-4 text-center" aria-hidden="true"></i> Signed`;
      item.setAttribute('aria-disabled','true');
      item.disabled = true;
      item.classList.add('opacity-50','cursor-default');
    } else {
      item.innerHTML = `<i class="fa-solid fa-right-to-bracket w-4 text-center" aria-hidden="true"></i> Sign in`;
      item.removeAttribute('aria-disabled');
      item.disabled = false;
      item.classList.remove('opacity-50','cursor-default');
    }
  }

  function refreshMenuState() {
    const signedIn = !!accessToken;
    const q = (a) => menu.querySelector(`.cloud-item[data-action="${a}"]`);
    const setDis = (el, dis) => { if (el) { el.disabled = dis; el.classList.toggle('opacity-50', !!dis); el.setAttribute('aria-disabled', dis ? 'true' : 'false'); } };

    updateSignInMenuLabel();
    setDis(q('signout'), !signedIn);
    setDis(q('sync'),    !signedIn);
    setDis(q('restore'), !signedIn);
    setDis(q('view'),    !signedIn);

    if (!signedIn) backupsPanel.classList.add('hidden');
  }

  function showMenu(show) {
    if (show) {
      menu.classList.remove('hidden');
      btn.setAttribute('aria-expanded','true');
      const first = menu.querySelector('.cloud-item');
      if (first) first.focus();
    } else {
      menu.classList.add('hidden');
      btn.setAttribute('aria-expanded','false');
      backupsPanel.classList.add('hidden');
    }
    refreshMenuState();
  }

  // ====== Crypto (AES-GCM via PBKDF2) ======
  function b64(bytes){return btoa(String.fromCharCode(...new Uint8Array(bytes))); }
  function b64d(str){ const bin=atob(str); const u=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i); return u.buffer; }
  async function deriveKey(pass, salt){
    const base=await crypto.subtle.importKey('raw', enc.encode(pass), {name:'PBKDF2'}, false, ['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2', salt, iterations:100_000, hash:'SHA-256'},
      base, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
  }
  async function maybeEncrypt(json, pass){
    if(!pass) return { mime:'application/json', body: enc.encode(json) };
    const salt=crypto.getRandomValues(new Uint8Array(16));
    const iv  =crypto.getRandomValues(new Uint8Array(12));
    const key =await deriveKey(pass, salt);
    const ct  =await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, enc.encode(json));
    const env =JSON.stringify({v:1, enc:'aes-gcm', salt:b64(salt), iv:b64(iv), data:b64(ct)});
    return { mime:'application/json', body: enc.encode(env) };
  }
  async function maybeDecrypt(bytes, pass){
    if(!pass) return dec.decode(bytes);
    const env = JSON.parse(dec.decode(bytes));
    const key = await deriveKey(pass, new Uint8Array(b64d(env.salt)));
    const pt  = await crypto.subtle.decrypt({name:'AES-GCM', iv:new Uint8Array(b64d(env.iv))}, key, b64d(env.data));
    return dec.decode(pt);
  }

  // ====== GIS token (PKCE) ======
  async function loadGIS(){
    if (window.google?.accounts?.oauth2) return;
    await new Promise((res, rej) => {
      const s=document.createElement('script');
      s.src='https://accounts.google.com/gsi/client';
      s.async=true; s.defer=true;
      s.onload=res; s.onerror=()=>rej(new Error('Failed to load Google Identity Services'));
      document.head.appendChild(s);
    });
  }
  async function ensureToken(interactive=false){
    if (navigator.onLine === false) { setChip('off','Offline'); queued=true; throw new Error('Offline'); }
    if (accessToken && tokenExpireAt - now() > 5*60*1000) return accessToken;

    await loadGIS();
    if (!tokenClient) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: OAUTH_SCOPE,
        prompt: interactive ? 'consent' : '',
        callback: () => {}
      });
    }
    const token = await new Promise((resolve, reject) => {
      tokenClient.callback = (resp) => resp?.access_token ? resolve(resp) : reject(new Error(resp?.error || 'Auth failed'));
      try { tokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '' }); } catch(e){ reject(e); }
    });
    accessToken   = token.access_token;
    tokenExpireAt = now() + (token.expires_in ? token.expires_in*1000 : 3600*1000);
    try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify({accessToken, tokenExpireAt})); } catch {}
    setChip('ok','Signed in');
    refreshMenuState();
    return accessToken;
  }
  function revokeToken(){
    const tok = accessToken || (JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null')?.accessToken);
    if (tok && window.google?.accounts?.oauth2?.revoke) google.accounts.oauth2.revoke(tok, ()=>{});
    accessToken=null; tokenExpireAt=0;
    try { sessionStorage.removeItem(TOKEN_KEY); } catch {}
    setChip('muted','Needs sign-in');
    refreshMenuState();
  }

  // ====== Drive helpers (REST via fetch) ======
  async function driveFetch(path, opts={}){
    const tok = await ensureToken(false).catch(()=>null);
    if (!tok) throw new Error('Not signed in');
    const res = await fetch(`https://www.googleapis.com${path}`, {
      ...opts, headers: { 'Authorization': `Bearer ${tok}`, ...(opts.headers||{}) }
    });
    if (!res.ok) {
      const text = await res.text().catch(()=> '');
      throw new Error(`Drive ${res.status}: ${text || res.statusText}`);
    }
    return res;
  }
  async function listAppDataFiles({q='', pageSize=100, orderBy='modifiedTime desc'}={}){
    const params = new URLSearchParams({
      spaces:'appDataFolder',
      fields:'files(id,name,modifiedTime,createdTime,size)',
      pageSize:String(pageSize),
      q, orderBy
    });
    const res = await driveFetch(`/drive/v3/files?${params.toString()}`, {method:'GET'});
    return res.json();
  }
  async function getFileByName(name){
    const q = `name='${name.replace(/'/g,"\\'")}'`;
    const { files } = await listAppDataFiles({ q, pageSize:1 });
    return files?.[0] || null;
  }
  async function downloadFile(fileId){
    const res = await driveFetch(`/drive/v3/files/${fileId}?alt=media`, {method:'GET'});
    const buf = await res.arrayBuffer(); return new Uint8Array(buf);
  }
  function multipartBody(metadata, bytes, mime){
    const boundary = 'gdsync_' + Math.random().toString(16).slice(2);
    const meta = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`;
    const data = `--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`;
    const end  = `\r\n--${boundary}--`;
    const b1 = enc.encode(meta), b2 = enc.encode(data), b3 = bytes, b4 = enc.encode(end);
    const full = new Uint8Array(b1.length+b2.length+b3.length+b4.length);
    full.set(b1,0); full.set(b2,b1.length); full.set(b3,b1.length+b2.length); full.set(b4,b1.length+b2.length+b3.length);
    return { body: full, boundary };
  }
  async function createOrUpdate(name, bytes, mime){
    const existing = await getFileByName(name);
    const metadata = existing ? {} : { name, parents:['appDataFolder'] };
    const { body, boundary } = multipartBody(metadata, bytes, mime);
    if (existing) {
      await driveFetch(`/upload/drive/v3/files/${existing.id}?uploadType=multipart`, {
        method:'PATCH', headers:{ 'Content-Type': `multipart/related; boundary=${boundary}` }, body
      });
      return existing.id;
    } else {
      const res = await driveFetch(`/upload/drive/v3/files?uploadType=multipart`, {
        method:'POST', headers:{ 'Content-Type': `multipart/related; boundary=${boundary}` }, body
      });
      const j = await res.json(); return j.id;
    }
  }
  async function deleteFile(fileId){ await driveFetch(`/drive/v3/files/${fileId}`, {method:'DELETE'}); }

  // ====== Snapshot ======
  function collectLocalSnapshot(){
    const data = {};
    for (let i=0;i<localStorage.length;i++){
      const k = localStorage.key(i); if (!k) continue;
      if (k.startsWith('gdsync.')) continue; // skip internal
      data[k] = localStorage.getItem(k);
    }
    return { meta:{ updatedAt: Date.now(), deviceId, version:1 }, data:{ localStorage: data } };
  }

  function applyLocalSnapshot(snap){
    if (!snap?.data?.localStorage) throw new Error('Invalid snapshot');
    const map = snap.data.localStorage;

    // Write snapshot to localStorage
    for (const [k,v] of Object.entries(map)) localStorage.setItem(k, v);

    // Reload in-memory state & UI (mirror app boot / import)
    try {
      if (typeof load === 'function') load();
      if (typeof loadTransactions === 'function') loadTransactions();
      if (typeof loadBadgeMap === 'function') loadBadgeMap();

      if (typeof loadPurchases === 'function')      { window.purchases      = loadPurchases(); }
      if (typeof loadPurchaseItems === 'function')  { window.purchaseItems  = loadPurchaseItems(); }
      if (typeof populatePurchaseOptions === 'function') populatePurchaseOptions();
      if (typeof renderPurchases === 'function')    renderPurchases();

      // Saves panels (deliveries / purchases / calculator)
      if (typeof loadSaves === 'function') loadSaves();
      if (typeof populateSavePanel === 'function') populateSavePanel();
      if (typeof loadPurchaseSaves === 'function') loadPurchaseSaves();
      if (typeof populatePurchaseSavePanel === 'function') populatePurchaseSavePanel();
      if (typeof loadCalcSaves === 'function') loadCalcSaves();
      if (typeof populateCalcSavesSection === 'function') populateCalcSavesSection();

      if (typeof updateCalculatorDefaults === 'function') updateCalculatorDefaults();
      if (typeof updatePreview === 'function') updatePreview();
      if (typeof populateShopDropdown === 'function') populateShopDropdown();

      if (typeof render === 'function') render();
    } catch { /* never break restore if a hook is missing */ }
  }

  // ====== Only sync when Deliveries table has items ======
  function shouldSync() {
    try {
      const rows = JSON.parse(localStorage.getItem('bakery-tracker-rows') || '[]');
      return Array.isArray(rows) && rows.length > 0;
    } catch { return false; }
  }

  // ====== Sync core ======
  async function listBackups(limit=5){
    const { files } = await listAppDataFiles({ q:"name contains 'backup-'", pageSize:limit, orderBy:'modifiedTime desc' });
    return files || [];
  }

  async function restoreBackup(fileId) {
    setChip('sync','Restoring…');
    const buf  = await downloadFile(fileId);
    const json = await maybeDecrypt(buf, passI?.value || '');
    const snap = JSON.parse(json);
    applyLocalSnapshot(snap);
    setChip('ok','Up to date'); showToast?.('Restored from selected backup','success');
  }

  async function restoreLatest(){
    setChip('sync','Restoring…');
    const cur = await getFileByName('current.json');
    if (!cur) { setChip('err','Error'); showToast?.('No cloud backup found','error'); return; }
    const buf  = await downloadFile(cur.id);
    const json = await maybeDecrypt(buf, passI?.value || '');
    const snap = JSON.parse(json);
    applyLocalSnapshot(snap);
    setChip('ok','Up to date'); showToast?.('Restored from cloud','success');
  }

  async function syncNow(){
    if (isSyncing) return;

    // Respect rule: do not sync when there are no deliveries
    if (!shouldSync()) { setChip('ok','Up to date'); return; }

    isSyncing = true; setChip('sync','Syncing…');
    try{
      await ensureToken(false);

      // Compare with remote meta (if exists)
      let remoteMeta=null;
      try{
        const cur = await getFileByName('current.json');
        if (cur) {
          const buf = await downloadFile(cur.id);
          const json = await maybeDecrypt(buf, passI?.value || '');
          remoteMeta = JSON.parse(json).meta || null;
        }
      }catch{}

      const localSnap = collectLocalSnapshot();
      const dtR = remoteMeta?.updatedAt || 0, dtL = localSnap.meta.updatedAt;

      if (dtR && Math.abs(dtR - dtL) <= 10_000) {
        const chooseLocal = await new Promise((resolve)=>{
          if (window.showConfirmModal) {
            showConfirmModal('A recent cloud change was detected. Use Local or Cloud version?', () => resolve(true), 'Conflict detected');
            const cancelBtn = document.getElementById('confirmModalCancel');
            if (cancelBtn) cancelBtn.onclick = () => resolve(false);
          } else { resolve(confirm('Conflict: OK=Local, Cancel=Cloud')); }
        });
        if (!chooseLocal) { await restoreLatest(); isSyncing=false; setChip('ok','Up to date'); return; }
      } else if (dtR && dtR > dtL) {
        await restoreLatest(); isSyncing=false; setChip('ok','Up to date'); return;
      }

      // Upload current + rolling backup (keep last 5)
      const json = JSON.stringify(localSnap, null, 2);
      const body = await maybeEncrypt(json, passI?.value || '');
      await createOrUpdate('current.json', new Uint8Array(body.body), body.mime);

      const stamp = new Date().toISOString().replace(/[-:]/g,'').replace(/\..+/,''); // 20250130T112233
      await createOrUpdate(`backup-${stamp}.json`, new Uint8Array(body.body), body.mime);

      try {
        const all = await listBackups(100);
        const extra = (all||[]).slice(5);
        await Promise.allSettled(extra.map(f => deleteFile(f.id)));
      } catch {}

      setChip('ok','Up to date'); showToast?.('Synced','success');
      queued=false; backoffMs=0;
    } catch(e){
      if (navigator.onLine === false) { setChip('off','Offline'); queued=true; showToast?.('Offline - will upload when back online','warning'); }
      else { setChip('err','Error'); backoffMs=Math.min(backoffMs?backoffMs*2:1000,30000); showToast?.(e.message||'Sync failed','error'); }
    } finally {
      isSyncing=false;
    }
  }

  // ====== Auto-sync hooks ======
  let debounceTimer=null;
  function scheduleAutosync(){
    if (queued) return;
    if (!shouldSync()) return;          // gate on deliveries
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(()=>{ syncNow().catch(()=>{}); }, 5000);
  }
  (function patchLocalStorage(){
    const s = window.localStorage; if (!s) return;
    const _set=s.setItem.bind(s), _rem=s.removeItem.bind(s), _clr=s.clear?.bind(s)||(()=>{});
    s.setItem=function(k,v){ _set(k,v); scheduleAutosync(); };
    s.removeItem=function(k){ _rem(k); scheduleAutosync(); };
    s.clear=function(){ _clr(); scheduleAutosync(); };
  })();

  // ====== UI wiring ======
  btn.addEventListener('click',(e)=>{ e.stopPropagation(); showMenu(menu.classList.contains('hidden')); });
  document.addEventListener('click',(e)=>{ if (!menu.contains(e.target) && !btn.contains(e.target)) showMenu(false); });
  document.addEventListener('keydown',(e)=>{ if (e.key==='Escape') showMenu(false); });

  menu.addEventListener('click', async (e) => {
    const item = e.target.closest('.cloud-item');
    const action = item?.getAttribute('data-action');
    try {
      if (action==='signin')  { await ensureToken(true); refreshMenuState(); return; }
      if (action==='signout') { revokeToken(); showMenu(false); return; }
      if (action==='sync')    { await syncNow(); showMenu(false); return; }
      if (action==='restore') {
        if (window.showConfirmModal) {
          showConfirmModal('Restore the latest cloud backup? This will overwrite local data keys present in the backup.', async ()=>{ await restoreLatest(); }, 'Restore from Cloud');
        } else if (confirm('Restore latest cloud backup?')) { await restoreLatest(); }
        showMenu(false);
        return;
      }
      if (action==='view') {
        // Inline list (keep menu OPEN)
        backupsPanel.classList.remove('hidden');
        backupsPanel.innerHTML = `
          <div class="px-2 py-1 text-xs text-neutral-500 dark:text-neutral-400">Backups (latest first)</div>
          <div id="cloudBackupsList" class="cloud-b-list divide-y divide-neutral-200 dark:divide-neutral-700"></div>
        `;
        const listEl = backupsPanel.querySelector('#cloudBackupsList');
        listEl.innerHTML = '<div class="p-2 text-sm">Loading…</div>';
        try {
          const list = await listBackups(5);
          if (!list.length) {
            listEl.innerHTML = '<div class="p-2 text-sm text-neutral-500">No backups found</div>';
          } else {
            listEl.innerHTML = list.map(f => {
              const when = new Date(f.modifiedTime).toLocaleString();
              return `
                <div class="cloud-b-item">
                  <div class="min-w-0">
                    <div class="cloud-b-name" title="${f.name}">${f.name}</div>
                    <div class="cloud-b-time">${when}</div>
                  </div>
                  <button class="cloud-b-restore restore-one" data-id="${f.id}">
                    <i class="fa-solid fa-rotate" aria-hidden="true"></i> Restore
                  </button>
                </div>`;
            }).join('');
          }
        } catch (err) {
          listEl.innerHTML = `<div class="p-2 text-sm text-red-600">Error: ${err.message || 'Could not load backups'}</div>`;
        }
        return; // keep menu open
      }

      // Restore a specific backup (delegated)
      const restoreBtn = e.target.closest('.restore-one');
      if (restoreBtn) {
        const id = restoreBtn.getAttribute('data-id');
        await restoreBackup(id);
        showMenu(false);
        return;
      }
    } catch (err) {
      showToast?.(err.message || 'Action failed', 'error');
    }
  });

  // ====== network events ======
  window.addEventListener('online', ()=>{ if (queued && shouldSync()) syncNow().catch(()=>{}); });
  window.addEventListener('focus',  ()=>{ if (shouldSync())          syncNow().catch(()=>{}); });

  // ====== expose API (optional) ======
  window.GDSync = { signIn:()=>ensureToken(true), signOut: revokeToken, isSignedIn:()=>!!accessToken, syncNow, restoreLatest, listBackups };

  // ====== boot ======
  (function boot(){
    try {
      const cached = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null');
      if (cached?.accessToken) { accessToken=cached.accessToken; tokenExpireAt=cached.tokenExpireAt||0; setChip('ok','Signed in'); }
      else setChip('muted','Needs sign-in');
    } catch { setChip('muted','Needs sign-in'); }
    refreshMenuState();
    // Initial sync only if there are deliveries
    if (shouldSync()) { syncNow().catch(()=>{}); }
    try {
      if (!localStorage.getItem(FIRSTLOAD)) { showToast?.('Sign in to enable automatic backups.','warning'); localStorage.setItem(FIRSTLOAD,'1'); }
    } catch {}
  })();

})();
