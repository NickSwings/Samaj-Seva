import { db } from "./firebase-config.js";
import { checkAuthAndRedirect, logoutUser } from "./auth.js";
import { getMatchScore } from "./gemini.js";
import { 
    collection, 
    query, 
    where, 
    onSnapshot,
    doc,
    updateDoc,
    arrayUnion,
    arrayRemove
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

// Global State
let currentUser = null;
let currentVolData = null;
const aiScoreCache = {};

let globalOpenTasks = [];
let globalAcceptedTasks = [];
let currentSort = "newest";
let currentSearch = "";
let activeTab = "available"; 

const pageBody = document.getElementById("page-body");
const logoutBtn = document.getElementById("logout-btn");

// Profile UI
const navName = document.getElementById("nav-vol-name");
const profileInitial = document.getElementById("profile-initial");
const profileName = document.getElementById("profile-name");
const profileSkills = document.getElementById("profile-skills");
const profileAvail = document.getElementById("profile-availability");
const profilePhone = document.getElementById("profile-phone");
const profileDob = document.getElementById("profile-dob");

// Tab & List UI
const tabAvailable = document.getElementById("tab-available");
const tabAccepted = document.getElementById("tab-accepted");
const availableSection = document.getElementById("available-section");
const acceptedSection = document.getElementById("accepted-section");
const searchInput = document.getElementById("search-tasks");
const sortDropdown = document.getElementById("sort-tasks");
const tasksContainer = document.getElementById("tasks-container");
const taskCounter = document.getElementById("task-counter");
const tasksLoader = document.getElementById("tasks-loader");
const acceptedContainer = document.getElementById("accepted-tasks-container");
const acceptedCounter = document.getElementById("accepted-counter");
const acceptedLoader = document.getElementById("accepted-loader");

// Profile Edit Elements
const editProfileBtn = document.getElementById("edit-profile-btn");
const editProfileModal = document.getElementById("edit-profile-modal");
const closeProfileBtn = document.getElementById("close-profile-btn");
const cancelProfileBtn = document.getElementById("cancel-profile-btn");
const saveProfileBtn = document.getElementById("save-profile-btn");
const editPhone = document.getElementById("edit-phone");
const editDob = document.getElementById("edit-dob");
const editSkills = document.getElementById("edit-skills");
const editAvailability = document.getElementById("edit-availability");

// --- FORMATTERS ---
function formatDOB(dateString) {
    if (!dateString) return "Not provided";
    const date = new Date(dateString);
    if (isNaN(date)) return dateString; 
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const day = date.getDate();
    let suffix = "th";
    if (day % 10 === 1 && day !== 11) suffix = "st";
    else if (day % 10 === 2 && day !== 12) suffix = "nd";
    else if (day % 10 === 3 && day !== 13) suffix = "rd";
    return `${day}${suffix} ${months[date.getMonth()]}, ${date.getFullYear()}`;
}

// BULLETPROOF MATRIX TABLE PARSER
function renderAvailabilityTable(availString) {
    if (!availString || typeof availString !== "string" || availString.toLowerCase().trim() === "flexible") {
        return `<span class="text-sm font-medium text-gray-700 bg-gray-100 px-3 py-1 rounded-md border border-gray-200">Flexible</span>`;
    }

    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const availMap = {};
    let hasSpecifics = false;

    // Aggressively hunt for Day (Times) pattern regardless of delimiters
    const regex = /([a-zA-Z]{3})[a-zA-Z]*\s*[\(:-]\s*([^);]+)/g;
    let match;
    while ((match = regex.exec(availString)) !== null) {
        const day = match[1].charAt(0).toUpperCase() + match[1].slice(1,3).toLowerCase();
        if (days.includes(day)) {
            availMap[day] = match[2].toLowerCase();
            hasSpecifics = true;
        }
    }

    if (!hasSpecifics) return `<span class="text-sm font-medium text-gray-700 leading-relaxed">${availString.replace(/;/g, '<br>')}</span>`;

    let html = `
    <table class="w-full text-xs text-left border-collapse mt-2 bg-white rounded-lg overflow-hidden border border-gray-200">
        <thead class="bg-gray-50">
            <tr class="text-gray-500 uppercase tracking-wider">
                <th class="py-2 px-3 font-bold border-b border-gray-200">Day</th>
                <th class="py-2 px-2 font-bold text-center border-b border-gray-200">Morn</th>
                <th class="py-2 px-2 font-bold text-center border-b border-gray-200">Aft</th>
                <th class="py-2 px-2 font-bold text-center border-b border-gray-200">Eve</th>
            </tr>
        </thead>
        <tbody>
    `;

    days.forEach(day => {
        if (availMap[day]) {
            const t = availMap[day];
            const m = t.includes('morn') ? '<i class="fa-solid fa-check text-blue-600 font-bold"></i>' : '<i class="fa-solid fa-minus text-gray-200"></i>';
            const a = t.includes('after') ? '<i class="fa-solid fa-check text-blue-600 font-bold"></i>' : '<i class="fa-solid fa-minus text-gray-200"></i>';
            const e = t.includes('even') ? '<i class="fa-solid fa-check text-blue-600 font-bold"></i>' : '<i class="fa-solid fa-minus text-gray-200"></i>';
            
            html += `
            <tr class="border-b border-gray-50 last:border-0 hover:bg-gray-50 transition">
                <td class="py-2 px-3 font-bold text-gray-700">${day}</td>
                <td class="py-2 px-2 text-center bg-gray-50/50">${m}</td>
                <td class="py-2 px-2 text-center">${a}</td>
                <td class="py-2 px-2 text-center bg-gray-50/50">${e}</td>
            </tr>`;
        }
    });

    html += `</tbody></table>`;
    return html;
}

// Fast local matching for instant UI sorting
function getLocalMatchScore(volSkills, taskSkills) {
    if (!taskSkills || taskSkills.length === 0) return 100;
    if (!volSkills || volSkills.length === 0) return 0;
    let matches = 0;
    taskSkills.forEach(tSkill => {
        if (volSkills.includes(tSkill.toLowerCase().trim())) matches++;
    });
    return Math.round((matches / taskSkills.length) * 100);
}

// --- INIT ---
async function init() {
    try {
        const authData = await checkAuthAndRedirect("volunteer");
        currentUser = authData.user;
        
        onSnapshot(doc(db, "users", currentUser.uid), (docSnap) => {
            if(docSnap.exists()){
                currentVolData = docSnap.data();
                updateProfileUI();
                if (globalOpenTasks.length > 0) applyFiltersAndRender();
            }
        });

        pageBody.classList.remove("hidden");
        setupListeners();
        listenToOpenTasks();
        listenToAcceptedTasks();
    } catch (error) {
        console.error("Auth failed:", error);
    }
}

function updateProfileUI() {
    navName.textContent = currentVolData.name;
    profileName.textContent = currentVolData.name;
    profileInitial.textContent = currentVolData.name.charAt(0).toUpperCase();
    profilePhone.textContent = currentVolData.phone || "Not provided";
    profileDob.textContent = formatDOB(currentVolData.dob);
    
    // Inject the matrix table
    profileAvail.innerHTML = renderAvailabilityTable(currentVolData.availability);
    
    profileSkills.innerHTML = "";
    if (currentVolData.skills && currentVolData.skills.length > 0) {
        currentVolData.skills.forEach(skill => {
            const span = document.createElement("span");
            span.className = "bg-blue-50 text-blue-700 text-xs px-2.5 py-1 rounded-md border border-blue-100 font-medium";
            span.textContent = skill;
            profileSkills.appendChild(span);
        });
    }
}

function setupListeners() {
    logoutBtn.addEventListener("click", logoutUser);

    tabAvailable.addEventListener("click", () => {
        activeTab = "available";
        tabAvailable.className = "px-4 py-2 text-sm font-bold text-blue-700 border-b-2 border-blue-700 transition";
        tabAccepted.className = "px-4 py-2 text-sm font-bold text-gray-500 border-b-2 border-transparent hover:text-gray-700 transition";
        availableSection.classList.remove("hidden");
        acceptedSection.classList.add("hidden");
        applyFiltersAndRender();
    });

    tabAccepted.addEventListener("click", () => {
        activeTab = "accepted";
        tabAccepted.className = "px-4 py-2 text-sm font-bold text-blue-700 border-b-2 border-blue-700 transition";
        tabAvailable.className = "px-4 py-2 text-sm font-bold text-gray-500 border-b-2 border-transparent hover:text-gray-700 transition";
        acceptedSection.classList.remove("hidden");
        availableSection.classList.add("hidden");
        applyFiltersAndRender();
    });

    searchInput.addEventListener("input", (e) => {
        currentSearch = e.target.value.toLowerCase();
        applyFiltersAndRender();
    });

    sortDropdown.addEventListener("change", (e) => {
        currentSort = e.target.value;
        applyFiltersAndRender();
    });

    editProfileBtn.addEventListener("click", () => {
        editPhone.value = currentVolData.phone || "";
        editDob.value = currentVolData.dob || "";
        editSkills.value = currentVolData.skills ? currentVolData.skills.join(", ") : "";
        editAvailability.value = currentVolData.availability || "";
        editProfileModal.classList.remove("hidden");
    });

    const closeProfile = () => editProfileModal.classList.add("hidden");
    closeProfileBtn.addEventListener("click", closeProfile);
    cancelProfileBtn.addEventListener("click", closeProfile);

    saveProfileBtn.addEventListener("click", async () => {
        saveProfileBtn.disabled = true;
        saveProfileBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

        const newSkills = editSkills.value.split(',').map(s => s.trim().toLowerCase()).filter(s => s !== "");
        
        try {
            await updateDoc(doc(db, "users", currentUser.uid), {
                phone: editPhone.value.trim(),
                dob: editDob.value,
                skills: newSkills,
                availability: editAvailability.value.trim() || "Flexible"
            });
            for (let key in aiScoreCache) delete aiScoreCache[key];
            closeProfile();
        } catch (error) {
            alert("Failed to update profile: " + error.message);
        } finally {
            saveProfileBtn.disabled = false;
            saveProfileBtn.innerHTML = 'Save Changes';
        }
    });
}

function listenToOpenTasks() {
    const q = query(collection(db, "tasks"), where("status", "==", "open"));
    onSnapshot(q, (snapshot) => {
        tasksLoader.classList.add("hidden");
        globalOpenTasks = [];
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            if (!data.acceptedVolunteers || !data.acceptedVolunteers.includes(currentUser.uid)) {
                globalOpenTasks.push({ id: docSnap.id, ...data });
            }
        });
        if(activeTab === "available") applyFiltersAndRender();
    });
}

