import { useState } from 'react';
import api from '../../api/client';
import toast from 'react-hot-toast';

export default function ScenarioView({ scenario, programId, moduleId, workerId, onComplete }) {
  const [currentStepId, setCurrentStepId] = useState(scenario?.startStepId || scenario?.steps?.[0]?.stepId);
  const [choices, setChoices] = useState([]);
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  if (!scenario?.steps?.length) return <p className="text-sm text-gray-400">No scenario data available</p>;

  const currentStep = scenario.steps.find(s => s.stepId === currentStepId);

  const handleChoice = (choiceIndex) => {
    const choice = currentStep.choices[choiceIndex];
    const newChoices = [...choices, { stepId: currentStepId, choiceIndex }];
    setChoices(newChoices);

    if (choice.nextStepId) {
      setCurrentStepId(choice.nextStepId);
    } else {
      // End of scenario — submit
      submitScenario(newChoices);
    }
  };

  const submitScenario = async (finalChoices) => {
    setSubmitting(true);
    try {
      const { data } = await api.post(`/training/${programId}/scenario/${moduleId}`, {
        workerId,
        choices: finalChoices,
      });
      setResult(data);
      if (data.passed) {
        toast.success(`Scenario complete! Score: ${data.score}%`);
      } else {
        toast.error(`Score: ${data.score}%. Need ${data.passingScore}% to pass.`);
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to submit scenario');
    } finally { setSubmitting(false); }
  };

  // Result view
  if (result) {
    return (
      <div className="space-y-4">
        <div className={`p-6 rounded-xl text-center ${result.passed ? 'bg-green-50 dark:bg-green-900/20 border border-green-200' : 'bg-red-50 dark:bg-red-900/20 border border-red-200'}`}>
          <p className="text-4xl mb-2">{result.passed ? '🎉' : '🔄'}</p>
          <p className={`text-xl font-bold ${result.passed ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
            {result.passed ? 'Scenario Passed!' : 'Try Again'}
          </p>
          <p className="text-sm text-gray-500 mt-1">Score: {result.score}% (need {result.passingScore}%)</p>
        </div>

        {/* Feedback */}
        {result.feedback?.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-bold dark:text-white">Decision Feedback:</h4>
            {result.feedback.map((fb, i) => (
              <div key={i} className={`p-3 rounded-lg border ${fb.isOptimal ? 'border-green-200 bg-green-50 dark:bg-green-900/10' : 'border-amber-200 bg-amber-50 dark:bg-amber-900/10'}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm">{fb.isOptimal ? '✅' : '⚠️'}</span>
                  <span className="text-xs font-semibold dark:text-white">Step: {fb.stepId}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${fb.isOptimal ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                    {fb.isOptimal ? 'Optimal' : 'Suboptimal'}
                  </span>
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-400">You chose: {fb.chosen}</p>
                {fb.feedback && <p className="text-xs text-gray-500 mt-1 italic">{fb.feedback}</p>}
              </div>
            ))}
          </div>
        )}

        {/* Competency impact */}
        {result.competencyScores?.length > 0 && (
          <div className="p-3 bg-ilo-blue/5 rounded-lg">
            <h4 className="text-xs font-bold text-ilo-blue mb-2">Competency Impact</h4>
            <div className="flex flex-wrap gap-2">
              {result.competencyScores.map((c, i) => (
                <span key={i} className="px-2 py-1 text-[10px] font-semibold rounded-full bg-ilo-blue/10 text-ilo-blue">
                  {c.skill}: {c.score}%
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-3">
          {result.passed ? (
            <button onClick={onComplete}
              className="px-6 py-2.5 text-sm font-semibold bg-green-600 text-white rounded-xl hover:bg-green-700 transition-colors">
              Continue
            </button>
          ) : (
            <button onClick={() => { setResult(null); setChoices([]); setCurrentStepId(scenario.startStepId || scenario.steps[0]?.stepId); }}
              className="px-6 py-2.5 text-sm font-semibold bg-amber-500 text-white rounded-xl hover:bg-amber-600 transition-colors">
              Try Again
            </button>
          )}
        </div>
      </div>
    );
  }

  // Active scenario step
  return (
    <div className="space-y-4">
      {/* Progress indicator */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400">Step {choices.length + 1}</span>
        <div className="flex-1 bg-gray-200 dark:bg-navy-light rounded-full h-1.5">
          <div className="bg-ilo-blue rounded-full h-1.5 transition-all" style={{
            width: `${Math.min(100, ((choices.length + 1) / scenario.steps.length) * 100)}%`
          }} />
        </div>
      </div>

      {/* Current step */}
      {currentStep ? (
        <div className="bg-white dark:bg-navy-mid rounded-xl border border-border dark:border-navy-light p-6">
          {currentStep.image && (
            <img src={currentStep.image} alt="" className="w-full h-48 object-cover rounded-lg mb-4" />
          )}
          <div className="mb-6">
            <p className="text-sm leading-relaxed dark:text-gray-300">{currentStep.narrative}</p>
          </div>

          <h4 className="text-xs font-bold text-gray-500 mb-3">WHAT DO YOU DO?</h4>
          <div className="space-y-2">
            {currentStep.choices.map((choice, ci) => (
              <button key={ci} onClick={() => handleChoice(ci)} disabled={submitting}
                className="w-full text-left p-4 rounded-xl border border-border dark:border-navy-light hover:border-ilo-blue hover:bg-ilo-blue/5 transition-all dark:text-white">
                <div className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-full bg-ilo-blue/10 text-ilo-blue flex items-center justify-center text-sm font-bold shrink-0">
                    {String.fromCharCode(65 + ci)}
                  </span>
                  <span className="text-sm">{choice.text}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-sm text-gray-400">Scenario step not found</p>
      )}
    </div>
  );
}
