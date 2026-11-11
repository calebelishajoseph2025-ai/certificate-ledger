import {lazy, Suspense} from 'react';
import {Navigate, Route, Routes, useLocation} from 'react-router-dom';
import {Shell} from '@/components/layout/Shell';
import {ProtectedRoute} from './ProtectedRoute';
import {Skeleton} from '@/components/ui/skeleton';
import {useAuth} from '@/hooks/useAuth';

const Home = lazy(() => import('@/pages/Home'));
const Login = lazy(() => import('@/pages/Login'));
const Verify = lazy(() => import('@/pages/Verify'));
const Developers = lazy(() => import('@/pages/Developers'));
const HowDuplicates = lazy(() => import('@/pages/HowDuplicatesArePrevented'));
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const Attendees = lazy(() => import('@/pages/Attendees'));
const ImportPage = lazy(() => import('@/pages/Import'));
const Courses = lazy(() => import('@/pages/Courses'));
const Duplicates = lazy(() => import('@/pages/Duplicates'));
const ActivityLog = lazy(() => import('@/pages/ActivityLog'));
const LedgerHealth = lazy(() => import('@/pages/LedgerHealth'));
const CertificateDetail = lazy(() => import('@/pages/CertificateDetail'));
const PrintPage = lazy(() => import('@/pages/Print'));
const BatchPrint = lazy(() => import('@/pages/BatchPrint'));

function Fall() {
  return <Skeleton className="h-64 w-full" />;
}

export function AppRoutes() {
  return (
    <Suspense fallback={<Fall />}>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/verify" element={<Verify />} />
          <Route path="/verify/:certId" element={<Verify />} />
          <Route path="/developers" element={<Developers />} />
          <Route path="/how-it-works/duplicates" element={<HowDuplicates />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/attendees" element={<Attendees />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/courses" element={<Courses />} />
            <Route path="/duplicates" element={<Duplicates />} />
            <Route path="/activity" element={<ActivityLog />} />
            <Route path="/health" element={<LedgerHealth />} />
            <Route path="/certificates/:certId" element={<CertificateDetail />} />
          </Route>
        </Route>
        <Route
          path="/print/:certId"
          element={
            <ProtectedPrint>
              <PrintPage />
            </ProtectedPrint>
          }
        />
        <Route
          path="/print/batch/:courseCode"
          element={
            <ProtectedPrint>
              <BatchPrint />
            </ProtectedPrint>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

function ProtectedPrint({children}: {children: React.ReactNode}) {
  const {authenticated, loading} = useAuth();
  const location = useLocation();
  if (loading) return <Fall />;
  if (!authenticated) {
    return <Navigate to="/login" replace state={{from: location.pathname}} />;
  }
  return <Suspense fallback={<Fall />}>{children}</Suspense>;
}
