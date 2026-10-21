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

let CAPACITY = 25; // Default Coaster capacity
const RESERVATION_HOLD_MS = 10 * 60 * 1000;
const FULFILLED_GRACE_MS = 30 * 60 * 1000; 
const TZ = "Asia/Manila";
const DOOR_CODE = "MCC-VEHICLE-DOOR-V1";

// ================= Time helpers (server-synced, Manila) =================
let serverTimeOffset = 0;
db.ref(".info/serverTimeOffset").on("value", (snap) => {
  serverTimeOffset = snap.val() || 0;
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
  // Parses YYYY-MM-DD_..._HHMM safely in Manila Time (+08:00)
  const m = /^(\d{4})-(\d{2})-(\d{2})_.*_(\d{2})(\d{2})$/.exec(tripId || "");
  if (!m) return NaN;
  const [_, year, month, day, hours, minutes] = m;
  // Manila is UTC+8 -> Subtract 8 hours to get UTC timestamp
  return Date.UTC(
    parseInt(year, 10),
    parseInt(month, 10) - 1,
    parseInt(day, 10),
    parseInt(hours, 10) - 8,
    parseInt(minutes, 10)
  );
}

function isSeatHeld(res) {
  if (!res) return false;
  const now = getSyncedNow();
  if (res.status === "ACTIVE") return res.expiresAt > now;
  if (res.status === "FULFILLED") return now < tripTimeMs(res.tripId) + FULFILLED_GRACE_MS;
  return false;
}

// ================= State =================
let reservations = {};
let vehicleAvailable = true;
let vehicleType = "Coaster"; 
let isDriverLoggedIn = false;
let myUid = null;
let activeTimerInterval = null;
let activeReservation = null;
let selectedTrip = null;

// ================= DOM =================
const $ = (id) => document.getElementById(id);
const slotCount = $("slot-count");
const phClock = $("ph-clock");
const reserveBtn = $("reserve-btn");
const cancelBtn = $("cancel-btn");
const reservationPanel = $("reservation-panel");
const reservationTrip = $("reservation-trip");
const reservationTimer = $("reservation-timer");
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
const selectDapdapMabiga = $("select-dapdap-mabiga");
const selectMabigaDapdap = $("select-mabiga-dapdap");
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

// ================= Schedules =================
const dapdapToMabigaTimes = [
  { label: "6:00 AM", val: "dapdap_mabiga_0600" },
  { label: "6:40 AM", val: "dapdap_mabiga_0640" },
  { label: "7:20 AM", val: "dapdap_mabiga_0720" },
  { label: "8:00 AM", val: "dapdap_mabiga_0800" },
  { label: "10:00 AM", val: "dapdap_mabiga_1000" },
  { label: "10:40 AM", val: "dapdap_mabiga_1040" },
  { label: "11:20 AM", val: "dapdap_mabiga_1120" },
  { label: "1:00 PM", val: "dapdap_mabiga_1300" },
  { label: "2:00 PM", val: "dapdap_mabiga_1400" },
  { label: "3:00 PM", val: "dapdap_mabiga_1500" },
  { label: "4:00 PM", val: "dapdap_mabiga_1600" },
  { label: "5:00 PM", val: "dapdap_mabiga_1700" },
  { label: "6:00 PM", val: "dapdap_mabiga_1800" },
  { label: "7:00 PM", val: "dapdap_mabiga_1900" },
  { label: "8:00 PM", val: "dapdap_mabiga_2000" },
  { label: "9:10 PM", val: "dapdap_mabiga_2110" }
];

const mabigaToDapdapTimes = [
  { label: "6:20 AM", val: "mabiga_dapdap_0620" },
  { label: "7:00 AM", val: "mabiga_dapdap_0700" },
  { label: "7:40 AM", val: "mabiga_dapdap_0740" },
  { label: "8:20 AM", val: "mabiga_dapdap_0820" },
  { label: "10:20 AM", val: "mabiga_dapdap_1020" },
  { label: "11:00 AM", val: "mabiga_dapdap_1100" },
  { label: "11:40 AM", val: "mabiga_dapdap_1140" },
  { label: "1:20 PM", val: "mabiga_dapdap_1320" },
  { label: "2:20 PM", val: "mabiga_dapdap_1420" },
  { label: "3:20 PM", val: "mabiga_dapdap_1520" },
  { label: "4:20 PM", val: "mabiga_dapdap_1620" },
  { label: "5:20 PM", val: "mabiga_dapdap_1720" },
  { label: "6:20 PM", val: "mabiga_dapdap_1820" },
  { label: "7:20 PM", val: "mabiga_dapdap_1920" },
  { label: "8:20 PM", val: "mabiga_dapdap_2020" }
];

function tripLabel(tripId) {
  const all = [
    ...dapdapToMabigaTimes.map((t) => ({ ...t, dir: "Dapdap → Mabiga" })),
    ...mabigaToDapdapTimes.map((t) => ({ ...t, dir: "Mabiga → Dapdap" }))
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
  phClock.textContent = `🇵🇭 ${new Date(getSyncedNow()).toLocaleTimeString("en-US", { timeZone: TZ })}`;
}

function refreshTripOptions() {
  const now = getSyncedNow();
  const dateKey = manilaDateKey(now);

  const build = (select, list, dirLabel) => {
    const prevValue = select.value;
    select.innerHTML = '<option value="" disabled>-- Select Time --</option>';
    
    list.forEach((item) => {
      const value = `${dateKey}_${item.val}`;
      const opt = document.createElement("option");
      opt.value = value;
      
      const tMs = tripTimeMs(value);
      const departed = !isNaN(tMs) && tMs <= now;
      
      opt.disabled = departed;
      opt.textContent = `${item.label} (${dirLabel})${departed ? " – departed" : ""}`;
      select.appendChild(opt);
    });

    if (prevValue && select.querySelector(`option[value="${prevValue}"]`)) {
      select.value = prevValue;
    } else {
      select.value = "";
    }
  };

  const all = [...dapdapToMabigaTimes, ...mabigaToDapdapTimes]
    .map((t) => `${dateKey}_${t.val}`)
    .sort((a, b) => tripTimeMs(a) - tripTimeMs(b));

  build(selectDapdapMabiga, dapdapToMabigaTimes, "Dapdap → Mabiga");
  build(selectMabigaDapdap, mabigaToDapdapTimes, "Mabiga → Dapdap");

  // Select next available upcoming trip if current selection is invalid or departed
  if (!selectedTrip || !selectedTrip.startsWith(dateKey) || tripTimeMs(selectedTrip) <= now) {
    selectedTrip = all.find((t) => tripTimeMs(t) > now) || null;
  }

  if (selectedTrip) {
    if (selectedTrip.includes("_dapdap_mabiga_")) {
      selectDapdapMabiga.value = selectedTrip;
      selectMabigaDapdap.value = "";
    } else {
      selectMabigaDapdap.value = selectedTrip;
      selectDapdapMabiga.value = "";
    }
  }
}

function renderUI() {
  updateClockOnly();
  refreshTripOptions();

  if (!vehicleAvailable) {
    availabilityBanner.hidden = false;
    availabilityMessage.textContent = "Vehicle marked UNAVAILABLE by driver.";
  } else {
    availabilityBanner.hidden = true;
  }

  renderSeats();
  renderReservationUI();
  driverCurrentStatus.textContent =
    `Status: ${vehicleAvailable ? "AVAILABLE" : "UNAVAILABLE"} | Vehicle: ${vehicleType} (${CAPACITY} seats)`;
}

selectDapdapMabiga.addEventListener("change", (e) => {
  selectedTrip = e.target.value;
  selectMabigaDapdap.value = "";
  renderUI();
});

selectMabigaDapdap.addEventListener("change", (e) => {
  selectedTrip = e.target.value;
  selectDapdapMabiga.value = "";
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

  if (!selectedTrip || isNaN(tripTimeMs(selectedTrip)) || tripTimeMs(selectedTrip) <= getSyncedNow()) {
    slotCount.textContent = "No more trips available";
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
      seatEl.classList.add("mine");
      seatEl.innerHTML = seatHTML(i, "You");
    } else if (r) {
      seatEl.classList.add("reserved");
      seatEl.innerHTML = seatHTML(i, "Taken");
    } else {
      seatEl.classList.add("free");
      seatEl.innerHTML = seatHTML(i, "Free");
    }
    seatGrid.appendChild(seatEl);
  }

  const reservedCount = held.length;
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
  const timerWrap = reservationTimer.closest(".timer-wrap");

  if (activeReservation) {
    if (activeReservation.seatNumber > CAPACITY) {
      showToast("Your reserved seat was affected by vehicle size change. Please re-book.");
      db.ref(`reservations/${activeReservation.tripId}/${activeReservation.id}/status`).set("CANCELLED");
      activeReservation = null;
      renderUI();
      return;
    }

    reservationPanel.hidden = false;
    reserveBtn.hidden = true;
    cancelBtn.hidden = false;
    reservationTrip.textContent = `Seat ${activeReservation.seatNumber} · ${tripLabel(activeReservation.tripId)}`;

    if (activeReservation.status === "FULFILLED") {
      checkinBanner.classList.add("fulfilled");
      checkinText.textContent = "✅ Boarding confirmed. Enjoy your ride!";
      cameraSection.hidden = true;
      timerWrap.hidden = true;
      stopTimer();
    } else {
      checkinBanner.classList.remove("fulfilled");
      checkinText.textContent = "⚠️ Scan the QR code on the vehicle door upon boarding to confirm your seat!";
      cameraSection.hidden = false;
      timerWrap.hidden = false;
      startTimer();
    }
  } else {
    reservationPanel.hidden = true;
    reserveBtn.hidden = false;
    cancelBtn.hidden = true;
    stopTimer();
  }
}

function startTimer() {
  if (activeTimerInterval) return;

  function updateCountdown() {
    if (!activeReservation || activeReservation.status !== "ACTIVE") {
      stopTimer();
      return;
    }

    const remaining = activeReservation.expiresAt - getSyncedNow();

    if (remaining <= 0) {
      stopTimer();
      reservationTimer.textContent = "00:00";
      const r = activeReservation;
      db.ref(`reservations/${r.tripId}/${r.id}/status`).set("EXPIRED").catch(() => {});
      activeReservation = null;
      showToast("Reservation Expired!");
      renderUI();
      return;
    }

    const totalSecs = Math.floor(remaining / 1000);
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    reservationTimer.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  updateCountdown();
  activeTimerInterval = setInterval(updateCountdown, 1000);
}

function stopTimer() {
  if (activeTimerInterval) {
    clearInterval(activeTimerInterval);
    activeTimerInterval = null;
  }
}

// ================= Auth =================
auth.onAuthStateChanged((user) => {
  if (!user) {
    auth.signInAnonymously().catch((err) => {
      syncIndicator.textContent = "Auth error";
      showToast("Auth error (" + err.code + ")");
    });
    return;
  }
  myUid = user.uid;
  isDriverLoggedIn = !user.isAnonymous;
  driverPanel.hidden = !isDriverLoggedIn;
  activeReservation = findMyReservation();
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
  driverPanel.hidden = true;
});
roleDriverBtn.addEventListener("click", () => {
  roleSelectScreen.hidden = true;
  if (isDriverLoggedIn) driverPanel.hidden = false;
  else loginModal.hidden = false;
});

// ================= Database listeners =================
db.ref(".info/connected").on("value", (snap) => {
  syncIndicator.textContent = snap.val() ? "Live Sync Active" : "Offline";
});

db.ref("reservations").on("value", (snap) => {
  reservations = snap.val() || {};
  activeReservation = findMyReservation();
  renderUI();
});

db.ref("coasterAvailability").on("value", (snap) => {
  const data = snap.val() || {};
  vehicleAvailable = data.available !== false;
  if (data.vehicleType === "L300") {
    vehicleType = "L300";
    CAPACITY = 15;
  } else {
    vehicleType = "Coaster";
    CAPACITY = 25;
  }
  renderUI();
});

// ================= Reserve / Cancel =================
reserveBtn.addEventListener("click", () => {
  if (!myUid) return showToast("Connecting… try again in a moment.");
  if (!vehicleAvailable) return showToast("Vehicle currently unavailable.");
  if (!selectedTrip) return showToast("No upcoming trips available.");

  const scheduledMs = tripTimeMs(selectedTrip);
  const nowMs = getSyncedNow();

  // Strict departed check
  if (isNaN(scheduledMs) || scheduledMs <= nowMs) {
    refreshTripOptions();
    renderUI();
    return showToast("Cannot reserve: This trip has already departed.");
  }

  if (activeReservation) return showToast("You already have an active reservation.");

  const tripData = reservations[selectedTrip] || {};
  const held = Object.values(tripData).filter(isSeatHeld);
  if (held.length >= CAPACITY) return showToast("Vehicle is full.");

  const taken = held.map((r) => r.seatNumber);
  let nextSeat = 1;
  while (taken.includes(nextSeat)) nextSeat++;

  const resId = "res_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
  const newRes = {
    id: resId,
    uid: myUid,
    seatNumber: nextSeat,
    status: "ACTIVE",
    expiresAt: nowMs + RESERVATION_HOLD_MS,
    tripId: selectedTrip
  };

  db.ref(`reservations/${selectedTrip}/${resId}`).set(newRes)
    .then(() => showToast(`Seat ${nextSeat} Reserved!`))
    .catch((err) => showToast("Permission Error: " + err.message));
});

cancelBtn.addEventListener("click", () => {
  if (!activeReservation) return;
  const r = activeReservation;
  db.ref(`reservations/${r.tripId}/${r.id}/status`).set("CANCELLED")
    .then(() => {
      stopTimer();
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
  if (r.expiresAt <= getSyncedNow()) return showToast("Your reservation has expired.");

  return db.ref(`reservations/${r.tripId}/${r.id}`).update({
    status: "FULFILLED",
    fulfilledAt: firebase.database.ServerValue.TIMESTAMP
  })
    .then(() => showToast("✅ Boarding confirmed!"))
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
  scannerModal.hidden = false;
  
  if (typeof Html5Qrcode === "undefined") {
    showToast("Scanner library is still loading. Try again in a second.");
    return;
  }

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

// ================= Driver status buttons =================
function driverSet(path, value, msg) {
  db.ref(path).set(value)
    .then(() => showToast(msg))
    .catch((err) => showToast("Error: " + err.message));
}
markAvailableBtn.addEventListener("click", () => driverSet("coasterAvailability/available", true, "Updated: Available"));
markUnavailableBtn.addEventListener("click", () => driverSet("coasterAvailability/available", false, "Updated: Unavailable"));

markL300Btn.addEventListener("click", () => {
  db.ref("coasterAvailability").update({ vehicleType: "L300" })
    .then(() => showToast("Switched to L300 (15 Slots)"))
    .catch((err) => showToast("Error: " + err.message));
});

markCoasterBtn.addEventListener("click", () => {
  db.ref("coasterAvailability").update({ vehicleType: "Coaster" })
    .then(() => showToast("Switched to Coaster (25 Slots)"))
    .catch((err) => showToast("Error: " + err.message));
});

// ================= Tick loop =================
setInterval(() => {
  updateClockOnly();
  renderUI();
}, 1000);

renderUI();