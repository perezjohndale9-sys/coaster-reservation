// ================= Firebase (Compat Initialization matching HTML script tags) =================
const firebaseConfig = {
  apiKey: "AIzaSyDen-rGO_rvp9FA7a6nCLjUaU5bOKwsrps",
  authDomain: "coaster-reservation.firebaseapp.com",
  databaseURL: "https://coaster-reservation-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "coaster-reservation",
  storageBucket: "coaster-reservation.firebasestorage.app",
  messagingSenderId: "623130470619",
  appId: "1:623130470619:web:d86646632fcb9b6d7144fe",
  measurementId: "G-43MHRKY4T4"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const db = firebase.database();
const auth = firebase.auth();

const COASTER_CAPACITY = 30;
const L300_CAPACITY = 18;
let CAPACITY = COASTER_CAPACITY; // Default Coaster capacity
const TZ = "Asia/Manila";
const DOOR_CODE = "MCC-VEHICLE-DOOR-V1";
// If the driver forgets to tap "Trip departed", a trip closes by itself this long after its scheduled time.
const SAFETY_NET_MS = 30 * 60 * 1000;

// ================= Time helpers (server-synced, Manila) =================
let serverTimeOffset = 0;
let timeSynced = false; // true once we know the real server time (not the phone's clock)
db.ref(".info/serverTimeOffset").on("value", (snap) => {
  serverTimeOffset = snap.val() || 0;
  timeSynced = true;
});

function getSyncedNow() {
  return Date.now() + serverTimeOffset;
}

function manilaDateKey(ms) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date(ms));
  
  const y = parts.find(p => p.type === "year").value;
  const m = parts.find(p => p.type === "month").value;
  const d = parts.find(p => p.type === "day").value;
  return `${y}-${m}-${d}`;
}

function tripTimeMs(tripId) {
  const m = /^(\d{4})-(\d{2})-(\d{2})_.*_(\d{2})(\d{2})$/.exec(tripId || "");
  if (!m) return NaN;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10) - 1; 
  const day = parseInt(m[3], 10);
  const hours = parseInt(m[4], 10);
  const minutes = parseInt(m[5], 10);

  // Manila is UTC+8: Subtract 8 hours for accurate UTC comparison
  return Date.UTC(year, month, day, hours - 8, minutes);
}

function isTripDeparted(tripId) {
  return isTripClosed(tripId);
}

// A trip stays OPEN until the driver taps "Trip departed" (saved in Firebase: tripStatus).
// Safety net: if the driver forgets, it closes SAFETY_NET_MS after its scheduled time.
// While a trip is open, reservations keep their seats and students can scan at any time.
function isTripClosed(tripId) {
  if (departedTrips[tripId]) return true;
  const dep = tripTimeMs(tripId);
  return isNaN(dep) || getSyncedNow() >= dep + SAFETY_NET_MS;
}

function isSeatHeld(res) {
  if (!res) return false;
  if (res.status !== "ACTIVE" && res.status !== "FULFILLED") return false;
  return !isTripClosed(res.tripId);
}

function resPhase(res) {
  if (!res) return "none";
  if (!isSeatHeld(res)) return "expired";
  return res.status === "FULFILLED" ? "fulfilled" : "held";
}

// The earliest trip today that is still open = the one the vehicle will do next
function nextOpenTrip(dateKey) {
  return [...madapdapToMabigaTimes, ...mabigaToMadapdapTimes]
    .map((t) => `${dateKey}_${t.val}`)
    .sort((a, b) => tripTimeMs(a) - tripTimeMs(b))
    .find((t) => !isTripClosed(t)) || null;
}

// Students can only reserve the CURRENT trip = the one the vehicle will do next (Manila time).
// Later trips stay locked until the earlier ones depart, so nobody books ahead.
function currentTripId() {
  return nextOpenTrip(manilaDateKey(getSyncedNow()));
}

// ================= State =================
let reservations = {};
let vehicleAvailable = true;
let vehicleType = "Coaster"; 
let isDriverLoggedIn = false;
let myUid = null;
let activeReservation = null;
let selectedTrip = null;
let lastOpenTrip = null;

let reserveBusy = false;
let renderedPhase = "none";
let departedTrips = {};
let driverView = false;
let tickCount = 0;
let lastMadapdapHtml = "";
let lastMabigaHtml = "";

