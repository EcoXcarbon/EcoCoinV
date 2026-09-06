"""
TalentLedger: Complete Pipeline Test
Handles practical submissions + admin approval + quizzes + scenarios for ALL 100 programs.
"""
import requests
import json
import sys
import os

BASE = 'http://localhost:5000/api'

def generate_correct_answer(question):
    qtype = question.get('type', 'mcq')
    if qtype == 'mcq':
        return {'selectedOption': question.get('correctOption', 0)}
    elif qtype == 'true-false':
        return {'answer': question.get('correctAnswer', 'true')}
    elif qtype == 'fill-blank':
        acceptable = question.get('acceptableAnswers', [])
        if not acceptable and question.get('correctAnswer'):
            acceptable = [question['correctAnswer']]
        return {'answer': acceptable[0] if acceptable else 'answer'}
    elif qtype == 'matching':
        pairs = question.get('matchPairs', [])
        return {'pairs': [{'left': p['left'], 'right': p['right']} for p in pairs]}
    elif qtype == 'ordering':
        return {'order': question.get('correctOrder', [])}
    elif qtype == 'drag-drop':
        draggables = question.get('draggables', [])
        return {'placements': {d['id']: d['correctZone'] for d in draggables}}
    elif qtype == 'short-answer':
        acceptable = question.get('acceptableAnswers', [])
        if not acceptable and question.get('correctAnswer'):
            acceptable = [question['correctAnswer']]
        return {'answer': acceptable[0] if acceptable else 'answer'}
    elif qtype == 'essay':
        rubric = question.get('essayRubric', '')
        keywords = [k.strip() for k in rubric.replace(';', ',').split(',') if k.strip()] if rubric else []
        text = 'Comprehensive essay covering all key points. ' + ' '.join(keywords) + '. '
        text += 'This demonstrates understanding with practical application and safety awareness. ' * 3
        return {'answer': text}
    elif qtype == 'hotspot':
        regions = [r for r in question.get('hotspotRegions', []) if r.get('correct')]
        if regions:
            r = regions[0]
            return {'click': {'x': r['x'] + r['width'] / 2, 'y': r['y'] + r['height'] / 2}}
        return {'click': {'x': 50, 'y': 50}}
    else:
        return {'selectedOption': question.get('correctOption', 0)}

def generate_scenario_choices(scenario):
    choices = []
    if not scenario or not scenario.get('steps'):
        return choices
    current = scenario.get('startStepId')
    visited = set()
    while current and current not in visited:
        visited.add(current)
        step = next((st for st in scenario['steps'] if st['stepId'] == current), None)
        if not step or not step.get('choices'):
            break
        optimal_idx = next((i for i, ch in enumerate(step['choices']) if ch.get('isOptimal')), 0)
        choices.append({'stepId': current, 'choiceIndex': optimal_idx})
        nxt = step['choices'][optimal_idx].get('nextStepId')
        if not nxt:
            break
        current = nxt
    return choices

# ═══════════════════════════════════════════════════════════════
print('=' * 80)
print('  TalentLedger: Complete Pipeline Test (Submit + Approve + Complete)')
print('=' * 80)

# ── Setup sessions ──
admin_s = requests.Session()
al = admin_s.post(f'{BASE}/auth/login', json={'email': 'admin@ppmc.org.pk', 'password': 'Admin@2026'}, timeout=5)
admin_s.headers['Authorization'] = f'Bearer {al.json()["accessToken"]}'
print('[+] Admin session ready')

worker_s = requests.Session()
wl = worker_s.post(f'{BASE}/auth/login', json={'email': 'worker1@talentledger.pk', 'password': 'Worker@2026'}, timeout=5)
worker_s.headers['Authorization'] = f'Bearer {wl.json()["accessToken"]}'
worker_id = worker_s.get(f'{BASE}/workers', timeout=5).json()['workers'][0]['_id']
print(f'[+] Worker session ready: {worker_id}')

# Create a dummy PDF for practical submissions
dummy_pdf_path = os.path.join(os.path.dirname(__file__), 'dummy_evidence.pdf')
if not os.path.exists(dummy_pdf_path):
    with open(dummy_pdf_path, 'wb') as f:
        # Minimal valid PDF
        f.write(b'%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF')
    print('[+] Created dummy evidence PDF')

