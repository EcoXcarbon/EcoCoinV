import { useState } from 'react';
import api from '../../api/client';
import { useLang } from '../../context/LangContext';
import toast from 'react-hot-toast';

export default function AIGenerateModal({ programId, trade, onGenerated, onClose }) {
  const { t } = useLang();
  const [form, setForm] = useState({
    type: 'quiz',
    topic: '',
    trade: trade || '',
    difficulty: 'intermediate',
    count: 5,
  });
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);

  const handleGenerate = async () => {
    if (!form.topic.trim()) return toast.error('Topic is required');
    setLoading(true);
    setPreview(null);
    try {
      const { data } = await api.post('/ai/training/generate-module', form);
      setPreview(data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Generation failed');
    } finally {
      setLoading(false);
    }
  };

  const handleAddToCourse = async () => {
    if (!preview?.generated) return;

    try {
      const gen = preview.generated;
      let moduleData;

      if (preview.type === 'quiz') {
        moduleData = {
          title: `Quiz: ${form.topic}`,
          type: 'quiz',
          description: `AI-generated quiz about ${form.topic}`,
          quizQuestions: (gen.questions || []).map(q => ({
            question: q.question,
            options: q.options,
            correctOption: q.correctOption,
            difficulty: q.difficulty || 'medium',
            explanation: q.explanation || '',
          })),
        };
      } else if (preview.type === 'reading') {
        moduleData = {
          title: gen.title || `Reading: ${form.topic}`,
          type: 'reading',
          description: gen.keyPoints ? `Key points: ${gen.keyPoints.join(', ')}` : '',
          content: gen.content || '',
        };
      } else if (preview.type === 'scenario') {
        moduleData = {
          title: gen.title || `Scenario: ${form.topic}`,
          type: 'scenario',
          description: `AI-generated branching scenario about ${form.topic}`,
        };
        // Scenario data is added separately — for now just create the module shell
      }

      await api.post(`/training/${programId}/modules`, moduleData);
      toast.success('Module added to course');
      onGenerated();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to add module');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-navy-mid rounded-2xl border border-border dark:border-navy-light shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-violet-600 to-indigo-600 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            <h3 className="text-sm font-bold">{t('AI Content Generator')}</h3>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-white/20 rounded-lg transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Form */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1 block">{t('Content Type')}</label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                className="w-full p-2.5 text-sm rounded-xl border border-border dark:border-navy-light dark:bg-navy dark:text-white">
                <option value="quiz">{t('Quiz Questions')}</option>
                <option value="reading">{t('Reading Content')}</option>
                <option value="scenario">{t('Branching Scenario')}</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1 block">{t('Difficulty')}</label>
              <select value={form.difficulty} onChange={e => setForm(f => ({ ...f, difficulty: e.target.value }))}
                className="w-full p-2.5 text-sm rounded-xl border border-border dark:border-navy-light dark:bg-navy dark:text-white">
                <option value="beginner">{t('Beginner')}</option>
                <option value="intermediate">{t('Intermediate')}</option>
                <option value="advanced">{t('Advanced')}</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1 block">{t('Topic')}</label>
            <input value={form.topic} onChange={e => setForm(f => ({ ...f, topic: e.target.value }))}
              placeholder="e.g., Electrical safety in wet conditions"
              maxLength={200}
              className="w-full p-2.5 text-sm rounded-xl border border-border dark:border-navy-light dark:bg-navy dark:text-white" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1 block">{t('Trade')}</label>
              <input value={form.trade} onChange={e => setForm(f => ({ ...f, trade: e.target.value }))}
                placeholder="e.g., Electrician"
                className="w-full p-2.5 text-sm rounded-xl border border-border dark:border-navy-light dark:bg-navy dark:text-white" />
            </div>
            {form.type === 'quiz' && (
              <div>
                <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1 block">{t('Number of Questions')}</label>
                <input type="number" value={form.count} onChange={e => setForm(f => ({ ...f, count: Math.min(20, Math.max(1, Number(e.target.value))) }))}
                  min={1} max={20}
                  className="w-full p-2.5 text-sm rounded-xl border border-border dark:border-navy-light dark:bg-navy dark:text-white" />
              </div>
            )}
          </div>

          <button onClick={handleGenerate} disabled={loading || !form.topic.trim()}
            className="w-full px-4 py-2.5 text-sm font-semibold bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-xl hover:from-violet-700 hover:to-indigo-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                {t('Generating with AI...')}
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                {t('Generate Content')}
              </>
            )}
          </button>

          {/* Preview */}
          {preview?.generated && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold dark:text-white flex items-center gap-2">
                  {t('Generated Preview')}
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300">
                    {t('AI-generated')}
                  </span>
                </h4>
              </div>

              {/* Quiz preview */}
              {preview.type === 'quiz' && preview.generated.questions && (
                <div className="space-y-3">
                  {preview.generated.questions.map((q, qi) => (
                    <div key={qi} className="p-3 bg-gray-50 dark:bg-navy-light rounded-xl border border-border dark:border-navy-light">
                      <p className="text-sm font-medium dark:text-white mb-2">Q{qi + 1}. {q.question}</p>
                      <div className="space-y-1 ml-2">
                        {(q.options || []).map((opt, oi) => (
                          <p key={oi} className={`text-xs ${oi === q.correctOption ? 'text-green-700 dark:text-green-400 font-semibold' : 'text-gray-600 dark:text-gray-400'}`}>
                            {String.fromCharCode(65 + oi)}. {opt} {oi === q.correctOption && ' (correct)'}
                          </p>
                        ))}
                      </div>
                      {q.explanation && (
                        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2 italic">{q.explanation}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Reading preview */}
              {preview.type === 'reading' && preview.generated.content && (
                <div className="p-4 bg-gray-50 dark:bg-navy-light rounded-xl border border-border dark:border-navy-light">
                  {preview.generated.title && (
                    <h5 className="text-sm font-bold dark:text-white mb-2">{preview.generated.title}</h5>
                  )}
                  <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto">
                    {preview.generated.content}
                  </div>
                  {preview.generated.keyPoints?.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-200 dark:border-navy-mid">
                      <p className="text-xs font-bold text-gray-500 mb-1">{t('Key Points')}:</p>
                      <ul className="list-disc list-inside space-y-0.5">
                        {preview.generated.keyPoints.map((kp, i) => (
                          <li key={i} className="text-xs text-gray-600 dark:text-gray-400">{kp}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Scenario preview */}
              {preview.type === 'scenario' && preview.generated.steps && (
                <div className="space-y-2">
                  {preview.generated.steps.map((step, si) => (
                    <div key={si} className="p-3 bg-gray-50 dark:bg-navy-light rounded-xl border border-border dark:border-navy-light">
                      <p className="text-xs font-bold text-gray-500 mb-1">Step {si + 1}: {step.stepId}</p>
                      <p className="text-sm dark:text-gray-300 mb-2">{step.narrative}</p>
                      <div className="space-y-1 ml-2">
                        {(step.choices || []).map((c, ci) => (
                          <p key={ci} className={`text-xs ${c.isOptimal ? 'text-green-700 dark:text-green-400 font-semibold' : 'text-gray-600 dark:text-gray-400'}`}>
                            {ci + 1}. {c.text} (Score: {c.scoreImpact > 0 ? '+' : ''}{c.scoreImpact})
                          </p>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Add to course button */}
              <button onClick={handleAddToCourse}
                className="w-full px-4 py-2.5 text-sm font-semibold bg-green-600 text-white rounded-xl hover:bg-green-700 transition-colors flex items-center justify-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                {t('Add to Course')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
