"""
TalentLedger: Complete Full Module Chain Testing
Uses admin to bypass practical/assignment approval gates, then tests quizzes and scenarios.
"""
import requests
import json
import sys

BASE = 'http://localhost:5000/api'

# ── Helper functions ──────────────────────────────────────────
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
        answer_text = 'This is a comprehensive essay answer covering all key points. '
        answer_text += ' '.join(keywords) + '. '
        answer_text += 'In conclusion, this demonstrates full understanding of the topic with practical application and safety awareness. ' * 3
        return {'answer': answer_text}
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
        optimal_idx = 0
        for i, ch in enumerate(step['choices']):
            if ch.get('isOptimal'):
                optimal_idx = i
                break
        choices.append({'stepId': current, 'choiceIndex': optimal_idx})
        nxt = step['choices'][optimal_idx].get('nextStepId')
        if not nxt:
            break
        current = nxt
    return choices


# ═══════════════════════════════════════════════════════════════
print('=' * 80)
print('  TalentLedger: Quiz & Scenario Deep Testing')
print('  (Uses admin to approve practicals, then tests all quizzes/scenarios)')
print('=' * 80)

# ── Setup admin session ──
admin_s = requests.Session()
admin_login = admin_s.post(f'{BASE}/auth/login', json={'email': 'admin@ppmc.org.pk', 'password': 'Admin@2026'}, timeout=5)
if admin_login.status_code != 200:
    print(f'Admin login failed: {admin_login.status_code}')
    sys.exit(1)
admin_token = admin_login.json().get('accessToken', admin_login.json().get('token', ''))
admin_s.headers['Authorization'] = f'Bearer {admin_token}'
print('[+] Admin logged in')

# ── Setup worker session ──
worker_s = requests.Session()
worker_login = worker_s.post(f'{BASE}/auth/login', json={'email': 'worker1@talentledger.pk', 'password': 'Worker@2026'}, timeout=5)
worker_token = worker_login.json().get('accessToken', worker_login.json().get('token', ''))
worker_s.headers['Authorization'] = f'Bearer {worker_token}'
worker_id = worker_s.get(f'{BASE}/workers', timeout=5).json()['workers'][0]['_id']
print(f'[+] Worker logged in: {worker_id}')

# ── Get all programs ──
programs = worker_s.get(f'{BASE}/training', timeout=15).json()
print(f'[+] {len(programs)} programs loaded\n')

# ── Results ──
quiz_results = []
scenario_results = []
errors = []