// ================= DOM =================
const $ = (id) => document.getElementById(id);
const slotCount = $("slot-count");
const phClock = $("ph-clock");
const reserveBtn = $("reserve-btn");
const cancelBtn = $("cancel-btn");
const reservationPanel = $("reservation-panel");
const reservationTrip = $("reservation-trip");
const resetNote = $("reset-note");
const checkinBanner = $("checkin-status-banner");
const checkinText = $("checkin-status-text");
const cameraSection = $("camera-section");
const seatGrid = $("seat-grid");
const syncIndicator = $("sync-indicator");
const toast = $("toast");
const availabilityBanner = $("availability-banner");
const availabilityMessage = $("availability-message");
const roleSelectScreen = $("role-select-screen");
const roleStudentBtn = $("role-student-btn");
const roleDriverBtn = $("role-driver-btn");
const switchRoleBtn = $("switch-role-btn");
const loginModal = $("login-modal");
const loginForm = $("login-form");
const loginEmail = $("login-email");
const loginPassword = $("login-password");
const loginError = $("login-error");
const loginCancel = $("login-cancel");
const driverPanel = $("driver-panel");
const driverLogout = $("driver-logout");
const markAvailableBtn = $("mark-available-btn");
const markUnavailableBtn = $("mark-unavailable-btn");
const markL300Btn = $("mark-l300-btn");
const markCoasterBtn = $("mark-coaster-btn");
const driverCurrentStatus = $("driver-current-status");
const capacityBarFill = $("capacity-bar-fill");
const selectMadapdapMabiga = $("select-madapdap-mabiga");
const selectMabigaMadapdap = $("select-mabiga-madapdap");
const openCameraBtn = $("open-camera-btn");
const qrFileInput = $("qr-file-input");
const scannerModal = $("scanner-modal");
const uploadFileBtn = $("upload-file-btn");
const closeScannerBtn = $("close-scanner-btn");
const showDoorQrBtn = $("show-door-qr-btn");
const doorQrModal = $("door-qr-modal");
const doorQrCode = $("door-qr-code");
const printDoorQrBtn = $("print-door-qr-btn");
const closeDoorQrBtn = $("close-door-qr-btn");
const dpTripName = $("dp-trip-name");
const dpTripMeta = $("dp-trip-meta");
const markDepartedBtn = $("mark-departed-btn");

// ================= Schedules =================
const madapdapToMabigaTimes = [
  { label: "6:00 AM", val: "madapdap_mabiga_0600" },
  { label: "6:40 AM", val: "madapdap_mabiga_0640" },
  { label: "7:20 AM", val: "madapdap_mabiga_0720" },
  { label: "8:00 AM", val: "madapdap_mabiga_0800" },
  { label: "10:00 AM", val: "madapdap_mabiga_1000" },
  { label: "10:40 AM", val: "madapdap_mabiga_1040" },
  { label: "11:20 AM", val: "madapdap_mabiga_1120" },
  { label: "1:00 PM", val: "madapdap_mabiga_1300" },
  { label: "3:00 PM", val: "madapdap_mabiga_1500" },
  { label: "4:00 PM", val: "madapdap_mabiga_1600" },
  { label: "5:00 PM", val: "madapdap_mabiga_1700" },
  { label: "6:00 PM", val: "madapdap_mabiga_1800" },
  { label: "7:00 PM", val: "madapdap_mabiga_1900" },
  { label: "8:00 PM", val: "madapdap_mabiga_2000" },
  { label: "9:10 PM", val: "madapdap_mabiga_2110" }
];

const mabigaToMadapdapTimes = [
  { label: "6:20 AM", val: "mabiga_madapdap_0620" },
  { label: "7:00 AM", val: "mabiga_madapdap_0700" },
  { label: "7:40 AM", val: "mabiga_madapdap_0740" },
  { label: "8:20 AM", val: "mabiga_madapdap_0820" },
  { label: "10:20 AM", val: "mabiga_madapdap_1020" },
  { label: "11:00 AM", val: "mabiga_madapdap_1100" },
  { label: "11:40 AM", val: "mabiga_madapdap_1140" },
  { label: "1:20 PM", val: "mabiga_madapdap_1320" },
  { label: "2:20 PM", val: "mabiga_madapdap_1420" },
  { label: "3:20 PM", val: "mabiga_madapdap_1520" },
  { label: "4:20 PM", val: "mabiga_madapdap_1620" },
  { label: "5:20 PM", val: "mabiga_madapdap_1720" },
  { label: "6:20 PM", val: "mabiga_madapdap_1820" },
  { label: "7:20 PM", val: "mabiga_madapdap_1920" },
  { label: "8:20 PM", val: "mabiga_madapdap_2020" }
];

