import { db } from "./firebase-config.js";
import { checkAuthAndRedirect, logoutUser } from "./auth.js";
import { 
    collection, 
    addDoc, 
    serverTimestamp, 
    query, 
    where, 
    onSnapshot,
    doc,
    updateDoc,
    getDoc,
    deleteDoc,
    arrayRemove
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

// Global State
let currentUser = null;
let currentNGOData = null;
let globalTasks = []; // Store fetched tasks for local sorting
let currentSort = "newest";

// UI Elements
const pageBody = document.getElementById("page-body");
const logoutBtn = document.getElementById("logout-btn");
const navOrgName = document.getElementById("nav-org-name");

// Profile & Form
const profileInitial = document.getElementById("profile-initial");
const profileOrgName = document.getElementById("profile-org-name");
const profileLocation = document.getElementById("profile-location");
const profileDesc = document.getElementById("profile-desc");
const profileAdminName = document.getElementById("profile-admin-name");
const profilePhone = document.getElementById("profile-phone");

const titleInput = document.getElementById("task-title");
const descInput = document.getElementById("task-desc");
const datesInput = document.getElementById("task-dates");
const timeInput = document.getElementById("task-time");
const skillsInput = document.getElementById("task-skills");
const locationInput = document.getElementById("task-location");
const urgencyInput = document.getElementById("task-urgency");
const countInput = document.getElementById("task-count");
const postBtn = document.getElementById("post-task-btn");
const errorBox = document.getElementById("task-error");
const successBox = document.getElementById("task-success");

const tasksContainer = document.getElementById("tasks-container");
const taskCounter = document.getElementById("task-counter");
const tasksLoader = document.getElementById("tasks-loader");
const sortDropdown = document.getElementById("sort-tasks");
const toggleClosedCheckbox = document.getElementById("toggle-closed");

// Manage Modal Elements
const manageModal = document.getElementById("manage-modal");
const modalTaskTitle = document.getElementById("modal-task-title");
const modalLoader = document.getElementById("modal-loader");
const modalEmpty = document.getElementById("modal-empty");
const modalVolList = document.getElementById("modal-volunteers-list");

// Edit Modal Elements
const editModal = document.getElementById("edit-modal");
const editId = document.getElementById("edit-task-id");
const editTitle = document.getElementById("edit-task-title");
const editDesc = document.getElementById("edit-task-desc");
const editDates = document.getElementById("edit-task-dates");
const editTime = document.getElementById("edit-task-time");
const editLocation = document.getElementById("edit-task-location");
const editUrgency = document.getElementById("edit-task-urgency");
const editCount = document.getElementById("edit-task-count");

// 1. Initialize Page
async function init() {
    try {
        const authData = await checkAuthAndRedirect("ngo");
        currentUser = authData.user;
        currentNGOData = authData.userData;

        navOrgName.textContent = currentNGOData.orgName;
        profileOrgName.textContent = currentNGOData.orgName || "Organization";
        profileInitial.textContent = currentNGOData.orgName ? currentNGOData.orgName.charAt(0).toUpperCase() : "N";
        profileLocation.textContent = currentNGOData.orgLocation || "Not set";
        profileDesc.textContent = currentNGOData.orgDescription || "No description.";
        profileAdminName.textContent = currentNGOData.adminName || "Not set";
        profilePhone.textContent = currentNGOData.adminPhone || "Not set";

        if (currentNGOData.orgLocation) {
            locationInput.value = currentNGOData.orgLocation;
        }

        pageBody.classList.remove("hidden");
        listenToMyTasks();
        setupModalListeners();
        
        // Sorting and Filter Listeners
        sortDropdown.addEventListener("change", (e) => {
            currentSort = e.target.value;
            applySortingAndRender();
        });
        
        toggleClosedCheckbox.addEventListener("change", () => {
            applySortingAndRender();
        });

    } catch (error) {
        console.error("Auth failed:", error);
    }
}

logoutBtn.addEventListener("click", logoutUser);

// 2. Post a New Task
postBtn.addEventListener("click", async () => {
    errorBox.classList.add("hidden");
    successBox.classList.add("hidden");

    const title = titleInput.value.trim();
    const desc = descInput.value.trim();
    const dates = datesInput.value.trim() || "Flexible";
    const time = timeInput.value.trim() || "Not specified";
    const skillsRaw = skillsInput.value.trim();
    const location = locationInput.value.trim();
    const urgency = urgencyInput.value;
    const count = parseInt(countInput.value);

    if (!title || !desc || !skillsRaw || !location || !count) {
        errorBox.textContent = "Please fill in all mandatory fields.";
        errorBox.classList.remove("hidden");
        return;
    }

    const skillsArray = skillsRaw.split(',').map(s => s.trim().toLowerCase()).filter(s => s !== "");
    
    postBtn.disabled = true;
    postBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Posting...';

    try {
        await addDoc(collection(db, "tasks"), {
            title,
            description: desc,
            dates,
            time,
            requiredSkills: skillsArray,
            location,
            urgency,
            volunteersNeeded: count,
            postedBy: currentUser.uid,
            orgName: currentNGOData.orgName,
            status: "open",
            createdAt: serverTimestamp(),
            acceptedVolunteers: []
        });

        successBox.classList.remove("hidden");
        titleInput.value = "";
        descInput.value = "";
        datesInput.value = "";
        timeInput.value = "";
        skillsInput.value = "";
        countInput.value = "1";
        urgencyInput.value = "Medium";

        setTimeout(() => successBox.classList.add("hidden"), 3000);
    } catch (error) {
        errorBox.textContent = "Error: " + error.message;
        errorBox.classList.remove("hidden");
    } finally {
        postBtn.disabled = false;
        postBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Post Task';
    }
});

// 3. Real-time Listener for Tasks
function listenToMyTasks() {
    const q = query(collection(db, "tasks"), where("postedBy", "==", currentUser.uid));

    onSnapshot(q, (snapshot) => {
        tasksLoader.classList.add("hidden");
        
        if (snapshot.empty) {
            globalTasks = [];
            tasksContainer.innerHTML = `<div class="bg-white p-10 rounded-2xl border text-center text-gray-500">No tasks posted yet.</div>`;
            taskCounter.textContent = "0 Displayed";
            return;
        }

        globalTasks = [];
        snapshot.forEach(doc => globalTasks.push({ id: doc.id, ...doc.data() }));
        
        applySortingAndRender();
    });
}

// 4. Sorting & Filtering Logic
function applySortingAndRender() {
    // Apply Filter first
    let filteredTasks = globalTasks;
    if (!toggleClosedCheckbox.checked) {
        filteredTasks = globalTasks.filter(t => t.status !== "closed");
    }

    // Then Apply Sorting
    if (currentSort === "newest") {
        filteredTasks.sort((a, b) => {
            const timeA = a.createdAt ? a.createdAt.toMillis() : Date.now();
            const timeB = b.createdAt ? b.createdAt.toMillis() : Date.now();
            return timeB - timeA;
        });
    } else if (currentSort === "urgency") {
        const priority = { "High": 3, "Medium": 2, "Low": 1 };
        filteredTasks.sort((a, b) => priority[b.urgency] - priority[a.urgency]);
    } else if (currentSort === "accepted") {
        filteredTasks.sort((a, b) => {
            const countA = a.acceptedVolunteers ? a.acceptedVolunteers.length : 0;
            const countB = b.acceptedVolunteers ? b.acceptedVolunteers.length : 0;
            return countB - countA; // Highest first
        });
    }

    renderTasks(filteredTasks);
}

// 5. Render Tasks (With combined text and fixed spacing)
function renderTasks(tasks) {
    tasksContainer.innerHTML = "";
    taskCounter.textContent = `${tasks.length} Displayed`;

    if (tasks.length === 0 && globalTasks.length > 0) {
         tasksContainer.innerHTML = `<div class="text-center py-6 text-gray-400 italic">All tasks are currently closed. Uncheck "Show Closed" to view them.</div>`;
         return;
    }

    tasks.forEach(task => {
        const isClosed = task.status === "closed";
        const acceptedCount = task.acceptedVolunteers ? task.acceptedVolunteers.length : 0;
        
        const card = document.createElement("div");
        card.className = `bg-white rounded-2xl shadow-sm border p-6 relative overflow-hidden transition group ${isClosed ? 'border-gray-200 opacity-75' : 'border-blue-100 hover:shadow-md'}`;
        
        let accent = isClosed ? "bg-gray-400" : (task.urgency === "High" ? "bg-red-500" : (task.urgency === "Low" ? "bg-green-500" : "bg-yellow-400"));

        card.innerHTML = `
            <div class="absolute left-0 top-0 bottom-0 w-1.5 ${accent}"></div>
            
            <div class="flex justify-between items-start mb-2">
                <div class="flex items-center gap-3">
                    <h3 class="text-xl font-bold ${isClosed ? 'text-gray-500 line-through' : 'text-gray-800'}">${task.title}</h3>
                    <span class="text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider border ${isClosed ? 'bg-gray-100 text-gray-600 border-gray-200' : 'bg-green-100 text-green-800 border-green-200'}">
                        ${isClosed ? 'CLOSED' : 'OPEN'}
                    </span>
                </div>
                
                <div class="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button id="edit-btn-${task.id}" class="w-8 h-8 rounded-full bg-gray-50 hover:bg-blue-50 text-gray-400 hover:text-blue-600 transition flex items-center justify-center" title="Edit Task">
                        <i class="fa-solid fa-pen text-xs"></i>
                    </button>
                    <button id="del-btn-${task.id}" class="w-8 h-8 rounded-full bg-gray-50 hover:bg-red-50 text-gray-400 hover:text-red-600 transition flex items-center justify-center" title="Delete Task">
                        <i class="fa-solid fa-trash-can text-xs"></i>
                    </button>
                </div>
            </div>

            <div class="flex flex-wrap gap-4 text-xs font-medium text-gray-500 mb-4">
                <div class="flex items-center gap-1.5 bg-gray-50 px-2 py-1 rounded border border-gray-100"><i class="fa-regular fa-calendar text-blue-500"></i> ${task.dates || 'Flexible'}</div>
                <div class="flex items-center gap-1.5 bg-gray-50 px-2 py-1 rounded border border-gray-100"><i class="fa-regular fa-clock text-blue-500"></i> ${task.time || 'Not specified'}</div>
                <div class="flex items-center gap-1.5 bg-gray-50 px-2 py-1 rounded border border-gray-100"><i class="fa-solid fa-fire text-blue-500"></i> ${task.urgency} Urgency</div>
            </div>
            
            <p class="text-gray-600 text-sm mb-4 leading-relaxed">${task.description}</p>
            
            <div class="flex flex-col gap-2 border-t pt-4 mt-2 text-sm text-gray-600 mb-5">
                <div class="flex items-start gap-2">
                    <i class="fa-solid fa-location-dot mt-0.5 text-gray-400"></i> 
                    <span class="leading-tight">${task.location}</span>
                </div>
                <div class="flex items-center gap-2 font-bold ${acceptedCount >= task.volunteersNeeded ? 'text-green-600' : 'text-blue-600'}">
                    <i class="fa-solid fa-users text-gray-400"></i> 
                    Volunteers: ${acceptedCount}/${task.volunteersNeeded} Accepted
                </div>
            </div>

            <div class="flex gap-3 mt-4">
                <button id="manage-${task.id}" class="flex-1 bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold py-2 rounded-lg transition text-sm border border-blue-200">
                    <i class="fa-solid fa-users-gear mr-1"></i> Manage
                </button>
                <button id="toggle-${task.id}" class="flex-1 ${isClosed ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100' : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'} font-semibold py-2 rounded-lg transition text-sm border">
                    <i class="fa-solid ${isClosed ? 'fa-lock-open' : 'fa-lock'} mr-1"></i> ${isClosed ? 'Reopen' : 'Close'}
                </button>
            </div>
        `;
        tasksContainer.appendChild(card);

        document.getElementById(`toggle-${task.id}`).addEventListener("click", () => toggleTaskStatus(task.id, task.status));
        document.getElementById(`manage-${task.id}`).addEventListener("click", () => openManageModal(task));
        document.getElementById(`del-btn-${task.id}`).addEventListener("click", () => deleteTask(task.id));
        document.getElementById(`edit-btn-${task.id}`).addEventListener("click", () => openEditModal(task));
    });
}

// 6. Delete Task
async function deleteTask(taskId) {
    if (confirm("Are you sure you want to completely delete this task? This action cannot be undone.")) {
        try {
            await deleteDoc(doc(db, "tasks", taskId));
        } catch (error) {
            alert("Failed to delete task: " + error.message);
        }
    }
}

// 7. Edit Task Modal Logic
function openEditModal(task) {
    editId.value = task.id;
    editTitle.value = task.title;
    editDesc.value = task.description;
    editDates.value = task.dates || "";
    editTime.value = task.time || "";
    editLocation.value = task.location;
    editUrgency.value = task.urgency;
    editCount.value = task.volunteersNeeded;
    
    editModal.classList.remove("hidden");
}

document.getElementById("save-edit-btn").addEventListener("click", async () => {
    const taskId = editId.value;
    const btn = document.getElementById("save-edit-btn");
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

    try {
        await updateDoc(doc(db, "tasks", taskId), {
            title: editTitle.value.trim(),
            description: editDesc.value.trim(),
            dates: editDates.value.trim() || "Flexible",
            time: editTime.value.trim() || "Not specified",
            location: editLocation.value.trim(),
            urgency: editUrgency.value,
            volunteersNeeded: parseInt(editCount.value)
        });
        editModal.classList.add("hidden");
    } catch (error) {
        alert("Failed to update task: " + error.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'Save Changes';
    }
});

// 8. Toggle Open/Closed Status
async function toggleTaskStatus(taskId, currentStatus) {
    const newStatus = currentStatus === "open" ? "closed" : "open";
    try {
        await updateDoc(doc(db, "tasks", taskId), { status: newStatus });
    } catch (error) {
        alert("Failed to update status: " + error.message);
    }
}

// 9. Manage Volunteers Modal Logic
function setupModalListeners() {
    document.getElementById("close-modal-btn").addEventListener("click", () => manageModal.classList.add("hidden"));
    document.getElementById("close-modal-btn-bottom").addEventListener("click", () => manageModal.classList.add("hidden"));
    
    document.getElementById("close-edit-btn").addEventListener("click", () => editModal.classList.add("hidden"));
    document.getElementById("cancel-edit-btn").addEventListener("click", () => editModal.classList.add("hidden"));
}

async function openManageModal(task) {
    modalTaskTitle.textContent = task.title;
    modalVolList.innerHTML = "";
    manageModal.classList.remove("hidden");

    if (!task.acceptedVolunteers || task.acceptedVolunteers.length === 0) {
        modalLoader.classList.add("hidden");
        modalEmpty.classList.remove("hidden");
        return;
    }

    modalEmpty.classList.add("hidden");
    modalLoader.classList.remove("hidden");

    try {
        for (const uid of task.acceptedVolunteers) {
            const userSnap = await getDoc(doc(db, "users", uid));
            if (userSnap.exists()) {
                const vol = userSnap.data();
                
                const volCard = document.createElement("div");
                volCard.className = "bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between";
                
                volCard.innerHTML = `
                    <div>
                        <h4 class="font-bold text-gray-800">${vol.name}</h4>
                        <div class="text-xs text-gray-500 mt-1 flex flex-col gap-1">
                            <span><i class="fa-solid fa-phone mr-1"></i> ${vol.phone || "No phone"}</span>
                            <span><i class="fa-solid fa-envelope mr-1"></i> ${vol.email}</span>
                        </div>
                    </div>
                    <button id="kick-${task.id}-${uid}" class="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-3 py-1.5 rounded-lg text-sm font-bold transition">
                        Kick
                    </button>
                `;
                modalVolList.appendChild(volCard);

                document.getElementById(`kick-${task.id}-${uid}`).addEventListener("click", () => kickVolunteer(task.id, uid, vol.name));
            }
        }
    } catch (error) {
        console.error("Error fetching volunteers:", error);
    } finally {
        modalLoader.classList.add("hidden");
    }
}

async function kickVolunteer(taskId, volunteerUid, volunteerName) {
    if (!confirm(`Are you sure you want to remove ${volunteerName} from this task?`)) return;

    try {
        await updateDoc(doc(db, "tasks", taskId), {
            acceptedVolunteers: arrayRemove(volunteerUid)
        });
        manageModal.classList.add("hidden");
        alert(`${volunteerName} removed successfully.`);
    } catch (error) {
        alert("Failed to remove volunteer: " + error.message);
    }
}

init();