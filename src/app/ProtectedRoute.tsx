import {Navigate, Outlet, useLocation} from 'react-router-dom';
import {useAuth} from '@/hooks/useAuth';
import {copy} from '@/lib/copy';

export function ProtectedRoute() {
  const {authenticated, loading} = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center font-mono text-sm text-fg-muted">
        {copy.brand.name}
      </div>
    );
  }
  if (!authenticated) {
    return <Navigate to="/login" replace state={{from: location.pathname}} />;
  }
  return <Outlet />;
}