function tripLabel(tripId) {
  const all = [
    ...madapdapToMabigaTimes.map((t) => ({ ...t, dir: "Madapdap → Mabiga" })),
    ...mabigaToMadapdapTimes.map((t) => ({ ...t, dir: "Mabiga → Madapdap" }))
  ];
  const hit = all.find((t) => tripId && tripId.endsWith(t.val));
  return hit ? `${hit.label} (${hit.dir})` : tripId;
}

// ================= UI helpers =================
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3500);
}

function updateClockOnly() {
  if (!timeSynced) { phClock.textContent = "🇵🇭 Syncing Philippine time…"; return; }
  phClock.textContent = `🇵🇭 ${new Date(getSyncedNow()).toLocaleTimeString("en-US", { timeZone: TZ })}`;
}

function refreshTripOptions() {
  const now = getSyncedNow();
  const dateKey = manilaDateKey(now);

  const currentTrip = nextOpenTrip(dateKey);

  const buildHTML = (list, dirLabel) => {
    let html = '<option value="" disabled>-- Select Time --</option>';
    list.forEach((item) => {
      const value = `${dateKey}_${item.val}`;
      const departed = isTripDeparted(value);
      const isCurrent = value === currentTrip;
      const note = departed ? " – departed" : isCurrent ? " – reserve now" : " – not open yet";
      html += `<option value="${value}" ${isCurrent ? "" : "disabled"}>${item.label} (${dirLabel})${note}</option>`;
    });
    return html;
  };

  const newMadapdapHtml = buildHTML(madapdapToMabigaTimes, "Madapdap → Mabiga");
  const newMabigaHtml = buildHTML(mabigaToMadapdapTimes, "Mabiga → Madapdap");

  if (document.activeElement !== selectMadapdapMabiga && lastMadapdapHtml !== newMadapdapHtml) {
    const val = selectMadapdapMabiga.value;
    selectMadapdapMabiga.innerHTML = newMadapdapHtml;
    selectMadapdapMabiga.value = val;
    lastMadapdapHtml = newMadapdapHtml;
  }

  if (document.activeElement !== selectMabigaMadapdap && lastMabigaHtml !== newMabigaHtml) {
    const val = selectMabigaMadapdap.value;
    selectMabigaMadapdap.innerHTML = newMabigaHtml;
    selectMabigaMadapdap.value = val;
    lastMabigaHtml = newMabigaHtml;
  }

  // Everyone (student and driver) always follows the vehicle's current trip
  selectedTrip = nextOpenTrip(dateKey);

  // When a trip departs, the next one opens for reservation: let students know
  if (selectedTrip && lastOpenTrip && selectedTrip !== lastOpenTrip && !isDriverActive() && !activeReservation) {
    showToast(`Next trip is now open: ${tripLabel(selectedTrip)}`);
  }
  lastOpenTrip = selectedTrip;

  if (selectedTrip) {
    if (selectedTrip.includes("_madapdap_mabiga_")) {
      if (document.activeElement !== selectMadapdapMabiga) selectMadapdapMabiga.value = selectedTrip;
      if (document.activeElement !== selectMabigaMadapdap) selectMabigaMadapdap.value = "";
    } else {
      if (document.activeElement !== selectMabigaMadapdap) selectMabigaMadapdap.value = selectedTrip;
      if (document.activeElement !== selectMadapdapMabiga) selectMadapdapMabiga.value = "";
    }
  }
}

function isDriverActive() {
  return isDriverLoggedIn && driverView;
}

// Driver view hides reservation controls + schedules; seat slots stay visible
function applyMode() {
  const drv = isDriverActive();
  document.body.classList.toggle("driver-mode", drv);
  driverPanel.hidden = !drv;
}

