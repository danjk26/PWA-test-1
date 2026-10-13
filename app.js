const CHART_COLORS = [
    '#007bff', '#28a745', '#dc3545', '#fd7e14', '#6f42c1', 
    '#17a2b8', '#e83e8c', '#20c997', '#6c757d', '#ffc107'
];

function switchPage(pageId, btnElement) {
    document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    
    document.getElementById(pageId).classList.add('active');
    btnElement.classList.add('active');

    if (pageId === 'chart-page') {
        updateChart();
    } else if (pageId === 'track-page') {
        onTrackExerciseChange();
    } else if (pageId === 'setup-page') {
        populateEditForm();
    }
}

const DB_NAME = 'ExerciseTrackerDB';
const DB_VERSION = 2;
let db = null;

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e) => {
            const database = e.target.result;
            if (!database.objectStoreNames.contains('exercises')) {
                database.createObjectStore('exercises', { keyPath: 'name' });
            }
            if (!database.objectStoreNames.contains('workoutHistory')) {
                const historyStore = database.createObjectStore('workoutHistory', { keyPath: 'id' });
                historyStore.createIndex('exercise', 'exercise', { unique: false });
                historyStore.createIndex('timestamp', 'timestamp', { unique: false });
            }
            if (!database.objectStoreNames.contains('units')) {
                database.createObjectStore('units', { keyPath: 'name' });
            }
        };
        request.onsuccess = (e) => { db = e.target.result; resolve(db); };
        request.onerror = (e) => reject(e.target.error);
    });
}

function dbGetAll(storeName) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function dbPut(storeName, item) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.put(item);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function dbDelete(storeName, key) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

function dbClear(storeName) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

let currentReps = 0;
let repStep = 1;
let trackSide = 'Both';
let setupSide = 'Both';
let myChart = null;

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await openDB();
        await seedDefaultUnits();
        await loadUnitsDropdowns();
        await loadExerciseDropdowns();
        await renderHistory();
        initChart();
    } catch (err) {
        console.error("Initialization Error:", err);
    }
});

async function seedDefaultUnits() {
    const existing = await dbGetAll('units');
    if (existing.length === 0) {
        for (let u of ['lbs', 'seconds']) {
            await dbPut('units', { name: u });
        }
    }
}

async function saveNewUnit() {
    const input = document.getElementById('new-unit-name');
    const unitName = input.value.trim().toLowerCase();
    if (!unitName) return alert('Please enter a unit name.');
    const existing = await dbGetAll('units');
    if (!existing.some(u => u.name === unitName)) {
        await dbPut('units', { name: unitName });
        input.value = '';
        await loadUnitsDropdowns();
    }
}

async function deleteUnit() {
    const selectedUnit = document.getElementById('delete-unit-select').value;
    if (!selectedUnit) return alert('Please select a unit to delete.');
    if (confirm(`Delete unit "${selectedUnit}"?`)) {
        await dbDelete('units', selectedUnit);
        await loadUnitsDropdowns();
    }
}

async function loadUnitsDropdowns() {
    const trackSelect = document.getElementById('unit-select');
    const deleteSelect = document.getElementById('delete-unit-select');
    const units = await dbGetAll('units');
    trackSelect.innerHTML = '';
    deleteSelect.innerHTML = '<option value="">-- Select unit to delete --</option>';
    units.forEach(u => {
        trackSelect.add(new Option(u.name, u.name));
        deleteSelect.add(new Option(u.name, u.name));
    });
}

async function saveNewExercise() {
    const nameInput = document.getElementById('new-exercise-name');
    const targetInput = document.getElementById('new-exercise-target');
    const baseName = nameInput.value.trim();
    const targetVal = parseFloat(targetInput.value) || 0;
    if (!baseName) return alert('Please enter an exercise name.');

    const existing = await dbGetAll('exercises');
    if (!existing.some(ex => ex.name === baseName)) {
        await dbPut('exercises', { name: baseName, targetVolume: targetVal });
        await dbPut('exercises', { name: `${baseName} (Left)`, targetVolume: targetVal });
        await dbPut('exercises', { name: `${baseName} (Right)`, targetVolume: targetVal });
        nameInput.value = '';
        targetInput.value = '';
        await loadExerciseDropdowns();
        alert(`Saved "${baseName}" with Left & Right side variants!`);
    } else {
        alert('That exercise already exists.');
    }
}

function getVariantName(baseName, side) {
    if (!baseName) return '';
    if (side === 'Left') return `${baseName} (Left)`;
    if (side === 'Right') return `${baseName} (Right)`;
    return baseName;
}