function listenToAcceptedTasks() {
    onSnapshot(collection(db, "tasks"), (snapshot) => {
        acceptedLoader.classList.add("hidden");
        globalAcceptedTasks = [];
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            if (data.acceptedVolunteers && data.acceptedVolunteers.includes(currentUser.uid)) {
                globalAcceptedTasks.push({ id: docSnap.id, ...data });
            }
        });
        if(activeTab === "accepted") applyFiltersAndRender();
    });
}

function applyFiltersAndRender() {
    let sourceTasks = activeTab === "available" ? globalOpenTasks : globalAcceptedTasks;
    let filtered = [...sourceTasks];

    if (currentSearch) {
        filtered = filtered.filter(t => 
            t.title.toLowerCase().includes(currentSearch) ||
            t.description.toLowerCase().includes(currentSearch) ||
            t.location.toLowerCase().includes(currentSearch) ||
            t.orgName.toLowerCase().includes(currentSearch) ||
            (t.requiredSkills && t.requiredSkills.some(s => s.includes(currentSearch)))
        );
    }

    if (currentSort === "newest") {
        filtered.sort((a, b) => {
            const tA = a.createdAt ? a.createdAt.toMillis() : Date.now();
            const tB = b.createdAt ? b.createdAt.toMillis() : Date.now();
            return tB - tA;
        });
    } else if (currentSort === "urgency") {
        const priority = { "High": 3, "Medium": 2, "Low": 1 };
        filtered.sort((a, b) => priority[b.urgency] - priority[a.urgency]);
    } else if (currentSort === "match") {
        const volSkills = currentVolData.skills || [];
        filtered.sort((a, b) => {
            let scoreA = getLocalMatchScore(volSkills, a.requiredSkills);
            let scoreB = getLocalMatchScore(volSkills, b.requiredSkills);
            if (aiScoreCache[a.id] && typeof aiScoreCache[a.id].score === 'number') scoreA = aiScoreCache[a.id].score;
            if (aiScoreCache[b.id] && typeof aiScoreCache[b.id].score === 'number') scoreB = aiScoreCache[b.id].score;
            return scoreB - scoreA; 
        });
    }

    if (activeTab === "available") {
        renderAvailableTasks(filtered);
    } else {
        renderAcceptedTasks(filtered);
    }
}