function renderDriverPanel() {
  markAvailableBtn.classList.toggle("active", vehicleAvailable);
  markUnavailableBtn.classList.toggle("active", !vehicleAvailable);
  markL300Btn.classList.toggle("active", vehicleType === "L300");
  markCoasterBtn.classList.toggle("active", vehicleType !== "L300");
  driverCurrentStatus.textContent =
    `${vehicleAvailable ? "Available" : "Unavailable"} · ${vehicleType} · ${CAPACITY} seats`;

  const t = nextOpenTrip(manilaDateKey(getSyncedNow()));
  if (!t) {
    dpTripName.textContent = "No more trips today";
    dpTripMeta.textContent = "All of today's trips are done.";
    markDepartedBtn.disabled = true;
    return;
  }
  const held = Object.values(reservations[t] || {}).filter((r) => isSeatHeld(r) && r.seatNumber <= CAPACITY);
  const boarded = held.filter((r) => r.status === "FULFILLED").length;
  dpTripName.textContent = tripLabel(t);
  dpTripMeta.textContent = `${held.length} / ${CAPACITY} reserved · ${boarded} boarded`;
  markDepartedBtn.disabled = false;
}

function renderUI() {
  updateClockOnly();
  applyMode();
  refreshTripOptions();

  if (!vehicleAvailable) {
    availabilityBanner.hidden = false;
    availabilityMessage.textContent = "Vehicle marked UNAVAILABLE by driver.";
  } else {
    availabilityBanner.hidden = true;
  }

  renderSeats();
  renderReservationUI();
  renderDriverPanel();
}

selectMadapdapMabiga.addEventListener("change", (e) => {
  selectedTrip = e.target.value;
  selectMabigaMadapdap.value = "";
  renderUI();
});

selectMabigaMadapdap.addEventListener("change", (e) => {
  selectedTrip = e.target.value;
  selectMadapdapMabiga.value = "";
  renderUI();
});

const SEAT_SVG = `<svg viewBox="0 0 40 44" aria-hidden="true">
  <rect x="1" y="20" width="6" height="18" rx="3" fill="currentColor" class="cush"/>
  <rect x="33" y="20" width="6" height="18" rx="3" fill="currentColor" class="cush"/>
  <rect x="5" y="26" width="30" height="12" rx="5" fill="currentColor" class="cush"/>
  <rect x="8" y="2" width="24" height="26" rx="7" fill="currentColor"/>
</svg>`;

function seatHTML(n, label) {
  return `<div class="seat-art">${SEAT_SVG}<span class="seat-num">${n}</span></div><span class="seat-badge">${label}</span>`;
}

function renderSeats() {
  seatGrid.innerHTML = "";

  if (!selectedTrip || isTripDeparted(selectedTrip)) {
    slotCount.textContent = "No upcoming trips";
    capacityBarFill.style.width = "100%";
    return;
  }

  const tripData = reservations[selectedTrip] || {};
  const held = Object.values(tripData).filter(isSeatHeld);
  const bySeat = {};
  held.forEach((r) => { bySeat[r.seatNumber] = r; });

  for (let i = 1; i <= CAPACITY; i++) {
    if ((i - 1) % 4 === 2) {
      const aisle = document.createElement("div");
      aisle.className = "aisle-spacer";
      seatGrid.appendChild(aisle);
    }

    const seatEl = document.createElement("div");
    seatEl.className = "seat";
    const r = bySeat[i];

    if (r && r.uid === myUid) {
      if (r.status === "FULFILLED") {
        // Scanned the door QR: seat is confirmed
        seatEl.classList.add("mine", "checked-in");
        seatEl.innerHTML = seatHTML(i, "Checked in");
      } else {
        // Reserved but not scanned yet
        seatEl.classList.add("mine", "my-reserved");
        seatEl.innerHTML = seatHTML(i, "Reserved");
      }
    } else if (r) {
      if (r.status === "FULFILLED") {
        seatEl.classList.add("boarded");
        seatEl.innerHTML = seatHTML(i, "Boarded");
      } else {
        seatEl.classList.add("reserved");
        seatEl.innerHTML = seatHTML(i, "Taken");
      }
    } else {
      seatEl.classList.add("free");
      seatEl.innerHTML = seatHTML(i, "Free");
    }
    seatGrid.appendChild(seatEl);
  }

  const reservedCount = held.filter((r) => r.seatNumber <= CAPACITY).length;
  slotCount.innerHTML = `<span class="available-num">${CAPACITY - reservedCount}</span> / ${CAPACITY} Free`;
  capacityBarFill.style.width = `${(reservedCount / CAPACITY) * 100}%`;
}

