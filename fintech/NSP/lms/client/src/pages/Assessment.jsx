import { useEffect, useState } from 'react';
import api from '../api/client';
import { useLang } from '../context/LangContext';
import toast from 'react-hot-toast';

const TABS = ['RPL Workflow', 'Workplace Checklist', 'Simulations', 'Video Portfolio'];
const CHECKLIST_ITEMS = [
  { skill: 'Tool identification & selection', group: 'Core Skills' },
  { skill: 'Material quality assessment', group: 'Core Skills' },
  { skill: 'Measurement accuracy (±2mm)', group: 'Core Skills' },
  { skill: 'Work output quality', group: 'Core Skills' },
  { skill: 'PPE compliance at all times', group: 'Safety Compliance' },
  { skill: 'Hazard identification & reporting', group: 'Safety Compliance' },
  { skill: 'First aid knowledge', group: 'Safety Compliance' },
  { skill: 'Site cleanliness & housekeeping', group: 'Safety Compliance' },
];

const SIM_QUESTIONS = [
  { id: 'q1', question: 'What type of PPE is mandatory for overhead welding operations?', options: ['Full face shield + leather apron + gloves', 'Safety glasses only', 'Hard hat and boots', 'Dust mask only'], correct: 0 },
  { id: 'q2', question: 'Maximum height a mobile scaffold can be used without tie-in to the structure?', options: ['2 meters', '4 meters', '6 meters', '8 meters'], correct: 1 },
  { id: 'q3', question: 'Which fire extinguisher type is appropriate for electrical fires?', options: ['Water (Class A)', 'Foam (Class B)', 'CO2 (Class C)', 'Wet chemical (Class K)'], correct: 2 },
];