function renderAvailableTasks(tasks) {
    tasksContainer.innerHTML = "";
    taskCounter.textContent = `${tasks.length} Displayed`;

    if (tasks.length === 0) {
        tasksContainer.innerHTML = `
            <div class="bg-white rounded-2xl shadow-sm border border-gray-200 p-10 text-center text-gray-500">
                <i class="fa-solid fa-mug-hot text-3xl mb-3 text-gray-300"></i>
                <p class="text-lg font-medium text-gray-700 mb-1">No tasks found</p>
                <p class="text-sm">Try clearing your search or wait for NGOs to post more tasks.</p>
            </div>`;
        return;
    }

    tasks.forEach(task => {
        let urgencyColor = "bg-yellow-100 text-yellow-800 border-yellow-200"; 
        if (task.urgency === "High") urgencyColor = "bg-red-100 text-red-800 border-red-200";
        if (task.urgency === "Low") urgencyColor = "bg-green-100 text-green-800 border-green-200";

        const acceptedCount = task.acceptedVolunteers ? task.acceptedVolunteers.length : 0;

        const card = document.createElement("div");
        card.className = "bg-white rounded-2xl shadow-sm border border-gray-200 p-6 flex flex-col md:flex-row gap-6 relative overflow-hidden transition hover:shadow-md";
        
        card.innerHTML = `
            <div class="flex-1">
                <div class="flex justify-between items-start mb-2">
                    <div class="flex flex-col">
                        <h3 class="text-xl font-bold text-gray-800">${task.title}</h3>
                        <span class="text-xs font-bold text-gray-500 uppercase tracking-wider"><i class="fa-solid fa-building-ngo mr-1"></i> ${task.orgName}</span>
                    </div>
                    <span class="text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider border ${urgencyColor}">${task.urgency} Urgency</span>
                </div>
                
                <div class="flex flex-wrap gap-3 text-xs font-medium text-gray-500 mb-3 mt-2">
                    <div class="flex items-center gap-1.5"><i class="fa-regular fa-calendar text-blue-500"></i> ${task.dates || 'Flexible'}</div>
                    <div class="flex items-center gap-1.5"><i class="fa-regular fa-clock text-blue-500"></i> ${task.time || 'Not specified'}</div>
                </div>

                <p class="text-gray-600 text-sm mb-4 leading-relaxed">${task.description}</p>
                
                <div class="flex flex-wrap gap-2 mb-4">
                    ${task.requiredSkills.map(s => `<span class="bg-gray-100 text-gray-600 text-xs px-2 py-1 rounded border border-gray-200">${s}</span>`).join('')}
                </div>

                <div class="flex flex-col gap-2 border-t border-gray-100 pt-4 text-sm text-gray-600">
                    <div class="flex items-start gap-2">
                        <i class="fa-solid fa-location-dot mt-0.5 text-gray-400"></i>
                        <span class="leading-tight">${task.location}</span>
                    </div>
                    <div class="flex items-center gap-2 font-bold ${acceptedCount >= task.volunteersNeeded ? 'text-green-600' : 'text-blue-600'}">
                        <i class="fa-solid fa-users text-gray-400"></i>
                        Volunteers: ${acceptedCount}/${task.volunteersNeeded} Accepted
                    </div>
                </div>
            </div>
            
            <div class="w-full md:w-64 bg-blue-50/50 rounded-xl border border-blue-100 p-4 flex flex-col justify-center text-center shrink-0">
                <div id="ai-ui-${task.id}">
                    <i class="fa-solid fa-robot text-blue-300 text-2xl mb-2 animate-pulse"></i>
                    <p class="text-xs text-blue-600 font-medium">Gemini is analyzing fit...</p>
                </div>
                <button id="accept-btn-${task.id}" class="w-full bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold py-2.5 rounded-lg transition mt-4 shadow-sm">
                    Accept Task
                </button>
            </div>
        `;
        tasksContainer.appendChild(card);
        document.getElementById(`accept-btn-${task.id}`).addEventListener("click", () => handleAcceptTask(task.id));
        processGeminiScore(task);
    });
}