// ================= Reservation panel =================
function findMyReservation() {
  let found = null;
  if (!myUid) return null;
  Object.values(reservations).forEach((trip) => {
    Object.values(trip).forEach((res) => {
      if (res.uid === myUid && isSeatHeld(res)) found = res;
    });
  });
  return found;
}

function renderReservationUI() {
  if (activeReservation) {
    if (activeReservation.seatNumber > CAPACITY) {
      showToast("Your reserved seat was affected by vehicle size change. Please re-book.");
      db.ref(`reservations/${activeReservation.tripId}/${activeReservation.id}/status`).set("CANCELLED");
      activeReservation = null;
      renderUI();
      return;
    }

    const phase = resPhase(activeReservation);
    renderedPhase = phase;
    reservationPanel.hidden = false;
    reserveBtn.hidden = true;
    cancelBtn.hidden = false;
    reservationTrip.textContent = `Seat ${activeReservation.seatNumber} · ${tripLabel(activeReservation.tripId)}`;
    checkinBanner.classList.toggle("fulfilled", phase === "fulfilled");

    if (phase === "fulfilled") {
      checkinText.textContent = "✅ Boarding confirmed. Enjoy your ride!";
      cameraSection.hidden = true;
      cancelBtn.hidden = true;
    } else {
      checkinText.textContent = "⚠️ Scan the QR code on the vehicle door upon boarding to confirm your seat!";
      cameraSection.hidden = false;
    }
    updateCountdown();
  } else {
    renderedPhase = "none";
    reservationPanel.hidden = true;
    reserveBtn.hidden = false;
    cancelBtn.hidden = true;
  }
}

// (No scan countdown anymore) just the note under the panel
function updateCountdown() {
  const r = activeReservation;
  if (!r) return;
  resetNote.textContent = r.status === "FULFILLED"
    ? "Seat confirmed. Slots reset when the driver marks this trip as departed."
    : "Scan the door QR when you board. Your seat stays until the driver marks this trip as departed.";
}

// ================= Keep my reservation + clean up expired ones =================
const cleanedTrips = new Set();

// Returns true when my reservation changed (new, scanned, released or expired)
function syncMyReservation() {
  const mine = findMyReservation();
  const sig = (r) => (r ? `${r.id}:${r.status}` : "");
  if (sig(mine) === sig(activeReservation)) return false;
  const prev = activeReservation;
  activeReservation = mine;
  if (prev && !mine) {
    const rec = (reservations[prev.tripId] || {})[prev.id] || null;
    if (rec && rec.status === "CANCELLED") { /* student cancelled, no message */ }
    else if (rec && rec.status === "FULFILLED") showToast("Trip departed. Have a safe ride!");
    else showToast("Trip departed - your unscanned reservation was cleared.");
  }
  return true;
}

// ANY open page does this, so unscanned seats are freed even if the reserver closed the app.
function cleanupExpired() {
  const updates = {};
  Object.keys(reservations).forEach((tripKey) => {
    Object.entries(reservations[tripKey] || {}).forEach(([id, r]) => {
      if (r && r.status === "ACTIVE" && isTripClosed(r.tripId || tripKey)) {
        updates[`${tripKey}/${id}/status`] = "EXPIRED";
      }
    });
  });
  if (Object.keys(updates).length) db.ref("reservations").update(updates).catch(() => {});
}

// A logged-in driver tidies the database: removes data of PAST days only
function driverWipe() {
  if (!isDriverLoggedIn) return;
  const today = manilaDateKey(getSyncedNow());
  const isOld = (id) => /^\d{4}-\d{2}-\d{2}_/.test(id) && id.slice(0, 10) < today;
  Object.keys(reservations).forEach((tripId) => {
    if (isOld(tripId) && !cleanedTrips.has("r_" + tripId)) {
      cleanedTrips.add("r_" + tripId);
      db.ref(`reservations/${tripId}`).remove().catch(() => cleanedTrips.delete("r_" + tripId));
    }
  });
  Object.keys(departedTrips).forEach((tripId) => {
    if (isOld(tripId) && !cleanedTrips.has("s_" + tripId)) {
      cleanedTrips.add("s_" + tripId);
      db.ref(`tripStatus/${tripId}`).remove().catch(() => cleanedTrips.delete("s_" + tripId));
    }
  });
}

