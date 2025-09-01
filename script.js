// --- Helpers & constants ---
const $ = (id) => document.getElementById(id);
const CAT_KEY = 'bakery-tracker-categories';
const DEFAULT_CATEGORIES = [
    "Doolsho", "Sisin", "Kac Kac", "Ninac Loos", "Kashaato", "Buskut", "Icun", "Shushumoow", "Mix"
];
const fmt = (cents) => {
    const sign = cents < 0 ? '-' : '';
    const abs = Math.abs(cents);
    return `${sign}$${(abs / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const uid = () => Math.random().toString(36).slice(2, 9);
/**
 * Returns today's date in YYYY-MM-DD format using the user's local timezone.
 * Using toISOString() directly uses UTC which can cause an off-by-one day error.
 */
const todayISO = () => {
    const now = new Date();
    // Offset by timezone to get local date without time component
    const tzOffsetMinutes = now.getTimezoneOffset();
    const local = new Date(now.getTime() - tzOffsetMinutes * 60000);
    return local.toISOString().slice(0, 10);
};
const parseCents = (v) => {
    const s = String(v || '').replace(/[^\d.]/g, '');
    if (!s) return 0;
    const n = Math.round(parseFloat(s) * 100);
    return isFinite(n) ? Math.max(0, n) : 0;
};
const fmtDate = (iso) => {
    if (!iso) return '';
    const parts = iso.split('-');
    if (parts.length === 3) {
        const [y, m, d] = parts;
        return `${m.padStart(2, '0')}/${d.padStart(2, '0')}/${y}`;
    }
    const dt = new Date(iso);
    if (isNaN(dt)) return iso;
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    const yyyy = dt.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
};
const loadCategories = () => {
    try {
        const stored = JSON.parse(localStorage.getItem(CAT_KEY) || 'null');
        if (Array.isArray(stored) && stored.length) return stored;
    } catch { }
    return DEFAULT_CATEGORIES.slice();
};
const saveCategories = (arr) => {
    localStorage.setItem(CAT_KEY, JSON.stringify(arr));
};
const legacyToSomali = (cat, list) => {
    const c = String(cat || '').toLowerCase();
    if (c === 'cookies') return 'Buskut';
    if (c === 'cakes') return 'Doolsho';
    if (c === 'bread') return 'Kashaato';
    if (c === 'other' || c === 'others') return 'Mix';
    if (list.includes(cat)) return cat;
    return 'Mix';
};

// ============================== Animation helpers ==============================
/**
 * Animate a numeric value inside an element from a starting value to an ending
 * value over a given duration. Accepts a formatter function to convert the
 * intermediate numeric value into a display string. The element's dataset
 * attribute `value` is used to store the previous numeric value for the next
 * animation. A callback can be provided for when the animation completes.
 *
 * @param {HTMLElement} el Element whose text content will be animated.
 * @param {number} start The starting numeric value.
 * @param {number} end The ending numeric value.
 * @param {number} duration Duration of the animation in milliseconds.
 * @param {function} formatter Function that receives a number and returns a string.
 * @param {function} [callback] Optional callback invoked when animation finishes.
 */
function animateValue(el, start, end, duration, formatter, callback) {
    if (!el) return;
    const startTime = performance.now();
    const diff = end - start;
    const fmtFn = typeof formatter === 'function' ? formatter : (v) => String(v);
    function step(time) {
        const progress = Math.min((time - startTime) / duration, 1);
        const current = start + diff * progress;
        try {
            el.textContent = fmtFn(current);
        } catch {
            el.textContent = String(current);
        }
        if (progress < 1) {
            requestAnimationFrame(step);
        } else if (typeof callback === 'function') {
            callback();
        }
    }
    requestAnimationFrame(step);
}

/**
 * Animate currency values expressed in cents. The element's dataset.value is
 * used to remember the previous end value. The value is expected to be in
 * cents (integer). It uses the fmt() helper for formatting.
 *
 * @param {HTMLElement} el Element to update.
 * @param {number} newCents New value in cents.
 * @param {number} [duration=600] Animation duration in ms.
 */
function animateCurrency(el, newCents, duration = 600) {
    if (!el) return;
    const prev = parseFloat(el.dataset.value || '0');
    const start = isNaN(prev) ? 0 : prev;
    const end = isNaN(newCents) ? 0 : newCents;
    el.dataset.value = String(end);
    animateValue(el, start, end, duration, (v) => fmt(Math.round(v)));
}

/**
 * Animate plain numeric values (e.g. counts). The element's dataset.value is
 * used to remember the previous value. Numbers are rounded to the nearest
 * integer when displayed.
 *
 * @param {HTMLElement} el Element to update.
 * @param {number} newVal New numeric value.
 * @param {number} [duration=600] Animation duration in ms.
 */
function animatePlainNumber(el, newVal, duration = 600) {
    if (!el) return;
    const prev = parseFloat(el.dataset.value || '0');
    const start = isNaN(prev) ? 0 : prev;
    const end = isNaN(newVal) ? 0 : newVal;
    el.dataset.value = String(end);
    animateValue(el, start, end, duration, (v) => {
        return String(Math.round(v));
    });
}

// --- Override totals state & persistence ---
let overrideSumPaidCents = null;
let overrideSumPrevCents = null;
let lastComputedTotals = null;
// --- Cost override (unit cost) state ---
// Stores temporary overrides for unit costs used in the cost calculator. Each key maps
// to a numeric cost value (in dollars) that should override the derived or preset
// cost for that ingredient. Overrides are session-only and are not persisted to
// localStorage. When no override exists for a key, the calculator falls back to
// the latest cost derived from purchases or presets. Keys correspond to
// 'sugar', 'flour', 'milk', 'eggs', 'oil', and 'packaging'.
const overrideUnitCosts = {};
function loadOverrides() {
    try {
        const paid = localStorage.getItem('bakery-tracker-overrideSumPaidCents');
        const prev = localStorage.getItem('bakery-tracker-overrideSumPrevCents');
        overrideSumPaidCents = (paid !== null && paid !== '' && !isNaN(parseInt(paid))) ? parseInt(paid) : null;
        overrideSumPrevCents = (prev !== null && prev !== '' && !isNaN(parseInt(prev))) ? parseInt(prev) : null;
    } catch {
        overrideSumPaidCents = null;
        overrideSumPrevCents = null;
    }
}
function saveOverrides() {
    if (overrideSumPaidCents !== null && !isNaN(overrideSumPaidCents)) {
        localStorage.setItem('bakery-tracker-overrideSumPaidCents', String(overrideSumPaidCents));
    } else {
        localStorage.removeItem('bakery-tracker-overrideSumPaidCents');
    }
    if (overrideSumPrevCents !== null && !isNaN(overrideSumPrevCents)) {
        localStorage.setItem('bakery-tracker-overrideSumPrevCents', String(overrideSumPrevCents));
    } else {
        localStorage.removeItem('bakery-tracker-overrideSumPrevCents');
    }
}

// --- Sorting state ---
// NOTE: Sorting functionality has been removed.

// --- Balance color cue helper ---
function applyBalanceCue(valueCents, numberEl, tagEl) {
    // Reset classes
    numberEl.classList.remove('text-emerald-600', 'text-amber-600', 'text-blue-600');
    tagEl.classList.remove('bg-emerald-100', 'text-emerald-700', 'bg-amber-100', 'text-amber-700', 'bg-blue-100', 'text-blue-700', 'hidden');

    if (valueCents === 0) {
        numberEl.classList.add('text-emerald-600');
        // Use a check icon instead of text for paid off state
        tagEl.innerHTML = '<i class="fa-solid fa-check"></i>';
        tagEl.classList.add('bg-emerald-100', 'text-emerald-700');
    } else if (valueCents > 0) {
        numberEl.classList.add('text-amber-600');
        tagEl.textContent = 'Owed';
        tagEl.classList.add('bg-amber-100', 'text-amber-700');
    } else {
        numberEl.classList.add('text-blue-600');
        tagEl.textContent = 'Overpaid';
        tagEl.classList.add('bg-blue-100', 'text-blue-700');
    }
    tagEl.classList.remove('hidden');
}

// --- State ---
let CATEGORIES = loadCategories();
let rows = [];
// Manual transactions (payments or deductions) stored separately from deliveries
let transactions = [];

// --- Purchases state ---
// Keys for storing purchase-related data in localStorage
const PURCHASE_ITEMS_KEY = 'bakery-tracker-purchase-items';
const PURCHASES_KEY = 'bakery-tracker-purchases';
// Key used to persist purchase saves to localStorage
const PURCHASE_SAVES_KEY = 'bakery-tracker-purchase-saves';
// Default set of purchase items; can be extended by the user
// Extend default purchase items to include Coconut and Sesame. These are used across
// purchases and the cost calculator. Users can add additional items via the UI.
const DEFAULT_PURCHASE_ITEMS = ['Sugar', 'Milk', 'Eggs', 'Flour', 'Oil', 'Packaging', 'Coconut', 'Sesame'];
// Arrays to hold purchase items and purchase entries; loaded during initialization
let purchaseItems = [];
let purchases = [];
// Context for the add-option modal ('category' or 'purchase')
let modalContext = 'category';
// Preset unit costs (in cents) used to pre-fill calculator when no purchase data exists.
const PRESET_COSTS = {
    sugar: 58,      // $0.58 per lb
    flour: 56,      // $0.56 per lb
    milk: 19,       // $0.19 per cup (approx. $3.12 per gallon)
    eggs: 24,       // $0.24 per egg
    oil: 71,        // $0.71 per cup (approx. $3.00 per liter)
    packaging: 5,   // $0.05 per piece
    coconut: 308,   // $3.08 per lb
    sesame: 121     // $1.21 per lb
};

// ============================== Calculator saves state ==============================
// Key used to persist calculator results to localStorage
const CALC_SAVES_KEY = 'bakery-tracker-calc-saves';
// Array of saved calculator results; loaded during initialization
let calcSaves = [];

/**
 * Load saved calculator results from localStorage.
 * @returns {Array} Array of calculator save objects
 */
function loadCalcSaves() {
    try {
        const stored = JSON.parse(localStorage.getItem(CALC_SAVES_KEY) || 'null');
        if (Array.isArray(stored)) {
            // Ensure each saved entry has a deleted flag. Older saves may not have this
            return stored.map((entry) => {
                if (entry && typeof entry === 'object' && entry.deleted === undefined) {
                    entry.deleted = false;
                }
                return entry;
            });
        }
    } catch { /* ignore */ }
    return [];
}

/**
 * Persist calculator results to localStorage.
 * @param {Array} arr Array of save objects
 */
function saveCalcSaves(arr) {
    try {
        localStorage.setItem(CALC_SAVES_KEY, JSON.stringify(arr));
    } catch { /* ignore */ }
}

/**
 * Create a new calculator save entry. Captures current inputs, computed
 * unit costs, and calculated outputs. Adds the new entry to the front of
 * the calcSaves array and persists it. Also refreshes the UI list.
 * @param {string} name Name provided by the user
 */
function createCalcSave(name) {
    // Gather inputs from the calculator fields
    const sugarQty = parseFloat(document.getElementById('calcSugarQty')?.value || '0') || 0;
    const flourQty = parseFloat(document.getElementById('calcFlourQty')?.value || '0') || 0;
    const milkQty = parseFloat(document.getElementById('calcMilkQty')?.value || '0') || 0;
    const eggQty = parseFloat(document.getElementById('calcEggQty')?.value || '0') || 0;
    const oilQty = parseFloat(document.getElementById('calcOilQty')?.value || '0') || 0;
    const coconutQty = parseFloat(document.getElementById('calcCoconutQty')?.value || '0') || 0;
    const sesameQty = parseFloat(document.getElementById('calcSesameQty')?.value || '0') || 0;
    const packagingCost = parseFloat(document.getElementById('calcPackagingCost')?.value || '0') || 0;
    const electricityKwh = parseFloat(document.getElementById('calcElectricityKwh')?.value || '0') || 0;
    const electricityRate = parseFloat(document.getElementById('calcElectricityRate')?.value || '0') || 0;
    const pieces = parseFloat(document.getElementById('calcPieces')?.value || '0') || 0;
    const pricePerPiece = parseFloat(document.getElementById('calcPrice')?.value || '0') || 0;
    // Capture current costs (overrides applied) using computeLatestCosts()
    const costs = computeLatestCosts();
    // Compute outputs consistent with computeCalculator()
    let totalCost = 0;
    totalCost += sugarQty * (costs.sugar || 0);
    totalCost += flourQty * (costs.flour || 0);
    totalCost += milkQty * (costs.milk || 0);
    totalCost += eggQty * (costs.eggs || 0);
    totalCost += oilQty * (costs.oil || 0);
    // Include coconut and sesame in cost calculation
    totalCost += coconutQty * (costs.coconut || 0);
    totalCost += sesameQty * (costs.sesame || 0);
    totalCost += packagingCost * pieces;
    totalCost += electricityKwh * electricityRate;
    const costPerPiece = (pieces > 0) ? (totalCost / pieces) : 0;
    const profitPerPiece = pricePerPiece - costPerPiece;
    const totalProfit = profitPerPiece * pieces;
    const entry = {
        timestamp: new Date().toISOString(),
        name: name || '',
        deleted: false,
        inputs: {
            sugarQty,
            flourQty,
            milkQty,
            eggQty,
            oilQty,
            coconutQty,
            sesameQty,
            packagingCost,
            electricityKwh,
            electricityRate,
            pieces,
            pricePerPiece
        },
        unitCosts: {
            sugar: costs.sugar || 0,
            flour: costs.flour || 0,
            milk: costs.milk || 0,
            eggs: costs.eggs || 0,
            oil: costs.oil || 0,
            coconut: costs.coconut || 0,
            sesame: costs.sesame || 0,
            packaging: costs.packaging || 0
        },
        results: {
            totalCost,
            costPerPiece,
            profitPerPiece,
            totalProfit
        }
    };
    calcSaves.unshift(entry);
    // Limit to the latest 10 saves to avoid clutter
    if (calcSaves.length > 10) calcSaves.pop();
    saveCalcSaves(calcSaves);
    populateCalcSavesSection();
    showToast('Result saved', 'success');
}

/**
 * Populate the Saved Results section with current calculator saves. Both
 * active and deleted saves are displayed in separate tables. Active saves
 * show a summary row with pieces, cost and profit figures along with
 * actions to view details or delete (soft delete). Deleted saves are
 * listed below with actions to restore or permanently delete. When there
 * are no saves at all, the entire section is hidden.
 */
function populateCalcSavesSection() {
    const section = document.getElementById('calcSavesSection');
    const container = document.getElementById('calcSavesContainer');
    if (!section || !container) return;
    if (!Array.isArray(calcSaves) || calcSaves.length === 0) {
        section.classList.add('hidden');
        container.innerHTML = '';
        return;
    }
    section.classList.remove('hidden');
    container.innerHTML = '';
    // Separate active and deleted saves
    const activeSaves = calcSaves.filter(e => !e.deleted);
    const deletedSaves = calcSaves.filter(e => e.deleted);
    // Helper to format results using fmt (expects cents). Results stored are
    // in dollars, so multiply by 100 before formatting.
    const formatDollar = (val) => fmt(Math.round((val || 0) * 100));
    // Render a table for a given list of saves. Returns an element.
    const renderTable = (list, isDeleted) => {
        const tbl = document.createElement('table');
        tbl.className = 'w-full text-sm table-striped';
        const thead = document.createElement('thead');
        const trh = document.createElement('tr');
        trh.className = 'text-left text-neutral-500 border-b';
        // Define column headers
        const headers = [
            'Name / Timestamp',
            'Pieces',
            'Total cost',
            'Cost/piece',
            'Total profit',
            'Actions'
        ];
        headers.forEach((h) => {
            const th = document.createElement('th');
            th.className = 'py-2 pr-3';
            th.textContent = h;
            trh.appendChild(th);
        });
        thead.appendChild(trh);
        tbl.appendChild(thead);
        const tbody = document.createElement('tbody');
        list.forEach((entry, idx) => {
            // Summary row
            const tr = document.createElement('tr');
            tr.className = 'border-t hover:bg-neutral-50 transition-base';
            const dt = new Date(entry.timestamp);
            const dateStr = dt.toLocaleString();
            const prefix = (entry.name && entry.name.trim()) ? entry.name + ' – ' : '';
            const nameCell = document.createElement('td');
            nameCell.className = 'py-2 pr-3';
            nameCell.textContent = prefix + dateStr;
            const piecesCell = document.createElement('td');
            piecesCell.className = 'py-2 pr-3';
            piecesCell.textContent = entry.inputs.pieces;
            const totalCostCell = document.createElement('td');
            totalCostCell.className = 'py-2 pr-3';
            totalCostCell.textContent = formatDollar(entry.results.totalCost);
            const costPerPieceCell = document.createElement('td');
            costPerPieceCell.className = 'py-2 pr-3';
            costPerPieceCell.textContent = formatDollar(entry.results.costPerPiece);
            const totalProfitCell = document.createElement('td');
            totalProfitCell.className = 'py-2 pr-3';
            totalProfitCell.textContent = formatDollar(entry.results.totalProfit);
            // Actions cell
            const actionsCell = document.createElement('td');
            actionsCell.className = 'py-2 pr-3 space-x-2';
            // Details toggle
            const detailsBtn = document.createElement('button');
            detailsBtn.className = 'underline text-emerald-600 hover:text-emerald-800 text-xs';
            detailsBtn.textContent = 'Details';
            // Build action buttons. For active saves, provide a Delete button
            // that marks the entry as deleted. For deleted saves, provide both
            // a Restore button and a Delete Permanently button.
            if (isDeleted) {
                const restoreBtn = document.createElement('button');
                restoreBtn.className = 'underline text-xs text-emerald-600 hover:text-emerald-800';
                restoreBtn.textContent = 'Restore';
                const permBtn = document.createElement('button');
                permBtn.className = 'underline text-xs text-red-600 hover:text-red-800';
                permBtn.textContent = 'Delete permanently';
                actionsCell.appendChild(detailsBtn);
                actionsCell.appendChild(restoreBtn);
                actionsCell.appendChild(permBtn);
                // Restore handler
                restoreBtn.addEventListener('click', (ev) => {
                    ev.preventDefault();
                    // Ensure unique restored name
                    let baseName = entry.name || '';
                    if (!baseName || baseName.trim() === '') {
                        baseName = 'Unnamed';
                    }
                    let newName = baseName;
                    const activeNames = activeSaves.map(e => e.name);
                    if (activeNames.includes(newName)) {
                        let suffix = 1;
                        while (activeNames.includes(`${baseName} (${suffix})`)) suffix++;
                        newName = `${baseName} (${suffix})`;
                    }
                    entry.name = newName;
                    entry.deleted = false;
                    saveCalcSaves(calcSaves);
                    populateCalcSavesSection();
                });
                // Permanent delete handler
                permBtn.addEventListener('click', (ev) => {
                    ev.preventDefault();
                    // Ask for confirmation before deleting
                    showConfirmModal('Are you sure you want to permanently delete this saved result?', () => {
                        const index = calcSaves.indexOf(entry);
                        if (index >= 0) {
                            calcSaves.splice(index, 1);
                            saveCalcSaves(calcSaves);
                            populateCalcSavesSection();
                        }
                    }, 'Delete permanently?');
                });
            } else {
                // Active save: only delete (soft)
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'underline text-xs text-red-600 hover:text-red-800';
                deleteBtn.textContent = 'Delete';
                actionsCell.appendChild(detailsBtn);
                actionsCell.appendChild(deleteBtn);
                deleteBtn.addEventListener('click', (ev) => {
                    ev.preventDefault();
                    entry.deleted = true;
                    saveCalcSaves(calcSaves);
                    populateCalcSavesSection();
                });
            }
            tr.appendChild(nameCell);
            tr.appendChild(piecesCell);
            tr.appendChild(totalCostCell);
            tr.appendChild(costPerPieceCell);
            tr.appendChild(totalProfitCell);
            tr.appendChild(actionsCell);
            // Details row
            const detailTr = document.createElement('tr');
            detailTr.className = 'border-t hidden';
            const detailTd = document.createElement('td');
            detailTd.colSpan = 6;
            detailTd.className = 'py-2 pr-3';
            // Build details content: Inputs, Unit costs, Outputs
            const wrapper = document.createElement('div');
            wrapper.className = 'space-y-3 text-xs';
            // Inputs table
            const inputsDiv = document.createElement('div');
            inputsDiv.innerHTML = '<div class="font-semibold mb-1">Inputs</div>';
            const inTab = document.createElement('table');
            inTab.className = 'w-full';
            const inBody = document.createElement('tbody');
            const addRow = (label, value) => {
                const trr = document.createElement('tr');
                trr.innerHTML = `<td class="pr-2 text-neutral-500">${label}</td><td>${value}</td>`;
                inBody.appendChild(trr);
            };
            addRow('Sugar used', entry.inputs.sugarQty);
            addRow('Flour used', entry.inputs.flourQty);
            addRow('Milk used', entry.inputs.milkQty);
            addRow('Eggs used', entry.inputs.eggQty);
            addRow('Oil used', entry.inputs.oilQty);
            addRow('Coconut used', entry.inputs.coconutQty);
            addRow('Sesame used', entry.inputs.sesameQty);
            addRow('Packaging cost', `$${entry.inputs.packagingCost.toFixed(2)}`);
            addRow('Electricity used (kWh)', entry.inputs.electricityKwh);
            addRow('Rate per kWh', `$${entry.inputs.electricityRate.toFixed(2)}`);
            addRow('Pieces produced', entry.inputs.pieces);
            addRow('Price per piece', `$${entry.inputs.pricePerPiece.toFixed(2)}`);
            inTab.appendChild(inBody);
            inputsDiv.appendChild(inTab);
            wrapper.appendChild(inputsDiv);
            // Unit costs table
            const unitDiv = document.createElement('div');
            unitDiv.innerHTML = '<div class="font-semibold mb-1">Unit costs</div>';
            const unitTab = document.createElement('table');
            unitTab.className = 'w-full';
            const unitBody = document.createElement('tbody');
            const addUnit = (label, value, suffix) => {
                const trr = document.createElement('tr');
                trr.innerHTML = `<td class="pr-2 text-neutral-500">${label}</td><td>$${value.toFixed(2)}${suffix}</td>`;
                unitBody.appendChild(trr);
            };
            addUnit('Sugar', entry.unitCosts.sugar, '/lb');
            addUnit('Flour', entry.unitCosts.flour, '/lb');
            addUnit('Milk', entry.unitCosts.milk, '/cup');
            addUnit('Eggs', entry.unitCosts.eggs, '/egg');
            addUnit('Oil', entry.unitCosts.oil, '/cup');
            addUnit('Coconut', entry.unitCosts.coconut, '/lb');
            addUnit('Sesame', entry.unitCosts.sesame, '/lb');
            addUnit('Packaging', entry.unitCosts.packaging, '/piece');
            unitTab.appendChild(unitBody);
            unitDiv.appendChild(unitTab);
            wrapper.appendChild(unitDiv);
            // Outputs table
            const outDiv = document.createElement('div');
            outDiv.innerHTML = '<div class="font-semibold mb-1">Outputs</div>';
            const outTab = document.createElement('table');
            outTab.className = 'w-full';
            const outBody = document.createElement('tbody');
            const addOut = (label, value) => {
                const trr = document.createElement('tr');
                trr.innerHTML = `<td class="pr-2 text-neutral-500">${label}</td><td>${formatDollar(value)}</td>`;
                outBody.appendChild(trr);
            };
            addOut('Total cost', entry.results.totalCost);
            addOut('Cost per piece', entry.results.costPerPiece);
            addOut('Profit per piece', entry.results.profitPerPiece);
            addOut('Total profit', entry.results.totalProfit);
            outTab.appendChild(outBody);
            outDiv.appendChild(outTab);
            wrapper.appendChild(outDiv);
            detailTd.appendChild(wrapper);
            detailTr.appendChild(detailTd);
            // Append rows to tbody
            tbody.appendChild(tr);
            tbody.appendChild(detailTr);
            // Event handler for the details button to toggle the details row
            detailsBtn.addEventListener('click', (ev) => {
                ev.preventDefault();
                detailTr.classList.toggle('hidden');
            });
        });
        tbl.appendChild(tbody);
        return tbl;
    };
    // Render active saves table
    if (activeSaves.length > 0) {
        const activeHeading = document.createElement('h3');
        activeHeading.className = 'font-medium mb-2';
        activeHeading.textContent = 'Active Saves';
        container.appendChild(activeHeading);
        container.appendChild(renderTable(activeSaves, false));
    }
    // Render deleted saves table
    if (deletedSaves.length > 0) {
        const delHeading = document.createElement('h3');
        delHeading.className = 'font-medium mt-6 mb-2';
        delHeading.textContent = 'Deleted Saves';
        container.appendChild(delHeading);
        // Provide explanatory text for empty states handled via table
        container.appendChild(renderTable(deletedSaves, true));
    }
    // If no active or deleted entries, hide the section
    if (activeSaves.length === 0 && deletedSaves.length === 0) {
        section.classList.add('hidden');
    }
}

/**
 * Map items to allowed purchase units. Keys are lowercased and normalized item names.
 * These rules are used to validate purchases before adding.
 */
const ITEM_ALLOWED_UNITS = {
    sugar: ['lb', 'kg'],
    flour: ['lb', 'kg'],
    milk: ['gallon', 'liter'],
    eggs: ['dozen', 'pack'],
    oil: ['liter', 'gallon'],
    packaging: ['unit']
    ,
    // Allow coconut and sesame purchases in pounds or kilograms. Additional units follow
    // the same pattern as flour and sugar.
    coconut: ['lb', 'kg'],
    sesame: ['lb', 'kg']
};

/**
 * Normalize an item name into a canonical key used throughout the script.
 * Handles pluralization and common variants.
 * @param {string} name Raw item name
 * @returns {string} Normalized key
 */
function normalizeItemName(name) {
    let key = String(name || '').trim().toLowerCase();
    if (!key) return '';
    if (key.startsWith('egg')) key = 'eggs';
    if (key.startsWith('sugar')) key = 'sugar';
    if (key.startsWith('flour')) key = 'flour';
    if (key.startsWith('milk')) key = 'milk';
    if (key.startsWith('oil')) key = 'oil';
    if (key.startsWith('package')) key = 'packaging';
    if (key.startsWith('packaging')) key = 'packaging';
    return key;
}

/**
 * Determine whether a purchase item-unit combination is valid.
 * @param {string} item Item name
 * @param {string} unit Unit name
 * @returns {boolean} True if valid or unknown item, false if invalid
 */
function isUnitValidForItem(item, unit) {
    const key = normalizeItemName(item);
    const allowed = ITEM_ALLOWED_UNITS[key];
    // If item not in map, allow any unit to avoid blocking custom items
    if (!allowed) return true;
    return allowed.includes(unit);
}

/**
 * Show an inline validation error for the purchase unit selector with a shake animation and red border.
 * @param {string} message Error text to display
 */
function showUnitError(message) {
    const unitSelect = document.getElementById('purchaseUnit');
    if (!unitSelect) return;
    // Add red border and shake
    unitSelect.classList.add('border-red-500', 'animate-shake');
    // Find or create the error element within the same parent container
    let err = unitSelect.parentElement.querySelector('.unit-error');
    if (!err) {
        err = document.createElement('div');
        err.className = 'text-xs text-red-600 mt-1 unit-error';
        unitSelect.parentElement.appendChild(err);
    }
    err.textContent = message;
    // Remove shake class after animation completes
    setTimeout(() => unitSelect.classList.remove('animate-shake'), 500);
}

/**
 * Clear any existing validation error on the purchase unit selector.
 */
function clearUnitError() {
    const unitSelect = document.getElementById('purchaseUnit');
    if (!unitSelect) return;
    unitSelect.classList.remove('border-red-500');
    const err = unitSelect.parentElement.querySelector('.unit-error');
    if (err) err.remove();
}

/**
 * Compute the latest unit costs per item from the active purchases data.
 * The most recent purchase (last in array) for each item is used. Falls back to preset costs.
 * @returns {Object} Costs in dollars per base unit, keyed by normalized item name
 */
function computeLatestCosts() {
    const latest = {};
    // Determine latest purchase for each item by iterating purchases in order; last occurrence wins
    for (const p of purchases) {
        const key = normalizeItemName(p.item);
        if (!key) continue;
        latest[key] = p;
    }
    const costs = {};
    // For each known cost key, compute cost per base unit
    const keys = ['sugar', 'flour', 'milk', 'eggs', 'oil', 'packaging', 'coconut', 'sesame'];
    keys.forEach(k => {
        // Apply override if present. Overrides are in dollars. If an override is
        // provided for this cost key, it takes precedence over any computed or
        // preset cost. Otherwise fall back to the latest purchase cost or the
        // preset. Note: overrideUnitCosts values are plain numbers (not cents).
        if (Object.prototype.hasOwnProperty.call(overrideUnitCosts, k) && typeof overrideUnitCosts[k] === 'number' && !isNaN(overrideUnitCosts[k])) {
            costs[k] = overrideUnitCosts[k];
        } else if (latest[k] && typeof latest[k].baseCostCents === 'number' && latest[k].baseCostCents > 0) {
            costs[k] = (latest[k].baseCostCents / 100);
        } else {
            // Use preset cost if no purchase data exists
            const presetCents = PRESET_COSTS[k];
            if (typeof presetCents === 'number') {
                costs[k] = presetCents / 100;
            }
        }
    });
    return costs;
}

/**
 * Update the calculator UI with the latest unit costs.
 * Sets unit labels (e.g. Unit: $0.58/lb) and default values for packaging and electricity rate.
 */
function updateCalculatorDefaults() {
    const costs = computeLatestCosts();
    // Helper to update a unit label element
    function setLabel(labelId, value, suffix) {
        const lbl = document.getElementById(labelId);
        if (!lbl) return;
        if (typeof value === 'number' && !isNaN(value)) {
            lbl.textContent = `Unit: $${value.toFixed(2)}${suffix}`;
        }
    }
    setLabel('calcSugarUnitLabel', costs.sugar, '/lb');
    setLabel('calcFlourUnitLabel', costs.flour, '/lb');
    setLabel('calcMilkUnitLabel', costs.milk, '/cup');
    // Eggs label uses plural id to match dynamic key (calcEggsUnitLabel)
    setLabel('calcEggsUnitLabel', costs.eggs, '/egg');
    setLabel('calcOilUnitLabel', costs.oil, '/cup');
    // New unit labels for coconut and sesame. Default unit is per pound.
    setLabel('calcCoconutUnitLabel', costs.coconut, '/lb');
    setLabel('calcSesameUnitLabel', costs.sesame, '/lb');
    // Packaging cost per piece label
    setLabel('calcPackagingUnitLabel', costs.packaging, '/piece');
    // Update packaging cost input only if user has not entered a value yet
    const packEl = document.getElementById('calcPackagingCost');
    if (packEl && typeof costs.packaging === 'number') {
        const currentVal = parseFloat(packEl.value);
        if (isNaN(currentVal) || currentVal <= 0) {
            packEl.value = costs.packaging.toFixed(2);
        }
    }
    // Prefill electricity rate only if no rate provided
    const elecRateEl = document.getElementById('calcElectricityRate');
    if (elecRateEl) {
        const currentRate = parseFloat(elecRateEl.value);
        if (isNaN(currentRate) || currentRate <= 0) {
            const rate = 0.17;
            elecRateEl.value = rate.toFixed(2);
        }
    }

    // After updating the underlying costs, rebuild the unit cost labels with edit
    // and reset capabilities. This ensures any overrides are reflected and the
    // appropriate UI (edit/reset icons or input fields) is displayed. The
    // implementation of renderUnitCostLabels below will read the latest costs
    // (taking into account overrides) and generate dynamic markup with
    // interactive controls.
    try {
        renderUnitCostLabels();
    } catch (e) {
        // Swallow errors silently to avoid breaking the calculator if the
        // function is not defined yet or fails unexpectedly.
    }
}

/**
 * Render cost labels for the cost calculator with support for temporary unit
 * cost overrides. Each label displays the current cost per unit and
 * provides edit and reset controls. When editing, an input field is shown
 * allowing the user to specify a new cost. Edits apply immediately and are
 * stored in the overrideUnitCosts object. Resets remove the override.
 *
 * The mapping between cost keys and their label elements follows the
 * convention used in index.html (e.g. sugar -> calcSugarUnitLabel). A
 * suffix is appended to clarify units (e.g. '/lb', '/cup').
 */
function renderUnitCostLabels() {
    const suffixMap = {
        sugar: '/lb',
        flour: '/lb',
        milk: '/cup',
        eggs: '/egg',
        oil: '/cup',
        packaging: '/piece',
        // New ingredients use pounds by default
        coconut: '/lb',
        sesame: '/lb'
    };
    // Compute the latest costs (with overrides applied) so we have baseline values
    const costs = computeLatestCosts();
    Object.keys(suffixMap).forEach(key => {
        const id = 'calc' + key.charAt(0).toUpperCase() + key.slice(1) + 'UnitLabel';
        const el = document.getElementById(id);
        if (!el) return;
        const suffix = suffixMap[key];
        // Determine if an override is active for this cost key
        const overrideActive = Object.prototype.hasOwnProperty.call(overrideUnitCosts, key) && typeof overrideUnitCosts[key] === 'number' && !isNaN(overrideUnitCosts[key]);
        // Determine the value to display (override takes precedence)
        const val = overrideActive ? overrideUnitCosts[key] : ((typeof costs[key] === 'number' && !isNaN(costs[key])) ? costs[key] : 0);
        // Determine editing state stored in a data attribute (string)
        const editing = el.dataset.editing === 'true';
        // Clear existing content
        el.innerHTML = '';
        if (!editing) {
            // Display mode: show the unit cost and edit/reset icons
            const span = document.createElement('span');
            span.textContent = `Unit: $${val.toFixed(2)}${suffix}`;
            // Allow clicking the cost text itself to enter editing mode
            span.className = 'cursor-pointer';
            span.title = 'Click to edit';
            span.addEventListener('click', () => {
                el.dataset.editing = 'true';
                renderUnitCostLabels();
            });
            el.appendChild(span);
            // Edit icon to enter editing mode.
            const editIcon = document.createElement('span');
            editIcon.textContent = '✎';
            editIcon.className = 'ml-1 text-neutral-400 cursor-pointer';
            editIcon.title = 'Edit';
            editIcon.addEventListener('click', () => {
                el.dataset.editing = 'true';
                // Re-render this label in editing mode
                renderUnitCostLabels();
            });
            el.appendChild(editIcon);
            // Reset icon to clear override if one is active.
            if (overrideActive) {
                const resetIcon = document.createElement('span');
                resetIcon.textContent = '↺';
                resetIcon.className = 'ml-1 text-neutral-400 cursor-pointer';
                resetIcon.title = 'Reset';
                resetIcon.addEventListener('click', () => {
                    // Remove override and refresh defaults
                    delete overrideUnitCosts[key];
                    el.dataset.editing = 'false';
                    // Updating defaults will call renderUnitCostLabels again
                    updateCalculatorDefaults();
                });
                el.appendChild(resetIcon);
            }
        } else {
            // Editing mode: show an input and a confirm icon
            const input = document.createElement('input');
            input.type = 'number';
            input.step = '0.01';
            input.min = '0';
            input.value = val.toFixed(2);
            input.className = 'border rounded px-1 py-0.5 text-xs w-20';
            el.appendChild(input);
            // Confirm icon to apply the new override
            const confirmIcon = document.createElement('span');
            confirmIcon.textContent = '✔';
            confirmIcon.className = 'ml-1 text-emerald-600 cursor-pointer';
            confirmIcon.title = 'Confirm';
            const finishEdit = () => {
                const num = parseFloat(input.value);
                if (!isNaN(num) && num > 0) {
                    overrideUnitCosts[key] = num;
                } else {
                    delete overrideUnitCosts[key];
                }
                el.dataset.editing = 'false';
                // Refresh defaults and labels
                updateCalculatorDefaults();
            };
            confirmIcon.addEventListener('click', finishEdit);
            input.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter') {
                    ev.preventDefault();
                    finishEdit();
                } else if (ev.key === 'Escape') {
                    ev.preventDefault();
                    el.dataset.editing = 'false';
                    renderUnitCostLabels();
                }
            });
            input.addEventListener('blur', () => {
                // On blur, finish editing and apply override if valid
                finishEdit();
            });
            el.appendChild(confirmIcon);
        }
    });
}

/**
 * Load purchase items from localStorage or return defaults.
 * @returns {string[]} Array of item names
 */
function loadPurchaseItems() {
    try {
        const stored = JSON.parse(localStorage.getItem(PURCHASE_ITEMS_KEY) || 'null');
        if (Array.isArray(stored) && stored.length) return stored;
    } catch { /* ignore */ }
    return DEFAULT_PURCHASE_ITEMS.slice();
}

/**
 * Save purchase items to localStorage.
 * @param {string[]} arr
 */
function savePurchaseItems(arr) {
    try {
        localStorage.setItem(PURCHASE_ITEMS_KEY, JSON.stringify(arr));
    } catch { /* ignore */ }
}

/**
 * Load purchases from localStorage.
 * @returns {Array} Array of purchase objects
 */
function loadPurchases() {
    try {
        const stored = JSON.parse(localStorage.getItem(PURCHASES_KEY) || 'null');
        if (Array.isArray(stored)) return stored;
    } catch { /* ignore */ }
    return [];
}

/**
 * Save purchases to localStorage.
 * @param {Array} arr
 */
function savePurchases(arr) {
    try {
        localStorage.setItem(PURCHASES_KEY, JSON.stringify(arr));
    } catch { /* ignore */ }
}

// Current shop filter (null means all shops)
let currentShopFilter = null;

// Save and undo/import state
// Array of recent saves (loaded from localStorage on init)
let saves = [];
// Array of recent purchase saves (loaded from localStorage on init)
let purchaseSaves = [];

// Context for the save modal. Determines whether the user is saving deliveries
// (default) or purchases. Updated by the save buttons before opening the
// naming modal. Possible values: 'delivery' | 'purchase'.
let saveContext = 'delivery';
// Info for pending undo after deletion (row or transaction)
let undoInfo = null;
let undoTimeoutId = null;
// Info for undoing last import
let lastImportUndo = null;
// Import wizard temporary state
let importData = null;
let importMapping = null;
let importHasHeader = true;

// Badge color mapping (for items/categories)
const BADGE_KEY = 'bakery-tracker-badge-map';
let badgeMap = {};
function loadBadgeMap() {
    try {
        const raw = JSON.parse(localStorage.getItem(BADGE_KEY) || '{}');
        if (raw && typeof raw === 'object') badgeMap = raw;
    } catch {
        badgeMap = {};
    }
}
function saveBadgeMap() {
    try {
        localStorage.setItem(BADGE_KEY, JSON.stringify(badgeMap));
    } catch { }
}
/**
 * Returns a badge CSS class for a given name (item or category). If a class is not assigned yet, assigns the next color.
 * @param {string} name
 */
function getBadgeClass(name) {
    if (!name) return 'badge-color-0';
    if (!badgeMap[name]) {
        // Determine next color index based on existing assignments
        const assigned = Object.values(badgeMap).map(s => {
            const num = parseInt(String(s).replace('badge-color-', ''));
            return isNaN(num) ? -1 : num;
        });
        let idx = 0;
        while (assigned.includes(idx)) idx = (idx + 1) % 10;
        badgeMap[name] = 'badge-color-' + idx;
        saveBadgeMap();
    }
    return badgeMap[name];
}

// Persist transactions to localStorage
function saveTransactions() {
    try {
        localStorage.setItem('bakery-tracker-transactions', JSON.stringify(transactions));
    } catch {
        // ignore persistence errors
    }
}

// --- Sorting & search state ---
// Maintain current sort field and direction; null field means no sorting applied.
let sortField = null;
let sortAsc = true;
// Current text search filter; empty string means no filter.
let searchQuery = '';

// Chart instances (initialized lazily on first render)
let deliveriesChart = null;
let revenueChart = null;

// Load transactions from localStorage
function loadTransactions() {
    try {
        const raw = JSON.parse(localStorage.getItem('bakery-tracker-transactions') || '[]');
        if (Array.isArray(raw)) {
            transactions = raw.map(t => {
                const amt = Number(t.amountCents || 0);
                return {
                    id: t.id || uid(),
                    date: t.date || todayISO(),
                    type: (t.type === 'deduction') ? 'deduction' : 'payment',
                    amountCents: isNaN(amt) ? 0 : amt,
                    notes: t.notes || ''
                };
            });
        }
    } catch {
        transactions = [];
    }
}

function save() { localStorage.setItem('bakery-tracker-rows', JSON.stringify(rows)); }
function load() {
    try {
        const raw = JSON.parse(localStorage.getItem('bakery-tracker-rows') || '[]');
        rows = raw.map(r => {
            const quantity = Number(r.quantity || r.qty || 0);
            const perPieceCents = Number(r.perPieceCents || (quantity ? Math.round((r.priceCents || 0) / quantity) : 0));
            const totalCents = Number(r.totalCents || (quantity * perPieceCents));
            const paidCents = Number(r.paidCents || 0);
            const previousBalanceCents = Number(r.previousBalanceCents || 0);
            const balanceCents = Number(r.balanceCents || (previousBalanceCents + totalCents - paidCents));
            const mappedCat = legacyToSomali(r.category || 'Mix', CATEGORIES);
            // Determine cost and profit. Existing rows may not have these fields.
            const costCents = Number(r.costCents || 0);
            const profitCents = (typeof r.profitCents === 'number') ? Number(r.profitCents) : (quantity * (perPieceCents - costCents));
            return {
                id: r.id || uid(),
                date: r.date || todayISO(),
                shop: r.shop || '',
                deliveredBy: r.deliveredBy || r.deliveryBy || '',
                item: r.item || '',
                category: CATEGORIES.includes(mappedCat) ? mappedCat : 'Mix',
                quantity: quantity || 0,
                perPieceCents,
                costCents,
                totalCents,
                profitCents,
                paidCents,
                previousBalanceCents,
                balanceCents,
                notes: r.notes || ''
            };
        });
    } catch {
        rows = [];
    }
}

// --- Elements ---
const dateEl = $('date');
const shopEl = $('shop');
const deliverByEl = $('deliverBy');
const itemEl = $('item');
const qtyEl = $('qty');
const perPieceEl = $('perPiece');
const paidEl = $('paid');
const notesEl = $('notes');
const previewTotalEl = $('previewTotal');
const previewBalanceEl = $('previewBalance');
const previewBalanceTag = $('previewBalanceTag');
const prevBalanceEl = $('prevBalance');

// Error message elements for Purchases validation
const purchaseItemEl = $('purchaseItem');
const purchaseQtyEl = $('purchaseQty');
const purchasePaidEl = $('purchasePaid');
const errorPurchaseItemEl = $('error-purchaseItem');
const errorPurchaseQtyEl = $('error-purchaseQty');
const errorPurchasePaidEl = $('error-purchasePaid');

// Error message element for transaction amount
const errorTransAmountEl = $('error-transAmount');

// Error message elements for Add Delivery validation
const errorShopEl = $('error-shop');
const errorItemEl = $('error-item');
const errorQtyEl = $('error-qty');
const errorPerPieceEl = $('error-perPiece');

const sumValue = $('sumValue');
const sumPaid = $('sumPaid');
const sumPrev = $('sumPrev');
const sumRemaining = $('sumRemaining');
const sumRemainingTag = $('sumRemainingTag');
const sumPieces = $('sumPieces');
// New elements for profit tracking
const costEl = $('cost');
const previewProfitEl = $('previewProfit');
const sumProfit = $('sumProfit');
// Search input for filtering deliveries
const searchInput = $('searchInput');
// Element for item breakdown (formerly catBreakdown)
const itemBreakdown = $('itemBreakdown');

// Elements related to the transactions card
const transactionsTotalsEl = $('transactionsTotals');
const transactionsListEl = $('transactionsList');
const addTransactionBtn = $('addTransactionBtn');
const addTransactionPanel = $('addTransactionPanel');
const transDateEl = $('transDate');
const transTypeEl = $('transType');
const transAmountEl = $('transAmount');
const transNotesEl = $('transNotes');
const saveTransBtn = $('saveTransBtn');
const cancelTransBtn = $('cancelTransBtn');

const rowsBody = $('rowsBody');
const emptyRow = $('emptyRow');
const manageListBtn = $('manageList');

// Dark mode toggle using icon span inside button
const darkToggleBtn = document.getElementById('darkToggle');
const darkKnob = document.getElementById('darkKnob');
const rootEl = document.documentElement;
function updateDarkKnob() {
    if (!darkKnob) return;
    // Reset any inline left style so CSS can take over based on theme
    darkKnob.style.left = '';
}
// Initialize theme from storage
(function () {
    const stored = localStorage.getItem('bakery-tracker-theme');
    if (stored === 'dark') {
        rootEl.classList.add('dark');
    } else {
        rootEl.classList.remove('dark');
    }
    updateDarkKnob();
})();

// ================================ Purchases Log & Cost Calculator ================================

/**
 * Populate the purchase item dropdown with available purchase items.
 */
function populatePurchaseOptions() {
    const sel = document.getElementById('purchaseItem');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '';
    const sorted = [...purchaseItems].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    sorted.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        sel.appendChild(opt);
    });
    if (current && sorted.includes(current)) {
        sel.value = current;
    }
}

/**
 * Compute base quantity, unit and cost per unit for a purchase.
 * Also returns a human-friendly cost string for display.
 * @param {string} item The item name.
 * @param {number} quantity The quantity purchased.
 * @param {string} unit The purchase unit (lb, kg, gallon, liter, dozen, unit, pack).
 * @param {number} totalCents The total paid in cents.
 * @returns {Object} { baseQuantity, baseUnit, baseCostCents, costString }
 */
function computeBaseForPurchase(item, quantity, unit, totalCents) {
    const itemKey = String(item || '').toLowerCase();
    const qty = Number(quantity) || 0;
    if (qty <= 0 || totalCents <= 0) {
        return { baseQuantity: 0, baseUnit: '', baseCostCents: 0, costString: '' };
    }
    let baseQuantity = 0;
    let baseUnit = '';
    let costPerUnitCents = 0;
    let costString = '';
    if (itemKey === 'sugar' || itemKey === 'flour') {
        // Convert to pounds
        let lbs = qty;
        if (unit === 'kg') {
            lbs = qty * 2.20462;
        } else if (unit === 'lb') {
            lbs = qty;
        }
        baseQuantity = lbs;
        baseUnit = 'lb';
        costPerUnitCents = Math.round(totalCents / baseQuantity);
        costString = `${fmt(costPerUnitCents)}/lb`;
    } else if (itemKey === 'milk') {
        // Milk: base cost per cup and per gallon
        let cups = 0;
        if (unit === 'gallon') {
            cups = qty * 16;
        } else if (unit === 'liter') {
            cups = qty * (1000 / 236.588);
        } else {
            cups = qty;
        }
        baseQuantity = cups;
        baseUnit = 'cup';
        costPerUnitCents = Math.round(totalCents / baseQuantity);
        const gallons = cups / 16;
        const costPerGallonCents = gallons > 0 ? Math.round(totalCents / gallons) : 0;
        costString = `${fmt(costPerUnitCents)}/cup (${fmt(costPerGallonCents)}/gal)`;
    } else if (itemKey === 'eggs' || itemKey === 'egg') {
        // Eggs: base per egg
        let eggs = qty;
        if (unit === 'dozen') {
            eggs = qty * 12;
        } else if (unit === 'pack') {
            eggs = qty * 60;
        }
        baseQuantity = eggs;
        baseUnit = 'egg';
        costPerUnitCents = Math.round(totalCents / baseQuantity);
        costString = `${fmt(costPerUnitCents)}/egg`;
    } else if (itemKey === 'oil') {
        // Oil: cost per cup and per liter
        let cups = 0;
        if (unit === 'gallon') {
            cups = qty * 16;
        } else if (unit === 'liter') {
            cups = qty * (1000 / 236.588);
        } else {
            cups = qty;
        }
        baseQuantity = cups;
        baseUnit = 'cup';
        costPerUnitCents = Math.round(totalCents / baseQuantity);
        const liters = cups * 236.588 / 1000;
        const costPerLiterCents = liters > 0 ? Math.round(totalCents / liters) : 0;
        costString = `${fmt(costPerUnitCents)}/cup (${fmt(costPerLiterCents)}/L)`;
    } else {
        // Default: base per unit (piece) for packaging or unknown items
        baseQuantity = qty;
        baseUnit = 'unit';
        costPerUnitCents = Math.round(totalCents / baseQuantity);
        costString = `${fmt(costPerUnitCents)}/${baseUnit}`;
    }
    return { baseQuantity, baseUnit, baseCostCents: costPerUnitCents, costString };
}

/**
 * Render the purchases table and summary chips.
 * Also attaches delete handlers for each row.
 */
function renderPurchases() {
    const tbody = document.getElementById('purchasesTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    // Apply global search filter (navbar) when present
    let list = purchases.slice();
    if (searchQuery && searchQuery.trim() !== '') {
        const q = searchQuery.trim().toLowerCase();
        list = list.filter((p) => {
            const fields = [fmtDate(p.date), p.item, p.unit, p.costString];
            for (const f of fields) {
                if (f && String(f).toLowerCase().includes(q)) return true;
            }
            if (String(p.qty || '').toLowerCase().includes(q)) return true;
            if (String((p.totalPaidCents || 0) / 100).toLowerCase().includes(q)) return true;
            return false;
        });
    }

    list.forEach((p, idx) => {
        // Derive unit price if not present (price per purchase unit).
        let unitPriceCents;
        if (typeof p.unitPriceCents === 'number' && !isNaN(p.unitPriceCents)) {
            unitPriceCents = p.unitPriceCents;
        } else {
            unitPriceCents = (p.totalPaidCents && p.qty > 0) ? Math.round(p.totalPaidCents / p.qty) : 0;
            // Persist derived unit price for backward compatibility
            p.unitPriceCents = unitPriceCents;
            // Save back into purchases array to update localStorage later
            purchases[idx] = p;
        }
        // Create table row; include unit price column
        const tr = document.createElement('tr');
        tr.dataset.pid = p.id;
        tr.innerHTML =
            `<td class="py-2 px-3 editable-purchase" data-field="date">${fmtDate(p.date)}</td>` +
            `<td class="py-2 px-3 editable-purchase" data-field="item">${p.item}</td>` +
            `<td class="py-2 px-3 text-right editable-purchase" data-field="qty">${p.qty}</td>` +
            `<td class="py-2 px-3 editable-purchase" data-field="unit">${p.unit}</td>` +
            `<td class="py-2 px-3 text-right">${fmt(unitPriceCents)}</td>` +
            `<td class="py-2 px-3 text-right editable-purchase" data-field="totalPaid">${fmt(p.totalPaidCents)}</td>` +
            `<td class="py-2 px-3">${p.costString}</td>` +
            `<td class="py-2 px-3 print-hide"><button class="text-red-600 hover:underline" data-pid="${p.id}">Delete</button></td>`;
        tbody.appendChild(tr);
    });
    // Persist any updated unitPriceCents values
    savePurchases(purchases);
    // Attach delete handlers
    tbody.querySelectorAll('button[data-pid]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-pid');
            if (!id) return;
            // Ask for confirmation before deleting a purchase
            showConfirmModal('Are you sure you want to delete this purchase?', () => {
                deletePurchase(id);
            }, 'Delete Purchase', 'danger');
        });
    });
}

/**
 * Delete a purchase by id with undo support.
 * @param {string} id Purchase id.
 */
function deletePurchase(id) {
    const idx = purchases.findIndex(p => p.id === id);
    if (idx === -1) return;
    const removed = purchases.splice(idx, 1)[0];
    savePurchases(purchases);
    renderPurchases();
    updateCalculatorDefaults();
    showUndoToast('Purchase deleted', () => {
        if (removed) {
            purchases.splice(idx, 0, removed);
            savePurchases(purchases);
            renderPurchases();
            updateCalculatorDefaults();
        }
    });
}

/**
 * Add a purchase entry from the form inputs.
 */
function addPurchase() {
    const dateEl = document.getElementById('purchaseDate');
    const itemElP = document.getElementById('purchaseItem');
    const qtyEl = document.getElementById('purchaseQty');
    const unitEl = document.getElementById('purchaseUnit');
    const paidEl = document.getElementById('purchasePaid');
    if (!itemElP || !qtyEl || !unitEl || !paidEl) return;
    const item = (itemElP.value || '').trim();
    const qty = parseFloat(qtyEl.value || '0');
    const unit = unitEl.value || '';
    const totalPaid = parseFloat(paidEl.value || '0');
    // Validate fields using inline validation. If invalid, abort without adding.
    if (!validatePurchaseInputs()) {
        return;
    }
    // Validate unit compatibility with item
    // If invalid, show inline error and abort
    if (!isUnitValidForItem(item, unit)) {
        showUnitError(`Invalid unit: ${item} cannot be measured in ${unit}`);
        return;
    }
    // Clear any previous error if valid
    clearUnitError();
    const totalCents = Math.round(totalPaid * 100);
    const { baseQuantity, baseUnit, baseCostCents, costString } = computeBaseForPurchase(item, qty, unit, totalCents);
    // Compute unit price in cents (price per purchase unit), rounding to nearest cent
    const unitPriceCents = (qty > 0) ? Math.round(totalCents / qty) : 0;
    const purchase = {
        id: uid(),
        date: (dateEl && dateEl.value) ? dateEl.value : todayISO(),
        item: item,
        qty: qty,
        unit: unit,
        totalPaidCents: totalCents,
        baseQuantity: baseQuantity,
        baseUnit: baseUnit,
        baseCostCents: baseCostCents,
        costString: costString,
        unitPriceCents: unitPriceCents
    };
    purchases.push(purchase);
    savePurchases(purchases);
    renderPurchases();
    updateCalculatorDefaults();
    // Clear quantity and paid fields for convenience
    qtyEl.value = '';
    paidEl.value = '';
    showToast('Purchase added', 'success');
}

/**
 * Compute weighted average cost per base unit for each item.
 * Returns an object mapping lowercased item names to average cost in cents.
 */

/**
 * Compute cost breakdown and profit per piece in the calculator.
 */
// Debounce flag to prevent double-clicks
let _calcBusy = false;

function computeCalculator() {
    if (_calcBusy) return;
    _calcBusy = true;
    setTimeout(() => { _calcBusy = false; }, 150);

    // Use latest costs derived from purchases or presets
    const costs = computeLatestCosts();

    const sugarQty = parseFloat(document.getElementById('calcSugarQty')?.value || '0') || 0;
    const flourQty = parseFloat(document.getElementById('calcFlourQty')?.value || '0') || 0;
    const milkQty = parseFloat(document.getElementById('calcMilkQty')?.value || '0') || 0;
    const eggQty = parseFloat(document.getElementById('calcEggQty')?.value || '0') || 0;
    const oilQty = parseFloat(document.getElementById('calcOilQty')?.value || '0') || 0;
    const coconutQty = parseFloat(document.getElementById('calcCoconutQty')?.value || '0') || 0;
    const sesameQty = parseFloat(document.getElementById('calcSesameQty')?.value || '0') || 0;
    const packagingCost = parseFloat(document.getElementById('calcPackagingCost')?.value || '0') || 0;
    const electricityKwh = parseFloat(document.getElementById('calcElectricityKwh')?.value || '0') || 0;
    const electricityRate = parseFloat(document.getElementById('calcElectricityRate')?.value || '0') || 0;
    const pieces = parseFloat(document.getElementById('calcPieces')?.value || '0') || 0;
    const pricePerPiece = parseFloat(document.getElementById('calcPrice')?.value || '0') || 0;

    const totalCostEl = document.getElementById('calcTotalCost');
    const costPerPieceEl = document.getElementById('calcCostPerPiece');
    const profitPerPieceEl = document.getElementById('calcProfitPerPiece');
    const totalProfitEl = document.getElementById('calcTotalProfit');
    const calcBtn = document.getElementById('calcComputeBtn');

    // If ALL inputs are zero/empty → tooltip above Calculate and exit
    const allZero =
        sugarQty === 0 && flourQty === 0 && milkQty === 0 && eggQty === 0 && oilQty === 0 &&
        coconutQty === 0 && sesameQty === 0 && packagingCost === 0 &&
        electricityKwh === 0 && electricityRate === 0 && pieces === 0 && pricePerPiece === 0;

    if (allZero) {
        if (calcBtn && typeof showButtonTooltip === 'function') {
            showButtonTooltip(calcBtn, 'Enter at least one input to calculate.');
        }
        if (totalCostEl) { totalCostEl.textContent = '—'; totalCostEl.dataset.value = '0'; }
        if (costPerPieceEl) { costPerPieceEl.textContent = '—'; costPerPieceEl.dataset.value = '0'; }
        if (profitPerPieceEl) {
            profitPerPieceEl.textContent = '—'; profitPerPieceEl.dataset.value = '0';
            profitPerPieceEl.classList.remove('text-emerald-600', 'text-red-600');
        }
        if (totalProfitEl) {
            totalProfitEl.textContent = '—'; totalProfitEl.dataset.value = '0';
            totalProfitEl.classList.remove('text-emerald-600', 'text-red-600');
        }
        return;
    }

    // If pieces not provided (> 0) → tooltip above Calculate and exit
    if (!(pieces > 0)) {
        if (calcBtn && typeof showButtonTooltip === 'function') {
            showButtonTooltip(calcBtn, 'Please enter pieces produced');
        }
        if (totalCostEl) { totalCostEl.textContent = '—'; totalCostEl.dataset.value = '0'; }
        if (costPerPieceEl) { costPerPieceEl.textContent = '—'; costPerPieceEl.dataset.value = '0'; }
        if (profitPerPieceEl) {
            profitPerPieceEl.textContent = '—'; profitPerPieceEl.dataset.value = '0';
            profitPerPieceEl.classList.remove('text-emerald-600', 'text-red-600');
        }
        if (totalProfitEl) {
            totalProfitEl.textContent = '—'; totalProfitEl.dataset.value = '0';
            totalProfitEl.classList.remove('text-emerald-600', 'text-red-600');
        }
        return;
    }

    // Compute totals
    let totalCost = 0;
    totalCost += sugarQty * (costs.sugar || 0);
    totalCost += flourQty * (costs.flour || 0);
    totalCost += milkQty * (costs.milk || 0);
    totalCost += eggQty * (costs.eggs || 0);
    totalCost += oilQty * (costs.oil || 0);
    totalCost += coconutQty * (costs.coconut || 0);
    totalCost += sesameQty * (costs.sesame || 0);
    totalCost += packagingCost * pieces;
    totalCost += electricityKwh * electricityRate;

    const costPerPiece = totalCost / pieces;
    const profitPerPiece = pricePerPiece - costPerPiece;
    const totalProfit = profitPerPiece * pieces;

    // Animate & set dataset values so Save can reliably detect results
    if (totalCostEl) {
        const cents = Math.round(totalCost * 100);
        animateCurrency(totalCostEl, cents);
        totalCostEl.dataset.value = String(cents);
    }
    if (costPerPieceEl) {
        const cents = Math.round(costPerPiece * 100);
        animateCurrency(costPerPieceEl, cents);
        costPerPieceEl.dataset.value = String(cents);
    }
    if (profitPerPieceEl) {
        const cents = Math.round(profitPerPiece * 100);
        animateCurrency(profitPerPieceEl, cents);
        profitPerPieceEl.dataset.value = String(cents);
        profitPerPieceEl.classList.remove('text-emerald-600', 'text-red-600');
        if (profitPerPiece > 0) profitPerPieceEl.classList.add('text-emerald-600');
        else if (profitPerPiece < 0) profitPerPieceEl.classList.add('text-red-600');
    }
    if (totalProfitEl) {
        const cents = Math.round(totalProfit * 100);
        animateCurrency(totalProfitEl, cents);
        totalProfitEl.dataset.value = String(cents);
        totalProfitEl.classList.remove('text-emerald-600', 'text-red-600');
        if (totalProfit > 0) totalProfitEl.classList.add('text-emerald-600');
        else if (totalProfit < 0) totalProfitEl.classList.add('text-red-600');
    }
}

/**
 * Export purchases to a CSV file.
 */
function exportPurchasesCsv() {
    if (!purchases || purchases.length === 0) {
        showToast('No purchases to export', 'warning');
        return;
    }
    const headers = ['Date', 'Item', 'Qty', 'Unit', 'Unit Price', 'Total Paid', 'Derived Cost'];
    const lines = purchases.map(p => {
        const row = [
            fmtDate(p.date),
            p.item,
            p.qty,
            p.unit,
            (p.unitPriceCents / 100).toFixed(2),
            (p.totalPaidCents / 100).toFixed(2),
            p.costString.replace(/,/g, ';')
        ];
        return row.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',');
    });
    const csv = [headers.map(h => '"' + h.replace(/"/g, '""') + '"').join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bakery-purchases-${todayISO()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

/**
 * Export purchases to an Excel file (.xls) by constructing an HTML table.
 */
function exportPurchasesExcel() {
    if (!purchases || purchases.length === 0) {
        showToast('No purchases to export', 'warning');
        return;
    }
    const headers = ['Date', 'Item', 'Qty', 'Unit', 'Unit Price', 'Total Paid', 'Derived Cost'];
    let bodyHtml = '';
    purchases.forEach(p => {
        const row = [
            fmtDate(p.date),
            p.item,
            p.qty,
            p.unit,
            (p.unitPriceCents / 100).toFixed(2),
            (p.totalPaidCents / 100).toFixed(2),
            p.costString
        ];
        bodyHtml += '<tr>' + row.map(val => `<td style="border:1px solid #ccc;padding:4px;">${val}</td>`).join('') + '</tr>';
    });
    const headerHtml = '<tr>' + headers.map(h => `<th style="border:1px solid #ccc;padding:4px;background:#f3f4f6;">${h}</th>`).join('') + '</tr>';
    const tableHtml = `<table>${headerHtml}${bodyHtml}</table>`;
    const blob = new Blob(['\ufeff' + tableHtml], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bakery-purchases-${todayISO()}.xls`;
    a.click();
    URL.revokeObjectURL(url);
}

