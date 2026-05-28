import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Droplets, AlertTriangle, FileText, Bell, MapPin, Clock,
  ChevronRight, CheckCircle2, Radio, Megaphone,
  MessageSquare, Languages, Navigation, Activity,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { getAlerts, getMyReports, getWaterPoints, getNotifications } from '../../api/client';

/* ─────────────────────────────────────────────────────────────
   Types
───────────────────────────────────────────────────────────── */
interface Alert {
  id: number;
  title: string;
  description: string;
  severity: string;
  district: string;
  created_at: string;
  status: string;
}

interface MyReport {
  id: number;
  title: string;
  category: string;
  status: string;
  created_at: string;
  location?: string;
}

interface WaterPoint {
  id: number;
  name: string;
  type: string;
  status: string;
  district: string;
  sub_county?: string;
}

interface Notification {
  id: number;
  title: string;
  message: string;
  type: string;
  created_at: string;
  read_at: string | null;
}

/* ─────────────────────────────────────────────────────────────
   Helpers
───────────────────────────────────────────────────────────── */
function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const SEVERITY_STYLE: Record<string, { dot: string; bg: string; border: string; text: string; label: string }> = {
  emergency: { dot: 'bg-red-500',    bg: 'bg-red-50 dark:bg-red-950/50',    border: 'border-red-200 dark:border-red-800',    text: 'text-red-800 dark:text-red-200',    label: 'Emergency' },
  critical:  { dot: 'bg-orange-500', bg: 'bg-orange-50 dark:bg-orange-950/50', border: 'border-orange-200 dark:border-orange-800', text: 'text-orange-800 dark:text-orange-200', label: 'Critical' },
  warning:   { dot: 'bg-yellow-500', bg: 'bg-yellow-50 dark:bg-yellow-950/50', border: 'border-yellow-200 dark:border-yellow-800', text: 'text-yellow-800 dark:text-yellow-200', label: 'Warning' },
  info:      { dot: 'bg-blue-500',   bg: 'bg-blue-50 dark:bg-blue-950/50',   border: 'border-blue-200 dark:border-blue-800',   text: 'text-blue-800 dark:text-blue-200',   label: 'Info' },
};

const STATUS_STYLE: Record<string, string> = {
  pending:     'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200',
  in_progress: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
  resolved:    'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
  closed:      'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  rejected:    'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
};

const WATER_STATUS: Record<string, { dot: string; label: string }> = {
  functional:     { dot: 'bg-green-500',  label: 'Functional' },
  needs_repair:   { dot: 'bg-orange-500', label: 'Needs Repair' },
  non_functional: { dot: 'bg-red-500',    label: 'Non-Functional' },
  seasonal:       { dot: 'bg-blue-400',   label: 'Seasonal' },
};