// ================= Auth =================
auth.onAuthStateChanged((user) => {
  if (!user) {
    isDriverLoggedIn = false;
    driverView = false;
    renderUI();
    auth.signInAnonymously().catch((err) => {
      syncIndicator.textContent = "Auth error";
      showToast("Auth error (" + err.code + ")");
    });
    return;
  }
  myUid = user.uid;
  isDriverLoggedIn = !user.isAnonymous;
  driverView = isDriverLoggedIn; // a logged-in driver lands in the driver view
  syncMyReservation();
  renderUI();
});

loginForm.addEventListener("submit", (e) => {
  e.preventDefault();
  loginError.hidden = true;
  auth.signInWithEmailAndPassword(loginEmail.value.trim(), loginPassword.value)
    .then(() => {
      loginModal.hidden = true;
      loginForm.reset();
    })
    .catch((err) => {
      loginError.textContent = "Login failed: " + err.code;
      loginError.hidden = false;
    });
});

loginCancel.addEventListener("click", () => { loginModal.hidden = true; });
driverLogout.addEventListener("click", () => { auth.signOut(); });

switchRoleBtn.addEventListener("click", () => { roleSelectScreen.hidden = false; });
roleStudentBtn.addEventListener("click", () => {
  roleSelectScreen.hidden = true;
  driverView = false;
  renderUI();
});
roleDriverBtn.addEventListener("click", () => {
  roleSelectScreen.hidden = true;
  if (isDriverLoggedIn) { driverView = true; renderUI(); }
  else loginModal.hidden = false;
});

// ================= Database listeners =================
db.ref(".info/connected").on("value", (snap) => {
  syncIndicator.textContent = snap.val() ? "Live Sync Active" : "Offline";
});

db.ref("reservations").on("value", (snap) => {
  reservations = snap.val() || {};
  syncMyReservation();
  cleanupExpired();
  renderUI();
});

db.ref("coasterAvailability").on("value", (snap) => {
  const data = snap.val() || {};
  vehicleAvailable = data.available !== false;
  if (data.vehicleType === "L300") {
    vehicleType = "L300";
    CAPACITY = L300_CAPACITY;
  } else {
    vehicleType = "Coaster";
    CAPACITY = COASTER_CAPACITY;
  }
  renderUI();
});

db.ref("tripStatus").on("value", (snap) => {
  const v = snap.val() || {};
  departedTrips = {};
  Object.keys(v).forEach((k) => { if (v[k] && v[k].departed) departedTrips[k] = true; });
  syncMyReservation();
  cleanupExpired();
  renderUI();
});

