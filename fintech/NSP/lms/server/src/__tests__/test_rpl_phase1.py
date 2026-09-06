"""
RPL Phase 1 Gap Implementation Tests
Tests all 6 gaps: #22, #33, #5, #23, #10, #29

Run: python src/__tests__/test_rpl_phase1.py
"""
import requests
import json
import sys
import os
import time

BASE = os.environ.get('API_URL', 'http://localhost:5000/api/v1')
passed = 0
failed = 0
errors = []

def test(name, condition, detail=''):
    global passed, failed
    if condition:
        passed += 1
        print(f'  PASS  {name}')
    else:
        failed += 1
        errors.append(f'{name}: {detail}')
        print(f'  FAIL  {name} — {detail}')

def headers(token):
    return {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}

def safe_json(r, default=None):
    """Safely parse JSON response"""
    try:
        return r.json()
    except:
        return default or {}

print('=' * 60)
print('RPL Phase 1 Gap Tests')
print('=' * 60)

# --- Setup: Register + Login admin, worker, assessor ---
print('\n--- Setup: Create users ---')

ts = int(time.time())
admin_email = f'rpl-admin-{ts}@test.com'
worker_email = f'rpl-worker-{ts}@test.com'
assessor_email = f'rpl-assessor-{ts}@test.com'

