import React, { useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { api } from '../lib/api';
import { setToken } from '../lib/auth';

interface LoginViewProps {
  onSignedIn: (username: string) => void;
}

export function LoginView({ onSignedIn }: LoginViewProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || !username || !password) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const session = await api.login(username, password);
      setToken(session.accessToken);
      onSignedIn(session.username);
    } catch (err: any) {
      setError(err.message);
      setPassword('');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center px-6" style={{ background: 'var(--canvas)' }}>
      <div className="w-full rise" style={{ maxWidth: 380 }}>
        <div className="flex flex-col items-center mb-7">
          <div
            className="grid place-items-center rounded-[14px] text-white text-[18px] font-bold mb-4"
            style={{
              width: 46,
              height: 46,
              background: 'linear-gradient(140deg, #6366f1, #4f46e5)',
              boxShadow: '0 6px 20px rgba(79,70,229,0.35)',
            }}
          >
            S
          </div>
          <h1 className="text-[19px] font-semibold tracking-[-0.02em]">Sales OS</h1>
          <p className="text-[13px] mt-1" style={{ color: 'var(--ink-3)' }}>
            Sign in to your revenue workspace
          </p>
        </div>

        <form onSubmit={handleSubmit} className="card p-6 flex flex-col gap-4">
          <div>
            <label htmlFor="username" className="block text-[12.5px] font-medium mb-1.5">
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              disabled={isSubmitting}
              className="field"
              placeholder="admin"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-[12.5px] font-medium mb-1.5">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              disabled={isSubmitting}
              className="field"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div
              className="px-3 py-2.5 rounded-[9px] text-[12.5px] leading-relaxed"
              style={{ background: 'var(--bad-soft)', border: '1px solid var(--bad-border)', color: 'var(--bad)' }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting || !username || !password}
            className="btn btn-primary w-full"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Signing in…
              </>
            ) : (
              <>
                Sign in <ArrowRight className="w-4 h-4" strokeWidth={2} />
              </>
            )}
          </button>
        </form>

        <p className="text-center text-[12px] mt-5" style={{ color: 'var(--ink-4)' }}>
          Credentials are configured in <span className="mono">Backend/.env</span>
        </p>
      </div>
    </div>
  );
}