// ================= Reserve / Cancel =================
reserveBtn.addEventListener("click", () => {
  if (!myUid) return showToast("Connecting… try again in a moment.");
  if (!timeSynced) return showToast("Syncing Philippine time… try again in a moment.");
  if (!vehicleAvailable) return showToast("Vehicle currently unavailable.");
  if (!selectedTrip) return showToast("No upcoming trips selected.");

  // STRICT DEPARTED BLOCK CHECK: Rejects reservation if time passed
  if (isTripDeparted(selectedTrip)) {
    refreshTripOptions();
    renderUI();
    selectMadapdapMabiga.value = "";
    selectMabigaMadapdap.value = "";
    selectedTrip = null;
    return showToast("Cannot reserve: This trip has already departed.");
  }

  // ONLY THE CURRENT TRIP: no reserving a later schedule in advance
  const currentTrip = currentTripId();
  if (selectedTrip !== currentTrip) {
    selectedTrip = currentTrip;
    renderUI();
    return showToast(currentTrip
      ? `Only the current trip can be reserved: ${tripLabel(currentTrip)}.`
      : "No upcoming trips.");
  }

  if (activeReservation) return showToast("You already have an active reservation.");

  if (reserveBusy) return;
  const tripId = selectedTrip;
  let assigned = null;
  let blocked = null;
  reserveBusy = true;

  // Transaction: two phones can never end up with the same seat.
  db.ref(`reservations/${tripId}`).transaction((current) => {
    assigned = null;
    blocked = null;
    if (isTripDeparted(tripId)) { blocked = "Cannot reserve: this trip has already departed."; return; }
    if (tripId !== currentTripId()) { blocked = "Only the current trip can be reserved right now."; return; }
    const data = current ? { ...current } : {};
    const held = Object.values(data).filter(isSeatHeld);
    if (held.some((r) => r.uid === myUid)) return; // already has a seat on this trip

    const taken = new Set(held.map((r) => r.seatNumber));
    let seat = null;
    for (let i = 1; i <= CAPACITY; i++) {
      if (!taken.has(i)) { seat = i; break; }
    }
    if (seat === null) return; // full

    const now = getSyncedNow();
    const resId = "res_" + now + "_" + Math.random().toString(36).slice(2, 6);
    assigned = { id: resId, uid: myUid, seatNumber: seat, status: "ACTIVE", tripId, createdAt: now };
    data[resId] = assigned;
    return data;
  })
    .then(({ committed }) => {
      reserveBusy = false;
      if (committed && assigned) showToast(`Seat ${assigned.seatNumber} Reserved!`);
      else if (blocked) showToast(blocked);
      else showToast("Vehicle is full.");
    })
    .catch((err) => {
      reserveBusy = false;
      showToast("Permission Error: " + err.message);
    });
});

cancelBtn.addEventListener("click", () => {
  if (!activeReservation) return;
  if (activeReservation.status === "FULFILLED") return showToast("You already boarded, so this can't be cancelled.");
  const r = activeReservation;
  db.ref(`reservations/${r.tripId}/${r.id}/status`).set("CANCELLED")
    .then(() => {
      activeReservation = null;
      showToast("Reservation Cancelled.");
      renderUI();
    })
    .catch((err) => showToast("Error: " + err.message));
});

// ================= QR scanning =================
let html5Qr = null;
let scanHandled = false;

async function stopScanner() {
  if (html5Qr) {
    try { if (html5Qr.isScanning) await html5Qr.stop(); } catch (e) {}
    try { html5Qr.clear(); } catch (e) {}
    html5Qr = null;
  }
}

async function closeScanner() {
  await stopScanner();
  scannerModal.hidden = true;
}

function fulfillReservation() {
  const r = activeReservation;
  if (!r || r.status !== "ACTIVE") return showToast("No active reservation to confirm.");
  if (isTripClosed(r.tripId)) return showToast("This schedule has already ended.");

  return db.ref(`reservations/${r.tripId}/${r.id}`).transaction((cur) => {
    if (cur === null) return cur;
    if (cur.status === "ACTIVE" && !isTripClosed(cur.tripId)) {
      return { ...cur, status: "FULFILLED", fulfilledAt: getSyncedNow() };
    }
    return; // released / cancelled / already confirmed
  })
    .then(({ snapshot }) => {
      const v = snapshot.val();
      if (v && v.status === "FULFILLED") showToast("✅ Boarding confirmed!");
      else showToast("Could not confirm. Your reservation is no longer valid.");
    })
    .catch((err) => showToast("Error: " + err.message));
}

async function handleScannedText(text) {
  if (scanHandled) return;
  scanHandled = true;
  if ((text || "").trim() === DOOR_CODE) {
    await closeScanner();
    await fulfillReservation();
  } else {
    showToast("Wrong QR code. Scan the vehicle door QR.");
    setTimeout(() => { scanHandled = false; }, 2000);
  }
}

openCameraBtn.addEventListener("click", async () => {
  if (!activeReservation || activeReservation.status !== "ACTIVE") {
    return showToast("Reserve a seat first.");
  }
  scanHandled = false;
  if (typeof Html5Qrcode === "undefined") {
    showToast("Scanner library is still loading. Try again in a second.");
    return;
  }
  scannerModal.hidden = false;

  try {
    html5Qr = new Html5Qrcode("qr-reader");
    await html5Qr.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 220, height: 220 } },
      handleScannedText,
      () => {}
    );
  } catch (err) {
    showToast("Camera unavailable. Use 'Choose Image / Files' instead.");
  }
});