for idx, prog_summary in enumerate(programs):
    prog_id = prog_summary['_id']
    prog_title = prog_summary['title']

    # Get full details
    try:
        program = worker_s.get(f'{BASE}/training/{prog_id}', timeout=10).json()
    except:
        continue

    modules = sorted(program.get('modules', []), key=lambda m: m.get('order', 0))
    enrollments = program.get('enrollments', [])
    my_enrollment = next((e for e in enrollments if e.get('worker') == worker_id), None)

    if not my_enrollment:
        continue  # Not enrolled from previous test

    completed_modules = [str(m) for m in my_enrollment.get('completedModules', [])]

    # ── Force-complete all modules sequentially using admin ──
    for mod in modules:
        mod_id = mod['_id']
        mod_type = mod.get('type', 'video')
        mod_title = mod.get('title', 'Untitled')

        if str(mod_id) in completed_modules:
            continue

        if mod_type in ('video', 'reading'):
            # Worker can complete these directly
            r = worker_s.put(f'{BASE}/training/{prog_id}/progress',
                             json={'workerId': worker_id, 'moduleId': mod_id}, timeout=10)
            if r.status_code == 200:
                completed_modules.append(str(mod_id))
            else:
                err = r.json().get('error', r.text[:100]) if r.headers.get('content-type', '').startswith('application/json') else r.text[:100]
                errors.append({'prog': prog_title[:50], 'mod': mod_title[:40], 'type': 'COMPLETE', 'detail': f'{r.status_code}: {err}'})
                break

        elif mod_type in ('practical', 'assignment'):
            # Admin directly marks as complete (admin bypasses the approval gate check)
            r = admin_s.put(f'{BASE}/training/{prog_id}/progress',
                            json={'workerId': worker_id, 'moduleId': mod_id}, timeout=10)
            if r.status_code == 200:
                completed_modules.append(str(mod_id))
            else:
                err = r.json().get('error', r.text[:100]) if r.headers.get('content-type', '').startswith('application/json') else r.text[:100]
                # If admin can't bypass either, log it and try to continue
                errors.append({'prog': prog_title[:50], 'mod': mod_title[:40], 'type': 'ADMIN_COMPLETE', 'detail': f'{r.status_code}: {err}'})
                break

        elif mod_type == 'scenario':
            scenario = mod.get('scenario', {})
            choices = generate_scenario_choices(scenario)

            if not choices:
                # Try direct completion
                r = worker_s.put(f'{BASE}/training/{prog_id}/progress',
                                 json={'workerId': worker_id, 'moduleId': mod_id}, timeout=10)
                if r.status_code == 200:
                    completed_modules.append(str(mod_id))
                    scenario_results.append({'prog': prog_title[:50], 'mod': mod_title[:40], 'status': 'PASS', 'score': 'N/A (no steps)'})
                else:
                    errors.append({'prog': prog_title[:50], 'mod': mod_title[:40], 'type': 'SCENARIO_EMPTY', 'detail': str(r.status_code)})
                    break
            else:
                r = worker_s.post(f'{BASE}/training/{prog_id}/scenario/{mod_id}',
                                   json={'workerId': worker_id, 'choices': choices}, timeout=15)
                if r.status_code == 200:
                    data = r.json()
                    sc_passed = data.get('passed', False)
                    sc_score = data.get('score', 0)
                    sc_max = data.get('maxScore', 0)

                    if sc_passed:
                        # Mark complete
                        pr = worker_s.put(f'{BASE}/training/{prog_id}/progress',
                                          json={'workerId': worker_id, 'moduleId': mod_id}, timeout=10)
                        if pr.status_code == 200:
                            completed_modules.append(str(mod_id))
                            scenario_results.append({'prog': prog_title[:50], 'mod': mod_title[:40], 'status': 'PASS', 'score': f'{sc_score}/{sc_max}'})
                        else:
                            err = pr.json().get('error', '')
                            errors.append({'prog': prog_title[:50], 'mod': mod_title[:40], 'type': 'SCENARIO_COMPLETE', 'detail': f'Passed but: {pr.status_code} {err}'})
                            scenario_results.append({'prog': prog_title[:50], 'mod': mod_title[:40], 'status': 'PASS_NO_COMPLETE', 'score': f'{sc_score}/{sc_max}'})
                            break
                    else:
                        scenario_results.append({'prog': prog_title[:50], 'mod': mod_title[:40], 'status': 'FAIL', 'score': f'{sc_score}/{sc_max}'})
                        errors.append({'prog': prog_title[:50], 'mod': mod_title[:40], 'type': 'SCENARIO_FAIL', 'detail': f'Score {sc_score}/{sc_max}'})
                        break
                else:
                    err = r.text[:200]
                    errors.append({'prog': prog_title[:50], 'mod': mod_title[:40], 'type': 'SCENARIO_API', 'detail': f'{r.status_code}: {err}'})
                    scenario_results.append({'prog': prog_title[:50], 'mod': mod_title[:40], 'status': 'ERROR', 'score': f'{r.status_code}'})
                    break

        elif mod_type == 'quiz':
            quiz_questions = mod.get('quizQuestions', [])
            q_types = list(set(q.get('type', 'mcq') for q in quiz_questions))

            if not quiz_questions:
                r = worker_s.put(f'{BASE}/training/{prog_id}/progress',
                                 json={'workerId': worker_id, 'moduleId': mod_id}, timeout=10)
                if r.status_code == 200:
                    completed_modules.append(str(mod_id))
                    quiz_results.append({'prog': prog_title[:50], 'mod': mod_title[:40], 'status': 'PASS', 'score': 'N/A (no-questions)', 'q_types': [], 'q_count': 0})
                else:
                    err = r.json().get('error', '')
                    quiz_results.append({'prog': prog_title[:50], 'mod': mod_title[:40], 'status': 'FAIL', 'score': f'empty: {err}', 'q_types': [], 'q_count': 0})
                    errors.append({'prog': prog_title[:50], 'mod': mod_title[:40], 'type': 'QUIZ_EMPTY', 'detail': err})
                    break
            else:
                answers = [generate_correct_answer(q) for q in quiz_questions]
                r = worker_s.post(f'{BASE}/training/{prog_id}/quiz/{mod_id}',
                                   json={'workerId': worker_id, 'answers': answers}, timeout=15)
                if r.status_code == 200:
                    data = r.json()
                    score = data.get('score', 0)
                    passed = data.get('passed', False)
                    correct = data.get('correctAnswers', 0)
                    total = data.get('totalQuestions', 0)

                    if passed:
                        # Mark complete
                        pr = worker_s.put(f'{BASE}/training/{prog_id}/progress',
                                          json={'workerId': worker_id, 'moduleId': mod_id}, timeout=10)
                        if pr.status_code == 200:
                            completed_modules.append(str(mod_id))
                            quiz_results.append({'prog': prog_title[:50], 'mod': mod_title[:40], 'status': 'PASS', 'score': f'{score}% ({correct}/{total})', 'q_types': q_types, 'q_count': len(quiz_questions)})
                        else:
                            err = pr.json().get('error', '')
                            quiz_results.append({'prog': prog_title[:50], 'mod': mod_title[:40], 'status': 'PASS_NO_COMPLETE', 'score': f'{score}% but: {err}', 'q_types': q_types, 'q_count': len(quiz_questions)})
                            errors.append({'prog': prog_title[:50], 'mod': mod_title[:40], 'type': 'QUIZ_COMPLETE', 'detail': f'Quiz passed but: {pr.status_code} {err}'})
                            break
                    else:
                        quiz_results.append({'prog': prog_title[:50], 'mod': mod_title[:40], 'status': 'FAIL', 'score': f'{score}% ({correct}/{total})', 'q_types': q_types, 'q_count': len(quiz_questions)})
                        errors.append({'prog': prog_title[:50], 'mod': mod_title[:40], 'type': 'QUIZ_FAIL', 'detail': f'Score: {score}% ({correct}/{total}), types={q_types}'})
                        break
                else:
                    err = r.text[:200]
                    quiz_results.append({'prog': prog_title[:50], 'mod': mod_title[:40], 'status': 'ERROR', 'score': f'{r.status_code}', 'q_types': q_types, 'q_count': len(quiz_questions)})
                    errors.append({'prog': prog_title[:50], 'mod': mod_title[:40], 'type': 'QUIZ_API', 'detail': f'{r.status_code}: {err}'})
                    break
        else:
            # Unknown type — try admin complete
            r = admin_s.put(f'{BASE}/training/{prog_id}/progress',
                            json={'workerId': worker_id, 'moduleId': mod_id}, timeout=10)
            if r.status_code == 200:
                completed_modules.append(str(mod_id))
            else:
                break

    # Progress indicator
    q_done = len([q for q in quiz_results if q['prog'] == prog_title[:50]])
    s_done = len([sc for sc in scenario_results if sc['prog'] == prog_title[:50]])
    status = 'OK' if not any(e['prog'] == prog_title[:50] for e in errors) else 'ISSUE'
    completed_pct = len(completed_modules) * 100 // max(len(modules), 1)
    print(f'  [{idx+1:3d}/{len(programs)}] {status:5s} {prog_title[:50]:50s} | {completed_pct:3d}% | Q:{q_done} S:{s_done}')

