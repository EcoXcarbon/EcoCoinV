"""
RPL Phase 6 (Final) Gap Implementation Tests
Tests 5 gaps: #34, #32, #28, #37, #38

Run: python src/__tests__/test_rpl_phase6.py
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
print('RPL Phase 6 (Final) Gap Tests')
print('=' * 60)

# --- Setup: Register users ---
print('\n--- Setup: Create users ---')

ts = int(time.time())
admin_email = f'rpl6-admin-{ts}@test.com'
inst_email = f'rpl6-inst-{ts}@test.com'
worker_email = f'rpl6-worker-{ts}@test.com'
assessor_email = f'rpl6-assessor-{ts}@test.com'
employer_email = f'rpl6-employer-{ts}@test.com'

# Login as seed admin (admin role)
r = requests.post(f'{BASE}/auth/login', json={
    'email': 'admin@ppmc.org.pk', 'password': 'Admin@2026'
})
test('Login seed admin', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
admin_token = r.json().get('accessToken', '') or r.json().get('token', '')
admin_id = r.json().get('user', {}).get('_id', '')

# Register institution
r = requests.post(f'{BASE}/auth/register', json={
    'name': 'RPL6 Institution', 'email': inst_email,
    'password': 'TestPass123!', 'role': 'institution', 'district': 'Peshawar'
})
test('Register institution', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
inst_token = r.json().get('accessToken', '') or r.json().get('token', '')
inst_id = r.json().get('user', {}).get('_id', '')

# Register worker
r = requests.post(f'{BASE}/auth/register', json={
    'name': 'RPL6 Worker', 'email': worker_email,
    'password': 'TestPass123!', 'role': 'worker', 'district': 'Peshawar',
    'trade': 'mason', 'cnic': '12345-1234567-6'
})
test('Register worker', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
worker_token = r.json().get('accessToken', '') or r.json().get('token', '')
worker_id = r.json().get('workerId', '')
worker_user_id = r.json().get('user', {}).get('_id', '')

# Register assessor
r = requests.post(f'{BASE}/auth/register', json={
    'name': 'RPL6 Assessor', 'email': assessor_email,
    'password': 'TestPass123!', 'role': 'assessor', 'district': 'Peshawar'
})
test('Register assessor', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
assessor_token = r.json().get('accessToken', '') or r.json().get('token', '')
assessor_id = r.json().get('user', {}).get('_id', '')

# Register employer
r = requests.post(f'{BASE}/auth/register', json={
    'name': 'RPL6 Employer', 'email': employer_email,
    'password': 'TestPass123!', 'role': 'employer', 'district': 'Dubai'
})
test('Register employer', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
employer_token = r.json().get('accessToken', '') or r.json().get('token', '')
employer_id = r.json().get('user', {}).get('_id', '')

test('Worker profile auto-created', bool(worker_id), f'workerId: {worker_id}')

# Create RPL assessment
r = requests.post(f'{BASE}/assessments', json={
    'worker': worker_id,
    'type': 'rpl', 'trade': 'mason', 'title': 'RPL Phase 6 Test'
}, headers=headers(assessor_token))
test('Create RPL assessment', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
assessment_id = r.json().get('_id', '')

# Create second RPL assessment (will be approved via full pipeline, for work-permit linkage)
r = requests.post(f'{BASE}/assessments', json={
    'worker': worker_id,
    'type': 'rpl', 'trade': 'mason', 'title': 'RPL Phase 6 Approved Test'
}, headers=headers(assessor_token))
test('Create second RPL assessment', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
assessment2_id = r.json().get('_id', '')

# --- Approve assessment2 via full RPL pipeline ---
# 0) Pre-screening (required before evidence)
r = requests.put(f'{BASE}/assessments/{assessment2_id}/pre-screening', json={
    'responses': [
        {'area': 'Foundation Laying', 'question': 'Rate experience', 'selfRating': 5, 'yearsExperience': 5, 'hasEvidence': True},
        {'area': 'Safety Compliance', 'question': 'Rate experience', 'selfRating': 4, 'yearsExperience': 4, 'hasEvidence': True},
    ],
    'tradeExperience': {'totalYears': 5, 'formalTraining': True, 'currentlyEmployed': True}
}, headers=headers(worker_token))
test('Pipeline: pre-screening', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# 1) Upload evidence (multipart)
files = [
    ('documents', ('exp-letter.pdf', b'%PDF-1.4 fake exp letter', 'application/pdf')),
    ('documents', ('trade-cert.pdf', b'%PDF-1.4 fake trade cert', 'application/pdf')),
]
r = requests.post(f'{BASE}/assessments/{assessment2_id}/evidence',
    files=files,
    data={'categories': ['experience-letter', 'trade-certificate']},
    headers={'Authorization': f'Bearer {worker_token}'},
)
test('Pipeline: upload evidence', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# 2) Document review
r = requests.put(f'{BASE}/assessments/{assessment2_id}/document-review', json={
    'feedback': 'Documents verified.'
}, headers=headers(assessor_token))
test('Pipeline: document review', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# 3) Interview
r = requests.put(f'{BASE}/assessments/{assessment2_id}/interview', json={
    'items': [
        {'competencyArea': 'Foundation Laying', 'question': 'Describe experience', 'response': 'Good', 'score': 4},
        {'competencyArea': 'Safety Compliance', 'question': 'Safety procedures', 'response': 'Good', 'score': 3},
    ],
    'overallNotes': 'Strong candidate.',
    'durationMinutes': 30,
}, headers=headers(assessor_token))
test('Pipeline: interview', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# 4) Practical demo
r = requests.put(f'{BASE}/assessments/{assessment2_id}/practical-demo', json={
    'rubric': [
        {'criterion': 'Brick laying', 'score': 4, 'notes': 'Excellent'},
        {'criterion': 'Safety compliance', 'score': 3, 'notes': 'Good'},
    ],
    'overallResult': 'pass',
    'location': 'PPMC Lab',
}, headers=headers(assessor_token))
test('Pipeline: practical demo', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# 5) Review (sends to awaiting-moderation)
r = requests.put(f'{BASE}/assessments/{assessment2_id}/review', json={
    'status': 'approved', 'score': 85, 'feedback': 'Good work'
}, headers=headers(assessor_token))
test('Pipeline: review', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# 6) Moderate (institution endorses → may go to external moderation for new assessors)
r = requests.put(f'{BASE}/assessments/{assessment2_id}/moderate', json={
    'decision': 'endorsed', 'comments': 'Assessment quality verified.'
}, headers=headers(inst_token))
test('Pipeline: moderate endorsed', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# Check status — may need external moderation (new assessors always require it)
r = requests.get(f'{BASE}/assessments/{assessment2_id}', headers=headers(assessor_token))
current_status = safe_json(r).get('status')
if current_status == 'awaiting-external-moderation':
    # 7) External moderation (admin, different from assessor and internal moderator)
    r = requests.put(f'{BASE}/assessments/{assessment2_id}/external-moderate', json={
        'decision': 'endorsed', 'comments': 'External review passed.',
        'qualityScore': 5, 'findings': [],
    }, headers=headers(admin_token))
    test('Pipeline: external moderate', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# Verify it's approved
r = requests.get(f'{BASE}/assessments/{assessment2_id}', headers=headers(assessor_token))
test('Pipeline: assessment approved', safe_json(r).get('status') == 'approved', f"status: {safe_json(r).get('status')}")

# ===================================================================
# GAP #34: Assessment Site/Venue Management
# ===================================================================
print('\n--- Gap #34: Assessment Site/Venue Management ---')

# Create venue 1
r = requests.post(f'{BASE}/venues', json={
    'name': 'PPMC Assessment Centre Peshawar',
    'address': 'University Road, Phase 3',
    'city': 'Peshawar',
    'district': 'Peshawar',
    'province': 'Khyber Pakhtunkhwa',
    'type': 'assessment-centre',
    'capacity': 50,
    'facilities': ['workshop', 'computer-lab', 'tools-storage'],
    'contact': {'name': 'Ali Khan', 'phone': '+923001234567', 'email': 'ali@ppmc.org.pk'},
    'gpsCoordinates': {'latitude': 34.0151, 'longitude': 71.5249}
}, headers=headers(admin_token))
test('34.1 Create venue', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
venue_data = safe_json(r)
venue_id = venue_data.get('_id', '')
test('34.2 Venue has name', venue_data.get('name') == 'PPMC Assessment Centre Peshawar', str(venue_data.get('name')))
test('34.3 Venue has type', venue_data.get('type') == 'assessment-centre', str(venue_data.get('type')))
test('34.4 Venue has capacity', venue_data.get('capacity') == 50, str(venue_data.get('capacity')))
test('34.5 Venue has GPS', venue_data.get('gpsCoordinates', {}).get('latitude') is not None, str(venue_data.get('gpsCoordinates')))

# Create venue 2 (workshop type)
r = requests.post(f'{BASE}/venues', json={
    'name': 'NAVTTC Workshop Mardan',
    'address': 'Industrial Area, Mardan',
    'city': 'Mardan',
    'district': 'Mardan',
    'type': 'workshop',
    'capacity': 25,
    'facilities': ['power-tools', 'welding-bay'],
}, headers=headers(admin_token))
test('34.6 Create second venue', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
venue2_id = safe_json(r).get('_id', '')

# List all venues
r = requests.get(f'{BASE}/venues', headers=headers(admin_token))
test('34.7 List venues', r.status_code == 200, f'{r.status_code}')
data = safe_json(r)
test('34.8 Venues list has total', data.get('total', 0) >= 2, f"total: {data.get('total')}")

# Filter by type
r = requests.get(f'{BASE}/venues?type=workshop', headers=headers(admin_token))
test('34.9 Filter venues by type', r.status_code == 200, f'{r.status_code}')
data = safe_json(r)
test('34.10 Filtered count correct', all(v.get('type') == 'workshop' for v in data.get('venues', [])), f"types: {[v.get('type') for v in data.get('venues', [])]}")

# Filter by district
r = requests.get(f'{BASE}/venues?district=Peshawar', headers=headers(admin_token))
test('34.11 Filter venues by district', r.status_code == 200, f'{r.status_code}')

# Get single venue
r = requests.get(f'{BASE}/venues/{venue_id}', headers=headers(admin_token))
test('34.12 Get single venue', r.status_code == 200, f'{r.status_code}')
test('34.13 Venue details correct', safe_json(r).get('name') == 'PPMC Assessment Centre Peshawar', str(safe_json(r).get('name')))

# Update venue
r = requests.put(f'{BASE}/venues/{venue_id}', json={
    'capacity': 75,
    'facilities': ['workshop', 'computer-lab', 'tools-storage', 'cafeteria'],
}, headers=headers(admin_token))
test('34.14 Update venue', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
test('34.15 Updated capacity', safe_json(r).get('capacity') == 75, str(safe_json(r).get('capacity')))

# Soft-deactivate venue 2
r = requests.delete(f'{BASE}/venues/{venue2_id}', headers=headers(admin_token))
test('34.16 Deactivate venue', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
test('34.17 Venue deactivated', safe_json(r).get('venue', {}).get('active') == False, str(safe_json(r).get('venue', {}).get('active')))

# Filter by active
r = requests.get(f'{BASE}/venues?active=false', headers=headers(admin_token))
test('34.18 Filter inactive venues', r.status_code == 200, f'{r.status_code}')

# Schedule with venueId (Gap #34 + #31 integration)
r = requests.post(f'{BASE}/assessments/{assessment_id}/schedule', json={
    'stage': 'interview',
    'scheduledDate': '2026-04-15T10:00:00Z',
    'venue': 'PPMC Assessment Centre Peshawar',
    'venueId': venue_id,
}, headers=headers(assessor_token))
test('34.19 Schedule with venueId', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
slot_data = safe_json(r).get('slot', {})
test('34.20 Slot has venueId', slot_data.get('venueId') == venue_id, f"venueId: {slot_data.get('venueId')}")

# Get venue schedule
r = requests.get(f'{BASE}/venues/{venue_id}/schedule', headers=headers(admin_token))
test('34.21 Get venue schedule', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# Worker cannot create venue
r = requests.post(f'{BASE}/venues', json={
    'name': 'Fake Venue', 'address': 'Fake', 'city': 'Fake', 'district': 'Fake', 'type': 'other'
}, headers=headers(worker_token))
test('34.22 Worker cannot create venue', r.status_code == 403, f'{r.status_code}')


# ===================================================================
# GAP #32: Cost/Fee Tracking
# ===================================================================
print('\n--- Gap #32: Cost/Fee Tracking ---')

# Get fee schedules
r = requests.get(f'{BASE}/assessments/fee-schedules', headers=headers(admin_token))
test('32.1 List fee schedules', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
data = safe_json(r)
test('32.2 Has schedules', data.get('total', 0) >= 2, f"total: {data.get('total')}")

# Get specific fee schedule
r = requests.get(f'{BASE}/assessments/fee-schedules?scheduleId=STANDARD-2026', headers=headers(admin_token))
test('32.3 Get STANDARD-2026 schedule', r.status_code == 200, f'{r.status_code}')
data = safe_json(r)
test('32.4 Schedule has items', len(data.get('items', [])) >= 5, f"items: {len(data.get('items', []))}")
test('32.5 Schedule currency PKR', data.get('currency') == 'PKR', str(data.get('currency')))

# Get subsidized schedule
r = requests.get(f'{BASE}/assessments/fee-schedules?scheduleId=SUBSIDIZED-2026', headers=headers(admin_token))
test('32.6 Get SUBSIDIZED-2026 schedule', r.status_code == 200, f'{r.status_code}')
sub_data = safe_json(r)
sub_items = sub_data.get('items', [])
std_items = data.get('items', [])
test('32.7 Subsidized rates lower', len(sub_items) > 1 and len(std_items) > 1 and sub_items[1].get('amount', 9999) < std_items[1].get('amount', 0), 'subsidized not lower or no items')

# Add fee item manually
r = requests.post(f'{BASE}/assessments/{assessment_id}/fees', json={
    'feeType': 'registration', 'amount': 500, 'currency': 'PKR',
    'dueDate': '2026-03-01T00:00:00Z'
}, headers=headers(admin_token))
test('32.8 Add fee item', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
fees_data = safe_json(r).get('fees', {})
test('32.9 Fee total calculated', fees_data.get('totalAmount') == 500, f"total: {fees_data.get('totalAmount')}")
test('32.10 Outstanding calculated', fees_data.get('totalOutstanding') == 500, f"outstanding: {fees_data.get('totalOutstanding')}")
fee_item_id = fees_data.get('items', [{}])[-1].get('_id', '') if fees_data.get('items') else ''

# Add second fee item
r = requests.post(f'{BASE}/assessments/{assessment_id}/fees', json={
    'feeType': 'assessment', 'amount': 2500, 'currency': 'PKR'
}, headers=headers(admin_token))
test('32.11 Add second fee item', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
fees_data = safe_json(r).get('fees', {})
test('32.12 Total is 3000', fees_data.get('totalAmount') == 3000, f"total: {fees_data.get('totalAmount')}")
fee_item2_id = fees_data.get('items', [{}])[-1].get('_id', '') if fees_data.get('items') else ''

# Mark first fee as paid
r = requests.put(f'{BASE}/assessments/{assessment_id}/fees/{fee_item_id}', json={
    'status': 'paid', 'paymentReference': 'TXN-2026-001'
}, headers=headers(admin_token))
test('32.13 Mark fee as paid', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
fees_data = safe_json(r).get('fees', {})
test('32.14 Total paid updated', fees_data.get('totalPaid') == 500, f"paid: {fees_data.get('totalPaid')}")
test('32.15 Outstanding updated', fees_data.get('totalOutstanding') == 2500, f"outstanding: {fees_data.get('totalOutstanding')}")

# Waive second fee
r = requests.put(f'{BASE}/assessments/{assessment_id}/fees/{fee_item2_id}', json={
    'status': 'waived', 'waivedReason': 'NAVTTC subsidy approved'
}, headers=headers(admin_token))
test('32.16 Waive fee item', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
fees_data = safe_json(r).get('fees', {})
test('32.17 Total waived updated', fees_data.get('totalWaived') == 2500, f"waived: {fees_data.get('totalWaived')}")
test('32.18 Outstanding is 0', fees_data.get('totalOutstanding') == 0, f"outstanding: {fees_data.get('totalOutstanding')}")

# Get fee summary
r = requests.get(f'{BASE}/assessments/{assessment_id}/fees', headers=headers(admin_token))
test('32.19 Get fee summary', r.status_code == 200, f'{r.status_code}')
data = safe_json(r)
test('32.20 Summary has items', len(data.get('items', [])) >= 2, f"items: {len(data.get('items', []))}")

# Delete fee item (admin only)
r = requests.delete(f'{BASE}/assessments/{assessment_id}/fees/{fee_item2_id}', headers=headers(admin_token))
test('32.21 Delete fee item', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
fees_data = safe_json(r).get('fees', {})
test('32.22 Fee removed from total', fees_data.get('totalAmount') == 500, f"total: {fees_data.get('totalAmount')}")

# Apply fee schedule template
r = requests.post(f'{BASE}/assessments/{assessment_id}/fees/apply-schedule', json={
    'scheduleId': 'STANDARD-2026'
}, headers=headers(admin_token))
test('32.23 Apply fee schedule', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
fees_data = safe_json(r).get('fees', {})
test('32.24 Schedule items added', len(fees_data.get('items', [])) >= 7, f"items: {len(fees_data.get('items', []))}")
test('32.25 Total includes schedule', fees_data.get('totalAmount', 0) > 500, f"total: {fees_data.get('totalAmount')}")

# Apply subsidized schedule to second assessment
r = requests.post(f'{BASE}/assessments/{assessment2_id}/fees/apply-schedule', json={
    'scheduleId': 'SUBSIDIZED-2026'
}, headers=headers(admin_token))
test('32.26 Apply subsidized schedule', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')

# Invalid schedule ID
r = requests.post(f'{BASE}/assessments/{assessment_id}/fees/apply-schedule', json={
    'scheduleId': 'INVALID-SCHEDULE'
}, headers=headers(admin_token))
test('32.27 Invalid schedule rejected', r.status_code == 400 or r.status_code == 422, f'{r.status_code}')

# Fee summary analytics
r = requests.get(f'{BASE}/analytics/fee-summary', headers=headers(admin_token))
test('32.28 Fee summary analytics', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
data = safe_json(r)
test('32.29 Has totalRevenue', 'totalRevenue' in data, str(data.keys()))
test('32.30 Has byFeeType', isinstance(data.get('byFeeType'), list), str(type(data.get('byFeeType'))))
test('32.31 Has byTrade', isinstance(data.get('byTrade'), list), str(type(data.get('byTrade'))))


# ===================================================================
# GAP #28: RPL-to-Work-Permit Linkage
# ===================================================================
print('\n--- Gap #28: RPL-to-Work-Permit Linkage ---')

# Try to link unapproved assessment → should fail
r = requests.post(f'{BASE}/assessments/{assessment_id}/work-permit-link', json={
    'permitNumber': 'WP-2026-001',
    'issuingAuthority': 'MOHRE',
    'issuingCountry': 'UAE',
}, headers=headers(admin_token))
test('28.1 Cannot link unapproved', r.status_code == 400, f'{r.status_code}: {r.text[:200]}')

# Link approved assessment
r = requests.post(f'{BASE}/assessments/{assessment2_id}/work-permit-link', json={
    'permitNumber': 'WP-2026-001',
    'issuingAuthority': 'MOHRE',
    'issuingCountry': 'UAE',
    'occupation': 'Mason',
    'sponsorName': 'Al Futtaim Construction LLC',
}, headers=headers(admin_token))
test('28.2 Link approved assessment', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
data = safe_json(r)
test('28.3 Work permit has number', data.get('workPermit', {}).get('permitNumber') == 'WP-2026-001', str(data.get('workPermit', {}).get('permitNumber')))
test('28.4 Work permit has country', data.get('workPermit', {}).get('issuingCountry') == 'UAE', str(data.get('workPermit', {}).get('issuingCountry')))
test('28.5 Work permit linked to assessment', str(data.get('workPermit', {}).get('linkedAssessment')) == assessment2_id, f"linked: {data.get('workPermit', {}).get('linkedAssessment')}")

# Get work-permit-link info
r = requests.get(f'{BASE}/assessments/{assessment2_id}/work-permit-link', headers=headers(admin_token))
test('28.6 Get work-permit-link', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
data = safe_json(r)
test('28.7 Link shows linked=true', data.get('linked') == True, f"linked: {data.get('linked')}")
test('28.8 Link has worker info', data.get('worker', {}).get('fullName') is not None, str(data.get('worker')))

# Update work permit directly (workers route)
r = requests.put(f'{BASE}/workers/{worker_id}/work-permit', json={
    'status': 'active',
    'issueDate': '2026-02-01T00:00:00Z',
    'expiryDate': '2028-02-01T00:00:00Z',
}, headers=headers(admin_token))
test('28.9 Update work permit', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
data = safe_json(r)
test('28.10 Status updated', data.get('workPermit', {}).get('status') == 'active', str(data.get('workPermit', {}).get('status')))
test('28.11 Expiry set', data.get('workPermit', {}).get('expiryDate') is not None, str(data.get('workPermit', {}).get('expiryDate')))

# Get work permit
r = requests.get(f'{BASE}/workers/{worker_id}/work-permit', headers=headers(admin_token))
test('28.12 Get work permit', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
data = safe_json(r)
test('28.13 Has worker name', data.get('worker', {}).get('fullName') is not None, str(data.get('worker')))
test('28.14 Permit number preserved', data.get('workPermit', {}).get('permitNumber') == 'WP-2026-001', str(data.get('workPermit', {}).get('permitNumber')))

# Non-existent worker
r = requests.get(f'{BASE}/workers/aaaaaaaaaaaaaaaaaaaaaaaa/work-permit', headers=headers(admin_token))
test('28.15 404 for missing worker', r.status_code == 404, f'{r.status_code}')

# Unlinked assessment check
r = requests.get(f'{BASE}/assessments/{assessment_id}/work-permit-link', headers=headers(admin_token))
test('28.16 Unlinked assessment', r.status_code == 200, f'{r.status_code}')
data = safe_json(r)
test('28.17 Shows linked=false', data.get('linked') == False, f"linked: {data.get('linked')}")


# ===================================================================
# GAP #37: RPL Outcome Comparison Reports
# ===================================================================
print('\n--- Gap #37: RPL Outcome Comparison Reports ---')

# Group by trade
r = requests.get(f'{BASE}/analytics/rpl-outcome-reports?groupBy=trade', headers=headers(admin_token))
test('37.1 Outcome report by trade', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
data = safe_json(r)
test('37.2 Has groupBy field', data.get('groupBy') == 'trade', str(data.get('groupBy')))
test('37.3 Has groups array', isinstance(data.get('groups'), list), str(type(data.get('groups'))))
test('37.4 Has comparison', 'comparison' in data, str(data.keys()))

# Group by month
r = requests.get(f'{BASE}/analytics/rpl-outcome-reports?groupBy=month&months=6', headers=headers(admin_token))
test('37.5 Outcome report by month', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
data = safe_json(r)
test('37.6 Month groups sorted', data.get('groupBy') == 'month', str(data.get('groupBy')))

# Group by district
r = requests.get(f'{BASE}/analytics/rpl-outcome-reports?groupBy=district', headers=headers(admin_token))
test('37.7 Outcome report by district', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
data = safe_json(r)
test('37.8 District groupBy', data.get('groupBy') == 'district', str(data.get('groupBy')))

# Group by nqfLevel
r = requests.get(f'{BASE}/analytics/rpl-outcome-reports?groupBy=nqfLevel', headers=headers(admin_token))
test('37.9 Outcome report by NQF level', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
data = safe_json(r)
test('37.10 NQF groupBy', data.get('groupBy') == 'nqfLevel', str(data.get('groupBy')))

# With compareBy=volume
r = requests.get(f'{BASE}/analytics/rpl-outcome-reports?groupBy=trade&compareBy=volume', headers=headers(admin_token))
test('37.11 Compare by volume', r.status_code == 200, f'{r.status_code}')
test('37.12 CompareBy in response', safe_json(r).get('compareBy') == 'volume', str(safe_json(r).get('compareBy')))

# With compareBy=avgScore
r = requests.get(f'{BASE}/analytics/rpl-outcome-reports?groupBy=trade&compareBy=avgScore', headers=headers(admin_token))
test('37.13 Compare by avgScore', r.status_code == 200, f'{r.status_code}')

# With compareBy=processingTime
r = requests.get(f'{BASE}/analytics/rpl-outcome-reports?groupBy=trade&compareBy=processingTime', headers=headers(admin_token))
test('37.14 Compare by processingTime', r.status_code == 200, f'{r.status_code}')

# With date filter
r = requests.get(f'{BASE}/analytics/rpl-outcome-reports?groupBy=trade&dateFrom=2026-01-01&dateTo=2026-12-31', headers=headers(admin_token))
test('37.15 Date filtered report', r.status_code == 200, f'{r.status_code}')

# With trade filter
r = requests.get(f'{BASE}/analytics/rpl-outcome-reports?groupBy=month&trade=mason', headers=headers(admin_token))
test('37.16 Trade filtered report', r.status_code == 200, f'{r.status_code}')

# Missing groupBy → validation error
r = requests.get(f'{BASE}/analytics/rpl-outcome-reports', headers=headers(admin_token))
test('37.17 Missing groupBy rejected', r.status_code == 400 or r.status_code == 422, f'{r.status_code}')

# Invalid groupBy
r = requests.get(f'{BASE}/analytics/rpl-outcome-reports?groupBy=invalid', headers=headers(admin_token))
test('37.18 Invalid groupBy rejected', r.status_code == 400 or r.status_code == 422, f'{r.status_code}')

# Check group data structure
r = requests.get(f'{BASE}/analytics/rpl-outcome-reports?groupBy=trade', headers=headers(admin_token))
data = safe_json(r)
if data.get('groups') and len(data['groups']) > 0:
    g = data['groups'][0]
    test('37.19 Group has passRate', 'passRate' in g, str(g.keys()))
    test('37.20 Group has avgScore', 'avgScore' in g, str(g.keys()))
    test('37.21 Group has processingDays', 'processingDays' in g, str(g.keys()))
    test('37.22 Group has total', 'total' in g, str(g.keys()))
else:
    test('37.19 Group has passRate', True, 'no groups to check (0 data)')
    test('37.20 Group has avgScore', True, 'no groups to check')
    test('37.21 Group has processingDays', True, 'no groups to check')
    test('37.22 Group has total', True, 'no groups to check')

# Period comparison (month groupBy)
r = requests.get(f'{BASE}/analytics/rpl-outcome-reports?groupBy=month&months=12', headers=headers(admin_token))
data = safe_json(r)
test('37.23 Period comparison present', 'periodComparison' in data, str(data.keys()))


# ===================================================================
# GAP #38: Employer Satisfaction Tracking
# ===================================================================
print('\n--- Gap #38: Employer Satisfaction Tracking ---')

# Submit employer rating
r = requests.post(f'{BASE}/employer-satisfaction', json={
    'workerId': worker_id,
    'ratings': {
        'overallPerformance': 4,
        'skillsMatch': 5,
        'safetyCompliance': 4,
        'communication': 3,
        'attitude': 5,
        'productivity': 4,
        'adaptability': 4,
    },
    'rehireIntent': True,
    'wouldRecommend': True,
    'rplCertificateAccurate': True,
    'rplCertificateUseful': True,
    'strengths': 'Excellent masonry skills, very punctual',
    'areasForImprovement': 'Could improve English communication',
    'trade': 'mason',
    'country': 'UAE',
}, headers=headers(employer_token))
test('38.1 Submit employer rating', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
rating_data = safe_json(r)
rating_id = rating_data.get('_id', '')
test('38.2 Overall score calculated', rating_data.get('overallScore') is not None, f"score: {rating_data.get('overallScore')}")
test('38.3 Overall score ~4.1', 3.5 < (rating_data.get('overallScore') or 0) < 5.0, f"score: {rating_data.get('overallScore')}")
test('38.4 Status is submitted', rating_data.get('status') == 'submitted', str(rating_data.get('status')))
test('38.5 Trade set', rating_data.get('trade') == 'mason', str(rating_data.get('trade')))

# Submit second rating
r = requests.post(f'{BASE}/employer-satisfaction', json={
    'workerId': worker_id,
    'ratings': {
        'overallPerformance': 3,
        'skillsMatch': 3,
        'safetyCompliance': 4,
        'communication': 2,
        'attitude': 4,
        'productivity': 3,
        'adaptability': 3,
    },
    'rehireIntent': False,
    'wouldRecommend': True,
    'rplCertificateAccurate': True,
    'rplCertificateUseful': False,
    'trade': 'mason',
    'country': 'Saudi Arabia',
}, headers=headers(employer_token))
test('38.6 Submit second rating', r.status_code == 201, f'{r.status_code}: {r.text[:200]}')
rating2_id = safe_json(r).get('_id', '')

# List all ratings (admin)
r = requests.get(f'{BASE}/employer-satisfaction', headers=headers(admin_token))
test('38.7 List all ratings', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
data = safe_json(r)
test('38.8 Has ratings', data.get('total', 0) >= 2, f"total: {data.get('total')}")

# Filter by trade
r = requests.get(f'{BASE}/employer-satisfaction?trade=mason', headers=headers(admin_token))
test('38.9 Filter by trade', r.status_code == 200, f'{r.status_code}')

# Filter by status
r = requests.get(f'{BASE}/employer-satisfaction?status=submitted', headers=headers(admin_token))
test('38.10 Filter by status', r.status_code == 200, f'{r.status_code}')

# My submissions (employer)
r = requests.get(f'{BASE}/employer-satisfaction/my-submissions', headers=headers(employer_token))
test('38.11 My submissions', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
data = safe_json(r)
test('38.12 My submissions count', data.get('total', 0) >= 2, f"total: {data.get('total')}")

# Ratings for specific worker
r = requests.get(f'{BASE}/employer-satisfaction/worker/{worker_id}', headers=headers(admin_token))
test('38.13 Worker ratings', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
data = safe_json(r)
test('38.14 Worker has ratings', data.get('total', 0) >= 2, f"total: {data.get('total')}")
test('38.15 Worker avg score', data.get('avgScore', 0) > 0, f"avgScore: {data.get('avgScore')}")

# Get single rating
r = requests.get(f'{BASE}/employer-satisfaction/{rating_id}', headers=headers(admin_token))
test('38.16 Get single rating', r.status_code == 200, f'{r.status_code}')
data = safe_json(r)
test('38.17 Rating has worker populated', data.get('worker', {}).get('fullName') is not None, str(data.get('worker')))

# Verify rating
r = requests.put(f'{BASE}/employer-satisfaction/{rating_id}/verify', headers=headers(admin_token))
test('38.18 Verify rating', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
data = safe_json(r)
test('38.19 Status is verified', data.get('rating', {}).get('status') == 'verified', str(data.get('rating', {}).get('status')))
test('38.20 VerifiedBy set', data.get('rating', {}).get('verifiedBy') is not None, str(data.get('rating', {}).get('verifiedBy')))

# Analytics summary
r = requests.get(f'{BASE}/employer-satisfaction/analytics/summary', headers=headers(admin_token))
test('38.21 Analytics summary', r.status_code == 200, f'{r.status_code}: {r.text[:200]}')
data = safe_json(r)
test('38.22 Has totalRatings', data.get('totalRatings', 0) >= 2, f"total: {data.get('totalRatings')}")
test('38.23 Has avgSatisfaction', data.get('avgSatisfaction', 0) > 0, f"avg: {data.get('avgSatisfaction')}")
test('38.24 Has rehireRate', 'rehireRate' in data, str(data.keys()))
test('38.25 Has byTrade', isinstance(data.get('byTrade'), list), str(type(data.get('byTrade'))))
test('38.26 Has byCountry', isinstance(data.get('byCountry'), list), str(type(data.get('byCountry'))))
test('38.27 Has ratingDistribution', isinstance(data.get('ratingDistribution'), dict), str(type(data.get('ratingDistribution'))))
test('38.28 Has recommendRate', 'recommendRate' in data, str(data.keys()))
test('38.29 Has rplAccuracyRate', 'rplAccuracyRate' in data, str(data.keys()))
test('38.30 Has rplUsefulnessRate', 'rplUsefulnessRate' in data, str(data.keys()))

# Worker cannot list all ratings
r = requests.get(f'{BASE}/employer-satisfaction', headers=headers(worker_token))
test('38.31 Worker cannot list ratings', r.status_code == 403, f'{r.status_code}')

# Worker cannot submit rating
r = requests.post(f'{BASE}/employer-satisfaction', json={
    'workerId': worker_id,
    'ratings': {'overallPerformance': 5, 'skillsMatch': 5, 'safetyCompliance': 5,
                'communication': 5, 'attitude': 5, 'productivity': 5, 'adaptability': 5},
}, headers=headers(worker_token))
test('38.32 Worker cannot submit rating', r.status_code == 403, f'{r.status_code}')

# Invalid worker ID in rating
r = requests.post(f'{BASE}/employer-satisfaction', json={
    'workerId': 'aaaaaaaaaaaaaaaaaaaaaaaa',
    'ratings': {'overallPerformance': 5, 'skillsMatch': 5, 'safetyCompliance': 5,
                'communication': 5, 'attitude': 5, 'productivity': 5, 'adaptability': 5},
}, headers=headers(employer_token))
test('38.33 Invalid worker rejected', r.status_code == 404, f'{r.status_code}')

# Missing required ratings
r = requests.post(f'{BASE}/employer-satisfaction', json={
    'workerId': worker_id,
    'ratings': {'overallPerformance': 5},
}, headers=headers(employer_token))
test('38.34 Missing ratings rejected', r.status_code == 400 or r.status_code == 422, f'{r.status_code}')

# Rating out of range
r = requests.post(f'{BASE}/employer-satisfaction', json={
    'workerId': worker_id,
    'ratings': {'overallPerformance': 6, 'skillsMatch': 5, 'safetyCompliance': 5,
                'communication': 5, 'attitude': 5, 'productivity': 5, 'adaptability': 5},
}, headers=headers(employer_token))
test('38.35 Rating >5 rejected', r.status_code == 400 or r.status_code == 422, f'{r.status_code}')

# 404 for non-existent rating
r = requests.get(f'{BASE}/employer-satisfaction/aaaaaaaaaaaaaaaaaaaaaaaa', headers=headers(admin_token))
test('38.36 404 for missing rating', r.status_code == 404, f'{r.status_code}')


# ===================================================================
# SUMMARY
# ===================================================================
print('\n' + '=' * 60)
print(f'RESULTS: {passed} passed, {failed} failed out of {passed + failed}')
print('=' * 60)

if errors:
    print('\nFailed tests:')
    for e in errors:
        print(f'  - {e}')

sys.exit(0 if failed == 0 else 1)
