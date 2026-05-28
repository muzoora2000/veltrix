import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { registerCitizen } from '../api/client';
import { SUPPORTED_LANGUAGES, LanguageCode } from '../types/language';
import { ALL_DISTRICTS } from '../constants/districts';
import {
  AlertCircle, CheckCircle, Phone, Mail, User, MapPin, Lock,
  Loader2, Eye, EyeOff, Globe, Shield,
} from 'lucide-react';

const INPUT_CLS =
  'w-full pl-9 pr-4 py-3 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white text-gray-900 transition-colors';
const INPUT_NO_ICON =
  'w-full px-4 py-3 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white text-gray-900 transition-colors';

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-gray-700 mb-1.5">
        {label} {required && <span className="text-blue-500">*</span>}
      </label>
      {children}
    </div>
  );
}

export default function CitizenRegistration() {
  const { setLanguage } = useLanguage();

  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [success, setSuccess] = useState('');
  const [showPw, setShowPw]   = useState(false);
  const [showCpw, setShowCpw] = useState(false);

  const [form, setForm] = useState({
    name: '', email: '', password: '', confirmPassword: '',
    phone: '', district: '', sub_county: '', location: '', language: 'en',
  });

  const update = (f: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [f]: e.target.value }));

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirmPassword) { setError('Passwords do not match.'); return; }
    setLoading(true);
    try {
      const res = await registerCitizen({
        name: form.name, email: form.email, password: form.password,
        phone: form.phone, district: form.district, sub_county: form.sub_county,
        location: form.location, language: form.language,
      });
      const { token, user: newUser } = res.data;
      if (token && newUser) {
        const expiry = String(Date.now() + 365 * 24 * 60 * 60 * 1000);
        localStorage.setItem('hs_token', token);
        localStorage.setItem('hs_user', JSON.stringify(newUser));
        localStorage.setItem('hs_expiry', expiry);
        sessionStorage.removeItem('hs_token');
        sessionStorage.removeItem('hs_user');
      }
      setSuccess(res.data.message || 'Account created! Taking you to your dashboard…');
      setTimeout(() => { window.location.href = '/dashboard'; }, 1500);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-gray-50">

      {/* Left panel */}
      <div className="hidden lg:flex lg:w-[42%] bg-gradient-to-br from-blue-900 via-blue-800 to-cyan-700 relative overflow-hidden p-10 flex-col justify-between">
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-10">
            <div className="w-12 h-12 rounded-2xl bg-white/15 flex items-center justify-center text-2xl border border-white/20">💧</div>
            <div>
              <div className="font-bold text-white text-lg">HydroSense</div>
              <div className="text-blue-200 text-xs">Ministry of Water &amp; Environment</div>
            </div>
          </div>
          <h1 className="text-3xl font-bold text-white mb-3">Join HydroSense</h1>
          <p className="text-blue-100/80 text-sm leading-relaxed mb-8">
            Register to report water issues, track environmental incidents, and help protect Uganda's water resources.
          </p>
          <div className="space-y-3">
            {[
              { icon: '📊', title: 'Report Issues', desc: 'Submit water and environmental complaints directly from your phone' },
              { icon: '📍', title: 'Track Reports', desc: 'Follow the status of your submitted reports in real time' },
              { icon: '🔔', title: 'Receive Alerts', desc: 'Get notified about water quality and environmental alerts in your area' },
              { icon: '🌍', title: '10 Local Languages', desc: 'Luganda, Swahili, Luo, Runyankore & more' },
              { icon: '🔒', title: 'Secure by Default', desc: 'bcrypt passwords, JWT sessions, rate-limited access' },
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-3 bg-white/10 rounded-xl p-3 border border-white/10">
                <span className="text-lg">{item.icon}</span>
                <div>
                  <div className="text-white font-semibold text-sm">{item.title}</div>
                  <div className="text-blue-200/70 text-xs">{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-8 p-4 rounded-xl bg-white/10 border border-white/15">
            <p className="text-blue-200 text-xs leading-relaxed">
              <span className="font-bold text-white">Are you a Community Committee member?</span><br />
              Committee accounts are created by District Officers. Contact your District Water Office to get your access credentials.
            </p>
          </div>
        </div>
        <div className="relative z-10 text-blue-200/60 text-xs">256-bit Encryption · JWT Secured · ISO 27001</div>
        <div className="absolute inset-0 opacity-10 pointer-events-none">
          <div className="absolute top-20 left-10 w-72 h-72 bg-blue-400 rounded-full blur-[100px]" />
          <div className="absolute bottom-20 right-10 w-96 h-96 bg-cyan-400 rounded-full blur-[120px]" />
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-start justify-center p-5 lg:p-10 overflow-y-auto">
        <div className="w-full max-w-lg py-4">

          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-xl">💧</div>
            <div className="font-bold text-gray-900 text-sm">HydroSense</div>
          </div>

          {error && (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-sm text-red-700">
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5 text-red-500" /><span>{error}</span>
            </div>
          )}
          {success && (
            <div className="mb-4 px-4 py-3 bg-green-50 border border-green-200 rounded-xl flex items-center gap-3 text-sm text-green-700">
              <CheckCircle size={16} className="flex-shrink-0 text-green-500" /><span>{success}</span>
            </div>
          )}

          <h2 className="text-2xl font-bold text-gray-900 mb-1">Create Citizen Account</h2>
          <p className="text-gray-500 text-sm mb-6">Join HydroSense to report and track water issues in your community</p>

          <form onSubmit={handleRegister} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

              <Field label="Full Name" required>
                <div className="relative">
                  <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input type="text" value={form.name} onChange={update('name')} required placeholder="John Doe"
                    className={INPUT_CLS} />
                </div>
              </Field>

              <Field label="Phone Number" required>
                <div className="relative">
                  <Phone size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input type="tel" value={form.phone} onChange={update('phone')} required placeholder="+256 700 000 000"
                    className={INPUT_CLS} />
                </div>
              </Field>

              <Field label="Email Address" required>
                <div className="relative">
                  <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input type="email" value={form.email} onChange={update('email')} required placeholder="you@example.com"
                    className={INPUT_CLS} />
                </div>
              </Field>

              <Field label="District" required>
                <div className="relative">
                  <MapPin size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <select value={form.district} onChange={update('district')} required
                    aria-label="District" className={INPUT_CLS + ' appearance-none'}>
                    <option value="">Select district</option>
                    {ALL_DISTRICTS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              </Field>

              <Field label="Sub-County">
                <input type="text" value={form.sub_county} onChange={update('sub_county')} placeholder="Sub-county"
                  className={INPUT_NO_ICON} />
              </Field>

              <Field label="Village / Area">
                <input type="text" value={form.location} onChange={update('location')} placeholder="Village or area"
                  className={INPUT_NO_ICON} />
              </Field>

              <Field label="Preferred Language">
                <div className="relative">
                  <Globe size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <select value={form.language} aria-label="Preferred Language"
                    onChange={e => { update('language')(e); setLanguage(e.target.value as LanguageCode); }}
                    className={INPUT_CLS + ' appearance-none'}>
                    {SUPPORTED_LANGUAGES.map(l => (
                      <option key={l.code} value={l.code}>{l.nativeName} ({l.name})</option>
                    ))}
                  </select>
                </div>
              </Field>

            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Password" required>
                <div className="relative">
                  <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input type={showPw ? 'text' : 'password'} value={form.password} onChange={update('password')}
                    required minLength={6} placeholder="Min 6 characters"
                    className={INPUT_CLS + ' pr-10'} />
                  <button type="button" onClick={() => setShowPw(p => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </Field>
              <Field label="Confirm Password" required>
                <div className="relative">
                  <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input type={showCpw ? 'text' : 'password'} value={form.confirmPassword} onChange={update('confirmPassword')}
                    required minLength={6} placeholder="Re-enter password"
                    className={INPUT_CLS + ' pr-10'} />
                  <button type="button" onClick={() => setShowCpw(p => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showCpw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </Field>
            </div>

            <div className="flex items-center gap-2 text-xs text-gray-400">
              <Shield size={12} /><span>Your data is encrypted and used only for environmental reporting.</span>
            </div>

            <button type="submit" disabled={loading}
              className="w-full py-3.5 rounded-xl font-bold text-white text-sm shadow-lg flex items-center justify-center gap-2 disabled:opacity-60 transition-all hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #2563eb, #0891b2)' }}>
              {loading
                ? <><Loader2 size={16} className="animate-spin" /> Creating Account…</>
                : 'Create Citizen Account'}
            </button>
          </form>

          <p className="text-center text-sm text-gray-500 mt-5">
            Already have an account?{' '}
            <Link to="/login" className="text-blue-600 font-semibold hover:underline">Sign In</Link>
          </p>

          <div className="flex items-center justify-center gap-4 mt-6 text-xs text-gray-400">
            <div className="flex items-center gap-1"><Shield size={11} /> JWT Secured</div>
            <div className="w-1 h-1 rounded-full bg-gray-300" />
            <span>256-bit Encryption</span>
          </div>
        </div>
      </div>
    </div>
  );
}