export default function Assessment() {
  const { t } = useLang();
  const [tab, setTab] = useState(0);
  const [assessments, setAssessments] = useState([]);
  const [checklist, setChecklist] = useState(CHECKLIST_ITEMS.map(i => ({ ...i, checked: false, proficiency: 'competent' })));
  const [recommendation, setRecommendation] = useState('');
  const [simAnswers, setSimAnswers] = useState({});
  const [simSubmitted, setSimSubmitted] = useState(false);

  useEffect(() => {
    api.get('/assessments', { params: { limit: 20 } })
      .then(r => setAssessments(r.data.assessments))
      .catch(() => toast.error('Failed to load assessments'));
  }, []);

  const handleChecklistSubmit = () => {
    if (!recommendation) { toast.error('Select a recommendation'); return; }
    toast.success(`Checklist submitted: ${recommendation}`);
  };

  const handleSimSubmit = () => {
    setSimSubmitted(true);
    const correct = SIM_QUESTIONS.filter(q => simAnswers[q.id] === q.correct).length;
    toast.success(`Score: ${correct}/${SIM_QUESTIONS.length} (${Math.round(correct / SIM_QUESTIONS.length * 100)}%)`);
  };

  const rplAssessments = assessments.filter(a => a.type === 'rpl' || a.type === 'checklist');
  const videoAssessments = assessments.filter(a => a.type === 'video');

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold dark:text-white">{t('Assessment')}</h2>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-navy-light rounded-xl p-1 overflow-x-auto">
        {TABS.map((label, i) => (
          <button key={i} onClick={() => setTab(i)}
            className={`px-4 py-2 text-xs font-semibold rounded-lg whitespace-nowrap transition-colors ${tab === i ? 'bg-white dark:bg-navy-mid text-ilo-blue shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'}`}>
            {t(label)}
          </button>
        ))}
      </div>

      {/* RPL Workflow */}
      {tab === 0 && (
        <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold dark:text-white">Recent Assessments</h3>
            <a href="/rpl" className="text-xs font-semibold text-ilo-blue hover:underline">{t('RPL')} &rarr;</a>
          </div>
          <div className="space-y-2">
            {rplAssessments.length === 0 && <p className="text-sm text-gray-400">No assessments yet</p>}
            {rplAssessments.map(a => (
              <div key={a._id} className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-navy-light">
                <div>
                  <p className="text-sm font-medium dark:text-white">{a.worker?.fullName} — {a.title}</p>
                  <p className="text-xs text-gray-500">{a.trade} | {new Date(a.createdAt).toLocaleDateString()}</p>
                </div>
                <span className={`px-2 py-0.5 text-[11px] font-semibold rounded-full capitalize ${a.status === 'approved' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : a.status === 'pending' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-red-100 text-red-700'}`}>
                  {a.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Workplace Checklist */}
      {tab === 1 && (
        <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold dark:text-white">Mason — Workplace Competency</h3>
            <span className="text-xs text-gray-500">Assessor: Dr. Khalid Mehmood</span>
          </div>
          {['Core Skills', 'Safety Compliance'].map(group => (
            <div key={group}>
              <h4 className="text-xs font-bold uppercase text-gray-400 mb-2">{group}</h4>
              {checklist.filter(i => i.group === group).map((item, idx) => (
                <div key={idx} className="flex items-center gap-3 py-2 border-b border-gray-100 dark:border-navy-light last:border-0">
                  <button onClick={() => setChecklist(cl => cl.map(c => c.skill === item.skill ? { ...c, checked: !c.checked } : c))}
                    role="checkbox" aria-checked={item.checked} aria-label={item.skill}
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${item.checked ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 dark:border-gray-600'}`}>
                    {item.checked && <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={3} d="M5 13l4 4L19 7"/></svg>}
                  </button>
                  <span className="flex-1 text-sm dark:text-gray-200">{item.skill}</span>
                  <select value={item.proficiency} onChange={e => setChecklist(cl => cl.map(c => c.skill === item.skill ? { ...c, proficiency: e.target.value } : c))}
                    aria-label={`${item.skill} proficiency`}
                    className="text-xs px-2 py-1 border border-border dark:border-navy-light rounded-lg bg-white dark:bg-navy dark:text-gray-300">
                    {['novice', 'competent', 'proficient', 'expert'].map(p => <option key={p} value={p} className="capitalize">{p}</option>)}
                  </select>
                </div>
              ))}
            </div>
          ))}
          <div className="flex gap-2 pt-2">
            {['pass', 'remedial', 'fail'].map(r => (
              <button key={r} onClick={() => setRecommendation(r)}
                className={`px-4 py-2 text-xs font-semibold rounded-lg border-2 capitalize transition-colors ${recommendation === r
                  ? r === 'pass' ? 'bg-green-50 border-green-500 text-green-700 dark:bg-green-900/20' : r === 'remedial' ? 'bg-amber-50 border-amber-500 text-amber-700 dark:bg-amber-900/20' : 'bg-red-50 border-red-500 text-red-700 dark:bg-red-900/20'
                  : 'border-gray-200 dark:border-navy-light text-gray-500 hover:border-gray-400'}`}>
                {r}
              </button>
            ))}
            <button onClick={handleChecklistSubmit} className="ml-auto px-4 py-2 text-xs font-semibold bg-ilo-blue text-white rounded-lg hover:bg-ilo-dark">Submit</button>
          </div>
        </div>
      )}

      {/* Simulations */}
      {tab === 2 && (
        <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-5 space-y-4">
          <h3 className="font-semibold dark:text-white">Safety Protocol Quiz</h3>
          {SIM_QUESTIONS.map((q, qi) => (
            <div key={q.id} className="p-3 rounded-lg bg-gray-50 dark:bg-navy-light">
              <p className="text-sm font-medium dark:text-white mb-2">{qi + 1}. {q.question}</p>
              <div className="space-y-1.5">
                {q.options.map((opt, oi) => {
                  const selected = simAnswers[q.id] === oi;
                  const isCorrect = simSubmitted && oi === q.correct;
                  const isWrong = simSubmitted && selected && oi !== q.correct;
                  return (
                    <button key={oi} onClick={() => !simSubmitted && setSimAnswers(a => ({ ...a, [q.id]: oi }))}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                        isCorrect ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-300' :
                        isWrong ? 'bg-red-100 dark:bg-red-900/30 text-red-700 border border-red-300' :
                        selected ? 'bg-ilo-blue/10 border border-ilo-blue text-ilo-blue' :
                        'bg-white dark:bg-navy-mid border border-gray-200 dark:border-navy-light text-gray-700 dark:text-gray-300 hover:border-ilo-blue/50'
                      }`}>
                      <span className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${selected ? 'border-ilo-blue bg-ilo-blue' : 'border-gray-300 dark:border-gray-600'}`}>
                        {selected && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </span>
                      {opt}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {!simSubmitted && (
            <button onClick={handleSimSubmit} disabled={Object.keys(simAnswers).length < SIM_QUESTIONS.length}
              className="px-6 py-2 text-sm font-semibold bg-ilo-blue text-white rounded-lg hover:bg-ilo-dark disabled:opacity-50">
              Submit Answers
            </button>
          )}
        </div>
      )}

      {/* Video Portfolio */}
      {tab === 3 && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-navy-mid rounded-xl border-2 border-dashed border-gray-300 dark:border-navy-light p-8 text-center cursor-pointer hover:border-ilo-blue transition-colors"
            onClick={() => toast.success('File picker would open here')}>
            <div className="text-3xl mb-2">📹</div>
            <h4 className="font-semibold dark:text-white">{t('Upload Practical Task Video')}</h4>
            <p className="text-xs text-gray-500 mt-1">MP4, MOV up to 100MB</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {videoAssessments.map(v => (
              <div key={v._id} className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light overflow-hidden">
                <div className="h-32 bg-gradient-to-br from-ilo-dark to-ilo-blue flex items-center justify-center relative">
                  <span className="text-4xl">▶️</span>
                  {v.video?.duration && <span className="absolute bottom-2 right-2 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded">{Math.floor(v.video.duration / 60)}:{String(v.video.duration % 60).padStart(2, '0')}</span>}
                </div>
                <div className="p-3">
                  <p className="text-sm font-medium dark:text-white">{v.title}</p>
                  <p className="text-xs text-gray-500">{v.worker?.fullName}</p>
                  <span className={`mt-2 inline-block px-2 py-0.5 text-[10px] font-semibold rounded-full capitalize ${v.status === 'approved' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'}`}>{v.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
