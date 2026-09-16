import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  Eye,
  EyeOff,
  FileSearch,
  Gauge,
  Loader2,
  Lock,
  PenLine,
  Search,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { HealthResponse, Role } from '../types';
import { api } from '../lib/api';
import { setToken } from '../lib/auth';

interface LoginViewProps {
  onSignedIn: (username: string, role: Role) => void;
}

/*
 * Split screen. The left half tells a first-time visitor what this is - the
 * four agents, the three ideas the product is built on, and whether the
 * backend is actually up - so the sign-in form on the right can stay small.
 * On a phone the story collapses to its header and the status strip.
 */

const PIPELINE: { icon: React.ElementType; label: string; blurb: string }[] = [
  {
    icon: Search,
    label: 'Discovery',
    blurb: 'Searches the web for real companies that match the brief, and checks every domain resolves.',
  },
  {
    icon: FileSearch,
    label: 'Research',
    blurb: 'What they sell, their latest launch, why now, and who decides.',
  },
  {
    icon: Gauge,
    label: 'ICP scoring',
    blurb: 'A score out of 100 with the reason codes behind it, so a person can argue with the number.',
  },
  {
    icon: PenLine,
    label: 'Personalization',
    blurb: 'The email, the LinkedIn note and the call opener. Nothing sends without you pressing send.',
  },
];

const PRINCIPLES: { title: string; body: string }[] = [
  {
    title: 'Cost is measured, not estimated',
    body: 'Every Claude call records its real token usage and is priced from the published rates.',
  },
  {
    title: 'Models routed by task',
    body: 'Research and personalization on the large model; enrichment and reply triage on the small one.',
  },
  {
    title: 'Refresh on dependency, not on schedule',
    body: 'A record is re-verified only when it has decayed and something depends on it.',
  },
];

type Tone = 'good' | 'warn' | 'bad' | 'muted';

const TONE: Record<Tone, string> = {
  good: '#4bdcb8',
  warn: '#f6b26b',
  bad: '#ff8a95',
  muted: 'rgba(255,255,255,0.5)',
};

function StatusDot({ tone, text }: { tone: Tone; text: string }) {
  return (
    <span className="inline-flex items-center gap-2" style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.78)' }}>
      <span
        className="rounded-full shrink-0"
        style={{
          width: 7,
          height: 7,
          background: TONE[tone],
          boxShadow: `0 0 0 3px ${TONE[tone]}33`,
          animation: tone === 'muted' ? 'pulse 1.4s ease-in-out infinite' : undefined,
        }}
      />
      {text}
    </span>
  );
}