async function populateEditForm() {
    const baseName = document.getElementById('edit-exercise-select').value;
    const targetInput = document.getElementById('edit-exercise-target');
    const nameInput = document.getElementById('edit-exercise-name');
    const targetLabel = document.getElementById('target-variant-label');

    if (!baseName) {
        nameInput.value = '';
        targetInput.value = '';
        targetLabel.innerText = 'Both';
        return;
    }

    nameInput.value = baseName;
    targetLabel.innerText = setupSide;

    const variantName = getVariantName(baseName, setupSide);
    const exercises = await dbGetAll('exercises');
    const ex = exercises.find(item => item.name === variantName);
    targetInput.value = ex ? (ex.targetVolume || 0) : 0;
}

function setSetupSide(sideVal, btnElement) {
    setupSide = sideVal;
    document.querySelectorAll('#setup-side-bar .mult-btn').forEach(b => b.classList.remove('active'));
    if (btnElement) btnElement.classList.add('active');
    populateEditForm();
}

async function updateExerciseAndTarget() {
    const oldBaseName = document.getElementById('edit-exercise-select').value;
    const newBaseName = document.getElementById('edit-exercise-name').value.trim();
    const newTarget = parseFloat(document.getElementById('edit-exercise-target').value) || 0;
    if (!oldBaseName || !newBaseName) return alert('Please select an exercise and enter a valid name.');

    const exercises = await dbGetAll('exercises');
    if (oldBaseName !== newBaseName && exercises.some(ex => ex.name === newBaseName)) {
        return alert('An exercise with that new name already exists.');
    }

    for (let side of ['', ' (Left)', ' (Right)']) {
        const oldVariant = oldBaseName + side;
        const newVariant = newBaseName + side;
        const existingRecord = exercises.find(ex => ex.name === oldVariant);
        const targetToKeep = (getVariantName(oldBaseName, setupSide) === oldVariant) ? newTarget : (existingRecord ? existingRecord.targetVolume : 0);

        await dbDelete('exercises', oldVariant);
        await dbPut('exercises', { name: newVariant, targetVolume: targetToKeep });

        for (let item of await dbGetAll('workoutHistory')) {
            if (item.exercise === oldVariant) {
                item.exercise = newVariant;
                await dbPut('workoutHistory', item);
            }
        }
    }
    alert('Exercise updated successfully!');
    await loadExerciseDropdowns();
    document.getElementById('edit-exercise-select').value = newBaseName;
    await renderHistory();
    onTrackExerciseChange();
}

async function deleteExercise() {
    const baseName = document.getElementById('edit-exercise-select').value;
    if (!baseName) return alert('Please select an exercise to delete.');
    if (confirm(`Delete "${baseName}" and its variants?`)) {
        await dbDelete('exercises', baseName);
        await dbDelete('exercises', `${baseName} (Left)`);
        await dbDelete('exercises', `${baseName} (Right)`);
        await loadExerciseDropdowns();
    }
}

async function loadExerciseDropdowns() {
    const logDropdown = document.getElementById('exercise-select');
    const editDropdown = document.getElementById('edit-exercise-select');
    const checkboxContainer = document.getElementById('chart-exercises-checkboxes');
    const exercises = await dbGetAll('exercises');

    const savedState = JSON.parse(localStorage.getItem('pwaChartState')) || { exercises: [], metric: 'totalVolume', timeframe: 'daily' };
    document.getElementById('chart-metric-select').value = savedState.metric || 'totalVolume';
    document.getElementById('chart-timeframe-select').value = savedState.timeframe || 'daily';

    const activeTrackSelection = logDropdown.value;
    logDropdown.innerHTML = '<option value="">-- Choose an exercise --</option>';
    editDropdown.innerHTML = '<option value="">-- Choose exercise --</option>';
    checkboxContainer.innerHTML = '';

    exercises.filter(item => !item.name.endsWith(' (Left)') && !item.name.endsWith(' (Right)')).forEach(item => {
        logDropdown.add(new Option(item.name, item.name));
        editDropdown.add(new Option(item.name, item.name));
    });

    exercises.forEach((item, idx) => {
        const isChecked = savedState.exercises.length > 0 ? savedState.exercises.includes(item.name) : (idx === 0);
        checkboxContainer.innerHTML += `<label class="checkbox-item"><input type="checkbox" value="${item.name}" onchange="updateChart()" ${isChecked ? 'checked' : ''}> ${item.name}</label>`;
    });

    if (activeTrackSelection) logDropdown.value = activeTrackSelection;
    populateEditForm();
    onTrackExerciseChange();
    updateChart();
}