/**
 * Show one of the main sections (delivery, purchases, calculator) and update nav styling.
 * @param {string} sectionId Section id to show.
 */
function showSection(sectionId) {
    // Toggle visibility of the two main sections (delivery and purchases)
    const delivery = document.getElementById('deliverySection');
    const purchasesSec = document.getElementById('purchasesSection');
    const btnDelivery = document.getElementById('navDelivery');
    const btnPurchases = document.getElementById('navPurchases');
    if (delivery) delivery.classList.toggle('hidden', sectionId !== 'deliverySection');
    if (purchasesSec) purchasesSec.classList.toggle('hidden', sectionId !== 'purchasesSection');
    function activate(btn, active) {
        if (!btn) return;
        // reset styling
        btn.classList.remove('bg-neutral-200', 'text-neutral-900');
        if (active) {
            btn.classList.add('bg-neutral-200', 'text-neutral-900');
        }
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
        // underline indicator
        btn.classList.toggle('nav-tab--active', !!active);
    }
    activate(btnDelivery, sectionId === 'deliverySection');
    activate(btnPurchases, sectionId === 'purchasesSection');
}

/**
 * Initialize purchase and calculator functionality: load data, render UI, attach events.
 */
(function initPurchaseAndCalculator() {
    try {
        purchaseItems = loadPurchaseItems();
        purchases = loadPurchases();
    } catch (e) {
        purchaseItems = DEFAULT_PURCHASE_ITEMS.slice();
        purchases = [];
    }
    // Load purchase saves for the purchases save panel
    loadPurchaseSaves();
    populatePurchaseOptions();
    renderPurchases();
    updateCalculatorDefaults();

    // Attach inline edit handler for the purchases table. We attach this once
    // after the table is initially rendered. Clicks on any cell with the
    // 'editable-purchase' class will trigger an inline editor appropriate to
    // the field. Editing updates the underlying purchases array and
    // re-renders the table and recalculator defaults. To avoid adding
    // duplicate event listeners on subsequent renders, this listener is only
    // registered once during initialization.
    const purchasesBody = document.getElementById('purchasesTableBody');
    if (purchasesBody && !purchasesBody.dataset.hasEditorHandler) {
        purchasesBody.dataset.hasEditorHandler = 'true';
        purchasesBody.addEventListener('click', (ev) => {
            const td = ev.target.closest('td.editable-purchase');
            if (!td) return;
            startPurchaseEdit(td);
        });
    }

    // Set default date on purchases form to today if empty
    const purchaseDateEl = document.getElementById('purchaseDate');
    if (purchaseDateEl && !purchaseDateEl.value) {
        purchaseDateEl.value = todayISO();
    }
    const navDeliveryEl = document.getElementById('navDelivery');
    const navPurchasesEl = document.getElementById('navPurchases');
    if (navDeliveryEl) navDeliveryEl.addEventListener('click', () => showSection('deliverySection'));
    if (navPurchasesEl) navPurchasesEl.addEventListener('click', () => showSection('purchasesSection'));
    const addPurchaseBtn = document.getElementById('addPurchaseBtn');
    if (addPurchaseBtn) addPurchaseBtn.addEventListener('click', addPurchase);
    // Clear unit validation error when the unit selector or item selector changes
    const purchaseUnitEl = document.getElementById('purchaseUnit');
    if (purchaseUnitEl) {
        purchaseUnitEl.addEventListener('change', () => {
            clearUnitError();
        });
    }
    const purchaseItemEl = document.getElementById('purchaseItem');
    if (purchaseItemEl) {
        purchaseItemEl.addEventListener('change', () => {
            clearUnitError();
        });
    }
    // Attach purchases action buttons (export, print, import, saves, clear)
    const exportCsvBtn = document.getElementById('exportPurchasesCsvBtn');
    if (exportCsvBtn) exportCsvBtn.addEventListener('click', exportPurchasesCsv);
    const exportExcelBtn = document.getElementById('exportPurchasesExcelBtn');
    if (exportExcelBtn) exportExcelBtn.addEventListener('click', exportPurchasesExcel);
    const printPurchasesBtn = document.getElementById('printPurchasesBtn');
    if (printPurchasesBtn) printPurchasesBtn.addEventListener('click', () => { window.print(); });
    const importPurchasesBtn = document.getElementById('importPurchasesBtn');
    if (importPurchasesBtn) importPurchasesBtn.addEventListener('click', () => {
        if (typeof openImportModal === 'function') {
            openImportModal();
        } else {
            showAlertModal('Import not available for purchases yet.', 'Import');
        }
    });
    const savePurchasesBtn = document.getElementById('savePurchasesBtn');
    if (savePurchasesBtn) {
        savePurchasesBtn.addEventListener('click', () => {
            const panel = document.getElementById('purchaseSavePanel');
            if (!panel) return;
            // Toggle the purchase-specific saves panel and ensure deliveries panel is closed
            const deliveryPanel = document.getElementById('savePanel');
            if (deliveryPanel && !deliveryPanel.classList.contains('hidden')) {
                deliveryPanel.classList.add('hidden');
            }
            if (panel.classList.contains('hidden')) {
                loadPurchaseSaves();
                populatePurchaseSavePanel();
                panel.classList.remove('hidden');
            } else {
                panel.classList.add('hidden');
            }
        });
    }
    const clearPurchasesBtn = document.getElementById('clearPurchasesBtn');
    if (clearPurchasesBtn) {
        clearPurchasesBtn.addEventListener('click', () => {
            if (!purchases || purchases.length === 0) {
                showToast('No purchases to clear', 'warning');
                return;
            }
            showConfirmModal('This will remove every row from the Purchases table. Deliveries and transactions are not affected. This action cannot be undone.', () => {
                purchases.splice(0, purchases.length);
                savePurchases(purchases);
                renderPurchases();
                updateCalculatorDefaults();
                showToast('All purchases cleared', 'success');
            }, 'Clear all purchases?', 'danger');
        });
    }
    const calcBtn = document.getElementById('calcComputeBtn');
    if (calcBtn) calcBtn.addEventListener('click', computeCalculator);

    // Hook up Save button for the cost calculator. This button opens a modal
    // allowing the user to select which item/category the result should be
    // saved under. If there are no calculated results (e.g. pieces is zero
    // or cost has not been computed), an inline error is shown instead.
    const calcSaveBtn = document.getElementById('calcSaveBtn');
    if (calcSaveBtn) {
        calcSaveBtn.addEventListener('click', () => {
            const errEl = document.getElementById('calcSaveError');
            if (errEl) errEl.classList.add('hidden'); // tooltips handle error UX

            const piecesVal = parseFloat(document.getElementById('calcPieces')?.value || '0') || 0;
            const totalCostEl = document.getElementById('calcTotalCost');
            const totalCents = totalCostEl ? parseFloat(totalCostEl.dataset.value || '0') : 0;

            // If no results to save → tooltip above Save and exit
            if (!(piecesVal > 0) || !totalCostEl || !(totalCents > 0)) {
                if (typeof showButtonTooltip === 'function') {
                    showButtonTooltip(calcSaveBtn, 'No results to save. Please calculate first.');
                }
                return;
            }

            // Populate the item/category select with options sorted
            const sel = document.getElementById('calcSaveItemSelect');
            if (sel) {
                sel.innerHTML = '';
                const cats = loadCategories();
                cats.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
                cats.forEach((name) => {
                    const opt = document.createElement('option');
                    opt.value = name;
                    opt.textContent = name;
                    sel.appendChild(opt);
                });
            }
            // Show the save modal
            const backdrop = document.getElementById('calcSaveItemBackdrop');
            if (backdrop) backdrop.classList.remove('hidden');
        });
    }

    // Setup actions for the save modal: cancel, save, and add new item
    const calcSaveItemCancel = document.getElementById('calcSaveItemCancel');
    if (calcSaveItemCancel) {
        calcSaveItemCancel.addEventListener('click', () => {
            const back = document.getElementById('calcSaveItemBackdrop');
            if (back) back.classList.add('hidden');
        });
    }
    const calcSaveItemSave = document.getElementById('calcSaveItemSave');
    if (calcSaveItemSave) {
        calcSaveItemSave.addEventListener('click', () => {
            const sel = document.getElementById('calcSaveItemSelect');
            const name = sel ? (sel.value || '') : '';
            // Create the save entry using the selected category/item
            createCalcSave(name);
            const back = document.getElementById('calcSaveItemBackdrop');
            if (back) back.classList.add('hidden');
        });
    }
    const calcAddItemBtn = document.getElementById('calcAddItemBtn');
    if (calcAddItemBtn) {
        calcAddItemBtn.addEventListener('click', () => {
            // Close the save modal
            const back = document.getElementById('calcSaveItemBackdrop');
            if (back) back.classList.add('hidden');
            // Trigger the existing category addition modal used for delivery
            // categories. Set the modal context and open the modal.
            if (!modalBackdrop || !modalInput || !modalSave || !modalCancel) return;
            modalContext = 'category';
            modalTitle.textContent = 'Add option';
            modalInput.value = '';
            modalError.classList.add('hidden');
            modalBackdrop.classList.remove('hidden');
            setTimeout(() => { modalInput.focus(); }, 10);
        });
    }
    const managePurchaseListBtn = document.getElementById('managePurchaseListBtn');
    if (managePurchaseListBtn) {
        managePurchaseListBtn.addEventListener('click', () => {
            modalContext = 'purchase';
            if (!modalBackdrop || !modalInput || !modalSave || !modalCancel) return;
            modalTitle.textContent = 'Add item';
            modalInput.value = '';
            modalError.classList.add('hidden');
            modalBackdrop.classList.remove('hidden');
            setTimeout(() => { modalInput.focus(); }, 10);
        });
    }
    showSection('deliverySection');
})();
if (darkToggleBtn) {
    darkToggleBtn.addEventListener('click', () => {
        const isDark = rootEl.classList.contains('dark');
        const newTheme = isDark ? 'light' : 'dark';
        if (newTheme === 'dark') {
            rootEl.classList.add('dark');
        } else {
            rootEl.classList.remove('dark');
        }
        localStorage.setItem('bakery-tracker-theme', newTheme);
        updateDarkKnob();
    });
}

