"""
RPL Phase 4 Gap Implementation Tests
Tests 7 gaps: #8, #18, #19, #20, #24, #25, #31

Run: python src/__tests__/test_rpl_phase4.py
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
        print(f'  FAIL  {name} -- {detail}')

def headers(token):
    return {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}

def safe_json(r, default=None):
    try:
        return r.json()
    except:
        return default or {}

print('=' * 60)
print('RPL Phase 4 Gap Tests')
print('=' * 60)

# --- Setup: Register users ---
print('\n--- Setup: Create users ---')

ts = int(time.time())
admin_email = f'rpl4-admin-{ts}@test.com'
worker_email = f'rpl4-worker-{ts}@test.com'
assessor_email = f'rpl4-assessor-{ts}@test.com'
employer_email = f'rpl4-employer-{ts}@test.com'

# Register institution (admin)
r = requests.post(f'{BASE}/auth/register', json={
    'name': 'RPL4 Admin', 'email': admin_email,
    'password': 'TestPass123!', 'role': 'institution', 'district': 'Peshawar'
})
test('Register institution', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
admin_token = r.json().get('accessToken', '') or r.json().get('token', '')
admin_id = r.json().get('user', {}).get('_id', '')

# Register worker (electrician trade)
r = requests.post(f'{BASE}/auth/register', json={
    'name': 'RPL4 Worker', 'email': worker_email,
    'password': 'TestPass123!', 'role': 'worker', 'district': 'Peshawar',
    'trade': 'electrician', 'cnic': '12345-1234567-3'
})
test('Register worker', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
worker_token = r.json().get('accessToken', '') or r.json().get('token', '')
worker_id = r.json().get('workerId', '')
worker_user_id = r.json().get('user', {}).get('_id', '')

# Register assessor
r = requests.post(f'{BASE}/auth/register', json={
    'name': 'RPL4 Assessor', 'email': assessor_email,
    'password': 'TestPass123!', 'role': 'assessor', 'district': 'Peshawar'
})
test('Register assessor', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
assessor_token = r.json().get('accessToken', '') or r.json().get('token', '')
assessor_id = r.json().get('user', {}).get('_id', '')

# Register employer
r = requests.post(f'{BASE}/auth/register', json={
    'name': 'RPL4 Employer', 'email': employer_email,
    'password': 'TestPass123!', 'role': 'employer', 'district': 'Dubai',
    'organization': 'Gulf Engineering LLC'
})
test('Register employer', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
employer_token = r.json().get('accessToken', '') or r.json().get('token', '')

test('Worker profile auto-created', bool(worker_id), f'workerId: {worker_id}')

# Create RPL assessment (assessor creates it)
r = requests.post(f'{BASE}/assessments', json={
    'worker': worker_id,
    'type': 'rpl', 'trade': 'electrician', 'title': 'RPL Phase 4 Test'
}, headers=headers(assessor_token))
test('Create RPL assessment', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
assessment_id = r.json().get('_id', '')

# ===================================================================
# GAP #8: Workplace Observation
# ===================================================================
print('\n--- Gap #8: Workplace Observation ---')

# Record workplace observation
r = requests.put(f'{BASE}/assessments/{assessment_id}/workplace-observation', json={
    'site': 'Pakistan Electrical Training Center',
    'siteAddress': '45 Industrial Area, Peshawar',
    'supervisorName': 'Haji Karim',
    'supervisorContact': '+92-300-1234567',
    'durationMinutes': 120,
    'tasksObserved': ['Wiring installation', 'Panel assembly', 'Safety check'],
    'rubric': [
        {'criterion': 'Wiring Standards', 'description': 'Proper wiring per IEC', 'score': 4, 'notes': 'Excellent'},
        {'criterion': 'Safety Compliance', 'description': 'PPE and safety protocols', 'score': 3, 'notes': 'Good'},
        {'criterion': 'Tool Usage', 'description': 'Correct tool selection', 'score': 4, 'notes': 'Very skilled'},
        {'criterion': 'Panel Installation', 'description': 'DB panel assembly', 'score': 3, 'notes': 'Competent'},
    ],
    'overallResult': 'pass',
    'safetyCompliance': True,
    'environmentalConditions': 'Indoor workshop, well lit',
    'assessorNotes': 'Worker demonstrated strong electrical skills',
}, headers=headers(assessor_token))
test('Record workplace observation', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
obs_data = safe_json(r)
test('Observation has totalScore', 'workplaceObservation' in obs_data and obs_data['workplaceObservation'].get('totalScore', 0) > 0,
     f"score: {obs_data.get('workplaceObservation', {}).get('totalScore')}")
test('Observation rubric stored', len(obs_data.get('workplaceObservation', {}).get('rubric', [])) == 4,
     f"rubric len: {len(obs_data.get('workplaceObservation', {}).get('rubric', []))}")
test('Observation result is pass', obs_data.get('workplaceObservation', {}).get('overallResult') == 'pass',
     f"result: {obs_data.get('workplaceObservation', {}).get('overallResult')}")

# Get workplace observation
r = requests.get(f'{BASE}/assessments/{assessment_id}/workplace-observation', headers=headers(assessor_token))
test('Get workplace observation', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
get_obs = safe_json(r)
test('Observation completed flag', get_obs.get('completed') == True, f"completed: {get_obs.get('completed')}")
test('Observation site correct', get_obs.get('observation', {}).get('site') == 'Pakistan Electrical Training Center',
     f"site: {get_obs.get('observation', {}).get('site')}")
test('Observation safety compliance', get_obs.get('observation', {}).get('safetyCompliance') == True, '')

# Fail case: non-RPL assessment
r2 = requests.post(f'{BASE}/assessments', json={
    'worker': worker_id,
    'type': 'initial', 'trade': 'electrician', 'title': 'Non-RPL Test'
}, headers=headers(assessor_token))
non_rpl_id = r2.json().get('_id', '')

if non_rpl_id:
    r = requests.put(f'{BASE}/assessments/{non_rpl_id}/workplace-observation', json={
        'site': 'Test Site', 'rubric': [{'criterion': 'Test', 'score': 3}], 'overallResult': 'pass',
    }, headers=headers(assessor_token))
    test('Workplace observation rejects non-RPL', r.status_code == 400, f'{r.status_code}: {r.text[:200]}')

# Worker cannot record observation
r = requests.put(f'{BASE}/assessments/{assessment_id}/workplace-observation', json={
    'site': 'Fake', 'rubric': [{'criterion': 'X', 'score': 1}], 'overallResult': 'fail',
}, headers=headers(worker_token))
test('Worker cannot record observation', r.status_code == 403, f'{r.status_code}: {r.text[:200]}')

# ===================================================================
# GAP #24: Pre-departure RPL Assessment
# ===================================================================
print('\n--- Gap #24: Pre-departure RPL Assessment ---')

# Submit pre-departure assessment with partial readiness
r = requests.put(f'{BASE}/assessments/{assessment_id}/pre-departure', json={
    'targetCountry': 'UAE',
    'departureDate': '2026-06-15',
    'checklist': {
        'passportValid': True,
        'visaObtained': False,
        'medicalClearance': True,
        'tradeTestPassed': True,
        'safetyTrainingCompleted': True,
        'languageProficiency': 'basic',
        'culturalOrientationDone': True,
        'contractReviewed': False,
        'insuranceCoverage': True,
        'emergencyContactProvided': True,
        'beoeBriefingCompleted': False,
        'financialLiteracyTraining': True,
    },
    'notes': 'Worker needs visa and BEOE briefing',
}, headers=headers(assessor_token))
test('Submit pre-departure assessment', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
pd_data = safe_json(r).get('preDepartureAssessment', {})
test('Pre-departure readiness score computed', pd_data.get('readinessScore', 0) > 0,
     f"score: {pd_data.get('readinessScore')}")
test('Pre-departure not ready (missing items)', pd_data.get('ready') == False,
     f"ready: {pd_data.get('ready')}")
test('Pre-departure has blockers', len(pd_data.get('blockers', [])) > 0,
     f"blockers: {pd_data.get('blockers')}")
test('Pre-departure blocker includes visa', any('Visa' in b for b in pd_data.get('blockers', [])),
     f"blockers: {pd_data.get('blockers')}")
test('Pre-departure target country is UAE', pd_data.get('targetCountry') == 'UAE',
     f"country: {pd_data.get('targetCountry')}")

# Get pre-departure status
r = requests.get(f'{BASE}/assessments/{assessment_id}/pre-departure', headers=headers(assessor_token))
test('Get pre-departure status', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
get_pd = safe_json(r)
test('Pre-departure status has readinessScore', 'readinessScore' in get_pd,
     f"keys: {list(get_pd.keys())[:5]}")

# Update to full readiness
r = requests.put(f'{BASE}/assessments/{assessment_id}/pre-departure', json={
    'targetCountry': 'UAE',
    'checklist': {
        'passportValid': True,
        'visaObtained': True,
        'medicalClearance': True,
        'tradeTestPassed': True,
        'safetyTrainingCompleted': True,
        'languageProficiency': 'advanced',
        'culturalOrientationDone': True,
        'contractReviewed': True,
        'insuranceCoverage': True,
        'emergencyContactProvided': True,
        'beoeBriefingCompleted': True,
        'financialLiteracyTraining': True,
    },
}, headers=headers(assessor_token))
test('Update to full readiness', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
pd_full = safe_json(r).get('preDepartureAssessment', {})
test('Full readiness score is 100', pd_full.get('readinessScore') == 100,
     f"score: {pd_full.get('readinessScore')}")
test('Worker is departure-ready', pd_full.get('ready') == True,
     f"ready: {pd_full.get('ready')}")
test('No blockers when fully ready', len(pd_full.get('blockers', [])) == 0,
     f"blockers: {pd_full.get('blockers')}")

# Non-RPL rejection
if non_rpl_id:
    r = requests.put(f'{BASE}/assessments/{non_rpl_id}/pre-departure', json={
        'targetCountry': 'UAE', 'checklist': {'passportValid': True},
    }, headers=headers(assessor_token))
    test('Pre-departure rejects non-RPL', r.status_code == 400, f'{r.status_code}: {r.text[:200]}')

# ===================================================================
# GAP #31: RPL Scheduling / Booking
# ===================================================================
print('\n--- Gap #31: RPL Scheduling / Booking ---')

# Add a schedule slot for challenge exam
r = requests.post(f'{BASE}/assessments/{assessment_id}/schedule', json={
    'stage': 'challenge-exam',
    'scheduledDate': '2026-03-15T10:00:00Z',
    'venue': 'NAVTTC Peshawar Center',
    'venueAddress': '123 University Road, Peshawar',
    'notes': 'Written exam - 2 hours',
}, headers=headers(assessor_token))
test('Add schedule slot', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
slot_data = safe_json(r).get('slot', {})
slot_id = slot_data.get('_id', '')
test('Slot has _id', bool(slot_id), f'slotId: {slot_id}')
test('Slot stage is challenge-exam', slot_data.get('stage') == 'challenge-exam',
     f"stage: {slot_data.get('stage')}")
test('Slot status is scheduled', slot_data.get('status') == 'scheduled',
     f"status: {slot_data.get('status')}")

# Add a second slot for practical demo
r = requests.post(f'{BASE}/assessments/{assessment_id}/schedule', json={
    'stage': 'practical-demo',
    'scheduledDate': '2026-03-20T09:00:00Z',
    'venue': 'NAVTTC Workshop Peshawar',
    'venueAddress': '456 Industrial Area, Peshawar',
}, headers=headers(assessor_token))
test('Add second schedule slot', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
slot2_id = safe_json(r).get('slot', {}).get('_id', '')

# Add workplace observation slot
r = requests.post(f'{BASE}/assessments/{assessment_id}/schedule', json={
    'stage': 'workplace-observation',
    'scheduledDate': '2026-03-25T08:00:00Z',
    'venue': 'Construction Site Alpha',
}, headers=headers(assessor_token))
test('Add workplace-observation slot', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')

# Get schedule
r = requests.get(f'{BASE}/assessments/{assessment_id}/schedule', headers=headers(assessor_token))
test('Get assessment schedule', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
sched = safe_json(r)
test('Schedule has 3 slots', sched.get('total') == 3, f"total: {sched.get('total')}")
test('Schedule sorted by date', len(sched.get('schedule', [])) == 3, '')

# Confirm first slot
r = requests.put(f'{BASE}/assessments/{assessment_id}/schedule/{slot_id}', json={
    'status': 'confirmed',
}, headers=headers(assessor_token))
test('Confirm schedule slot', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
confirmed = safe_json(r).get('slot', {})
test('Slot confirmed has confirmedAt', bool(confirmed.get('confirmedAt')),
     f"confirmedAt: {confirmed.get('confirmedAt')}")

# Cancel second slot
r = requests.put(f'{BASE}/assessments/{assessment_id}/schedule/{slot2_id}', json={
    'status': 'cancelled', 'reason': 'Assessor unavailable',
}, headers=headers(assessor_token))
test('Cancel schedule slot', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
cancelled = safe_json(r).get('slot', {})
test('Cancelled slot has reason', cancelled.get('cancelledReason') == 'Assessor unavailable',
     f"reason: {cancelled.get('cancelledReason')}")

# Reschedule cancelled slot
r = requests.put(f'{BASE}/assessments/{assessment_id}/schedule/{slot2_id}', json={
    'status': 'rescheduled', 'newDate': '2026-03-22T09:00:00Z',
}, headers=headers(assessor_token))
test('Reschedule slot', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
rescheduled = safe_json(r).get('slot', {})
test('Rescheduled slot status is scheduled', rescheduled.get('status') == 'scheduled',
     f"status: {rescheduled.get('status')}")

# Worker cannot add schedule
r = requests.post(f'{BASE}/assessments/{assessment_id}/schedule', json={
    'stage': 'interview', 'scheduledDate': '2026-04-01T10:00:00Z', 'venue': 'Fake',
}, headers=headers(worker_token))
test('Worker cannot add schedule slots', r.status_code == 403, f'{r.status_code}: {r.text[:200]}')

# Non-RPL rejection
if non_rpl_id:
    r = requests.post(f'{BASE}/assessments/{non_rpl_id}/schedule', json={
        'stage': 'interview', 'scheduledDate': '2026-04-01T10:00:00Z', 'venue': 'Test',
    }, headers=headers(assessor_token))
    test('Scheduling rejects non-RPL', r.status_code == 400, f'{r.status_code}: {r.text[:200]}')

# ===================================================================
# GAP #25: MRA (Mutual Recognition Agreement) Support
# ===================================================================
print('\n--- Gap #25: MRA Support ---')

# List MRA frameworks
r = requests.get(f'{BASE}/assessments/mra/frameworks', headers=headers(assessor_token))
test('List MRA frameworks', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
mra_data = safe_json(r)
test('Has 4 MRA corridors', mra_data.get('total') == 4, f"total: {mra_data.get('total')}")
test('Frameworks include Pakistan-UAE', any(f['key'] == 'Pakistan-UAE' for f in mra_data.get('frameworks', [])),
     f"keys: {[f['key'] for f in mra_data.get('frameworks', [])]}")
test('Frameworks include Pakistan-KSA', any(f['key'] == 'Pakistan-KSA' for f in mra_data.get('frameworks', [])),
     '')
test('Frameworks include Pakistan-Qatar', any(f['key'] == 'Pakistan-Qatar' for f in mra_data.get('frameworks', [])),
     '')
test('Frameworks include Pakistan-Oman', any(f['key'] == 'Pakistan-Oman' for f in mra_data.get('frameworks', [])),
     '')

# Lookup MRA equivalency
r = requests.get(f'{BASE}/assessments/mra/lookup/Pakistan-UAE/NQF-2', headers=headers(assessor_token))
test('MRA lookup Pakistan-UAE NQF-2', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
lookup = safe_json(r)
test('MRA lookup targetLevel is MOHRE-Skilled', lookup.get('targetLevel') == 'MOHRE-Skilled',
     f"targetLevel: {lookup.get('targetLevel')}")
test('MRA lookup equivalency is full', lookup.get('equivalency') == 'full',
     f"equivalency: {lookup.get('equivalency')}")

# Lookup conditional mapping
r = requests.get(f'{BASE}/assessments/mra/lookup/Pakistan-UAE/NQF-4', headers=headers(assessor_token))
test('MRA lookup conditional mapping', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
cond = safe_json(r)
test('Conditional mapping has conditions', bool(cond.get('conditions')),
     f"conditions: {cond.get('conditions')}")
test('Conditional equivalency', cond.get('equivalency') == 'conditional',
     f"eq: {cond.get('equivalency')}")

# Lookup invalid corridor
r = requests.get(f'{BASE}/assessments/mra/lookup/Pakistan-Mars/NQF-1', headers=headers(assessor_token))
test('MRA invalid corridor returns 404', r.status_code == 404, f'{r.status_code}: {r.text[:200]}')

# Lookup invalid level
r = requests.get(f'{BASE}/assessments/mra/lookup/Pakistan-UAE/NQF-99', headers=headers(assessor_token))
test('MRA invalid level returns 404', r.status_code == 404, f'{r.status_code}: {r.text[:200]}')

# Apply MRA mapping to assessment
r = requests.put(f'{BASE}/assessments/{assessment_id}/mra', json={
    'corridor': 'Pakistan-UAE',
    'sourceLevel': 'NQF-2',
}, headers=headers(assessor_token))
test('Apply MRA mapping', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
applied = safe_json(r).get('mapping', {})
test('Applied mapping has targetCountry UAE', applied.get('targetCountry') == 'UAE',
     f"target: {applied.get('targetCountry')}")
test('Applied mapping targetLevel MOHRE-Skilled', applied.get('targetLevel') == 'MOHRE-Skilled',
     f"level: {applied.get('targetLevel')}")

# Duplicate MRA mapping rejected
r = requests.put(f'{BASE}/assessments/{assessment_id}/mra', json={
    'corridor': 'Pakistan-UAE',
    'sourceLevel': 'NQF-2',
}, headers=headers(assessor_token))
test('Duplicate MRA mapping rejected (409)', r.status_code == 409, f'{r.status_code}: {r.text[:200]}')

# Apply second corridor mapping
r = requests.put(f'{BASE}/assessments/{assessment_id}/mra', json={
    'corridor': 'Pakistan-KSA',
    'sourceLevel': 'NQF-2',
}, headers=headers(assessor_token))
test('Apply second MRA mapping (KSA)', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# Worker cannot apply MRA
r = requests.put(f'{BASE}/assessments/{assessment_id}/mra', json={
    'corridor': 'Pakistan-Qatar', 'sourceLevel': 'NQF-1',
}, headers=headers(worker_token))
test('Worker cannot apply MRA mapping', r.status_code == 403, f'{r.status_code}: {r.text[:200]}')

# ===================================================================
# GAP #20: AI-Assisted Evidence Analysis
# ===================================================================
print('\n--- Gap #20: AI-Assisted Evidence Analysis ---')

# First complete pre-screening (required before evidence upload)
r = requests.put(f'{BASE}/assessments/{assessment_id}/pre-screening', json={
    'responses': [
        {'area': 'Wiring Installation', 'selfRating': 4, 'hasEvidence': True, 'yearsExperience': 5},
        {'area': 'Circuit Design', 'selfRating': 3, 'hasEvidence': True, 'yearsExperience': 3},
        {'area': 'Safety', 'selfRating': 5, 'hasEvidence': True, 'yearsExperience': 5},
    ],
    'tradeExperience': {'totalYears': 5, 'formalTraining': True},
}, headers=headers(assessor_token))
test('Complete pre-screening for analysis', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# Now upload evidence documents
r = requests.post(
    f'{BASE}/assessments/{assessment_id}/evidence',
    headers={'Authorization': f'Bearer {assessor_token}'},
    files=[
        ('documents', ('exp-letter.pdf', b'%PDF-1.4 experience letter content', 'application/pdf')),
        ('documents', ('trade-cert.pdf', b'%PDF-1.4 trade certificate content', 'application/pdf')),
    ],
    data={'categories': ['experience-letter', 'trade-certificate']},
)
test('Upload evidence documents', r.status_code in [200, 201], f'{r.status_code}: {r.text[:200]}')

# Run evidence analysis
r = requests.post(f'{BASE}/assessments/{assessment_id}/evidence-analysis',
    headers=headers(assessor_token))
test('Run evidence analysis', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
analysis = safe_json(r).get('analysis', {})
test('Analysis has overallScore', 'overallScore' in analysis, f"keys: {list(analysis.keys())[:8]}")
test('Analysis has completeness', 'completeness' in analysis, '')
test('Analysis has sufficiency', 'sufficiency' in analysis, '')
test('Analysis has authenticity', 'authenticity' in analysis, '')
test('Analysis is analyzed', analysis.get('analyzed') == True, f"analyzed: {analysis.get('analyzed')}")
test('Analysis has gaps list', isinstance(analysis.get('gaps'), list), f"gaps type: {type(analysis.get('gaps'))}")
test('Analysis has strengths list', isinstance(analysis.get('strengths'), list), '')
test('Analysis has recommendations', isinstance(analysis.get('recommendations'), list), '')
test('Analysis overallScore is number', isinstance(analysis.get('overallScore'), (int, float)),
     f"score: {analysis.get('overallScore')}")
test('Analysis completeness > 0', analysis.get('completeness', 0) > 0,
     f"completeness: {analysis.get('completeness')}")

# Trade-specific checks for electrician
test('Analysis has tradeSpecificChecks', isinstance(analysis.get('tradeSpecificChecks'), list),
     f"checks: {analysis.get('tradeSpecificChecks')}")
if analysis.get('tradeSpecificChecks'):
    test('Trade checks have check/passed fields',
         all('check' in c and 'passed' in c for c in analysis['tradeSpecificChecks']),
         f"first check: {analysis['tradeSpecificChecks'][0] if analysis['tradeSpecificChecks'] else 'none'}")

# Get evidence analysis results
r = requests.get(f'{BASE}/assessments/{assessment_id}/evidence-analysis',
    headers=headers(assessor_token))
test('Get evidence analysis results', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
get_analysis = safe_json(r)
test('Stored analysis matches', get_analysis.get('analyzed') == True, '')
test('Stored analysis has overallScore', 'overallScore' in get_analysis,
     f"keys: {list(get_analysis.keys())[:5]}")

# Analysis on assessment without evidence
r2 = requests.post(f'{BASE}/assessments', json={
    'worker': worker_id,
    'type': 'rpl', 'trade': 'mason', 'title': 'Empty RPL Test'
}, headers=headers(assessor_token))
empty_id = r2.json().get('_id', '')

if empty_id:
    r = requests.post(f'{BASE}/assessments/{empty_id}/evidence-analysis',
        headers=headers(assessor_token))
    test('Analysis works on empty assessment', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
    empty_analysis = safe_json(r).get('analysis', {})
    test('Empty assessment has low score', empty_analysis.get('overallScore', 100) < 30,
         f"score: {empty_analysis.get('overallScore')}")
    test('Empty assessment has gaps', len(empty_analysis.get('gaps', [])) > 0,
         f"gaps: {len(empty_analysis.get('gaps', []))}")

# Worker cannot run analysis
r = requests.post(f'{BASE}/assessments/{assessment_id}/evidence-analysis',
    headers=headers(worker_token))
test('Worker cannot run evidence analysis', r.status_code == 403, f'{r.status_code}: {r.text[:200]}')

# ===================================================================
# GAP #18: Blockchain Anchoring
# ===================================================================
print('\n--- Gap #18: Blockchain Anchoring ---')

# First issue a credential to anchor
r = requests.post(f'{BASE}/credentials', json={
    'workerId': worker_id,
    'type': 'rpl-certificate',
    'title': 'RPL Electrician Level 2',
    'trade': 'electrician',
    'nqfLevel': 2,
    'institution': 'NAVTTC Peshawar',
}, headers=headers(admin_token))
test('Issue credential for blockchain test', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
credential_id = r.json().get('_id', '')
credential_id_str = r.json().get('credentialId', '')

# Anchor credential on blockchain
r = requests.post(f'{BASE}/credentials/{credential_id}/blockchain/anchor', json={
    'chain': 'simulated',
}, headers=headers(admin_token))
test('Anchor credential on blockchain', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
bc = safe_json(r).get('blockchain', {})
test('Blockchain has txHash', bool(bc.get('txHash')), f"txHash: {bc.get('txHash', '')[:20]}")
test('Blockchain txHash starts with 0x', bc.get('txHash', '').startswith('0x'),
     f"txHash: {bc.get('txHash', '')[:10]}")
test('Blockchain has contentHash', bool(bc.get('contentHash')),
     f"hash: {bc.get('contentHash', '')[:20]}")
test('Blockchain has merkleRoot', bool(bc.get('merkleRoot')),
     f"merkle: {bc.get('merkleRoot', '')[:20]}")
test('Blockchain anchored is True', bc.get('anchored') == True, '')
test('Blockchain chain is simulated', bc.get('chain') == 'simulated',
     f"chain: {bc.get('chain')}")
test('Blockchain has blockNumber', isinstance(bc.get('blockNumber'), (int, float)),
     f"block: {bc.get('blockNumber')}")
test('Blockchain verified is True', bc.get('verified') == True, '')

# Cannot anchor twice
r = requests.post(f'{BASE}/credentials/{credential_id}/blockchain/anchor', json={
    'chain': 'simulated',
}, headers=headers(admin_token))
test('Cannot anchor already-anchored credential', r.status_code == 400, f'{r.status_code}: {r.text[:200]}')

# Verify blockchain
r = requests.get(f'{BASE}/credentials/{credential_id}/blockchain/verify',
    headers=headers(admin_token))
test('Verify blockchain anchor', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
verify = safe_json(r)
test('Blockchain verification: verified', verify.get('verified') == True,
     f"verified: {verify.get('verified')}")
test('Blockchain verification: hashValid', verify.get('hashValid') == True,
     f"hashValid: {verify.get('hashValid')}")
test('Blockchain verification: merkleValid', verify.get('merkleValid') == True,
     f"merkleValid: {verify.get('merkleValid')}")
test('Verification returns chain info', verify.get('chain') == 'simulated',
     f"chain: {verify.get('chain')}")

# Get blockchain status
r = requests.get(f'{BASE}/credentials/{credential_id}/blockchain',
    headers=headers(admin_token))
test('Get blockchain status', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
bc_status = safe_json(r)
test('Blockchain status anchored', bc_status.get('blockchain', {}).get('anchored') == True, '')
test('Verification count > 0', bc_status.get('verificationCount', 0) > 0,
     f"count: {bc_status.get('verificationCount')}")

# Non-anchored credential verify returns 400
r2 = requests.post(f'{BASE}/credentials', json={
    'workerId': worker_id,
    'type': 'trade-certificate',
    'title': 'Plumber Basic',
    'trade': 'plumber',
    'nqfLevel': 1,
}, headers=headers(admin_token))
unanchored_id = r2.json().get('_id', '')
if unanchored_id:
    r = requests.get(f'{BASE}/credentials/{unanchored_id}/blockchain/verify',
        headers=headers(admin_token))
    test('Verify unanchored credential returns 400', r.status_code == 400,
         f'{r.status_code}: {r.text[:200]}')

# Worker cannot anchor
r = requests.post(f'{BASE}/credentials/{credential_id}/blockchain/anchor', json={},
    headers=headers(worker_token))
test('Worker cannot anchor credentials', r.status_code == 403, f'{r.status_code}: {r.text[:200]}')

# ===================================================================
# GAP #19: Digital Wallet / Portable Credentials
# ===================================================================
print('\n--- Gap #19: Digital Wallet ---')

# Generate wallet credential
r = requests.post(f'{BASE}/credentials/{credential_id}/wallet/generate', json={
    'expiresInDays': 60,
}, headers=headers(admin_token))
test('Generate wallet credential', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
wallet = safe_json(r).get('wallet', {})
test('Wallet has jwtToken', bool(wallet.get('jwtToken')),
     f"jwt len: {len(wallet.get('jwtToken', ''))}")
test('Wallet JWT has 3 parts', len(wallet.get('jwtToken', '').split('.')) == 3,
     f"parts: {len(wallet.get('jwtToken', '').split('.'))}")
test('Wallet has qrCodeUrl', bool(wallet.get('qrCodeUrl')),
     f"qr: {str(wallet.get('qrCodeUrl'))[:30]}")
test('Wallet has shareableLink', bool(wallet.get('shareableLink')),
     f"link: {wallet.get('shareableLink', '')[:40]}")
test('Wallet has expiresAt', bool(wallet.get('expiresAt')), '')

# Get wallet credential
r = requests.get(f'{BASE}/credentials/{credential_id}/wallet',
    headers=headers(admin_token))
test('Get wallet credential', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
get_wallet = safe_json(r)
test('Wallet data matches', bool(get_wallet.get('wallet', {}).get('jwtToken')), '')
test('Wallet expired flag is False', get_wallet.get('expired') == False,
     f"expired: {get_wallet.get('expired')}")

# Share credential
r = requests.post(f'{BASE}/credentials/{credential_id}/wallet/share', json={
    'email': 'employer@gulf-construction.ae',
}, headers=headers(admin_token))
test('Share credential via email', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
share = safe_json(r)
test('Share returns link', bool(share.get('shareableLink')), '')
test('Total shares is 1', share.get('totalShares') == 1,
     f"shares: {share.get('totalShares')}")

# Share to another email
r = requests.post(f'{BASE}/credentials/{credential_id}/wallet/share', json={
    'email': 'hr@qatar-projects.qa',
}, headers=headers(admin_token))
test('Share credential to second email', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
test('Total shares is 2', safe_json(r).get('totalShares') == 2,
     f"shares: {safe_json(r).get('totalShares')}")

# Download wallet credential
r = requests.post(f'{BASE}/credentials/{credential_id}/wallet/download',
    headers=headers(admin_token))
test('Download wallet credential', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
dl = safe_json(r)
test('Download returns JWT', bool(dl.get('jwtToken')), '')
test('Download count is 1', dl.get('downloads') == 1,
     f"downloads: {dl.get('downloads')}")

# Download again to increment counter
r = requests.post(f'{BASE}/credentials/{credential_id}/wallet/download',
    headers=headers(admin_token))
test('Download counter increments', safe_json(r).get('downloads') == 2,
     f"downloads: {safe_json(r).get('downloads')}")

# Wallet not generated returns 404
if unanchored_id:
    r = requests.get(f'{BASE}/credentials/{unanchored_id}/wallet',
        headers=headers(admin_token))
    test('No wallet returns 404', r.status_code == 404, f'{r.status_code}: {r.text[:200]}')

# Credential MRA on credential model
r = requests.post(f'{BASE}/credentials/{credential_id}/mra', json={
    'country': 'UAE',
    'framework': 'MOHRE',
    'level': 'Skilled',
    'status': 'recognized',
}, headers=headers(admin_token))
test('Add MRA recognition to credential', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
cred_mra = safe_json(r).get('mra', {})
test('Credential MRA has recognizedIn', len(cred_mra.get('recognizedIn', [])) > 0,
     f"recognized: {len(cred_mra.get('recognizedIn', []))}")

# Get MRA for credential
r = requests.get(f'{BASE}/credentials/{credential_id}/mra',
    headers=headers(admin_token))
test('Get credential MRA', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
test('MRA recognizedIn has entry', len(safe_json(r).get('mra', {}).get('recognizedIn', [])) > 0, '')

# Add second MRA recognition
r = requests.post(f'{BASE}/credentials/{credential_id}/mra', json={
    'country': 'Saudi Arabia',
    'framework': 'SVP',
    'level': 'Level-2',
}, headers=headers(admin_token))
test('Add second MRA recognition', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
test('Credential now has 2 MRA entries', len(safe_json(r).get('mra', {}).get('recognizedIn', [])) == 2,
     f"count: {len(safe_json(r).get('mra', {}).get('recognizedIn', []))}")

# ===================================================================
# E2E FLOW: Full Phase 4 Journey
# ===================================================================
print('\n--- E2E: Full Phase 4 Journey ---')

# Create fresh assessment
e2e_worker_email = f'rpl4-e2e-worker-{ts}@test.com'
r = requests.post(f'{BASE}/auth/register', json={
    'name': 'E2E Worker', 'email': e2e_worker_email,
    'password': 'TestPass123!', 'role': 'worker', 'district': 'Lahore',
    'trade': 'welder', 'cnic': '12345-9999999-4'
})
e2e_worker_token = r.json().get('accessToken', '') or r.json().get('token', '')
e2e_worker_id = r.json().get('workerId', '')

r = requests.post(f'{BASE}/assessments', json={
    'worker': e2e_worker_id,
    'type': 'rpl', 'trade': 'welder', 'title': 'E2E Phase 4 Welder RPL'
}, headers=headers(assessor_token))
e2e_assessment_id = r.json().get('_id', '')
test('E2E: Create welder RPL assessment', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')

# Step 1: Schedule all stages
r = requests.post(f'{BASE}/assessments/{e2e_assessment_id}/schedule', json={
    'stage': 'pre-screening',
    'scheduledDate': '2026-03-10T09:00:00Z',
    'venue': 'NAVTTC Lahore',
}, headers=headers(assessor_token))
test('E2E: Schedule pre-screening', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')

r = requests.post(f'{BASE}/assessments/{e2e_assessment_id}/schedule', json={
    'stage': 'workplace-observation',
    'scheduledDate': '2026-03-18T08:00:00Z',
    'venue': 'Welding Workshop Lahore',
}, headers=headers(assessor_token))
test('E2E: Schedule workplace observation', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')

# Step 2: Pre-screening (must be before evidence upload)
r = requests.put(f'{BASE}/assessments/{e2e_assessment_id}/pre-screening', json={
    'responses': [
        {'area': 'SMAW Welding', 'selfRating': 4, 'hasEvidence': True, 'yearsExperience': 5},
        {'area': 'Joint Preparation', 'selfRating': 4, 'hasEvidence': True, 'yearsExperience': 4},
        {'area': 'Safety Protocols', 'selfRating': 5, 'hasEvidence': True, 'yearsExperience': 5},
    ],
    'tradeExperience': {'totalYears': 5, 'formalTraining': True},
}, headers=headers(assessor_token))
test('E2E: Complete pre-screening', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# Step 3: Upload evidence
r = requests.post(
    f'{BASE}/assessments/{e2e_assessment_id}/evidence',
    headers={'Authorization': f'Bearer {assessor_token}'},
    files=[
        ('documents', ('welding-cert.pdf', b'%PDF-1.4 AWS welding certificate', 'application/pdf')),
        ('documents', ('exp-letter.pdf', b'%PDF-1.4 5 years welding experience', 'application/pdf')),
        ('documents', ('ref-letter.pdf', b'%PDF-1.4 reference from foreman', 'application/pdf')),
    ],
    data={'categories': ['trade-certificate', 'experience-letter', 'reference-letter']},
)
test('E2E: Upload welder evidence', r.status_code in [200, 201], f'{r.status_code}: {r.text[:200]}')

# Step 4: Workplace observation
r = requests.put(f'{BASE}/assessments/{e2e_assessment_id}/workplace-observation', json={
    'site': 'Welding Workshop Lahore',
    'supervisorName': 'Master Irfan',
    'durationMinutes': 180,
    'tasksObserved': ['SMAW welding', 'Joint preparation', 'Weld inspection'],
    'rubric': [
        {'criterion': 'SMAW Technique', 'score': 4, 'notes': 'Excellent bead consistency'},
        {'criterion': 'Joint Prep', 'score': 3, 'notes': 'Good edge preparation'},
        {'criterion': 'Safety', 'score': 4, 'notes': 'Full PPE compliance'},
        {'criterion': 'Blueprint Reading', 'score': 3, 'notes': 'Reads welding symbols correctly'},
    ],
    'overallResult': 'pass',
    'safetyCompliance': True,
}, headers=headers(assessor_token))
test('E2E: Record workplace observation', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# Step 5: Evidence analysis
r = requests.post(f'{BASE}/assessments/{e2e_assessment_id}/evidence-analysis',
    headers=headers(assessor_token))
test('E2E: Run evidence analysis', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
e2e_analysis = safe_json(r).get('analysis', {})
test('E2E: Analysis score > 0', e2e_analysis.get('overallScore', 0) > 0,
     f"score: {e2e_analysis.get('overallScore')}")

# Step 6: MRA mapping
r = requests.put(f'{BASE}/assessments/{e2e_assessment_id}/mra', json={
    'corridor': 'Pakistan-KSA',
    'sourceLevel': 'NQF-2',
}, headers=headers(assessor_token))
test('E2E: Apply MRA mapping', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# Step 7: Pre-departure
r = requests.put(f'{BASE}/assessments/{e2e_assessment_id}/pre-departure', json={
    'targetCountry': 'Saudi Arabia',
    'departureDate': '2026-07-01',
    'checklist': {
        'passportValid': True, 'visaObtained': True, 'medicalClearance': True,
        'tradeTestPassed': True, 'safetyTrainingCompleted': True,
        'languageProficiency': 'intermediate', 'culturalOrientationDone': True,
        'contractReviewed': True, 'insuranceCoverage': True,
        'emergencyContactProvided': True, 'beoeBriefingCompleted': True,
        'financialLiteracyTraining': True,
    },
}, headers=headers(assessor_token))
test('E2E: Pre-departure assessment', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
e2e_pd = safe_json(r).get('preDepartureAssessment', {})
test('E2E: High readiness score', e2e_pd.get('readinessScore', 0) >= 90,
     f"score: {e2e_pd.get('readinessScore')}")

# Step 8: Issue credential, anchor on blockchain, add to wallet
r = requests.post(f'{BASE}/credentials', json={
    'workerId': e2e_worker_id,
    'type': 'rpl-certificate',
    'title': 'RPL Welder Level 2',
    'trade': 'welder',
    'nqfLevel': 2,
    'institution': 'NAVTTC Lahore',
}, headers=headers(admin_token))
test('E2E: Issue welder credential', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
e2e_cred_id = r.json().get('_id', '')

# Anchor on blockchain
r = requests.post(f'{BASE}/credentials/{e2e_cred_id}/blockchain/anchor', json={
    'chain': 'polygon',
}, headers=headers(admin_token))
test('E2E: Anchor on polygon', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
test('E2E: Chain is polygon', safe_json(r).get('blockchain', {}).get('chain') == 'polygon',
     f"chain: {safe_json(r).get('blockchain', {}).get('chain')}")

# Verify anchor
r = requests.get(f'{BASE}/credentials/{e2e_cred_id}/blockchain/verify',
    headers=headers(admin_token))
test('E2E: Verify blockchain', r.status_code == 200 and safe_json(r).get('verified') == True,
     f'{r.status_code}: verified={safe_json(r).get("verified")}')

# Generate wallet
r = requests.post(f'{BASE}/credentials/{e2e_cred_id}/wallet/generate', json={},
    headers=headers(admin_token))
test('E2E: Generate wallet credential', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# Share with employer
r = requests.post(f'{BASE}/credentials/{e2e_cred_id}/wallet/share', json={
    'email': 'hiring@ksa-construction.sa',
}, headers=headers(admin_token))
test('E2E: Share with KSA employer', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# Add MRA recognition
r = requests.post(f'{BASE}/credentials/{e2e_cred_id}/mra', json={
    'country': 'Saudi Arabia',
    'framework': 'SVP/TVTC',
    'level': 'SVP-Level-2',
    'status': 'recognized',
}, headers=headers(admin_token))
test('E2E: Add MRA recognition to credential', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# Final check: get full credential
r = requests.get(f'{BASE}/credentials/{e2e_cred_id}', headers=headers(admin_token))
test('E2E: Get final credential', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
final_cred = safe_json(r)
test('E2E: Credential has blockchain anchored', final_cred.get('blockchain', {}).get('anchored') == True, '')
test('E2E: Credential has wallet jwtToken', bool(final_cred.get('wallet', {}).get('jwtToken')), '')
test('E2E: Credential has MRA entries', len(final_cred.get('mra', {}).get('recognizedIn', [])) > 0, '')

# ===================================================================
# Summary
# ===================================================================
print('\n' + '=' * 60)
print(f'RPL Phase 4 Results: {passed} passed, {failed} failed, {passed + failed} total')
print('=' * 60)

if errors:
    print('\nFailed tests:')
    for e in errors:
        print(f'  FAIL: {e}')

sys.exit(0 if failed == 0 else 1)
