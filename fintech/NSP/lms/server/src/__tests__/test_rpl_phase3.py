"""
RPL Phase 3 Gap Implementation Tests
Tests 8 gaps: #13, #17, #14, #35, #36, #11, #27, #26

Run: python src/__tests__/test_rpl_phase3.py
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
print('RPL Phase 3 Gap Tests')
print('=' * 60)

# --- Setup: Register users ---
print('\n--- Setup: Create users ---')

ts = int(time.time())
admin_email = f'rpl3-admin-{ts}@test.com'
worker_email = f'rpl3-worker-{ts}@test.com'
assessor_email = f'rpl3-assessor-{ts}@test.com'
employer_email = f'rpl3-employer-{ts}@test.com'
ext_mod_email = f'rpl3-extmod-{ts}@test.com'

# Register institution (admin)
r = requests.post(f'{BASE}/auth/register', json={
    'name': 'RPL3 Admin', 'email': admin_email,
    'password': 'TestPass123!', 'role': 'institution', 'district': 'Peshawar'
})
test('Register institution', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
admin_token = r.json().get('accessToken', '') or r.json().get('token', '')
admin_id = r.json().get('user', {}).get('_id', '')

# Register worker (electrician trade)
r = requests.post(f'{BASE}/auth/register', json={
    'name': 'RPL3 Worker', 'email': worker_email,
    'password': 'TestPass123!', 'role': 'worker', 'district': 'Peshawar',
    'trade': 'electrician', 'cnic': '12345-7654321-2'
})
test('Register worker', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
worker_token = r.json().get('accessToken', '') or r.json().get('token', '')
worker_id = r.json().get('workerId', '')
worker_user_id = r.json().get('user', {}).get('_id', '')

# Register assessor
r = requests.post(f'{BASE}/auth/register', json={
    'name': 'RPL3 Assessor', 'email': assessor_email,
    'password': 'TestPass123!', 'role': 'assessor', 'district': 'Peshawar'
})
test('Register assessor', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
assessor_token = r.json().get('accessToken', '') or r.json().get('token', '')
assessor_id = r.json().get('user', {}).get('_id', '')

# Register employer
r = requests.post(f'{BASE}/auth/register', json={
    'name': 'RPL3 Employer', 'email': employer_email,
    'password': 'TestPass123!', 'role': 'employer', 'district': 'Dubai',
    'organization': 'Gulf Construction LLC'
})
test('Register employer', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
employer_token = r.json().get('accessToken', '') or r.json().get('token', '')

# Register external moderator (institution)
r = requests.post(f'{BASE}/auth/register', json={
    'name': 'RPL3 ExtMod', 'email': ext_mod_email,
    'password': 'TestPass123!', 'role': 'institution', 'district': 'Islamabad'
})
test('Register external moderator', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
ext_mod_token = r.json().get('accessToken', '') or r.json().get('token', '')

test('Worker profile auto-created', bool(worker_id), f'workerId: {worker_id}')

# Create RPL assessment (assessor creates it)
r = requests.post(f'{BASE}/assessments', json={
    'worker': worker_id,
    'type': 'rpl', 'trade': 'electrician', 'title': 'RPL Phase 3 Test'
}, headers=headers(assessor_token))
test('Create RPL assessment', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
assessment_id = r.json().get('_id', '')

# ═══════════════════════════════════════════════════════════
# GAP #13: Assessor Qualification Tracking
# ═══════════════════════════════════════════════════════════
print('\n--- Gap #13: Assessor Qualification Tracking ---')

# Add a qualification
r = requests.post(f'{BASE}/assessors/qualifications', json={
    'qualificationName': 'Certified Electrical Assessor Level 3',
    'issuingBody': 'NAVTTC Pakistan',
    'dateObtained': '2024-06-15',
    'expiryDate': '2027-06-15',
    'certificateNumber': 'CEA-2024-0001',
    'trade': 'electrician',
    'nqfLevel': 5,
}, headers=headers(assessor_token))
test('#13 Add assessor qualification', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
qual_data = safe_json(r)
test('#13 Qualification name correct', qual_data.get('qualification', {}).get('qualificationName') == 'Certified Electrical Assessor Level 3')

# Add a second qualification
r = requests.post(f'{BASE}/assessors/qualifications', json={
    'qualificationName': 'Master Trainer Certificate',
    'issuingBody': 'Skills for Employment Program',
    'dateObtained': '2023-01-10',
    'trade': 'electrician',
    'nqfLevel': 6,
}, headers=headers(assessor_token))
test('#13 Add second qualification', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')

# Get assessor profile
r = requests.get(f'{BASE}/assessors/profile', headers=headers(assessor_token))
test('#13 Get assessor profile', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
profile = safe_json(r)
test('#13 Has 2 qualifications', profile.get('qualifications', {}).get('total') == 2, f'Total: {profile.get("qualifications", {}).get("total")}')
test('#13 All active (no expired)', profile.get('qualifications', {}).get('active') == 2, f'Active: {profile.get("qualifications", {}).get("active")}')

# Verify a qualification (admin)
r = requests.put(f'{BASE}/assessors/qualifications/0/verify', json={
    'assessorId': assessor_id,
}, headers=headers(admin_token))
test('#13 Verify qualification', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
test('#13 Qualification marked verified', safe_json(r).get('qualification', {}).get('verified') == True)

# ═══════════════════════════════════════════════════════════
# GAP #17: Assessor CPD Tracking
# ═══════════════════════════════════════════════════════════
print('\n--- Gap #17: Assessor CPD Tracking ---')

# Add CPD record
r = requests.post(f'{BASE}/assessors/cpd', json={
    'title': 'Advanced Assessment Methodology Workshop',
    'provider': 'NAVTTC Training Center',
    'completedDate': '2026-02-01',
    'hours': 8,
    'category': 'assessment-methodology',
}, headers=headers(assessor_token))
test('#17 Add CPD record', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
cpd_data = safe_json(r)
test('#17 CPD hours tracked', cpd_data.get('cpdStatus', {}).get('hoursThisYear') == 8)

# Add more CPD hours
r = requests.post(f'{BASE}/assessors/cpd', json={
    'title': 'Electrical Safety Standards Update',
    'provider': 'Pakistan Engineering Council',
    'completedDate': '2026-01-15',
    'hours': 6,
    'category': 'trade-technical',
}, headers=headers(assessor_token))
test('#17 Add second CPD record', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
test('#17 Cumulative CPD hours', safe_json(r).get('cpdStatus', {}).get('hoursThisYear') == 14)

# Add more to reach compliance (need 20 total)
r = requests.post(f'{BASE}/assessors/cpd', json={
    'title': 'Quality Assurance in RPL Assessment',
    'provider': 'British Council Pakistan',
    'completedDate': '2026-02-20',
    'hours': 8,
    'category': 'quality-assurance',
}, headers=headers(assessor_token))
test('#17 Add third CPD record', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
cpd3 = safe_json(r)
test('#17 CPD now compliant (22 hours >= 20)', cpd3.get('cpdStatus', {}).get('compliant') == True, f'Hours: {cpd3.get("cpdStatus", {}).get("hoursThisYear")}')

# Verify a CPD record (admin)
r = requests.put(f'{BASE}/assessors/cpd/0/verify', json={
    'assessorId': assessor_id,
}, headers=headers(admin_token))
test('#17 Verify CPD record', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
test('#17 CPD record marked verified', safe_json(r).get('record', {}).get('verified') == True)

# Get CPD compliance status
r = requests.get(f'{BASE}/assessors/cpd-status', headers=headers(assessor_token))
test('#17 Get CPD status', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
cpd_status = safe_json(r)
test('#17 CPD compliant in status endpoint', cpd_status.get('compliant') == True)
test('#17 Has category breakdown', 'assessment-methodology' in cpd_status.get('byCategory', {}))
test('#17 Correct deficit (0)', cpd_status.get('deficit') == 0, f'Deficit: {cpd_status.get("deficit")}')

# ═══════════════════════════════════════════════════════════
# GAP #14: Assessor Minimum Experience Validation
# ═══════════════════════════════════════════════════════════
print('\n--- Gap #14: Assessor Minimum Experience Validation ---')

# Update assessor experience (admin sets it)
r = requests.put(f'{BASE}/assessors/experience', json={
    'assessorId': assessor_id,
    'yearsExperience': 5,
    'trades': ['electrician', 'welder'],
    'approvedDate': '2021-03-01',
    'seniorAssessor': False,
}, headers=headers(admin_token))
test('#14 Update assessor experience', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
exp_data = safe_json(r)
test('#14 Years set to 5', exp_data.get('experience', {}).get('yearsExperience') == 5)
test('#14 Trades set', 'electrician' in exp_data.get('experience', {}).get('trades', []))

# Get assessor experience summary
r = requests.get(f'{BASE}/assessors/experience', headers=headers(assessor_token))
test('#14 Get assessor experience', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
exp = safe_json(r)
test('#14 Has eligibility info', 'canAssessIndependently' in exp.get('eligibility', {}))
# New assessor with 0 actual assessments — cannot assess independently
test('#14 Cannot assess independently (< 10 assessments)', exp.get('eligibility', {}).get('canAssessIndependently') == False)

# Validate assessor for electrician trade
r = requests.get(f'{BASE}/assessors/validate/{assessor_id}/electrician', headers=headers(admin_token))
test('#14 Validate assessor for electrician', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
val = safe_json(r)
test('#14 Trade authorized', val.get('checks', {}).get('tradeAuthorized') == True)
test('#14 CPD compliant check', val.get('checks', {}).get('cpdCompliant') == True)
test('#14 Valid overall', val.get('valid') == True)

# Validate assessor for unauthorized trade
r = requests.get(f'{BASE}/assessors/validate/{assessor_id}/plumber', headers=headers(admin_token))
test('#14 Validate for unauthorized trade', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
val2 = safe_json(r)
test('#14 Trade NOT authorized for plumber', val2.get('checks', {}).get('tradeAuthorized') == False)
test('#14 Has warnings', len(val2.get('warnings', [])) > 0)

# List all assessors (admin)
r = requests.get(f'{BASE}/assessors/list', headers=headers(admin_token))
test('#14 List assessors', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
assessor_list = safe_json(r)
test('#14 Assessor list has entries', assessor_list.get('total', 0) >= 1)

# ═══════════════════════════════════════════════════════════
# GAP #11: Peer/Employer Witness Testimony
# ═══════════════════════════════════════════════════════════
print('\n--- Gap #11: Peer/Employer Witness Testimony ---')

# Worker submits a peer testimony
r = requests.post(f'{BASE}/assessments/{assessment_id}/witness-testimony', json={
    'witnessName': 'Ahmad Khan',
    'witnessRole': 'supervisor',
    'organization': 'KP Public Works Department',
    'contactEmail': 'ahmad.khan@test.com',
    'contactPhone': '+92-300-1234567',
    'relationship': 'Direct Supervisor (3 years)',
    'competencyAreas': ['Wiring Installation', 'Panel Installation', 'Safety Compliance'],
    'testimony': 'I have worked with this worker for 3 years. He is highly competent in electrical wiring, panel installation, and consistently follows safety protocols. He has independently completed multiple commercial wiring projects.',
    'yearsKnown': 3,
}, headers=headers(worker_token))
test('#11 Submit peer testimony', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
testimony1 = safe_json(r)
testimony1_id = testimony1.get('testimony', {}).get('_id', '')
test('#11 Testimony has witness name', testimony1.get('testimony', {}).get('witnessName') == 'Ahmad Khan')

# Worker submits an employer (Gulf) testimony
r = requests.post(f'{BASE}/assessments/{assessment_id}/witness-testimony', json={
    'witnessName': 'Mohammed Al-Rashid',
    'witnessRole': 'employer',
    'organization': 'Gulf Construction LLC',
    'contactEmail': 'rashid@gulfconst.ae',
    'relationship': 'Employer',
    'competencyAreas': ['Circuit Design', 'Testing & Measurement'],
    'testimony': 'This worker was employed at our Dubai project site for 2 years as a senior electrician. He demonstrated excellent skills in circuit design and electrical testing. His work consistently met UAE quality standards.',
    'yearsKnown': 2,
    'isGulfEmployer': True,
    'gulfCountry': 'UAE',
}, headers=headers(worker_token))
test('#11 Submit Gulf employer testimony', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
testimony2 = safe_json(r)
testimony2_id = testimony2.get('testimony', {}).get('_id', '')
test('#11 Gulf employer flag set', testimony2.get('testimony', {}).get('isGulfEmployer') == True)
test('#11 Total testimonies is 2', testimony2.get('totalTestimonies') == 2)

# Get all testimonies
r = requests.get(f'{BASE}/assessments/{assessment_id}/witness-testimonies', headers=headers(worker_token))
test('#11 Get witness testimonies', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
testimonies = safe_json(r)
test('#11 Has 2 testimonies', testimonies.get('total') == 2)
test('#11 None verified yet', testimonies.get('verified') == 0)

# Assessor verifies a testimony
r = requests.put(f'{BASE}/assessments/{assessment_id}/witness-testimony/{testimony1_id}/verify', json={
    'verificationMethod': 'phone',
    'verificationNotes': 'Called witness at provided number. Confirmed employment and competency claims.',
}, headers=headers(assessor_token))
test('#11 Verify testimony', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
verified_t = safe_json(r)
test('#11 Testimony now verified', verified_t.get('testimony', {}).get('verified') == True)
test('#11 Verification method recorded', verified_t.get('testimony', {}).get('verificationMethod') == 'phone')

# Check testimonies again — 1 verified
r = requests.get(f'{BASE}/assessments/{assessment_id}/witness-testimonies', headers=headers(assessor_token))
test('#11 1 of 2 verified', safe_json(r).get('verified') == 1)

# ═══════════════════════════════════════════════════════════
# GAP #27: Gulf Employer Verification Portal
# ═══════════════════════════════════════════════════════════
print('\n--- Gap #27: Gulf Employer Verification Portal ---')

# Request employer verification
r = requests.post(f'{BASE}/assessments/{assessment_id}/employer-verification/request', json={
    'employerName': 'Gulf Construction LLC',
    'employerCountry': 'UAE',
    'employerEmail': 'hr@gulfconst.ae',
}, headers=headers(assessor_token))
test('#27 Request employer verification', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
ev_data = safe_json(r)
test('#27 Verification status pending', ev_data.get('verificationStatus') == 'pending')

# Get employer verification status
r = requests.get(f'{BASE}/assessments/{assessment_id}/employer-verification', headers=headers(worker_token))
test('#27 Get verification status (worker)', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
ev_status = safe_json(r)
test('#27 Status is pending', ev_status.get('verificationStatus') == 'pending')
test('#27 Employer name correct', ev_status.get('employerName') == 'Gulf Construction LLC')

# Check employer verification queue
r = requests.get(f'{BASE}/assessments/employer-verification/queue', headers=headers(employer_token))
test('#27 Employer verification queue', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
queue = safe_json(r)
test('#27 Queue has pending item', queue.get('total', 0) >= 1)

# Employer verifies (employer role)
r = requests.put(f'{BASE}/assessments/{assessment_id}/employer-verification/verify', json={
    'decision': 'verified',
    'notes': 'Employment records confirmed. Worker was employed from 2022-2024 as Senior Electrician.',
}, headers=headers(employer_token))
test('#27 Employer completes verification', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
test('#27 Verification status verified', safe_json(r).get('verificationStatus') == 'verified')

# Cannot verify again
r = requests.put(f'{BASE}/assessments/{assessment_id}/employer-verification/verify', json={
    'decision': 'verified',
}, headers=headers(employer_token))
test('#27 Cannot re-verify (idempotent check)', r.status_code == 409, f'{r.status_code}: {r.text[:200]}')

# Verify status after completion
r = requests.get(f'{BASE}/assessments/{assessment_id}/employer-verification', headers=headers(worker_token))
ev_final = safe_json(r)
test('#27 Final status is verified', ev_final.get('verificationStatus') == 'verified')

# ═══════════════════════════════════════════════════════════
# GAP #26: Multilingual RPL Forms (AR / UR / EN)
# ═══════════════════════════════════════════════════════════
print('\n--- Gap #26: Multilingual RPL Forms ---')

# Get available languages
r = requests.get(f'{BASE}/assessments/multilingual/forms', headers=headers(worker_token))
test('#26 Get available languages', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
langs = safe_json(r)
test('#26 Has 3 languages', len(langs.get('languages', [])) == 3)
test('#26 Default is English', langs.get('defaultLanguage') == 'en')

# Get English translations
r = requests.get(f'{BASE}/assessments/multilingual/forms/en', headers=headers(worker_token))
test('#26 Get English forms', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
en = safe_json(r)
test('#26 English direction is ltr', en.get('direction') == 'ltr')
test('#26 English has labels', 'fullName' in en.get('translations', {}).get('labels', {}))
test('#26 English has stages', 'preScreening' in en.get('translations', {}).get('stages', {}))
test('#26 English has instructions', 'consent' in en.get('translations', {}).get('instructions', {}))

# Get Urdu translations
r = requests.get(f'{BASE}/assessments/multilingual/forms/ur', headers=headers(worker_token))
test('#26 Get Urdu forms', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
ur = safe_json(r)
test('#26 Urdu direction is rtl', ur.get('direction') == 'rtl')
test('#26 Urdu has form title', bool(ur.get('translations', {}).get('formTitle')))
test('#26 Urdu labels translated', ur.get('translations', {}).get('labels', {}).get('fullName') != 'Full Name')

# Get Arabic translations
r = requests.get(f'{BASE}/assessments/multilingual/forms/ar', headers=headers(worker_token))
test('#26 Get Arabic forms', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
ar = safe_json(r)
test('#26 Arabic direction is rtl', ar.get('direction') == 'rtl')
test('#26 Arabic has form title', bool(ar.get('translations', {}).get('formTitle')))
test('#26 Arabic labels translated', ar.get('translations', {}).get('labels', {}).get('fullName') != 'Full Name')

# Invalid language returns error
r = requests.get(f'{BASE}/assessments/multilingual/forms/de', headers=headers(worker_token))
test('#26 Invalid language rejected', r.status_code == 422 or r.status_code == 400, f'{r.status_code}: {r.text[:200]}')

# Set assessment language preference
r = requests.put(f'{BASE}/assessments/{assessment_id}/language', json={
    'language': 'ur',
}, headers=headers(worker_token))
test('#26 Set assessment language to Urdu', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
lang_resp = safe_json(r)
test('#26 Language confirmed as ur', lang_resp.get('language') == 'ur')
test('#26 Direction is rtl', lang_resp.get('direction') == 'rtl')

# Change to Arabic
r = requests.put(f'{BASE}/assessments/{assessment_id}/language', json={
    'language': 'ar',
}, headers=headers(worker_token))
test('#26 Change language to Arabic', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# Change back to English
r = requests.put(f'{BASE}/assessments/{assessment_id}/language', json={
    'language': 'en',
}, headers=headers(worker_token))
test('#26 Change language back to English', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# ═══════════════════════════════════════════════════════════
# GAP #35: RPL Analytics Dashboard
# ═══════════════════════════════════════════════════════════
print('\n--- Gap #35: RPL Analytics Dashboard ---')

# Get RPL dashboard
r = requests.get(f'{BASE}/analytics/rpl-dashboard', headers=headers(admin_token))
test('#35 Get RPL dashboard', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
dash = safe_json(r)
test('#35 Has overview', 'total' in dash.get('overview', {}))
test('#35 Has byTrade', isinstance(dash.get('byTrade'), list))
test('#35 Has byTier', isinstance(dash.get('byTier'), dict))
test('#35 Has challenge exam stats', 'total' in dash.get('challengeExam', {}))
test('#35 Has monthly trend', isinstance(dash.get('monthlyTrend'), list))
test('#35 Has witness testimony stats', 'total' in dash.get('witnessTestimonies', {}))
test('#35 Total RPL assessments >= 1', dash.get('overview', {}).get('total', 0) >= 1)

# Get assessor performance analytics
r = requests.get(f'{BASE}/analytics/rpl-assessor-performance', headers=headers(admin_token))
test('#35 Get assessor performance', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
perf = safe_json(r)
test('#35 Has assessors list', isinstance(perf.get('assessors'), list))

# ═══════════════════════════════════════════════════════════
# GAP #36: RPL Pipeline / Funnel Visualization
# ═══════════════════════════════════════════════════════════
print('\n--- Gap #36: RPL Pipeline / Funnel ---')

# Get RPL pipeline
r = requests.get(f'{BASE}/analytics/rpl-pipeline', headers=headers(admin_token))
test('#36 Get RPL pipeline', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
pipe = safe_json(r)
test('#36 Has funnel stages', isinstance(pipe.get('funnel'), list))
test('#36 Has dropoffs', isinstance(pipe.get('dropoffs'), list))
test('#36 Has current status', isinstance(pipe.get('currentStatus'), dict))
test('#36 Has by trade', isinstance(pipe.get('byTrade'), list))
test('#36 Total matches', pipe.get('total', 0) >= 1)

# Funnel has correct stages
funnel_stages = [s['stage'] for s in pipe.get('funnel', [])]
test('#36 Funnel has Created stage', 'Created' in funnel_stages)
test('#36 Funnel has Pre-Screening', 'Pre-Screening' in funnel_stages)
test('#36 Funnel has Approved', 'Approved' in funnel_stages)
test('#36 Funnel has >=10 stages', len(funnel_stages) >= 10, f'Stages: {len(funnel_stages)}')

# Filter pipeline by trade
r = requests.get(f'{BASE}/analytics/rpl-pipeline?trade=electrician', headers=headers(admin_token))
test('#36 Pipeline filtered by trade', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
pipe_filtered = safe_json(r)
test('#36 Filtered results exist', pipe_filtered.get('total', 0) >= 1)

# ═══════════════════════════════════════════════════════════
# E2E: Full RPL flow with Phase 3 features
# ═══════════════════════════════════════════════════════════
print('\n--- E2E: Full RPL flow with Phase 3 features ---')

# Create a second assessment for E2E flow
r = requests.post(f'{BASE}/assessments', json={
    'worker': worker_id,
    'type': 'rpl', 'trade': 'electrician', 'title': 'RPL Phase 3 E2E'
}, headers=headers(assessor_token))
test('E2E Create assessment', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
e2e_id = r.json().get('_id', '')

# Set language preference before starting
r = requests.put(f'{BASE}/assessments/{e2e_id}/language', json={'language': 'ur'}, headers=headers(worker_token))
test('E2E Set Urdu language', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# Pre-screening
r = requests.put(f'{BASE}/assessments/{e2e_id}/pre-screening', json={
    'responses': [
        {'area': 'Wiring', 'question': 'Rate experience', 'selfRating': 5, 'yearsExperience': 5, 'hasEvidence': True},
        {'area': 'Safety', 'question': 'Rate experience', 'selfRating': 4, 'yearsExperience': 4, 'hasEvidence': True},
    ],
    'tradeExperience': {'totalYears': 5, 'formalTraining': True, 'currentlyEmployed': True}
}, headers=headers(worker_token))
test('E2E Pre-screening', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# Submit testimony from supervisor
r = requests.post(f'{BASE}/assessments/{e2e_id}/witness-testimony', json={
    'witnessName': 'Bilal Ahmad',
    'witnessRole': 'supervisor',
    'testimony': 'I supervised this worker for 4 years. He is excellent in all electrical work.',
    'competencyAreas': ['Wiring', 'Safety'],
    'yearsKnown': 4,
}, headers=headers(worker_token))
test('E2E Submit witness testimony', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')

# Request employer verification
r = requests.post(f'{BASE}/assessments/{e2e_id}/employer-verification/request', json={
    'employerName': 'KP Electric Corp',
    'employerCountry': 'Pakistan',
    'employerEmail': 'hr@kpelectric.pk',
}, headers=headers(assessor_token))
test('E2E Request employer verification', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# Upload evidence documents (need >=2 with experience-letter or trade-certificate)
files = [
    ('documents', ('exp-letter.pdf', b'%PDF-1.4 fake exp letter', 'application/pdf')),
    ('documents', ('trade-cert.pdf', b'%PDF-1.4 fake trade cert', 'application/pdf')),
]
r = requests.post(f'{BASE}/assessments/{e2e_id}/evidence',
    files=files,
    data={'categories': ['experience-letter', 'trade-certificate']},
    headers={'Authorization': f'Bearer {worker_token}'},
)
test('E2E Upload evidence', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# Document review
r = requests.put(f'{BASE}/assessments/{e2e_id}/document-review', json={
    'feedback': 'Documents verified and authentic.'
}, headers=headers(assessor_token))
test('E2E Document review', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# Interview
r = requests.put(f'{BASE}/assessments/{e2e_id}/interview', json={
    'items': [
        {'competencyArea': 'Wiring Installation', 'question': 'Describe your wiring experience', 'response': 'Detailed answer', 'score': 4},
        {'competencyArea': 'Safety & Grounding', 'question': 'Explain safety procedures', 'response': 'Comprehensive answer', 'score': 3},
    ],
    'overallNotes': 'Strong candidate with good practical knowledge.',
    'durationMinutes': 45,
}, headers=headers(assessor_token))
test('E2E Interview', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# Practical demo
r = requests.put(f'{BASE}/assessments/{e2e_id}/practical-demo', json={
    'rubric': [
        {'criterion': 'Wiring technique', 'score': 4, 'notes': 'Excellent'},
        {'criterion': 'Safety compliance', 'score': 3, 'notes': 'Good'},
        {'criterion': 'Tool handling', 'score': 4, 'notes': 'Very good'},
    ],
    'overallResult': 'pass',
    'location': 'NAVTTC Lab Peshawar',
}, headers=headers(assessor_token))
test('E2E Practical demo', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# Check assessment now has witness testimony + employer verification + language
r = requests.get(f'{BASE}/assessments/{e2e_id}', headers=headers(assessor_token))
a_detail = safe_json(r)
test('E2E Assessment has language field', a_detail.get('rpl', {}).get('language') == 'ur')
test('E2E Assessment has witness testimonies', len(a_detail.get('rpl', {}).get('witnessTestimonies', [])) >= 1)
test('E2E Assessment has employer verification', a_detail.get('rpl', {}).get('employerVerification', {}).get('requested') == True)

# Verify RPL dashboard reflects new data
r = requests.get(f'{BASE}/analytics/rpl-dashboard', headers=headers(admin_token))
dash2 = safe_json(r)
test('E2E Dashboard total >= 2 RPL assessments', dash2.get('overview', {}).get('total', 0) >= 2)

# Check pipeline shows funnel
r = requests.get(f'{BASE}/analytics/rpl-pipeline', headers=headers(admin_token))
pipe2 = safe_json(r)
test('E2E Pipeline total >= 2', pipe2.get('total', 0) >= 2)

# ═══════════════════════════════════════════════════════════
# Results
# ═══════════════════════════════════════════════════════════
print('\n' + '=' * 60)
if failed == 0:
    print(f'RPL Phase 3 Results: {passed} passed, {failed} failed out of {passed + failed}')
else:
    print(f'RPL Phase 3 Results: {passed} passed, {failed} FAILED out of {passed + failed}')
    print('\nFailed tests:')
    for e in errors:
        print(f'  FAIL: {e}')
print('=' * 60)

sys.exit(0 if failed == 0 else 1)