// -----------------------------------------------------------------------------
// Generic modal helpers
// These functions replace default browser alert/confirm popups with modern
// modals defined in index.html. They support displaying messages and
// executing callbacks on confirmation.
const alertBackdrop = document.getElementById('alertModalBackdrop');
const alertTitleEl = document.getElementById('alertModalTitle');
const alertMsgEl = document.getElementById('alertModalMessage');
const alertOkBtn = document.getElementById('alertModalOk');
const confirmBackdrop = document.getElementById('confirmModalBackdrop');
const confirmTitleEl = document.getElementById('confirmModalTitle');
const confirmMsgEl = document.getElementById('confirmModalMessage');
const confirmCancelBtn = document.getElementById('confirmModalCancel');
const confirmConfirmBtn = document.getElementById('confirmModalConfirm');
// Temporary storage for confirmation callback
let confirmCallbackFn = null;
function hideAlertModal() {
    if (alertBackdrop) alertBackdrop.classList.add('hidden');
}
function hideConfirmModal() {
    if (confirmBackdrop) confirmBackdrop.classList.add('hidden');
    confirmCallbackFn = null;
}
// Expose globally so other functions can invoke these modals
window.showAlertModal = function (message, title = 'Alert') {
    if (!alertBackdrop) return;
    alertTitleEl.textContent = title;
    alertMsgEl.textContent = message;
    alertBackdrop.classList.remove('hidden');
};
window.showConfirmModal = function (message, callback, title = 'Confirm', type = 'danger') {
    if (!confirmBackdrop) return;
    confirmTitleEl.textContent = title;
    confirmMsgEl.textContent = message;
    confirmCallbackFn = typeof callback === 'function' ? callback : null;
    // Configure confirm button styling: danger uses red, default uses green
    if (type === 'danger') {
        confirmConfirmBtn.className = 'px-3 py-1 rounded-md bg-red-600 text-white text-sm hover:bg-red-700 transition-base';
    } else {
        confirmConfirmBtn.className = 'px-3 py-1 rounded-md bg-emerald-600 text-white text-sm hover:bg-emerald-700 transition-base';
    }
    // Always ensure the message and title remain neutral regardless of type. Remove
    // any red-tinted classes previously applied and add neutral classes.
    confirmMsgEl.classList.remove('text-red-700', 'dark:text-red-400');
    confirmTitleEl.classList.remove('text-red-700', 'dark:text-red-400');
    // Also remove any other color overrides so neutral classes take effect
    confirmMsgEl.classList.remove('text-neutral-600', 'dark:text-neutral-400');
    confirmTitleEl.classList.remove('text-neutral-900', 'dark:text-neutral-100');
    confirmMsgEl.classList.add('text-neutral-600', 'dark:text-neutral-400');
    confirmTitleEl.classList.add('text-neutral-900', 'dark:text-neutral-100');
    // Show the modal
    confirmBackdrop.classList.remove('hidden');
};

// Attach event handlers for modal buttons (only set up once)
if (alertOkBtn) {
    alertOkBtn.addEventListener('click', () => {
        hideAlertModal();
    });
}
if (confirmCancelBtn) {
    confirmCancelBtn.addEventListener('click', () => {
        hideConfirmModal();
    });
}
if (confirmConfirmBtn) {
    confirmConfirmBtn.addEventListener('click', () => {
        const callback = confirmCallbackFn;
        hideConfirmModal();
        if (callback) callback();
    });
}

// Build shop filter buttons for filtering deliveries by shop
function buildShopTabs() {
    const container = document.getElementById('shopFilters');
    if (!container) return;
    container.innerHTML = '';
    // Collect unique shop names from rows
    const shops = Array.from(new Set(rows.map(r => r.shop))).filter(s => s && s.trim().length > 0).sort();
    // Add "All" button
    const allBtn = document.createElement('button');
    // Label for the button that shows entries from all shops
    allBtn.textContent = 'All';
    allBtn.className = 'px-3 py-1 rounded-md border text-sm transition-base';
    if (currentShopFilter === null) {
        allBtn.classList.add('bg-emerald-100', 'text-emerald-700');
    } else {
        allBtn.classList.add('hover:bg-neutral-100');
    }
    allBtn.addEventListener('click', () => {
        currentShopFilter = null;
        render();
        buildShopTabs();
    });
    container.appendChild(allBtn);
    // Buttons for each shop
    shops.forEach(shop => {
        const btn = document.createElement('button');
        btn.textContent = shop;
        btn.className = 'px-3 py-1 rounded-md border text-sm transition-base';
        if (currentShopFilter === shop) {
            btn.classList.add('bg-emerald-100', 'text-emerald-700');
        } else {
            btn.classList.add('hover:bg-neutral-100');
        }
        btn.addEventListener('click', () => {
            currentShopFilter = shop;
            render();
            buildShopTabs();
        });
        container.appendChild(btn);
    });
}

/**
 * Populate the shop selection dropdown used to filter deliveries. This
 * replaces the previous tab-based UI. The dropdown always includes an
 * "All Shops" option and then one option per unique shop. If the current
 * filter matches a shop, that option is pre-selected. If no filter is
 * active, the empty value is selected.
 */
function populateShopDropdown() {
    const dropdown = document.getElementById('shopDropdown');
    if (!dropdown) return;
    const prev = dropdown.value;
    // Build list of unique shops
    const shops = Array.from(new Set(rows.map(r => r.shop))).filter(s => s && s.trim().length > 0).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    // Clear existing options
    dropdown.innerHTML = '';
    // All shops option
    const allOpt = document.createElement('option');
    allOpt.value = '';
    allOpt.textContent = 'All Shops';
    dropdown.appendChild(allOpt);
    shops.forEach(shop => {
        const opt = document.createElement('option');
        opt.value = shop;
        opt.textContent = shop;
        dropdown.appendChild(opt);
    });
    // Restore previous selection if still valid
    if (prev && shops.includes(prev)) {
        dropdown.value = prev;
    } else {
        dropdown.value = '';
    }
}

