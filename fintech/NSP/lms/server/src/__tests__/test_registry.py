#!/usr/bin/env python3
"""Integration tests for Talent Ledger Registry (Prompts 100-102, 300-301)"""
import requests
import json
import sys

BASE = "http://localhost:5000/api/v1"
passed = 0
failed = 0
errors = []

def test(name, condition):
    global passed, failed, errors
    if condition:
        passed += 1
        print(f"  PASS: {name}")
    else:
        failed += 1
        errors.append(name)
        print(f"  FAIL: {name}")

def safe_json(resp, default=None):
    """Safely parse JSON response, return default on failure."""
    try:
        return resp.json()
    except Exception:
        return default if default is not None else {}

# ── Setup: Login as admin ──
print("=" * 60)
print("TALENT LEDGER REGISTRY TESTS")
print("=" * 60)

# Get CSRF token
s = requests.Session()
csrf_res = s.get(f"{BASE}/csrf-token")
csrf = safe_json(csrf_res).get("csrfToken", "")
headers = {"X-CSRF-Token": csrf, "Content-Type": "application/json"}

# Login as admin
login_res = s.post(f"{BASE}/auth/login", json={
    "email": "admin@ppmc.org.pk",
    "password": "Admin@2026"
}, headers=headers)
login_data = safe_json(login_res)
token = login_data.get("accessToken", "") or login_data.get("token", "")
auth_headers = {**headers, "Authorization": f"Bearer {token}"}

test("Admin login successful", login_res.status_code == 200 and bool(token))
if not token:
    print(f"  DEBUG: Login status={login_res.status_code}, keys={list(login_data.keys())}")

# ══════════════════════════════════════════════
# 1. ISSUER MANAGEMENT
# ══════════════════════════════════════════════
print("\n--- Issuer Management ---")

# Create issuer
issuer_res = s.post(f"{BASE}/registry/issuers", json={
    "issuerName": "Test University Peshawar",
    "issuerType": "UNIVERSITY",
    "issuerCategory": "PROVINCIAL_KP",
    "officialWebsite": "https://testuni.edu.pk",
    "contactEmail": "admin@testuni.edu.pk",
    "verificationMethodSupported": ["DASHBOARD_CONFIRM"]
}, headers=auth_headers)
test("Create issuer returns 201", issuer_res.status_code == 201)
if issuer_res.status_code != 201:
    print(f"  DEBUG: issuer status={issuer_res.status_code}, body={issuer_res.text[:200]}")
issuer_data = safe_json(issuer_res).get("issuer", {})
issuer_id = issuer_data.get("issuerId", "")
test("Issuer has UUID", len(issuer_id) > 10)
test("Issuer has DID", "did:talentledger:issuer:" in issuer_data.get("didIdentifier", ""))

# List issuers
list_res = s.get(f"{BASE}/registry/issuers", headers=auth_headers)
test("List issuers returns 200", list_res.status_code == 200)
issuers_data = safe_json(list_res, [])
test("Issuers is array", isinstance(issuers_data, list))
test("At least 1 issuer", len(issuers_data) >= 1 if isinstance(issuers_data, list) else False)

# Filter by type
filter_res = s.get(f"{BASE}/registry/issuers?type=UNIVERSITY", headers=auth_headers)
test("Filter by type works", filter_res.status_code == 200)

# Get single issuer
if issuer_id:
    get_res = s.get(f"{BASE}/registry/issuers/{issuer_id}", headers=auth_headers)
    test("Get issuer returns 200", get_res.status_code == 200)
    test("Issuer name matches", safe_json(get_res).get("issuerName") == "Test University Peshawar")
else:
    test("Get issuer returns 200", False)
    test("Issuer name matches", False)

# Update issuer
if issuer_id:
    update_res = s.put(f"{BASE}/registry/issuers/{issuer_id}", json={
        "contactFocalPerson": "Dr. Test Khan"
    }, headers=auth_headers)
    test("Update issuer returns 200", update_res.status_code == 200)
else:
    test("Update issuer returns 200", False)

# ══════════════════════════════════════════════
# 2. CREDENTIAL MANAGEMENT
# ══════════════════════════════════════════════
print("\n--- Credential Management ---")

