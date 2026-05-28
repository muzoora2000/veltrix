import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { registerCitizen } from '../api/client';
import { SUPPORTED_LANGUAGES, LanguageCode } from '../types/language';
import { ALL_DISTRICTS } from '../constants/districts';
import {
  AlertCircle, CheckCircle, Phone, Mail, User, MapPin, Lock,
  Loader2, Eye, EyeOff, Globe, Shield, ChevronRight,
  Users, Leaf, Building2,
} from 'lucide-react';

/* ─────────────────────────────────────────────────────────────
   Role cards
───────────────────────────────────────────────────────────── */
type RoleKey = 'citizen' | 'community_committee' | 'ngo_officer';

interface RoleCard {
  key: RoleKey;
  label: string;
  sub: string;
  icon: React.ElementType;
  from: string;
  to: string;
  border: string;
  badge: string;
}

const ROLE_CARDS: RoleCard[] = [
  {
    key: 'citizen',
    label: 'Citizen',
    sub: 'Report water & environment issues, track your reports, and get alerts in your area.',
    icon: User,
    from: '#2563eb', to: '#0891b2',
    border: 'border-blue-300 dark:border-blue-700',
    badge: 'bg-blue-100 text-blue-800',
  },
  {
    key: 'community_committee',
    label: 'Community Committee',
    sub: 'Committee chairpersons, secretaries, and members who manage local water governance.',
    icon: Users,
    from: '#059669', to: '#0891b2',
    border: 'border-emerald-300 dark:border-emerald-700',
    badge: 'bg-emerald-100 text-emerald-800',
  },
  {
    key: 'ngo_officer',
    label: 'NGO / Environmental Officer',
    sub: 'NGO partners, environmental activists, and research institutions.',
    icon: Leaf,
    from: '#d97706', to: '#b45309',
    border: 'border-amber-300 dark:border-amber-700',
    badge: 'bg-amber-100 text-amber-800',
  },
];

const COMMITTEE_POSITIONS = [
  'Chairperson', 'Vice Chairperson', 'Secretary', 'Treasurer',
  'Member', 'Technical Advisor', 'Women Representative', 'Youth Representative',
];

/* ─────────────────────────────────────────────────────────────
   Field component
───────────────────────────────────────────────────────────── */
function Field({
  label, required, children,
}: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-gray-700 mb-1.5">
        {label} {required && <span className="text-blue-500">*</span>}
      </label>
      {children}
    </div>
  );
}

const INPUT_CLS =
  'w-full pl-9 pr-4 py-3 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white text-gray-900 transition-colors';
const INPUT_NO_ICON =
  'w-full px-4 py-3 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white text-gray-900 transition-colors';