// Inline edit: click any editable table cell to edit in place
rowsBody.addEventListener('click', (e) => {
    const td = e.target.closest('td.editable');
    if (!td) return;
    startEdit(td);
});

// --- Init ---
dateEl.value = todayISO();

// Populate dropdowns from shared list (alphabetical)
function populateOptions() {
    const current = itemEl?.value || ''; // preserve current selection, if any
    itemEl.innerHTML = '';

    // sort case-insensitively
    const sorted = [...CATEGORIES].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: 'base' })
    );

    // render options
    sorted.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        itemEl.appendChild(opt);
    });

    // restore selection if it still exists
    if (current && sorted.includes(current)) {
        itemEl.value = current;
    }
}


populateOptions();
// Load override totals from localStorage
loadOverrides();

// Set up shop dropdown filter
const shopDropdownEl = document.getElementById('shopDropdown');
if (shopDropdownEl) {
    // Populate initial options (in case rows have preloaded shops)
    populateShopDropdown();
    shopDropdownEl.addEventListener('change', (ev) => {
        const val = ev.target.value;
        // Convert empty string to null to match internal filter logic
        currentShopFilter = (val && val.trim().length > 0) ? val : null;
        // Re-render tables based on new filter
        render();
    });
}

// Attach inline editing handler for shop balances table. This handler is
// registered once during initialization and listens for clicks on cells
// marked as editable-balance. When triggered, it opens a numeric editor
// allowing the user to change the aggregate paid or previous balance for a
// given shop.
const shopBalancesBody = document.getElementById('shopBalancesBody');
if (shopBalancesBody && !shopBalancesBody.dataset.hasEditorHandler) {
    shopBalancesBody.dataset.hasEditorHandler = 'true';
    shopBalancesBody.addEventListener('click', (ev) => {
        const td = ev.target.closest('td.editable-balance');
        if (td) {
            startShopBalanceEdit(td);
        }
    });
}
load();
// Load persisted manual transactions
loadTransactions();
// Load badge color mappings
loadBadgeMap();
render();
updatePreview();

// Manage shared list (adds to both dropdowns & persists) using a modal instead of prompt
const modalBackdrop = document.getElementById('modalBackdrop');
const modalInput = document.getElementById('modalInput');
const modalError = document.getElementById('modalError');
const modalSave = document.getElementById('modalSave');
const modalCancel = document.getElementById('modalCancel');
const modalTitle = document.getElementById('modalTitle');
manageListBtn.addEventListener('click', () => {
    if (!modalBackdrop || !modalInput || !modalSave || !modalCancel) return;
    // Reset modal state
    // Set modal context for category addition
    modalContext = 'category';
    modalTitle.textContent = 'Add option';
    modalInput.value = '';
    modalError.classList.add('hidden');
    modalBackdrop.classList.remove('hidden');
    setTimeout(() => { modalInput.focus(); }, 10);
});
if (modalCancel) {
    modalCancel.addEventListener('click', () => {
        if (modalBackdrop) modalBackdrop.classList.add('hidden');
    });
}
if (modalSave) {
    modalSave.addEventListener('click', () => {
        if (!modalInput) return;
        const name = modalInput.value.trim();
        if (!name) {
            modalError.textContent = 'Please enter a name.';
            modalError.classList.remove('hidden');
            return;
        }
        if (modalContext === 'purchase') {
            // Adding a new purchase item
            if (purchaseItems.includes(name)) {
                modalError.textContent = 'That item already exists.';
                modalError.classList.remove('hidden');
                return;
            }
            purchaseItems.push(name);
            savePurchaseItems(purchaseItems);
            populatePurchaseOptions();
            // Preselect new item in purchase dropdown
            const purchaseItemEl = document.getElementById('purchaseItem');
            if (purchaseItemEl) purchaseItemEl.value = name;
            // Hide modal
            modalBackdrop.classList.add('hidden');
            // Show toast
            showToast('New item added', 'success');
        } else {
            // Adding a new delivery category
            if (CATEGORIES.includes(name)) {
                modalError.textContent = 'That name already exists.';
                modalError.classList.remove('hidden');
                return;
            }
            CATEGORIES.push(name);
            saveCategories(CATEGORIES);
            populateOptions();
            // Preselect new option in delivery select
            if (itemEl) itemEl.value = name;
            // Hide modal
            modalBackdrop.classList.add('hidden');
            // Re-render to update summary (not strictly necessary but safe)
            render();
            // Show toast for new option
            showToast('New option added', 'success');
        }
    });
}

// --- Live preview ---
function updatePreview() {
    const qty = Math.max(0, parseInt(qtyEl.value || '0'));
    const per = parseCents(perPieceEl.value);
    const cost = parseCents(costEl && costEl.value);
    const paid = parseCents(paidEl.value);
    const prevBal = parseCents(prevBalanceEl.value);
    const total = qty * per;
    // Compute profit based on price and cost per piece
    const profit = qty * (per - cost);
    // Current balance includes previous balance
    const balance = prevBal + total - paid;
    // Animate total, balance and profit preview values
    if (qty > 0 && per >= 0) {
        animateCurrency(previewTotalEl, total);
        animateCurrency(previewBalanceEl, balance);
        animateCurrency(previewProfitEl, profit);
    } else {
        // Reset to dash and zero dataset when values are invalid
        previewTotalEl.textContent = '—';
        previewTotalEl.dataset.value = '0';
        previewBalanceEl.textContent = '—';
        previewBalanceEl.dataset.value = '0';
        previewProfitEl.textContent = '—';
        previewProfitEl.dataset.value = '0';
    }
    // Apply visual cues for balance
    if (qty > 0 && per >= 0) {
        applyBalanceCue(balance, previewBalanceEl, previewBalanceTag);
    } else {
        previewBalanceEl.classList.remove('text-emerald-600', 'text-amber-600', 'text-blue-600');
        previewBalanceTag.classList.add('hidden');
    }
    // Color profit preview: green if positive, red if negative, neutral otherwise
    if (qty > 0 && per >= 0) {
        previewProfitEl.classList.remove('text-emerald-600', 'text-red-600');
        if (profit > 0) {
            previewProfitEl.classList.add('text-emerald-600');
        } else if (profit < 0) {
            previewProfitEl.classList.add('text-red-600');
        }
    } else {
        previewProfitEl.classList.remove('text-emerald-600', 'text-red-600');
    }
}
['input', 'change'].forEach(ev => {
    [qtyEl, perPieceEl, costEl, paidEl, prevBalanceEl].forEach(el => {
        if (el) el.addEventListener(ev, updatePreview);
    });
});

// --- Validation helpers for Add Delivery ---
/**
 * Clear the error state of a field and hide its error message.
 * @param {HTMLElement} el The input/select element
 * @param {HTMLElement} errEl The paragraph element for error text
 */
function clearFieldError(el, errEl) {
    if (errEl) {
        errEl.textContent = '';
        errEl.classList.add('hidden');
    }
    if (el) {
        el.classList.remove('invalid-input');
    }
}

/**
 * Mark a field as invalid: set error message, show error element, add invalid border and apply shake.
 * @param {HTMLElement} el The input/select element
 * @param {HTMLElement} errEl The paragraph element for error text
 * @param {string} message Error message to display
 */
function markFieldError(el, errEl, message) {
    if (errEl) {
        errEl.textContent = message;
        errEl.classList.remove('hidden');
    }
    if (el) {
        el.classList.add('invalid-input');
        el.classList.add('shake');
        // Remove shake class after animation completes
        setTimeout(() => {
            el.classList.remove('shake');
        }, 300);
    }
}

/**
 * Validate the Add Delivery form fields. Shows errors inline and returns true if all fields are valid.
 * @returns {boolean}
 */
function validateDeliveryInputs() {
    let isValid = true;
    // Validate shop
    const shopVal = shopEl.value.trim();
    if (!shopVal) {
        markFieldError(shopEl, errorShopEl, 'Please enter the shop name.');
        isValid = false;
    } else {
        clearFieldError(shopEl, errorShopEl);
    }
    // Validate item
    const itemVal = itemEl.value ? itemEl.value.trim() : '';
    if (!itemVal) {
        markFieldError(itemEl, errorItemEl, 'Please select an item.');
        isValid = false;
    } else {
        clearFieldError(itemEl, errorItemEl);
    }
    // Validate quantity (>=1)
    const qtyVal = parseInt(qtyEl.value || '0');
    if (isNaN(qtyVal) || qtyVal <= 0) {
        markFieldError(qtyEl, errorQtyEl, 'Pieces must be at least 1.');
        isValid = false;
    } else {
        clearFieldError(qtyEl, errorQtyEl);
    }
    // Validate price per piece (>0)
    const perVal = parseCents(perPieceEl.value);
    if (!perPieceEl.value || perVal <= 0) {
        markFieldError(perPieceEl, errorPerPieceEl, 'Price per piece must be greater than 0.');
        isValid = false;
    } else {
        clearFieldError(perPieceEl, errorPerPieceEl);
    }
    return isValid;
}

/**
 * Validate the Add Purchase form fields. Displays inline errors and returns
 * true if all fields are valid. Uses the same markFieldError/clearFieldError
 * helpers as delivery validation.
 * @returns {boolean}
 */
function validatePurchaseInputs() {
    let valid = true;
    // Item must be selected
    const itemVal = purchaseItemEl && purchaseItemEl.value ? purchaseItemEl.value.trim() : '';
    if (!itemVal) {
        markFieldError(purchaseItemEl, errorPurchaseItemEl, 'Please select an item.');
        valid = false;
    } else {
        clearFieldError(purchaseItemEl, errorPurchaseItemEl);
    }
    // Quantity must be positive
    const qtyVal = parseFloat(purchaseQtyEl && purchaseQtyEl.value || '0');
    if (isNaN(qtyVal) || qtyVal <= 0) {
        markFieldError(purchaseQtyEl, errorPurchaseQtyEl, 'Quantity must be positive.');
        valid = false;
    } else {
        clearFieldError(purchaseQtyEl, errorPurchaseQtyEl);
    }
    // Total paid must be positive
    const paidVal = parseFloat(purchasePaidEl && purchasePaidEl.value || '0');
    if (isNaN(paidVal) || paidVal <= 0) {
        markFieldError(purchasePaidEl, errorPurchasePaidEl, 'Total paid must be positive.');
        valid = false;
    } else {
        clearFieldError(purchasePaidEl, errorPurchasePaidEl);
    }
    return valid;
}

// Clear errors when user starts typing or changing values
[shopEl, itemEl, qtyEl, perPieceEl].forEach(inputEl => {
    if (!inputEl) return;
    inputEl.addEventListener('input', () => {
        // Determine which error element to clear based on input ID
        switch (inputEl.id) {
            case 'shop':
                clearFieldError(shopEl, errorShopEl);
                break;
            case 'item':
                clearFieldError(itemEl, errorItemEl);
                break;
            case 'qty':
                clearFieldError(qtyEl, errorQtyEl);
                break;
            case 'perPiece':
                clearFieldError(perPieceEl, errorPerPieceEl);
                break;
        }
    });
});

// Clear purchase errors when user modifies fields
[purchaseItemEl, purchaseQtyEl, purchasePaidEl].forEach(inputEl => {
    if (!inputEl) return;
    inputEl.addEventListener('input', () => {
        switch (inputEl.id) {
            case 'purchaseItem':
                clearFieldError(purchaseItemEl, errorPurchaseItemEl);
                break;
            case 'purchaseQty':
                clearFieldError(purchaseQtyEl, errorPurchaseQtyEl);
                break;
            case 'purchasePaid':
                clearFieldError(purchasePaidEl, errorPurchasePaidEl);
                break;
        }
    });
});

// Clear transaction amount error on input
if (transAmountEl) {
    transAmountEl.addEventListener('input', () => {
        clearFieldError(transAmountEl, errorTransAmountEl);
    });
}

// --- CRUD ---
document.getElementById('addBtn').addEventListener('click', () => {
    const shop = shopEl.value.trim();
    const deliveredBy = deliverByEl.value.trim();
    const item = itemEl.value; // from dropdown
    // Use item as the category grouping
    const category = item;
    const qty = Math.round(parseInt(qtyEl.value) || 0);
    const per = parseCents(perPieceEl.value);
    const cost = parseCents(costEl && costEl.value);
    const paid = parseCents(paidEl.value);
    const prevBal = parseCents(prevBalanceEl.value);
    const date = dateEl.value || todayISO();
    const notes = notesEl.value.trim();

    // Validate the form fields; if invalid show inline errors and prevent submission
    if (!validateDeliveryInputs()) {
        return;
    }

    const total = qty * per;
    // Compute profit for this delivery
    const profit = qty * (per - cost);
    // Compute current balance using previous balance
    const balance = prevBal + total - paid;

    rows.unshift({
        id: uid(),
        date, shop, deliveredBy, item, category,
        quantity: qty,
        perPieceCents: per,
        costCents: cost,
        totalCents: total,
        profitCents: profit,
        paidCents: paid,
        previousBalanceCents: prevBal,
        balanceCents: balance,
        notes
    });
    save();
    render();

    // Show toast notification for successful addition
    showToast('Delivery added successfully!', 'success');

    // Reset minimal fields
    qtyEl.value = 1;
    perPieceEl.value = '';
    if (costEl) costEl.value = '';
    paidEl.value = '';
    prevBalanceEl.value = '';
    notesEl.value = '';
    updatePreview();
    shopEl.focus();
});

// --- Global search input binding ---
if (searchInput) {
    searchInput.addEventListener('input', (ev) => {
        searchQuery = ev.target.value || '';
        // Re-render the active section
        if (isPurchasesActive && typeof isPurchasesActive === 'function' && isPurchasesActive()) {
            try { renderPurchases(); } catch { /* ignore */ }
        } else {
            render();
        }
    });
}

// Quick-open search with keyboard: '/' or Ctrl/Cmd+K
(function setupSearchHotkeys() {
    function isEditable(el) {
        if (!el) return false;
        const tag = (el.tagName || '').toLowerCase();
        return tag === 'input' || tag === 'textarea' || el.isContentEditable;
    }
    document.addEventListener('keydown', (e) => {
        if (e.defaultPrevented) return;
        const tgt = e.target;
        if (isEditable(tgt)) return;
        const slash = e.key === '/';
        const cmdk = (e.key.toLowerCase() === 'k') && (e.metaKey || e.ctrlKey);
        if (slash || cmdk) {
            e.preventDefault();
            try { openSearchDropdown(); } catch { /* ignore */ }
            const input = document.getElementById('searchInput');
            if (input) setTimeout(() => input.focus(), 10);
        }
    });
})();

// --- Table header sorting ---
// Attach click listeners to all sortable header cells. Clicking toggles ascending/descending or
// sets the clicked column as the active sort field.
document.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
        const field = th.getAttribute('data-sort');
        if (sortField === field) {
            sortAsc = !sortAsc;
        } else {
            sortField = field;
            sortAsc = true;
        }
        render();
    });
    // Provide visual cue on hover for sortable columns
    th.classList.add('hover:text-emerald-600');
});

function deleteRow(id) {
    // Find and remove the row but allow undo
    const idx = rows.findIndex(r => r.id === id);
    if (idx === -1) return;
    const removed = rows.splice(idx, 1)[0];
    save();
    render();
    // Show undo toast allowing user to restore this row
    showUndoToast('Delivery deleted', () => {
        // Reinsert the removed row at its original position
        if (removed) {
            rows.splice(idx, 0, removed);
            save();
            render();
        }
    });
}

/**
 * Delete a manual transaction by id with undo support.
 * Auto-generated transactions (from deliveries) are not deletable via this function.
 * @param {string} id The transaction id.
 */
function deleteTransaction(id) {
    // Find the transaction
    const idx = transactions.findIndex(t => t.id === id);
    if (idx === -1) return;
    const removed = transactions.splice(idx, 1)[0];
    saveTransactions();
    render();
    // Show undo toast for transaction deletion
    showUndoToast('Transaction deleted', () => {
        if (removed) {
            transactions.splice(idx, 0, removed);
            saveTransactions();
            render();
        }
    });
}

// Clear all button now opens a confirmation modal instead of using browser confirm
const clearBtnEl = document.getElementById('clearBtn');
if (clearBtnEl) {
    clearBtnEl.addEventListener('click', () => {
        const back = document.getElementById('clearModalBackdrop');
        if (back) {
            back.classList.remove('hidden');
        }
    });
}
// Handle clear modal actions
const clearCancelBtn = document.getElementById('clearCancelBtn');
const clearConfirmBtn = document.getElementById('clearConfirmBtn');
if (clearCancelBtn) {
    clearCancelBtn.addEventListener('click', () => {
        const back = document.getElementById('clearModalBackdrop');
        if (back) back.classList.add('hidden');
    });
}
if (clearConfirmBtn) {
    clearConfirmBtn.addEventListener('click', () => {
        // Clear all deliveries, transactions, calculator saves and overrides
        rows = [];
        transactions = [];
        overrideSumPaidCents = null;
        overrideSumPrevCents = null;
        // Remove all calculator saves (both active and deleted)
        calcSaves.splice(0, calcSaves.length);
        save();
        saveTransactions();
        saveOverrides();
        saveCalcSaves(calcSaves);
        render();
        populateCalcSavesSection();
        const back = document.getElementById('clearModalBackdrop');
        if (back) back.classList.add('hidden');
        showToast('All data cleared', 'warning');
    });
}

