import { useState, useRef, useEffect } from 'react';
import api from '../../api/client';
import { useLang } from '../../context/LangContext';
import toast from 'react-hot-toast';

const QUICK_ACTIONS = [
  { label: 'Simplify', request: 'Explain this in simpler terms that a beginner can understand' },
  { label: 'More Examples', request: 'Give me practical real-world examples of this concept' },
  { label: 'Trade Context', request: 'How does this apply to my specific trade work?' },
  { label: 'Quiz Me', request: 'Ask me 2-3 quick questions to test my understanding of this material' },
];

const LANG_VOICE_MAP = { en: 'en-US', ur: 'ur-PK', ps: 'ps-AF' };

export default function AIAdaptPanel({ programId, moduleId, isOpen, onToggle, courseTitle, moduleTitle }) {
  const { t, lang } = useLang();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [speakingMsgIndex, setSpeakingMsgIndex] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const scrollRef = useRef(null);
  const synthRef = useRef(window.speechSynthesis);
  const inputRef = useRef(null);

  // Cleanup TTS on unmount
  useEffect(() => {
    return () => {
      synthRef.current?.cancel();
    };
  }, []);

  const speak = (text, index) => {
    const synth = synthRef.current;
    if (!synth) return;

    if (speaking && speakingMsgIndex === index) {
      synth.cancel();
      setSpeaking(false);
      setSpeakingMsgIndex(null);
      return;
    }

    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = LANG_VOICE_MAP[lang] || 'en-US';
    utterance.rate = 0.9;
    utterance.onend = () => { setSpeaking(false); setSpeakingMsgIndex(null); };
    utterance.onerror = () => { setSpeaking(false); setSpeakingMsgIndex(null); };
    synth.speak(utterance);
    setSpeaking(true);
    setSpeakingMsgIndex(index);
  };

  const sendRequest = async (requestText) => {
    if (!requestText.trim() || loading) return;

    const userMsg = { role: 'user', text: requestText };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const { data } = await api.post(`/ai/training/${programId}/adapt/${moduleId}`, {
        request: requestText,
        language: lang,
      });

      const aiMsg = {
        role: 'ai',
        text: data.adaptation?.text || 'No response generated',
        relatedConcepts: data.adaptation?.relatedConcepts || [],
        cached: data.cached,
      };
      setMessages(prev => [...prev, aiMsg]);

      setTimeout(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
      }, 100);
    } catch (err) {
      const errorMsg = err.response?.data?.error || 'AI request failed';
      toast.error(errorMsg);
      setMessages(prev => [...prev, { role: 'error', text: errorMsg }]);
    } finally {
      setLoading(false);
    }
  };

  // Floating toggle button when closed
  if (!isOpen) {
    return (
      <button onClick={onToggle}
        className="fixed right-4 bottom-4 z-40 px-4 py-2.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-semibold rounded-xl shadow-lg hover:shadow-xl transition-all flex items-center gap-2">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
        {t('AI Tutor')}
      </button>
    );
  }

  // Full-screen overlay when open
  return (
    <div className="fixed inset-0 z-50 bg-gray-900/50 backdrop-blur-sm flex">
      {/* Main container */}
      <div className="flex-1 flex flex-col bg-white dark:bg-navy max-w-full mx-auto overflow-hidden
        sm:m-4 sm:rounded-2xl sm:shadow-2xl sm:border sm:border-border sm:dark:border-navy-light">

        {/* Header */}
        <div className="px-4 py-3 bg-gradient-to-r from-violet-600 via-indigo-600 to-purple-600 text-white flex items-center gap-3 shrink-0">
          <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold truncate">{t('AI Tutor')}</h2>
              <span className="text-[10px] bg-white/20 px-1.5 py-0.5 rounded-full shrink-0">{t('AI-powered')}</span>
            </div>
            {(courseTitle || moduleTitle) && (
              <p className="text-[11px] text-white/70 truncate mt-0.5">
                {courseTitle}{moduleTitle ? ` — ${moduleTitle}` : ''}
              </p>
            )}
          </div>
          {/* Toggle sidebar on desktop */}
          <button onClick={() => setSidebarOpen(p => !p)}
            className="hidden sm:block p-1.5 hover:bg-white/20 rounded-lg transition-colors"
            title="Toggle sidebar">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
            </svg>
          </button>
          <button onClick={onToggle} className="p-1.5 hover:bg-white/20 rounded-lg transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar — hidden on mobile */}
          {sidebarOpen && (
            <div className="hidden sm:flex flex-col w-56 border-r border-border dark:border-navy-light bg-gray-50 dark:bg-navy-mid shrink-0">
              <div className="p-3 border-b border-border dark:border-navy-light">
                <h3 className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('Quick Actions')}</h3>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                {QUICK_ACTIONS.map(action => (
                  <button key={action.label} onClick={() => sendRequest(action.request)} disabled={loading}
                    className="w-full text-left px-3 py-2.5 text-xs font-medium rounded-lg hover:bg-violet-50 dark:hover:bg-violet-900/20 text-gray-700 dark:text-gray-300 transition-colors disabled:opacity-50 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" />
                    {t(action.label)}
                  </button>
                ))}
              </div>
              {messages.length > 0 && (
                <div className="p-3 border-t border-border dark:border-navy-light">
                  <p className="text-[10px] text-gray-400 dark:text-gray-500">
                    {messages.filter(m => m.role === 'ai').length} {t('responses')}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Main chat area */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
              {messages.length === 0 ? (
                /* Welcome state */
                <div className="flex flex-col items-center justify-center h-full py-8">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-100 to-indigo-100 dark:from-violet-900/30 dark:to-indigo-900/30 flex items-center justify-center mb-4">
                    <svg className="w-8 h-8 text-violet-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </div>
                  <h3 className="text-base font-bold dark:text-white mb-1">{t('AI Tutor')}</h3>
                  <p className="text-sm text-gray-400 dark:text-gray-500 text-center max-w-md mb-6">{t('aiTutorWelcome')}</p>
                  {/* Quick action cards for welcome */}
                  <div className="grid grid-cols-2 gap-2 w-full max-w-sm">
                    {QUICK_ACTIONS.map(action => (
                      <button key={action.label} onClick={() => sendRequest(action.request)} disabled={loading}
                        className="px-3 py-3 text-xs font-semibold bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 rounded-xl hover:bg-violet-100 dark:hover:bg-violet-900/30 transition-colors disabled:opacity-50 text-center">
                        {t(action.label)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((msg, i) => (
                  <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    {/* AI avatar */}
                    {msg.role !== 'user' && (
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-1
                        ${msg.role === 'error' ? 'bg-red-100 dark:bg-red-900/30' : 'bg-gradient-to-br from-violet-500 to-indigo-500'}`}>
                        {msg.role === 'error' ? (
                          <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                          </svg>
                        )}
                      </div>
                    )}
                    <div className={`max-w-[80%] sm:max-w-[70%] rounded-2xl px-4 py-3 text-sm
                      ${msg.role === 'user' ? 'bg-violet-600 text-white' :
                        msg.role === 'error' ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800' :
                        'bg-gray-100 dark:bg-navy-mid text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-navy-light'}`}>
                      <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                      {msg.relatedConcepts?.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-gray-200 dark:border-navy-light">
                          <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 mb-1.5">{t('Related Concepts')}:</p>
                          <div className="flex flex-wrap gap-1.5">
                            {msg.relatedConcepts.map((c, ci) => (
                              <span key={ci} className="px-2 py-0.5 text-[10px] bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 rounded-full">
                                {c}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {/* TTS button for AI messages */}
                      {msg.role === 'ai' && (
                        <div className="mt-2 flex items-center gap-2">
                          <button onClick={() => speak(msg.text, i)}
                            className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-lg
                              bg-gray-200 dark:bg-navy-light hover:bg-gray-300 dark:hover:bg-navy text-gray-600 dark:text-gray-400 transition-colors"
                            title={speaking && speakingMsgIndex === i ? t('Stop') : t('Read Aloud')}>
                            {speaking && speakingMsgIndex === i ? (
                              <>
                                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
                                {t('Stop')}
                              </>
                            ) : (
                              <>
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M17.95 6.05a8 8 0 010 11.9M11 5L6 9H2v6h4l5 4V5z" />
                                </svg>
                                {t('Read Aloud')}
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
              {loading && (
                <div className="flex gap-3 justify-start">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center shrink-0 mt-1">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                  </div>
                  <div className="bg-gray-100 dark:bg-navy-mid rounded-2xl px-4 py-3 border border-gray-200 dark:border-navy-light flex items-center gap-2">
                    <div className="flex gap-1">
                      <div className="w-1.5 h-1.5 bg-violet-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-1.5 h-1.5 bg-violet-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-1.5 h-1.5 bg-violet-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                    <span className="text-xs text-gray-400">{t('AI is thinking...')}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Quick action chips on mobile (above input) */}
            <div className="sm:hidden px-3 py-2 border-t border-border dark:border-navy-light flex gap-1.5 overflow-x-auto shrink-0">
              {QUICK_ACTIONS.map(action => (
                <button key={action.label} onClick={() => sendRequest(action.request)} disabled={loading}
                  className="px-2.5 py-1.5 text-[11px] font-semibold bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 rounded-lg hover:bg-violet-100 dark:hover:bg-violet-900/30 transition-colors disabled:opacity-50 whitespace-nowrap shrink-0">
                  {t(action.label)}
                </button>
              ))}
            </div>

            {/* Input area */}
            <div className="px-4 py-3 border-t border-border dark:border-navy-light shrink-0 bg-white dark:bg-navy">
              <div className="flex gap-2 max-w-3xl mx-auto">
                <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && sendRequest(input)}
                  placeholder={t('Ask about this module...')}
                  maxLength={500} disabled={loading}
                  className="flex-1 px-4 py-2.5 text-sm rounded-xl border border-border dark:border-navy-light dark:bg-navy-mid dark:text-white focus:ring-2 focus:ring-violet-500/30 outline-none disabled:opacity-50" />
                <button onClick={() => sendRequest(input)} disabled={loading || !input.trim()}
                  className="px-4 py-2.5 bg-violet-600 text-white rounded-xl hover:bg-violet-700 transition-colors disabled:opacity-50 shrink-0">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