# Create ACADEMIC credential
cred_res = s.post(f"{BASE}/registry/credentials", json={
    "holderCnic": "17301-1234567-1",
    "credentialType": "ACADEMIC",
    "credentialSubtype": "HEC_DEGREE",
    "title": "BSc Computer Science - University of Peshawar",
    "issuerName": "Test University Peshawar",
    "issuerId": issuer_id,
    "issuanceDate": "2024-06-15",
    "metadata": {
        "academic": {
            "degreeLevel": "Bachelor",
            "degreeTitle": "BSc Computer Science",
            "institutionName": "University of Peshawar",
            "sessionYear": "2020-2024",
            "cgpa": 3.45
        }
    }
}, headers=auth_headers)
test("Create ACADEMIC credential returns 201", cred_res.status_code == 201)
if cred_res.status_code != 201:
    print(f"  DEBUG: cred status={cred_res.status_code}, body={cred_res.text[:300]}")
cred_data = safe_json(cred_res).get("credential", {})
cred_id = cred_data.get("credentialId", "")
test("Credential has UUID", len(cred_id) > 10)
test("Credential type is ACADEMIC", cred_data.get("credentialType") == "ACADEMIC")
test("Default status is PENDING_VERIFICATION", cred_data.get("status") == "PENDING_VERIFICATION")

# Create TVET credential
tvet_res = s.post(f"{BASE}/registry/credentials", json={
    "holderCnic": "17301-1234567-1",
    "credentialType": "TVET",
    "credentialSubtype": "BTE_DIPLOMA",
    "title": "DAE Electrical Technology - KP BTE",
    "issuerName": "KP Board of Technical Education",
    "issuanceDate": "2023-08-20",
    "metadata": {
        "tvet": {
            "nvqLevel": 3,
            "tradeName": "Electrical Technology",
            "tradeCode": "ET-301",
            "boardName": "KP BTE",
            "boardProvince": "KP",
            "marksObtained": 780,
            "totalMarks": 1000
        }
    }
}, headers=auth_headers)
test("Create TVET credential returns 201", tvet_res.status_code == 201)

# Create SELF_DECLARED credential
self_res = s.post(f"{BASE}/registry/credentials", json={
    "holderCnic": "17301-1234567-1",
    "credentialType": "SELF_DECLARED",
    "title": "Self-Declared: Welding (5 years)",
    "metadata": {
        "selfDeclared": {
            "skillName": "Arc Welding",
            "skillCategory": "Construction",
            "proficiencyLevel": "ADVANCED",
            "yearsExperience": 5,
            "willingToAssess": True
        }
    }
}, headers=auth_headers)
test("Create SELF_DECLARED credential returns 201", self_res.status_code == 201)

# Create PROFESSIONAL_LICENSE credential
lic_res = s.post(f"{BASE}/registry/credentials", json={
    "holderCnic": "17301-1234567-1",
    "credentialType": "PROFESSIONAL_LICENSE",
    "title": "PEC Registered Engineer",
    "issuerName": "Pakistan Engineering Council",
    "expiryDate": "2028-12-31",
    "metadata": {
        "professionalLicense": {
            "licenseNumber": "PEC-ELEC-2024-12345",
            "licensingBody": "PEC",
            "licenseCategory": "Professional Engineer",
            "specialization": "Electrical",
            "disciplinaryStatus": "CLEAN"
        }
    }
}, headers=auth_headers)
test("Create PROFESSIONAL_LICENSE returns 201", lic_res.status_code == 201)

# Get single credential
if cred_id:
    get_cred = s.get(f"{BASE}/registry/credentials/{cred_id}", headers=auth_headers)
    test("Get credential returns 200", get_cred.status_code == 200)
    test("Credential title matches", safe_json(get_cred).get("title") == "BSc Computer Science - University of Peshawar")
else:
    test("Get credential returns 200", False)
    test("Credential title matches", False)

# Get holder credentials
holder_creds = s.get(f"{BASE}/registry/holders/17301-1234567-1/credentials", headers=auth_headers)
test("Get holder credentials returns 200", holder_creds.status_code == 200)
holder_creds_data = safe_json(holder_creds)
test("Holder has 4 credentials", holder_creds_data.get("total", 0) == 4)

