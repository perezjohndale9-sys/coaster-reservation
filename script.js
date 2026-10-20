// ================= Firebase =================
const firebaseConfig = {
  apiKey: "AIzaSyDtkZE_OCad8dLlbFwAMFaCCC048cy6UQc",
  authDomain: "coaster-reservation.firebaseapp.com",
  databaseURL: "https://coaster-reservation-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "coaster-reservation",
  storageBucket: "coaster-reservation.firebasestorage.app",
  messagingSenderId: "308183827970",
  appId: "1:308183827970:web:60b5e3ba8c4dfc7657491b"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();

const CAPACITY = 30;
const RESERVATION_HOLD_MS = 10 * 60 * 1000;
const FULFILLED_GRACE_MS = 30 * 60 * 1000; // a checked-in seat stays "mine" until 30 min after departure
const TZ = "Asia/Manila";
// Text encoded in the printed door QR. Change it if you like, then reprint the QR.
const DOOR_CODE = "MCC-COASTER-DOOR-V1";

// ================= Time helpers (server-synced, Manila) =================
let serverTimeOffset = 0;
db.ref(".info/serverTimeOffset").on("value", (snap) => {
  serverTimeOffset = snap.val() || 0;
});

function getSyncedNow() {
  return Date.now() + serverTimeOffset;
}

// FIX #5: date key in Asia/Manila instead of UTC (toISOString)
function manilaDateKey(ms) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date(ms)); // "YYYY-MM-DD"
}

// tripId looks like "2026-10-20_dapdap_mabiga_0600"
function tripTimeMs(tripId) {
  const m = /^(\d{4}-\d{2}-\d{2})_.*_(\d{2})(\d{2})$/.exec(tripId || "");
  if (!m) return NaN;
  return new Date(`${m[1]}T${m[2]}:${m[3]}:00+08:00`).getTime(); // Philippines is UTC+8, no DST
}

// FIX #6: a reservation only holds a seat if it is truly live, based on expiresAt
function isSeatHeld(res) {
  if (!res) return false;
  const now = getSyncedNow();
  if (res.status === "ACTIVE") return res.expiresAt > now;
  if (res.status === "FULFILLED") return now < tripTimeMs(res.tripId) + FULFILLED_GRACE_MS;
  return false;
}

// ================= State =================
let reservations = {};
let coasterAvailable = true;
let coasterFull = false;
let isDriverLoggedIn = false;
let myUid = null;
let activeTimerInterval = null;
let activeReservation = null;
let selectedTrip = null;
let lastOptionsKey = "";

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
const markFullBtn = $("mark-full-btn");
const markNotFullBtn = $("mark-not-full-btn");
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

// FIX #7: past trips are disabled, and the selection moves to the next upcoming trip
function refreshTripOptions(force = false) {
  const now = getSyncedNow();
  const dateKey = manilaDateKey(now);

  const build = (select, list, dirLabel) => {
    select.innerHTML = '<option value="" disabled selected>-- Select Time --</option>';
    list.forEach((item) => {
      const value = `${dateKey}_${item.val}`;
      const opt = document.createElement("option");
      opt.value = value;
      const departed = tripTimeMs(value) <= now;
      opt.disabled = departed;
      opt.textContent = `${item.label} (${dirLabel})${departed ? " – departed" : ""}`;
      select.appendChild(opt);
    });
  };

  const all = [...dapdapToMabigaTimes, ...mabigaToDapdapTimes]
    .map((t) => `${dateKey}_${t.val}`)
    .sort((a, b) => tripTimeMs(a) - tripTimeMs(b));
  const departedCount = all.filter((t) => tripTimeMs(t) <= now).length;
  const key = `${dateKey}:${departedCount}`;

  if (!force && key === lastOptionsKey && selectDapdapMabiga.options.length > 1) return;
  lastOptionsKey = key;

  // keep the current choice only if it is today's and hasn't left yet
  if (!selectedTrip || !selectedTrip.startsWith(dateKey) || tripTimeMs(selectedTrip) <= now) {
    selectedTrip = all.find((t) => tripTimeMs(t) > now) || null;
  }

  build(selectDapdapMabiga, dapdapToMabigaTimes, "Dapdap → Mabiga");
  build(selectMabigaDapdap, mabigaToDapdapTimes, "Mabiga → Dapdap");

  if (selectedTrip) {
    if (selectedTrip.includes("_dapdap_mabiga_")) selectDapdapMabiga.value = selectedTrip;
    else selectMabigaDapdap.value = selectedTrip;
  }
}