# ── Get all programs ──
programs = worker_s.get(f'{BASE}/training', timeout=15).json()
print(f'[+] {len(programs)} programs loaded\n')

# ── Results tracking ──
stats = {
    'programs': 0, 'fully_completed': 0,
    'video_ok': 0, 'reading_ok': 0,
    'practical_submit': 0, 'practical_approve': 0, 'practical_complete': 0, 'practical_fail': 0,
    'assignment_submit': 0, 'assignment_approve': 0, 'assignment_complete': 0, 'assignment_fail': 0,
    'quiz_pass': 0, 'quiz_fail': 0, 'quiz_error': 0,
    'scenario_pass': 0, 'scenario_fail': 0, 'scenario_error': 0,
    'certificates': 0,
}
errors = []

for idx, prog_summary in enumerate(programs):
    prog_id = prog_summary['_id']
    prog_title = prog_summary['title']
    stats['programs'] += 1

    # Get full details
    try:
        program = worker_s.get(f'{BASE}/training/{prog_id}', timeout=10).json()
    except Exception as e:
        errors.append({'prog': prog_title[:50], 'mod': 'N/A', 'err': f'Fetch: {e}'})
        continue

    modules = sorted(program.get('modules', []), key=lambda m: m.get('order', 0))
    my_enrollment = next((e for e in program.get('enrollments', []) if e.get('worker') == worker_id), None)
    if not my_enrollment:
        continue

    completed = set(str(m) for m in my_enrollment.get('completedModules', []))
    all_ok = True

    for mod in modules:
        mod_id = mod['_id']
        mod_title = mod.get('title', 'Untitled')
        mod_type = mod.get('type', 'video')

        if str(mod_id) in completed:
            # Already done
            if mod_type == 'video': stats['video_ok'] += 1
            elif mod_type == 'reading': stats['reading_ok'] += 1
            elif mod_type == 'quiz': stats['quiz_pass'] += 1
            elif mod_type == 'scenario': stats['scenario_pass'] += 1
            elif mod_type == 'practical': stats['practical_complete'] += 1
            elif mod_type == 'assignment': stats['assignment_complete'] += 1
            continue

        # ── VIDEO / READING ──
        if mod_type in ('video', 'reading'):
            r = worker_s.put(f'{BASE}/training/{prog_id}/progress',
                             json={'workerId': worker_id, 'moduleId': mod_id}, timeout=10)
            if r.status_code == 200:
                completed.add(str(mod_id))
                if mod_type == 'video': stats['video_ok'] += 1
                else: stats['reading_ok'] += 1
            else:
                err = r.json().get('error', '') if r.headers.get('content-type', '').startswith('application/json') else r.text[:100]
                errors.append({'prog': prog_title[:50], 'mod': mod_title[:40], 'err': f'{mod_type} complete: {r.status_code} {err}'})
                all_ok = False
                break

        # ── PRACTICAL / ASSIGNMENT ──
        elif mod_type in ('practical', 'assignment'):
            tag = 'practical' if mod_type == 'practical' else 'assignment'

            # Step 1: Worker submits evidence
            try:
                with open(dummy_pdf_path, 'rb') as f:
                    files = {'files': ('evidence.pdf', f, 'application/pdf')}
                    data = {
                        'workerId': worker_id,
                        'title': f'Evidence for {mod_title[:50]}',
                        'notes': 'Test submission',
                        'evidenceType': 'photo-of-work',
                    }
                    # Remove Content-Type header for multipart
                    headers = {'Authorization': worker_s.headers['Authorization']}
                    sub_r = requests.post(f'{BASE}/training/{prog_id}/submit/{mod_id}',
                                         files=files, data=data, headers=headers, timeout=15)

                if sub_r.status_code in (200, 201):
                    stats[f'{tag}_submit'] += 1
                    sub_data = sub_r.json()
                    submission_id = sub_data.get('_id', sub_data.get('submissionId', ''))

                    if not submission_id:
                        # Need to find the submission ID from the enrollment
                        prog_refresh = worker_s.get(f'{BASE}/training/{prog_id}', timeout=10).json()
                        my_enr = next((e for e in prog_refresh.get('enrollments', []) if e.get('worker') == worker_id), None)
                        if my_enr:
                            subs = [s for s in my_enr.get('submissions', []) if str(s.get('moduleId')) == str(mod_id)]
                            if subs:
                                submission_id = subs[-1].get('_id', '')

                    if submission_id:
                        # Step 2: Admin approves
                        review_r = admin_s.put(f'{BASE}/training/{prog_id}/submissions/{submission_id}/review',
                                               json={'status': 'approved', 'grade': 85, 'feedback': 'Good work - approved for testing'},
                                               timeout=10)
                        if review_r.status_code == 200:
                            stats[f'{tag}_approve'] += 1

                            # Step 3: Worker marks complete
                            comp_r = worker_s.put(f'{BASE}/training/{prog_id}/progress',
                                                  json={'workerId': worker_id, 'moduleId': mod_id}, timeout=10)
                            if comp_r.status_code == 200:
                                completed.add(str(mod_id))
                                stats[f'{tag}_complete'] += 1
                            else:
                                err = comp_r.json().get('error', '') if comp_r.headers.get('content-type', '').startswith('application/json') else comp_r.text[:100]
                                errors.append({'prog': prog_title[:50], 'mod': mod_title[:40], 'err': f'{tag} complete after approve: {comp_r.status_code} {err}'})
                                stats[f'{tag}_fail'] += 1
                                all_ok = False
                                break
                        else:
                            err = review_r.json().get('error', '') if review_r.headers.get('content-type', '').startswith('application/json') else review_r.text[:100]
                            errors.append({'prog': prog_title[:50], 'mod': mod_title[:40], 'err': f'{tag} approve: {review_r.status_code} {err}'})
                            stats[f'{tag}_fail'] += 1
                            all_ok = False
                            break
                    else:
                        errors.append({'prog': prog_title[:50], 'mod': mod_title[:40], 'err': f'No submission ID returned'})
                        stats[f'{tag}_fail'] += 1
                        all_ok = False
                        break
                else:
                    err = sub_r.text[:200]
                    errors.append({'prog': prog_title[:50], 'mod': mod_title[:40], 'err': f'{tag} submit: {sub_r.status_code} {err[:100]}'})
                    stats[f'{tag}_fail'] += 1
                    all_ok = False
                    break
            except Exception as e:
                errors.append({'prog': prog_title[:50], 'mod': mod_title[:40], 'err': f'{tag} exception: {str(e)[:100]}'})
                stats[f'{tag}_fail'] += 1
                all_ok = False
                break

        # ── SCENARIO ──
        elif mod_type == 'scenario':
            scenario = mod.get('scenario', {})
            choices = generate_scenario_choices(scenario)
            if not choices:
                # Try direct complete (empty scenario)
                r = worker_s.put(f'{BASE}/training/{prog_id}/progress',
                                 json={'workerId': worker_id, 'moduleId': mod_id}, timeout=10)
                if r.status_code == 200:
                    completed.add(str(mod_id))
                    stats['scenario_pass'] += 1
                else:
                    errors.append({'prog': prog_title[:50], 'mod': mod_title[:40], 'err': f'scenario empty complete: {r.status_code}'})
                    stats['scenario_error'] += 1
                    all_ok = False
                    break
            else:
                r = worker_s.post(f'{BASE}/training/{prog_id}/scenario/{mod_id}',
                                   json={'workerId': worker_id, 'choices': choices}, timeout=15)
                if r.status_code == 200:
                    data = r.json()
                    if data.get('passed'):
                        stats['scenario_pass'] += 1
                        completed.add(str(mod_id))
                    else:
                        stats['scenario_fail'] += 1
                        errors.append({'prog': prog_title[:50], 'mod': mod_title[:40], 'err': f'scenario failed: {data.get("score")}/{data.get("maxScore")}'})
                        all_ok = False
                        break
                else:
                    err = r.text[:100]
                    errors.append({'prog': prog_title[:50], 'mod': mod_title[:40], 'err': f'scenario API: {r.status_code} {err}'})
                    stats['scenario_error'] += 1
                    all_ok = False
                    break

        # ── QUIZ ──
        elif mod_type == 'quiz':
            quiz_questions = mod.get('quizQuestions', [])
            if not quiz_questions:
                r = worker_s.put(f'{BASE}/training/{prog_id}/progress',
                                 json={'workerId': worker_id, 'moduleId': mod_id}, timeout=10)
                if r.status_code == 200:
                    completed.add(str(mod_id))
                    stats['quiz_pass'] += 1
                else:
                    stats['quiz_error'] += 1
                    errors.append({'prog': prog_title[:50], 'mod': mod_title[:40], 'err': f'quiz empty: {r.status_code}'})
                    all_ok = False
                    break
            else:
                answers = [generate_correct_answer(q) for q in quiz_questions]
                r = worker_s.post(f'{BASE}/training/{prog_id}/quiz/{mod_id}',
                                   json={'workerId': worker_id, 'answers': answers}, timeout=15)
                if r.status_code == 200:
                    data = r.json()
                    if data.get('passed'):
                        stats['quiz_pass'] += 1
                        completed.add(str(mod_id))
                    else:
                        stats['quiz_fail'] += 1
                        q_types = list(set(q.get('type', 'mcq') for q in quiz_questions))
                        errors.append({'prog': prog_title[:50], 'mod': mod_title[:40], 'err': f'quiz failed: {data.get("score")}% ({data.get("correctAnswers")}/{data.get("totalQuestions")}), types={q_types}'})
                        all_ok = False
                        break
                else:
                    err = r.text[:100]
                    stats['quiz_error'] += 1
                    errors.append({'prog': prog_title[:50], 'mod': mod_title[:40], 'err': f'quiz API: {r.status_code} {err}'})
                    all_ok = False
                    break

        else:
            # Unknown type
            r = worker_s.put(f'{BASE}/training/{prog_id}/progress',
                             json={'workerId': worker_id, 'moduleId': mod_id}, timeout=10)
            if r.status_code == 200:
                completed.add(str(mod_id))
            else:
                all_ok = False
                break

    # Check if fully completed
    pct = len(completed) * 100 // max(len(modules), 1)
    if pct >= 100:
        stats['fully_completed'] += 1
        # Check if certificate was issued
        prog_final = worker_s.get(f'{BASE}/training/{prog_id}', timeout=10).json()
        my_enr = next((e for e in prog_final.get('enrollments', []) if e.get('worker') == worker_id), None)
        if my_enr and my_enr.get('certificateIssued'):
            stats['certificates'] += 1
            cert_tag = ' [CERT]'
        else:
            cert_tag = ''
        print(f'  [{idx+1:3d}/{len(programs)}] DONE  {prog_title[:50]:50s} | 100%{cert_tag}')
    else:
        err_count = sum(1 for e in errors if e['prog'] == prog_title[:50])
        status = 'ISSUE' if err_count > 0 else 'PART'
        print(f'  [{idx+1:3d}/{len(programs)}] {status:5s} {prog_title[:50]:50s} | {pct:3d}% ({len(completed)}/{len(modules)})')

