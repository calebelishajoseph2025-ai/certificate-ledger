import {createContext, useContext, useEffect, useMemo, type ReactNode} from 'react';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {useNavigate} from 'react-router-dom';
import {api, setUnauthorizedHandler} from '@/lib/api';
import {keys} from '@/lib/keys';
import {copy} from '@/lib/copy';
import {toast} from '@/components/ui/toast';

interface AuthValue {
  authenticated: boolean;
  loading: boolean;
  login: (secret: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({children}: {children: ReactNode}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const me = useQuery({
    queryKey: keys.me(),
    queryFn: ({signal}) => api.me(signal),
  });

  useEffect(() => {
    setUnauthorizedHandler(() => {
      queryClient.setQueryData(keys.me(), {authenticated: false});
      navigate('/login', {replace: true});
    });
    return () => setUnauthorizedHandler(null);
  }, [navigate, queryClient]);

  const loginMutation = useMutation({
    mutationFn: (secret: string) => api.login(secret),
    onSuccess: async () => {
      await queryClient.invalidateQueries({queryKey: keys.me()});
    },
  });

  const logoutMutation = useMutation({
    mutationFn: () => api.logout(),
    onSuccess: async () => {
      await queryClient.clear();
      toast.success(copy.toast.loggedOut);
      navigate('/');
    },
  });

  const value = useMemo<AuthValue>(
    () => ({
      authenticated: Boolean(me.data?.authenticated),
      loading: me.isLoading,
      login: async (secret: string) => {
        await loginMutation.mutateAsync(secret);
      },
      logout: async () => {
        await logoutMutation.mutateAsync();
      },
    }),
    [me.data?.authenticated, me.isLoading, loginMutation, logoutMutation],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth requires AuthProvider');
  return ctx;
}