uploadFileBtn.addEventListener("click", () => qrFileInput.click());

qrFileInput.addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  qrFileInput.value = "";
  if (!file) return;
  await stopScanner();
  try {
    if (typeof Html5Qrcode === "undefined") {
      showToast("Scanner library is still loading.");
      return;
    }
    html5Qr = new Html5Qrcode("qr-reader");
    scanHandled = false;
    const text = await html5Qr.scanFile(file, false);
    await handleScannedText(text);
  } catch (err) {
    showToast("No QR code found in that image.");
  }
});

closeScannerBtn.addEventListener("click", closeScanner);

// ================= Driver: door QR print =================
showDoorQrBtn.addEventListener("click", () => {
  doorQrModal.hidden = false;
  doorQrCode.innerHTML = "";
  if (typeof QRCode !== "undefined") {
    new QRCode(doorQrCode, { text: DOOR_CODE, width: 220, height: 220 });
  }
});
printDoorQrBtn.addEventListener("click", () => window.print());
closeDoorQrBtn.addEventListener("click", () => { doorQrModal.hidden = true; });

// ================= Driver: Website Link QR =================
const showWebQrBtn = $("show-web-qr-btn");
const webQrModal = $("web-qr-modal");
const webQrCode = $("web-qr-code");
const printWebQrBtn = $("print-web-qr-btn");
const closeWebQrBtn = $("close-web-qr-btn");

const WEBSITE_URL = "https://coastermccreservation.netlify.app/";

if (showWebQrBtn) {
  showWebQrBtn.addEventListener("click", () => {
    webQrModal.hidden = false;
    webQrCode.innerHTML = "";
    setTimeout(() => {
      if (typeof QRCode !== "undefined" && webQrCode) {
        new QRCode(webQrCode, { 
          text: WEBSITE_URL, 
          width: 220, 
          height: 220 
        });
      }
    }, 50);
  });
}

if (printWebQrBtn) {
  printWebQrBtn.addEventListener("click", () => window.print());
}

if (closeWebQrBtn) {
  closeWebQrBtn.addEventListener("click", () => { 
    webQrModal.hidden = true; 
  });
}

// ================= Driver status buttons =================
function driverSet(path, value, msg) {
  db.ref(path).set(value)
    .then(() => showToast(msg))
    .catch((err) => showToast("Error: " + err.message));
}
markAvailableBtn.addEventListener("click", () => driverSet("coasterAvailability/available", true, "Updated: Available"));
markUnavailableBtn.addEventListener("click", () => driverSet("coasterAvailability/available", false, "Updated: Unavailable"));

markDepartedBtn.addEventListener("click", () => {
  const tripId = nextOpenTrip(manilaDateKey(getSyncedNow()));
  if (!tripId) return showToast("No open trip to mark.");
  if (!confirm(`Mark this trip as departed?\n\n${tripLabel(tripId)}`)) return;
  db.ref(`tripStatus/${tripId}`).set({
    departed: true,
    at: firebase.database.ServerValue.TIMESTAMP,
    by: myUid
  })
    .then(() => showToast("Trip marked as departed."))
    .catch((err) => showToast("Error: " + err.message));
});

markL300Btn.addEventListener("click", () => {
  db.ref("coasterAvailability").update({ vehicleType: "L300" })
    .then(() => showToast("Switched to L300 (18 Slots)"))
    .catch((err) => showToast("Error: " + err.message));
});

markCoasterBtn.addEventListener("click", () => {
  db.ref("coasterAvailability").update({ vehicleType: "Coaster" })
    .then(() => showToast("Switched to Coaster (30 Slots)"))
    .catch((err) => showToast("Error: " + err.message));
});

// ================= Tick loop =================
setInterval(() => {
  updateClockOnly();
  tickCount++;
  const prevTrip = selectedTrip;
  refreshTripOptions();
  if (selectedTrip !== prevTrip) renderUI(); // trip departed -> show next trip
  const changed = syncMyReservation();
  if (changed || resPhase(activeReservation) !== renderedPhase) renderUI();
  updateCountdown();
  if (tickCount % 10 === 0) { cleanupExpired(); driverWipe(); }
}, 1000);

renderUI();