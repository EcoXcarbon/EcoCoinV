import { useState, useEffect, useMemo } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useLang } from '../context/LangContext';
import { useOffline } from '../context/OfflineContext';

function VerifyEmailBanner({ email }) {
  const [resending, setResending] = useState(false);
  const resend = async () => {
    setResending(true);
    try {
      await api.post('/auth/resend-verification', { email });
      toast.success(`Verification email sent to ${email}`);
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to resend'); }
    finally { setResending(false); }
  };
  return (
    <div className="px-4 py-2 bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 text-xs font-semibold flex items-center justify-center gap-3">
      <span>⚠️ Verify your email to create classes, post, and submit work.</span>
      <button onClick={resend} disabled={resending}
        className="underline hover:no-underline disabled:opacity-60">
        {resending ? 'Sending…' : 'Resend verification email'}
      </button>
    </div>
  );
}

/* ─── Nav structure: groups + standalone items ─── */
const NAV_GROUPS = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    icon: '📊',
    to: '/',
  },
  {
    key: 'registry',
    label: 'Registry',
    icon: '📋',
    children: [
      { to: '/workers',     label: 'Workers',     roles: ['admin', 'institution'] },
      { to: '/skills',      label: 'Skills',      roles: ['admin', 'institution', 'assessor'] },
      { to: '/credentials', label: 'Credentials', roles: ['admin', 'institution'] },
      { to: '/tracer-studies', label: 'Tracer Studies', roles: ['admin', 'institution', 'worker'] },
      { to: '/wallet',      label: 'Wallet',      roles: ['worker'] },
      { to: '/documents',   label: 'Documents',   roles: ['worker'] },
    ],
  },
  {
    key: 'lms',
    label: 'LMS',
    icon: '🎓',
    children: [
      { to: '/classroom',            label: 'Classroom' },
      { to: '/exams',                label: 'Exams' },
      { to: '/cases',                label: 'Case Studies' },
      { to: '/lms?tab=catalog',      label: 'Courses',           roles: ['worker', 'admin', 'institution'] },
      { to: '/lms?tab=training',     label: 'Training',          roles: ['worker', 'admin', 'institution'] },
      { to: '/lms?tab=pathways',     label: 'Career Path',       roles: ['worker', 'admin', 'institution'] },
      { to: '/lms?tab=dashboard',    label: 'Instructor Dashboard', roles: ['institution', 'admin', 'assessor'] },
    ],
  },
  {
    key: 'rpl',
    label: 'RPL',
    icon: '🏅',
    to: '/rpl',
    roles: ['admin', 'assessor', 'institution', 'worker'],
  },
  {
    key: 'employer',
    label: 'Employer',
    icon: '🏢',
    children: [
      { to: '/employer?tab=search',    label: 'Talent Search',     roles: ['employer', 'admin'] },
      { to: '/employer?tab=shortlist', label: 'Shortlist',         roles: ['employer'] },
      { to: '/employer?tab=verify',    label: 'Verify Credential', roles: ['employer', 'admin'] },
      { to: '/employer?tab=overview',  label: 'Workforce Overview', roles: ['employer', 'admin'] },
      { to: '/jobs',                    label: 'Job Postings',      roles: ['employer', 'admin', 'worker'] },
      { to: '/companies',               label: 'Employer Directory', roles: ['employer', 'admin', 'worker', 'institution', 'assessor'] },
    ],
  },
  {
    key: 'assessor',
    label: 'Assessor',
    icon: '✅',
    children: [
      { to: '/assessor', label: 'Assessor Dashboard', roles: ['assessor', 'admin'] },
      { to: '/rpl',      label: 'RPL Reviews',        roles: ['assessor', 'admin'] },
    ],
  },
  {
    key: 'admin',
    label: 'Administration',
    icon: '⚙️',
    children: [
      { to: '/training',  label: 'Training',  roles: ['admin', 'institution'] },
      { to: '/analytics', label: 'Analytics', roles: ['admin', 'institution'] },
      { to: '/reports',   label: 'Reports',   roles: ['admin', 'institution'] },
    ],
  },
  {
    key: 'pricing',
    label: 'Pricing',
    icon: '💰',
    to: '/pricing',
  },
];

/* Check if a child item matches the current location */
function isChildActive(child, pathname, search) {
  const [childPath, childQuery] = child.to.split('?');
  if (childPath !== pathname) return false;
  if (!childQuery) return true;
  return search.includes(childQuery);
}

