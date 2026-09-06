"""
RPL Phase 5 Gap Implementation Tests
Tests 6 gaps: #3, #4, #9, #12, #15, #16

Run: python src/__tests__/test_rpl_phase5.py
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
print('RPL Phase 5 Gap Tests')
print('=' * 60)

# --- Setup: Register users ---
print('\n--- Setup: Create users ---')

ts = int(time.time())
admin_email = f'rpl5-admin-{ts}@test.com'
worker_email = f'rpl5-worker-{ts}@test.com'
assessor_email = f'rpl5-assessor-{ts}@test.com'
assessor2_email = f'rpl5-assessor2-{ts}@test.com'
advisor_email = f'rpl5-advisor-{ts}@test.com'

# Register institution (admin)
r = requests.post(f'{BASE}/auth/register', json={
    'name': 'RPL5 Admin', 'email': admin_email,
    'password': 'TestPass123!', 'role': 'institution', 'district': 'Peshawar'
})
test('Register institution', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
admin_token = r.json().get('accessToken', '') or r.json().get('token', '')
admin_id = r.json().get('user', {}).get('_id', '')

# Register worker (electrician trade)
r = requests.post(f'{BASE}/auth/register', json={
    'name': 'RPL5 Worker', 'email': worker_email,
    'password': 'TestPass123!', 'role': 'worker', 'district': 'Peshawar',
    'trade': 'electrician', 'cnic': '12345-1234567-5'
})
test('Register worker', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
worker_token = r.json().get('accessToken', '') or r.json().get('token', '')
worker_id = r.json().get('workerId', '')
worker_user_id = r.json().get('user', {}).get('_id', '')

# Register assessor
r = requests.post(f'{BASE}/auth/register', json={
    'name': 'RPL5 Assessor', 'email': assessor_email,
    'password': 'TestPass123!', 'role': 'assessor', 'district': 'Peshawar'
})
test('Register assessor', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
assessor_token = r.json().get('accessToken', '') or r.json().get('token', '')
assessor_id = r.json().get('user', {}).get('_id', '')

# Register second assessor (for inter-rater)
r = requests.post(f'{BASE}/auth/register', json={
    'name': 'RPL5 Assessor2', 'email': assessor2_email,
    'password': 'TestPass123!', 'role': 'assessor', 'district': 'Lahore'
})
test('Register second assessor', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
assessor2_token = r.json().get('accessToken', '') or r.json().get('token', '')
assessor2_id = r.json().get('user', {}).get('_id', '')

# Register advisor user (institution role for permissions)
r = requests.post(f'{BASE}/auth/register', json={
    'name': 'RPL5 Advisor', 'email': advisor_email,
    'password': 'TestPass123!', 'role': 'institution', 'district': 'Islamabad'
})
test('Register advisor user', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
advisor_token = r.json().get('accessToken', '') or r.json().get('token', '')
advisor_id = r.json().get('user', {}).get('_id', '')

test('Worker profile auto-created', bool(worker_id), f'workerId: {worker_id}')

# Create RPL assessment (assessor creates it)
r = requests.post(f'{BASE}/assessments', json={
    'worker': worker_id,
    'type': 'rpl', 'trade': 'electrician', 'title': 'RPL Phase 5 Test'
}, headers=headers(assessor_token))
test('Create RPL assessment', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
assessment_id = r.json().get('_id', '')

# Create non-RPL assessment for rejection tests
r2 = requests.post(f'{BASE}/assessments', json={
    'worker': worker_id,
    'type': 'initial', 'trade': 'electrician', 'title': 'Non-RPL Test'
}, headers=headers(assessor_token))
non_rpl_id = r2.json().get('_id', '')

# ===================================================================
# GAP #3: Portfolio Development Templates
# ===================================================================
print('\n--- Gap #3: Portfolio Development Templates ---')

# List all available templates
r = requests.get(f'{BASE}/assessments/portfolio-templates', headers=headers(assessor_token))
test('List portfolio templates', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
tpl_data = safe_json(r)
test('Has 3 trade templates', tpl_data.get('total') == 3, f"total: {tpl_data.get('total')}")
test('Default available', tpl_data.get('defaultAvailable') == True, '')
test('Templates list has entries', len(tpl_data.get('templates', [])) == 3,
     f"templates: {len(tpl_data.get('templates', []))}")

# Get template by trade
r = requests.get(f'{BASE}/assessments/portfolio-templates?trade=electrician', headers=headers(assessor_token))
test('Get electrician template', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
elec_tpl = safe_json(r).get('template', {})
test('Electrician template ID', elec_tpl.get('templateId') == 'TPL-ELEC-01',
     f"id: {elec_tpl.get('templateId')}")
test('Electrician template has 8 sections', len(elec_tpl.get('sections', [])) == 8,
     f"sections: {len(elec_tpl.get('sections', []))}")

# Get welder template
r = requests.get(f'{BASE}/assessments/portfolio-templates?trade=welder', headers=headers(assessor_token))
test('Get welder template', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
test('Welder template ID is TPL-WELD-01',
     safe_json(r).get('template', {}).get('templateId') == 'TPL-WELD-01', '')

# Apply portfolio template to assessment
r = requests.post(f'{BASE}/assessments/{assessment_id}/portfolio-template', headers=headers(assessor_token))
test('Apply portfolio template', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
applied = safe_json(r)
test('Template applied message', 'Portfolio template applied' in applied.get('message', ''),
     f"msg: {applied.get('message')}")
pt = applied.get('portfolioTemplate', {})
test('Applied template has sections', len(pt.get('sections', [])) == 8,
     f"sections: {len(pt.get('sections', []))}")
test('Initial progress is 0', pt.get('progress') == 0, f"progress: {pt.get('progress')}")
test('Template has startedAt', bool(pt.get('startedAt')), '')

# Update a section (mark personal as completed)
# Note: evidenceLinks in schema is [Number] (indices into documentaryEvidence array), not URLs
r = requests.put(f'{BASE}/assessments/{assessment_id}/portfolio-template/personal', json={
    'completed': True,
    'evidenceLinks': [0, 1],
    'notes': 'Trade summary and personal info submitted',
}, headers=headers(assessor_token))
test('Update personal section', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
section = safe_json(r)
test('Section marked completed', section.get('section', {}).get('completed') == True,
     f"completed: {section.get('section', {}).get('completed')}")
test('Section has evidence links', len(section.get('section', {}).get('evidenceLinks', [])) == 2,
     f"links: {len(section.get('section', {}).get('evidenceLinks', []))}")
test('Progress updated (>0)', section.get('progress', 0) > 0, f"progress: {section.get('progress')}")

# Update more sections
for sid in ['qualifications', 'experience-letters', 'reference-letters', 'safety']:
    r = requests.put(f'{BASE}/assessments/{assessment_id}/portfolio-template/{sid}', json={
        'completed': True,
        'notes': f'{sid} section completed',
    }, headers=headers(assessor_token))
test('Complete required sections', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# Get portfolio template progress
r = requests.get(f'{BASE}/assessments/{assessment_id}/portfolio-template', headers=headers(assessor_token))
test('Get portfolio progress', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
prog = safe_json(r)
test('Portfolio applied is true', prog.get('applied') == True, f"applied: {prog.get('applied')}")
test('Has requiredComplete count', prog.get('requiredComplete', 0) == 5,
     f"requiredComplete: {prog.get('requiredComplete')}")
test('All required done', prog.get('allRequiredDone') == True,
     f"allRequiredDone: {prog.get('allRequiredDone')}")
test('Progress >= 50%', prog.get('progress', 0) >= 50, f"progress: {prog.get('progress')}")

# Update non-existent section
r = requests.put(f'{BASE}/assessments/{assessment_id}/portfolio-template/nonexistent', json={
    'completed': True,
}, headers=headers(assessor_token))
test('Non-existent section returns 404', r.status_code == 404, f'{r.status_code}: {r.text[:200]}')

# Portfolio rejects non-RPL
if non_rpl_id:
    r = requests.post(f'{BASE}/assessments/{non_rpl_id}/portfolio-template', headers=headers(assessor_token))
    test('Portfolio rejects non-RPL', r.status_code == 400, f'{r.status_code}: {r.text[:200]}')

# ===================================================================
# GAP #4: RPL Advisor / Facilitator Role
# ===================================================================
print('\n--- Gap #4: RPL Advisor / Facilitator Role ---')

# Assign an advisor (admin only)
r = requests.post(f'{BASE}/assessments/{assessment_id}/advisor', json={
    'advisorId': advisor_id,
}, headers=headers(admin_token))
test('Assign RPL advisor', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
adv = safe_json(r)
test('Advisor assigned message', 'advisor assigned' in adv.get('message', '').lower(),
     f"msg: {adv.get('message')}")
test('Advisor has _id', bool(adv.get('advisor', {}).get('_id')), '')
test('Advisor status is assigned', adv.get('advisor', {}).get('status') == 'assigned',
     f"status: {adv.get('advisor', {}).get('status')}")

# Get advisor details
r = requests.get(f'{BASE}/assessments/{assessment_id}/advisor', headers=headers(assessor_token))
test('Get advisor details', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
adv_get = safe_json(r)
test('Advisor is assigned', adv_get.get('assigned') == True, f"assigned: {adv_get.get('assigned')}")

# Worker cannot assign advisor
r = requests.post(f'{BASE}/assessments/{assessment_id}/advisor', json={
    'advisorId': advisor_id,
}, headers=headers(worker_token))
test('Worker cannot assign advisor', r.status_code == 403, f'{r.status_code}: {r.text[:200]}')

# Assessor cannot assign advisor
r = requests.post(f'{BASE}/assessments/{assessment_id}/advisor', json={
    'advisorId': advisor_id,
}, headers=headers(assessor_token))
test('Assessor cannot assign advisor', r.status_code == 403, f'{r.status_code}: {r.text[:200]}')

# Add guidance note (as the advisor)
r = requests.post(f'{BASE}/assessments/{assessment_id}/advisor/guidance', json={
    'note': 'Start by gathering all your experience letters from previous employers. Focus on electrical work roles.',
}, headers=headers(advisor_token))
test('Add guidance note', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
gn = safe_json(r)
test('Total notes is 1', gn.get('totalNotes') == 1, f"total: {gn.get('totalNotes')}")
test('Note has content', bool(gn.get('note', {}).get('note')), '')

# Add second guidance note
r = requests.post(f'{BASE}/assessments/{assessment_id}/advisor/guidance', json={
    'note': 'Take photos of your electrical panel installations as work sample evidence.',
}, headers=headers(advisor_token))
test('Add second guidance note', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
test('Total notes is 2', safe_json(r).get('totalNotes') == 2,
     f"total: {safe_json(r).get('totalNotes')}")

# Worker cannot add guidance
r = requests.post(f'{BASE}/assessments/{assessment_id}/advisor/guidance', json={
    'note': 'Should not work',
}, headers=headers(worker_token))
test('Worker cannot add guidance', r.status_code == 403, f'{r.status_code}: {r.text[:200]}')

# Record a meeting
r = requests.put(f'{BASE}/assessments/{assessment_id}/advisor/meeting', json={
    'notes': 'Discussed portfolio structure and evidence requirements. Worker has 5 years experience.',
}, headers=headers(advisor_token))
test('Record advisor meeting', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
mtg = safe_json(r)
test('Meetings count is 1', mtg.get('meetingsCount') == 1, f"count: {mtg.get('meetingsCount')}")
test('Has lastMeetingAt', bool(mtg.get('lastMeetingAt')), '')

# Record second meeting
r = requests.put(f'{BASE}/assessments/{assessment_id}/advisor/meeting', json={
    'notes': 'Reviewed portfolio progress. Worker completing safety section next.',
}, headers=headers(advisor_token))
test('Record second meeting', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
test('Meetings count is 2', safe_json(r).get('meetingsCount') == 2,
     f"count: {safe_json(r).get('meetingsCount')}")

# Advisor rejects non-RPL
if non_rpl_id:
    r = requests.post(f'{BASE}/assessments/{non_rpl_id}/advisor', json={
        'advisorId': advisor_id,
    }, headers=headers(admin_token))
    test('Advisor rejects non-RPL', r.status_code == 400, f'{r.status_code}: {r.text[:200]}')

# Invalid advisor ID
r = requests.post(f'{BASE}/assessments/{assessment_id}/advisor', json={
    'advisorId': '000000000000000000000000',
}, headers=headers(admin_token))
test('Invalid advisor returns 404', r.status_code == 404, f'{r.status_code}: {r.text[:200]}')

# ===================================================================
# GAP #9: Simulation / Scenario-Based Assessment
# ===================================================================
print('\n--- Gap #9: Simulation / Scenario-Based Assessment ---')

# List all scenarios
r = requests.get(f'{BASE}/assessments/scenarios', headers=headers(assessor_token))
test('List all scenarios', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
sc_all = safe_json(r)
test('Has 3 trade scenario banks', sc_all.get('trades') == 3, f"trades: {sc_all.get('trades')}")

# List electrician scenarios
r = requests.get(f'{BASE}/assessments/scenarios?trade=electrician', headers=headers(assessor_token))
test('List electrician scenarios', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
sc_elec = safe_json(r)
test('Electrician has 2 scenarios', sc_elec.get('total') == 2, f"total: {sc_elec.get('total')}")
test('First scenario is ELEC-SC-01',
     sc_elec.get('scenarios', [{}])[0].get('scenarioId') == 'ELEC-SC-01', '')

# Start a scenario
r = requests.post(f'{BASE}/assessments/{assessment_id}/scenario', json={
    'scenarioId': 'ELEC-SC-01',
}, headers=headers(assessor_token))
test('Start scenario ELEC-SC-01', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
sc_started = safe_json(r).get('scenario', {})
test('Scenario has steps', len(sc_started.get('steps', [])) == 5,
     f"steps: {len(sc_started.get('steps', []))}")
test('Scenario has startedAt', bool(sc_started.get('startedAt')), '')
test('Passing score is 60', sc_started.get('passingScore') == 60,
     f"passingScore: {sc_started.get('passingScore')}")

# Cannot start duplicate scenario
r = requests.post(f'{BASE}/assessments/{assessment_id}/scenario', json={
    'scenarioId': 'ELEC-SC-01',
}, headers=headers(assessor_token))
test('Duplicate scenario rejected (409)', r.status_code == 409, f'{r.status_code}: {r.text[:200]}')

# Start second scenario
r = requests.post(f'{BASE}/assessments/{assessment_id}/scenario', json={
    'scenarioId': 'ELEC-SC-02',
}, headers=headers(assessor_token))
test('Start second scenario ELEC-SC-02', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')

# Submit responses for first scenario (passing: all 4s out of 4)
r = requests.put(f'{BASE}/assessments/{assessment_id}/scenario/ELEC-SC-01', json={
    'responses': [
        {'stepNumber': 1, 'response': 'Checked DB and found breaker 6 tripping', 'score': 4, 'notes': 'Correct'},
        {'stepNumber': 2, 'response': 'Isolated circuit, tested with multimeter, full PPE', 'score': 4, 'notes': 'Excellent'},
        {'stepNumber': 3, 'response': 'Found damaged cable insulation causing earth fault', 'score': 3, 'notes': 'Good'},
        {'stepNumber': 4, 'response': 'Replaced damaged section, re-terminated', 'score': 4, 'notes': 'Correct procedure'},
        {'stepNumber': 5, 'response': 'Insulation resistance test, continuity, and functional test', 'score': 4, 'notes': 'All tests performed'},
    ],
    'assessorNotes': 'Worker demonstrated strong diagnostic skills',
}, headers=headers(assessor_token))
test('Submit scenario responses', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
sc_result = safe_json(r).get('scenario', {})
test('Scenario overall score > 60', sc_result.get('overallScore', 0) > 60,
     f"score: {sc_result.get('overallScore')}")
test('Scenario passed', sc_result.get('passed') == True, f"passed: {sc_result.get('passed')}")

# Submit responses for second scenario (failing: low scores)
r = requests.put(f'{BASE}/assessments/{assessment_id}/scenario/ELEC-SC-02', json={
    'responses': [
        {'stepNumber': 1, 'response': 'Wore gloves', 'score': 1, 'notes': 'Incomplete safety measures'},
        {'stepNumber': 2, 'response': 'Put breakers in a row', 'score': 1, 'notes': 'No load balancing'},
        {'stepNumber': 3, 'response': 'Used 32A breaker', 'score': 1, 'notes': 'No calculation shown'},
        {'stepNumber': 4, 'response': 'Connected earth wire', 'score': 1, 'notes': 'Incomplete understanding'},
    ],
    'assessorNotes': 'Worker needs more training on three-phase systems',
}, headers=headers(assessor_token))
test('Submit failing scenario', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
sc_fail = safe_json(r).get('scenario', {})
test('Failing scenario score < 60', sc_fail.get('overallScore', 100) < 60,
     f"score: {sc_fail.get('overallScore')}")
test('Failing scenario not passed', sc_fail.get('passed') == False, f"passed: {sc_fail.get('passed')}")

# Get all scenarios for assessment
r = requests.get(f'{BASE}/assessments/{assessment_id}/scenarios', headers=headers(assessor_token))
test('Get all assessment scenarios', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
all_sc = safe_json(r)
test('Has 2 scenarios', all_sc.get('total') == 2, f"total: {all_sc.get('total')}")
test('Stage not completed (one failed)', all_sc.get('stageCompleted') == False,
     f"stageCompleted: {all_sc.get('stageCompleted')}")

# Invalid scenario ID
r = requests.post(f'{BASE}/assessments/{assessment_id}/scenario', json={
    'scenarioId': 'FAKE-SC-99',
}, headers=headers(assessor_token))
test('Invalid scenario returns 404', r.status_code == 404, f'{r.status_code}: {r.text[:200]}')

# Worker cannot start scenario
r = requests.post(f'{BASE}/assessments/{assessment_id}/scenario', json={
    'scenarioId': 'ELEC-SC-01',
}, headers=headers(worker_token))
test('Worker cannot start scenario', r.status_code == 403, f'{r.status_code}: {r.text[:200]}')

# Scenario rejects non-RPL
if non_rpl_id:
    r = requests.post(f'{BASE}/assessments/{non_rpl_id}/scenario', json={
        'scenarioId': 'ELEC-SC-01',
    }, headers=headers(assessor_token))
    test('Scenario rejects non-RPL', r.status_code == 400, f'{r.status_code}: {r.text[:200]}')

# ===================================================================
# GAP #12: Competency Conversation
# ===================================================================
print('\n--- Gap #12: Competency Conversation ---')

# Record a competency conversation (passing)
r = requests.put(f'{BASE}/assessments/{assessment_id}/competency-conversation', json={
    'format': 'in-person',
    'durationMinutes': 45,
    'topics': [
        {
            'competencyArea': 'Wiring Standards',
            'questions': ['Describe IEC wiring colour codes', 'What is the ring circuit?'],
            'candidateSummary': 'Worker demonstrated strong knowledge of wiring standards',
            'evidenceReferenced': ['experience-letter', 'trade-certificate'],
            'rating': 4,
            'notes': 'Excellent understanding',
        },
        {
            'competencyArea': 'Safety Protocols',
            'questions': ['Describe LOTO procedure', 'When is a permit to work needed?'],
            'candidateSummary': 'Good understanding of safety protocols',
            'evidenceReferenced': ['safety-training-cert'],
            'rating': 3,
            'notes': 'Solid safety knowledge',
        },
        {
            'competencyArea': 'Panel Installation',
            'questions': ['How do you size a distribution board?', 'Describe earthing arrangements'],
            'candidateSummary': 'Competent in panel work',
            'evidenceReferenced': ['work-samples'],
            'rating': 3,
            'notes': 'Competent level',
        },
    ],
    'overallImpression': 'Worker is a competent electrician with 5 years of solid experience',
    'recordingUrl': 'https://storage.example.com/recordings/cc-001.mp3',
}, headers=headers(assessor_token))
test('Record competency conversation', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
cc = safe_json(r).get('competencyConversation', {})
test('CC has overallScore', cc.get('overallScore', 0) > 0, f"score: {cc.get('overallScore')}")
test('CC recommendation is competent or needs-further', cc.get('recommendation') in ['competent', 'needs-further-evidence'],
     f"rec: {cc.get('recommendation')}")
test('CC format is in-person', cc.get('format') == 'in-person', f"format: {cc.get('format')}")
test('CC has 3 topics', len(cc.get('topics', [])) == 3, f"topics: {len(cc.get('topics', []))}")
test('CC has recording URL', bool(cc.get('recordingUrl')), '')
test('CC has conductedAt', bool(cc.get('conductedAt')), '')
test('CC duration is 45', cc.get('durationMinutes') == 45,
     f"duration: {cc.get('durationMinutes')}")

# Get competency conversation
r = requests.get(f'{BASE}/assessments/{assessment_id}/competency-conversation', headers=headers(assessor_token))
test('Get competency conversation', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
get_cc = safe_json(r)
test('CC completed flag is True', get_cc.get('completed') == True,
     f"completed: {get_cc.get('completed')}")
test('CC conversation has topics', len(get_cc.get('conversation', {}).get('topics', [])) == 3, '')

# Worker cannot record CC
r = requests.put(f'{BASE}/assessments/{assessment_id}/competency-conversation', json={
    'topics': [{'competencyArea': 'Fake', 'rating': 4}],
}, headers=headers(worker_token))
test('Worker cannot record CC', r.status_code == 403, f'{r.status_code}: {r.text[:200]}')

# CC rejects non-RPL
if non_rpl_id:
    r = requests.put(f'{BASE}/assessments/{non_rpl_id}/competency-conversation', json={
        'topics': [{'competencyArea': 'Test', 'rating': 3}],
    }, headers=headers(assessor_token))
    test('CC rejects non-RPL', r.status_code == 400, f'{r.status_code}: {r.text[:200]}')

# Record a low-scoring conversation for another assessment
low_worker_email = f'rpl5-lowcc-{ts}@test.com'
r = requests.post(f'{BASE}/auth/register', json={
    'name': 'Low CC Worker', 'email': low_worker_email,
    'password': 'TestPass123!', 'role': 'worker', 'district': 'Quetta',
    'trade': 'mason', 'cnic': '12345-7777777-5'
})
low_worker_id = r.json().get('workerId', '')

if low_worker_id:
    r = requests.post(f'{BASE}/assessments', json={
        'worker': low_worker_id,
        'type': 'rpl', 'trade': 'mason', 'title': 'Low CC Test'
    }, headers=headers(assessor_token))
    low_assess_id = r.json().get('_id', '')

    r = requests.put(f'{BASE}/assessments/{low_assess_id}/competency-conversation', json={
        'format': 'video-call',
        'durationMinutes': 20,
        'topics': [
            {'competencyArea': 'Foundation Work', 'rating': 1, 'candidateSummary': 'Limited knowledge'},
            {'competencyArea': 'Wall Construction', 'rating': 1, 'candidateSummary': 'Basic only'},
        ],
    }, headers=headers(assessor_token))
    low_cc = safe_json(r).get('competencyConversation', {})
    test('Low-score CC recommendation is not-yet-competent', low_cc.get('recommendation') == 'not-yet-competent',
         f"rec: {low_cc.get('recommendation')}")
    test('Low-score CC stage not completed', low_cc.get('overallScore', 100) < 50,
         f"score: {low_cc.get('overallScore')}")

# ===================================================================
# GAP #16: Inter-Rater Reliability Checks
# ===================================================================
print('\n--- Gap #16: Inter-Rater Reliability Checks ---')

# Request inter-rater check (admin only)
r = requests.post(f'{BASE}/assessments/{assessment_id}/inter-rater', json={
    'secondAssessorId': assessor2_id,
}, headers=headers(admin_token))
test('Request inter-rater check', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
irc = safe_json(r).get('interRaterCheck', {})
test('IRC status is pending', irc.get('status') == 'pending', f"status: {irc.get('status')}")
test('IRC has second assessor name', bool(irc.get('secondAssessor', {}).get('name')),
     f"name: {irc.get('secondAssessor', {}).get('name')}")
test('IRC has requestedAt', bool(irc.get('requestedAt')), '')

# Duplicate request rejected
r = requests.post(f'{BASE}/assessments/{assessment_id}/inter-rater', json={
    'secondAssessorId': assessor2_id,
}, headers=headers(admin_token))
test('Duplicate IRC request rejected (409)', r.status_code == 409, f'{r.status_code}: {r.text[:200]}')

# Worker cannot request IRC
r = requests.post(f'{BASE}/assessments/{assessment_id}/inter-rater', json={
    'secondAssessorId': assessor2_id,
}, headers=headers(worker_token))
test('Worker cannot request IRC', r.status_code == 403, f'{r.status_code}: {r.text[:200]}')

# Submit second assessor scores (agreeing — within threshold)
r = requests.put(f'{BASE}/assessments/{assessment_id}/inter-rater', json={
    'interview': 70,
    'practicalDemo': 75,
    'evidenceQuality': 60,
    'overallDecision': 'approved',
    'notes': 'Worker demonstrates competence in electrical work',
}, headers=headers(assessor2_token))
test('Submit second assessor scores', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
irc_result = safe_json(r).get('interRaterCheck', {})
test('IRC has second scores', bool(irc_result.get('secondScores')),
     f"keys: {list(irc_result.get('secondScores', {}).keys())}")
test('IRC has agreement', bool(irc_result.get('agreement')),
     f"keys: {list(irc_result.get('agreement', {}).keys())}")
test('IRC has reliabilityScore', irc_result.get('agreement', {}).get('reliabilityScore') is not None,
     f"score: {irc_result.get('agreement', {}).get('reliabilityScore')}")

# Get inter-rater check status
r = requests.get(f'{BASE}/assessments/{assessment_id}/inter-rater', headers=headers(assessor_token))
test('Get IRC status', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
irc_get = safe_json(r)
test('IRC status is completed', irc_get.get('status') == 'completed',
     f"status: {irc_get.get('status')}")

# Cannot submit again after completion
r = requests.put(f'{BASE}/assessments/{assessment_id}/inter-rater', json={
    'interview': 80, 'practicalDemo': 80, 'evidenceQuality': 80, 'overallDecision': 'approved',
}, headers=headers(assessor2_token))
test('Cannot submit to completed IRC', r.status_code == 400, f'{r.status_code}: {r.text[:200]}')

# Same assessor rejection
r2_assess = requests.post(f'{BASE}/assessments', json={
    'worker': worker_id,
    'type': 'rpl', 'trade': 'electrician', 'title': 'Same Assessor Test'
}, headers=headers(assessor_token))
same_assess_id = r2_assess.json().get('_id', '')
if same_assess_id:
    r = requests.post(f'{BASE}/assessments/{same_assess_id}/inter-rater', json={
        'secondAssessorId': assessor_id,
    }, headers=headers(admin_token))
    test('Same assessor rejected', r.status_code == 400, f'{r.status_code}: {r.text[:200]}')

# IRC rejects non-RPL
if non_rpl_id:
    r = requests.post(f'{BASE}/assessments/{non_rpl_id}/inter-rater', json={
        'secondAssessorId': assessor2_id,
    }, headers=headers(admin_token))
    test('IRC rejects non-RPL', r.status_code == 400, f'{r.status_code}: {r.text[:200]}')

# Test resolution flow — create disagreement scenario
disagree_worker_email = f'rpl5-disagree-{ts}@test.com'
r = requests.post(f'{BASE}/auth/register', json={
    'name': 'Disagree Worker', 'email': disagree_worker_email,
    'password': 'TestPass123!', 'role': 'worker', 'district': 'Karachi',
    'trade': 'welder', 'cnic': '12345-8888888-5'
})
disagree_worker_id = r.json().get('workerId', '')

if disagree_worker_id:
    r = requests.post(f'{BASE}/assessments', json={
        'worker': disagree_worker_id,
        'type': 'rpl', 'trade': 'welder', 'title': 'Disagreement Test'
    }, headers=headers(assessor_token))
    disagree_id = r.json().get('_id', '')

    # Request IRC
    r = requests.post(f'{BASE}/assessments/{disagree_id}/inter-rater', json={
        'secondAssessorId': assessor2_id,
    }, headers=headers(admin_token))
    test('Create disagreement IRC', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')

    # Submit very different scores (force resolution)
    r = requests.put(f'{BASE}/assessments/{disagree_id}/inter-rater', json={
        'interview': 20,
        'practicalDemo': 25,
        'evidenceQuality': 15,
        'overallDecision': 'rejected',
        'notes': 'Significant skill gaps observed',
    }, headers=headers(assessor2_token))
    test('Submit disagreeing scores', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
    disagree_result = safe_json(r).get('interRaterCheck', {})
    test('Disagreement flagged for resolution', disagree_result.get('resolutionNeeded') == True,
         f"needed: {disagree_result.get('resolutionNeeded')}")

    # Resolve the disagreement
    r = requests.put(f'{BASE}/assessments/{disagree_id}/inter-rater/resolve', json={
        'finalDecision': 'rejected',
        'notes': 'After review, second assessor observations are accurate. Worker needs more training.',
    }, headers=headers(admin_token))
    test('Resolve disagreement', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
    resolution = safe_json(r).get('resolution', {})
    test('Resolution has finalDecision', resolution.get('finalDecision') == 'rejected',
         f"decision: {resolution.get('finalDecision')}")
    test('Resolution has resolvedAt', bool(resolution.get('resolvedAt')), '')
    test('Resolution has notes', bool(resolution.get('notes')), '')

    # Cannot resolve an already-resolved IRC
    r = requests.put(f'{BASE}/assessments/{disagree_id}/inter-rater/resolve', json={
        'finalDecision': 'approved',
    }, headers=headers(admin_token))
    test('Cannot resolve already-resolved IRC', r.status_code == 400, f'{r.status_code}: {r.text[:200]}')

# ===================================================================
# GAP #15: Assessor Performance Dashboard
# ===================================================================
print('\n--- Gap #15: Assessor Performance Dashboard ---')

# Get assessor dashboard (admin can view any)
r = requests.get(f'{BASE}/assessments/assessor-dashboard/{assessor_id}', headers=headers(admin_token))
test('Get assessor dashboard (admin)', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
dash = safe_json(r)
test('Dashboard has assessor info', bool(dash.get('assessor', {}).get('name')),
     f"name: {dash.get('assessor', {}).get('name')}")
test('Dashboard has summary', bool(dash.get('summary')), f"keys: {list(dash.get('summary', {}).keys())}")
test('Summary has totalAssessments', dash.get('summary', {}).get('totalAssessments', -1) >= 0,
     f"total: {dash.get('summary', {}).get('totalAssessments')}")
test('Summary has completed count', 'completed' in dash.get('summary', {}), '')
test('Summary has approvalRate', 'approvalRate' in dash.get('summary', {}), '')
test('Summary has avgScore', 'avgScore' in dash.get('summary', {}), '')
test('Dashboard has byTrade', isinstance(dash.get('byTrade'), dict), f"type: {type(dash.get('byTrade'))}")
test('Dashboard has moderation', bool(dash.get('moderation')),
     f"keys: {list(dash.get('moderation', {}).keys())}")
test('Dashboard has interRaterReliability', bool(dash.get('interRaterReliability')), '')
test('Dashboard has cpd', bool(dash.get('cpd')),
     f"keys: {list(dash.get('cpd', {}).keys())}")
test('Dashboard has qualifications count', 'qualifications' in dash,
     f"quals: {dash.get('qualifications')}")
test('Dashboard has monthlyActivity', isinstance(dash.get('monthlyActivity'), dict), '')
test('Dashboard has experience', 'experience' in dash, '')

# Assessor can view own dashboard
r = requests.get(f'{BASE}/assessments/assessor-dashboard/{assessor_id}', headers=headers(assessor_token))
test('Assessor views own dashboard', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# Assessor cannot view another assessor's dashboard
r = requests.get(f'{BASE}/assessments/assessor-dashboard/{assessor2_id}', headers=headers(assessor_token))
test('Assessor cannot view other dashboard', r.status_code == 403, f'{r.status_code}: {r.text[:200]}')

# Worker cannot access dashboard
r = requests.get(f'{BASE}/assessments/assessor-dashboard/{assessor_id}', headers=headers(worker_token))
test('Worker cannot access dashboard', r.status_code == 403, f'{r.status_code}: {r.text[:200]}')

# Invalid assessor ID
r = requests.get(f'{BASE}/assessments/assessor-dashboard/000000000000000000000000', headers=headers(admin_token))
test('Invalid assessor returns 404', r.status_code == 404, f'{r.status_code}: {r.text[:200]}')

# ===================================================================
# E2E FLOW: Full Phase 5 Journey
# ===================================================================
print('\n--- E2E: Full Phase 5 Journey ---')

# Create fresh worker and assessment
e2e_worker_email = f'rpl5-e2e-{ts}@test.com'
r = requests.post(f'{BASE}/auth/register', json={
    'name': 'E2E Phase5 Worker', 'email': e2e_worker_email,
    'password': 'TestPass123!', 'role': 'worker', 'district': 'Islamabad',
    'trade': 'welder', 'cnic': '12345-5555555-5'
})
e2e_worker_token = r.json().get('accessToken', '') or r.json().get('token', '')
e2e_worker_id = r.json().get('workerId', '')

r = requests.post(f'{BASE}/assessments', json={
    'worker': e2e_worker_id,
    'type': 'rpl', 'trade': 'welder', 'title': 'E2E Phase 5 Welder RPL'
}, headers=headers(assessor_token))
e2e_assessment_id = r.json().get('_id', '')
test('E2E: Create welder RPL', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')

# Step 1: Assign advisor
r = requests.post(f'{BASE}/assessments/{e2e_assessment_id}/advisor', json={
    'advisorId': advisor_id,
}, headers=headers(admin_token))
test('E2E: Assign advisor', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# Step 2: Advisor gives guidance
r = requests.post(f'{BASE}/assessments/{e2e_assessment_id}/advisor/guidance', json={
    'note': 'Start with your AWS welding certificates and work experience letters.',
}, headers=headers(advisor_token))
test('E2E: Advisor guidance', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# Step 3: Apply portfolio template
r = requests.post(f'{BASE}/assessments/{e2e_assessment_id}/portfolio-template',
    headers=headers(assessor_token))
test('E2E: Apply welder portfolio template', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
e2e_tpl = safe_json(r).get('portfolioTemplate', {})
test('E2E: Welder template applied', e2e_tpl.get('templateId') == 'TPL-WELD-01',
     f"id: {e2e_tpl.get('templateId')}")

# Step 4: Complete portfolio sections
for sid in ['personal', 'qualifications', 'experience-letters', 'reference-letters', 'safety']:
    requests.put(f'{BASE}/assessments/{e2e_assessment_id}/portfolio-template/{sid}', json={
        'completed': True, 'notes': f'{sid} done',
    }, headers=headers(assessor_token))

r = requests.get(f'{BASE}/assessments/{e2e_assessment_id}/portfolio-template', headers=headers(assessor_token))
e2e_progress = safe_json(r)
test('E2E: All required sections done', e2e_progress.get('allRequiredDone') == True,
     f"allRequiredDone: {e2e_progress.get('allRequiredDone')}")

# Step 5: Run scenario assessment
r = requests.post(f'{BASE}/assessments/{e2e_assessment_id}/scenario', json={
    'scenarioId': 'WELD-SC-01',
}, headers=headers(assessor_token))
test('E2E: Start welder scenario', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')

r = requests.put(f'{BASE}/assessments/{e2e_assessment_id}/scenario/WELD-SC-01', json={
    'responses': [
        {'stepNumber': 1, 'response': 'Beveled to 37.5 degrees, 3mm root gap, 1.5mm root face', 'score': 4},
        {'stepNumber': 2, 'response': 'E6010 for root at 75A, E7018 for fill at 120A', 'score': 3},
        {'stepNumber': 3, 'response': 'Maintained keyhole, consistent travel speed', 'score': 4},
        {'stepNumber': 4, 'response': 'Checked for porosity, undercut, lack of fusion', 'score': 3},
    ],
    'assessorNotes': 'Strong welding skills demonstrated',
}, headers=headers(assessor_token))
test('E2E: Submit welder scenario', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
e2e_sc = safe_json(r).get('scenario', {})
test('E2E: Scenario passed', e2e_sc.get('passed') == True, f"passed: {e2e_sc.get('passed')}")

# Step 6: Competency conversation
r = requests.put(f'{BASE}/assessments/{e2e_assessment_id}/competency-conversation', json={
    'format': 'in-person',
    'durationMinutes': 40,
    'topics': [
        {'competencyArea': 'SMAW Welding', 'rating': 4, 'candidateSummary': 'Expert level'},
        {'competencyArea': 'Safety Protocols', 'rating': 4, 'candidateSummary': 'Excellent safety awareness'},
        {'competencyArea': 'Blueprint Reading', 'rating': 3, 'candidateSummary': 'Good understanding'},
    ],
    'overallImpression': 'Highly competent welder with 5+ years experience',
}, headers=headers(assessor_token))
test('E2E: Competency conversation', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
e2e_cc = safe_json(r).get('competencyConversation', {})
test('E2E: CC recommendation is competent', e2e_cc.get('recommendation') == 'competent',
     f"rec: {e2e_cc.get('recommendation')}")

# Step 7: Inter-rater reliability check
r = requests.post(f'{BASE}/assessments/{e2e_assessment_id}/inter-rater', json={
    'secondAssessorId': assessor2_id,
}, headers=headers(admin_token))
test('E2E: Request inter-rater check', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')

r = requests.put(f'{BASE}/assessments/{e2e_assessment_id}/inter-rater', json={
    'interview': 78, 'practicalDemo': 82, 'evidenceQuality': 70,
    'overallDecision': 'approved',
}, headers=headers(assessor2_token))
test('E2E: Submit second assessor scores', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
e2e_irc = safe_json(r).get('interRaterCheck', {})
test('E2E: Scores within threshold', e2e_irc.get('agreement', {}).get('withinThreshold') is not None,
     f"threshold: {e2e_irc.get('agreement', {}).get('withinThreshold')}")

# Step 8: Advisor records final meeting
r = requests.put(f'{BASE}/assessments/{e2e_assessment_id}/advisor/meeting', json={
    'notes': 'Final review meeting. All evidence collected. Ready for decision.',
}, headers=headers(advisor_token))
test('E2E: Final advisor meeting', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# Step 9: Check assessor dashboard
r = requests.get(f'{BASE}/assessments/assessor-dashboard/{assessor_id}', headers=headers(admin_token))
test('E2E: Assessor dashboard', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
e2e_dash = safe_json(r)
test('E2E: Dashboard shows assessments', e2e_dash.get('summary', {}).get('totalAssessments', 0) > 0,
     f"total: {e2e_dash.get('summary', {}).get('totalAssessments')}")
test('E2E: Dashboard has welder trade', 'welder' in e2e_dash.get('byTrade', {}),
     f"trades: {list(e2e_dash.get('byTrade', {}).keys())}")

# ===================================================================
# Summary
# ===================================================================
print('\n' + '=' * 60)
print(f'RPL Phase 5 Results: {passed} passed, {failed} failed, {passed + failed} total')
print('=' * 60)

if errors:
    print('\nFailed tests:')
    for e in errors:
        print(f'  FAIL: {e}')

sys.exit(0 if failed == 0 else 1)
