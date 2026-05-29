import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Building2, Users, Calendar, AlertTriangle, FolderOpen,
  Megaphone, ChevronRight, MapPin, Clock, CheckCircle2,
  Activity, Shield, Globe, MessageSquare,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { getCommitteeStats, getMyCommittees } from '../../api/client';

/* ─────────────────────────────────────────────────────────────
   Types
───────────────────────────────────────────────────────────── */
interface CommitteeStats {
  overview: {
    total_committees: number;
    active_committees: number;
    total_members: number;
    upcoming_meetings: number;
    open_incidents: number;
    active_projects: number;
  };
  recent_meetings: any[];
  recent_incidents: any[];
  announcements: any[];
}

interface MyCommittee {
  id: number;
  name: string;
  district: string;
  sub_county: string;
  village: string;
  my_role: string;
  chairperson_name: string;
  member_count: number;
  upcoming_meetings: number;
  open_incidents: number;
  active_projects: number;
  latest_announcement: string | null;
  status: string;
}

/* ─────────────────────────────────────────────────────────────
   Helpers
───────────────────────────────────────────────────────────── */
function roleLabel(role: string) {
  const map: Record<string, string> = {
    chairperson:          'Chairperson',
    vice_chairperson:     'Vice Chairperson',
    secretary:            'Secretary',
    treasurer:            'Treasurer',
    water_officer:        'Water Officer',
    environmental_officer:'Environmental Officer',
    mobilizer:            'Mobilizer',
    member:               'Member',
  };
  return map[role] || role;
}

function roleColor(role: string) {
  if (role === 'chairperson' || role === 'vice_chairperson')
    return 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300';
  if (role === 'secretary' || role === 'treasurer')
    return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
  if (role === 'water_officer' || role === 'environmental_officer')
    return 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300';
  return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300';
}

function priorityDot(priority: string) {
  if (priority === 'critical') return 'bg-red-500';
  if (priority === 'high')     return 'bg-orange-500';
  if (priority === 'medium')   return 'bg-yellow-500';
  return 'bg-green-500';
}

function formatDate(d: string) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-UG', { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ─────────────────────────────────────────────────────────────
   Stat card
───────────────────────────────────────────────────────────── */
function StatCard({ label, value, icon: Icon, from, to, sub }: {
  label: string; value: number | string; icon: React.ElementType;
  from: string; to: string; sub?: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border p-4 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
      style={{ background: `linear-gradient(135deg, ${from}18 0%, ${to}10 100%)`, borderColor: `${from}35` }}>
      <div className="flex items-start justify-between mb-2">
        <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{label}</p>
        <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: `${from}22` }}>
          <Icon size={15} style={{ color: from }} />
        </div>
      </div>
      <p className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight">{value}</p>
      {sub && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 font-medium">{sub}</p>}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Quick-action button
───────────────────────────────────────────────────────────── */
function QuickAction({ to, icon: Icon, label, sub, color, bg, border }: {
  to: string; icon: React.ElementType; label: string; sub: string;
  color: string; bg: string; border: string;
}) {
  return (
    <Link to={to}
      className={`flex items-center gap-3 p-3.5 rounded-2xl border transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${bg} ${border}`}>
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${bg}`}>
        <Icon size={18} className={color} />
      </div>
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-semibold ${color}`}>{label}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{sub}</p>
      </div>
      <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />
    </Link>
  );
}

