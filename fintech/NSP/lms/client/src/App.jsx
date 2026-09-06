import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import JoinTraining from './pages/JoinTraining';
import PublicSurvey from './pages/PublicSurvey';
import Dashboard from './pages/Dashboard';
import Workers from './pages/Workers';
import Skills from './pages/Skills';
import Assessment from './pages/Assessment';
import Credentials from './pages/Credentials';
import Verification from './pages/Verification';
import PublicProfile from './pages/PublicProfile';
import Analytics from './pages/Analytics';
import Training from './pages/Training';
import RPL from './pages/RPL';
import LMS from './pages/LMS';
import CaseStudies from './pages/CaseStudies';
import Reports from './pages/Reports';
import Wallet from './pages/Wallet';
import Assessor from './pages/Assessor';
import Employer from './pages/Employer';
import TracerStudies from './pages/TracerStudies';
import Register from './pages/Register';
import VerifyEmail from './pages/VerifyEmail';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Profile from './pages/Profile';
import Documents from './pages/Documents';
import Jobs from './pages/Jobs';
import IssuerDashboard from './pages/IssuerDashboard';
import AdminPanel from './pages/AdminPanel';
import OAuthCallback from './pages/OAuthCallback';
import Pricing from './pages/Pricing';
import Companies from './pages/Companies';
import Classroom from './pages/Classroom';
import ClassView from './pages/ClassView';
import VerifyShared from './pages/VerifyShared';
import Exams from './pages/Exams';
import ExamRunner from './pages/ExamRunner';
import ExamResults from './pages/ExamResults';
import ExamAdmin from './pages/ExamAdmin';
import CoursePage from './pages/CoursePage';
import CourseManage from './pages/CourseManage';

function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="flex items-center justify-center h-screen"><div className="animate-spin w-8 h-8 border-4 border-ilo-blue border-t-transparent rounded-full" /></div>;
  // Remember where the user was headed so login can send them back there.
  if (!user) return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <>
      <Toaster position="top-right" toastOptions={{
        className: 'dark:bg-navy-mid dark:text-slate-200',
        duration: 3000,
      }} />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/auth/callback" element={<OAuthCallback />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/join/:id" element={<JoinTraining />} />
        <Route path="/s/:tid/:mid" element={<PublicSurvey />} />
        <Route path="/verify/profile/:workerId" element={<PublicProfile />} />
        <Route path="/verify/shared/:shareId" element={<VerifyShared />} />
        <Route path="/verify/:credentialId" element={<Verification />} />
        {/* Exam system — standalone full-screen pages; each handles its own auth/join redirect */}
        <Route path="/exam-admin" element={<ExamAdmin />} />
        <Route path="/exam/:id" element={<ExamRunner />} />
        <Route path="/exam/:id/a/:mid" element={<ExamRunner />} />
        <Route path="/exam/:id/results" element={<ExamResults />} />
        <Route path="/course/:id" element={<CoursePage />} />
        <Route path="/course/:id/manage" element={<CourseManage />} />
        <Route path="/course/:id/results" element={<ExamResults />} />
        <Route path="*" element={<Navigate to="/" replace />} />
        <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route index element={<Dashboard />} />
          <Route path="workers" element={<Workers />} />
          <Route path="skills" element={<Skills />} />
          <Route path="assessment" element={<Assessment />} />
          <Route path="credentials" element={<Credentials />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="training" element={<Training />} />
          <Route path="rpl" element={<ProtectedRoute roles={['admin', 'assessor', 'institution', 'worker']}><RPL /></ProtectedRoute>} />
          <Route path="lms" element={<LMS />} />
          <Route path="cases" element={<CaseStudies />} />
          <Route path="exams" element={<Exams />} />
          <Route path="reports" element={<ProtectedRoute roles={['admin', 'institution']}><Reports /></ProtectedRoute>} />
          <Route path="wallet" element={<Wallet />} />
          <Route path="assessor" element={<ProtectedRoute roles={['admin', 'assessor']}><Assessor /></ProtectedRoute>} />
          <Route path="employer" element={<ProtectedRoute roles={['admin', 'employer']}><Employer /></ProtectedRoute>} />
          <Route path="tracer-studies" element={<ProtectedRoute roles={['admin', 'institution', 'worker']}><TracerStudies /></ProtectedRoute>} />
          <Route path="profile" element={<Profile />} />
          <Route path="documents" element={<Documents />} />
          <Route path="jobs" element={<Jobs />} />
          <Route path="issuer" element={<ProtectedRoute roles={['admin', 'institution']}><IssuerDashboard /></ProtectedRoute>} />
          <Route path="admin" element={<ProtectedRoute roles={['admin']}><AdminPanel /></ProtectedRoute>} />
          <Route path="companies" element={<Companies />} />
          <Route path="classroom" element={<Classroom />} />
          <Route path="classroom/:id" element={<ClassView />} />
        </Route>
      </Routes>
    </>
  );
}
