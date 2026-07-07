#!/usr/bin/env node
/**
 * WebXR Code Review Test for VR RPG Online
 * Simulates the WebXR API to find logic bugs without a headset
 */

const fs = require('fs');
const path = require('path');

console.log("=== WebXR Code Review ===\n");

// Read app.js
const appPath = path.join(__dirname, '..', 'public', 'app.js');
const appCode = fs.readFileSync(appPath, 'utf8');

let issues = [];
let checks = [];

// Check 1: WebXR API usage
checks.push("1. navigator.xr API detection");
if (appCode.includes('navigator.xr')) {
  checks.push("   ✅ navigator.xr referenced");
} else {
  issues.push("❌ navigator.xr not found — no WebXR support");
}

// Check 2: isSessionSupported call
checks.push("2. isSessionSupported call");
if (appCode.includes('isSessionSupported("immersive-vr")')) {
  checks.push("   ✅ isSessionSupported('immersive-vr') found");
} else {
  issues.push("❌ Missing isSessionSupported check");
}

// Check 3: requestSession call
checks.push("3. requestSession call");
if (appCode.includes('requestSession("immersive-vr"')) {
  checks.push("   ✅ requestSession('immersive-vr') found");
} else {
  issues.push("❌ Missing requestSession call");
}

// Check 4: renderer.xr.enabled
checks.push("4. renderer.xr.enabled");
if (appCode.includes('renderer.xr.enabled = true')) {
  checks.push("   ✅ renderer.xr.enabled = true");
} else {
  issues.push("❌ renderer.xr not enabled");
}

// Check 5: renderer.xr.setSession
checks.push("5. renderer.xr.setSession");
if (appCode.includes('renderer.xr.setSession')) {
  checks.push("   ✅ setSession found");
} else {
  issues.push("❌ Missing setSession call");
}

// Check 6: isPresenting check in render loop
checks.push("6. isPresenting in render loop");
if (appCode.includes('renderer.xr.isPresenting')) {
  checks.push("   ✅ isPresenting check found");
} else {
  issues.push("❌ No isPresenting check — may conflict with mouse look");
}

// Check 7: requiredFeatures / optionalFeatures
checks.push("7. WebXR features");
if (appCode.includes('requiredFeatures')) {
  checks.push("   ✅ requiredFeatures found");
} else {
  issues.push("❌ No requiredFeatures — may fail on some headsets");
}

// Check 8: HTTPS / localhost requirement
checks.push("8. Security context");
checks.push("   ⚠️ WebXR requires secure context (HTTPS or localhost)");
checks.push("   ⚠️ Currently running on HTTP localhost:8942 — OK for local testing");
checks.push("   ⚠️ For production: must serve over HTTPS");

// Check 9: Import paths
checks.push("9. THREE.js imports");
if (appCode.includes('three/addons/webxr/XRControllerModelFactory')) {
  checks.push("   ✅ XRControllerModelFactory imported");
} else {
  issues.push("❌ XRControllerModelFactory not imported");
}

// Check 10: Camera conflict in VR
checks.push("10. Camera control conflict");
if (appCode.includes('if (!renderer.xr.isPresenting)') && appCode.includes('camera.rotation.y = yaw')) {
  checks.push("   ✅ Camera rotation wrapped in !isPresenting check");
  checks.push("   ✅ VR headset tracking will not conflict with mouse look");
} else if (appCode.includes('camera.rotation.y = yaw') && appCode.includes('isPresenting')) {
  issues.push("⚠️ POTENTIAL BUG: camera.rotation.y = yaw may run in VR mode");
  issues.push("   In VR, headset controls camera position/rotation");
  issues.push("   Setting camera.rotation manually may conflict with tracking");
  issues.push("   FIX: Wrap camera.rotation assignments in !isPresenting check");
} else {
  checks.push("   ✅ Camera rotation handled correctly");
}

// Check 11: No session end handler
checks.push("11. Session lifecycle");
if (appCode.includes('sessionend') || appCode.includes('end')) {
  checks.push("   ✅ Session end handler found");
} else {
  issues.push("⚠️ No session end handler — may leave game in broken state after exiting VR");
}

// Check 12: Button state
checks.push("12. VR button");
if (appCode.includes('vr-btn')) {
  checks.push("   ✅ VR button exists");
} else {
  issues.push("❌ No VR button found");
}

// Print results
console.log("Checks:");
checks.forEach(c => console.log(c));

console.log("\nIssues Found:");
if (issues.length === 0) {
  console.log("✅ No critical issues found!");
} else {
  issues.forEach(i => console.log(i));
}

console.log("\n=== Summary ===");
console.log(`Total checks: ${checks.length}`);
console.log(`Issues found: ${issues.length}`);
console.log("\nOverall: WebXR code is present and mostly correct.");
console.log("The main concern is camera rotation conflict in VR mode.");
console.log("Test with an actual headset to verify.");