# Filter by type
filtered = s.get(f"{BASE}/registry/holders/17301-1234567-1/credentials?type=TVET", headers=auth_headers)
filtered_data = safe_json(filtered)
test("Filter credentials by type works", len(filtered_data.get("credentials", [])) == 1)

# ══════════════════════════════════════════════
# 3. PUBLIC VERIFICATION (no auth required)
# ══════════════════════════════════════════════
print("\n--- Public Verification ---")

if cred_id:
    # Verify existing credential (no auth)
    verify_res = s.get(f"{BASE}/registry/credentials/{cred_id}/verify")
    test("Public verify returns 200", verify_res.status_code == 200)
    verify_data = safe_json(verify_res)
    test("Has verificationId", "verificationId" in verify_data)
    test("Has timestamp", "timestamp" in verify_data)
    test("Has overallResult", verify_data.get("overallResult") in ["VALID", "INVALID", "EXPIRED", "REVOKED"])
    test("Has checks object", "checks" in verify_data)
    test("Existence check passed", verify_data.get("checks", {}).get("existence", {}).get("passed") == True)
else:
    for name in ["Public verify returns 200", "Has verificationId", "Has timestamp", "Has overallResult", "Has checks object", "Existence check passed"]:
        test(name, False)

# Verify non-existent credential
fake_verify = s.get(f"{BASE}/registry/credentials/00000000-0000-0000-0000-000000000000/verify")
test("Fake credential returns NOT_FOUND", safe_json(fake_verify).get("overallResult") == "NOT_FOUND")

# Verification history
if cred_id:
    history = s.get(f"{BASE}/registry/credentials/{cred_id}/history", headers=auth_headers)
    test("Verification history returns 200", history.status_code == 200)
    history_data = safe_json(history, [])
    test("Has at least 1 verification log", len(history_data) >= 1 if isinstance(history_data, list) else False)
else:
    test("Verification history returns 200", False)
    test("Has at least 1 verification log", False)

# ══════════════════════════════════════════════
# 4. VERIFICATION REQUESTS
# ══════════════════════════════════════════════
print("\n--- Verification Requests ---")

# Submit verification request
vr_res = s.post(f"{BASE}/registry/verification-requests", json={
    "holderCnic": "17301-7654321-9",
    "credentialType": "TVET",
    "title": "DAE Mechanical - Punjab BTE",
    "issuerName": "Punjab BTE",
    "claimDetails": {"rollNumber": "2019-M-4567", "session": "2019"},
    "metadata": {"tvet": {"tradeName": "Mechanical", "boardProvince": "Punjab"}}
}, headers=auth_headers)
test("Submit verification request returns 201", vr_res.status_code == 201)
if vr_res.status_code != 201:
    print(f"  DEBUG: vr status={vr_res.status_code}, body={vr_res.text[:200]}")
vr_data = safe_json(vr_res)
vr_id = vr_data.get("requestId", "")
test("Has request ID", len(vr_id) > 10)

# Check request status
if vr_id:
    vr_status = s.get(f"{BASE}/registry/verification-requests/{vr_id}", headers=auth_headers)
    test("Check status returns 200", vr_status.status_code == 200)
    test("Status is PENDING_VERIFICATION", safe_json(vr_status).get("status") == "PENDING_VERIFICATION")
else:
    test("Check status returns 200", False)
    test("Status is PENDING_VERIFICATION", False)

# List verification queue
queue = s.get(f"{BASE}/registry/verification-requests", headers=auth_headers)
test("Verification queue returns 200", queue.status_code == 200)
test("Queue has requests", safe_json(queue).get("total", 0) >= 1)

# Approve request
if vr_id:
    approve_res = s.put(f"{BASE}/registry/verification-requests/{vr_id}/approve", headers=auth_headers)
    test("Approve returns 200", approve_res.status_code == 200)
    if approve_res.status_code != 200:
        print(f"  DEBUG: approve status={approve_res.status_code}, body={approve_res.text[:200]}")

    # Check status after approval
    vr_approved = s.get(f"{BASE}/registry/verification-requests/{vr_id}", headers=auth_headers)
    vr_approved_data = safe_json(vr_approved)
    test("Status changed to ACTIVE", vr_approved_data.get("status") == "ACTIVE")
    test("Verification status is SOURCE_VERIFIED", vr_approved_data.get("verificationStatus") == "SOURCE_VERIFIED")