# Register institution (acts as admin for assessment management)
r = requests.post(f'{BASE}/auth/register', json={
    'name': 'RPL Admin', 'email': admin_email,
    'password': 'TestPass123!', 'role': 'institution', 'district': 'Peshawar'
})
test('Register institution (admin role)', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
admin_token = r.json().get('accessToken', '') or r.json().get('token', '')

# Register worker (trade=electrician so auto-created Worker profile has correct trade)
r = requests.post(f'{BASE}/auth/register', json={
    'name': 'RPL Worker', 'email': worker_email,
    'password': 'TestPass123!', 'role': 'worker', 'district': 'Peshawar',
    'trade': 'electrician', 'cnic': '12345-1234567-1'
})
test('Register worker', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
worker_token = r.json().get('accessToken', '') or r.json().get('token', '')
worker_user_id = r.json().get('user', {}).get('_id', '') or r.json().get('userId', '')
# Use the auto-created workerId from registration (not a separate Worker.create call)
auto_worker_id = r.json().get('workerId', '')

# Register assessor
r = requests.post(f'{BASE}/auth/register', json={
    'name': 'RPL Assessor', 'email': assessor_email,
    'password': 'TestPass123!', 'role': 'assessor', 'district': 'Peshawar'
})
test('Register assessor', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
assessor_token = r.json().get('accessToken', '') or r.json().get('token', '')
assessor_user_id = r.json().get('user', {}).get('_id', '') or r.json().get('userId', '')

# Use auto-created worker profile from registration (avoids duplicate Worker docs)
worker_id = auto_worker_id
test('Worker profile auto-created', bool(worker_id), f'workerId from registration: {worker_id}')

# Create RPL assessment (assessor creates it — assessor becomes assessment.assessor via req.user._id)
r = requests.post(f'{BASE}/assessments', json={
    'worker': worker_id,
    'type': 'rpl', 'trade': 'electrician', 'title': 'RPL Phase 1 Test'
}, headers=headers(assessor_token))
test('Create RPL assessment', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
assessment_id = r.json().get('_id', '')


# ═══════════════════════════════════════════════════════════
# GAP #33: Candidate Consent/Agreement Form
# ═══════════════════════════════════════════════════════════
print('\n--- Gap #33: Candidate Consent ---')

# Test: Get consent status (should be not given)
r = requests.get(f'{BASE}/assessments/{assessment_id}/consent', headers=headers(worker_token))
test('#33 Get consent status', r.status_code == 200 and r.json().get('consentGiven') == False, f'{r.status_code}: {r.text[:200]}')

# Test: Submit consent with missing items (should fail)
r = requests.put(f'{BASE}/assessments/{assessment_id}/consent', json={
    'consentItems': {
        'evidenceUsage': True, 'dataHandling': True,
        'thirdPartySharing': False, 'photoVideoConsent': True, 'appealRights': True
    }
}, headers=headers(worker_token))
test('#33 Reject partial consent', r.status_code == 400, f'{r.status_code}: {r.text[:200]}')

# Test: Submit full consent
r = requests.put(f'{BASE}/assessments/{assessment_id}/consent', json={
    'consentItems': {
        'evidenceUsage': True, 'dataHandling': True,
        'thirdPartySharing': True, 'photoVideoConsent': True, 'appealRights': True
    }
}, headers=headers(worker_token))
test('#33 Submit full consent', r.status_code == 200 and r.json().get('consent', {}).get('agreed') == True, f'{r.status_code}: {r.text[:200]}')

# Test: Verify consent is recorded
r = requests.get(f'{BASE}/assessments/{assessment_id}/consent', headers=headers(worker_token))
data = r.json()
test('#33 Consent recorded with version', data.get('consentGiven') == True and data.get('consent', {}).get('version') == '1.0', f'{r.status_code}: {r.text[:200]}')
test('#33 Consent has IP and user agent', data.get('consent', {}).get('ipAddress') is not None, f'Missing IP: {r.text[:200]}')

# ═══════════════════════════════════════════════════════════
# GAP #5: Timeline/Duration Tracking
# ═══════════════════════════════════════════════════════════
print('\n--- Gap #5: Timeline Tracking ---')

# Test: Get timeline (should be empty initially)
r = requests.get(f'{BASE}/assessments/{assessment_id}/timeline', headers=headers(worker_token))
test('#5 Get timeline', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
tl = r.json()
test('#5 Timeline has progress info', 'progress' in tl and 'totalEstimatedDays' in tl, f'{r.text[:200]}')
test('#5 Current stage is preScreening', tl.get('progress', {}).get('currentStage') == 'preScreening', f'{r.text[:200]}')

# Test: Add timeline entry (assessor)
r = requests.post(f'{BASE}/assessments/{assessment_id}/timeline', json={
    'stage': 'pre-screening', 'estimatedDurationDays': 2, 'notes': 'Worker needs to complete self-assessment'
}, headers=headers(assessor_token))
test('#5 Add timeline entry', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
test('#5 Timeline has estimated completion', safe_json(r).get('estimatedCompletionDate') is not None, f'{r.text[:200]}')

# ═══════════════════════════════════════════════════════════
# GAP #10: Video Evidence (upload test - without actual file)
# ═══════════════════════════════════════════════════════════
print('\n--- Gap #10: Video Evidence ---')

# Test: Upload without consent (should work since consent already given above)
# Test: Try uploading without a file (should fail with 400)
r = requests.post(f'{BASE}/assessments/{assessment_id}/video-evidence',
    headers={'Authorization': f'Bearer {worker_token}'},
)
test('#10 Reject upload without file', r.status_code == 400, f'{r.status_code}: {r.text[:200]}')

# ═══════════════════════════════════════════════════════════
# Now run through the RPL stages to test notifications (#22)
# ═══════════════════════════════════════════════════════════
print('\n--- Gap #22: Notifications during RPL stages ---')

# Pre-screening
r = requests.put(f'{BASE}/assessments/{assessment_id}/pre-screening', json={
    'responses': [
        {'area': 'Wiring Installation', 'selfRating': 4, 'yearsExperience': 5, 'hasEvidence': True},
        {'area': 'Circuit Design', 'selfRating': 3, 'yearsExperience': 3, 'hasEvidence': True},
        {'area': 'Safety & Grounding', 'selfRating': 4, 'yearsExperience': 5, 'hasEvidence': True},
        {'area': 'Panel Installation', 'selfRating': 3, 'yearsExperience': 3, 'hasEvidence': False},
        {'area': 'Testing & Measurement', 'selfRating': 4, 'yearsExperience': 4, 'hasEvidence': True},
        {'area': 'Code Compliance', 'selfRating': 3, 'yearsExperience': 3, 'hasEvidence': True},
        {'area': 'Troubleshooting', 'selfRating': 4, 'yearsExperience': 5, 'hasEvidence': True},
        {'area': 'Motor Controls', 'selfRating': 3, 'yearsExperience': 3, 'hasEvidence': False},
    ],
    'tradeExperience': {'totalYears': 5, 'formalTraining': True, 'currentlyEmployed': True, 'employerName': 'WAPDA'}
}, headers=headers(worker_token))
test('#22 Pre-screening completes', r.status_code == 200 and r.json().get('eligible') == True, f'{r.status_code}: {r.text[:200]}')

# Check notifications for assessor
r = requests.get(f'{BASE}/notifications', headers=headers(assessor_token))
test('#22 Assessor gets notification', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
notifs = r.json().get('notifications', [])
test('#22 Has pre-screening notification', len(notifs) > 0, f'Notifications count: {len(notifs)}')

# Check unread count
r = requests.get(f'{BASE}/notifications/unread-count', headers=headers(assessor_token))
test('#22 Unread count > 0', r.status_code == 200 and r.json().get('unreadCount', 0) > 0, f'{r.status_code}: {r.text[:200]}')

# Mark notification as read
if notifs:
    notif_id = notifs[0].get('_id')
    r = requests.put(f'{BASE}/notifications/{notif_id}/read', headers=headers(assessor_token))
    test('#22 Mark notification read', r.status_code == 200 and r.json().get('read') == True, f'{r.status_code}: {r.text[:200]}')

# Mark all as read
r = requests.put(f'{BASE}/notifications/read-all', headers=headers(assessor_token))
test('#22 Mark all as read', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# Upload evidence documents (needed for document review stage gate)
import io
# Use multipart upload for evidence
files = [
    ('documents', ('exp-letter.pdf', b'%PDF-1.4 fake pdf content', 'application/pdf')),
    ('documents', ('trade-cert.pdf', b'%PDF-1.4 fake pdf content 2', 'application/pdf')),
]
r = requests.post(f'{BASE}/assessments/{assessment_id}/evidence',
    files=files,
    data={'categories': ['experience-letter', 'trade-certificate']},
    headers={'Authorization': f'Bearer {worker_token}'},
)
test('#22 Evidence uploaded', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# Document review
r = requests.put(f'{BASE}/assessments/{assessment_id}/document-review', json={
    'feedback': 'Documents verified and complete'
}, headers=headers(assessor_token))
test('#22 Document review complete', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# Check worker got notification
r = requests.get(f'{BASE}/notifications', headers=headers(worker_token))
worker_notifs = r.json().get('notifications', [])
test('#22 Worker gets doc review notification', len(worker_notifs) > 0, f'Worker notifications: {len(worker_notifs)}')

# Interview
r = requests.put(f'{BASE}/assessments/{assessment_id}/interview', json={
    'items': [
        {'competencyArea': 'Wiring Installation', 'question': 'Test Q1', 'response': 'Good answer', 'score': 3},
        {'competencyArea': 'Circuit Design', 'question': 'Test Q2', 'response': 'Good answer', 'score': 3},
        {'competencyArea': 'Safety & Grounding', 'question': 'Test Q3', 'response': 'Excellent', 'score': 4},
        {'competencyArea': 'Panel Installation', 'question': 'Test Q4', 'response': 'Good', 'score': 3},
        {'competencyArea': 'Testing & Measurement', 'question': 'Test Q5', 'response': 'Good', 'score': 3},
        {'competencyArea': 'Troubleshooting', 'question': 'Test Q6', 'response': 'Good', 'score': 3},
    ],
    'overallNotes': 'Strong candidate', 'durationMinutes': 45
}, headers=headers(assessor_token))
test('#22 Interview complete', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# Practical demo
r = requests.put(f'{BASE}/assessments/{assessment_id}/practical-demo', json={
    'rubric': [
        {'criterion': 'Cable Selection & Routing', 'score': 3},
        {'criterion': 'Connection Quality', 'score': 3},
        {'criterion': 'Distribution Board Assembly', 'score': 3},
        {'criterion': 'Earthing & Bonding', 'score': 3},
        {'criterion': 'Testing Procedures', 'score': 3},
        {'criterion': 'Code Compliance', 'score': 3},
        {'criterion': 'Safety Practices', 'score': 4},
        {'criterion': 'Documentation', 'score': 3},
    ],
    'overallResult': 'pass', 'location': 'TVET Centre Peshawar'
}, headers=headers(assessor_token))
test('#22 Practical demo complete', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# Check timeline has auto-recorded stages
r = requests.get(f'{BASE}/assessments/{assessment_id}/timeline', headers=headers(worker_token))
tl = r.json()
test('#5 Timeline auto-recorded stages', len(tl.get('timeline', [])) >= 3, f'Timeline entries: {len(tl.get("timeline", []))}')
test('#5 Progress shows 5/6 stages', tl.get('progress', {}).get('completedStages', 0) >= 5, f'Completed: {tl.get("progress", {}).get("completedStages")}')

# ═══════════════════════════════════════════════════════════
# GAP #29: Partial RPL Recognition (Unit-Based)
# ═══════════════════════════════════════════════════════════
print('\n--- Gap #29: Partial RPL Recognition ---')

# Set competency units
r = requests.put(f'{BASE}/assessments/{assessment_id}/competency-units', json={
    'units': [
        {'unitCode': 'CU-ELEC-01', 'unitTitle': 'Wiring Installation', 'status': 'competent', 'nqfLevel': 4, 'interviewScore': 3, 'demoScore': 3, 'evidenceSufficient': True},
        {'unitCode': 'CU-ELEC-02', 'unitTitle': 'Circuit Design', 'status': 'competent', 'nqfLevel': 4, 'interviewScore': 3, 'demoScore': 3, 'evidenceSufficient': True},
        {'unitCode': 'CU-ELEC-03', 'unitTitle': 'Safety & Grounding', 'status': 'competent', 'nqfLevel': 4, 'interviewScore': 4, 'demoScore': 3, 'evidenceSufficient': True},
        {'unitCode': 'CU-ELEC-04', 'unitTitle': 'Panel Installation', 'status': 'not-yet-competent', 'nqfLevel': 4, 'interviewScore': 2, 'demoScore': 1, 'notes': 'Needs more practice'},
        {'unitCode': 'CU-ELEC-05', 'unitTitle': 'Testing & Measurement', 'status': 'competent', 'nqfLevel': 4, 'interviewScore': 3, 'demoScore': 3, 'evidenceSufficient': True},
        {'unitCode': 'CU-ELEC-06', 'unitTitle': 'Troubleshooting', 'status': 'partially-competent', 'nqfLevel': 4, 'interviewScore': 3, 'demoScore': 2},
    ]
}, headers=headers(assessor_token))
test('#29 Set competency units', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
pr = r.json().get('partialRecognition', {})
test('#29 Partial recognition eligible', pr.get('eligible') == True, f'{r.text[:200]}')
test('#29 4 of 6 units achieved', pr.get('unitsAchieved') == 4, f'Achieved: {pr.get("unitsAchieved")}')
test('#29 Percent complete = 67%', pr.get('percentComplete') == 67, f'Percent: {pr.get("percentComplete")}')

# Get partial recognition status
r = requests.get(f'{BASE}/assessments/{assessment_id}/partial-recognition', headers=headers(worker_token))
test('#29 Get partial recognition', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
test('#29 Shows 6 competency units', len(r.json().get('competencyUnits', [])) == 6, f'{r.text[:200]}')

# Issue statement of attainment
r = requests.post(f'{BASE}/assessments/{assessment_id}/statement-of-attainment', headers=headers(admin_token))
test('#29 Issue statement of attainment', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
test('#29 Statement issued flag', r.json().get('partialRecognition', {}).get('statementOfAttainmentIssued') == True, f'{r.text[:200]}')
test('#29 Units on record = 4', r.json().get('unitsOnRecord') == 4, f'{r.text[:200]}')

# Try issuing again (should fail)
r = requests.post(f'{BASE}/assessments/{assessment_id}/statement-of-attainment', headers=headers(admin_token))
test('#29 Reject duplicate statement', r.status_code == 409, f'{r.status_code}: {r.text[:200]}')

# Check worker competencies updated
r = requests.get(f'{BASE}/workers/{worker_id}', headers=headers(admin_token))
worker_data = r.json()
competencies = worker_data.get('competencies', [])
test('#29 Worker competencies updated', len(competencies) >= 4, f'Competencies: {len(competencies)}')

# ═══════════════════════════════════════════════════════════
# GAP #23: RPL Credential Expiry Tracking
# ═══════════════════════════════════════════════════════════
print('\n--- Gap #23: Credential Expiry Tracking ---')

# First approve the assessment so we can issue a credential
r = requests.put(f'{BASE}/assessments/{assessment_id}/review', json={
    'status': 'approved', 'score': 78, 'feedback': 'Strong candidate with good practical skills'
}, headers=headers(assessor_token))
test('#23 Assessment sent to moderation', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# Moderate (admin)
r = requests.put(f'{BASE}/assessments/{assessment_id}/moderate', json={
    'decision': 'endorsed', 'comments': 'Agree with assessor decision'
}, headers=headers(admin_token))
test('#23 Moderation endorsed', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# Issue credential with near-expiry date (30 days from now for testing)
from datetime import datetime, timedelta
expiry_30d = (datetime.now() + timedelta(days=30)).isoformat()

r = requests.post(f'{BASE}/credentials', json={
    'workerId': worker_id, 'type': 'rpl-certificate',
    'title': 'RPL Certificate - Electrician NQF Level 4',
    'trade': 'electrician', 'nqfLevel': 4,
    'institution': 'PPMC KP', 'validUntil': expiry_30d
}, headers=headers(admin_token))
test('#23 Issue credential', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
cred_id = r.json().get('_id', '')

# Check credential expiry
r = requests.get(f'{BASE}/assessments/credential-expiry/check?daysAhead=90', headers=headers(admin_token))
test('#23 Check expiring credentials', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
summary = r.json().get('summary', {})
test('#23 Found expiring credentials', summary.get('totalExpiring', 0) >= 1, f'Total expiring: {summary.get("totalExpiring")}')

# Send expiry notifications
r = requests.post(f'{BASE}/assessments/credential-expiry/notify', json={
    'daysThreshold': 90
}, headers=headers(admin_token))
test('#23 Send expiry notifications', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
test('#23 Notifications sent', r.json().get('notified', 0) >= 1, f'{r.text[:200]}')

# ═══════════════════════════════════════════════════════════
# Final notification count check
# ═══════════════════════════════════════════════════════════
print('\n--- Final Notification Checks ---')

r = requests.get(f'{BASE}/notifications', headers=headers(worker_token))
all_notifs = r.json().get('notifications', [])
test('#22 Worker has multiple notifications', len(all_notifs) >= 3, f'Total worker notifications: {len(all_notifs)}')

# Check notification types
types = [n.get('type') for n in all_notifs]
test('#22 Has rpl-stage-change notifications', 'rpl-stage-change' in types, f'Types: {types}')

# ═══════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════
print('\n' + '=' * 60)
print(f'RPL Phase 1 Results: {passed} passed, {failed} failed out of {passed + failed}')
print('=' * 60)

if errors:
    print('\nFailures:')
    for e in errors:
        print(f'  - {e}')

sys.exit(1 if failed > 0 else 0)