export default function Layout() {
  const { user, logout } = useAuth();
  const { dark, toggle } = useTheme();
  const { lang, setLang, t } = useLang();
  const { isOnline, pendingMutations, syncing, installPrompt, promptInstall } = useOffline();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const [expandedGroups, setExpandedGroups] = useState(new Set());

  const role = user?.role;

  /* Filter groups & children by role */
  const filteredNav = useMemo(() => {
    return NAV_GROUPS.map(group => {
      // Standalone items
      if (!group.children) {
        if (group.roles && !group.roles.includes(role)) return null;
        return group;
      }
      // Groups: filter children
      const kids = group.children.filter(c => !c.roles || c.roles.includes(role));
      if (kids.length === 0) return null;
      return { ...group, children: kids };
    }).filter(Boolean);
  }, [role]);

  /* Determine active group key and active child for breadcrumb */
  const { activeGroupKey, activeChild, activeGroup } = useMemo(() => {
    const { pathname, search } = location;
    for (const group of filteredNav) {
      if (!group.children) {
        if (group.to === pathname) return { activeGroupKey: group.key, activeChild: null, activeGroup: group };
        continue;
      }
      for (const child of group.children) {
        if (isChildActive(child, pathname, search)) {
          return { activeGroupKey: group.key, activeChild: child, activeGroup: group };
        }
      }
    }
    return { activeGroupKey: null, activeChild: null, activeGroup: null };
  }, [location, filteredNav]);

  /* Auto-expand the group that contains the active route */
  useEffect(() => {
    if (activeGroupKey) {
      setExpandedGroups(prev => {
        if (prev.has(activeGroupKey)) return prev;
        const next = new Set(prev);
        next.add(activeGroupKey);
        return next;
      });
    }
  }, [activeGroupKey]);

  const toggleGroup = (key) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  /* Breadcrumb: Home / Group / Item */
  const breadcrumb = useMemo(() => {
    if (!activeGroup) return { group: null, item: 'Dashboard' };
    if (!activeChild) return { group: null, item: activeGroup.label };
    return { group: activeGroup.label, item: activeChild.label };
  }, [activeGroup, activeChild]);

  // Close sidebar on Escape
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape' && sidebarOpen) setSidebarOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [sidebarOpen]);

  const handleChildClick = (child) => {
    setSidebarOpen(false);
    navigate(child.to);
  };

  /* Chevron SVG */
  const Chevron = ({ expanded }) => (
    <svg className={`w-3.5 h-3.5 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
      fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-surface dark:bg-navy">
      {/* Skip link */}
      <a href="#main-content" className="skip-link">Skip to content</a>

      {/* Sidebar overlay */}
      {sidebarOpen && <div className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* Sidebar */}
      <aside role="navigation" aria-label="Main navigation" className={`fixed lg:static inset-y-0 left-0 z-50 w-[250px] bg-white dark:bg-navy-mid border-r border-border dark:border-navy-light flex flex-col transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border dark:border-navy-light bg-gradient-to-br from-ilo-dark to-[#0a4bb3] dark:from-navy-mid dark:to-navy">
          <div className="w-9 h-9 rounded-lg bg-white/15 ring-1 ring-white/25 flex items-center justify-center text-gold-accent font-black text-sm shadow-sm">NSP</div>
          <div>
            <h1 className="text-sm font-bold text-white tracking-tight">NSP Learning</h1>
            <p className="text-[10px] text-white/70">Skills Passport</p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-2">
          <ul>
            {filteredNav.map(group => {
              const isStandalone = !group.children;
              const isExpanded = expandedGroups.has(group.key);
              const isGroupActive = activeGroupKey === group.key;

              if (isStandalone) {
                // Render standalone NavLink (Dashboard, RPL)
                return (
                  <li key={group.key}>
                    <NavLink
                      to={group.to}
                      end={group.to === '/'}
                      onClick={() => setSidebarOpen(false)}
                      className={({ isActive }) =>
                        `flex items-center gap-3 px-5 py-2.5 text-[13px] font-medium transition-colors relative ${
                          isActive
                            ? 'text-ilo-blue bg-ilo-blue/5 dark:bg-ilo-blue/10 before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[3px] before:bg-ilo-blue before:rounded-r'
                            : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-navy-light'
                        }`
                      }
                    >
                      <span className="text-base">{group.icon}</span>
                      <span>{t(group.label)}</span>
                    </NavLink>
                  </li>
                );
              }

              // Render collapsible group
              return (
                <li key={group.key}>
                  <button
                    onClick={() => toggleGroup(group.key)}
                    className={`flex items-center gap-3 px-5 py-2.5 text-[13px] font-medium transition-colors w-full text-left ${
                      isGroupActive
                        ? 'text-ilo-blue'
                        : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-navy-light'
                    }`}
                  >
                    <span className="text-base">{group.icon}</span>
                    <span className="flex-1">{t(group.label)}</span>
                    <Chevron expanded={isExpanded} />
                  </button>

                  {/* Collapsible children */}
                  <div className={`overflow-hidden transition-all duration-200 ${isExpanded ? 'max-h-96' : 'max-h-0'}`}>
                    <ul>
                      {group.children.map(child => {
                        const active = isChildActive(child, location.pathname, location.search);
                        return (
                          <li key={child.to}>
                            <button
                              onClick={() => handleChildClick(child)}
                              className={`flex items-center gap-2 pl-12 pr-5 py-2 text-[12px] font-medium transition-colors w-full text-left relative ${
                                active
                                  ? 'text-ilo-blue bg-ilo-blue/5 dark:bg-ilo-blue/10 before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[3px] before:bg-ilo-blue before:rounded-r'
                                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-navy-light'
                              }`}
                            >
                              <span className="w-1 h-1 rounded-full bg-current opacity-50 shrink-0" />
                              <span>{t(child.label)}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="p-4 border-t border-border dark:border-navy-light">
          {/* Install App button */}
          {installPrompt && (
            <button onClick={promptInstall}
              className="w-full mb-3 px-3 py-2 text-xs font-semibold text-ilo-blue bg-ilo-blue/10 hover:bg-ilo-blue/20 rounded-lg transition-colors flex items-center gap-2 justify-center"
              aria-label={t('Install App')}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 3v12m0 0l-4-4m4 4l4-4"/></svg>
              {t('Install App')}
            </button>
          )}
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-full bg-ilo-blue/10 dark:bg-ilo-blue/20 flex items-center justify-center text-xs font-bold text-ilo-blue">
              {user?.name?.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold truncate dark:text-white">{user?.name}</p>
              <p className="text-[10px] text-gray-500 dark:text-gray-400 capitalize">{user?.role}</p>
            </div>
          </div>
          <button onClick={logout} aria-label={t('Logout')} className="w-full text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 py-1.5 rounded-lg transition-colors">
            {t('Logout')}
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Topbar */}
        <header role="banner" className="flex items-center justify-between px-4 lg:px-6 h-14 border-b border-border dark:border-navy-light bg-white/90 dark:bg-navy-mid/90 backdrop-blur-md shadow-sm shrink-0 z-10">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-navy-light" aria-label="Open menu">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16"/></svg>
            </button>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Home
              {breadcrumb.group && (
                <><span className="mx-1">/</span><span>{t(breadcrumb.group)}</span></>
              )}
              <span className="mx-1">/</span>
              <strong className="text-gray-900 dark:text-white">{t(breadcrumb.item)}</strong>
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Language toggle */}
            <div className="flex border border-border dark:border-navy-light rounded-lg overflow-hidden h-8">
              {['en', 'ur', 'ps'].map(l => (
                <button key={l} onClick={() => setLang(l)}
                  aria-label={`Switch language to ${l.toUpperCase()}`}
                  className={`px-2.5 text-[10px] font-semibold transition-colors ${lang === l ? 'bg-ilo-blue text-white' : 'bg-white dark:bg-navy-mid text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-navy-light'}`}>
                  {l.toUpperCase()}
                </button>
              ))}
            </div>

            {/* Dark mode */}
            <button onClick={toggle} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-navy-light transition-colors" aria-label="Toggle dark mode">
              {dark ? '☀️' : '🌙'}
            </button>
          </div>
        </header>

        {/* Offline / Syncing banners */}
        {!isOnline && (
          <div className="px-4 py-2 bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 text-xs font-semibold text-center flex items-center justify-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M18.364 5.636a9 9 0 11-12.728 0M12 9v4m0 4h.01"/></svg>
            {t('You are offline')} {pendingMutations > 0 && `— ${pendingMutations} ${t('pending changes')}`}
          </div>
        )}
        {syncing && (
          <div className="px-4 py-2 bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 text-xs font-semibold text-center flex items-center justify-center gap-2">
            <div className="animate-spin w-3 h-3 border-2 border-blue-600 border-t-transparent rounded-full" />
            {t('Syncing pending changes...')}
          </div>
        )}
        {user && user.emailVerified === false && <VerifyEmailBanner email={user.email} />}

        {/* Content */}
        <main id="main-content" className="flex-1 overflow-y-auto p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