else:
    test("Approve returns 200", False)
    test("Status changed to ACTIVE", False)
    test("Verification status is SOURCE_VERIFIED", False)

# ══════════════════════════════════════════════
# 5. CREDENTIAL LIFECYCLE (Suspend/Reinstate/Revoke)
# ══════════════════════════════════════════════
print("\n--- Credential Lifecycle ---")

if cred_id:
    # Suspend
    suspend_res = s.post(f"{BASE}/registry/credentials/{cred_id}/suspend", headers=auth_headers)
    test("Suspend returns 200", suspend_res.status_code == 200)

    # Verify suspended credential
    verify_suspended = s.get(f"{BASE}/registry/credentials/{cred_id}/verify")
    test("Suspended credential still exists", safe_json(verify_suspended).get("checks", {}).get("existence", {}).get("passed") == True)

    # Reinstate
    reinstate_res = s.post(f"{BASE}/registry/credentials/{cred_id}/reinstate", headers=auth_headers)
    test("Reinstate returns 200", reinstate_res.status_code == 200)

    # Revoke
    revoke_res = s.post(f"{BASE}/registry/credentials/{cred_id}/revoke", json={
        "reason": "Fraudulent document detected"
    }, headers=auth_headers)
    test("Revoke returns 200", revoke_res.status_code == 200)

    # Verify revoked credential
    verify_revoked = s.get(f"{BASE}/registry/credentials/{cred_id}/verify")
    test("Revoked credential shows REVOKED", safe_json(verify_revoked).get("overallResult") == "REVOKED")

    # Cannot reinstate revoked
    reinstate_revoked = s.post(f"{BASE}/registry/credentials/{cred_id}/reinstate", headers=auth_headers)
    test("Cannot reinstate revoked (400)", reinstate_revoked.status_code == 400)

    # Cannot revoke again
    double_revoke = s.post(f"{BASE}/registry/credentials/{cred_id}/revoke", json={
        "reason": "Already revoked"
    }, headers=auth_headers)
    test("Cannot double-revoke (400)", double_revoke.status_code == 400)
else:
    for name in ["Suspend returns 200", "Suspended credential still exists", "Reinstate returns 200",
                  "Revoke returns 200", "Revoked credential shows REVOKED", "Cannot reinstate revoked (400)",
                  "Cannot double-revoke (400)"]:
        test(name, False)

# ══════════════════════════════════════════════
# 6. SEARCH & ANALYTICS
# ══════════════════════════════════════════════
print("\n--- Search & Analytics ---")

# Search credentials
search_res = s.get(f"{BASE}/registry/search/credentials?type=TVET", headers=auth_headers)
test("Search credentials returns 200", search_res.status_code == 200)
test("Search has results", safe_json(search_res).get("total", 0) >= 1)

# Platform overview
overview_res = s.get(f"{BASE}/registry/analytics/overview", headers=auth_headers)
test("Analytics overview returns 200", overview_res.status_code == 200)
overview = safe_json(overview_res)
test("Has totalCredentials", "totalCredentials" in overview)
test("Has totalHolders", "totalHolders" in overview)
test("Has credentialsByType", "credentialsByType" in overview)

# ══════════════════════════════════════════════
# 7. BULK OPERATIONS
# ══════════════════════════════════════════════
print("\n--- Bulk Operations ---")

bulk_res = s.post(f"{BASE}/registry/bulk/credentials", json={
    "credentials": [
        {
            "holderCnic": "17301-9999999-1",
            "credentialType": "MICRO_CREDENTIAL",
            "title": "Google IT Support Certificate",
            "issuerName": "Google/Coursera",
            "metadata": {"microCredential": {"platform": "COURSERA", "courseName": "Google IT Support"}}
        },
        {
            "holderCnic": "17301-9999999-1",
            "credentialType": "TRAINING_RECORD",
            "title": "NAVTTC Short Course - Electrical Wiring",
            "issuerName": "NAVTTC",
            "metadata": {"trainingRecord": {"programName": "NAVTTC_SHORT", "trainingDurationHours": 80}}
        },
        {
            "holderCnic": "17301-8888888-1",
            "credentialType": "HEALTH_CLEARANCE",
            "title": "GAMCA Medical Fitness",
            "metadata": {"healthClearance": {"examinationType": "GAMCA", "fitnessCategory": "FIT"}}
        }
    ]
}, headers=auth_headers)
test("Bulk upload returns 201", bulk_res.status_code == 201)
if bulk_res.status_code != 201:
    print(f"  DEBUG: bulk status={bulk_res.status_code}, body={bulk_res.text[:200]}")