function renderAcceptedTasks(tasks) {
    acceptedContainer.innerHTML = "";
    acceptedCounter.textContent = `${tasks.length} Displayed`;

    if (tasks.length === 0) {
        acceptedContainer.innerHTML = `
            <div class="bg-white rounded-2xl shadow-sm border border-gray-200 p-10 text-center text-gray-500">
                <i class="fa-solid fa-clipboard-list text-3xl mb-3 text-gray-300"></i>
                <p class="text-lg font-medium text-gray-700 mb-1">No commitments yet</p>
                <p class="text-sm">When you accept a task, its details will appear here.</p>
            </div>`;
        return;
    }

    tasks.forEach(task => {
        const isClosed = task.status === "closed";
        const acceptedCount = task.acceptedVolunteers ? task.acceptedVolunteers.length : 0;

        const card = document.createElement("div");
        card.className = `bg-white rounded-2xl shadow-sm border ${isClosed ? 'border-gray-200 opacity-75' : 'border-green-200'} p-6 flex flex-col md:flex-row gap-6 relative overflow-hidden transition`;
        
        card.innerHTML = `
            <div class="flex-1">
                <div class="flex justify-between items-start mb-2">
                    <h3 class="text-xl font-bold ${isClosed ? 'text-gray-500 line-through' : 'text-gray-800'}">${task.title}</h3>
                    <span class="text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider border ${isClosed ? 'bg-gray-100 text-gray-600 border-gray-200' : 'bg-green-100 text-green-800 border-green-200'}">
                        ${isClosed ? 'TASK CLOSED' : '<i class="fa-solid fa-check mr-1"></i> ACCEPTED'}
                    </span>
                </div>
                
                <div class="flex items-center gap-2 mb-3 text-sm font-bold text-blue-700">
                    <i class="fa-solid fa-building-ngo"></i> Hosted by: ${task.orgName}
                </div>

                <div class="flex flex-wrap gap-4 text-xs font-medium text-gray-500 mb-4 mt-2">
                    <div class="flex items-center gap-1.5"><i class="fa-regular fa-calendar text-blue-500"></i> ${task.dates || 'Flexible'}</div>
                    <div class="flex items-center gap-1.5"><i class="fa-regular fa-clock text-blue-500"></i> ${task.time || 'Not specified'}</div>
                </div>

                <p class="text-gray-600 text-sm mb-4 bg-gray-50 p-3 rounded-lg border border-gray-100 leading-relaxed">${task.description}</p>
                
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-t border-gray-100 pt-4 mt-2 text-sm text-gray-600">
                    <div class="flex items-start gap-2">
                        <i class="fa-solid fa-location-dot mt-0.5 text-gray-400"></i>
                        <span class="leading-tight">${task.location}</span>
                    </div>
                    <div class="flex items-center gap-2 font-bold ${acceptedCount >= task.volunteersNeeded ? 'text-green-600' : 'text-blue-600'}">
                        <i class="fa-solid fa-users text-gray-400"></i>
                        Volunteers: ${acceptedCount}/${task.volunteersNeeded} Accepted
                    </div>
                </div>
            </div>
            
            <div class="flex flex-col justify-center shrink-0 border-t md:border-t-0 md:border-l border-gray-100 pt-4 md:pt-0 md:pl-6 mt-4 md:mt-0 w-full md:w-48">
                <p class="text-xs text-gray-400 mb-3 text-center">Can no longer attend?</p>
                <button id="drop-btn-${task.id}" class="w-full bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-semibold py-2.5 rounded-lg transition text-sm flex items-center justify-center gap-2">
                    <i class="fa-solid fa-user-minus"></i> Drop Task
                </button>
            </div>
        `;
        acceptedContainer.appendChild(card);
        
        document.getElementById(`drop-btn-${task.id}`).addEventListener("click", () => handleDropTask(task.id, task.title));
    });
}