# ═══════════════════════════════════════════════════════════════
print('\n' + '=' * 80)
print('  QUIZ RESULTS')
print('=' * 80)
quiz_pass = sum(1 for q in quiz_results if q['status'] == 'PASS')
quiz_fail = sum(1 for q in quiz_results if q['status'] == 'FAIL')
quiz_err = sum(1 for q in quiz_results if q['status'] in ('ERROR', 'PASS_NO_COMPLETE'))
print(f'  Passed: {quiz_pass}  |  Failed: {quiz_fail}  |  Errors: {quiz_err}  |  Total: {len(quiz_results)}')
for q in quiz_results:
    icon = 'PASS' if q['status'] == 'PASS' else 'FAIL' if q['status'] == 'FAIL' else 'ERR '
    print(f'  [{icon}] {q["prog"]:50s} | {q["score"]:20s} | Types: {q["q_types"]}')

print('\n' + '=' * 80)
print('  SCENARIO RESULTS')
print('=' * 80)
sc_pass = sum(1 for s in scenario_results if s['status'] == 'PASS')
sc_fail = sum(1 for s in scenario_results if s['status'] == 'FAIL')
sc_err = sum(1 for s in scenario_results if s['status'] in ('ERROR', 'PASS_NO_COMPLETE'))
print(f'  Passed: {sc_pass}  |  Failed: {sc_fail}  |  Errors: {sc_err}  |  Total: {len(scenario_results)}')
for sc in scenario_results:
    icon = 'PASS' if sc['status'] == 'PASS' else 'FAIL' if sc['status'] == 'FAIL' else 'ERR '
    print(f'  [{icon}] {sc["prog"]:50s} | Score: {sc["score"]}')

if errors:
    print('\n' + '=' * 80)
    print(f'  ERRORS ({len(errors)})')
    print('=' * 80)
    for i, e in enumerate(errors):
        print(f'  [{i+1:3d}] {e["type"]:25s} | {e["prog"]} >> {e["mod"]}')
        print(f'        {e["detail"]}')

print('\n' + '=' * 80)

# Save
with open('E:/fintech/skills passport/talentledger/server/src/__tests__/quiz_scenario_results.json', 'w') as f:
    json.dump({'quizzes': quiz_results, 'scenarios': scenario_results, 'errors': errors}, f, indent=2)
print('Results saved to quiz_scenario_results.json')