# ═══════════════════════════════════════════════════════════════
print('\n' + '=' * 80)
print('  FINAL RESULTS')
print('=' * 80)
print(f'  Programs:           {stats["programs"]}')
print(f'  Fully completed:    {stats["fully_completed"]}')
print(f'  Certificates:       {stats["certificates"]}')
print(f'  Video OK:           {stats["video_ok"]}')
print(f'  Reading OK:         {stats["reading_ok"]}')
print(f'  Practical:          {stats["practical_complete"]} OK / {stats["practical_submit"]} submitted / {stats["practical_approve"]} approved / {stats["practical_fail"]} failed')
print(f'  Assignment:         {stats["assignment_complete"]} OK / {stats["assignment_submit"]} submitted / {stats["assignment_approve"]} approved / {stats["assignment_fail"]} failed')
print(f'  Quiz:               {stats["quiz_pass"]} passed / {stats["quiz_fail"]} failed / {stats["quiz_error"]} errors')
print(f'  Scenario:           {stats["scenario_pass"]} passed / {stats["scenario_fail"]} failed / {stats["scenario_error"]} errors')
print(f'  Errors:             {len(errors)}')

if errors:
    print('\n' + '-' * 80)
    print('  ERROR DETAILS')
    print('-' * 80)
    for i, e in enumerate(errors[:50]):
        print(f'  [{i+1:3d}] {e["prog"]:50s} >> {e["mod"]}')
        print(f'        {e["err"]}')

print('\n' + '=' * 80)
with open('E:/fintech/skills passport/talentledger/server/src/__tests__/full_pipeline_results.json', 'w') as f:
    json.dump({'stats': stats, 'errors': errors}, f, indent=2)
print('Results saved to full_pipeline_results.json')