/* ─────────────────────────────────────────────────────────────
   Quick Actions
───────────────────────────────────────────────────────────── */
const QUICK_ACTIONS = [
  {
    to: '/citizen-report',
    icon: FileText,
    label: 'Report an Issue',
    sub: 'Submit water/environment issue',
    color: 'text-blue-700 dark:text-blue-300',
    bg: 'bg-blue-50 dark:bg-blue-900/30',
    border: 'border-blue-200 dark:border-blue-700',
    grad: { from: '#2563eb', to: '#1d4ed8' },
  },
  {
    to: '/multilingual-report',
    icon: Languages,
    label: 'AI Report (Multilingual)',
    sub: 'Report in your language',
    color: 'text-violet-700 dark:text-violet-300',
    bg: 'bg-violet-50 dark:bg-violet-900/30',
    border: 'border-violet-200 dark:border-violet-700',
    grad: { from: '#7c3aed', to: '#6d28d9' },
  },
  {
    to: '/track-reports',
    icon: Navigation,
    label: 'Track My Reports',
    sub: 'Check your report status',
    color: 'text-emerald-700 dark:text-emerald-300',
    bg: 'bg-emerald-50 dark:bg-emerald-900/30',
    border: 'border-emerald-200 dark:border-emerald-700',
    grad: { from: '#059669', to: '#047857' },
  },
  {
    to: '/water-infrastructure',
    icon: Droplets,
    label: 'Find Water Sources',
    sub: 'Nearby safe water points',
    color: 'text-cyan-700 dark:text-cyan-300',
    bg: 'bg-cyan-50 dark:bg-cyan-900/30',
    border: 'border-cyan-200 dark:border-cyan-700',
    grad: { from: '#0891b2', to: '#0284c7' },
  },
  {
    to: '/gwn',
    icon: Activity,
    label: 'GWN — Water Network',
    sub: 'Environmental intelligence',
    color: 'text-teal-700 dark:text-teal-300',
    bg: 'bg-teal-50 dark:bg-teal-900/30',
    border: 'border-teal-200 dark:border-teal-700',
    grad: { from: '#0d9488', to: '#0f766e' },
  },
  {
    to: '/citizen-hub',
    icon: MessageSquare,
    label: 'Community Hub',
    sub: 'Discussions & events',
    color: 'text-amber-700 dark:text-amber-300',
    bg: 'bg-amber-50 dark:bg-amber-900/30',
    border: 'border-amber-200 dark:border-amber-700',
    grad: { from: '#d97706', to: '#b45309' },
  },
];

