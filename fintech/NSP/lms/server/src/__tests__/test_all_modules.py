"""
TalentLedger: Comprehensive Training Module Testing Script
Tests all training programs (enrollment, module completion, quizzes, assessments)
"""
import requests
import json
import sys
import time

BASE = 'http://localhost:5000/api'

# ── Session setup ─────────────────────────────────────────────
s = requests.Session()
s.headers['Content-Type'] = 'application/json'

def login(email, password):
    r = s.post(f'{BASE}/auth/login', json={'email': email, 'password': password}, timeout=10)
    if r.status_code != 200:
        print(f'Login failed for {email}: {r.status_code} {r.text[:200]}')
        sys.exit(1)
    token = r.json().get('accessToken', r.json().get('token', ''))
    s.headers['Authorization'] = f'Bearer {token}'
    return r.json()

def get_worker_id():
    workers = s.get(f'{BASE}/workers', timeout=10).json()
    w_list = workers.get('workers', [])
    if w_list:
        return w_list[0]['_id']
    return None

# ── Quiz answer generators for all question types ─────────────
def generate_correct_answer(question):
    """Generate the correct answer object for any question type."""
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
        placements = {d['id']: d['correctZone'] for d in draggables}
        return {'placements': placements}

    elif qtype == 'short-answer':
        acceptable = question.get('acceptableAnswers', [])
        if not acceptable and question.get('correctAnswer'):
            acceptable = [question['correctAnswer']]
        return {'answer': acceptable[0] if acceptable else 'answer'}

    elif qtype == 'essay':
        rubric = question.get('essayRubric', '')
        # Extract keywords from rubric to build a comprehensive answer
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
        # Default MCQ
        return {'selectedOption': question.get('correctOption', 0)}


def generate_scenario_choices(scenario):
    """Generate optimal choices for a scenario module."""
    choices = []
    if not scenario or not scenario.get('steps'):
        return choices

    current_step_id = scenario.get('startStepId')
    visited = set()

    while current_step_id and current_step_id not in visited:
        visited.add(current_step_id)
        step = next((st for st in scenario['steps'] if st['stepId'] == current_step_id), None)
        if not step or not step.get('choices'):
            break

        # Find optimal choice
        optimal_idx = 0
        for i, choice in enumerate(step['choices']):
            if choice.get('isOptimal'):
                optimal_idx = i
                break

        choices.append({'stepId': current_step_id, 'choiceIndex': optimal_idx})

        # Move to next step
        next_step = step['choices'][optimal_idx].get('nextStepId')
        if not next_step:
            break
        current_step_id = next_step

    return choices


# ═══════════════════════════════════════════════════════════════
#   MAIN TEST SCRIPT
# ═══════════════════════════════════════════════════════════════

print('=' * 80)
print('  TalentLedger: Comprehensive Training Module Test')
print('=' * 80)

# Login as worker
print('\n[1] Logging in as worker1@talentledger.pk...')
login('worker1@talentledger.pk', 'Worker@2026')
worker_id = get_worker_id()
print(f'    Worker ID: {worker_id}')

# Get all training programs
print('\n[2] Fetching all training programs...')
programs = s.get(f'{BASE}/training', timeout=15).json()
print(f'    Total programs: {len(programs)}')

# We need the first 50 programs as specified by user
# The list returns 100 (limited by default), let's check which ones to test
# The user said "50 modules" - there are 50 NAVTTC + 50 Gulf programs
# Let's test all 100 but the user referred to 50 pathways

# Get program IDs
program_ids = [p['_id'] for p in programs]

# ── Test results tracking ──────────────────────────────────────
results = {
    'total_programs': 0,
    'programs_tested': 0,
    'enroll_success': 0,
    'enroll_fail': 0,
    'enroll_already': 0,
    'module_complete_success': 0,
    'module_complete_fail': 0,
    'quiz_pass': 0,
    'quiz_fail': 0,
    'quiz_error': 0,
    'scenario_pass': 0,
    'scenario_fail': 0,
    'scenario_error': 0,
    'video_complete': 0,
    'reading_complete': 0,
    'practical_skip': 0,
    'assignment_skip': 0,
    'scorm_skip': 0,
    'errors': [],
}