function toISODateString(dateObj) {
    return `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
}

function setTrackSide(sideVal, btnElement) {
    trackSide = sideVal;
    document.querySelectorAll('#track-side-bar .mult-btn').forEach(b => b.classList.remove('active'));
    if (btnElement) btnElement.classList.add('active');
    onTrackExerciseChange();
}

function getEffectiveTrackExerciseName() {
    return getVariantName(document.getElementById('exercise-select').value, trackSide);
}

function calculateSetVolume(setObj) {
    const w = setObj.weight || 0;
    const r = setObj.reps || 0;
    const d = setObj.duration || 0;
    return d > 0 ? (w > 0 ? w * d : d) * r : w * r;
}

async function onTrackExerciseChange() {
    const effectiveExercise = getEffectiveTrackExerciseName();
    const volumeDiv = document.getElementById('volume-tracker');
    if (!effectiveExercise) {
        volumeDiv.style.display = 'none';
        return;
    }

    const history = (await dbGetAll('workoutHistory')).filter(item => item.exercise === effectiveExercise).sort((a, b) => b.id - a.id);
    if (history.length > 0) {
        document.getElementById('weight-input').value = history[0].weight || 0;
        document.getElementById('unit-select').value = history[0].unit || 'lbs';
        document.getElementById('duration-input').value = history[0].duration || 0;
    }

    const todayISO = toISODateString(new Date());
    const cumVol = history.filter(item => toISODateString(new Date(item.timestamp)) === todayISO).reduce((sum, s) => sum + calculateSetVolume(s), 0);
    const currentEx = (await dbGetAll('exercises')).find(ex => ex.name === effectiveExercise);
    
    document.getElementById('cum-vol').innerText = cumVol;
    document.getElementById('target-vol').innerText = (currentEx && currentEx.targetVolume) ? currentEx.targetVolume : 'No Target';
    volumeDiv.style.display = 'block';
}

function setStep(stepVal, btnElement) {
    repStep = stepVal;
    document.querySelectorAll('#step-bar .mult-btn').forEach(b => b.classList.remove('active'));
    btnElement.classList.add('active');
    document.getElementById('add-rep-btn').innerText = `+${repStep} Rep${repStep > 1 ? 's' : ''}`;
    document.getElementById('undo-rep-btn').innerText = `-${repStep} Rep${repStep > 1 ? 's' : ''}`;
}

function addRep() {
    if (!document.getElementById('exercise-select').value) return alert('Please select an exercise first!');
    currentReps += repStep;
    document.getElementById('rep-count').innerText = currentReps;
}

function undoRep() {
    currentReps = currentReps >= repStep ? currentReps - repStep : 0;
    document.getElementById('rep-count').innerText = currentReps;
}

function resetReps() {
    currentReps = 0;
    document.getElementById('rep-count').innerText = currentReps;
}

async function commitSet() {
    const baseExercise = document.getElementById('exercise-select').value;
    if (!baseExercise) return alert('Please select an exercise before saving.');
    if (currentReps <= 0) return alert('Please add at least 1 rep before saving a set.');

    const effectiveExercise = getEffectiveTrackExerciseName();
    if (!(await dbGetAll('exercises')).some(ex => ex.name === effectiveExercise)) {
        await dbPut('exercises', { name: effectiveExercise, targetVolume: 0 });
        await loadExerciseDropdowns();
    }

    const now = new Date();
    await dbPut('workoutHistory', {
        id: now.getTime(),
        exercise: effectiveExercise,
        weight: parseFloat(document.getElementById('weight-input').value) || 0,
        duration: parseFloat(document.getElementById('duration-input').value) || 0,
        unit: document.getElementById('unit-select').value || 'lbs',
        reps: currentReps,
        timestamp: now.toISOString(),
        displayDate: now.toLocaleString()
    });

    resetReps();
    await renderHistory();
    await onTrackExerciseChange();
    updateChart();
    alert('Set saved to database!');
}

async function renderHistory() {
    const container = document.getElementById('history-container');
    const history = (await dbGetAll('workoutHistory')).sort((a, b) => b.id - a.id);
    if (history.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:#777;">No completed sets logged yet.</p>';
        return;
    }
    container.innerHTML = history.map(item => `
        <div class="log-item">
            <strong>${item.exercise}</strong> — ${item.reps} rep(s) @ <em>${item.weight} ${item.unit}</em>${item.duration ? ` (\${item.duration}s hold)` : ''}
            <div class="log-date">${item.displayDate || new Date(item.timestamp).toLocaleString()}</div>
        </div>
    `).join('');
}

async function clearHistory() {
    if (confirm('Clear entire workout history log?')) {
        await dbClear('workoutHistory');
        await renderHistory();
        await onTrackExerciseChange();
        updateChart();
    }
}

function initChart() {
    myChart = new Chart(document.getElementById('progressChart').getContext('2d'), {
        type: 'line',
        data: { labels: [], datasets: [] },
        options: { responsive: true, maintainAspectRatio: false, scales: { x: { display: true }, y: { beginAtZero: true } } }
    });
}

async function updateChart() {
    if (!myChart) return;
    const selectedExercises = Array.from(document.querySelectorAll('#chart-exercises-checkboxes input[type="checkbox"]:checked')).map(cb => cb.value);
    const metric = document.getElementById('chart-metric-select').value;
    const timeframe = document.getElementById('chart-timeframe-select').value;

    localStorage.setItem('pwaChartState', JSON.stringify({ exercises: selectedExercises, metric, timeframe }));
    if (selectedExercises.length === 0) {
        myChart.data.labels = [];
        myChart.data.datasets = [];
        myChart.update();
        return;
    }

    const allHistory = await dbGetAll('workoutHistory');
    const filteredHistory = allHistory.filter(item => selectedExercises.includes(item.exercise)).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    const globalLabels = Array.from(new Set(filteredHistory.map(item => {
        const d = new Date(item.timestamp);
        if (timeframe === 'weekly') {
            const startOfYear = new Date(d.getFullYear(), 0, 1);
            return `W${Math.ceil(((d - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7)} (${d.getFullYear()})`;
        }
        return timeframe === 'monthly' ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short' }) : d.toLocaleDateString();
    })));

    const datasets = selectedExercises.map((exName, idx) => {
        const exerciseSets = filteredHistory.filter(item => item.exercise === exName);
        const grouped = {};
        exerciseSets.forEach(item => {
            const d = new Date(item.timestamp);
            const key = timeframe === 'weekly' ? `W${Math.ceil(((d - new Date(d.getFullYear(), 0, 1)) / 86400000 + new Date(d.getFullYear(), 0, 1).getDay() + 1) / 7)} (${d.getFullYear()})` : (timeframe === 'monthly' ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short' }) : d.toLocaleDateString());
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(item);
        });

        const dataValues = globalLabels.map(labelKey => {
            const sets = grouped[labelKey];
            if (!sets || sets.length === 0) return null;
            if (metric === 'sumWeight') return sets.reduce((sum, s) => sum + s.weight, 0);
            if (metric === 'maxWeight') return Math.max(...sets.map(s => s.weight));
            if (metric === 'totalVolume') return sets.reduce((sum, s) => sum + calculateSetVolume(s), 0);
            if (metric === 'totalDuration') return sets.reduce((sum, s) => sum + ((s.duration || 0) * s.reps), 0);
            if (metric === 'totalReps') return sets.reduce((sum, s) => sum + s.reps, 0);
        });

        const color = CHART_COLORS[idx % CHART_COLORS.length];
        return { label: exName, data: dataValues, borderColor: color, backgroundColor: color + '22', fill: false, tension: 0.2, spanGaps: true };
    });

    myChart.data.labels = globalLabels;
    myChart.data.datasets = datasets;
    myChart.update();
}

async function exportDataJSON() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({
        exercises: await dbGetAll('exercises'),
        workoutHistory: await dbGetAll('workoutHistory'),
        units: await dbGetAll('units')
    }, null, 2));
    const dlAnchor = document.createElement('a');
    dlAnchor.href = dataStr;
    dlAnchor.download = `exercise_tracker_backup_${Date.now()}.json`;
    dlAnchor.click();
}

async function exportDataCSV() {
    const history = await dbGetAll('workoutHistory');
    if (history.length === 0) return alert('No history to export.');
    let csv = "data:text/csv;charset=utf-8,ID,Exercise,Weight,Unit,Duration,Reps,Timestamp,Date\n";
    history.forEach(item => {
        csv += `${item.id},"${item.exercise}",${item.weight},"${item.unit}",${item.duration || 0},${item.reps},"${item.timestamp}","${item.displayDate}"\n`;
    });
    const dlAnchor = document.createElement('a');
    dlAnchor.href = encodeURI(csv);
    dlAnchor.download = `workout_history_${Date.now()}.csv`;
    dlAnchor.click();
}

function importDataJSON(event) {
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (data.exercises) for (let ex of data.exercises) await dbPut('exercises', ex);
            if (data.workoutHistory) for (let item of data.workoutHistory) await dbPut('workoutHistory', item);
            if (data.units) for (let u of data.units) await dbPut('units', u);
            await loadUnitsDropdowns();
            await loadExerciseDropdowns();
            await renderHistory();
            updateChart();
            alert('Imported successfully!');
        } catch (err) { alert('Invalid JSON.'); }
    };
    reader.readAsText(event.target.files[0]);
}

function checkForAppUpdate() {
    alert('App is up to date!');
}