/* ─────────────────────────────────────────────────────────────
   Component
───────────────────────────────────────────────────────────── */
export default function CitizenDashboard() {
  const { user } = useAuth();

  const [alerts, setAlerts]       = useState<Alert[]>([]);
  const [reports, setReports]     = useState<MyReport[]>([]);
  const [waterPts, setWaterPts]   = useState<WaterPoint[]>([]);
  const [notifs, setNotifs]       = useState<Notification[]>([]);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [aRes, rRes, wRes, nRes] = await Promise.allSettled([
          getAlerts({ limit: 5, status: 'active' }),
          getMyReports(),
          getWaterPoints({ limit: 6, district: user?.district }),
          getNotifications({ limit: 5, unread: true }),
        ]);
        if (aRes.status === 'fulfilled') setAlerts((aRes.value.data?.alerts ?? aRes.value.data ?? []).slice(0, 5));
        if (rRes.status === 'fulfilled') setReports((rRes.value.data?.reports ?? rRes.value.data ?? []).slice(0, 5));
        if (wRes.status === 'fulfilled') setWaterPts((wRes.value.data?.water_points ?? wRes.value.data?.waterPoints ?? wRes.value.data ?? []).slice(0, 6));
        if (nRes.status === 'fulfilled') setNotifs((nRes.value.data?.notifications ?? nRes.value.data ?? []).slice(0, 5));
      } catch {
        // silently degrade
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user?.district]);

  const activeAlerts  = alerts.filter(a => a.status === 'active').length;
  const pendingReports = reports.filter(r => r.status === 'pending' || r.status === 'in_progress').length;
  const unreadNotifs  = notifs.filter(n => !n.read_at).length;
  const functionalWater = waterPts.filter(w => w.status === 'functional').length;

  return (
    <div className="space-y-6 pb-8">

      {/* ── Welcome Header ── */}
      <div className="rounded-2xl overflow-hidden shadow-md"
        style={{ background: 'linear-gradient(135deg, #1d4ed8 0%, #0891b2 60%, #0e7490 100%)' }}>
        <div className="p-6 relative">
          <div className="absolute inset-0 opacity-10"
            style={{ backgroundImage: 'radial-gradient(circle at 70% 50%, white 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
          <div className="relative flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center text-2xl font-extrabold text-white shadow-lg">
                {user?.name?.charAt(0)?.toUpperCase() ?? 'C'}
              </div>
              <div>
                <p className="text-blue-100 text-sm font-medium">Welcome back</p>
                <h1 className="text-white text-xl font-extrabold tracking-tight">{user?.name ?? 'Citizen'}</h1>
                {user?.district && (
                  <div className="flex items-center gap-1.5 mt-1">
                    <MapPin size={12} className="text-blue-200" />
                    <span className="text-blue-200 text-xs font-medium">{user.district}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="sm:ml-auto flex flex-wrap gap-2">
              <div className="px-3 py-1.5 rounded-xl bg-white/15 backdrop-blur text-xs font-semibold text-white flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                Citizen
              </div>
              {unreadNotifs > 0 && (
                <div className="px-3 py-1.5 rounded-xl bg-white/15 backdrop-blur text-xs font-semibold text-white flex items-center gap-1.5">
                  <Bell size={12} />
                  {unreadNotifs} new alert{unreadNotifs > 1 ? 's' : ''}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Active Alerts',     value: loading ? '—' : activeAlerts,      sub: 'In your area',        icon: AlertTriangle, from: '#dc2626', to: '#ea580c' },
          { label: 'My Reports',        value: loading ? '—' : reports.length,    sub: `${pendingReports} pending`, icon: FileText,      from: '#2563eb', to: '#0891b2' },
          { label: 'Water Sources',     value: loading ? '—' : waterPts.length,   sub: `${functionalWater} functional`, icon: Droplets,      from: '#0891b2', to: '#0d9488' },
          { label: 'Notifications',     value: loading ? '—' : unreadNotifs,      sub: 'Unread',              icon: Bell,          from: '#7c3aed', to: '#6d28d9' },
        ].map(card => (
          <div key={card.label}
            className="relative overflow-hidden rounded-2xl border shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
            style={{ background: `linear-gradient(135deg, ${card.from}15 0%, ${card.to}10 100%)`, borderColor: `${card.from}35` }}>
            <div className="absolute bottom-0 left-0 right-0 h-0.5 rounded-b-2xl"
              style={{ background: `linear-gradient(90deg, ${card.from}50, ${card.to}50)` }} />
            <div className="p-4">
              <div className="flex items-start justify-between mb-2">
                <p className="text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">{card.label}</p>
                <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: `${card.from}20` }}>
                  <card.icon size={14} style={{ color: card.from }} />
                </div>
              </div>
              {loading
                ? <div className="h-8 w-14 rounded-lg animate-pulse bg-gray-200 dark:bg-gray-700" />
                : <p className="text-2xl font-extrabold text-gray-900 dark:text-white">{card.value}</p>
              }
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 font-medium">{card.sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Main content grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── Left / centre (2 cols) ── */}
        <div className="lg:col-span-2 space-y-6">

          {/* Quick Actions */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm">
            <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
              <h2 className="font-extrabold text-gray-900 dark:text-white text-sm tracking-tight">Quick Actions</h2>
              <span className="text-xs text-gray-400">What would you like to do?</span>
            </div>
            <div className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
              {QUICK_ACTIONS.map(a => (
                <Link key={a.to} to={a.to}
                  className={`flex flex-col gap-2 p-3 rounded-xl border transition-all hover:-translate-y-0.5 hover:shadow-md ${a.bg} ${a.border}`}>
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                    style={{ background: `linear-gradient(135deg, ${a.grad.from}, ${a.grad.to})` }}>
                    <a.icon size={16} className="text-white" />
                  </div>
                  <div>
                    <p className={`text-xs font-bold leading-tight ${a.color}`}>{a.label}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-tight">{a.sub}</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* My Recent Reports */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm">
            <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
              <h2 className="font-extrabold text-gray-900 dark:text-white text-sm tracking-tight flex items-center gap-2">
                <FileText size={14} className="text-blue-600" /> My Recent Reports
              </h2>
              <Link to="/track-reports" className="text-xs text-blue-600 hover:underline font-medium flex items-center gap-1">
                View all <ChevronRight size={12} />
              </Link>
            </div>
            <div className="divide-y divide-gray-50 dark:divide-gray-800">
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="p-4 animate-pulse flex gap-3">
                    <div className="w-8 h-8 rounded-xl bg-gray-200 dark:bg-gray-700 flex-shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3.5 w-2/3 rounded bg-gray-200 dark:bg-gray-700" />
                      <div className="h-3 w-1/3 rounded bg-gray-100 dark:bg-gray-800" />
                    </div>
                  </div>
                ))
              ) : reports.length === 0 ? (
                <div className="p-8 text-center">
                  <FileText size={32} className="text-gray-300 dark:text-gray-700 mx-auto mb-2" />
                  <p className="text-sm text-gray-400 font-medium">No reports submitted yet</p>
                  <Link to="/citizen-report"
                    className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:underline">
                    Submit your first report <ChevronRight size={12} />
                  </Link>
                </div>
              ) : (
                reports.map(r => (
                  <div key={r.id} className="p-4 flex items-start gap-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                    <div className="w-8 h-8 rounded-xl bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center flex-shrink-0">
                      <FileText size={14} className="text-blue-600 dark:text-blue-300" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{r.title}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {r.category && (
                          <span className="text-xs text-gray-500 dark:text-gray-400 font-medium capitalize">{r.category.replace(/_/g, ' ')}</span>
                        )}
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_STYLE[r.status] ?? STATUS_STYLE.pending}`}>
                          {r.status.replace(/_/g, ' ')}
                        </span>
                      </div>
                    </div>
                    <span className="text-xs text-gray-400 flex-shrink-0 flex items-center gap-1">
                      <Clock size={10} /> {timeAgo(r.created_at)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Nearby Water Sources */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm">
            <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
              <h2 className="font-extrabold text-gray-900 dark:text-white text-sm tracking-tight flex items-center gap-2">
                <Droplets size={14} className="text-cyan-600" /> Nearby Water Sources
              </h2>
              <Link to="/water-infrastructure" className="text-xs text-cyan-600 hover:underline font-medium flex items-center gap-1">
                View all <ChevronRight size={12} />
              </Link>
            </div>
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="animate-pulse rounded-xl border p-3 border-gray-100 dark:border-gray-800">
                    <div className="h-3.5 w-3/4 rounded bg-gray-200 dark:bg-gray-700 mb-2" />
                    <div className="h-3 w-1/2 rounded bg-gray-100 dark:bg-gray-800" />
                  </div>
                ))
              ) : waterPts.length === 0 ? (
                <div className="col-span-2 p-6 text-center">
                  <Droplets size={28} className="text-gray-300 dark:text-gray-700 mx-auto mb-2" />
                  <p className="text-sm text-gray-400">No water sources found in your area</p>
                </div>
              ) : (
                waterPts.map(w => {
                  const st = WATER_STATUS[w.status] ?? { dot: 'bg-gray-400', label: w.status };
                  return (
                    <div key={w.id} className="rounded-xl border border-gray-100 dark:border-gray-800 p-3 flex items-start gap-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                      <div className="w-8 h-8 rounded-xl bg-cyan-100 dark:bg-cyan-900/40 flex items-center justify-center flex-shrink-0">
                        <Droplets size={13} className="text-cyan-600 dark:text-cyan-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-gray-900 dark:text-white truncate">{w.name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 capitalize mt-0.5">{w.type?.replace(/_/g, ' ')}</p>
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${st.dot}`} />
                          <span className="text-xs text-gray-600 dark:text-gray-400 font-medium">{st.label}</span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* ── Right column ── */}
        <div className="space-y-5">

          {/* Active Alerts */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm">
            <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
              <h2 className="font-extrabold text-gray-900 dark:text-white text-sm tracking-tight flex items-center gap-2">
                <Radio size={14} className="text-red-500 animate-pulse" /> Active Alerts
              </h2>
              {alerts.length > 0 && (
                <span className="text-xs font-bold text-red-600 bg-red-50 dark:bg-red-950/50 px-2 py-0.5 rounded-full">
                  {activeAlerts} active
                </span>
              )}
            </div>
            <div className="divide-y divide-gray-50 dark:divide-gray-800">
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="p-3 animate-pulse flex gap-2">
                    <div className="w-2 h-2 mt-1.5 rounded-full bg-gray-200 dark:bg-gray-700 flex-shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 w-3/4 rounded bg-gray-200 dark:bg-gray-700" />
                      <div className="h-2.5 w-1/2 rounded bg-gray-100 dark:bg-gray-800" />
                    </div>
                  </div>
                ))
              ) : alerts.length === 0 ? (
                <div className="p-6 text-center">
                  <CheckCircle2 size={28} className="text-green-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-400 font-medium">No active alerts</p>
                  <p className="text-xs text-gray-400 mt-0.5">Your area is safe</p>
                </div>
              ) : (
                alerts.slice(0, 5).map(alert => {
                  const sev = SEVERITY_STYLE[alert.severity] ?? SEVERITY_STYLE.info;
                  return (
                    <div key={alert.id} className={`p-3 ${sev.bg} border-l-2 ${sev.border}`}>
                      <div className="flex items-start gap-2">
                        <span className={`w-2 h-2 rounded-full mt-1 flex-shrink-0 ${sev.dot}`} />
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs font-bold leading-tight ${sev.text}`}>{alert.title}</p>
                          {alert.district && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 flex items-center gap-1">
                              <MapPin size={9} /> {alert.district}
                            </p>
                          )}
                          <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                            <Clock size={9} /> {timeAgo(alert.created_at)}
                          </p>
                        </div>
                        <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${sev.bg} ${sev.text}`}>
                          {sev.label}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Notifications */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm">
            <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
              <h2 className="font-extrabold text-gray-900 dark:text-white text-sm tracking-tight flex items-center gap-2">
                <Megaphone size={14} className="text-violet-500" /> Announcements
              </h2>
            </div>
            <div className="divide-y divide-gray-50 dark:divide-gray-800">
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="p-3 animate-pulse flex gap-2">
                    <div className="w-7 h-7 rounded-lg bg-gray-200 dark:bg-gray-700 flex-shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 w-2/3 rounded bg-gray-200 dark:bg-gray-700" />
                      <div className="h-2.5 w-full rounded bg-gray-100 dark:bg-gray-800" />
                    </div>
                  </div>
                ))
              ) : notifs.length === 0 ? (
                <div className="p-6 text-center">
                  <Bell size={28} className="text-gray-300 dark:text-gray-700 mx-auto mb-2" />
                  <p className="text-sm text-gray-400 font-medium">No new announcements</p>
                </div>
              ) : (
                notifs.map(n => (
                  <div key={n.id} className={`p-3 flex items-start gap-2.5 ${!n.read_at ? 'bg-violet-50/40 dark:bg-violet-950/20' : ''}`}>
                    <div className="w-7 h-7 rounded-lg bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center flex-shrink-0">
                      <Bell size={12} className="text-violet-600 dark:text-violet-300" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-gray-900 dark:text-white leading-tight truncate">{n.title}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-snug line-clamp-2">{n.message}</p>
                      <p className="text-xs text-gray-400 mt-1">{timeAgo(n.created_at)}</p>
                    </div>
                    {!n.read_at && <span className="w-2 h-2 rounded-full bg-violet-500 flex-shrink-0 mt-1" />}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Emergency shortcut */}
          <Link to="/gwn"
            className="flex items-center gap-4 p-4 rounded-2xl border border-teal-200 dark:border-teal-800 bg-gradient-to-br from-teal-50 to-cyan-50 dark:from-teal-950/40 dark:to-cyan-950/30 shadow-sm hover:shadow-md transition-all hover:-translate-y-0.5">
            <div className="w-10 h-10 rounded-xl bg-teal-600 flex items-center justify-center flex-shrink-0 shadow">
              <Activity size={18} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-extrabold text-teal-900 dark:text-teal-100">Environmental Watch</p>
              <p className="text-xs text-teal-700 dark:text-teal-300 mt-0.5">Real-time water quality & pollution alerts</p>
            </div>
            <ChevronRight size={16} className="text-teal-500 flex-shrink-0" />
          </Link>
        </div>
      </div>
    </div>
  );
}