// Export to CSV (no styling) with totals and without Category column
function exportCsv() {
    // Export rows to CSV, computing summary totals that mirror the on-screen values.
    // Define headers for export (omit Delivery by, Notes)
    const headers = ['No.', 'Date', 'Shop', 'Item', 'Qty', 'Price Per piece', 'Total ($)', 'Paid Amount', 'Prev Balance ($)', 'Current Balance ($)'];
    // Determine which rows to export based on current filter
    const dataRows = (currentShopFilter === null) ? rows.slice() : rows.filter(r => r.shop === currentShopFilter);
    let index = dataRows.length;
    let sumQty = 0;
    let valueCents = 0;
    let prevCents = 0;
    let autoPaidCents = 0;
    const lines = dataRows.slice().reverse().map(r => {
        const qty = r.quantity || 0;
        const per = (r.perPieceCents || 0) / 100;
        const total = (r.totalCents || 0) / 100;
        const paid = (r.paidCents || 0) / 100;
        const prev = (r.previousBalanceCents || 0) / 100;
        const curr = (r.balanceCents || 0) / 100;
        sumQty += qty;
        valueCents += r.totalCents || 0;
        prevCents += r.previousBalanceCents || 0;
        autoPaidCents += r.paidCents || 0;
        const rowArray = [
            index--,
            fmtDate(r.date),
            r.shop,
            r.item,
            qty,
            per.toFixed(2),
            total.toFixed(2),
            paid.toFixed(2),
            prev.toFixed(2),
            curr.toFixed(2)
        ];
        return rowArray.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
    });
    // Manual transactions totals (counted globally)
    let manualPaidCents = 0;
    let manualDeductCents = 0;
    for (const t of transactions) {
        if (t.type === 'payment') manualPaidCents += t.amountCents || 0;
        else manualDeductCents += t.amountCents || 0;
    }
    const computedCombinedPaid = autoPaidCents + manualPaidCents + manualDeductCents;
    const computedPrev = prevCents;
    const displayPaidCombined = (overrideSumPaidCents !== null && !isNaN(overrideSumPaidCents))
        ? (overrideSumPaidCents + computedCombinedPaid)
        : computedCombinedPaid;
    const displayPrev = (overrideSumPrevCents !== null && !isNaN(overrideSumPrevCents))
        ? (overrideSumPrevCents + computedPrev)
        : computedPrev;
    const remainingCents = displayPrev + (valueCents - displayPaidCombined);
    // Build totals row with 10 columns
    const totalsRow = [
        'Totals', '', '', '', sumQty, '',
        (valueCents / 100).toFixed(2),
        (displayPaidCombined / 100).toFixed(2),
        (displayPrev / 100).toFixed(2),
        (remainingCents / 100).toFixed(2)
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
    const csv = [headers.map(h => `"${h.replace(/"/g, '""')}"`).join(','), ...lines, totalsRow].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bakery-deliveries-${todayISO()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

// Export to Excel with styling and totals (modernized)
function exportExcel() {
    // Build an HTML table for Excel with styling and totals
    const headers = ['No.', 'Date', 'Shop', 'Delivery by', 'Item', 'Qty', 'Price Per piece', 'Total ($)', 'Paid Amount', 'Prev Balance ($)', 'Current Balance ($)', 'Notes'];
    // Row-level accumulators (for display only, not used in summary)
    let sumQty = 0;
    let sumTotal = 0;
    let sumPaid = 0;
    let sumPrev = 0;
    let sumCurr = 0;
    let bodyHtml = '';
    const dataRows = (currentShopFilter === null) ? rows.slice() : rows.filter(r => r.shop === currentShopFilter);
    // Start numbering rows at 1 and increment ascending. Do not reverse the order
    // so that the first row in the export corresponds to the first row on screen.
    let index = 1;
    for (const r of dataRows) {
        const qty = r.quantity || 0;
        const per = (r.perPieceCents || 0) / 100;
        const total = (r.totalCents || 0) / 100;
        const paid = (r.paidCents || 0) / 100;
        const prev = (r.previousBalanceCents || 0) / 100;
        const curr = (r.balanceCents || 0) / 100;
        sumQty += qty;
        sumTotal += total;
        sumPaid += paid;
        sumPrev += prev;
        sumCurr += curr;
        bodyHtml += '<tr>' +
            `<td>${index++}</td>` +
            `<td>${fmtDate(r.date)}</td>` +
            `<td>${r.shop}</td>` +
            `<td>${r.deliveredBy || ''}</td>` +
            `<td>${r.item}</td>` +
            `<td style="text-align:right">${qty}</td>` +
            `<td style="text-align:right">${per.toFixed(2)}</td>` +
            `<td style="text-align:right">${total.toFixed(2)}</td>` +
            `<td style="text-align:right">${paid.toFixed(2)}</td>` +
            `<td style="text-align:right">${prev.toFixed(2)}</td>` +
            `<td style="text-align:right">${curr.toFixed(2)}</td>` +
            `<td>${(r.notes || '').replace(/\n/g, ' ')}</td>` +
            '</tr>';
    }
    // Compute summary totals matching on-page display
    let valueCents = 0;
    let pieces = 0;
    let prevCents = 0;
    let autoPaidCents = 0;
    for (const r of dataRows) {
        valueCents += r.totalCents || 0;
        pieces += r.quantity || 0;
        prevCents += r.previousBalanceCents || 0;
        autoPaidCents += r.paidCents || 0;
    }
    let manualPaidCents = 0;
    let manualDeductCents = 0;
    for (const t of transactions) {
        if (t.type === 'payment') manualPaidCents += t.amountCents || 0;
        else manualDeductCents += t.amountCents || 0;
    }
    const computedCombinedPaid = autoPaidCents + manualPaidCents + manualDeductCents;
    const computedPrev = prevCents;
    const displayPaidCombined = (overrideSumPaidCents !== null && !isNaN(overrideSumPaidCents))
        ? (overrideSumPaidCents + computedCombinedPaid)
        : computedCombinedPaid;
    const displayPrev = (overrideSumPrevCents !== null && !isNaN(overrideSumPrevCents))
        ? (overrideSumPrevCents + computedPrev)
        : computedPrev;
    const remainingCents = displayPrev + (valueCents - displayPaidCombined);
    const totalsRow = '<tr class="total-row">' +
        '<td colspan="4" style="font-weight:bold">Totals</td>' +
        `<td style="text-align:right;font-weight:bold">${sumQty}</td>` +
        '<td></td>' +
        `<td style="text-align:right;font-weight:bold">${(valueCents / 100).toFixed(2)}</td>` +
        `<td style="text-align:right;font-weight:bold">${(displayPaidCombined / 100).toFixed(2)}</td>` +
        `<td style="text-align:right;font-weight:bold">${(displayPrev / 100).toFixed(2)}</td>` +
        `<td style="text-align:right;font-weight:bold">${(remainingCents / 100).toFixed(2)}</td>` +
        '<td></td>' +
        '</tr>';
    let headerHtml = '<tr>';
    for (const h of headers) {
        headerHtml += `<th>${h}</th>`;
    }
    headerHtml += '</tr>';
    // Build a simple stylesheet for the table to make it look professional in Excel
    const styles = `
                <style>
                    table { border-collapse: collapse; font-family: Arial, sans-serif; font-size: 12px; width: 100%; }
                    th, td { border: 1px solid #dddddd; padding: 4px 6px; }
                    thead th { background-color: #f2f2f2; font-weight: 600; }
                    tbody tr:nth-child(odd) { background-color: #fafafa; }
                    tbody tr:nth-child(even) { background-color: #ffffff; }
                    tbody tr.total-row { background-color: #eeeeee; font-weight: bold; }
                </style>
            `;
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">${styles}</head><body><table>` +
        '<thead>' + headerHtml + '</thead><tbody>' + bodyHtml + totalsRow + '</tbody></table></body></html>';
    const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bakery-deliveries-${todayISO()}.xls`;
    a.click();
    URL.revokeObjectURL(url);
}

/**
 * Populate the print summary at the bottom of the deliveries printout. This
 * generates a simple table showing aggregate totals for pieces, value,
 * combined paid amount, previous balance, and current balance. The table
 * contents are computed using the same logic as the on‑screen summaries so
 * that manual transactions and overrides are included. The summary is
 * inserted into the #printSummary element and styled via CSS for print.
 */
function updatePrintSummary() {
    const container = document.getElementById('printSummary');
    if (!container) return;
    // Determine which delivery rows are currently visible based on the shop
    // filter. When no filter is active, all rows are included.
    const dataRows = (typeof currentShopFilter === 'string' && currentShopFilter !== '')
        ? rows.filter(r => r.shop === currentShopFilter)
        : rows.slice();
    // Aggregate core values. Quantities are summed directly. Monetary values
    // are stored in cents for accuracy and converted to dollars via fmt().
    let pieces = 0;
    let valueCents = 0;
    let prevCents = 0;
    let autoPaidCents = 0;
    for (const r of dataRows) {
        pieces += r.quantity || 0;
        valueCents += r.totalCents || 0;
        prevCents += r.previousBalanceCents || 0;
        autoPaidCents += r.paidCents || 0;
    }
    // Accumulate manual transactions. Payments add to paid; deductions
    // subtract (negative or positive amounts depending on business logic).
    let manualPaidCents = 0;
    let manualDeductCents = 0;
    for (const t of transactions) {
        if (!t || typeof t.amountCents !== 'number') continue;
        if (t.type === 'payment') manualPaidCents += t.amountCents;
        else manualDeductCents += t.amountCents;
    }
    const combinedPaid = autoPaidCents + manualPaidCents + manualDeductCents;
    // Apply optional overrides to paid and previous balances when specified.
    const displayPaidCents = (overrideSumPaidCents !== null && !isNaN(overrideSumPaidCents))
        ? (overrideSumPaidCents + combinedPaid)
        : combinedPaid;
    const displayPrevCents = (overrideSumPrevCents !== null && !isNaN(overrideSumPrevCents))
        ? (overrideSumPrevCents + prevCents)
        : prevCents;
    const currentCents = displayPrevCents + (valueCents - displayPaidCents);
    // Build HTML for summary table. Use minimal styling; print CSS will
    // provide borders and striped rows. Each row shows a metric and its
    // formatted value. For pieces, display as an integer; for currency,
    // format using fmt() helper (which accepts cents).
    let html = '<table class="w-full text-xs">';
    html += '<thead><tr><th class="py-1 pr-2 text-left">Metric</th><th class="py-1 pr-2 text-left">Value</th></tr></thead>';
    html += '<tbody>';
    html += `<tr><td class="py-1 pr-2">Total pieces</td><td>${pieces}</td></tr>`;
    html += `<tr><td class="py-1 pr-2">Total value</td><td>${fmt(valueCents)}</td></tr>`;
    html += `<tr><td class="py-1 pr-2">Total paid</td><td>${fmt(displayPaidCents)}</td></tr>`;
    html += `<tr><td class="py-1 pr-2">Previous balance</td><td>${fmt(displayPrevCents)}</td></tr>`;
    html += `<tr><td class="py-1 pr-2">Current balance</td><td>${fmt(currentCents)}</td></tr>`;
    html += '</tbody></table>';
    container.innerHTML = html;
    // Ensure the summary is styled appropriately when printing
    container.classList.add('print-summary');
}

document.getElementById('exportCsvBtn').addEventListener('click', exportCsv);
document.getElementById('exportExcelBtn').addEventListener('click', exportExcel);

// Print button handler
const printBtn = document.getElementById('printBtn');
if (printBtn) {
    printBtn.addEventListener('click', () => {
        // Before invoking the browser print dialog, build the summary table so
        // it appears at the bottom of the printed report. Use a small delay to
        // ensure the DOM updates are flushed prior to printing.
        try { updatePrintSummary(); } catch { /* ignore */ }
        setTimeout(() => { window.print(); }, 50);
    });
}

// Hook up import and backup buttons in the toolbar
const importBtnEl = document.getElementById('importBtn');
if (importBtnEl) {
    importBtnEl.addEventListener('click', () => {
        openImportModal();
    });
}
const saveBtnEl = document.getElementById('saveBtn');
if (saveBtnEl) {
    saveBtnEl.addEventListener('click', () => {
        const panel = document.getElementById('savePanel');
        const purchasePanel = document.getElementById('purchaseSavePanel');
        if (purchasePanel && !purchasePanel.classList.contains('hidden')) {
            purchasePanel.classList.add('hidden');
        }
        if (!panel) return;
        // If currently hidden, load saves and show; else hide
        if (panel.classList.contains('hidden')) {
            loadSaves();
            populateSavePanel();
            panel.classList.remove('hidden');
        } else {
            panel.classList.add('hidden');
        }
    });
}

// ========================== Navbar wiring ===========================
/** Returns true if Purchases section is currently active/visible. */
function isPurchasesActive() {
    const purchasesSec = document.getElementById('purchasesSection');
    return purchasesSec && !purchasesSec.classList.contains('hidden');
}

/** Map a navbar action to the corresponding legacy button click. */
function performNavAction(action) {
    const map = {
        exportCsv: isPurchasesActive() ? 'exportPurchasesCsvBtn' : 'exportCsvBtn',
        exportExcel: isPurchasesActive() ? 'exportPurchasesExcelBtn' : 'exportExcelBtn',
        import: isPurchasesActive() ? 'importPurchasesBtn' : 'importBtn',
        save: isPurchasesActive() ? 'savePurchasesBtn' : 'saveBtn',
        print: isPurchasesActive() ? 'printPurchasesBtn' : 'printBtn',
        clear: isPurchasesActive() ? 'clearPurchasesBtn' : 'clearBtn'
    };
    const id = map[action];
    if (!id) return;
    const el = document.getElementById(id);
    if (el) el.click();
}

// Top navbar action buttons
const navExportCsv = document.getElementById('navExportCsv');
if (navExportCsv) navExportCsv.addEventListener('click', () => performNavAction('exportCsv'));
const navExportExcel = document.getElementById('navExportExcel');
if (navExportExcel) navExportExcel.addEventListener('click', () => performNavAction('exportExcel'));
const navImport = document.getElementById('navImport');
if (navImport) navImport.addEventListener('click', () => performNavAction('import'));
const navSave = document.getElementById('navSave');
if (navSave) navSave.addEventListener('click', () => performNavAction('save'));
const navPrint = document.getElementById('navPrint');
if (navPrint) navPrint.addEventListener('click', () => performNavAction('print'));
const navClear = document.getElementById('navClear');
if (navClear) navClear.addEventListener('click', () => performNavAction('clear'));

// Hamburger / Mobile menu controls
const hamburgerBtn = document.getElementById('navHamburger');
const hamburgerIcon = document.getElementById('hamburgerIcon');
const mobileMenu = document.getElementById('mobileMenu');
const searchActivator = document.getElementById('searchActivator');
const searchDropdown = document.getElementById('searchDropdown');
function closeMobileMenu() {
    if (!mobileMenu || !hamburgerBtn) return;
    mobileMenu.classList.add('d-none');
    hamburgerBtn.setAttribute('aria-expanded', 'false');
    if (hamburgerIcon) { hamburgerIcon.classList.remove('fa-xmark'); hamburgerIcon.classList.add('fa-bars'); }
}
function openMobileMenu() {
    if (!mobileMenu || !hamburgerBtn) return;
    mobileMenu.classList.remove('d-none');
    hamburgerBtn.setAttribute('aria-expanded', 'true');
    if (hamburgerIcon) { hamburgerIcon.classList.remove('fa-bars'); hamburgerIcon.classList.add('fa-xmark'); }
    // Focus first item
    const first = mobileMenu.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (first && first.focus) setTimeout(() => first.focus(), 10);
}
if (hamburgerBtn && mobileMenu) {
    hamburgerBtn.addEventListener('click', () => {
        const expanded = hamburgerBtn.getAttribute('aria-expanded') === 'true';
        if (expanded) closeMobileMenu(); else openMobileMenu();
    });
    // Close on outside click
    document.addEventListener('click', (e) => {
        if (!mobileMenu || mobileMenu.classList.contains('d-none')) return;
        if (hamburgerBtn.contains(e.target) || mobileMenu.contains(e.target)) return;
        closeMobileMenu();
    });
    // Close on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeMobileMenu();
    });
}

// Medium search pill → toggles dropdown; always visible inline on lg+
function openSearchDropdown() {
    if (!searchDropdown) return;
    searchDropdown.classList.remove('d-none');
    if (searchActivator) searchActivator.setAttribute('aria-expanded', 'true');
    const input = document.getElementById('searchInput');
    if (input && window.innerWidth < 1024) setTimeout(() => input.focus(), 10);
}
function closeSearchDropdown() {
    if (!searchDropdown) return;
    // Only close when < lg; on large, dropdown is always visible
    if (window.innerWidth >= 1024) return;
    searchDropdown.classList.add('d-none');
    if (searchActivator) searchActivator.setAttribute('aria-expanded', 'false');
}
if (searchActivator && searchDropdown) {
    searchActivator.addEventListener('click', () => {
        if (window.innerWidth >= 1024) return; // no-op on large
        const isOpen = !searchDropdown.classList.contains('d-none');
        if (isOpen) closeSearchDropdown(); else openSearchDropdown();
    });
    document.addEventListener('click', (e) => {
        if (window.innerWidth >= 1024) return;
        if (searchDropdown.classList.contains('d-none')) return;
        if ((searchActivator && searchActivator.contains(e.target)) || searchDropdown.contains(e.target)) return;
        closeSearchDropdown();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeSearchDropdown();
    });
    // Resize guard: when resizing to large, ensure dropdown visible; back to medium, close it
    window.addEventListener('resize', () => {
        if (!searchDropdown) return;
        if (window.innerWidth >= 1024) {
            searchDropdown.classList.remove('d-none');
            if (searchActivator) searchActivator.setAttribute('aria-expanded', 'false');
        } else {
            searchDropdown.classList.add('d-none');
        }
    });
    // Initial state based on width
    if (window.innerWidth >= 1024) {
        searchDropdown.classList.remove('d-none');
    } else {
        searchDropdown.classList.add('d-none');
    }
}

// Mobile menu item actions
const mmNavDeliveries = document.getElementById('mmNavDeliveries');
if (mmNavDeliveries) mmNavDeliveries.addEventListener('click', () => { showSection('deliverySection'); closeMobileMenu(); });
const mmNavPurchases = document.getElementById('mmNavPurchases');
if (mmNavPurchases) mmNavPurchases.addEventListener('click', () => { showSection('purchasesSection'); closeMobileMenu(); });
const mmExportCsv = document.getElementById('mmExportCsv');
if (mmExportCsv) mmExportCsv.addEventListener('click', () => { performNavAction('exportCsv'); closeMobileMenu(); });
const mmExportExcel = document.getElementById('mmExportExcel');
if (mmExportExcel) mmExportExcel.addEventListener('click', () => { performNavAction('exportExcel'); closeMobileMenu(); });
const mmImport = document.getElementById('mmImport');
if (mmImport) mmImport.addEventListener('click', () => { performNavAction('import'); closeMobileMenu(); });
const mmSave = document.getElementById('mmSave');
if (mmSave) mmSave.addEventListener('click', () => { performNavAction('save'); closeMobileMenu(); });
const mmPrint = document.getElementById('mmPrint');
if (mmPrint) mmPrint.addEventListener('click', () => { performNavAction('print'); closeMobileMenu(); });
const mmClear = document.getElementById('mmClear');
if (mmClear) mmClear.addEventListener('click', () => { performNavAction('clear'); closeMobileMenu(); });

// Hide saves dropdown when clicking outside of it
document.addEventListener('click', (e) => {
    const panel = document.getElementById('savePanel');
    const btn = document.getElementById('saveBtn');
    const navBtn = document.getElementById('navSave');
    const mmBtn = document.getElementById('mmSave');
    if (!panel || panel.classList.contains('hidden')) return;
    const isTrigger = (btn && btn.contains(e.target)) || (navBtn && navBtn.contains(e.target)) || (mmBtn && mmBtn.contains(e.target));
    if (!panel.contains(e.target) && !isTrigger) {
        panel.classList.add('hidden');
    }
});

// Hide purchase saves dropdown when clicking outside of it
document.addEventListener('click', (e) => {
    const panel = document.getElementById('purchaseSavePanel');
    const btn = document.getElementById('savePurchasesBtn');
    const navBtn = document.getElementById('navSave');
    const mmBtn = document.getElementById('mmSave');
    if (!panel || panel.classList.contains('hidden')) return;
    const isTrigger = (btn && btn.contains(e.target)) || (navBtn && navBtn.contains(e.target)) || (mmBtn && mmBtn.contains(e.target));
    if (!panel.contains(e.target) && !isTrigger) {
        panel.classList.add('hidden');
    }
});

// Save naming modal handlers
const saveNameBackdrop = document.getElementById('saveNameBackdrop');
const saveNameInput = document.getElementById('saveNameInput');
const saveShopSelect = document.getElementById('saveShopSelect');
const saveNameCancel = document.getElementById('saveNameCancel');
const saveNameSave = document.getElementById('saveNameSave');
if (saveNameCancel) {
    saveNameCancel.addEventListener('click', () => {
        if (saveNameBackdrop) saveNameBackdrop.classList.add('hidden');
    });
}
if (saveNameSave) {
    saveNameSave.addEventListener('click', () => {
        if (!saveNameInput) return;
        const name = saveNameInput.value.trim();
        const errorEl = document.getElementById('saveNameError');
        if (!name) {
            if (errorEl) errorEl.classList.remove('hidden');
            return;
        }
        if (errorEl) errorEl.classList.add('hidden');
        // Dispatch to appropriate save creator based on context
        if (saveContext === 'purchase') {
            createPurchaseSave(name);
        } else if (saveContext === 'calc') {
            createCalcSave(name);
        } else {
            createSave(name, null);
        }
        if (saveNameBackdrop) saveNameBackdrop.classList.add('hidden');
    });
}

// Save deletion confirmation modal handlers
const deleteSaveBackdrop = document.getElementById('deleteSaveBackdrop');
const deleteSaveCancel = document.getElementById('deleteSaveCancel');
const deleteSaveConfirm = document.getElementById('deleteSaveConfirm');
const deleteSaveInput = document.getElementById('deleteSaveInput');
if (deleteSaveCancel) {
    deleteSaveCancel.addEventListener('click', () => {
        if (deleteSaveBackdrop) deleteSaveBackdrop.classList.add('hidden');
    });
}
if (deleteSaveInput) {
    deleteSaveInput.addEventListener('input', () => {
        const val = deleteSaveInput.value.trim().toLowerCase();
        // Enable confirm button only when user types DELETE (case insensitive)
        if (deleteSaveConfirm) {
            deleteSaveConfirm.disabled = (val !== 'delete');
        }
    });
}
if (deleteSaveConfirm) {
    deleteSaveConfirm.addEventListener('click', () => {
        // Remove modal and call the appropriate delete function for stored index
        const idxStr = deleteSaveConfirm.dataset.saveIndex;
        const type = deleteSaveConfirm.dataset.saveType || 'delivery';
        const permanent = deleteSaveConfirm.dataset.permanent === 'true';
        if (idxStr !== undefined) {
            const idx = parseInt(idxStr, 10);
            if (!isNaN(idx)) {
                if (type === 'purchase') {
                    deletePurchaseSave(idx);
                } else {
                    if (permanent) deleteSavePermanent(idx);
                    else deleteSave(idx); // soft delete
                }
            }
        }
        // Clear data attributes
        delete deleteSaveConfirm.dataset.saveIndex;
        delete deleteSaveConfirm.dataset.saveType;
        delete deleteSaveConfirm.dataset.permanent;
        if (deleteSaveBackdrop) deleteSaveBackdrop.classList.add('hidden');
    });
}



// Toast helper function
function showToast(message, type = 'success') {
    const toastEl = document.getElementById('toast');
    if (!toastEl) return;
    // Remove any previous color classes
    toastEl.classList.remove('bg-emerald-600', 'bg-red-600', 'bg-amber-600');
    // Set message and color based on type
    toastEl.textContent = message;
    if (type === 'error') {
        toastEl.classList.add('bg-red-600');
    } else if (type === 'warning') {
        toastEl.classList.add('bg-amber-600');
    } else {
        toastEl.classList.add('bg-emerald-600');
    }
    // Show toast
    toastEl.classList.remove('opacity-0', 'pointer-events-none');
    // Hide after a delay
    setTimeout(() => {
        toastEl.classList.add('opacity-0');
    }, 3000);
}

// --- Undo toast helper ---
/**
 * Displays a toast with an undo option. The toast persists for 10 seconds
 * and calls the provided callback if the user clicks the Undo link.
 * @param {string} message The message to display.
 * @param {Function} onUndo Callback invoked when undo is clicked.
 */
function showUndoToast(message, onUndo) {
    const toastEl = document.getElementById('toast');
    if (!toastEl) return;
    // Build toast content with undo button
    toastEl.classList.remove('bg-emerald-600', 'bg-red-600', 'bg-amber-600');
    toastEl.classList.add('bg-red-600');
    toastEl.innerHTML = `<span>${message}</span> <button id="undoActionBtn" class="underline ml-2">Undo</button>`;
    toastEl.classList.remove('opacity-0', 'pointer-events-none');
    // Attach undo event
    const undoBtn = document.getElementById('undoActionBtn');
    if (undoBtn) {
        undoBtn.addEventListener('click', () => {
            if (typeof onUndo === 'function') onUndo();
            // Hide toast immediately after undo
            toastEl.classList.add('opacity-0');
        });
    }
    // Hide after 10 seconds
    setTimeout(() => {
        toastEl.classList.add('opacity-0');
    }, 10000);
}

// --- Backup helpers ---
function loadSaves() {
    try {
        const raw = JSON.parse(localStorage.getItem('bakery-tracker-saves') || '[]');
        if (Array.isArray(raw)) {
            // Ensure legacy entries have soft-delete fields
            saves = raw.map((e) => {
                if (!e || typeof e !== 'object') return e;
                if (e.deleted === undefined) e.deleted = false;
                if (e.deleted && !e.deletedAt) e.deletedAt = new Date().toISOString();
                return e;
            });
        } else {
            saves = [];
        }
    } catch {
        saves = [];
    }
}


function saveSaves() {
    try {
        localStorage.setItem('bakery-tracker-saves', JSON.stringify(saves));
    } catch {
        // ignore
    }
}
/**
 * Create a new save. Optionally provide a name and shop; if shop is specified,
 * only rows belonging to that shop are saved along with all transactions and settings.
 * @param {string} name The name of the save
 * @param {string|null} shop The shop to scope the save to (null for all)
 */
function createSave(name, shop) {
    // Always save all rows (shop-specific saves removed)
    let rowsToSave = rows.map(r => ({ ...r }));
    // Save all transactions (no shop-specific metadata), because manual transactions may apply globally
    const data = {
        timestamp: new Date().toISOString(),
        name: name || '',
        shop: null,
        rows: rowsToSave,
        transactions: transactions.map(t => ({ ...t })),
        overridePaid: overrideSumPaidCents,
        overridePrev: overrideSumPrevCents,
        categories: CATEGORIES.slice(),
        // Include purchases and purchase items in saves so they can be restored
        purchases: purchases.map(p => ({ ...p })),
        purchaseItems: purchaseItems.slice()
    };
    saves.unshift(data);
    if (saves.length > 5) saves.pop();
    saveSaves();
    populateSavePanel();
    showToast('Save created', 'success');
}
function populateSavePanel() {
    const panel = document.getElementById('savePanel');
    if (!panel) return;
    panel.innerHTML = '';

    // Save Now button — original green style (no visual changes)
    const saveNowBtn = document.createElement('button');
    saveNowBtn.className = 'w-full px-3 py-2 text-sm rounded-md bg-emerald-500 text-white hover:bg-emerald-600 transition-base';
    saveNowBtn.textContent = 'Save Now';
    saveNowBtn.addEventListener('click', () => {
        // When saving deliveries, set saveContext accordingly and open modal
        saveContext = 'delivery';
        panel.classList.add('hidden');
        const back = document.getElementById('saveNameBackdrop');
        const nameInput = document.getElementById('saveNameInput');
        const errorEl = document.getElementById('saveNameError');
        if (back && nameInput) {
            nameInput.value = '';
            if (errorEl) errorEl.classList.add('hidden');
            back.classList.remove('hidden');
            setTimeout(() => { nameInput.focus(); }, 10);
        }
    });
    panel.appendChild(saveNowBtn);

    const all = Array.isArray(saves) ? saves : [];
    const active = all.filter(e => e && !e.deleted);
    const deleted = all.filter(e => e && e.deleted);

    // Tabs header (hover/selected and counters handled in CSS)
    const tabs = document.createElement('div');
    tabs.className = 'flex items-center gap-2 justify-between mt-2';
    tabs.innerHTML = `
        <div class="flex gap-2">
            <button id="savesTabActive" class="saves-tab saves-tab--selected" aria-selected="true">
                <span class="saves-tab-label">Active</span>
                <span class="saves-tab-count">${active.length}</span>
            </button>
            <button id="savesTabDeleted" class="saves-tab" aria-selected="false">
                <span class="saves-tab-label">Deleted</span>
                <span class="saves-tab-count">${deleted.length}</span>
            </button>
        </div>
    `;
    panel.appendChild(tabs);

    // Content containers
    const listsWrap = document.createElement('div');
    listsWrap.className = 'mt-2';
    listsWrap.innerHTML = `
        <div id="savesActiveList"></div>
        <div id="savesDeletedList" class="hidden"></div>
    `;
    panel.appendChild(listsWrap);

    const activeList = listsWrap.querySelector('#savesActiveList');
    const deletedList = listsWrap.querySelector('#savesDeletedList');

    // Renderers (no row dividers; action links use original styles)
    function renderActive() {
        activeList.innerHTML = '';
        if (active.length === 0) {
            const emptyA = document.createElement('div');
            emptyA.className = 'text-xs text-neutral-500';
            emptyA.textContent = 'No active saves';
            activeList.appendChild(emptyA);
            return;
        }
        all.forEach((b, idx) => {
            if (!b || b.deleted) return;
            const row = document.createElement('div');
            row.className = 'py-2';
            const label = document.createElement('div');
            label.className = 'text-xs text-neutral-600';
            const dt = new Date(b.timestamp);
            const prefix = (b.name && b.name.trim()) ? (b.name + ' – ') : '';
            label.textContent = `${prefix}${dt.toLocaleString()}`;
            row.appendChild(label);

            const actions = document.createElement('div');
            actions.className = 'flex gap-2 mt-1';

            const replaceBtn = document.createElement('button');
            replaceBtn.className = 'text-xs underline text-emerald-600 hover:text-emerald-800';
            replaceBtn.textContent = 'Replace';
            replaceBtn.addEventListener('click', () => {
                restoreSave(idx, 'replace');
                panel.classList.add('hidden');
            });

            const appendBtn = document.createElement('button');
            appendBtn.className = 'text-xs underline text-emerald-600 hover:text-emerald-800';
            appendBtn.textContent = 'Append';
            appendBtn.addEventListener('click', () => {
                restoreSave(idx, 'append');
                panel.classList.add('hidden');
            });

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'text-xs underline text-red-600 hover:text-red-800';
            deleteBtn.textContent = 'Delete';
            deleteBtn.addEventListener('click', () => {
                const backdrop = document.getElementById('deleteSaveBackdrop');
                const input = document.getElementById('deleteSaveInput');
                const confirmBtn = document.getElementById('deleteSaveConfirm');
                if (backdrop && input && confirmBtn) {
                    confirmBtn.disabled = true;
                    input.value = '';
                    confirmBtn.dataset.saveIndex = idx;   // master index in saves[]
                    confirmBtn.dataset.saveType = 'delivery';
                    delete confirmBtn.dataset.permanent;  // SOFT delete by default
                    backdrop.classList.remove('hidden');
                    setTimeout(() => { input.focus(); }, 10);
                }
            });

            actions.appendChild(replaceBtn);
            actions.appendChild(appendBtn);
            actions.appendChild(deleteBtn);
            row.appendChild(actions);
            activeList.appendChild(row);
        });
    }

    function renderDeleted() {
        deletedList.innerHTML = '';
        if (deleted.length === 0) {
            const emptyD = document.createElement('div');
            emptyD.className = 'text-xs text-neutral-500';
            emptyD.textContent = 'No deleted saves';
            deletedList.appendChild(emptyD);
            return;
        }
        all.forEach((b, idx) => {
            if (!b || !b.deleted) return;
            const row = document.createElement('div');
            row.className = 'py-2';
            const line = document.createElement('div');
            line.className = 'text-xs text-neutral-600';
            const when = b.deletedAt ? new Date(b.deletedAt).toLocaleString() : new Date().toLocaleString();
            const nm = (b.name && b.name.trim()) ? b.name : 'Untitled';
            line.textContent = `${nm} – deleted ${when}`;
            row.appendChild(line);

            const actions = document.createElement('div');
            actions.className = 'flex gap-2 mt-1';

            const restoreBtn = document.createElement('button');
            restoreBtn.className = 'text-xs underline text-emerald-600 hover:text-emerald-800';
            restoreBtn.textContent = 'Restore';
            restoreBtn.addEventListener('click', () => {
                restoreDeletedSave(idx);
            });

            const permBtn = document.createElement('button');
            permBtn.className = 'text-xs underline text-red-600 hover:text-red-800';
            permBtn.textContent = 'Delete Permanently';
            permBtn.addEventListener('click', () => {
                const backdrop = document.getElementById('deleteSaveBackdrop');
                const input = document.getElementById('deleteSaveInput');
                const confirmBtn = document.getElementById('deleteSaveConfirm');
                if (backdrop && input && confirmBtn) {
                    confirmBtn.disabled = true;
                    input.value = '';
                    confirmBtn.dataset.saveIndex = idx;    // master index
                    confirmBtn.dataset.saveType = 'delivery';
                    confirmBtn.dataset.permanent = 'true'; // PERMANENT path
                    backdrop.classList.remove('hidden');
                    setTimeout(() => { input.focus(); }, 10);
                }
            });

            actions.appendChild(restoreBtn);
            actions.appendChild(permBtn);
            row.appendChild(actions);
            deletedList.appendChild(row);
        });
    }

    renderActive();
    renderDeleted();

    // Tab behavior
    const tabActive = tabs.querySelector('#savesTabActive');
    const tabDeleted = tabs.querySelector('#savesTabDeleted');
    const activeListEl = activeList;
    const deletedListEl = deletedList;

    function setTab(which) {
        const a = which === 'active';
        tabActive.classList.toggle('saves-tab--selected', a);
        tabActive.setAttribute('aria-selected', a ? 'true' : 'false');
        const d = which === 'deleted';
        tabDeleted.classList.toggle('saves-tab--selected', d);
        tabDeleted.setAttribute('aria-selected', d ? 'true' : 'false');
        activeListEl.classList.toggle('hidden', !a);
        deletedListEl.classList.toggle('hidden', !d);
    }

    tabActive.addEventListener('click', () => setTab('active'));
    tabDeleted.addEventListener('click', () => setTab('deleted'));
    setTab('active'); // default
}



function restoreSave(index, mode) {
    const entry = saves[index];
    if (!entry) return;
    lastImportUndo = null;
    if (mode === 'replace') {
        // If save is scoped to a shop, remove rows for that shop then insert saved rows; else replace all
        if (entry.shop) {
            rows = rows.filter(r => r.shop !== entry.shop);
            rows = rows.concat(entry.rows.map(r => ({ ...r })));
        } else {
            rows = entry.rows.map(r => ({ ...r }));
        }
        transactions = entry.transactions.map(t => ({ ...t }));
        overrideSumPaidCents = entry.overridePaid;
        overrideSumPrevCents = entry.overridePrev;
        if (entry.categories && Array.isArray(entry.categories)) {
            CATEGORIES = entry.categories.slice();
            saveCategories(CATEGORIES);
            populateOptions();
        }
    } else if (mode === 'append') {
        // Append saved rows; do not remove existing rows
        rows = rows.concat(entry.rows.map(r => ({ ...r })));
        transactions = transactions.concat(entry.transactions.map(t => ({ ...t })));
        // Keep current overrides
        if (entry.categories && Array.isArray(entry.categories)) {
            entry.categories.forEach(cat => {
                if (!CATEGORIES.includes(cat)) CATEGORIES.push(cat);
            });
            saveCategories(CATEGORIES);
            populateOptions();
        }
    }
    // Persist primary data to localStorage
    save();
    saveTransactions();
    saveOverrides();
    // Restore purchases and purchase items if present
    if (entry.purchases && Array.isArray(entry.purchases)) {
        if (mode === 'replace') {
            purchases = entry.purchases.map(p => ({ ...p }));
        } else if (mode === 'append') {
            purchases = purchases.concat(entry.purchases.map(p => ({ ...p })));
        }
        savePurchases(purchases);
    }
    if (entry.purchaseItems && Array.isArray(entry.purchaseItems)) {
        if (mode === 'replace') {
            purchaseItems = entry.purchaseItems.slice();
        } else if (mode === 'append') {
            entry.purchaseItems.forEach(it => {
                if (!purchaseItems.includes(it)) purchaseItems.push(it);
            });
        }
        savePurchaseItems(purchaseItems);
    }
    // Update UI components for purchases
    populatePurchaseOptions();
    renderPurchases();
    updateCalculatorDefaults();
    // Recalculate totals in calculator if pieces are already entered
    try {
        const piecesVal = parseFloat(document.getElementById('calcPieces')?.value || '0') || 0;
        if (piecesVal > 0) {
            computeCalculator();
        }
    } catch {
        /* ignore */
    }
    render();
    showToast('Restore successful', 'success');
}

// =========================== Purchase Save Helpers ============================
/**
 * Load purchase-specific saves from localStorage. Returns an array of saved
 * purchase states. Each entry includes a timestamp, name, purchases array and
 * purchaseItems array.
 */
function loadPurchaseSaves() {
    try {
        const raw = JSON.parse(localStorage.getItem(PURCHASE_SAVES_KEY) || '[]');
        if (Array.isArray(raw)) purchaseSaves = raw;
        else purchaseSaves = [];
    } catch {
        purchaseSaves = [];
    }
}

/**
 * Persist the purchase saves array to localStorage.
 */
function savePurchaseSaves() {
    try {
        localStorage.setItem(PURCHASE_SAVES_KEY, JSON.stringify(purchaseSaves));
    } catch {
        /* ignore */
    }
}

/**
 * Create a new purchase save. The name is provided by the user. Purchases and
 * purchase items are captured to allow restoring the state later.
 * @param {string} name Name of the save entered by the user.
 */
function createPurchaseSave(name) {
    const data = {
        timestamp: new Date().toISOString(),
        name: name || '',
        purchases: purchases.map(p => ({ ...p })),
        purchaseItems: purchaseItems.slice()
    };
    purchaseSaves.unshift(data);
    if (purchaseSaves.length > 5) purchaseSaves.pop();
    savePurchaseSaves();
    populatePurchaseSavePanel();
    showToast('Save created', 'success');
}

/**
 * Populate the dedicated purchase save panel with a save now button and a list
 * of previously saved states. Allows restoring or deleting saves.
 */
function populatePurchaseSavePanel() {
    const panel = document.getElementById('purchaseSavePanel');
    if (!panel) return;
    panel.innerHTML = '';
    // Save Now button
    const saveNowBtn = document.createElement('button');
    saveNowBtn.className = 'w-full px-3 py-2 text-sm rounded-md bg-emerald-500 text-white hover:bg-emerald-600 transition-base';
    saveNowBtn.textContent = 'Save Now';
    saveNowBtn.addEventListener('click', () => {
        // Hide panel and open naming modal
        panel.classList.add('hidden');
        saveContext = 'purchase';
        const back = document.getElementById('saveNameBackdrop');
        const nameInput = document.getElementById('saveNameInput');
        const errorEl = document.getElementById('saveNameError');
        if (back && nameInput) {
            nameInput.value = '';
            if (errorEl) errorEl.classList.add('hidden');
            back.classList.remove('hidden');
            setTimeout(() => { nameInput.focus(); }, 10);
        }
    });
    panel.appendChild(saveNowBtn);
    // Divider
    const div = document.createElement('div');
    div.className = 'border-t my-2';
    panel.appendChild(div);
    if (purchaseSaves.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'text-xs text-neutral-500';
        empty.textContent = 'No saves yet';
        panel.appendChild(empty);
        return;
    }
    purchaseSaves.forEach((b, idx) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'mb-2 last:mb-0';
        const label = document.createElement('div');
        label.className = 'text-xs text-neutral-600';
        const dt = new Date(b.timestamp);
        const dateStr = dt.toLocaleString();
        let prefix = '';
        if (b.name && b.name.trim()) prefix = b.name + ' – ';
        label.textContent = prefix + dateStr;
        wrapper.appendChild(label);
        const actions = document.createElement('div');
        actions.className = 'flex gap-2 mt-1';
        const replaceBtn = document.createElement('button');
        replaceBtn.className = 'text-xs underline text-emerald-600 hover:text-emerald-800';
        replaceBtn.textContent = 'Replace';
        replaceBtn.addEventListener('click', () => {
            restorePurchaseSave(idx, 'replace');
            panel.classList.add('hidden');
        });
        const appendBtn = document.createElement('button');
        appendBtn.className = 'text-xs underline text-emerald-600 hover:text-emerald-800';
        appendBtn.textContent = 'Append';
        appendBtn.addEventListener('click', () => {
            restorePurchaseSave(idx, 'append');
            panel.classList.add('hidden');
        });
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'text-xs underline text-red-600 hover:text-red-800';
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', () => {
            const backdrop = document.getElementById('deleteSaveBackdrop');
            const input = document.getElementById('deleteSaveInput');
            const confirmBtn = document.getElementById('deleteSaveConfirm');
            if (backdrop && input && confirmBtn) {
                confirmBtn.disabled = true;
                input.value = '';
                // Store index and type for confirm
                confirmBtn.dataset.saveIndex = idx;
                confirmBtn.dataset.saveType = 'purchase';
                backdrop.classList.remove('hidden');
                setTimeout(() => { input.focus(); }, 10);
            }
        });
        actions.appendChild(replaceBtn);
        actions.appendChild(appendBtn);
        actions.appendChild(deleteBtn);
        wrapper.appendChild(actions);
        panel.appendChild(wrapper);
    });
}

/**
 * Restore a purchase save by index. The mode can be 'replace' or 'append'.
 * @param {number} index Index of the purchase save.
 * @param {string} mode Either 'replace' or 'append'.
 */
function restorePurchaseSave(index, mode) {
    const entry = purchaseSaves[index];
    if (!entry) return;
    if (mode === 'replace') {
        purchases = entry.purchases.map(p => ({ ...p }));
        purchaseItems = entry.purchaseItems.slice();
    } else if (mode === 'append') {
        purchases = purchases.concat(entry.purchases.map(p => ({ ...p })));
        entry.purchaseItems.forEach(it => {
            if (!purchaseItems.includes(it)) purchaseItems.push(it);
        });
    }
    savePurchases(purchases);
    savePurchaseItems(purchaseItems);
    populatePurchaseOptions();
    renderPurchases();
    updateCalculatorDefaults();
    showToast('Restore successful', 'success');
}

/**
 * Delete a purchase save by its index.
 * @param {number} index Index of the purchase save to remove.
 */
function deletePurchaseSave(index) {
    if (index < 0 || index >= purchaseSaves.length) return;
    purchaseSaves.splice(index, 1);
    savePurchaseSaves();
    populatePurchaseSavePanel();
    showToast('Save deleted', 'warning');
}

/**
 * Delete a saved state by its index.
 * @param {number} index
 */
function deleteSave(index) {
    if (index < 0 || index >= saves.length) return;
    const entry = saves[index];
    if (!entry) return;
    entry.deleted = true;
    entry.deletedAt = new Date().toISOString();
    saveSaves();
    populateSavePanel();
    showToast('Moved to Deleted Saves', 'warning');
}


function ensureUniqueSaveName(base) {
    const activeNames = new Set(
        saves.filter(e => e && !e.deleted)
            .map(e => (e.name || '').trim().toLowerCase())
    );
    let name = (base || '').trim() || 'Untitled';
    let candidate = name;
    let i = 1;
    while (activeNames.has(candidate.trim().toLowerCase())) {
        candidate = `${name} (restored${i > 1 ? ' ' + i : ''})`;
        i++;
    }
    return candidate;
}

function restoreDeletedSave(index) {
    if (index < 0 || index >= saves.length) return;
    const entry = saves[index];
    if (!entry || !entry.deleted) return;
    entry.name = ensureUniqueSaveName(entry.name);
    entry.deleted = false;
    delete entry.deletedAt;
    saveSaves();
    populateSavePanel();
    showToast('Save restored', 'success');
}

function deleteSavePermanent(index) {
    if (index < 0 || index >= saves.length) return;
    saves.splice(index, 1);
    saveSaves();
    populateSavePanel();
    showToast('Save permanently deleted', 'error');
}


function restoreDeletedSave(index) {
    if (index < 0 || index >= saves.length) return;
    const entry = saves[index];
    if (!entry || !entry.deleted) return;
    entry.name = ensureUniqueSaveName(entry.name);
    entry.deleted = false;
    delete entry.deletedAt;
    saveSaves();
    populateSavePanel();
    showToast('Save restored', 'success');
}

function deleteSavePermanent(index) {
    if (index < 0 || index >= saves.length) return;
    saves.splice(index, 1);
    saveSaves();
    populateSavePanel();
    showToast('Save permanently deleted', 'error');
}


// --- Import wizard helpers ---
function openImportModal() {
    importData = null;
    importMapping = null;
    importHasHeader = true;
    lastImportUndo = null;
    const backdrop = document.getElementById('importBackdrop');
    if (!backdrop) return;
    backdrop.classList.remove('hidden');
    buildImportStep1();
}
function closeImportModal() {
    const backdrop = document.getElementById('importBackdrop');
    if (backdrop) backdrop.classList.add('hidden');
}
// Parse CSV content into an array of rows (array of strings). Handles quoted fields.
function parseCsvContent(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    const data = [];
    for (const line of lines) {
        const row = [];
        let cell = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    cell += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (ch === ',' && !inQuotes) {
                row.push(cell);
                cell = '';
            } else {
                cell += ch;
            }
        }
        row.push(cell);
        data.push(row);
    }
    return data;
}
// Build Step 1 of import wizard: file selection and preview
function buildImportStep1() {
    const modal = document.getElementById('importModal');
    if (!modal) return;
    modal.innerHTML = '';
    // Header
    const h = document.createElement('div');
    h.className = 'text-lg font-medium';
    h.textContent = 'Import Deliveries – Step 1';
    modal.appendChild(h);
    const p = document.createElement('p');
    p.className = 'text-sm text-neutral-600';
    p.textContent = 'Select a CSV or Excel file (.csv, .xlsx) to import. First 20 rows will be previewed.';
    modal.appendChild(p);
    // Custom styled file picker
    const fileLabel = document.createElement('label');
    fileLabel.className = 'mt-3 inline-block px-4 py-2 bg-emerald-600 text-white rounded-md cursor-pointer hover:bg-emerald-700 transition-base';
    fileLabel.textContent = 'Select file';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.csv,.xls,.xlsx';
    // Allow selecting multiple files
    fileInput.multiple = true;
    fileInput.className = 'hidden';
    fileLabel.appendChild(fileInput);
    // Span to display chosen file name
    const fileNameSpan = document.createElement('span');
    fileNameSpan.className = 'ml-3 text-sm text-neutral-600';
    modal.appendChild(fileLabel);
    modal.appendChild(fileNameSpan);
    // Preview container
    const preview = document.createElement('div');
    preview.id = 'importPreview';
    preview.className = 'mt-4 max-h-64 overflow-auto border rounded text-xs';
    modal.appendChild(preview);
    // Buttons container
    const btns = document.createElement('div');
    btns.className = 'mt-4 flex justify-end gap-2';
    modal.appendChild(btns);
    // Cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'px-3 py-1 rounded-md bg-neutral-200 text-neutral-700 text-sm hover:bg-neutral-300 transition-base';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
        closeImportModal();
    });
    btns.appendChild(cancelBtn);
    // Next button
    const nextBtn = document.createElement('button');
    nextBtn.className = 'px-3 py-1 rounded-md bg-emerald-600 text-white text-sm hover:bg-emerald-700 transition-base';
    nextBtn.textContent = 'Next';
    nextBtn.disabled = true;
    nextBtn.addEventListener('click', () => {
        // Determine if first row is header via heuristic: if any cell matches known names
        importHasHeader = false;
        if (importData && importData.length > 0) {
            const first = importData[0].map(c => c.trim().toLowerCase());
            const known = ['date', 'shop', 'item', 'qty', 'quantity', 'per', 'price', 'paid', 'notes', 'category', 'deliver', 'delivery', 'by'];
            let matches = 0;
            for (const cell of first) {
                if (known.some(k => cell.includes(k))) {
                    matches++;
                }
            }
            if (matches >= 2) importHasHeader = true;
        }
        buildImportStep2();
    });
    btns.appendChild(nextBtn);
    // Handle file selection
    fileInput.addEventListener('change', (e) => {
        const files = Array.from(e.target.files || []);
        if (!files.length) {
            fileNameSpan.textContent = '';
            nextBtn.disabled = true;
            preview.innerHTML = '';
            return;
        }
        // Display selected file names
        fileNameSpan.textContent = files.map(f => f.name).join(', ');
        importData = [];
        preview.innerHTML = '';
        nextBtn.disabled = true;
        let remaining = files.length;
        // Helper to finalize after reading all files
        function finalize() {
            if (remaining > 0) return;
            // Remove empty rows
            importData = importData.filter(row => row && row.length > 0);
            if (!importData || importData.length === 0) {
                const msg = document.createElement('div');
                msg.className = 'p-2 text-neutral-500';
                msg.textContent = 'No data found in file(s).';
                preview.appendChild(msg);
                nextBtn.disabled = true;
                return;
            }
            // Render preview of first 20 rows across all data
            const table = document.createElement('table');
            table.className = 'w-full border-collapse';
            const tbody = document.createElement('tbody');
            table.appendChild(tbody);
            const maxRows = Math.min(20, importData.length);
            for (let i = 0; i < maxRows; i++) {
                const tr = document.createElement('tr');
                const row = importData[i];
                row.forEach(cell => {
                    const td = document.createElement('td');
                    td.className = 'border px-2 py-1 whitespace-nowrap';
                    td.textContent = cell;
                    tr.appendChild(td);
                });
                tbody.appendChild(tr);
            }
            preview.appendChild(table);
            nextBtn.disabled = false;
        }
        files.forEach(file => {
            // Only support CSV in this simplified implementation
            if (file.name.match(/\.xlsx$/i) || file.name.match(/\.xls$/i)) {
                // Use a modern alert modal instead of default alert
                showAlertModal('Excel import is not supported in this demo. Please provide CSV files.', 'Unsupported Format');
                remaining--;
                if (remaining === 0) finalize();
                return;
            }
            const reader = new FileReader();
            reader.onload = function (evt) {
                const result = evt.target.result;
                // Concatenate parsed data
                const parsed = parseCsvContent(result);
                if (Array.isArray(parsed)) importData = importData.concat(parsed);
                remaining--;
                if (remaining === 0) finalize();
            };
            reader.readAsText(file);
        });
    });
}
// Build Step 2: column mapping
function buildImportStep2() {
    const modal = document.getElementById('importModal');
    if (!modal) return;
    modal.innerHTML = '';
    const h = document.createElement('div');
    h.className = 'text-lg font-medium';
    h.textContent = 'Import Deliveries – Step 2';
    modal.appendChild(h);
    const p = document.createElement('p');
    p.className = 'text-sm text-neutral-600';
    p.textContent = 'Map your file columns to the appropriate fields.';
    modal.appendChild(p);
    // Determine columns count
    const firstRow = importData[0] || [];
    const colCount = firstRow.length;
    // Determine header row if present
    const headerRow = importHasHeader ? importData[0] : firstRow.map((_, i) => `Column ${i + 1}`);
    // List of fields to map
    const fields = [
        { key: 'date', label: 'Date' },
        { key: 'shop', label: 'Shop' },
        { key: 'item', label: 'Item' },
        { key: 'qty', label: 'Quantity' },
        { key: 'per', label: 'Price Per piece' },
        { key: 'paid', label: 'Paid (optional)' },
        { key: 'notes', label: 'Notes (optional)' },
        { key: 'category', label: 'Category (optional)' }
    ];
    // Mapping container
    const mapContainer = document.createElement('div');
    mapContainer.className = 'mt-4 space-y-3';
    fields.forEach(field => {
        const rowDiv = document.createElement('div');
        rowDiv.className = 'flex items-center gap-2';
        const label = document.createElement('label');
        label.className = 'w-40 text-sm text-neutral-600';
        label.textContent = field.label;
        const select = document.createElement('select');
        select.dataset.fieldKey = field.key;
        select.className = 'flex-1 rounded-md border px-2 py-1 text-sm';
        // Blank option for optional fields (notes, category, paid)
        if (field.key === 'paid' || field.key === 'notes' || field.key === 'category') {
            const blank = document.createElement('option');
            blank.value = '';
            blank.textContent = '— None —';
            select.appendChild(blank);
        }
        for (let i = 0; i < colCount; i++) {
            const opt = document.createElement('option');
            opt.value = i;
            opt.textContent = headerRow[i] || `Column ${i + 1}`;
            select.appendChild(opt);
        }
        // Preselect by header name
        if (importHasHeader) {
            const headerLower = headerRow.map(c => String(c).trim().toLowerCase());
            const index = headerLower.findIndex(col => {
                const key = field.key;
                if (key === 'date') return col.includes('date');
                if (key === 'shop') return col.includes('shop');
                if (key === 'item') return col.includes('item');
                if (key === 'qty') return col.includes('qty') || col.includes('quantity');
                if (key === 'per') return col.includes('per') || col.includes('price');
                if (key === 'paid') return col.includes('paid');
                if (key === 'notes') return col.includes('note');
                if (key === 'category') return col.includes('category');
                return false;
            });
            if (index >= 0) {
                select.value = index;
            }
        }
        rowDiv.appendChild(label);
        rowDiv.appendChild(select);
        mapContainer.appendChild(rowDiv);
    });
    modal.appendChild(mapContainer);
    // Buttons container
    const btns = document.createElement('div');
    btns.className = 'mt-4 flex justify-end gap-2';
    modal.appendChild(btns);
    const backBtn = document.createElement('button');
    backBtn.className = 'px-3 py-1 rounded-md bg-neutral-200 text-neutral-700 text-sm hover:bg-neutral-300 transition-base';
    backBtn.textContent = 'Back';
    backBtn.addEventListener('click', () => buildImportStep1());
    btns.appendChild(backBtn);
    const nextBtn = document.createElement('button');
    nextBtn.className = 'px-3 py-1 rounded-md bg-emerald-600 text-white text-sm hover:bg-emerald-700 transition-base';
    nextBtn.textContent = 'Next';
    nextBtn.addEventListener('click', () => {
        // Build mapping object
        importMapping = {};
        let valid = true;
        mapContainer.querySelectorAll('select').forEach(sel => {
            const key = sel.dataset.fieldKey;
            const val = sel.value;
            if (val === '' && (key === 'date' || key === 'shop' || key === 'item' || key === 'qty' || key === 'per')) {
                valid = false;
            }
            importMapping[key] = val === '' ? null : Number(val);
        });
        if (!valid) {
            // Show a friendly modal prompting user to map required fields
            showAlertModal('Please map all required fields (Date, Shop, Item, Quantity, Price per piece).', 'Mapping Required');
            return;
        }
        buildImportStep3();
    });
    btns.appendChild(nextBtn);
}
// Build Step 3: choose append/replace and import
function buildImportStep3() {
    const modal = document.getElementById('importModal');
    if (!modal) return;
    modal.innerHTML = '';
    const h = document.createElement('div');
    h.className = 'text-lg font-medium';
    h.textContent = 'Import Deliveries – Step 3';
    modal.appendChild(h);
    const summary = document.createElement('p');
    summary.className = 'text-sm text-neutral-600';
    const totalRows = importData ? (importHasHeader ? importData.length - 1 : importData.length) : 0;
    summary.textContent = `${totalRows} rows will be processed.`;
    modal.appendChild(summary);
    // Radio options for append/replace
    const opts = document.createElement('div');
    opts.className = 'mt-4 space-y-2';
    ['append', 'replace'].forEach(mode => {
        const label = document.createElement('label');
        label.className = 'flex items-center gap-2 text-sm';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'importMode';
        radio.value = mode;
        if (mode === 'append') radio.checked = true;
        const span = document.createElement('span');
        span.textContent = mode === 'append' ? 'Append to existing deliveries' : 'Replace existing deliveries';
        label.appendChild(radio);
        label.appendChild(span);
        opts.appendChild(label);
    });
    modal.appendChild(opts);
    // Buttons container
    const btns = document.createElement('div');
    btns.className = 'mt-4 flex justify-end gap-2';
    modal.appendChild(btns);
    const backBtn = document.createElement('button');
    backBtn.className = 'px-3 py-1 rounded-md bg-neutral-200 text-neutral-700 text-sm hover:bg-neutral-300 transition-base';
    backBtn.textContent = 'Back';
    backBtn.addEventListener('click', () => buildImportStep2());
    btns.appendChild(backBtn);
    const importBtn = document.createElement('button');
    importBtn.className = 'px-3 py-1 rounded-md bg-emerald-600 text-white text-sm hover:bg-emerald-700 transition-base';
    importBtn.textContent = 'Import';
    importBtn.addEventListener('click', () => {
        const selectedMode = opts.querySelector('input[name="importMode"]:checked').value;
        performImport(selectedMode === 'append');
    });
    btns.appendChild(importBtn);
}
// Perform the import using mapping and append flag
function performImport(append) {
    // Prepare to revert
    lastImportUndo = {
        previousRows: rows.map(r => ({ ...r })),
        previousTransactions: transactions.map(t => ({ ...t })),
        previousOverrides: { paid: overrideSumPaidCents, prev: overrideSumPrevCents }
    };
    // Map rows to newRows
    const newRows = [];
    let added = 0;
    let duplicates = 0;
    let invalid = 0;
    // Build set of existing keys for duplicate detection
    const existingKeys = new Set(rows.map(r => `${r.date}|${r.shop}|${r.item}|${r.quantity}`));
    const dataStart = importHasHeader ? 1 : 0;
    for (let i = dataStart; i < importData.length; i++) {
        const raw = importData[i];
        if (!raw || raw.length === 0) continue;
        const getVal = (key) => {
            const idx = importMapping[key];
            if (idx === null || idx === undefined || idx === '') return '';
            return raw[idx] || '';
        };
        const dateStr = getVal('date').trim();
        const shopStr = getVal('shop').trim();
        const itemStr = getVal('item').trim();
        const qtyStr = getVal('qty').trim();
        const perStr = getVal('per').trim();
        const paidStr = getVal('paid').trim();
        const notesStr = getVal('notes').trim();
        const catStr = getVal('category').trim();
        // Validate required fields
        if (!dateStr || !shopStr || !itemStr || !qtyStr || !perStr) {
            invalid++;
            continue;
        }
        // Normalize date (accept MM/DD/YYYY or YYYY-MM-DD)
        let isoDate;
        const dMatch = dateStr.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
        const mMatch = dateStr.match(/^(\d{1,2})[\/](\d{1,2})[\/](\d{4})$/);
        if (dMatch) {
            // yyyy-mm-dd or yyyy/mm/dd
            const y = dMatch[1];
            const m = dMatch[2].padStart(2, '0');
            const d = dMatch[3].padStart(2, '0');
            isoDate = `${y}-${m}-${d}`;
        } else if (mMatch) {
            // mm/dd/yyyy
            const m = mMatch[1].padStart(2, '0');
            const d = mMatch[2].padStart(2, '0');
            const y = mMatch[3];
            isoDate = `${y}-${m}-${d}`;
        } else {
            invalid++;
            continue;
        }
        const qty = parseInt(qtyStr.replace(/[^\d]/g, ''));
        const per = parseFloat(perStr.replace(/[^0-9.\-]/g, ''));
        if (!qty || !per || isNaN(qty) || isNaN(per)) {
            invalid++;
            continue;
        }
        const paid = paidStr ? parseFloat(paidStr.replace(/[^0-9.\-]/g, '')) : 0;
        if (isNaN(paid)) {
            invalid++;
            continue;
        }
        // Duplicate handling: do not skip duplicates. Just record duplicate count for summary.
        const key = `${isoDate}|${shopStr}|${itemStr}|${qty}`;
        if (existingKeys.has(key)) {
            duplicates++;
            // We still include duplicates, do not continue
        } else {
            existingKeys.add(key);
        }
        // Map category
        let category = legacyToSomali(catStr || '', CATEGORIES);
        // If category not provided but item matches categories list, use item
        if (!catStr && CATEGORIES.includes(itemStr)) {
            category = itemStr;
        }
        // Determine perPieceCents and totalCents
        const perCents = Math.round(per * 100);
        const totalCents = qty * perCents;
        const paidCents = Math.round((paid || 0) * 100);
        const prevBalCents = 0;
        const balanceCents = prevBalCents + totalCents - paidCents;
        newRows.push({
            id: uid(),
            date: isoDate,
            shop: shopStr,
            deliveredBy: '',
            item: itemStr,
            category: CATEGORIES.includes(category) ? category : 'Mix',
            quantity: qty,
            perPieceCents: perCents,
            totalCents,
            paidCents,
            previousBalanceCents: prevBalCents,
            balanceCents,
            notes: notesStr
        });
        added++;
    }
    // Import newRows
    if (append) {
        rows = rows.concat(newRows);
    } else {
        rows = newRows;
    }
    save();
    // No changes to transactions for import
    // Clear overrides for totals (treat imported data as baseline only)
    // overrideSumPaidCents and overrideSumPrevCents remain unchanged
    render();
    // Show summary and allow undo
    buildImportSummary(added, duplicates, invalid);
    showToast('Import complete', 'success');
}
function buildImportSummary(addedCount, duplicateCount, invalidCount) {
    const modal = document.getElementById('importModal');
    if (!modal) return;
    modal.innerHTML = '';
    const h = document.createElement('div');
    h.className = 'text-lg font-medium';
    h.textContent = 'Import Summary';
    modal.appendChild(h);
    const summary = document.createElement('ul');
    summary.className = 'mt-3 space-y-1 text-sm';
    const liAdded = document.createElement('li');
    liAdded.textContent = `Rows added: ${addedCount}`;
    // Show counts of added and invalid rows. We intentionally omit the duplicates line
    const liInv = document.createElement('li');
    liInv.textContent = `Invalid rows skipped: ${invalidCount}`;
    summary.appendChild(liAdded);
    // Removed duplicate count display per user request
    summary.appendChild(liInv);
    modal.appendChild(summary);
    // Buttons
    const btns = document.createElement('div');
    btns.className = 'mt-4 flex justify-end gap-2';
    modal.appendChild(btns);
    if (lastImportUndo) {
        const undoBtn = document.createElement('button');
        undoBtn.className = 'px-3 py-1 rounded-md bg-amber-500 text-white text-sm hover:bg-amber-600 transition-base';
        undoBtn.textContent = 'Undo import';
        undoBtn.addEventListener('click', () => {
            // Restore previous state
            if (lastImportUndo) {
                rows = lastImportUndo.previousRows.map(r => ({ ...r }));
                transactions = lastImportUndo.previousTransactions.map(t => ({ ...t }));
                overrideSumPaidCents = lastImportUndo.previousOverrides.paid;
                overrideSumPrevCents = lastImportUndo.previousOverrides.prev;
                save();
                saveTransactions();
                saveOverrides();
                render();
                lastImportUndo = null;
                showToast('Import undone', 'warning');
                closeImportModal();
            }
        });
        btns.appendChild(undoBtn);
    }
    const closeBtn = document.createElement('button');
    closeBtn.className = 'px-3 py-1 rounded-md bg-neutral-200 text-neutral-700 text-sm hover:bg-neutral-300 transition-base';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => {
        closeImportModal();
    });
    btns.appendChild(closeBtn);
}

// Sorting by shop functionality removed at user request

// Edit totals button and panel functionality
const editTotalsBtn = document.getElementById('editTotalsBtn');
const editTotalsPanel = document.getElementById('editTotalsPanel');
const editTotalPaidEl = document.getElementById('editTotalPaid');
const editPrevBalanceEl = document.getElementById('editPrevBalance');
const saveTotalsBtn = document.getElementById('saveTotalsBtn');
const cancelTotalsBtn = document.getElementById('cancelTotalsBtn');
if (editTotalsBtn) {
    editTotalsBtn.addEventListener('click', () => {
        if (!editTotalsPanel) return;
        if (editTotalsPanel.classList.contains('hidden')) {
            // Pre-fill fields with current values (overrides or computed)
            const totals = lastComputedTotals || { paid: 0, prev: 0, value: 0 };
            // Use combined paid (paid + deductions) for prefill
            const currentPaid = (overrideSumPaidCents !== null && !isNaN(overrideSumPaidCents)) ? overrideSumPaidCents : ((totals.paid || 0) + (totals.deduct || 0));
            const currentPrev = (overrideSumPrevCents !== null && !isNaN(overrideSumPrevCents)) ? overrideSumPrevCents : totals.prev;
            if (editTotalPaidEl) editTotalPaidEl.value = (currentPaid / 100).toFixed(2);
            if (editPrevBalanceEl) editPrevBalanceEl.value = (currentPrev / 100).toFixed(2);
            editTotalsPanel.classList.remove('hidden');
        } else {
            editTotalsPanel.classList.add('hidden');
        }
    });
}
if (saveTotalsBtn) {
    saveTotalsBtn.addEventListener('click', () => {
        // Parse and save overrides
        const newPaidCents = parseCents(editTotalPaidEl.value);
        const newPrevCents = parseCents(editPrevBalanceEl.value);
        overrideSumPaidCents = (isNaN(newPaidCents) ? null : newPaidCents);
        overrideSumPrevCents = (isNaN(newPrevCents) ? null : newPrevCents);
        saveOverrides();
        if (editTotalsPanel) editTotalsPanel.classList.add('hidden');
        render();
    });
}
if (cancelTotalsBtn) {
    cancelTotalsBtn.addEventListener('click', () => {
        // Simply hide without saving
        if (editTotalsPanel) editTotalsPanel.classList.add('hidden');
    });
}

// --- Transactions: event handlers ---
// Toggle add transaction panel
if (addTransactionBtn) {
    addTransactionBtn.addEventListener('click', () => {
        if (!addTransactionPanel) return;
        if (addTransactionPanel.classList.contains('hidden')) {
            // Prefill defaults
            if (transDateEl) transDateEl.value = todayISO();
            if (transTypeEl) transTypeEl.value = 'payment';
            if (transAmountEl) transAmountEl.value = '';
            if (transNotesEl) transNotesEl.value = '';
            addTransactionPanel.classList.remove('hidden');
        } else {
            addTransactionPanel.classList.add('hidden');
        }
    });
}
// Save new transaction
if (saveTransBtn) {
    saveTransBtn.addEventListener('click', () => {
        if (!transDateEl || !transTypeEl || !transAmountEl) return;
        const date = transDateEl.value || todayISO();
        const type = transTypeEl.value === 'deduction' ? 'deduction' : 'payment';
        const amount = parseCents(transAmountEl.value);
        const notes = transNotesEl ? transNotesEl.value.trim() : '';
        // Validate transaction amount (>0)
        if (!amount || amount <= 0) {
            markFieldError(transAmountEl, errorTransAmountEl, 'Amount must be positive.');
            return;
        } else {
            clearFieldError(transAmountEl, errorTransAmountEl);
        }
        transactions.push({
            id: uid(),
            date,
            type,
            amountCents: amount,
            notes
        });
        saveTransactions();
        if (addTransactionPanel) addTransactionPanel.classList.add('hidden');
        render();
    });
}
// Cancel add transaction panel
if (cancelTransBtn) {
    cancelTransBtn.addEventListener('click', () => {
        if (addTransactionPanel) addTransactionPanel.classList.add('hidden');
    });
}

// --- Inline edit helpers ---
const EDITABLE_FIELDS = new Set(['date', 'shop', 'deliveredBy', 'item', 'quantity', 'perPieceCents', 'paidCents', 'notes']);
let activeEditor = null;

function applyRowUpdate(id, field, rawValue) {
    const r = rows.find(x => x.id === id);
    if (!r) return;
    switch (field) {
        case 'date':
            r.date = rawValue || r.date; break;
        case 'shop':
            r.shop = String(rawValue || '').trim(); break;
        case 'deliveredBy':
            r.deliveredBy = String(rawValue || '').trim(); break;
        case 'item':
            r.item = String(rawValue || '').trim(); break;
        case 'quantity': {
            const q = Math.max(0, parseInt(rawValue || '0')) || 0;
            r.quantity = q;
            r.totalCents = q * (r.perPieceCents || 0);
            r.balanceCents = (r.previousBalanceCents || 0) + r.totalCents - (r.paidCents || 0);
            // Recompute profit when quantity changes
            const costVal = r.costCents || 0;
            r.profitCents = q * ((r.perPieceCents || 0) - costVal);
            break;
        }
        case 'perPieceCents': {
            const p = parseCents(rawValue);
            r.perPieceCents = p;
            r.totalCents = (r.quantity || 0) * p;
            r.balanceCents = (r.previousBalanceCents || 0) + r.totalCents - (r.paidCents || 0);
            // Recompute profit when price changes
            const costVal = r.costCents || 0;
            r.profitCents = (r.quantity || 0) * (p - costVal);
            break;
        }
        case 'paidCents': {
            const paid = parseCents(rawValue);
            r.paidCents = paid;
            r.balanceCents = (r.previousBalanceCents || 0) + (r.totalCents || 0) - paid;
            break;
        }
        case 'notes':
            r.notes = String(rawValue || ''); break;
    }
    save();
    render();
}

// ================================ Purchases inline editing ================================

/**
 * Start editing a purchase cell. Builds an appropriate input or select based on
 * the field and replaces the cell's contents. When editing finishes via
 * blur/Enter/Escape, the value is committed via applyPurchaseUpdate().
 *
 * @param {HTMLTableCellElement} td The table cell to edit
 */
function startPurchaseEdit(td) {
    if (!td) return;
    const tr = td.closest('tr');
    const id = tr?.dataset?.pid;
    const field = td.dataset.field;
    if (!id || !field) return;
    // Prevent multiple editors in the same cell
    if (td.querySelector('.cell-editor')) return;
    // Build editor element
    const p = purchases.find(x => x.id === id);
    if (!p) return;
    let input;
    if (field === 'item') {
        // Dropdown of purchase items
        input = document.createElement('select');
        purchaseItems.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            input.appendChild(opt);
        });
        // Include current value if not in the list
        if (!purchaseItems.includes(p.item)) {
            const opt = document.createElement('option');
            opt.value = p.item;
            opt.textContent = p.item;
            input.appendChild(opt);
        }
        input.value = p.item;
    } else if (field === 'unit') {
        input = document.createElement('select');
        const units = ['lb', 'kg', 'gallon', 'liter', 'dozen', 'unit', 'pack'];
        units.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u;
            opt.textContent = u;
            input.appendChild(opt);
        });
        input.value = p.unit;
    } else if (field === 'qty') {
        input = document.createElement('input');
        input.type = 'number';
        input.min = '0';
        input.step = 'any';
        input.value = String(p.qty || 0);
    } else if (field === 'totalPaid') {
        input = document.createElement('input');
        input.type = 'number';
        input.step = '0.01';
        input.min = '0';
        input.value = (p.totalPaidCents / 100).toFixed(2);
    } else if (field === 'date') {
        input = document.createElement('input');
        input.type = 'date';
        // Use ISO date format if possible
        if (p.date && /\d{4}-\d{2}-\d{2}/.test(p.date)) {
            input.value = p.date;
        } else {
            try {
                input.value = new Date(p.date).toISOString().slice(0, 10);
            } catch {
                input.value = todayISO();
            }
        }
    } else {
        // Unknown field or non-editable field; abort
        return;
    }
    input.className = 'cell-editor';
    const original = td.innerHTML;
    td.innerHTML = '';
    td.appendChild(input);
    input.focus();
    if (input.select) try { input.select(); } catch { /* ignore */ }
    // Commit/cancel handlers
    const commit = () => {
        // Determine raw value and apply
        let value = input.value;
        applyPurchaseUpdate(id, field, value);
    };
    const cancel = () => {
        td.innerHTML = original;
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === 'Tab') {
            ev.preventDefault();
            commit();
        } else if (ev.key === 'Escape') {
            ev.preventDefault();
            cancel();
        }
    });
}

/**
 * Apply a value update to a purchase and recalculate derived properties. After
 * updating, the purchases table and calculator defaults are re-rendered. The
 * cost breakdown is recomputed to ensure costString and base units remain
 * accurate. The rawValue may be a string representing a number or date.
 *
 * @param {string} id Purchase id
 * @param {string} field Field being updated (date, item, qty, unit, totalPaid)
 * @param {string} rawValue Raw value from the editor
 */
function applyPurchaseUpdate(id, field, rawValue) {
    const idx = purchases.findIndex(p => p.id === id);
    if (idx === -1) return;
    const p = purchases[idx];
    switch (field) {
        case 'date':
            // Accept ISO date strings or attempt to parse other date formats
            if (rawValue) {
                p.date = rawValue;
            }
            break;
        case 'item': {
            const newItem = String(rawValue || '').trim();
            if (newItem) {
                p.item = newItem;
            }
            break;
        }
        case 'qty': {
            const q = parseFloat(rawValue || '0');
            p.qty = (!isNaN(q) && q >= 0) ? q : 0;
            break;
        }
        case 'unit': {
            const u = String(rawValue || '').trim();
            if (u) {
                p.unit = u;
            }
            break;
        }
        case 'totalPaid': {
            const cents = parseCents(rawValue);
            p.totalPaidCents = cents;
            break;
        }
        default:
            return;
    }
    // Recalculate derived fields (base quantity, cost per unit, cost string and unit price)
    const totalCents = p.totalPaidCents || 0;
    const { baseQuantity, baseUnit, baseCostCents, costString } = computeBaseForPurchase(p.item, p.qty, p.unit, totalCents);
    p.baseQuantity = baseQuantity;
    p.baseUnit = baseUnit;
    p.baseCostCents = baseCostCents;
    p.costString = costString;
    // Unit price per purchase unit
    p.unitPriceCents = (p.qty > 0) ? Math.round(totalCents / p.qty) : 0;
    // Save changes and refresh UI
    purchases[idx] = p;
    savePurchases(purchases);
    renderPurchases();
    updateCalculatorDefaults();
}

// ================================ Shop balances inline editing ================================

/**
 * Begin editing a cell in the shop balances table. Only the 'paid' and 'prev'
 * fields are editable. The editor is a numeric input allowing dollar entry.
 * After editing, the difference between the new value and the current aggregate
 * is applied to one of the underlying delivery rows for that shop via
 * applyShopBalanceUpdate().
 *
 * @param {HTMLTableCellElement} td The cell to edit
 */
function startShopBalanceEdit(td) {
    if (!td) return;
    const shop = td.dataset.shop;
    const field = td.dataset.field;
    if (!shop || !field) return;
    // Only allow editing for paid and prev fields
    if (field !== 'paid' && field !== 'prev') return;
    // Avoid multiple editors in the same cell
    if (td.querySelector('.cell-editor')) return;
    // Parse current value (in dollars) without the $ symbol
    const currentText = td.textContent || '';
    const match = currentText.replace(/[^0-9.-]/g, '');
    const currentVal = parseFloat(match || '0');
    // Create numeric input
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '0.01';
    input.min = '0';
    input.value = currentVal.toFixed(2);
    input.className = 'cell-editor';
    const original = td.innerHTML;
    td.innerHTML = '';
    td.appendChild(input);
    input.focus();
    if (input.select) try { input.select(); } catch { /* ignore */ }
    const commit = () => {
        const rawVal = parseFloat(input.value);
        if (!isNaN(rawVal) && rawVal >= 0) {
            const newCents = Math.round(rawVal * 100);
            applyShopBalanceUpdate(shop, field, newCents);
        }
    };
    const cancel = () => {
        td.innerHTML = original;
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === 'Tab') {
            ev.preventDefault();
            commit();
        } else if (ev.key === 'Escape') {
            ev.preventDefault();
            cancel();
        }
    });
}

/**
 * Apply an updated aggregate value for a shop's paid or previous balance. The
 * difference between the new value and the current aggregate is applied to a
 * single delivery row for that shop. This modification updates the
 * appropriate paidCents or previousBalanceCents field on that row and
 * recomputes its balance. After updating, the main render() function is
 * invoked to refresh the UI.
 *
 * @param {string} shop The shop name
 * @param {string} field Either 'paid' or 'prev'
 * @param {number} newCents New aggregate value in cents
 */
function applyShopBalanceUpdate(shop, field, newCents) {
    // Find all deliveries for this shop
    const shopRows = rows.filter(r => r.shop === shop);
    if (shopRows.length === 0) return;
    // Compute current aggregate for the field
    let currentAgg = 0;
    if (field === 'paid') {
        shopRows.forEach(r => { currentAgg += r.paidCents || 0; });
    } else if (field === 'prev') {
        shopRows.forEach(r => { currentAgg += r.previousBalanceCents || 0; });
    }
    const diff = newCents - currentAgg;
    if (diff === 0) {
        render();
        return;
    }
    if (field === 'paid') {
        // Apply difference to the most recent delivery (first in rows array)
        const target = shopRows[0];
        target.paidCents = (target.paidCents || 0) + diff;
        // Ensure paid is not negative
        if (target.paidCents < 0) target.paidCents = 0;
        // Recompute balance for that row
        target.balanceCents = (target.previousBalanceCents || 0) + (target.totalCents || 0) - (target.paidCents || 0);
    } else if (field === 'prev') {
        // Apply difference to the earliest delivery (last in array)
        const target = shopRows[shopRows.length - 1];
        target.previousBalanceCents = (target.previousBalanceCents || 0) + diff;
        if (target.previousBalanceCents < 0) target.previousBalanceCents = 0;
        target.balanceCents = (target.previousBalanceCents || 0) + (target.totalCents || 0) - (target.paidCents || 0);
    }
    save();
    render();
}

function startEdit(td) {
    const tr = td.closest('tr');
    const id = tr?.dataset?.id;
    const field = td.dataset.field;
    if (!id || !EDITABLE_FIELDS.has(field)) return;
    if (td.querySelector('.cell-editor')) return; // already editing
    if (activeEditor) {
        activeEditor.blur();
    }

    const row = rows.find(r => r.id === id);
    if (!row) return;

    // Build appropriate editor
    let input;
    if (field === 'item') {
        input = document.createElement('select');
        CATEGORIES.forEach(name => {
            const opt = document.createElement('option'); opt.value = name; opt.textContent = name; input.appendChild(opt);
        });
        if (!CATEGORIES.includes(row.item)) {
            const opt = document.createElement('option'); opt.value = row.item; opt.textContent = row.item; input.appendChild(opt);
        }
        input.value = row.item;
    } else if (field === 'date') {
        input = document.createElement('input');
        input.type = 'date';
        input.value = (row.date && /\d{4}-\d{2}-\d{2}/.test(row.date)) ? row.date : new Date(row.date).toISOString().slice(0, 10);
    } else if (field === 'quantity') {
        input = document.createElement('input');
        input.type = 'number'; input.min = '0'; input.step = '1';
        input.value = String(row.quantity || 0);
    } else if (field === 'perPieceCents' || field === 'paidCents') {
        input = document.createElement('input');
        input.type = 'number'; input.step = '0.01'; input.min = '0';
        const cents = field === 'perPieceCents' ? (row.perPieceCents || 0) : (row.paidCents || 0);
        input.value = (cents / 100).toFixed(2);
    } else { // shop, notes
        input = document.createElement('input');
        input.type = 'text'; input.value = String(row[field] || '');
    }
    input.className = 'cell-editor';

    const original = td.innerHTML;
    td.innerHTML = '';
    td.appendChild(input);
    input.focus();
    if (input.select) try { input.select(); } catch { }
    activeEditor = input;

    const commit = () => {
        if (!activeEditor) return;
        const val = input.value;
        if (field === 'quantity') {
            const q = Math.max(0, parseInt(val || '0')) || 0;
            applyRowUpdate(id, field, q);
        } else if (field === 'perPieceCents' || field === 'paidCents') {
            applyRowUpdate(id, field, val);
        } else if (field === 'date') {
            if (!val) { td.innerHTML = original; activeEditor = null; return; }
            applyRowUpdate(id, field, val);
        } else {
            applyRowUpdate(id, field, val);
        }
    };
    const cancel = () => {
        td.innerHTML = original;
        activeEditor = null;
    };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === 'Tab') { ev.preventDefault(); commit(); }
        else if (ev.key === 'Escape') { ev.preventDefault(); cancel(); }
    });
}

// --- Render ---
function render() {
    // Determine which rows to display based on currentShopFilter
    let rowsForDisplay = (currentShopFilter === null)
        ? rows.slice()
        : rows.filter(r => r.shop === currentShopFilter);
    // Apply text search filter if provided
    if (searchQuery && searchQuery.trim() !== '') {
        const q = searchQuery.trim().toLowerCase();
        rowsForDisplay = rowsForDisplay.filter(r => {
            // Convert key fields to strings and search for match
            const fields = [r.date, r.shop, r.deliveredBy, r.item, r.notes];
            for (const f of fields) {
                if (f && String(f).toLowerCase().includes(q)) return true;
            }
            // Also search formatted date (MM/DD/YYYY)
            const formatted = fmtDate(r.date || '').toLowerCase();
            return formatted.includes(q);
        });
    }
    // Apply sorting if a sort field is selected
    if (sortField) {
        rowsForDisplay.sort((a, b) => {
            let av, bv;
            switch (sortField) {
                case 'date':
                    av = a.date;
                    bv = b.date;
                    // Compare ISO date strings (lexicographical) or fallback to numbers
                    if (av === bv) return 0;
                    return (av < bv ? -1 : 1) * (sortAsc ? 1 : -1);
                case 'shop':
                    av = (a.shop || '').toLowerCase();
                    bv = (b.shop || '').toLowerCase();
                    if (av === bv) return 0;
                    return (av < bv ? -1 : 1) * (sortAsc ? 1 : -1);
                case 'deliveredBy':
                    av = (a.deliveredBy || '').toLowerCase();
                    bv = (b.deliveredBy || '').toLowerCase();
                    if (av === bv) return 0;
                    return (av < bv ? -1 : 1) * (sortAsc ? 1 : -1);
                case 'item':
                    av = (a.item || '').toLowerCase();
                    bv = (b.item || '').toLowerCase();
                    if (av === bv) return 0;
                    return (av < bv ? -1 : 1) * (sortAsc ? 1 : -1);
                case 'qty':
                    av = a.quantity || 0;
                    bv = b.quantity || 0;
                    return (av - bv) * (sortAsc ? 1 : -1);
                case 'per':
                    av = a.perPieceCents || 0;
                    bv = b.perPieceCents || 0;
                    return (av - bv) * (sortAsc ? 1 : -1);
                case 'total':
                    av = a.totalCents || 0;
                    bv = b.totalCents || 0;
                    return (av - bv) * (sortAsc ? 1 : -1);
                case 'paid':
                    av = a.paidCents || 0;
                    bv = b.paidCents || 0;
                    return (av - bv) * (sortAsc ? 1 : -1);
                case 'balance':
                    av = a.balanceCents || 0;
                    bv = b.balanceCents || 0;
                    return (av - bv) * (sortAsc ? 1 : -1);
                default:
                    return 0;
            }
        });
    }

    // Summary numbers and per-category counts
    const counts = Object.fromEntries(CATEGORIES.map(c => [c, 0]));
    const totals = rowsForDisplay.reduce((acc, r) => {
        acc.value += r.totalCents || 0;
        acc.pieces += r.quantity || 0;
        acc.prev += r.previousBalanceCents || 0;
        // Compute profit for this row using stored profitCents or derive from price and cost
        const profitRow = (typeof r.profitCents === 'number') ? r.profitCents : ((r.perPieceCents || 0) - (r.costCents || 0)) * (r.quantity || 0);
        acc.profit += profitRow;
        const cat = CATEGORIES.includes(r.category) ? r.category : 'Mix';
        counts[cat] = (counts[cat] || 0) + (r.quantity || 0);
        return acc;
    }, { value: 0, pieces: 0, prev: 0, profit: 0 });

    // Compute payments/deductions
    // Auto payments from deliveries
    let autoPaidCents = 0;
    for (const r of rowsForDisplay) {
        autoPaidCents += r.paidCents || 0;
    }
    // Manual transactions totals
    let manualPaidCents = 0;
    let manualDeductCents = 0;
    for (const t of transactions) {
        if (t.type === 'payment') manualPaidCents += t.amountCents || 0;
        else manualDeductCents += t.amountCents || 0;
    }
    // Total paid and total deductions
    const totalPaidCents = autoPaidCents + manualPaidCents;
    const totalDeductCents = manualDeductCents;
    totals.paid = totalPaidCents;
    totals.deduct = totalDeductCents;
    // Combined paid treats deductions as additional payments
    const combinedPaidCents = totalPaidCents + totalDeductCents;

    // Store computed totals for later use (for overrides panel pre-fill)
    lastComputedTotals = totals;

    // Determine display values with overrides
    // Compute raw combined paid (payments + deductions) from the current rows and transactions
    const computedCombinedPaid = combinedPaidCents;
    // Compute raw previous balance sum from all deliveries
    const computedPrev = totals.prev;
    /*
     * If an override has been set for total paid or previous balance, treat that override as
     * a baseline amount. When new deliveries are added or edited, their values are added
     * on top of the baseline rather than replacing it. This allows the summary totals
     * (Total Paid and Previous Balance) to remain accurate even after manual edits.
     */
    const displayPaidCombined = (overrideSumPaidCents !== null && !isNaN(overrideSumPaidCents))
        ? (overrideSumPaidCents + computedCombinedPaid)
        : computedCombinedPaid;
    const displayPrev = (overrideSumPrevCents !== null && !isNaN(overrideSumPrevCents))
        ? (overrideSumPrevCents + computedPrev)
        : computedPrev;

    // Update summary values with smooth animations
    animateCurrency(sumValue, totals.value);
    // Display total paid in summary (combined paid)
    if (typeof sumPaid !== 'undefined' && sumPaid && sumPaid.textContent !== undefined) {
        animateCurrency(sumPaid, displayPaidCombined);
    }
    animateCurrency(sumPrev, displayPrev);
    // Current balance uses baseline+computed previous balance and combined paid/deduct: prev + (value - combinedPaid)
    const remaining = displayPrev + (totals.value - displayPaidCombined);
    animateCurrency(sumRemaining, remaining);
    applyBalanceCue(remaining, sumRemaining, sumRemainingTag);

    animatePlainNumber(sumPieces, totals.pieces);

    // Update total profit display
    if (sumProfit) {
        animateCurrency(sumProfit, totals.profit);
        // Reset profit color classes
        sumProfit.classList.remove('text-emerald-600', 'text-red-600');
        if (totals.profit > 0) {
            sumProfit.classList.add('text-emerald-600');
        } else if (totals.profit < 0) {
            sumProfit.classList.add('text-red-600');
        }
    }

    // Category breakdown: only show categories used (count > 0) with badges
    // Build item breakdown: counts per item with badges
    if (itemBreakdown) {
        itemBreakdown.innerHTML = '';
        // Compute counts by item
        const itemCounts = {};
        for (const r of rowsForDisplay) {
            const key = r.item || 'Unknown';
            itemCounts[key] = (itemCounts[key] || 0) + (r.quantity || 0);
        }
        Object.entries(itemCounts).forEach(([itemName, count]) => {
            const div = document.createElement('div');
            div.className = 'flex items-center justify-between';
            const badgeSpan = document.createElement('span');
            badgeSpan.className = 'badge ' + getBadgeClass(itemName);
            badgeSpan.textContent = itemName;
            const countSpan = document.createElement('span');
            countSpan.className = 'tabular-nums';
            countSpan.textContent = count;
            div.appendChild(badgeSpan);
            div.appendChild(countSpan);
            itemBreakdown.appendChild(div);
        });
    }

    // Render transactions card with updated totals and list
    renderTransactions();

    // Table
    rowsBody.innerHTML = '';
    if (rowsForDisplay.length === 0) {
        rowsBody.appendChild(emptyRow);
        emptyRow.style.display = '';
        return;
    }
    emptyRow.style.display = 'none';

    let rowNum = 1;
    for (const r of rowsForDisplay) {
        const tr = document.createElement('tr');
        tr.className = 'border-t hover:bg-neutral-50 transition-base';
        tr.dataset.id = r.id;
        const balanceClass = r.balanceCents === 0 ? 'text-emerald-600' : (r.balanceCents > 0 ? 'text-amber-600' : 'text-blue-600');
        // Build item badge
        const itemBadge = `<span class="badge ${getBadgeClass(r.item)}">${r.item}</span>`;
        tr.innerHTML = `
          <td class="py-2 pr-3 text-right">${rowNum}</td>
          <td class="py-2 pr-3 whitespace-nowrap editable" data-field="date" title="Click to edit">${fmtDate(r.date)}</td>
          <td class="py-2 pr-3 editable" data-field="shop" title="Click to edit">${r.shop}</td>
          <td class="py-2 pr-3 editable print-hide" data-field="deliveredBy" title="Click to edit">${r.deliveredBy || ''}</td>
          <td class="py-2 pr-3 editable" data-field="item" title="Click to edit">${itemBadge}</td>
          <!-- Category cell remains hidden -->
          <td class="py-2 pr-3 editable" data-field="quantity" title="Click to edit">${r.quantity}</td>
          <td class="py-2 pr-3 editable" data-field="perPieceCents" title="Click to edit">${fmt(r.perPieceCents)}</td>
          <td class="py-2 pr-3" title="Computed">${fmt(r.totalCents)}</td>
          <td class="py-2 pr-3 editable" data-field="paidCents" title="Click to edit">${fmt(r.paidCents)}</td>
          <td class="py-2 pr-3 ${balanceClass}" title="Computed">${fmt(r.balanceCents)}</td>
          <td class="py-2 pr-3 max-w-[300px] truncate editable print-hide" data-field="notes" title="Click to edit">${r.notes || ''}</td>
          <td class="py-2 pr-3 print-hide"><button class="rounded-lg border px-2 py-1 text-red-600 hover:bg-red-50 transition-base">Delete</button></td>
        `;
        // Attach deletion click with custom confirmation modal
        tr.querySelector('button').addEventListener('click', () => {
            // Ask for confirmation before deleting the row
            showConfirmModal('Are you sure you want to delete this delivery?', () => {
                deleteRow(r.id);
            }, 'Delete Delivery', 'danger');
        });
        rowsBody.appendChild(tr);
        rowNum++;
    }

    // Update print summary for print view
    const printSumEl = document.getElementById('printSummary');
    if (printSumEl) {
        const val = fmt(totals.value);
        const paidStr = fmt(displayPaidCombined);
        const prevStr = fmt(displayPrev);
        const remainStr = fmt(remaining);
        // Include total pieces in print summary for clarity in printed reports
        printSumEl.innerHTML = `
                <table class="w-full text-sm print-summary">
                    <tbody>
                        <tr><th class="text-left pr-2">Total pieces</th><td>${totals.pieces}</td></tr>
                        <tr><th class="text-left pr-2">Total value</th><td>${val}</td></tr>
                        <tr><th class="text-left pr-2">Total paid</th><td>${paidStr}</td></tr>
                        <tr><th class="text-left pr-2">Previous balance</th><td>${prevStr}</td></tr>
                        <tr><th class="text-left pr-2">Current balance</th><td>${remainStr}</td></tr>
                    </tbody>
                </table>`;
    }

    // Update analytics charts with the displayed rows
    updateChartsForRows(rowsForDisplay);

    // Rebuild shop tabs and dropdown after rendering to account for any new or removed shops
    buildShopTabs();
    // Populate the shop dropdown to reflect current shops
    populateShopDropdown();

    // Update shop balances summary
    renderShopBalances();

    // Update sort indicators in table headers
    updateSortIndicators();
}

// ============================== Initialization of calculator saves ==============================
// Load saved calculator results on startup and populate the section. This
// ensures any previously stored results are displayed when the page is loaded.
calcSaves = loadCalcSaves();
populateCalcSavesSection();

/**
 * Build the shop balances summary table. Aggregates deliveries by shop and
 * displays totals for pieces, value, paid, previous balance, current balance,
 * and profit. This summary uses all rows (not filtered by search) so the
 * user can quickly see outstanding balances per shop.
 */
function renderShopBalances() {
    const tbody = document.getElementById('shopBalancesBody');
    if (!tbody) return;
    // Compute aggregate data per shop across all rows
    const aggregates = {};
    rows.forEach(r => {
        const key = r.shop || 'Unknown';
        if (!aggregates[key]) {
            aggregates[key] = {
                pieces: 0,
                value: 0,
                paid: 0,
                prev: 0,
                current: 0,
                profit: 0
            };
        }
        const agg = aggregates[key];
        agg.pieces += r.quantity || 0;
        agg.value += r.totalCents || 0;
        agg.paid += r.paidCents || 0;
        agg.prev += r.previousBalanceCents || 0;
        // Calculate current balance using per-row balance
        agg.current += r.balanceCents || 0;
        // Profit per row (prefer stored profitCents)
        const p = (typeof r.profitCents === 'number') ? r.profitCents : ((r.perPieceCents || 0) - (r.costCents || 0)) * (r.quantity || 0);
        agg.profit += p;
    });
    // Convert aggregates to array and sort by shop name
    const rowsArray = Object.entries(aggregates).map(([shop, data]) => {
        return { shop, ...data };
    });
    rowsArray.sort((a, b) => a.shop.localeCompare(b.shop));
    // Build table rows
    tbody.innerHTML = '';
    if (rowsArray.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td class="py-3 text-neutral-500" colspan="7">No shops yet</td>`;
        tbody.appendChild(tr);
        return;
    }
    rowsArray.forEach(entry => {
        const tr = document.createElement('tr');
        tr.className = 'border-t hover:bg-neutral-50 transition-base';
        // Determine color for current balance: owed (amber), paid off (emerald), overpaid (blue)
        let balanceClass = '';
        if (entry.current === 0) balanceClass = 'text-emerald-600';
        else if (entry.current > 0) balanceClass = 'text-amber-600';
        else balanceClass = 'text-blue-600';
        // Profit color cue
        let profitClass = '';
        if (entry.profit > 0) profitClass = 'text-emerald-600';
        else if (entry.profit < 0) profitClass = 'text-red-600';
        tr.innerHTML = `
                    <td class="py-2 pr-3">${entry.shop}</td>
                    <td class="py-2 pr-3 text-right tabular-nums">${entry.pieces}</td>
                    <td class="py-2 pr-3 text-right tabular-nums">${fmt(entry.value)}</td>
                    <td class="py-2 pr-3 text-right tabular-nums editable-balance" data-shop="${entry.shop}" data-field="paid">${fmt(entry.paid)}</td>
                    <td class="py-2 pr-3 text-right tabular-nums editable-balance" data-shop="${entry.shop}" data-field="prev">${fmt(entry.prev)}</td>
                    <td class="py-2 pr-3 text-right ${balanceClass} tabular-nums">${fmt(entry.current)}</td>
                    <td class="py-2 pr-3 text-right ${profitClass} tabular-nums">${fmt(entry.profit)}</td>
                `;
        tbody.appendChild(tr);
    });
}

/**
 * Updates the arrow indicators on sortable table headers to reflect the current sorting state.
 * Adds an up or down arrow next to the header label when sorted, and removes any arrow when unsorted.
 */
function updateSortIndicators() {
    const headers = document.querySelectorAll('th[data-sort]');
    headers.forEach(th => {
        const field = th.getAttribute('data-sort');
        // Preserve the original label text in a data attribute the first time
        if (!th.dataset.originalLabel) {
            // Remove any existing arrows from the text content by trimming arrow characters
            const text = th.textContent.replace(/[\u25B2\u25BC\u2191\u2193]/g, '').trim();
            th.dataset.originalLabel = text;
        }
        const label = th.dataset.originalLabel;
        if (sortField === field) {
            // Choose arrow direction based on sortAsc
            const arrow = sortAsc ? '▲' : '▼';
            th.innerHTML = `${label}<span class="ml-1 text-xs">${arrow}</span>`;
            // Highlight the active sort header for visual clarity
            th.classList.add('text-emerald-600');
        } else {
            th.innerHTML = label;
            th.classList.remove('text-emerald-600');
        }
    });
}

// --- Transactions rendering ---
// Build the transactions card: totals and list grouped by date
function renderTransactions() {
    if (!transactionsTotalsEl || !transactionsListEl) return;
    // Compute totals for payments and deductions
    let autoPaid = 0;
    for (const r of rows) {
        autoPaid += r.paidCents || 0;
    }
    let manualPaid = 0;
    let manualDeduct = 0;
    for (const t of transactions) {
        if (t.type === 'payment') manualPaid += t.amountCents || 0;
        else manualDeduct += t.amountCents || 0;
    }
    const totalPaid = autoPaid + manualPaid;
    const totalDeduct = manualDeduct;
    // Update totals display
    transactionsTotalsEl.innerHTML = '';
    const paidDiv = document.createElement('div');
    paidDiv.className = 'flex justify-between';
    paidDiv.innerHTML = `<span>Total Paid</span><span class="font-medium">${fmt(totalPaid)}</span>`;
    const deductDiv = document.createElement('div');
    deductDiv.className = 'flex justify-between';
    deductDiv.innerHTML = `<span>Total Deductions</span><span class="font-medium">${fmt(totalDeduct)}</span>`;
    transactionsTotalsEl.appendChild(paidDiv);
    transactionsTotalsEl.appendChild(deductDiv);
    // Build list of transactions grouped by date
    // Generate auto-transactions from rows (only positive payments)
    const autoTrans = rows.map(r => ({
        id: 'auto-' + r.id,
        date: r.date,
        type: 'payment',
        amountCents: r.paidCents || 0,
        notes: ''
    })).filter(t => t.amountCents > 0);
    const all = [...autoTrans, ...transactions.filter(t => t.amountCents > 0)];
    // Sort by date descending then by id for stability
    all.sort((a, b) => {
        if (a.date === b.date) return 0;
        return a.date < b.date ? 1 : -1;
    });
    transactionsListEl.innerHTML = '';
    let currentDate = null;
    for (const t of all) {
        if (t.date !== currentDate) {
            currentDate = t.date;
            const header = document.createElement('div');
            header.className = 'mt-2 font-medium';
            header.textContent = fmtDate(currentDate);
            transactionsListEl.appendChild(header);
        }
        const row = document.createElement('div');
        row.className = 'flex items-center justify-between gap-2';
        const left = document.createElement('div');
        left.className = 'flex-1';
        // Build description with colored notes
        const typeLabel = t.type === 'payment' ? 'Payment' : 'Deduction';
        let desc = typeLabel;
        if (t.notes) {
            // Wrap notes in accent color span (yellow/gold for better visibility on dark backgrounds)
            const escaped = t.notes.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            desc += ': ' + `<span class="text-amber-600">${escaped}</span>`;
        }
        left.innerHTML = desc;
        const right = document.createElement('div');
        right.className = 'flex items-center gap-2';
        const amtSpan = document.createElement('span');
        amtSpan.className = 'tabular-nums';
        amtSpan.textContent = fmt(t.amountCents);
        right.appendChild(amtSpan);
        // Add delete button for manual transactions only
        if (!t.id.startsWith('auto-')) {
            const del = document.createElement('button');
            del.className = 'text-xs text-red-600 underline hover:text-red-800 transition-base';
            del.textContent = 'Delete';
            del.addEventListener('click', () => {
                showConfirmModal('Are you sure you want to delete this transaction?', () => {
                    deleteTransaction(t.id);
                }, 'Delete Transaction', 'danger');
            });
            right.appendChild(del);
        }
        row.appendChild(left);
        row.appendChild(right);
        transactionsListEl.appendChild(row);
    }
}

/**
 * Create or update the analytics charts. Uses Chart.js to visualize
 * deliveries by item (piece counts) and revenue by shop (in dollars).
 * Charts are initialized lazily on first invocation. Subsequent calls
 * will update the existing charts with new data.
 * @param {Array} rowsForDisplay The filtered and sorted rows currently being shown.
 */
function updateChartsForRows(rowsForDisplay) {
    // Build item counts and shop revenue objects
    const itemCounts = {};
    const shopRevenue = {};
    rowsForDisplay.forEach(r => {
        const itemName = r.item || 'Unknown';
        itemCounts[itemName] = (itemCounts[itemName] || 0) + (r.quantity || 0);
        const shopName = r.shop || 'Unknown';
        const rev = r.totalCents || 0;
        shopRevenue[shopName] = (shopRevenue[shopName] || 0) + rev;
    });
    // Prepare arrays for Chart.js
    const itemLabels = Object.keys(itemCounts);
    const itemData = itemLabels.map(k => itemCounts[k]);
    const shopLabels = Object.keys(shopRevenue);
    const shopData = shopLabels.map(k => (shopRevenue[k] || 0) / 100);
    // Handle deliveries chart
    const ctx1El = document.getElementById('deliveriesChart');
    if (ctx1El) {
        const ctx1 = ctx1El.getContext('2d');
        if (!deliveriesChart) {
            deliveriesChart = new Chart(ctx1, {
                type: 'bar',
                data: {
                    labels: itemLabels,
                    datasets: [{
                        label: 'Pieces',
                        data: itemData,
                        backgroundColor: '#34d399' // Emerald 400
                    }]
                },
                options: {
                    // Disable aspect ratio enforcement so chart fills the canvas height defined in HTML
                    maintainAspectRatio: false,
                    responsive: true,
                    plugins: {
                        legend: {
                            display: false
                        }
                    },
                    scales: {
                        x: {
                            ticks: {
                                color: getComputedStyle(document.documentElement).getPropertyValue('--tw-text-neutral-700') || '#6b7280'
                            }
                        },
                        y: {
                            beginAtZero: true,
                            ticks: {
                                color: getComputedStyle(document.documentElement).getPropertyValue('--tw-text-neutral-700') || '#6b7280'
                            }
                        }
                    }
                }
            });
        } else {
            deliveriesChart.data.labels = itemLabels;
            deliveriesChart.data.datasets[0].data = itemData;
            deliveriesChart.update();
        }
    }
    // Handle revenue chart
    const ctx2El = document.getElementById('revenueChart');
    if (ctx2El) {
        const ctx2 = ctx2El.getContext('2d');
        if (!revenueChart) {
            revenueChart = new Chart(ctx2, {
                type: 'bar',
                data: {
                    labels: shopLabels,
                    datasets: [{
                        label: 'Revenue ($)',
                        data: shopData,
                        backgroundColor: '#60a5fa' // Blue 400
                    }]
                },
                options: {
                    maintainAspectRatio: false,
                    responsive: true,
                    plugins: {
                        legend: {
                            display: false
                        }
                    },
                    scales: {
                        x: {
                            ticks: {
                                color: getComputedStyle(document.documentElement).getPropertyValue('--tw-text-neutral-700') || '#6b7280'
                            }
                        },
                        y: {
                            beginAtZero: true,
                            ticks: {
                                callback: function (value) { return '$' + value.toFixed(2); },
                                color: getComputedStyle(document.documentElement).getPropertyValue('--tw-text-neutral-700') || '#6b7280'
                            }
                        }
                    }
                }
            });
        } else {
            revenueChart.data.labels = shopLabels;
            revenueChart.data.datasets[0].data = shopData;
            revenueChart.update();
        }
    }
}



// --- LIVE SYNC: when override totals inputs change, update summary & Shop Balances preview
(function attachTotalsLiveSync() {
    try {
        const editTotalPaidEl = document.getElementById('editTotalPaid');
        const editPrevBalanceEl = document.getElementById('editPrevBalance');
        if (editTotalPaidEl) {
            editTotalPaidEl.addEventListener('input', () => {
                // Non-destructive preview: don't commit overrides here; just recompute display
                // Clone current override values
                const prevOverridePaid = (typeof overrideSumPaidCents === 'number') ? overrideSumPaidCents : null;
                const prevOverridePrev = (typeof overrideSumPrevCents === 'number') ? overrideSumPrevCents : null;
                // Parse inputs
                const paid = parseFloat(editTotalPaidEl.value || '0');
                const prev = parseFloat(editPrevBalanceEl?.value || '0');
                // Temporarily apply as baseline for display
                const savedPaid = overrideSumPaidCents;
                const savedPrev = overrideSumPrevCents;
                overrideSumPaidCents = isNaN(paid) ? savedPaid : Math.round(paid * 100);
                overrideSumPrevCents = isNaN(prev) ? savedPrev : Math.round(prev * 100);
                // Re-render to refresh summary + shop balances
                render();
                // Restore to original (do not persist until Save)
                overrideSumPaidCents = savedPaid;
                overrideSumPrevCents = savedPrev;
            });
        }
        if (editPrevBalanceEl) {
            editPrevBalanceEl.addEventListener('input', () => {
                const paid = parseFloat(document.getElementById('editTotalPaid')?.value || '0');
                const prev = parseFloat(editPrevBalanceEl.value || '0');
                const savedPaid = overrideSumPaidCents;
                const savedPrev = overrideSumPrevCents;
                overrideSumPaidCents = isNaN(paid) ? savedPaid : Math.round(paid * 100);
                overrideSumPrevCents = isNaN(prev) ? savedPrev : Math.round(prev * 100);
                render();
                overrideSumPaidCents = savedPaid;
                overrideSumPrevCents = savedPrev;
            });
        }
    } catch (e) { /* no-op */ }
})();

// === Print summary (Deliveries) ===
// Build the clean print summary table (without Total pieces) and clone the item breakdown below it with Total pieces displayed there.
function updatePrintSummaryAndBreakdown() {
    const container = document.getElementById('printSummary');
    if (!container) return;

    const getText = (id) => (document.getElementById(id)?.textContent || '—').trim();

    // Pull current totals from the existing UI
    const pieces = getText('sumPieces');
    const value = getText('sumValue');
    const paid = getText('sumPaid');
    const prev = getText('sumPrev');
    const current = getText('sumRemaining');

    container.innerHTML = `
        <section class="bg-white border rounded-2xl p-4">
            <h3 class="text-base font-semibold mb-2">Summary</h3>
            <table class="w-full text-sm">
                <tbody>
                    <tr><th class="text-left py-1 pr-3">Total value</th><td class="py-1 tabular-nums">${value}</td></tr>
                    <tr><th class="text-left py-1 pr-3">Total paid</th><td class="py-1 tabular-nums">${paid}</td></tr>
                    <tr><th class="text-left py-1 pr-3">Previous balance</th><td class="py-1 tabular-nums">${prev}</td></tr>
                    <tr><th class="text-left py-1 pr-3">Current balance</th><td class="py-1 tabular-nums">${current}</td></tr>
                </tbody>
            </table>

            <h3 class="text-base font-semibold mt-4 mb-1">Item breakdown</h3>
            <div id="printItemBreakdownBody" class="text-sm"></div>
            <div class="mt-2 text-sm flex justify-between items-baseline">
                <span class="text-neutral-500">Total pieces</span>
                <span class="text-xl font-semibold text-emerald-600">${pieces}</span>
            </div>
        </section>
    `;

    // Clone current item breakdown list into the print section
    const src = document.getElementById('itemBreakdown');
    const dst = document.getElementById('printItemBreakdownBody');
    if (src && dst) {
        dst.innerHTML = src.innerHTML;
    }
}

// Build before printing so it's fresh
window.addEventListener('beforeprint', updatePrintSummaryAndBreakdown);

// === Tooltip helpers for button errors (Calculate / Save) ===
(function setupTooltipHelpers() {
    let el, hideTimer, shownAt = 0;
    let outsideHandler = null, escHandler = null, inputHandlerBound = false;

    const AUTO_HIDE_MS = 4000;
    const MIN_VISIBLE_MS = 700; // grace period before it can be dismissed

    function ensure() {
        if (el) return el;
        el = document.createElement('div');
        el.id = 'btnTooltip';
        el.setAttribute('role', 'alert');
        el.setAttribute('aria-live', 'assertive');
        el.className = 'btn-tooltip btn-tooltip--error';
        el.innerHTML = `
            <div class="btn-tooltip-inner">
                <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                <span class="msg"></span>
            </div>
            <div class="btn-tooltip-arrow"></div>`;
        document.body.appendChild(el);
        return el;
    }

    function place(target) {
        const r = target.getBoundingClientRect();
        el.style.display = 'block';
        el.style.opacity = '0';
        const tipRect = el.getBoundingClientRect();
        const gap = 10;

        // Prefer above; flip below if not enough space
        let top = window.scrollY + r.top - tipRect.height - gap;
        let placement = 'top';
        if (top < window.scrollY + 4) {
            top = window.scrollY + r.bottom + gap;
            placement = 'bottom';
        }

        let left = window.scrollX + r.left + (r.width - tipRect.width) / 2;
        left = Math.max(8, Math.min(
            left,
            window.scrollX + document.documentElement.clientWidth - tipRect.width - 8
        ));

        el.dataset.placement = placement;
        el.style.top = top + 'px';
        el.style.left = left + 'px';

        requestAnimationFrame(() => {
            el.classList.add('visible');
            el.style.opacity = '1';
        });
    }

    function cleanupListeners() {
        if (outsideHandler) {
            document.removeEventListener('pointerdown', outsideHandler, true);
            outsideHandler = null;
        }
        if (escHandler) {
            document.removeEventListener('keydown', escHandler, true);
            escHandler = null;
        }
        if (inputHandlerBound) {
            document.querySelectorAll('#purchasesCalculator input, #purchasesCalculator button')
                .forEach(node => node.removeEventListener('input', _inputDismiss, { once: true }));
            inputHandlerBound = false;
        }
    }

    function canDismiss() { return Date.now() - shownAt >= MIN_VISIBLE_MS; }

    function hide(targetBtn, prevDesc) {
        if (!el) return;
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
        cleanupListeners();
        el.classList.remove('visible');
        el.style.opacity = '0';
        setTimeout(() => { if (el) el.style.display = 'none'; }, 160);
        if (targetBtn) {
            targetBtn.removeAttribute('aria-invalid');
            if (prevDesc) targetBtn.setAttribute('aria-describedby', prevDesc);
            else targetBtn.removeAttribute('aria-describedby');
        }
    }

    function _inputDismiss() { if (canDismiss()) hide(currentBtn, currentPrevDesc); }
    let currentBtn = null, currentPrevDesc = null;

    window.showButtonTooltip = function (targetBtn, message) {
        const t = ensure();
        t.querySelector('.msg').textContent = message || 'Please check your input.';
        place(targetBtn);

        shownAt = Date.now();
        currentBtn = targetBtn;

        // ARIA connection
        currentPrevDesc = targetBtn.getAttribute('aria-describedby');
        targetBtn.setAttribute('aria-describedby', 'btnTooltip');
        targetBtn.setAttribute('aria-invalid', 'true');

        // Reset any prior timers/listeners
        if (hideTimer) clearTimeout(hideTimer);
        cleanupListeners();

        // Auto-hide after timeout
        hideTimer = setTimeout(() => hide(targetBtn, currentPrevDesc), AUTO_HIDE_MS);

        // ESC to dismiss (after grace)
        escHandler = (e) => { if (e.key === 'Escape' && canDismiss()) hide(targetBtn, currentPrevDesc); };
        document.addEventListener('keydown', escHandler, true);

        // Dismiss when user edits inputs (after grace)
        document.querySelectorAll('#purchasesCalculator input, #purchasesCalculator button')
            .forEach(node => node.addEventListener('input', _inputDismiss, { once: true }));
        inputHandlerBound = true;

        // Outside click: use pointerdown, ignore clicks on tooltip or the button.
        outsideHandler = (e) => {
            if (!canDismiss()) return;
            if (targetBtn.contains(e.target) || el.contains(e.target)) return;
            hide(targetBtn, currentPrevDesc);
        };
        // Attach after a short delay so the opening click won't close it
        setTimeout(() => {
            document.addEventListener('pointerdown', outsideHandler, true);
        }, MIN_VISIBLE_MS);
    };
})();