/* ─────────────────────────────────────────────────────────────
   Main component
───────────────────────────────────────────────────────────── */
export default function CommitteeDashboard() {
  const { user } = useAuth();
  const [stats, setStats]           = useState<CommitteeStats | null>(null);
  const [myCommittees, setMyCommittees] = useState<MyCommittee[]>([]);
  const [loading, setLoading]       = useState(true);

  useEffect(() => {
    Promise.all([getCommitteeStats(), getMyCommittees()])
      .then(([s, mc]) => {
        setStats(s.data.data);
        setMyCommittees(mc.data.data || []);
      })
      .finally(() => setLoading(false));
  }, []);

  const now = new Date();
  const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="space-y-6 pb-8">

      {/* ── Welcome header ──────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-3xl p-6"
        style={{ background: 'linear-gradient(135deg, #059669 0%, #0891b2 100%)' }}>
        <div className="absolute top-0 right-0 w-64 h-64 rounded-full opacity-10"
          style={{ background: 'white', transform: 'translate(30%, -30%)' }} />
        <div className="relative z-10">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div>
              <p className="text-emerald-100 text-sm font-medium mb-1">{greeting},</p>
              <h1 className="text-2xl font-extrabold text-white tracking-tight">{user?.name}</h1>
              <div className="flex items-center gap-2 mt-2">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-white/15 text-white border border-white/20">
                  <Shield size={11} /> Community Leader
                </span>
                {user?.district && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-white/15 text-white border border-white/20">
                    <MapPin size={11} /> {user.district}
                  </span>
                )}
              </div>
            </div>
            <div className="text-right">
              <p className="text-emerald-100 text-xs font-medium">Committee Portal</p>
              <p className="text-white text-sm font-bold mt-0.5">
                {myCommittees.length} Active Assignment{myCommittees.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>

          {/* Committee ID + quick account links */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {(user as any)?.committee_id && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/15 border border-white/20">
                <span className="text-sm">🪪</span>
                <span className="text-xs text-white font-mono font-bold tracking-wider">
                  {(user as any).committee_id}
                </span>
              </div>
            )}
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 border border-white/15 text-xs text-emerald-100">
              <Shield size={11} className="flex-shrink-0" />
              {user?.district || 'your district'} · Jurisdiction-scoped
            </div>
            <Link
              to="/profile"
              className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/20 hover:bg-white/30 border border-white/20 text-xs text-white font-semibold transition-colors"
            >
              🔑 Change Password
            </Link>
          </div>
        </div>
      </div>

      {/* ── KPI stats ───────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="My Committees"    value={loading ? '…' : myCommittees.length}
          icon={Building2} from="#059669" to="#0891b2" sub="Active assignments" />
        <StatCard label="Upcoming Meetings" value={loading ? '…' : (stats?.overview.upcoming_meetings ?? 0)}
          icon={Calendar} from="#2563eb" to="#1d4ed8" sub="Scheduled sessions" />
        <StatCard label="Open Incidents"   value={loading ? '…' : (stats?.overview.open_incidents ?? 0)}
          icon={AlertTriangle} from="#dc2626" to="#e11d48" sub="Pending resolution" />
        <StatCard label="Active Projects"  value={loading ? '…' : (stats?.overview.active_projects ?? 0)}
          icon={FolderOpen} from="#7c3aed" to="#6d28d9" sub="Community initiatives" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── My Committee Assignments ─────────────────────── */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Building2 size={15} className="text-emerald-600" /> My Committee Assignments
            </h2>
            <Link to="/committee-management"
              className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1">
              Manage <ChevronRight size={12} />
            </Link>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1,2,3].map(i => (
                <div key={i} className="h-24 rounded-2xl animate-pulse bg-gray-100 dark:bg-gray-800" />
              ))}
            </div>
          ) : myCommittees.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center">
              <Building2 size={32} className="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
              <p className="text-sm font-semibold text-gray-500 dark:text-gray-400">No committee assignments yet</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Contact your district officer to be added to a committee</p>
            </div>
          ) : (
            myCommittees.map(c => (
              <Link key={c.id} to="/committee-management"
                className="block rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4
                           hover:border-emerald-300 dark:hover:border-emerald-700 hover:shadow-md transition-all duration-200">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{c.name}</p>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${roleColor(c.my_role)}`}>
                        {roleLabel(c.my_role)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                      <MapPin size={10} />
                      <span>{[c.village, c.sub_county, c.district].filter(Boolean).join(', ')}</span>
                    </div>
                  </div>
                  <ChevronRight size={14} className="text-gray-400 flex-shrink-0 mt-1" />
                </div>
                <div className="flex items-center gap-4 mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
                  <div className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
                    <Users size={11} className="text-emerald-500" />
                    <span>{c.member_count} members</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
                    <Calendar size={11} className="text-blue-500" />
                    <span>{c.upcoming_meetings} meetings</span>
                  </div>
                  {c.open_incidents > 0 && (
                    <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400 font-semibold">
                      <AlertTriangle size={11} />
                      <span>{c.open_incidents} open</span>
                    </div>
                  )}
                  {c.active_projects > 0 && (
                    <div className="flex items-center gap-1.5 text-xs text-purple-600 dark:text-purple-400">
                      <FolderOpen size={11} />
                      <span>{c.active_projects} projects</span>
                    </div>
                  )}
                </div>
                {c.latest_announcement && (
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                    <Megaphone size={10} className="flex-shrink-0 text-amber-500" />
                    <span className="truncate italic">{c.latest_announcement}</span>
                  </div>
                )}
              </Link>
            ))
          )}
        </div>

        {/* ── Right column: Meetings + Incidents ──────────── */}
        <div className="space-y-4">

          {/* Upcoming Meetings */}
          <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
              <h3 className="text-xs font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
                <Calendar size={13} className="text-blue-500" /> Upcoming Meetings
              </h3>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {loading ? (
                <div className="p-4 space-y-3">
                  {[1,2].map(i => <div key={i} className="h-10 rounded-lg animate-pulse bg-gray-100 dark:bg-gray-700" />)}
                </div>
              ) : !stats?.recent_meetings?.length ? (
                <div className="p-6 text-center">
                  <p className="text-xs text-gray-400">No meetings scheduled</p>
                </div>
              ) : (
                stats.recent_meetings.slice(0, 4).map((m: any, i: number) => (
                  <div key={i} className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
                    <p className="text-xs font-semibold text-gray-900 dark:text-white truncate">{m.title}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-gray-500 dark:text-gray-400 flex items-center gap-1">
                        <Clock size={9} /> {formatDate(m.meeting_date)}
                      </span>
                      {m.committee_name && (
                        <span className="text-[10px] text-blue-600 dark:text-blue-400 truncate">{m.committee_name}</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Open Incidents */}
          <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
              <h3 className="text-xs font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
                <AlertTriangle size={13} className="text-red-500" /> Incident Assignments
              </h3>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {loading ? (
                <div className="p-4 space-y-3">
                  {[1,2].map(i => <div key={i} className="h-10 rounded-lg animate-pulse bg-gray-100 dark:bg-gray-700" />)}
                </div>
              ) : !stats?.recent_incidents?.length ? (
                <div className="p-6 text-center">
                  <CheckCircle2 size={20} className="mx-auto text-green-400 mb-2" />
                  <p className="text-xs text-gray-400">All incidents resolved</p>
                </div>
              ) : (
                stats.recent_incidents.slice(0, 4).map((inc: any, i: number) => (
                  <div key={i} className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${priorityDot(inc.priority)}`} />
                      <p className="text-xs font-semibold text-gray-900 dark:text-white truncate flex-1">{inc.title}</p>
                    </div>
                    <div className="flex items-center gap-2 mt-1 ml-4">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium
                        ${inc.status === 'resolved' ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                        : inc.status === 'investigating' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                        : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}>
                        {inc.status}
                      </span>
                      {inc.escalated === 1 && (
                        <span className="text-[10px] text-orange-600 dark:text-orange-400 font-semibold flex items-center gap-0.5">
                          <Activity size={9} /> Escalated
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Announcements ────────────────────────────────────── */}
      {(stats?.announcements?.length ?? 0) > 0 && (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 dark:border-gray-700">
            <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Megaphone size={14} className="text-amber-500" /> Latest Announcements
            </h3>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {stats!.announcements.map((a: any, i: number) => (
              <div key={i} className="px-5 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
                <div className="flex items-start gap-3">
                  <span className={`mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0
                    ${a.priority === 'urgent' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                    : a.priority === 'important' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'}`}>
                    {a.priority?.toUpperCase() || 'NORMAL'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">{a.title}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">{a.content}</p>
                  </div>
                  <span className="text-[10px] text-gray-400 flex-shrink-0 mt-0.5">
                    {formatDate(a.created_at)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Quick Actions ────────────────────────────────────── */}
      <div>
        <h2 className="text-sm font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
          <Activity size={14} className="text-blue-500" /> Quick Actions
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <QuickAction to="/committee-management"
            icon={Building2} label="Committee Mgmt" sub="Manage committees"
            color="text-emerald-700 dark:text-emerald-300"
            bg="bg-emerald-50 dark:bg-emerald-900/30" border="border-emerald-200 dark:border-emerald-800" />
          <QuickAction to="/community"
            icon={MessageSquare} label="Submit Report" sub="Report an incident"
            color="text-blue-700 dark:text-blue-300"
            bg="bg-blue-50 dark:bg-blue-900/30" border="border-blue-200 dark:border-blue-800" />
          <QuickAction to="/gis"
            icon={Globe} label="GIS Map" sub="Spatial overview"
            color="text-cyan-700 dark:text-cyan-300"
            bg="bg-cyan-50 dark:bg-cyan-900/30" border="border-cyan-200 dark:border-cyan-800" />
          <QuickAction to="/track-reports"
            icon={CheckCircle2} label="Track Reports" sub="Report status"
            color="text-purple-700 dark:text-purple-300"
            bg="bg-purple-50 dark:bg-purple-900/30" border="border-purple-200 dark:border-purple-800" />
        </div>
      </div>

    </div>
  );
}