function renderUI() {
  updateClockOnly();
  refreshTripOptions();

  if (!coasterAvailable) {
    availabilityBanner.hidden = false;
    availabilityMessage.textContent = "Bus marked UNAVAILABLE by driver.";
  } else if (coasterFull) {
    availabilityBanner.hidden = false;
    availabilityMessage.textContent = "Bus marked FULL by driver.";
  } else {
    availabilityBanner.hidden = true;
  }

  renderSeats();
  renderReservationUI();
  driverCurrentStatus.textContent =
    `Status: ${coasterAvailable ? "AVAILABLE" : "UNAVAILABLE"} | ${coasterFull ? "FULL" : "NOT FULL"}`;
}

selectDapdapMabiga.addEventListener("change", (e) => {
  selectedTrip = e.target.value;
  selectMabigaDapdap.selectedIndex = 0;
  renderUI();
});

selectMabigaDapdap.addEventListener("change", (e) => {
  selectedTrip = e.target.value;
  selectDapdapMabiga.selectedIndex = 0;
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

  if (!selectedTrip) {
    slotCount.textContent = "No more trips today";
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
      checkinText.textContent = "⚠️ Scan the QR code on the coaster door upon boarding to confirm your seat!";
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

// ================= Auth (FIX #3) =================
// Students sign in anonymously (so Firebase rules can tell users apart).
// The driver signs in with a real email/password account created in Firebase Console.
auth.onAuthStateChanged((user) => {
  if (!user) {
    auth.signInAnonymously().catch((err) => {
      syncIndicator.textContent = "Auth error";
      showToast("Auth error: " + err.message);
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
    .catch(() => {
      loginError.textContent = "Invalid login credentials";
      loginError.hidden = false;
    });
});

loginCancel.addEventListener("click", () => { loginModal.hidden = true; });
driverLogout.addEventListener("click", () => {
  auth.signOut(); // onAuthStateChanged will sign back in anonymously as a student
});

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
  coasterAvailable = data.available !== false;
  coasterFull = data.full === true;
  renderUI();
});

// ================= Reserve / Cancel =================
reserveBtn.addEventListener("click", () => {
  if (!myUid) return showToast("Connecting… try again in a moment.");
  if (!coasterAvailable || coasterFull) return showToast("Coaster unavailable.");
  if (!selectedTrip) return showToast("No more trips today.");
  if (tripTimeMs(selectedTrip) <= getSyncedNow()) {
    refreshTripOptions(true);
    renderUI();
    return showToast("That trip has already left.");
  }
  if (activeReservation) return showToast("You already have an active reservation.");

  const tripData = reservations[selectedTrip] || {};
  const held = Object.values(tripData).filter(isSeatHeld);
  if (held.length >= CAPACITY) return showToast("Trip is full.");

  const taken = held.map((r) => r.seatNumber);
  let nextSeat = 1;
  while (taken.includes(nextSeat)) nextSeat++;

  const resId = "res_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
  const newRes = {
    id: resId,
    uid: myUid,
    seatNumber: nextSeat,
    status: "ACTIVE",
    expiresAt: getSyncedNow() + RESERVATION_HOLD_MS,
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

// ================= QR scanning (FIX #1) =================
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
    showToast("Wrong QR code. Scan the coaster door QR.");
    setTimeout(() => { scanHandled = false; }, 2000);
  }
}

openCameraBtn.addEventListener("click", async () => {
  if (!activeReservation || activeReservation.status !== "ACTIVE") {
    return showToast("Reserve a seat first.");
  }
  scanHandled = false;
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
  new QRCode(doorQrCode, { text: DOOR_CODE, width: 220, height: 220 });
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
markFullBtn.addEventListener("click", () => driverSet("coasterAvailability/full", true, "Updated: Marked Full"));
markNotFullBtn.addEventListener("click", () => driverSet("coasterAvailability/full", false, "Updated: Marked Not Full"));

// ================= Tick loop =================
let tick = 0;
setInterval(() => {
  updateClockOnly();
  tick++;
  if (tick % 15 === 0) {
    // re-check expired holds, departed trips and the date rollover
    activeReservation = findMyReservation();
    renderUI();
  }
}, 1000);

refreshTripOptions(true);