async function processGeminiScore(task) {
    const aiContainer = document.getElementById(`ai-ui-${task.id}`);
    if (!aiContainer) return;

    let result = aiScoreCache[task.id];
    if (!result) {
        result = await getMatchScore(currentVolData.skills, task.requiredSkills);
        aiScoreCache[task.id] = result;
    }

    let scoreColor = "text-blue-600";
    let bgCircle = "border-blue-200";
    if (result.score >= 80) { scoreColor = "text-green-600"; bgCircle = "border-green-400 border-4"; }
    else if (result.score <= 40 && result.score !== null) { scoreColor = "text-red-500"; bgCircle = "border-red-200 border-2"; }

    aiContainer.innerHTML = `
        <div class="flex justify-center mb-2">
            <div class="w-14 h-14 rounded-full bg-white flex items-center justify-center shadow-sm ${bgCircle}">
                <span class="text-xl font-bold ${scoreColor}">${result.score !== null ? result.score : '?'}</span>
                ${result.score !== null ? '<span class="text-xs text-gray-400 font-normal">%</span>' : ''}
            </div>
        </div>
        <p class="text-xs text-gray-700 font-medium leading-tight">${result.reason}</p>
    `;
    
    if (currentSort === "match") applyFiltersAndRender();
}

async function handleAcceptTask(taskId) {
    const btn = document.getElementById(`accept-btn-${taskId}`);
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Accepting...';

    try {
        await updateDoc(doc(db, "tasks", taskId), {
            acceptedVolunteers: arrayUnion(currentUser.uid)
        });
    } catch (error) {
        alert("Failed to accept task: " + error.message);
        btn.disabled = false;
        btn.innerHTML = "Accept Task";
    }
}

async function handleDropTask(taskId, taskTitle) {
    if (!confirm(`Are you sure you want to drop your commitment to "${taskTitle}"?`)) return;
    
    const btn = document.getElementById(`drop-btn-${taskId}`);
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Dropping...';

    try {
        await updateDoc(doc(db, "tasks", taskId), {
            acceptedVolunteers: arrayRemove(currentUser.uid)
        });
    } catch (error) {
        alert("Failed to drop task: " + error.message);
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-user-minus"></i> Drop Task';
    }
}

init();