export function LoginView({ onSignedIn }: LoginViewProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // undefined = still asking, null = the backend did not answer.
  const [health, setHealth] = useState<HealthResponse | null | undefined>(undefined);
  useEffect(() => {
    api.getHealth().then(setHealth).catch(() => setHealth(null));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || !username || !password) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const session = await api.login(username, password);
      setToken(session.accessToken);
      onSignedIn(session.username, session.role);
    } catch (err: any) {
      setError(err.message);
      setPassword('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const status: { tone: Tone; text: string }[] =
    health === undefined
      ? [{ tone: 'muted', text: 'Checking the backend…' }]
      : health === null
        ? [{ tone: 'bad', text: 'Backend offline — start it on port 8000' }]
        : [
            {
              tone: health.claudeConfigured ? 'good' : 'warn',
              text: health.claudeConfigured ? 'Agents ready' : 'No Claude API key in Backend/.env',
            },
            {
              tone: health.databaseConnected ? 'good' : 'bad',
              text: health.databaseConnected ? 'Database connected' : 'Database unreachable',
            },
          ];

  return (
    <div className="login-page">
      {/* ------------------------------ Story ------------------------------ */}
      <aside className="login-story">
        <div className="login-orb login-orb-a" aria-hidden="true" />
        <div className="login-orb login-orb-b" aria-hidden="true" />
        <div className="login-grid" aria-hidden="true" />

        <div className="relative flex flex-col gap-9" style={{ zIndex: 1 }}>
          <header className="flex items-center gap-3">
            <div
              className="grid place-items-center shrink-0"
              style={{
                width: 40,
                height: 40,
                borderRadius: 13,
                background: 'rgba(255,255,255,0.12)',
                border: '1px solid rgba(255,255,255,0.18)',
                backdropFilter: 'blur(6px)',
              }}
            >
              <Sparkles className="w-5 h-5" strokeWidth={2.3} style={{ color: '#c4b5fd' }} />
            </div>
            <div className="leading-tight">
              <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.02em' }}>Sales OS</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>
                IMR Tech Solutions · Introspective Market Research
              </div>
            </div>
          </header>

          <div>
            <h2
              style={{
                fontSize: 'clamp(26px, 3vw, 36px)',
                fontWeight: 700,
                letterSpacing: '-0.03em',
                lineHeight: 1.12,
                maxWidth: 520,
              }}
            >
              Find the accounts worth a rep&apos;s morning.
            </h2>
            <p
              className="mt-3"
              style={{ fontSize: 14.5, lineHeight: 1.6, color: 'rgba(255,255,255,0.68)', maxWidth: 480 }}
            >
              Describe an ideal customer in plain language. Four agents find, research, score and
              draft the outreach, and every step is priced before you approve it.
            </p>
          </div>

          <ol className="login-desktop flex flex-col" style={{ gap: 0 }}>
            {PIPELINE.map((step, i) => {
              const Icon = step.icon;
              const last = i === PIPELINE.length - 1;
              return (
                <li key={step.label} className="flex gap-3.5" style={{ paddingBottom: last ? 0 : 18 }}>
                  <div className="flex flex-col items-center shrink-0">
                    <span
                      className="grid place-items-center"
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 11,
                        background: 'rgba(255,255,255,0.10)',
                        border: '1px solid rgba(255,255,255,0.16)',
                        color: '#ddd6fe',
                      }}
                    >
                      <Icon className="w-4 h-4" strokeWidth={2.2} />
                    </span>
                    {!last && (
                      <span
                        aria-hidden="true"
                        style={{ width: 1, flex: 1, marginTop: 6, background: 'rgba(255,255,255,0.14)' }}
                      />
                    )}
                  </div>
                  <div style={{ paddingTop: 5 }}>
                    <div className="flex items-center gap-2">
                      <span style={{ fontSize: 14, fontWeight: 650 }}>{step.label}</span>
                      <span
                        className="mono"
                        style={{
                          fontSize: 10,
                          padding: '1px 6px',
                          borderRadius: 6,
                          background: 'rgba(255,255,255,0.10)',
                          color: 'rgba(255,255,255,0.7)',
                          letterSpacing: '0.04em',
                        }}
                      >
                        {i + 1} / {PIPELINE.length}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, lineHeight: 1.55, color: 'rgba(255,255,255,0.62)', marginTop: 2 }}>
                      {step.blurb}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>

          <div className="login-desktop login-proof grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {PRINCIPLES.map((p) => (
              <div
                key={p.title}
                style={{
                  padding: '12px 14px',
                  borderRadius: 14,
                  background: 'rgba(255,255,255,0.07)',
                  border: '1px solid rgba(255,255,255,0.12)',
                }}
              >
                <div style={{ fontSize: 12.5, fontWeight: 650, lineHeight: 1.35 }}>{p.title}</div>
                <div style={{ fontSize: 12, lineHeight: 1.5, color: 'rgba(255,255,255,0.58)', marginTop: 4 }}>
                  {p.body}
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {status.map((s) => (
              <StatusDot key={s.text} tone={s.tone} text={s.text} />
            ))}
            {health && (
              <span
                className="mono"
                style={{
                  fontSize: 10.5,
                  padding: '2px 7px',
                  borderRadius: 6,
                  background: 'rgba(255,255,255,0.10)',
                  color: 'rgba(255,255,255,0.7)',
                }}
              >
                {health.modelLarge}
              </span>
            )}
          </div>
        </div>
      </aside>

      {/* ------------------------------ Form ------------------------------- */}
      <main className="login-form-panel">
        <div className="w-full rise" style={{ maxWidth: 400 }}>
          <div className="eyebrow mb-2">Welcome back</div>
          <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.15 }}>
            Sign in
          </h1>
          <p className="mt-2 mb-7" style={{ fontSize: 13.5, color: 'var(--ink-3)' }}>
            Use the login an admin created for you. Sessions stay signed in on this device.
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
            <div>
              <label htmlFor="username" className="block text-[12.5px] font-medium mb-1.5">
                Username
              </label>
              <div className="login-input-wrap">
                <UserRound className="login-input-icon w-4 h-4" strokeWidth={2.2} />
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  autoFocus
                  disabled={isSubmitting}
                  className="field"
                  placeholder="your username"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-[12.5px] font-medium mb-1.5">
                Password
              </label>
              <div className="login-input-wrap">
                <Lock className="login-input-icon w-4 h-4" strokeWidth={2.2} />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  disabled={isSubmitting}
                  className="field"
                  placeholder="••••••••"
                  style={{ paddingRight: 48 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  disabled={isSubmitting}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  title={showPassword ? 'Hide password' : 'Show password'}
                  className="login-eye btn btn-ghost"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" strokeWidth={2.2} />
                  ) : (
                    <Eye className="w-4 h-4" strokeWidth={2.2} />
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div
                role="alert"
                className="px-3.5 py-2.5 rounded-[10px] text-[12.5px] leading-relaxed"
                style={{ background: 'var(--bad-soft)', border: '1px solid var(--bad-border)', color: 'var(--bad)' }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting || !username || !password}
              className="btn btn-primary w-full mt-1"
              style={{ height: 48, borderRadius: 14, fontSize: 14.5 }}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Signing in…
                </>
              ) : (
                <>
                  Sign in <ArrowRight className="w-4 h-4" strokeWidth={2.2} />
                </>
              )}
            </button>
          </form>

          <div
            className="mt-7 pt-5 flex flex-col gap-2"
            style={{ borderTop: '1px solid var(--border)', fontSize: 12.5, color: 'var(--ink-4)', lineHeight: 1.55 }}
          >
            <span>Locked out? An admin can set a new password for you from Team.</span>
            <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>
              python scripts/manage_user.py set &lt;username&gt; &lt;password&gt;
            </span>
          </div>
        </div>
      </main>
    </div>
  );
}