def log_error(program_title, module_title, error_type, detail):
    results['errors'].append({
        'program': program_title[:50],
        'module': module_title[:50] if module_title else 'N/A',
        'type': error_type,
        'detail': str(detail)[:200],
    })

# ── Test each program ──────────────────────────────────────────
print(f'\n[3] Testing {len(programs)} programs...\n')

for idx, prog_summary in enumerate(programs):
    prog_id = prog_summary['_id']
    prog_title = prog_summary['title']
    prog_trade = prog_summary['trade']
    results['total_programs'] += 1

    # Get full program details
    try:
        detail_r = s.get(f'{BASE}/training/{prog_id}', timeout=10)
        if detail_r.status_code != 200:
            log_error(prog_title, None, 'FETCH_FAIL', f'GET /{prog_id} returned {detail_r.status_code}')
            print(f'  [{idx+1:3d}/{ len(programs)}] FAIL {prog_title[:55]} | Cannot fetch details: {detail_r.status_code}')
            continue
        program = detail_r.json()
    except Exception as e:
        log_error(prog_title, None, 'FETCH_ERROR', str(e))
        print(f'  [{idx+1:3d}/{len(programs)}] ERR  {prog_title[:55]} | {e}')
        continue

    modules = program.get('modules', [])
    # Sort by order
    modules.sort(key=lambda m: m.get('order', 0))
    enrollments = program.get('enrollments', [])
    my_enrollment = next((e for e in enrollments if e.get('worker') == worker_id), None)

    # ── Step A: Enroll if not already enrolled ──
    if not my_enrollment:
        try:
            enroll_r = s.post(f'{BASE}/training/{prog_id}/enroll',
                              json={'workerId': worker_id}, timeout=10)
            if enroll_r.status_code == 201:
                results['enroll_success'] += 1
            elif enroll_r.status_code == 409:
                results['enroll_already'] += 1
            else:
                results['enroll_fail'] += 1
                err_msg = enroll_r.json().get('error', enroll_r.text[:100])
                log_error(prog_title, None, 'ENROLL_FAIL', f'{enroll_r.status_code}: {err_msg}')
                print(f'  [{idx+1:3d}/{len(programs)}] FAIL {prog_title[:55]} | Enroll: {enroll_r.status_code} {err_msg}')
                continue
        except Exception as e:
            results['enroll_fail'] += 1
            log_error(prog_title, None, 'ENROLL_ERROR', str(e))
            print(f'  [{idx+1:3d}/{len(programs)}] ERR  {prog_title[:55]} | Enroll error: {e}')
            continue
    else:
        results['enroll_already'] += 1

    # ── Re-fetch program after enrollment to get fresh enrollment data ──
    try:
        program = s.get(f'{BASE}/training/{prog_id}', timeout=10).json()
        modules = program.get('modules', [])
        modules.sort(key=lambda m: m.get('order', 0))
        enrollments = program.get('enrollments', [])
        my_enrollment = next((e for e in enrollments if e.get('worker') == worker_id), None)
    except:
        pass

    if not my_enrollment:
        log_error(prog_title, None, 'NO_ENROLLMENT', 'Enrollment not found after enroll')
        print(f'  [{idx+1:3d}/{len(programs)}] FAIL {prog_title[:55]} | No enrollment found')
        continue

    completed_modules = [str(m) for m in my_enrollment.get('completedModules', [])]

    # ── Step B: Process each module ──
    module_results = []
    prog_ok = True

    for mod_idx, mod in enumerate(modules):
        mod_id = mod['_id']
        mod_title = mod.get('title', 'Untitled')
        mod_type = mod.get('type', 'video')

        # Already completed?
        if str(mod_id) in completed_modules:
            module_results.append(f'{mod_type}:DONE')
            if mod_type == 'quiz':
                results['quiz_pass'] += 1
            elif mod_type == 'scenario':
                results['scenario_pass'] += 1
            elif mod_type == 'video':
                results['video_complete'] += 1
            elif mod_type == 'reading':
                results['reading_complete'] += 1
            continue

        # ── Handle by module type ──
        if mod_type in ('video', 'reading'):
            # Simple completion — mark as done
            try:
                progress_r = s.put(f'{BASE}/training/{prog_id}/progress',
                                    json={'workerId': worker_id, 'moduleId': mod_id}, timeout=10)
                if progress_r.status_code == 200:
                    results['module_complete_success'] += 1
                    if mod_type == 'video':
                        results['video_complete'] += 1
                    else:
                        results['reading_complete'] += 1
                    module_results.append(f'{mod_type}:OK')
                    completed_modules.append(str(mod_id))
                else:
                    err = progress_r.json().get('error', progress_r.text[:100])
                    results['module_complete_fail'] += 1
                    log_error(prog_title, mod_title, 'PROGRESS_FAIL', f'{progress_r.status_code}: {err}')
                    module_results.append(f'{mod_type}:FAIL({progress_r.status_code})')
                    prog_ok = False
                    break  # Sequential - can't continue if this fails
            except Exception as e:
                results['module_complete_fail'] += 1
                log_error(prog_title, mod_title, 'PROGRESS_ERROR', str(e))
                module_results.append(f'{mod_type}:ERR')
                prog_ok = False
                break

        elif mod_type == 'quiz':
            # Need to submit quiz answers first, then mark complete
            quiz_questions = mod.get('quizQuestions', [])
            if not quiz_questions:
                # No questions — try to complete directly
                try:
                    progress_r = s.put(f'{BASE}/training/{prog_id}/progress',
                                        json={'workerId': worker_id, 'moduleId': mod_id}, timeout=10)
                    if progress_r.status_code == 200:
                        results['quiz_pass'] += 1
                        module_results.append('quiz:OK(no-questions)')
                        completed_modules.append(str(mod_id))
                    else:
                        err = progress_r.json().get('error', '')
                        results['quiz_error'] += 1
                        log_error(prog_title, mod_title, 'QUIZ_EMPTY', f'No questions, completion: {progress_r.status_code} {err}')
                        module_results.append(f'quiz:FAIL(empty)')
                        prog_ok = False
                        break
                except Exception as e:
                    results['quiz_error'] += 1
                    log_error(prog_title, mod_title, 'QUIZ_ERROR', str(e))
                    module_results.append('quiz:ERR')
                    prog_ok = False
                    break
            else:
                # Generate correct answers
                answers = [generate_correct_answer(q) for q in quiz_questions]
                try:
                    quiz_r = s.post(f'{BASE}/training/{prog_id}/quiz/{mod_id}',
                                     json={'workerId': worker_id, 'answers': answers}, timeout=15)
                    if quiz_r.status_code == 200:
                        quiz_data = quiz_r.json()
                        score = quiz_data.get('score', 0)
                        passed = quiz_data.get('passed', False)

                        if passed:
                            results['quiz_pass'] += 1
                            # Now mark module as complete
                            progress_r = s.put(f'{BASE}/training/{prog_id}/progress',
                                                json={'workerId': worker_id, 'moduleId': mod_id}, timeout=10)
                            if progress_r.status_code == 200:
                                results['module_complete_success'] += 1
                                completed_modules.append(str(mod_id))
                                module_results.append(f'quiz:PASS({score}%)')
                            else:
                                err = progress_r.json().get('error', '')
                                results['module_complete_fail'] += 1
                                log_error(prog_title, mod_title, 'QUIZ_COMPLETE_FAIL', f'Quiz passed but completion failed: {progress_r.status_code} {err}')
                                module_results.append(f'quiz:PASS({score}%)-COMPLETE_FAIL')
                                prog_ok = False
                                break
                        else:
                            results['quiz_fail'] += 1
                            log_error(prog_title, mod_title, 'QUIZ_FAILED', f'Score: {score}%, q_count={len(quiz_questions)}, q_types={list(set(q.get("type","mcq") for q in quiz_questions))}')
                            module_results.append(f'quiz:FAIL({score}%)')
                            prog_ok = False
                            break
                    else:
                        err = quiz_r.json().get('error', quiz_r.text[:100]) if quiz_r.headers.get('content-type','').startswith('application/json') else quiz_r.text[:100]
                        results['quiz_error'] += 1
                        log_error(prog_title, mod_title, 'QUIZ_API_ERROR', f'{quiz_r.status_code}: {err}')
                        module_results.append(f'quiz:ERR({quiz_r.status_code})')
                        prog_ok = False
                        break
                except Exception as e:
                    results['quiz_error'] += 1
                    log_error(prog_title, mod_title, 'QUIZ_EXCEPTION', str(e))
                    module_results.append('quiz:ERR')
                    prog_ok = False
                    break

        elif mod_type == 'scenario':
            scenario = mod.get('scenario', {})
            if not scenario or not scenario.get('steps'):
                # Try direct completion
                try:
                    progress_r = s.put(f'{BASE}/training/{prog_id}/progress',
                                        json={'workerId': worker_id, 'moduleId': mod_id}, timeout=10)
                    if progress_r.status_code == 200:
                        results['scenario_pass'] += 1
                        module_results.append('scenario:OK(no-steps)')
                        completed_modules.append(str(mod_id))
                    else:
                        err = progress_r.json().get('error', '')
                        results['scenario_error'] += 1
                        log_error(prog_title, mod_title, 'SCENARIO_EMPTY', f'{progress_r.status_code}: {err}')
                        module_results.append('scenario:FAIL(empty)')
                        prog_ok = False
                        break
                except Exception as e:
                    results['scenario_error'] += 1
                    log_error(prog_title, mod_title, 'SCENARIO_ERROR', str(e))
                    module_results.append('scenario:ERR')
                    prog_ok = False
                    break
            else:
                choices = generate_scenario_choices(scenario)
                try:
                    scenario_r = s.post(f'{BASE}/training/{prog_id}/scenario/{mod_id}',
                                         json={'workerId': worker_id, 'choices': choices}, timeout=15)
                    if scenario_r.status_code == 200:
                        sc_data = scenario_r.json()
                        sc_passed = sc_data.get('passed', False)
                        sc_score = sc_data.get('score', 0)

                        if sc_passed:
                            results['scenario_pass'] += 1
                            # Mark complete
                            progress_r = s.put(f'{BASE}/training/{prog_id}/progress',
                                                json={'workerId': worker_id, 'moduleId': mod_id}, timeout=10)
                            if progress_r.status_code == 200:
                                results['module_complete_success'] += 1
                                completed_modules.append(str(mod_id))
                                module_results.append(f'scenario:PASS({sc_score})')
                            else:
                                err = progress_r.json().get('error', '')
                                results['module_complete_fail'] += 1
                                log_error(prog_title, mod_title, 'SCENARIO_COMPLETE_FAIL', f'Passed but completion failed: {err}')
                                module_results.append(f'scenario:PASS-COMPLETE_FAIL')
                                prog_ok = False
                                break
                        else:
                            results['scenario_fail'] += 1
                            log_error(prog_title, mod_title, 'SCENARIO_FAILED', f'Score: {sc_score}')
                            module_results.append(f'scenario:FAIL({sc_score})')
                            prog_ok = False
                            break
                    else:
                        err = scenario_r.text[:200]
                        results['scenario_error'] += 1
                        log_error(prog_title, mod_title, 'SCENARIO_API_ERROR', f'{scenario_r.status_code}: {err}')
                        module_results.append(f'scenario:ERR({scenario_r.status_code})')
                        prog_ok = False
                        break
                except Exception as e:
                    results['scenario_error'] += 1
                    log_error(prog_title, mod_title, 'SCENARIO_EXCEPTION', str(e))
                    module_results.append('scenario:ERR')
                    prog_ok = False
                    break

        elif mod_type in ('practical', 'assignment'):
            # Practical/assignment modules require file submission + approval
            # We skip these but record them
            if mod_type == 'practical':
                results['practical_skip'] += 1
            else:
                results['assignment_skip'] += 1
            module_results.append(f'{mod_type}:SKIP(needs-approval)')
            # Cannot proceed past this in sequential order
            break

        elif mod_type == 'scorm':
            results['scorm_skip'] += 1
            module_results.append('scorm:SKIP')
            break

        else:
            # Unknown type — try to complete
            try:
                progress_r = s.put(f'{BASE}/training/{prog_id}/progress',
                                    json={'workerId': worker_id, 'moduleId': mod_id}, timeout=10)
                if progress_r.status_code == 200:
                    results['module_complete_success'] += 1
                    completed_modules.append(str(mod_id))
                    module_results.append(f'{mod_type}:OK')
                else:
                    err = progress_r.json().get('error', '')
                    results['module_complete_fail'] += 1
                    log_error(prog_title, mod_title, f'UNKNOWN_TYPE_FAIL', f'{mod_type}: {progress_r.status_code} {err}')
                    module_results.append(f'{mod_type}:FAIL')
                    prog_ok = False
                    break
            except Exception as e:
                results['module_complete_fail'] += 1
                module_results.append(f'{mod_type}:ERR')
                prog_ok = False
                break

    results['programs_tested'] += 1
    status_icon = 'OK  ' if prog_ok else 'WARN'
    mod_summary = ' | '.join(module_results[:10])
    if len(module_results) > 10:
        mod_summary += f' ... +{len(module_results) - 10} more'
    print(f'  [{idx+1:3d}/{len(programs)}] {status_icon} {prog_title[:50]:50s} | {mod_summary}')

