// ================= Firebase =================
const firebaseConfig = {
  apiKey: "AIzaSyDen-rGO_rvp9FA7a6nCLjUaU5bOKwsrps",
  authDomain: "coaster-reservation.firebaseapp.com",
  databaseURL: "https://coaster-reservation-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "coaster-reservation",
  storageBucket: "coaster-reservation.firebasestorage.app",
  messagingSenderId: "623130470619",
  appId: "1:623130470619:web:27b93edac8a337227144fe"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();

const CAPACITY = 30;
const RESERVATION_HOLD_MS = 10 * 60 * 1000;
const FULFILLED_GRACE_MS = 30 * 60 * 1000; // a checked-in seat stays "mine" until 30 min after departure
const TZ = "Asia/Manila";
const DOOR_CODE = "MCC-COASTER-DOOR-V1";

// ================= Time helpers (server-synced, Manila) =================
let serverTimeOffset = 0;
db.ref(".info/serverTimeOffset").on("value", (snap) => {
  serverTimeOffset = snap.val() || 0;
});

function getSyncedNow() {
  return Date.now() + serverTimeOffset;
}

function manilaDateKey(ms) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date(ms));
}

function tripTimeMs(tripId) {
  const m = /^(\d{4}-\d{2}-\d{2})_.*_(\d{2})(\d{2})$/.exec(tripId || "");
  if (!m) return NaN;
  return new Date(`${m[1]}T${m[2]}:${m[3]}:00+08:00`).getTime();
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

function tripLabel(tripId)
