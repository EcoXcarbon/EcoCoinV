import { useState } from 'react';
import { useLang } from '../../context/LangContext';
import api from '../../api/client';

export default function PreAssessment({ program, workerId, onComplete, onSkip }) {
  const { t, lang } = useLang();
  const [questions, setQuestions] = useState(null);
  const [answers, setAnswers] = useState({});
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [step, setStep] = useState('intro'); // intro, quiz, results

  const startAssessment = async () => {
    setLoading(true);
    try {
      const { data } = await api.post(`/ai/training/${program._id}/pre-assess`, { language: lang });
      if (data.questions) {
        setQuestions(data.questions);
        setStep('quiz');
      }
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const submitAssessment = () => {
    if (!questions) return;
    let correct = 0;
    const reviewed = questions.map((q, i) => {
      const userAnswer = answers[i] ?? -1;
      const isCorrect = userAnswer === q.correctIndex;
      if (isCorrect) correct++;
      return { ...q, userAnswer, isCorrect };
    });
    const score = Math.round((correct / questions.length) * 100);
    const knownTopics = reviewed.filter(q => q.isCorrect).map(q => q.topic);
    const focusAreas = reviewed.filter(q => !q.isCorrect).map(q => q.topic);
    setResults({ score, correct, total: questions.length, reviewed, knownTopics, focusAreas });
    setStep('results');
    // Save to backend (non-blocking)
    if (workerId) {
      api.put(`/training/${program._id}/progress`, {
        workerId,
        preAssessmentScore: score,
        preAssessmentData: { questions: reviewed, knownTopics, focusAreas, takenAt: new Date() },
      }).catch(() => {});
    }
  };

  // INTRO SCREEN
  if (step === 'intro') {
    return (
      <div className="max-w-2xl mx-auto p-8">
        <div className="bg-white dark:bg-navy-mid border border-transparent dark:border-navy-light rounded-2xl shadow-lg p-8 text-center">
          <div className="w-16 h-16 bg-blue-100 dark:bg-ilo-blue/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-blue-600 dark:text-ilo-light" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white mb-2">{t('AI Pre-Assessment')}</h2>
          <p className="text-gray-600 dark:text-gray-300 mb-2 text-lg font-semibold">{program.title}</p>
          <p className="text-gray-500 dark:text-gray-400 mb-6">
            {t('Before you start this course, let our AI assess your current knowledge. This helps personalize your learning experience.')}
          </p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mb-6">{t('6 quick questions')} &middot; {t('2-3 minutes')}</p>
          <div className="flex gap-4 justify-center">
            <button onClick={startAssessment} disabled={loading}
              className="px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-50 transition">
              {loading ? t('Generating Questions...') : t('Start Assessment')}
            </button>
            <button onClick={onSkip}
              className="px-6 py-3 bg-gray-100 dark:bg-navy-light text-gray-600 dark:text-gray-300 rounded-xl font-semibold hover:bg-gray-200 dark:hover:bg-navy transition">
              {t('Skip & Start Course')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // QUIZ SCREEN
  if (step === 'quiz' && questions) {
    const allAnswered = questions.every((_, i) => answers[i] !== undefined);
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="bg-white dark:bg-navy-mid border border-transparent dark:border-navy-light rounded-2xl shadow-lg p-6">
          <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-1">{t('Pre-Assessment')}: {program.title}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">{t('Answer based on your existing knowledge')}</p>
          {questions.map((q, qi) => (
            <div key={qi} className="mb-6 p-4 bg-gray-50 dark:bg-navy-light rounded-xl">
              <p className="font-semibold text-gray-800 dark:text-white mb-3">{qi + 1}. {q.question}</p>
              <div className="space-y-2">
                {(q.options || []).map((opt, oi) => (
                  <label key={oi} className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition ${answers[qi] === oi ? 'bg-blue-100 dark:bg-ilo-blue/25 border-blue-300 dark:border-ilo-blue border' : 'bg-white dark:bg-navy border border-gray-200 dark:border-navy-light hover:bg-gray-100 dark:hover:bg-navy-light'}`}>
                    <input type="radio" name={`q${qi}`} checked={answers[qi] === oi}
                      onChange={() => setAnswers(prev => ({ ...prev, [qi]: oi }))}
                      className="w-4 h-4 text-blue-600" />
                    <span className="text-gray-700 dark:text-gray-200">{opt}</span>
                  </label>
                ))}
              </div>
              {q.difficulty && <span className={`inline-block mt-2 text-xs px-2 py-0.5 rounded-full ${q.difficulty === 'easy' ? 'bg-green-100 text-green-700' : q.difficulty === 'hard' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>{q.difficulty}</span>}
            </div>
          ))}
          <button onClick={submitAssessment} disabled={!allAnswered}
            className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-40 transition">
            {t('Submit Assessment')}
          </button>
        </div>
      </div>
    );
  }

  // RESULTS SCREEN
  if (step === 'results' && results) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
          <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4 ${results.score >= 70 ? 'bg-green-100' : results.score >= 40 ? 'bg-yellow-100' : 'bg-blue-100'}`}>
            <span className={`text-3xl font-bold ${results.score >= 70 ? 'text-green-600' : results.score >= 40 ? 'text-yellow-600' : 'text-blue-600'}`}>{results.score}%</span>
          </div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">{t('Pre-Assessment Complete')}</h2>
          <p className="text-gray-600 mb-6">{results.correct} / {results.total} {t('correct')}</p>

          {results.knownTopics.length > 0 && (
            <div className="text-left mb-4 p-4 bg-green-50 rounded-xl">
              <p className="font-semibold text-green-800 mb-2">{t('You already know')}:</p>
              {[...new Set(results.knownTopics)].map((topic, i) => (
                <span key={i} className="inline-block bg-green-200 text-green-800 text-sm px-3 py-1 rounded-full mr-2 mb-1">{topic}</span>
              ))}
            </div>
          )}

          {results.focusAreas.length > 0 && (
            <div className="text-left mb-6 p-4 bg-orange-50 rounded-xl">
              <p className="font-semibold text-orange-800 mb-2">{t('Focus areas')}:</p>
              {[...new Set(results.focusAreas)].map((area, i) => (
                <span key={i} className="inline-block bg-orange-200 text-orange-800 text-sm px-3 py-1 rounded-full mr-2 mb-1">{area}</span>
              ))}
            </div>
          )}

          <button onClick={() => onComplete(results)}
            className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition">
            {t('Start Course')}
          </button>
        </div>
      </div>
    );
  }

  return null;
}
