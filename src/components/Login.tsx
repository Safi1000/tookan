import { useState } from 'react';
import { Lock, Mail, AlertCircle, Loader2 } from 'lucide-react';
import tdLogo from 'figma:asset/69bff70c5b17d559501ad9bfcdc1a4c7d2dce43e.png';

interface LoginProps {
  onLogin: (session: any, user: any) => void;
}

export function Login({ onLogin }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !password) {
      setError('Please fill in all fields');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      const result = await response.json();

      if (result.status === 'success' && result.data.session) {
        // Store session token
        localStorage.setItem('auth_token', result.data.session.access_token);
        localStorage.setItem('user', JSON.stringify(result.data.user));
        
        // Call onLogin with session and user data
        onLogin(result.data.session, result.data.user);
      } else {
        setError(result.message || 'Login failed. Please check your credentials.');
      }
    } catch (err) {
      console.error('Login error:', err);
      setError('Network error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background dark:bg-[#1A2C53] flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex w-20 h-20 rounded-2xl bg-card dark:bg-[#223560] items-center justify-center mb-4 shadow-lg dark:shadow-[0_0_24px_rgba(193,238,250,0.2)] border border-border dark:border-[#C1EEFA]/30">
            <img src={tdLogo} alt="TD Logo" className="w-16 h-16" />
          </div>
          <h1 className="text-heading text-2xl mb-2">Internal Admin Login</h1>
          <p className="text-subheading dark:text-[#99BFD1]">Access your TD system dashboard</p>
        </div>

        {/* Login Card */}
        <div className="bg-card dark:bg-[#223560] rounded-2xl border border-border dark:border-[#2A3C63] p-8 shadow-xl dark:shadow-2xl">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Error Message */}
            {error && (
              <div className="bg-[#DE3544]/10 border border-[#DE3544]/30 rounded-xl p-4 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-[#DE3544] flex-shrink-0 mt-0.5" />
                <p className="text-[#DE3544] text-sm">{error}</p>
              </div>
            )}

            {/* Email Field */}
            <div>
              <label htmlFor="email" className="block text-heading text-sm mb-2">
                Email / Username
              </label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 icon-default dark:text-[#99BFD1]" />
                <input
                  id="email"
                  type="text"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setError('');
                  }}
                  placeholder="Enter your email"
                  className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-xl px-12 py-3 text-heading dark:text-[#C1EEFA] placeholder-input-placeholder dark:placeholder-[#5B7894] focus:outline-none focus:border-[#DE3544] dark:focus:border-[#C1EEFA] focus:ring-2 focus:ring-[#DE3544]/20 dark:focus:ring-[#C1EEFA]/20 transition-all"
                />
              </div>
            </div>

            {/* Password Field */}
            <div>
              <label htmlFor="password" className="block text-heading text-sm mb-2">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 icon-default dark:text-[#99BFD1]" />
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError('');
                  }}
                  placeholder="Enter your password"
                  className="w-full bg-input-bg dark:bg-[#1A2C53] border border-input-border dark:border-[#2A3C63] rounded-xl px-12 py-3 text-heading dark:text-[#C1EEFA] placeholder-input-placeholder dark:placeholder-[#5B7894] focus:outline-none focus:border-[#DE3544] dark:focus:border-[#C1EEFA] focus:ring-2 focus:ring-[#DE3544]/20 dark:focus:ring-[#C1EEFA]/20 transition-all"
                />
              </div>
            </div>

            {/* Forgot Password */}
            <div className="text-right">
              <button
                type="button"
                className="text-[#DE3544] dark:text-[#C1EEFA] text-sm hover:text-[#C92A38] dark:hover:text-[#99BFD1] transition-colors"
              >
                Forgot Password?
              </button>
            </div>

            {/* Login Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-[#DE3544] text-white py-3 rounded-xl hover:shadow-[0_0_24px_rgba(222,53,68,0.4)] transition-all hover:scale-[1.02] active:scale-[0.98] hover:bg-[#9B3249] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Logging in...
                </>
              ) : (
                'Login'
              )}
            </button>
          </form>

          {/* Footer Note */}
          <div className="mt-6 pt-6 border-t border-border dark:border-[#2A3C63]">
            <p className="text-center text-muted-light dark:text-[#99BFD1] text-xs">
              For support, contact your system administrator
            </p>
          </div>
        </div>

        {/* Bottom Info */}
        <p className="text-center text-muted-light dark:text-[#99BFD1] text-xs mt-6">
          © 2025 TD Internal System. All rights reserved.
        </p>
      </div>
    </div>
  );
}