bulk_data = safe_json(bulk_res)
test("Bulk total is 3", bulk_data.get("total") == 3)
test("Bulk success is 3", bulk_data.get("success") == 3)
test("Bulk failed is 0", bulk_data.get("failed") == 0)
test("Has batchId", "batchId" in bulk_data)

# ══════════════════════════════════════════════
# 8. W3C VC ENDPOINT
# ══════════════════════════════════════════════
print("\n--- W3C VC ---")

if cred_id:
    vc_res = s.get(f"{BASE}/registry/credentials/{cred_id}/vc", headers=auth_headers)
    test("VC endpoint returns response", vc_res.status_code in [200, 404, 400])
else:
    test("VC endpoint returns response", False)

# ══════════════════════════════════════════════
# 9. ISSUER CREDENTIAL VERIFICATION
# ══════════════════════════════════════════════
print("\n--- Issuer Verification ---")

if issuer_id:
    # Create a credential for the issuer to verify
    verify_cred = s.post(f"{BASE}/registry/credentials", json={
        "holderCnic": "17301-5555555-5",
        "credentialType": "ACADEMIC",
        "title": "MSc Data Science",
        "issuerName": "Test University Peshawar",
        "issuerId": issuer_id,
        "status": "PENDING_VERIFICATION"
    }, headers=auth_headers)
    verify_cred_data = safe_json(verify_cred).get("credential", {})
    verify_cred_id = verify_cred_data.get("credentialId", "")
    test("Created credential for issuer verification", verify_cred.status_code == 201)

    if verify_cred_id:
        # Issuer verifies
        iv_res = s.post(f"{BASE}/registry/issuers/{issuer_id}/verify-credential", json={
            "credentialId": verify_cred_id,
            "action": "APPROVE"
        }, headers=auth_headers)
        test("Issuer approval returns 200", iv_res.status_code == 200)
        iv_data = safe_json(iv_res).get("credential", {})
        test("Credential now ACTIVE", iv_data.get("status") == "ACTIVE")
        test("Verification is SOURCE_VERIFIED", iv_data.get("verificationStatus") == "SOURCE_VERIFIED")
    else:
        test("Issuer approval returns 200", False)
        test("Credential now ACTIVE", False)
        test("Verification is SOURCE_VERIFIED", False)

    # Get issuer's credentials
    issuer_creds = s.get(f"{BASE}/registry/issuers/{issuer_id}/credentials", headers=auth_headers)
    test("Issuer credentials returns 200", issuer_creds.status_code == 200)
    test("Issuer has credentials", safe_json(issuer_creds).get("total", 0) >= 1)

    # Issuer stats
    stats_res = s.get(f"{BASE}/registry/analytics/issuers/{issuer_id}/stats", headers=auth_headers)
    test("Issuer stats returns 200", stats_res.status_code == 200)
else:
    for name in ["Created credential for issuer verification", "Issuer approval returns 200",
                  "Credential now ACTIVE", "Verification is SOURCE_VERIFIED",
                  "Issuer credentials returns 200", "Issuer has credentials", "Issuer stats returns 200"]:
        test(name, False)

# ══════════════════════════════════════════════
# SUMMARY
# ══════════════════════════════════════════════
print("\n" + "=" * 60)
total = passed + failed
print(f"REGISTRY TESTS: {total} tests | PASS: {passed} | FAIL: {failed}")
if errors:
    print(f"\nFailed tests:")
    for e in errors:
        print(f"  - {e}")
print("=" * 60)

# Cleanup: delete test credentials (best effort)
try:
    s.delete(f"{BASE}/registry/holders/17301-1234567-1", headers=auth_headers)
except:
    pass

sys.exit(0 if failed == 0 else 1)