# ═══════════════════════════════════════════════════════════════
#   REPORT
# ═══════════════════════════════════════════════════════════════
print('\n' + '=' * 80)
print('  TEST RESULTS SUMMARY')
print('=' * 80)
print(f'  Programs tested:          {results["programs_tested"]} / {results["total_programs"]}')
print(f'  Enrollments:              {results["enroll_success"]} new, {results["enroll_already"]} existing, {results["enroll_fail"]} failed')
print(f'  Module completions:       {results["module_complete_success"]} OK, {results["module_complete_fail"]} failed')
print(f'  Video modules:            {results["video_complete"]} completed')
print(f'  Reading modules:          {results["reading_complete"]} completed')
print(f'  Quizzes:                  {results["quiz_pass"]} passed, {results["quiz_fail"]} failed, {results["quiz_error"]} errors')
print(f'  Scenarios:                {results["scenario_pass"]} passed, {results["scenario_fail"]} failed, {results["scenario_error"]} errors')
print(f'  Practical (skip):         {results["practical_skip"]}')
print(f'  Assignment (skip):        {results["assignment_skip"]}')
print(f'  SCORM (skip):             {results["scorm_skip"]}')
print(f'  Total errors:             {len(results["errors"])}')

if results['errors']:
    print('\n' + '-' * 80)
    print('  ERRORS DETAIL')
    print('-' * 80)
    for i, err in enumerate(results['errors']):
        print(f'  [{i+1:3d}] {err["type"]:25s} | {err["program"]} >> {err["module"]}')
        print(f'        {err["detail"]}')

print('\n' + '=' * 80)

# Save results to JSON
with open('E:/fintech/skills passport/talentledger/server/src/__tests__/module_test_results.json', 'w') as f:
    json.dump(results, f, indent=2)
print(f'  Results saved to module_test_results.json')