/* ─────────────────────────────────────────────────────────────
   Main
───────────────────────────────────────────────────────────── */
export default function CitizenRegistration() {
  const { setLanguage } = useLanguage();

  const [selectedRole, setSelectedRole] = useState<RoleKey | null>(null);
  const [step, setStep]                 = useState<'role' | 'form'>('role');
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState('');
  const [success, setSuccess]           = useState('');
  const [showPw, setShowPw]             = useState(false);
  const [showCpw, setShowCpw]           = useState(false);

  const [form, setForm] = useState({
    name: '', email: '', password: '', confirmPassword: '',
    phone: '', district: '', sub_county: '', location: '', language: 'en',
    // Community committee extras
    committee_name: '', committee_position: '', jurisdiction_area: '', office_contact: '',
    // NGO extras
    organization_name: '', ngo_reg_number: '', area_of_operation: '',
  });

  const update = (f: string) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => setForm(prev => ({ ...prev, [f]: e.target.value }));

  const chooseRole = (r: RoleKey) => {
    setSelectedRole(r);
    setStep('form');
    setError('');
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirmPassword) { setError('Passwords do not match.'); return; }
    if (!selectedRole) { setError('Please select an account type.'); return; }
    setLoading(true);

    const payload: Record<string, string | undefined> = {
      name: form.name, email: form.email, password: form.password,
      phone: form.phone, district: form.district, sub_county: form.sub_county,
      location: form.location, language: form.language,
      role: selectedRole,
    };

    if (selectedRole === 'community_committee') {
      payload.organization       = form.committee_name || undefined;
      payload.committee_position = form.committee_position || undefined;
      payload.jurisdiction_area  = form.jurisdiction_area || undefined;
      payload.office_contact     = form.office_contact || undefined;
    } else if (selectedRole === 'ngo_officer') {
      payload.organization       = form.organization_name || undefined;
      payload.ngo_reg_number     = form.ngo_reg_number || undefined;
      payload.area_of_operation  = form.area_of_operation || undefined;
    }

    try {
      const res = await registerCitizen(payload);
      const { token, user: newUser } = res.data;
      if (token && newUser) {
        const expiry = String(Date.now() + 365 * 24 * 60 * 60 * 1000);
        localStorage.setItem('hs_token', token);
        localStorage.setItem('hs_user', JSON.stringify(newUser));
        localStorage.setItem('hs_expiry', expiry);
        sessionStorage.removeItem('hs_token');
        sessionStorage.removeItem('hs_user');
      }
      setSuccess(res.data.message || 'Account created successfully! Taking you to your dashboard…');
      setTimeout(() => { window.location.href = '/dashboard'; }, 1500);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const activeCard = ROLE_CARDS.find(r => r.key === selectedRole);

  /* ───────────────── render ───────────────── */
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
            Register to report water issues, track environmental incidents, and contribute to safe water access in Uganda.
          </p>
          <div className="space-y-3">
            {[
              { icon: '✅', title: 'Instant Account Activation', desc: 'Register and access your dashboard immediately' },
              { icon: '🗣️', title: 'Role-Based Access', desc: 'Citizen, Committee, or NGO — each with a tailored experience' },
              { icon: '🌍', title: '10 Local Languages', desc: 'Luganda, Swahili, Luo, Runyankore & more' },
              { icon: '📊', title: 'Real-Time Reporting', desc: 'Submit, track, and receive updates on water issues' },
              { icon: '🔒', title: 'Secure by Default', desc: 'bcrypt passwords, JWT sessions, rate limiting' },
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

          {/* Banners */}
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

          {/* ═══ STEP 1: Role selection ═══ */}
          {step === 'role' && (
            <div>
              <h2 className="text-2xl font-bold text-gray-900 mb-1">Create Your Account</h2>
              <p className="text-gray-500 text-sm mb-6">Select the account type that best describes you</p>

              <div className="space-y-3 mb-6">
                {ROLE_CARDS.map(card => (
                  <button key={card.key} type="button" onClick={() => chooseRole(card.key)}
                    className={`w-full text-left flex items-center gap-4 p-4 rounded-2xl border-2 transition-all hover:shadow-md hover:-translate-y-0.5 bg-white ${card.border}`}>
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 shadow"
                      style={{ background: `linear-gradient(135deg, ${card.from}, ${card.to})` }}>
                      <card.icon size={20} className="text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-gray-900 text-sm">{card.label}</span>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${card.badge}`}>{card.key.replace(/_/g, ' ')}</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5 leading-snug">{card.sub}</p>
                    </div>
                    <ChevronRight size={16} className="text-gray-400 flex-shrink-0" />
                  </button>
                ))}
              </div>

              <p className="text-center text-sm text-gray-500">
                Already have an account?{' '}
                <Link to="/login" className="text-blue-600 font-semibold hover:underline">Sign In</Link>
              </p>
            </div>
          )}

          {/* ═══ STEP 2: Registration form ═══ */}
          {step === 'form' && selectedRole && activeCard && (
            <div>
              {/* Back button + role badge */}
              <div className="flex items-center gap-3 mb-5">
                <button type="button" onClick={() => setStep('role')}
                  className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1 font-medium transition-colors">
                  ← Back
                </button>
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                    style={{ background: `linear-gradient(135deg, ${activeCard.from}, ${activeCard.to})` }}>
                    <activeCard.icon size={13} className="text-white" />
                  </div>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${activeCard.badge}`}>{activeCard.label}</span>
                </div>
              </div>

              <h2 className="text-2xl font-bold text-gray-900 mb-1">
                {selectedRole === 'citizen' ? 'Citizen Registration' :
                 selectedRole === 'community_committee' ? 'Committee Member Registration' :
                 'NGO Officer Registration'}
              </h2>
              <p className="text-gray-500 text-sm mb-5">Fill in your details to create your account</p>

              <form onSubmit={handleRegister} className="space-y-4">

                {/* ── Core fields (all roles) ── */}
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

                {/* ── Community Committee extras ── */}
                {selectedRole === 'community_committee' && (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 space-y-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Building2 size={14} className="text-emerald-700" />
                      <span className="text-xs font-bold text-emerald-800 uppercase tracking-wider">Committee Details</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Field label="Committee Name">
                        <input type="text" value={form.committee_name} onChange={update('committee_name')}
                          placeholder="e.g. Kampala Water Users Committee"
                          className={INPUT_NO_ICON} />
                      </Field>
                      <Field label="Position / Role">
                        <select value={form.committee_position} onChange={update('committee_position')}
                          aria-label="Position / Role" className={INPUT_NO_ICON}>
                          <option value="">Select position</option>
                          {COMMITTEE_POSITIONS.map(p => <option key={p} value={p.toLowerCase().replace(/ /g, '_')}>{p}</option>)}
                        </select>
                      </Field>
                      <Field label="Jurisdiction Area">
                        <input type="text" value={form.jurisdiction_area} onChange={update('jurisdiction_area')}
                          placeholder="e.g. Makindye Sub-County"
                          className={INPUT_NO_ICON} />
                      </Field>
                      <Field label="Office Contact">
                        <input type="text" value={form.office_contact} onChange={update('office_contact')}
                          placeholder="Office phone or email"
                          className={INPUT_NO_ICON} />
                      </Field>
                    </div>
                  </div>
                )}

                {/* ── NGO extras ── */}
                {selectedRole === 'ngo_officer' && (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 space-y-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Leaf size={14} className="text-amber-700" />
                      <span className="text-xs font-bold text-amber-800 uppercase tracking-wider">Organisation Details</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Field label="Organisation Name">
                        <input type="text" value={form.organization_name} onChange={update('organization_name')}
                          placeholder="e.g. Water Aid Uganda"
                          className={INPUT_NO_ICON} />
                      </Field>
                      <Field label="NGO Registration Number">
                        <input type="text" value={form.ngo_reg_number} onChange={update('ngo_reg_number')}
                          placeholder="e.g. NGO/000123"
                          className={INPUT_NO_ICON} />
                      </Field>
                      <Field label="Area of Operation">
                        <input type="text" value={form.area_of_operation} onChange={update('area_of_operation')}
                          placeholder="District(s) covered"
                          className={INPUT_NO_ICON + ' sm:col-span-2'} />
                      </Field>
                    </div>
                  </div>
                )}

                {/* ── Password fields ── */}
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
                  style={{ background: `linear-gradient(135deg, ${activeCard.from}, ${activeCard.to})` }}>
                  {loading
                    ? <><Loader2 size={16} className="animate-spin" /> Creating Account…</>
                    : 'Create Account'}
                </button>
              </form>

              <p className="text-center text-sm text-gray-500 mt-5">
                Already have an account?{' '}
                <Link to="/login" className="text-blue-600 font-semibold hover:underline">Sign In</Link>
              </p>
            </div>
          )}

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
