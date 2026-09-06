"""
RPL Phase 2 Gap Implementation Tests
Tests all 6 gaps: #6, #7, #21, #1, #2, #30

Run: python src/__tests__/test_rpl_phase2.py
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
    try:
        return r.json()
    except:
        return default or {}

print('=' * 60)
print('RPL Phase 2 Gap Tests')
print('=' * 60)

# --- Setup: Register users ---
print('\n--- Setup: Create users ---')

ts = int(time.time())
admin_email = f'rpl2-admin-{ts}@test.com'
worker_email = f'rpl2-worker-{ts}@test.com'
assessor_email = f'rpl2-assessor-{ts}@test.com'
ext_mod_email = f'rpl2-extmod-{ts}@test.com'

# Register institution
r = requests.post(f'{BASE}/auth/register', json={
    'name': 'RPL2 Admin', 'email': admin_email,
    'password': 'TestPass123!', 'role': 'institution', 'district': 'Peshawar'
})
test('Register institution', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
admin_token = r.json().get('accessToken', '') or r.json().get('token', '')

# Register worker (electrician trade)
r = requests.post(f'{BASE}/auth/register', json={
    'name': 'RPL2 Worker', 'email': worker_email,
    'password': 'TestPass123!', 'role': 'worker', 'district': 'Peshawar',
    'trade': 'electrician', 'cnic': '12345-7654321-1'
})
test('Register worker', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
worker_token = r.json().get('accessToken', '') or r.json().get('token', '')
worker_id = r.json().get('workerId', '')

# Register assessor
r = requests.post(f'{BASE}/auth/register', json={
    'name': 'RPL2 Assessor', 'email': assessor_email,
    'password': 'TestPass123!', 'role': 'assessor', 'district': 'Peshawar'
})
test('Register assessor', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
assessor_token = r.json().get('accessToken', '') or r.json().get('token', '')

# Register external moderator (separate institution user for external moderation)
r = requests.post(f'{BASE}/auth/register', json={
    'name': 'RPL2 ExtMod', 'email': ext_mod_email,
    'password': 'TestPass123!', 'role': 'institution', 'district': 'Islamabad'
})
test('Register external moderator', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
ext_mod_token = r.json().get('accessToken', '') or r.json().get('token', '')

test('Worker profile auto-created', bool(worker_id), f'workerId: {worker_id}')

# Create RPL assessment (assessor creates it)
r = requests.post(f'{BASE}/assessments', json={
    'worker': worker_id,
    'type': 'rpl', 'trade': 'electrician', 'title': 'RPL Phase 2 Test'
}, headers=headers(assessor_token))
test('Create RPL assessment', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
assessment_id = r.json().get('_id', '')

# ═══════════════════════════════════════════════════════════
# GAP #1: RPL Readiness Guide / Candidate Handbook
# ═══════════════════════════════════════════════════════════
print('\n--- Gap #1: RPL Readiness Guide ---')

# Get readiness guide for electrician
r = requests.get(f'{BASE}/assessments/readiness-guide/electrician', headers=headers(worker_token))
test('#1 Get electrician readiness guide', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
guide = safe_json(r).get('guide', {})
test('#1 Guide has sections', len(guide.get('sections', [])) >= 5, f'Sections: {len(guide.get("sections", []))}')
test('#1 Guide has title', 'Electrician' in guide.get('title', ''), f'Title: {guide.get("title")}')

# Get default readiness guide
r = requests.get(f'{BASE}/assessments/readiness-guide/painter', headers=headers(worker_token))
test('#1 Default guide for unknown trade', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# Acknowledge readiness guide (partial)
r = requests.put(f'{BASE}/assessments/{assessment_id}/readiness-guide/acknowledge', json={
    'sectionsRead': ['overview', 'eligibility']
}, headers=headers(worker_token))
test('#1 Partial acknowledgment', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
rg = safe_json(r)
test('#1 Not fully acknowledged yet', rg.get('readinessGuide', {}).get('acknowledged') == False, f'{r.text[:200]}')

# Acknowledge readiness guide (complete)
r = requests.put(f'{BASE}/assessments/{assessment_id}/readiness-guide/acknowledge', json={
    'sectionsRead': ['process', 'evidence', 'knowledge', 'tips']
}, headers=headers(worker_token))
test('#1 Full acknowledgment', r.status_code == 200 and safe_json(r).get('readinessGuide', {}).get('acknowledged') == True, f'{r.status_code}: {r.text[:200]}')

# ═══════════════════════════════════════════════════════════
# GAP #2: Evidence Preparation Checklist
# ═══════════════════════════════════════════════════════════
print('\n--- Gap #2: Evidence Preparation Checklist ---')

# Get evidence checklist template for electrician
r = requests.get(f'{BASE}/assessments/evidence-checklist/electrician', headers=headers(worker_token))
test('#2 Get electrician checklist', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
cl = r.json()
test('#2 Checklist has items', cl.get('summary', {}).get('total', 0) >= 8, f'Items: {cl.get("summary", {}).get("total")}')
test('#2 Has required count', cl.get('summary', {}).get('required', 0) >= 5, f'Required: {cl.get("summary", {}).get("required")}')

# Update evidence checklist progress (partial)
r = requests.put(f'{BASE}/assessments/{assessment_id}/evidence-checklist', json={
    'items': [
        {'itemId': 'id-cnic', 'prepared': True},
        {'itemId': 'id-photo', 'prepared': True},
        {'itemId': 'exp-letter', 'prepared': True},
    ]
}, headers=headers(worker_token))
test('#2 Update checklist partial', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
ecl = safe_json(r)
test('#2 Not all required done', ecl.get('completed') == False, f'{r.text[:200]}')
test('#2 3 items prepared', ecl.get('summary', {}).get('prepared') == 3, f'Prepared: {ecl.get("summary", {}).get("prepared")}')

# Complete all required items
r = requests.put(f'{BASE}/assessments/{assessment_id}/evidence-checklist', json={
    'items': [
        {'itemId': 'safety-cert', 'prepared': True},
        {'itemId': 'ref-letter', 'prepared': True},
        {'itemId': 'wiring-photos', 'prepared': True},
        {'itemId': 'project-list', 'prepared': True},
    ]
}, headers=headers(worker_token))
test('#2 Complete all required', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
ecl2 = safe_json(r)
test('#2 All required prepared', ecl2.get('completed') == True, f'{r.text[:200]}')

# ═══════════════════════════════════════════════════════════
# GAP #6: Challenge Exam / Written Knowledge Test
# ═══════════════════════════════════════════════════════════
print('\n--- Gap #6: Challenge Exam ---')

# First complete pre-screening (gate check)
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
test('#6 Pre-screening completed', r.status_code == 200 and safe_json(r).get('eligible') == True, f'{r.status_code}: {r.text[:200]}')

# Start challenge exam
r = requests.post(f'{BASE}/assessments/{assessment_id}/challenge-exam/start', headers=headers(worker_token))
test('#6 Start challenge exam', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
exam_data = safe_json(r)
test('#6 Has 10 questions', exam_data.get('totalQuestions') == 10, f'Questions: {exam_data.get("totalQuestions")}')
test('#6 Has time limit', exam_data.get('timeLimitMinutes') == 60, f'TimeLimit: {exam_data.get("timeLimitMinutes")}')
questions = exam_data.get('questions', [])
test('#6 Questions have no answers', all('correctOption' not in q and 'correctAnswer' not in q for q in questions), 'Questions leaked answers!')

# Try starting again (should return in-progress)
r = requests.post(f'{BASE}/assessments/{assessment_id}/challenge-exam/start', headers=headers(worker_token))
test('#6 Restart returns in-progress', r.status_code == 200 and 'in progress' in safe_json(r).get('message', '').lower(), f'{r.status_code}: {r.text[:200]}')

# Submit answers (correct answers for electrician test)
answers = [
    {'questionIndex': 0, 'selectedOption': 1},        # 220V - correct
    {'questionIndex': 1, 'textAnswer': 'true'},        # circuit breaker/fuse - correct
    {'questionIndex': 2, 'textAnswer': 'green'},       # earth wire color - correct
    {'questionIndex': 3, 'textAnswer': 'series has single path, parallel has multiple paths'},  # short answer
    {'questionIndex': 4, 'selectedOption': 2},         # Ohmmeter - correct
    {'questionIndex': 5, 'textAnswer': 'false'},       # working live with gloves - correct
    {'questionIndex': 6, 'textAnswer': 'watt'},        # unit of power - correct
    {'questionIndex': 7, 'textAnswer': 'safety protection from electric shock, directs fault current to ground'},
    {'questionIndex': 8, 'selectedOption': 1},         # Armoured cable - correct
    {'questionIndex': 9, 'textAnswer': 'R'},           # Ohm's law - correct
]
r = requests.put(f'{BASE}/assessments/{assessment_id}/challenge-exam/submit', json={
    'answers': answers
}, headers=headers(worker_token))
test('#6 Submit exam', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
result = safe_json(r)
test('#6 Exam passed', result.get('passed') == True, f'Score: {result.get("score")}%, Passed: {result.get("passed")}')
test('#6 Score >= 60%', result.get('score', 0) >= 60, f'Score: {result.get("score")}%')
test('#6 Has earned points', result.get('earnedPoints', 0) > 0, f'Earned: {result.get("earnedPoints")}')

# Try submitting again (should fail)
r = requests.put(f'{BASE}/assessments/{assessment_id}/challenge-exam/submit', json={
    'answers': answers
}, headers=headers(worker_token))
test('#6 Reject duplicate submit', r.status_code == 409, f'{r.status_code}: {r.text[:200]}')

# Get exam result
r = requests.get(f'{BASE}/assessments/{assessment_id}/challenge-exam', headers=headers(worker_token))
test('#6 Get exam result', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
er = safe_json(r)
test('#6 Result shows completed', er.get('completed') == True, f'{r.text[:200]}')
test('#6 Result shows score', er.get('score', 0) >= 60, f'Score: {er.get("score")}')

# ═══════════════════════════════════════════════════════════
# GAP #7: Three-Tier Credentialing
# ═══════════════════════════════════════════════════════════
print('\n--- Gap #7: Three-Tier Credentialing ---')

# Check tier after exam only (should be 'knowledge')
r = requests.get(f'{BASE}/assessments/{assessment_id}/credential-tier', headers=headers(worker_token))
test('#7 Get credential tier', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
tier = safe_json(r)
test('#7 Knowledge tier after exam', tier.get('tier') == 'knowledge', f'Tier: {tier.get("tier")}')
test('#7 Has description', 'Knowledge' in tier.get('description', ''), f'{r.text[:200]}')

# Now complete practical demo to upgrade to 'performance' tier
# First submit consent (required for some gates)
r = requests.put(f'{BASE}/assessments/{assessment_id}/consent', json={
    'consentItems': {
        'evidenceUsage': True, 'dataHandling': True,
        'thirdPartySharing': True, 'photoVideoConsent': True, 'appealRights': True
    }
}, headers=headers(worker_token))
test('#7 Submit consent', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# Upload evidence
files = [
    ('documents', ('exp-letter.pdf', b'%PDF-1.4 fake pdf', 'application/pdf')),
    ('documents', ('trade-cert.pdf', b'%PDF-1.4 fake cert', 'application/pdf')),
]
r = requests.post(f'{BASE}/assessments/{assessment_id}/evidence',
    files=files,
    data={'categories': ['experience-letter', 'trade-certificate']},
    headers={'Authorization': f'Bearer {worker_token}'},
)
test('#7 Upload evidence', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# Document review
r = requests.put(f'{BASE}/assessments/{assessment_id}/document-review', json={
    'feedback': 'Documents verified'
}, headers=headers(assessor_token))
test('#7 Document review', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# Interview
r = requests.put(f'{BASE}/assessments/{assessment_id}/interview', json={
    'items': [
        {'competencyArea': 'Wiring Installation', 'question': 'Q1', 'response': 'Good', 'score': 3},
        {'competencyArea': 'Circuit Design', 'question': 'Q2', 'response': 'Good', 'score': 3},
        {'competencyArea': 'Safety & Grounding', 'question': 'Q3', 'response': 'Excellent', 'score': 4},
        {'competencyArea': 'Panel Installation', 'question': 'Q4', 'response': 'Good', 'score': 3},
        {'competencyArea': 'Testing & Measurement', 'question': 'Q5', 'response': 'Good', 'score': 3},
        {'competencyArea': 'Troubleshooting', 'question': 'Q6', 'response': 'Good', 'score': 3},
    ],
    'overallNotes': 'Strong candidate', 'durationMinutes': 45
}, headers=headers(assessor_token))
test('#7 Interview', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# Practical demo (pass)
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
test('#7 Practical demo pass', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# Check tier after demo (should be 'performance')
r = requests.get(f'{BASE}/assessments/{assessment_id}/credential-tier', headers=headers(worker_token))
tier2 = safe_json(r)
test('#7 Performance tier after demo', tier2.get('tier') == 'performance', f'Tier: {tier2.get("tier")}')

# ═══════════════════════════════════════════════════════════
# GAP #21: E-Portfolio System
# ═══════════════════════════════════════════════════════════
print('\n--- Gap #21: E-Portfolio System ---')

# Create portfolio collection
r = requests.post(f'{BASE}/workers/{worker_id}/portfolio/collections', json={
    'name': 'Electrical Work Samples', 'description': 'Photos and docs of completed electrical projects'
}, headers=headers(worker_token))
test('#21 Create collection', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')

# Reject duplicate collection
r = requests.post(f'{BASE}/workers/{worker_id}/portfolio/collections', json={
    'name': 'Electrical Work Samples'
}, headers=headers(worker_token))
test('#21 Reject duplicate collection', r.status_code == 409, f'{r.status_code}: {r.text[:200]}')

# Add portfolio items
r = requests.post(f'{BASE}/workers/{worker_id}/portfolio', json={
    'title': 'Distribution Board Installation',
    'description': 'Installed 3-phase distribution board at commercial building',
    'type': 'photo',
    'competencyArea': 'Panel Installation',
    'collection': 'Electrical Work Samples',
    'tags': ['distribution-board', 'commercial', '3-phase'],
    'visibility': 'assessor'
}, headers=headers(worker_token))
test('#21 Add portfolio item 1', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')

r = requests.post(f'{BASE}/workers/{worker_id}/portfolio', json={
    'title': 'Wiring Diagram', 'type': 'document',
    'competencyArea': 'Circuit Design',
    'collection': 'Electrical Work Samples',
    'visibility': 'public'
}, headers=headers(worker_token))
test('#21 Add portfolio item 2', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')

r = requests.post(f'{BASE}/workers/{worker_id}/portfolio', json={
    'title': 'Safety Training Certificate', 'type': 'certificate',
    'visibility': 'private'
}, headers=headers(worker_token))
test('#21 Add portfolio item 3 (private)', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')

# Get portfolio (as worker — sees all)
r = requests.get(f'{BASE}/workers/{worker_id}/portfolio', headers=headers(worker_token))
test('#21 Get portfolio', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
pf = safe_json(r)
test('#21 Has 3 items', pf.get('totalItems') == 3, f'Total: {pf.get("totalItems")}')
test('#21 Has collection', 'Electrical Work Samples' in pf.get('collections', {}), f'Collections: {list(pf.get("collections", {}).keys())}')

# Get portfolio with filter
r = requests.get(f'{BASE}/workers/{worker_id}/portfolio?collection=Electrical Work Samples', headers=headers(worker_token))
test('#21 Filter by collection', safe_json(r).get('totalItems') == 2, f'Items: {safe_json(r).get("totalItems")}')

# Update portfolio item
r = requests.put(f'{BASE}/workers/{worker_id}/portfolio/0', json={
    'visibility': 'public', 'tags': ['distribution-board', 'commercial', '3-phase', 'featured']
}, headers=headers(worker_token))
test('#21 Update portfolio item', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# Delete portfolio item (the private one)
r = requests.delete(f'{BASE}/workers/{worker_id}/portfolio/2', headers=headers(worker_token))
test('#21 Delete portfolio item', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
test('#21 Now 2 items', safe_json(r).get('totalItems') == 2, f'Total: {safe_json(r).get("totalItems")}')

# Generate share link
r = requests.post(f'{BASE}/workers/{worker_id}/portfolio/share', headers=headers(worker_token))
test('#21 Generate share link', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
test('#21 Has share token', bool(safe_json(r).get('shareToken')), f'{r.text[:200]}')

# ═══════════════════════════════════════════════════════════
# GAP #30: Re-assessment Pathway
# ═══════════════════════════════════════════════════════════
print('\n--- Gap #30: Re-assessment Pathway ---')

# First, we need a rejected assessment to test re-assessment
# Create a second assessment that will be rejected
r = requests.post(f'{BASE}/assessments', json={
    'worker': worker_id,
    'type': 'rpl', 'trade': 'electrician', 'title': 'RPL Re-assessment Test'
}, headers=headers(assessor_token))
test('#30 Create second assessment', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
assess2_id = safe_json(r).get('_id', '')

# Complete pre-screening
r = requests.put(f'{BASE}/assessments/{assess2_id}/pre-screening', json={
    'responses': [
        {'area': 'Wiring Installation', 'selfRating': 2, 'yearsExperience': 1, 'hasEvidence': False},
        {'area': 'Circuit Design', 'selfRating': 1, 'yearsExperience': 1, 'hasEvidence': False},
        {'area': 'Safety & Grounding', 'selfRating': 2, 'yearsExperience': 1, 'hasEvidence': True},
        {'area': 'Panel Installation', 'selfRating': 1, 'yearsExperience': 0, 'hasEvidence': False},
        {'area': 'Testing & Measurement', 'selfRating': 2, 'yearsExperience': 1, 'hasEvidence': False},
        {'area': 'Code Compliance', 'selfRating': 1, 'yearsExperience': 1, 'hasEvidence': False},
        {'area': 'Troubleshooting', 'selfRating': 2, 'yearsExperience': 1, 'hasEvidence': False},
        {'area': 'Motor Controls', 'selfRating': 1, 'yearsExperience': 0, 'hasEvidence': False},
    ],
    'tradeExperience': {'totalYears': 1, 'formalTraining': False, 'currentlyEmployed': True, 'employerName': 'Local shop'}
}, headers=headers(worker_token))
test('#30 Pre-screening (low scores)', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# Upload evidence (need ≥2 docs including experience letter or trade cert)
files = [
    ('documents', ('exp-letter.pdf', b'%PDF-1.4 fake exp letter', 'application/pdf')),
    ('documents', ('trade-cert.pdf', b'%PDF-1.4 fake trade cert', 'application/pdf')),
]
r = requests.post(f'{BASE}/assessments/{assess2_id}/evidence',
    files=files,
    data={'categories': ['experience-letter', 'trade-certificate']},
    headers={'Authorization': f'Bearer {worker_token}'},
)
test('#30 Upload evidence', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# Document review
r = requests.put(f'{BASE}/assessments/{assess2_id}/document-review', json={
    'feedback': 'Insufficient documentation'
}, headers=headers(assessor_token))
test('#30 Document review', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# Interview (low scores to trigger gap training)
r = requests.put(f'{BASE}/assessments/{assess2_id}/interview', json={
    'items': [
        {'competencyArea': 'Wiring Installation', 'question': 'Q1', 'response': 'Poor', 'score': 1},
        {'competencyArea': 'Circuit Design', 'question': 'Q2', 'response': 'Poor', 'score': 0},
        {'competencyArea': 'Safety & Grounding', 'question': 'Q3', 'response': 'OK', 'score': 2},
        {'competencyArea': 'Panel Installation', 'question': 'Q4', 'response': 'Poor', 'score': 1},
        {'competencyArea': 'Testing & Measurement', 'question': 'Q5', 'response': 'Poor', 'score': 1},
        {'competencyArea': 'Troubleshooting', 'question': 'Q6', 'response': 'Poor', 'score': 0},
    ],
    'overallNotes': 'Candidate needs more training', 'durationMinutes': 30
}, headers=headers(assessor_token))
test('#30 Interview (low scores)', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# Practical demo (fail)
r = requests.put(f'{BASE}/assessments/{assess2_id}/practical-demo', json={
    'rubric': [
        {'criterion': 'Cable Selection & Routing', 'score': 1},
        {'criterion': 'Connection Quality', 'score': 0},
        {'criterion': 'Distribution Board Assembly', 'score': 1},
        {'criterion': 'Earthing & Bonding', 'score': 0},
        {'criterion': 'Testing Procedures', 'score': 1},
        {'criterion': 'Code Compliance', 'score': 0},
        {'criterion': 'Safety Practices', 'score': 1},
        {'criterion': 'Documentation', 'score': 0},
    ],
    'overallResult': 'fail', 'location': 'TVET Centre Peshawar'
}, headers=headers(assessor_token))
test('#30 Practical demo (fail)', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# Reject assessment (sends to moderation which triggers gap training)
r = requests.put(f'{BASE}/assessments/{assess2_id}/review', json={
    'status': 'rejected', 'score': 25, 'feedback': 'Needs significant improvement in multiple areas'
}, headers=headers(assessor_token))
test('#30 Review rejected', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# Moderate (endorse rejection)
r = requests.put(f'{BASE}/assessments/{assess2_id}/moderate', json={
    'decision': 'endorsed', 'comments': 'Agree with rejection. Gap training needed.'
}, headers=headers(admin_token))
test('#30 Moderation endorsed', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# External moderation may be required for electrician (safety trade)
# Check status and complete external moderation if needed
r = requests.get(f'{BASE}/assessments/{assess2_id}', headers=headers(assessor_token))
assess2_status = safe_json(r).get('status', '')
if assess2_status == 'awaiting-external-moderation':
    # Use separate institution user for external moderation (admin did internal, can't do both)
    r = requests.put(f'{BASE}/assessments/{assess2_id}/external-moderate', json={
        'decision': 'endorsed', 'comments': 'External: agree with rejection', 'qualityScore': 3
    }, headers=headers(ext_mod_token))
    test('#30 External moderation', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
else:
    print(f'  SKIP  External moderation (status: {assess2_status})')

# Check gap training recommendations
r = requests.get(f'{BASE}/assessments/{assess2_id}/gap-training', headers=headers(worker_token))
test('#30 Gap training available', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
gt = safe_json(r).get('gapTraining', [])
test('#30 Has gap areas', len(gt) >= 1, f'Gap areas: {len(gt)}')

# Enroll in gap training (first gap area)
if gt:
    r = requests.post(f'{BASE}/assessments/{assess2_id}/gap-training/0/enroll', headers=headers(assessor_token))
    test('#30 Enroll in gap training', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# Check re-assessment eligibility
r = requests.get(f'{BASE}/assessments/{assess2_id}/reassessment-eligibility', headers=headers(worker_token))
test('#30 Check eligibility', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
elig = safe_json(r)
test('#30 Eligible for reassessment', elig.get('eligible') == True, f'Eligible: {elig.get("eligible")}, Reason: {elig.get("reason")}')

# Request re-assessment
r = requests.post(f'{BASE}/assessments/{assess2_id}/request-reassessment', json={
    'reason': 'Completed gap training modules, ready for re-assessment'
}, headers=headers(worker_token))
test('#30 Request reassessment', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
ra = safe_json(r).get('reassessment', {})
test('#30 Reassessment requested', ra.get('status') == 'requested', f'Status: {ra.get("status")}')
test('#30 Has gap areas to reassess', len(ra.get('gapAreasToReassess', [])) >= 1, f'{r.text[:200]}')

# Reject duplicate request
r = requests.post(f'{BASE}/assessments/{assess2_id}/request-reassessment', json={
    'reason': 'Trying again'
}, headers=headers(worker_token))
test('#30 Reject duplicate request', r.status_code == 409, f'{r.status_code}: {r.text[:200]}')

# Approve re-assessment (creates new assessment)
r = requests.put(f'{BASE}/assessments/{assess2_id}/approve-reassessment', headers=headers(assessor_token))
test('#30 Approve reassessment', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
ar = safe_json(r)
test('#30 New assessment created', bool(ar.get('newAssessmentId')), f'{r.text[:200]}')
test('#30 Has gap areas', len(ar.get('gapAreas', [])) >= 1, f'{r.text[:200]}')

# ═══════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════
print('\n' + '=' * 60)
print(f'RPL Phase 2 Results: {passed} passed, {failed} failed out of {passed + failed}')
print('=' * 60)

if errors:
    print('\nFailures:')
    for e in errors:
        print(f'  - {e}')

sys.exit(1 if failed > 0 else 0)
