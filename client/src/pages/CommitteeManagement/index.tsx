import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Users, Plus, X, ChevronDown, Calendar, Folder, AlertTriangle,
  Megaphone, BarChart3, MapPin, CheckCircle, Clock, RefreshCw,
  UserPlus, Pencil, Trash2, FileText, TrendingUp, Building2, Search,
} from 'lucide-react';
import {
  getCommitteeStats, getCommittees, createCommittee, updateCommittee,
  getCommitteeMembers, addCommitteeMember, removeCommitteeMember,
  getCommitteeMeetings, createCommitteeMeeting, updateCommitteeMeeting,
  getCommitteeIncidents, createCommitteeIncident, updateCommitteeIncident,
  getCommitteeProjects, createCommitteeProject, updateCommitteeProject,
  getCommitteeAnnouncements, createCommitteeAnnouncement,
  createCommitteeAccount, getCommitteeAccounts,
} from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { ALL_DISTRICTS } from '../../constants/districts';

/* ── Helpers ─────────────────────────────────────────────── */

const COMMITTEE_ROLES = [
  'Chairperson','Secretary','Water Officer','Environmental Officer',
  'Health Inspector','Emergency Coordinator','Community Mobilizer',
  'District Supervisor','member',
];

const INCIDENT_TYPES = ['water_quality','pollution','borehole_failure','water_shortage','flood','sanitation','other'];
const PROJECT_TYPES  = ['water','sanitation','environmental','flood_response','tree_planting','borehole_repair','other'];

function badge(text: string, color: string) {
  const map: Record<string, string> = {
    green:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    red:    'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    orange: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    blue:   'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    gray:   'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
    purple: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${map[color] || map.gray}`}>
      {text}
    </span>
  );
}

function statusColor(s: string) {
  if (['resolved','completed','active','attended'].includes(s)) return 'green';
  if (['new','planned','scheduled'].includes(s)) return 'blue';
  if (['escalated','critical','on_hold'].includes(s)) return 'red';
  if (['in_progress','assigned','under_review'].includes(s)) return 'orange';
  return 'gray';
}

function priorityColor(p: string) {
  if (p === 'critical') return 'red';
  if (p === 'high') return 'orange';
  if (p === 'medium') return 'blue';
  return 'gray';
}

function KPI({ label, value, sub, color }: { label: string; value: number | string; sub?: string; color: string }) {
  const grad: Record<string, string> = {
    blue:   'from-blue-500 to-blue-600',
    green:  'from-emerald-500 to-emerald-600',
    orange: 'from-orange-500 to-orange-600',
    purple: 'from-purple-500 to-purple-600',
    red:    'from-red-500 to-red-600',
    teal:   'from-teal-500 to-teal-600',
  };
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-slate-700">
      <div className={`inline-flex w-10 h-10 rounded-xl bg-gradient-to-br ${grad[color] || grad.blue} items-center justify-center mb-3`}>
        <BarChart3 size={18} className="text-white" />
      </div>
      <div className="text-2xl font-bold text-gray-900 dark:text-white">{value}</div>
      <div className="text-sm font-medium text-gray-600 dark:text-gray-400 mt-0.5">{label}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-slate-700">
          <h3 className="font-bold text-gray-900 dark:text-white text-base">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

const inputCls = 'w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const labelCls = 'block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1';
const btnPrimary = 'px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors disabled:opacity-50';
const btnSecondary = 'px-4 py-2 rounded-xl bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 text-gray-700 dark:text-gray-300 text-sm font-semibold transition-colors';

function DistrictPicker({ value, onChange, required }: { value: string; onChange: (v: string) => void; required?: boolean }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const filtered = useMemo(
    () => query.trim() ? ALL_DISTRICTS.filter(d => d.toLowerCase().includes(query.toLowerCase())) : ALL_DISTRICTS,
    [query],
  );

  const pick = (d: string) => { onChange(d); setOpen(false); setQuery(''); };

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          type="text"
          autoComplete="off"
          required={required}
          placeholder={value || 'Search district…'}
          value={open ? query : value}
          className={inputCls.replace('px-3', 'pl-8 pr-3')}
          onFocus={() => { setQuery(''); setOpen(true); }}
          onChange={e => setQuery(e.target.value)}
          onBlur={() => setTimeout(() => { setOpen(false); setQuery(''); }, 150)}
        />
      </div>
      {open && (
        <ul className="absolute z-50 left-0 right-0 mt-1 max-h-52 overflow-y-auto bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-xl shadow-xl text-sm">
          {filtered.length === 0
            ? <li className="px-3 py-2.5 text-gray-400">No districts found</li>
            : filtered.map(d => (
              <li key={d}
                onMouseDown={() => pick(d)}
                className={`px-3 py-2 cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20 ${d === value ? 'bg-blue-50 dark:bg-blue-900/30 font-semibold text-blue-700 dark:text-blue-300' : 'text-gray-800 dark:text-gray-100'}`}
              >
                {d}
              </li>
            ))
          }
        </ul>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   MAIN COMPONENT
══════════════════════════════════════════════════════════ */
export default function CommitteeManagement() {
  const { user } = useAuth();
  const isAdmin = ['national_admin', 'district_officer'].includes(user?.role || '');

  const [activeView, setActiveView] = useState<'committees'|'accounts'>('committees');
  const [activeTab, setActiveTab] = useState<'overview'|'committees'|'members'|'meetings'|'incidents'|'projects'|'announcements'>('overview');
  const [stats, setStats]         = useState<any>(null);
  const [committees, setCommittees] = useState<any[]>([]);
  const [selected, setSelected]   = useState<any>(null);    // selected committee for drill-down
  const [loading, setLoading]     = useState(true);

  // sub-lists for selected committee
  const [members, setMembers]         = useState<any[]>([]);
  const [meetings, setMeetings]       = useState<any[]>([]);
  const [incidents, setIncidents]     = useState<any[]>([]);
  const [projects, setProjects]       = useState<any[]>([]);
  const [announcements, setAnnouncements] = useState<any[]>([]);

  // modals
  const [showCreateCommittee, setShowCreateCommittee] = useState(false);
  const [showEditCommittee, setShowEditCommittee]     = useState<any>(null);
  const [showAddMember, setShowAddMember]             = useState(false);
  const [showCreateMeeting, setShowCreateMeeting]     = useState(false);
  const [showEditMeeting, setShowEditMeeting]         = useState<any>(null);
  const [showCreateIncident, setShowCreateIncident]   = useState(false);
  const [showEditIncident, setShowEditIncident]       = useState<any>(null);
  const [showCreateProject, setShowCreateProject]     = useState(false);
  const [showEditProject, setShowEditProject]         = useState<any>(null);
  const [showAnnouncement, setShowAnnouncement]       = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  // Accounts management
  const [accounts, setAccounts]           = useState<any[]>([]);
  const [acctLoading, setAcctLoading]     = useState(false);
  const [showCreateAccount, setShowCreateAccount] = useState(false);
  const [acctSuccess, setAcctSuccess]     = useState('');
  const [acctForm, setAcctForm] = useState({
    name: '', email: '', password: '', phone: '',
    district: user?.district || '', sub_county: '', location: '',
    committee_role: 'member', jurisdiction: '', organization: '', office_contact: '',
  });

  const loadStats = useCallback(async () => {
    try {
      const r = await getCommitteeStats();
      setStats(r.data.data);
    } catch {}
  }, []);

  const loadCommittees = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getCommittees();
      setCommittees(r.data.data || []);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => {
    loadStats();
    loadCommittees();
  }, [loadStats, loadCommittees]);

  const selectCommittee = async (c: any) => {
    setSelected(c);
    setActiveTab('meetings');
    const [mr, ir, pr, ar] = await Promise.all([
      getCommitteeMeetings(c.id),
      getCommitteeIncidents(c.id),
      getCommitteeProjects(c.id),
      getCommitteeAnnouncements(c.id),
    ]);
    setMeetings(mr.data.data || []);
    setIncidents(ir.data.data || []);
    setProjects(pr.data.data || []);
    setAnnouncements(ar.data.data || []);
    const memR = await getCommitteeMembers(c.id);
    setMembers(memR.data.data || []);
  };

  /* ── Create / Edit Committee ─────────────────────── */
  const [cForm, setCForm] = useState({ name:'', district:'Kampala', sub_county:'', village:'', jurisdiction:'', description:'', established_date:'', meeting_frequency:'monthly' });

  const handleCreateCommittee = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setError('');
    try {
      await createCommittee(cForm);
      setShowCreateCommittee(false);
      setCForm({ name:'', district:'Kampala', sub_county:'', village:'', jurisdiction:'', description:'', established_date:'', meeting_frequency:'monthly' });
      loadCommittees(); loadStats();
    } catch (err: any) { setError(err?.response?.data?.error || 'Failed to create committee'); }
    finally { setSaving(false); }
  };

  const handleUpdateCommittee = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setError('');
    try {
      await updateCommittee(showEditCommittee.id, showEditCommittee);
      setShowEditCommittee(null);
      loadCommittees();
    } catch (err: any) { setError(err?.response?.data?.error || 'Failed to update'); }
    finally { setSaving(false); }
  };

  /* ── Add Member ──────────────────────────────────── */
  const [mForm, setMForm] = useState({ user_id:'', committee_role:'member', languages:'', phone:'' });
  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setError('');
    try {
      await addCommitteeMember(selected!.id, mForm);
      setShowAddMember(false);
      setMForm({ user_id:'', committee_role:'member', languages:'', phone:'' });
      const r = await getCommitteeMembers(selected!.id);
      setMembers(r.data.data || []);
    } catch (err: any) { setError(err?.response?.data?.error || 'Failed to add member'); }
    finally { setSaving(false); }
  };

  const handleRemoveMember = async (userId: number) => {
    if (!confirm('Remove this member from the committee?')) return;
    await removeCommitteeMember(selected!.id, userId);
    setMembers(prev => prev.filter(m => m.user_id !== userId));
  };

  /* ── Meetings ─────────────────────────────────────── */
  const [mtgForm, setMtgForm] = useState({ title:'', agenda:'', meeting_date:'', meeting_time:'', location:'' });
  const handleCreateMeeting = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setError('');
    try {
      await createCommitteeMeeting(selected!.id, mtgForm);
      setShowCreateMeeting(false);
      setMtgForm({ title:'', agenda:'', meeting_date:'', meeting_time:'', location:'' });
      const r = await getCommitteeMeetings(selected!.id);
      setMeetings(r.data.data || []);
      loadStats();
    } catch (err: any) { setError(err?.response?.data?.error || 'Failed to schedule meeting'); }
    finally { setSaving(false); }
  };

  const handleUpdateMeeting = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setError('');
    try {
      await updateCommitteeMeeting(showEditMeeting.id, showEditMeeting);
      setShowEditMeeting(null);
      const r = await getCommitteeMeetings(selected!.id);
      setMeetings(r.data.data || []);
    } catch (err: any) { setError(err?.response?.data?.error || 'Failed to update meeting'); }
    finally { setSaving(false); }
  };

  /* ── Incidents ────────────────────────────────────── */
  const [incForm, setIncForm] = useState({ title:'', incident_type:'water_quality', district:'', description:'', priority:'medium' });
  const handleCreateIncident = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setError('');
    try {
      await createCommitteeIncident(selected!.id, incForm);
      setShowCreateIncident(false);
      setIncForm({ title:'', incident_type:'water_quality', district:'', description:'', priority:'medium' });
      const r = await getCommitteeIncidents(selected!.id);
      setIncidents(r.data.data || []);
      loadStats();
    } catch (err: any) { setError(err?.response?.data?.error || 'Failed to create incident'); }
    finally { setSaving(false); }
  };

  const handleUpdateIncident = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setError('');
    try {
      await updateCommitteeIncident(showEditIncident.id, showEditIncident);
      setShowEditIncident(null);
      const r = await getCommitteeIncidents(selected!.id);
      setIncidents(r.data.data || []);
    } catch (err: any) { setError(err?.response?.data?.error || 'Failed to update incident'); }
    finally { setSaving(false); }
  };

  /* ── Projects ─────────────────────────────────────── */
  const [prjForm, setPrjForm] = useState({ title:'', project_type:'water', description:'', district:'', location:'', priority:'medium', budget:'', start_date:'', end_date:'' });
  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setError('');
    try {
      await createCommitteeProject(selected!.id, prjForm);
      setShowCreateProject(false);
      setPrjForm({ title:'', project_type:'water', description:'', district:'', location:'', priority:'medium', budget:'', start_date:'', end_date:'' });
      const r = await getCommitteeProjects(selected!.id);
      setProjects(r.data.data || []);
      loadStats();
    } catch (err: any) { setError(err?.response?.data?.error || 'Failed to create project'); }
    finally { setSaving(false); }
  };

  const handleUpdateProject = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setError('');
    try {
      await updateCommitteeProject(showEditProject.id, showEditProject);
      setShowEditProject(null);
      const r = await getCommitteeProjects(selected!.id);
      setProjects(r.data.data || []);
    } catch (err: any) { setError(err?.response?.data?.error || 'Failed to update project'); }
    finally { setSaving(false); }
  };

  /* ── Announcement ─────────────────────────────────── */
  const [annForm, setAnnForm] = useState({ title:'', content:'', priority:'normal' });
  const handleCreateAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setError('');
    try {
      await createCommitteeAnnouncement(selected!.id, annForm);
      setShowAnnouncement(false);
      setAnnForm({ title:'', content:'', priority:'normal' });
      const r = await getCommitteeAnnouncements(selected!.id);
      setAnnouncements(r.data.data || []);
    } catch (err: any) { setError(err?.response?.data?.error || 'Failed to post announcement'); }
    finally { setSaving(false); }
  };

  /* ── Committee Accounts ─────────────────────────── */
  const loadAccounts = useCallback(async () => {
    setAcctLoading(true);
    try {
      const r = await getCommitteeAccounts();
      setAccounts(r.data.accounts || []);
    } catch {} finally { setAcctLoading(false); }
  }, []);

  const handleViewAccounts = () => {
    setActiveView('accounts');
    if (accounts.length === 0) loadAccounts();
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setError(''); setAcctSuccess('');
    try {
      const res = await createCommitteeAccount(acctForm);
      setAcctSuccess(`Account created. Committee ID: ${res.data.committee_id}`);
      setAcctForm({ name:'', email:'', password:'', phone:'', district: user?.district || '', sub_county:'', location:'', committee_role:'member', jurisdiction:'', organization:'', office_contact:'' });
      setShowCreateAccount(false);
      loadAccounts();
    } catch (err: any) { setError(err?.response?.data?.error || 'Failed to create account'); }
    finally { setSaving(false); }
  };

  const ov = stats?.overview;

  /* ── Render ───────────────────────────────────────── */
  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">Community Committees</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Water governance, field operations and community coordination
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { loadStats(); loadCommittees(); }}
            className="p-2 rounded-xl bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors">
            <RefreshCw size={16} />
          </button>
          {isAdmin && (
            <button onClick={() => setShowCreateCommittee(true)} className={btnPrimary}>
              <span className="flex items-center gap-2"><Plus size={15}/> New Committee</span>
            </button>
          )}
        </div>
      </div>

      {/* View toggle — only for admins and district officers */}
      {isAdmin && (
        <div className="flex rounded-2xl bg-gray-100 dark:bg-slate-800 p-1 w-fit">
          <button onClick={() => setActiveView('committees')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${activeView === 'committees' ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
            <Building2 size={14}/> Committees
          </button>
          <button onClick={handleViewAccounts}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${activeView === 'accounts' ? 'bg-white dark:bg-slate-700 text-emerald-700 dark:text-emerald-400 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
            <UserPlus size={14}/> Committee Accounts
          </button>
        </div>
      )}

      {/* ── Accounts View ─────────────────────────────── */}
      {activeView === 'accounts' && isAdmin && (
        <div className="space-y-5">

          {/* Success banner */}
          {acctSuccess && (
            <div className="px-4 py-3 bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-700 rounded-2xl flex items-start gap-3">
              <CheckCircle size={16} className="text-emerald-600 flex-shrink-0 mt-0.5"/>
              <div>
                <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">Account Created Successfully</p>
                <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-0.5 font-mono">{acctSuccess}</p>
                <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">Share this Committee ID and the password with the member. They can log in at the Committee ID tab on the login page.</p>
              </div>
            </div>
          )}

          {/* Accounts header */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm">
            <div className="px-5 py-4 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between">
              <div>
                <h2 className="font-bold text-gray-900 dark:text-white">Committee Member Accounts</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  District-controlled accounts with auto-generated Committee IDs (HSC-CC-…)
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={loadAccounts} className="p-2 rounded-xl bg-gray-100 dark:bg-slate-700 text-gray-500 hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors">
                  <RefreshCw size={14}/>
                </button>
                <button onClick={() => { setError(''); setAcctSuccess(''); setShowCreateAccount(true); }}
                  className={btnPrimary + ' flex items-center gap-2'}>
                  <Plus size={14}/> Create Account
                </button>
              </div>
            </div>

            {/* Accounts list */}
            {acctLoading ? (
              <div className="py-16 text-center text-gray-400">Loading accounts…</div>
            ) : accounts.length === 0 ? (
              <div className="py-16 text-center space-y-3">
                <UserPlus size={32} className="text-gray-300 dark:text-gray-600 mx-auto"/>
                <p className="text-sm text-gray-400">No committee accounts yet</p>
                <button onClick={() => setShowCreateAccount(true)} className="text-emerald-600 text-xs font-semibold hover:underline">
                  Create the first account
                </button>
              </div>
            ) : (
              <div className="divide-y divide-gray-50 dark:divide-slate-700/50">
                {accounts.map((acct: any) => (
                  <div key={acct.id} className="px-5 py-4 flex items-start gap-4">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                      {acct.name?.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-gray-900 dark:text-white">{acct.name}</span>
                        {badge(acct.committee_role || 'member', 'blue')}
                        {badge(acct.active ? 'Active' : 'Inactive', acct.active ? 'green' : 'red')}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{acct.email}</div>
                      <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 text-xs font-mono font-semibold border border-emerald-200 dark:border-emerald-700">
                          🪪 {acct.committee_id || '—'}
                        </span>
                        <span className="text-xs text-gray-400 flex items-center gap-1">
                          <MapPin size={10}/>{acct.district}
                        </span>
                        {acct.organization && (
                          <span className="text-xs text-gray-400">{acct.organization}</span>
                        )}
                        {acct.assigned_by_name && (
                          <span className="text-xs text-gray-400">Assigned by: {acct.assigned_by_name}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Create Account Modal */}
          {showCreateAccount && (
            <Modal title="Create Committee Member Account" onClose={() => setShowCreateAccount(false)}>
              {error && (
                <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">{error}</div>
              )}
              <form onSubmit={handleCreateAccount} className="space-y-4">
                <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 text-xs text-emerald-700 dark:text-emerald-300">
                  A unique Committee ID (HSC-CC-…) will be auto-generated and can be used for login.
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className={labelCls}>Full Name *</label>
                    <input className={inputCls} required value={acctForm.name} onChange={e => setAcctForm(p => ({...p, name: e.target.value}))} placeholder="Full name"/>
                  </div>
                  <div className="col-span-2">
                    <label className={labelCls}>Email Address *</label>
                    <input className={inputCls} type="email" required value={acctForm.email} onChange={e => setAcctForm(p => ({...p, email: e.target.value}))} placeholder="member@example.com"/>
                  </div>
                  <div>
                    <label className={labelCls}>Phone</label>
                    <input className={inputCls} type="tel" value={acctForm.phone} onChange={e => setAcctForm(p => ({...p, phone: e.target.value}))} placeholder="+256 700 000 000"/>
                  </div>
                  <div>
                    <label className={labelCls}>Temporary Password *</label>
                    <input className={inputCls} type="text" required minLength={6} value={acctForm.password} onChange={e => setAcctForm(p => ({...p, password: e.target.value}))} placeholder="Min 6 chars"/>
                  </div>
                  <div>
                    <label className={labelCls}>District *</label>
                    <DistrictPicker required value={acctForm.district} onChange={v => setAcctForm(p => ({...p, district: v}))} />
                  </div>
                  <div>
                    <label className={labelCls}>Committee Role</label>
                    <select className={inputCls} value={acctForm.committee_role} onChange={e => setAcctForm(p => ({...p, committee_role: e.target.value}))}>
                      {COMMITTEE_ROLES.map(r => <option key={r} value={r.toLowerCase().replace(/ /g,'_')}>{r}</option>)}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className={labelCls}>Jurisdiction Area</label>
                    <input className={inputCls} value={acctForm.jurisdiction} onChange={e => setAcctForm(p => ({...p, jurisdiction: e.target.value}))} placeholder="e.g. Makindye Sub-County"/>
                  </div>
                  <div className="col-span-2">
                    <label className={labelCls}>Committee / Organisation Name</label>
                    <input className={inputCls} value={acctForm.organization} onChange={e => setAcctForm(p => ({...p, organization: e.target.value}))} placeholder="e.g. Kampala Water Users Committee"/>
                  </div>
                  <div className="col-span-2">
                    <label className={labelCls}>Office Contact</label>
                    <input className={inputCls} value={acctForm.office_contact} onChange={e => setAcctForm(p => ({...p, office_contact: e.target.value}))} placeholder="Office phone or email"/>
                  </div>
                </div>

                <div className="flex gap-2 justify-end pt-2">
                  <button type="button" onClick={() => setShowCreateAccount(false)} className={btnSecondary}>Cancel</button>
                  <button type="submit" disabled={saving} className={btnPrimary + ' flex items-center gap-2'}>
                    {saving ? 'Creating…' : <><Plus size={14}/> Create Account</>}
                  </button>
                </div>
              </form>
            </Modal>
          )}
        </div>
      )}

      {/* ── Committees View (original content) — shown when activeView === 'committees' ── */}
      {activeView === 'committees' && (<>

      {/* KPIs */}
      {ov && (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <KPI label="Total Committees"  value={ov.total_committees}  color="blue"   />
          <KPI label="Active Committees" value={ov.active_committees} color="green"  />
          <KPI label="Total Members"     value={ov.total_members}     color="purple" />
          <KPI label="Upcoming Meetings" value={ov.upcoming_meetings} color="teal"   />
          <KPI label="Open Incidents"    value={ov.open_incidents}    color="orange" />
          <KPI label="Active Projects"   value={ov.active_projects}   color="red"    />
        </div>
      )}

      {/* Announcements strip */}
      {stats?.announcements?.length > 0 && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-2xl p-4 space-y-2">
          <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300 font-semibold text-sm mb-1">
            <Megaphone size={15}/> Latest Announcements
          </div>
          {stats.announcements.slice(0, 3).map((a: any) => (
            <div key={a.id} className="text-sm text-blue-800 dark:text-blue-200">
              <span className="font-semibold">{a.title}</span> — {a.content.slice(0, 120)}{a.content.length > 120 ? '…' : ''}
            </div>
          ))}
        </div>
      )}

      {/* Main layout: list + detail */}
      <div className="flex gap-5 min-h-[500px]">

        {/* Committee list */}
        <div className={`flex-shrink-0 ${selected ? 'w-64 hidden xl:flex xl:flex-col' : 'w-full'} bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm overflow-hidden`}>
          <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between">
            <span className="font-semibold text-sm text-gray-900 dark:text-white">All Committees</span>
            <span className="text-xs text-gray-400">{committees.length}</span>
          </div>
          {loading ? (
            <div className="flex-1 flex items-center justify-center py-12 text-gray-400">Loading…</div>
          ) : committees.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-12 text-gray-400 gap-2">
              <Building2 size={32} className="opacity-30"/>
              <span className="text-sm">No committees yet</span>
              {isAdmin && <button onClick={() => setShowCreateCommittee(true)} className="text-blue-600 text-xs font-semibold mt-1">+ Create first committee</button>}
            </div>
          ) : (
            <div className="overflow-y-auto flex-1">
              {committees.map(c => (
                <button key={c.id}
                  onClick={() => selectCommittee(c)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-50 dark:border-slate-700/50 hover:bg-blue-50 dark:hover:bg-slate-700 transition-colors ${selected?.id === c.id ? 'bg-blue-50 dark:bg-slate-700' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-sm text-gray-900 dark:text-white truncate">{c.name}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1 mt-0.5">
                        <MapPin size={10}/>{c.district}
                      </div>
                    </div>
                    {badge(c.status, c.status === 'active' ? 'green' : 'gray')}
                  </div>
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400">
                    <span><Users size={10} className="inline mr-0.5"/>{c.member_count || 0} members</span>
                    <span><AlertTriangle size={10} className="inline mr-0.5"/>{c.open_incidents || 0} open</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Detail pane */}
        {selected ? (
          <div className="flex-1 min-w-0 bg-white dark:bg-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 shadow-sm flex flex-col overflow-hidden">

            {/* Detail header */}
            <div className="px-5 py-4 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between flex-wrap gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 xl:hidden">
                    <X size={16}/>
                  </button>
                  <h2 className="font-bold text-gray-900 dark:text-white">{selected.name}</h2>
                  {badge(selected.status, selected.status === 'active' ? 'green' : 'gray')}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 flex items-center gap-3">
                  <span><MapPin size={10} className="inline mr-0.5"/>{selected.district}</span>
                  {selected.chairperson_name && <span><Users size={10} className="inline mr-0.5"/>Chair: {selected.chairperson_name}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {isAdmin && (
                  <button onClick={() => setShowEditCommittee({ ...selected })}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 text-xs font-semibold hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors">
                    <Pencil size={12}/> Edit
                  </button>
                )}
              </div>
            </div>

            {/* Sub-tabs */}
            <div className="flex items-center gap-1 px-5 pt-3 overflow-x-auto border-b border-gray-100 dark:border-slate-700 flex-shrink-0">
              {(['meetings','members','incidents','projects','announcements'] as const).map(tab => (
                <button key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-3 py-2 text-xs font-semibold rounded-t-xl whitespace-nowrap transition-colors ${activeTab === tab ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto p-5">

              {/* ── Members ───────────────────────── */}
              {activeTab === 'members' && (
                <div className="space-y-4">
                  {isAdmin && (
                    <button onClick={() => setShowAddMember(true)} className={btnPrimary}>
                      <span className="flex items-center gap-2"><UserPlus size={14}/> Add Member</span>
                    </button>
                  )}
                  {members.length === 0 ? (
                    <div className="text-center py-10 text-gray-400 text-sm">No members yet</div>
                  ) : (
                    <div className="space-y-2">
                      {members.map((m: any) => (
                        <div key={m.id} className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-slate-700/50 border border-gray-100 dark:border-slate-700">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white text-sm font-bold">
                              {m.name?.split(' ').map((n: string) => n[0]).slice(0,2).join('')}
                            </div>
                            <div>
                              <div className="font-semibold text-sm text-gray-900 dark:text-white">{m.name}</div>
                              <div className="text-xs text-gray-500 dark:text-gray-400">{m.email} · {m.phone || m.district}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {badge(m.committee_role, 'blue')}
                            {isAdmin && (
                              <button onClick={() => handleRemoveMember(m.user_id)}
                                className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors">
                                <Trash2 size={13}/>
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── Meetings ──────────────────────── */}
              {activeTab === 'meetings' && (
                <div className="space-y-4">
                  <button onClick={() => setShowCreateMeeting(true)} className={btnPrimary}>
                    <span className="flex items-center gap-2"><Plus size={14}/> Schedule Meeting</span>
                  </button>
                  {meetings.length === 0 ? (
                    <div className="text-center py-10 text-gray-400 text-sm">No meetings scheduled</div>
                  ) : (
                    <div className="space-y-3">
                      {meetings.map((m: any) => (
                        <div key={m.id} className="p-4 rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-700/40 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="font-semibold text-sm text-gray-900 dark:text-white">{m.title}</div>
                              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                                <span><Calendar size={10} className="inline mr-0.5"/>{m.meeting_date} {m.meeting_time || ''}</span>
                                {m.location && <span><MapPin size={10} className="inline mr-0.5"/>{m.location}</span>}
                                {m.attendee_count > 0 && <span><Users size={10} className="inline mr-0.5"/>{m.attendee_count} attended</span>}
                              </div>
                              {m.agenda && <div className="text-xs text-gray-400 mt-1 line-clamp-2">{m.agenda}</div>}
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {badge(m.status, statusColor(m.status))}
                              <button onClick={() => setShowEditMeeting({ ...m })}
                                className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors">
                                <Pencil size={13}/>
                              </button>
                            </div>
                          </div>
                          {m.resolutions && (
                            <div className="mt-2 p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg text-xs text-emerald-700 dark:text-emerald-300">
                              <span className="font-semibold">Resolutions: </span>{m.resolutions}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── Incidents ─────────────────────── */}
              {activeTab === 'incidents' && (
                <div className="space-y-4">
                  <button onClick={() => setShowCreateIncident(true)} className={btnPrimary}>
                    <span className="flex items-center gap-2"><Plus size={14}/> Assign Incident</span>
                  </button>
                  {incidents.length === 0 ? (
                    <div className="text-center py-10 text-gray-400 text-sm">No incident assignments</div>
                  ) : (
                    <div className="space-y-3">
                      {incidents.map((inc: any) => (
                        <div key={inc.id} className="p-4 rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-700/40">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold text-sm text-gray-900 dark:text-white">{inc.title}</span>
                                {inc.escalated ? <span className="text-red-500 text-[10px] font-bold">⚠ ESCALATED</span> : null}
                              </div>
                              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                                <span>{inc.incident_type?.replace('_',' ')}</span>
                                {inc.district && <span><MapPin size={10} className="inline mr-0.5"/>{inc.district}</span>}
                                {inc.assigned_to_name && <span><Users size={10} className="inline mr-0.5"/>{inc.assigned_to_name}</span>}
                              </div>
                              {inc.description && <div className="text-xs text-gray-400 mt-1 line-clamp-2">{inc.description}</div>}
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {badge(inc.priority, priorityColor(inc.priority))}
                              {badge(inc.status, statusColor(inc.status))}
                              <button onClick={() => setShowEditIncident({ ...inc })}
                                className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors">
                                <Pencil size={13}/>
                              </button>
                            </div>
                          </div>
                          {inc.notes && <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 italic">{inc.notes}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── Projects ──────────────────────── */}
              {activeTab === 'projects' && (
                <div className="space-y-4">
                  <button onClick={() => setShowCreateProject(true)} className={btnPrimary}>
                    <span className="flex items-center gap-2"><Plus size={14}/> New Project</span>
                  </button>
                  {projects.length === 0 ? (
                    <div className="text-center py-10 text-gray-400 text-sm">No projects yet</div>
                  ) : (
                    <div className="space-y-3">
                      {projects.map((p: any) => (
                        <div key={p.id} className="p-4 rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-700/40">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="font-semibold text-sm text-gray-900 dark:text-white">{p.title}</div>
                              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                                <span>{p.project_type?.replace('_',' ')}</span>
                                {p.district && <span><MapPin size={10} className="inline mr-0.5"/>{p.district}</span>}
                                {p.lead_officer_name && <span>Lead: {p.lead_officer_name}</span>}
                              </div>
                              {/* Progress bar */}
                              <div className="mt-2 flex items-center gap-2">
                                <div className="flex-1 bg-gray-200 dark:bg-slate-600 rounded-full h-1.5">
                                  <div className="bg-blue-500 h-1.5 rounded-full transition-all"
                                    style={{ width: `${p.progress_pct || 0}%` }} />
                                </div>
                                <span className="text-xs text-gray-500 flex-shrink-0">{p.progress_pct || 0}%</span>
                              </div>
                              {p.budget > 0 && (
                                <div className="text-xs text-gray-400 mt-1">
                                  Budget: UGX {Number(p.budget).toLocaleString()} · Spent: UGX {Number(p.spent||0).toLocaleString()}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {badge(p.priority, priorityColor(p.priority))}
                              {badge(p.status, statusColor(p.status))}
                              <button onClick={() => setShowEditProject({ ...p })}
                                className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors">
                                <Pencil size={13}/>
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── Announcements ─────────────────── */}
              {activeTab === 'announcements' && (
                <div className="space-y-4">
                  <button onClick={() => setShowAnnouncement(true)} className={btnPrimary}>
                    <span className="flex items-center gap-2"><Megaphone size={14}/> Post Announcement</span>
                  </button>
                  {announcements.length === 0 ? (
                    <div className="text-center py-10 text-gray-400 text-sm">No announcements</div>
                  ) : (
                    <div className="space-y-3">
                      {announcements.map((a: any) => (
                        <div key={a.id} className={`p-4 rounded-xl border ${a.priority === 'urgent' ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20' : 'border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-700/40'}`}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="font-semibold text-sm text-gray-900 dark:text-white">{a.title}</div>
                            {badge(a.priority, a.priority === 'urgent' ? 'red' : a.priority === 'important' ? 'orange' : 'blue')}
                          </div>
                          <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">{a.content}</div>
                          <div className="text-xs text-gray-400 mt-2">By {a.author_name} · {new Date(a.created_at).toLocaleDateString()}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

            </div>
          </div>
        ) : (
          /* Empty state when nothing selected */
          !loading && committees.length > 0 && (
            <div className="flex-1 hidden xl:flex items-center justify-center text-gray-400">
              <div className="text-center">
                <Building2 size={48} className="mx-auto mb-3 opacity-20"/>
                <div className="text-sm">Select a committee to manage it</div>
              </div>
            </div>
          )
        )}
      </div>

      {/* ═══ MODALS ═══════════════════════════════════════════ */}

      {error && (
        <div className="fixed bottom-6 right-6 z-50 bg-red-600 text-white px-4 py-3 rounded-xl shadow-lg text-sm flex items-center gap-2">
          <AlertTriangle size={15}/>{error}
          <button onClick={() => setError('')}><X size={14}/></button>
        </div>
      )}

      {/* Create Committee */}
      {showCreateCommittee && (
        <Modal title="Create New Committee" onClose={() => setShowCreateCommittee(false)}>
          <form onSubmit={handleCreateCommittee} className="space-y-4">
            <div>
              <label className={labelCls}>Committee Name *</label>
              <input className={inputCls} required value={cForm.name} onChange={e => setCForm(p => ({...p, name: e.target.value}))} placeholder="e.g. Kampala North Water Committee"/>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>District *</label>
                <DistrictPicker value={cForm.district} onChange={v => setCForm(p => ({...p, district: v}))} />
              </div>
              <div>
                <label className={labelCls}>Sub-County</label>
                <input className={inputCls} value={cForm.sub_county} onChange={e => setCForm(p => ({...p, sub_county: e.target.value}))} placeholder="Sub-county"/>
              </div>
            </div>
            <div>
              <label className={labelCls}>Jurisdiction / Coverage Area</label>
              <input className={inputCls} value={cForm.jurisdiction} onChange={e => setCForm(p => ({...p, jurisdiction: e.target.value}))} placeholder="e.g. Covers 5 parishes in Nakawa Division"/>
            </div>
            <div>
              <label className={labelCls}>Description</label>
              <textarea className={inputCls} rows={2} value={cForm.description} onChange={e => setCForm(p => ({...p, description: e.target.value}))} placeholder="Brief description of the committee's mandate"/>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Established Date</label>
                <input type="date" className={inputCls} value={cForm.established_date} onChange={e => setCForm(p => ({...p, established_date: e.target.value}))}/>
              </div>
              <div>
                <label className={labelCls}>Meeting Frequency</label>
                <select className={inputCls} value={cForm.meeting_frequency} onChange={e => setCForm(p => ({...p, meeting_frequency: e.target.value}))}>
                  {['weekly','bi-weekly','monthly','quarterly'].map(f => <option key={f}>{f}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setShowCreateCommittee(false)} className={btnSecondary}>Cancel</button>
              <button type="submit" disabled={saving} className={btnPrimary}>{saving ? 'Creating…' : 'Create Committee'}</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Edit Committee */}
      {showEditCommittee && (
        <Modal title="Edit Committee" onClose={() => setShowEditCommittee(null)}>
          <form onSubmit={handleUpdateCommittee} className="space-y-4">
            <div>
              <label className={labelCls}>Committee Name</label>
              <input className={inputCls} value={showEditCommittee.name} onChange={e => setShowEditCommittee((p: any) => ({...p, name: e.target.value}))}/>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>District</label>
                <DistrictPicker value={showEditCommittee.district} onChange={v => setShowEditCommittee((p: any) => ({...p, district: v}))} />
              </div>
              <div>
                <label className={labelCls}>Status</label>
                <select className={inputCls} value={showEditCommittee.status} onChange={e => setShowEditCommittee((p: any) => ({...p, status: e.target.value}))}>
                  {['active','inactive','archived'].map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className={labelCls}>Description</label>
              <textarea className={inputCls} rows={2} value={showEditCommittee.description || ''} onChange={e => setShowEditCommittee((p: any) => ({...p, description: e.target.value}))}/>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setShowEditCommittee(null)} className={btnSecondary}>Cancel</button>
              <button type="submit" disabled={saving} className={btnPrimary}>{saving ? 'Saving…' : 'Save Changes'}</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Add Member */}
      {showAddMember && (
        <Modal title={`Add Member — ${selected?.name}`} onClose={() => setShowAddMember(false)}>
          <form onSubmit={handleAddMember} className="space-y-4">
            <div>
              <label className={labelCls}>User ID *</label>
              <input className={inputCls} required type="number" value={mForm.user_id} onChange={e => setMForm(p => ({...p, user_id: e.target.value}))} placeholder="Enter the HydroSense user ID"/>
              <p className="text-xs text-gray-400 mt-1">Find user IDs in User Management</p>
            </div>
            <div>
              <label className={labelCls}>Committee Role</label>
              <select className={inputCls} value={mForm.committee_role} onChange={e => setMForm(p => ({...p, committee_role: e.target.value}))}>
                {COMMITTEE_ROLES.map(r => <option key={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Languages Spoken</label>
              <input className={inputCls} value={mForm.languages} onChange={e => setMForm(p => ({...p, languages: e.target.value}))} placeholder="e.g. English, Luganda, Runyankore"/>
            </div>
            <div>
              <label className={labelCls}>Phone (if different from profile)</label>
              <input className={inputCls} value={mForm.phone} onChange={e => setMForm(p => ({...p, phone: e.target.value}))} placeholder="+256..."/>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setShowAddMember(false)} className={btnSecondary}>Cancel</button>
              <button type="submit" disabled={saving} className={btnPrimary}>{saving ? 'Adding…' : 'Add Member'}</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Create Meeting */}
      {showCreateMeeting && (
        <Modal title="Schedule Meeting" onClose={() => setShowCreateMeeting(false)}>
          <form onSubmit={handleCreateMeeting} className="space-y-4">
            <div>
              <label className={labelCls}>Meeting Title *</label>
              <input className={inputCls} required value={mtgForm.title} onChange={e => setMtgForm(p => ({...p, title: e.target.value}))} placeholder="e.g. Monthly Water Quality Review"/>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Date *</label>
                <input type="date" className={inputCls} required value={mtgForm.meeting_date} onChange={e => setMtgForm(p => ({...p, meeting_date: e.target.value}))}/>
              </div>
              <div>
                <label className={labelCls}>Time</label>
                <input type="time" className={inputCls} value={mtgForm.meeting_time} onChange={e => setMtgForm(p => ({...p, meeting_time: e.target.value}))}/>
              </div>
            </div>
            <div>
              <label className={labelCls}>Location</label>
              <input className={inputCls} value={mtgForm.location} onChange={e => setMtgForm(p => ({...p, location: e.target.value}))} placeholder="e.g. District Hall, Kampala"/>
            </div>
            <div>
              <label className={labelCls}>Agenda</label>
              <textarea className={inputCls} rows={3} value={mtgForm.agenda} onChange={e => setMtgForm(p => ({...p, agenda: e.target.value}))} placeholder="Meeting agenda items…"/>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setShowCreateMeeting(false)} className={btnSecondary}>Cancel</button>
              <button type="submit" disabled={saving} className={btnPrimary}>{saving ? 'Scheduling…' : 'Schedule Meeting'}</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Edit Meeting */}
      {showEditMeeting && (
        <Modal title="Update Meeting" onClose={() => setShowEditMeeting(null)}>
          <form onSubmit={handleUpdateMeeting} className="space-y-4">
            <div>
              <label className={labelCls}>Title</label>
              <input className={inputCls} value={showEditMeeting.title} onChange={e => setShowEditMeeting((p: any) => ({...p, title: e.target.value}))}/>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Status</label>
                <select className={inputCls} value={showEditMeeting.status} onChange={e => setShowEditMeeting((p: any) => ({...p, status: e.target.value}))}>
                  {['scheduled','completed','cancelled','postponed'].map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Date</label>
                <input type="date" className={inputCls} value={showEditMeeting.meeting_date} onChange={e => setShowEditMeeting((p: any) => ({...p, meeting_date: e.target.value}))}/>
              </div>
            </div>
            <div>
              <label className={labelCls}>Minutes</label>
              <textarea className={inputCls} rows={3} value={showEditMeeting.minutes || ''} onChange={e => setShowEditMeeting((p: any) => ({...p, minutes: e.target.value}))} placeholder="Record meeting minutes…"/>
            </div>
            <div>
              <label className={labelCls}>Resolutions</label>
              <textarea className={inputCls} rows={2} value={showEditMeeting.resolutions || ''} onChange={e => setShowEditMeeting((p: any) => ({...p, resolutions: e.target.value}))} placeholder="Key decisions and action items…"/>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setShowEditMeeting(null)} className={btnSecondary}>Cancel</button>
              <button type="submit" disabled={saving} className={btnPrimary}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Create Incident */}
      {showCreateIncident && (
        <Modal title="Assign Incident" onClose={() => setShowCreateIncident(false)}>
          <form onSubmit={handleCreateIncident} className="space-y-4">
            <div>
              <label className={labelCls}>Incident Title *</label>
              <input className={inputCls} required value={incForm.title} onChange={e => setIncForm(p => ({...p, title: e.target.value}))} placeholder="Brief description of the issue"/>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Incident Type</label>
                <select className={inputCls} value={incForm.incident_type} onChange={e => setIncForm(p => ({...p, incident_type: e.target.value}))}>
                  {INCIDENT_TYPES.map(t => <option key={t} value={t}>{t.replace('_',' ')}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Priority</label>
                <select className={inputCls} value={incForm.priority} onChange={e => setIncForm(p => ({...p, priority: e.target.value}))}>
                  {['low','medium','high','critical'].map(p => <option key={p}>{p}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className={labelCls}>District</label>
              <DistrictPicker value={incForm.district} onChange={v => setIncForm(p => ({...p, district: v}))} />
            </div>
            <div>
              <label className={labelCls}>Description</label>
              <textarea className={inputCls} rows={3} value={incForm.description} onChange={e => setIncForm(p => ({...p, description: e.target.value}))} placeholder="Full incident details…"/>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setShowCreateIncident(false)} className={btnSecondary}>Cancel</button>
              <button type="submit" disabled={saving} className={btnPrimary}>{saving ? 'Assigning…' : 'Assign Incident'}</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Edit Incident */}
      {showEditIncident && (
        <Modal title="Update Incident" onClose={() => setShowEditIncident(null)}>
          <form onSubmit={handleUpdateIncident} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Status</label>
                <select className={inputCls} value={showEditIncident.status} onChange={e => setShowEditIncident((p: any) => ({...p, status: e.target.value}))}>
                  {['new','under_review','assigned','in_progress','escalated','resolved','closed'].map(s => <option key={s} value={s}>{s.replace('_',' ')}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Priority</label>
                <select className={inputCls} value={showEditIncident.priority} onChange={e => setShowEditIncident((p: any) => ({...p, priority: e.target.value}))}>
                  {['low','medium','high','critical'].map(p => <option key={p}>{p}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className={labelCls}>Notes / Update</label>
              <textarea className={inputCls} rows={3} value={showEditIncident.notes || ''} onChange={e => setShowEditIncident((p: any) => ({...p, notes: e.target.value}))} placeholder="Progress notes or resolution details…"/>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="esc" checked={!!showEditIncident.escalated} onChange={e => setShowEditIncident((p: any) => ({...p, escalated: e.target.checked}))} className="rounded"/>
              <label htmlFor="esc" className="text-sm text-gray-700 dark:text-gray-300">Mark as escalated</label>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setShowEditIncident(null)} className={btnSecondary}>Cancel</button>
              <button type="submit" disabled={saving} className={btnPrimary}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Create Project */}
      {showCreateProject && (
        <Modal title="New Field Project" onClose={() => setShowCreateProject(false)}>
          <form onSubmit={handleCreateProject} className="space-y-4">
            <div>
              <label className={labelCls}>Project Title *</label>
              <input className={inputCls} required value={prjForm.title} onChange={e => setPrjForm(p => ({...p, title: e.target.value}))} placeholder="e.g. Borehole Rehabilitation — Nakawa"/>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Type</label>
                <select className={inputCls} value={prjForm.project_type} onChange={e => setPrjForm(p => ({...p, project_type: e.target.value}))}>
                  {PROJECT_TYPES.map(t => <option key={t} value={t}>{t.replace('_',' ')}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Priority</label>
                <select className={inputCls} value={prjForm.priority} onChange={e => setPrjForm(p => ({...p, priority: e.target.value}))}>
                  {['low','medium','high','critical'].map(p => <option key={p}>{p}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>District</label>
                <DistrictPicker value={prjForm.district} onChange={v => setPrjForm(p => ({...p, district: v}))} />
              </div>
              <div>
                <label className={labelCls}>Budget (UGX)</label>
                <input type="number" className={inputCls} value={prjForm.budget} onChange={e => setPrjForm(p => ({...p, budget: e.target.value}))} placeholder="0"/>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Start Date</label>
                <input type="date" className={inputCls} value={prjForm.start_date} onChange={e => setPrjForm(p => ({...p, start_date: e.target.value}))}/>
              </div>
              <div>
                <label className={labelCls}>End Date</label>
                <input type="date" className={inputCls} value={prjForm.end_date} onChange={e => setPrjForm(p => ({...p, end_date: e.target.value}))}/>
              </div>
            </div>
            <div>
              <label className={labelCls}>Description</label>
              <textarea className={inputCls} rows={2} value={prjForm.description} onChange={e => setPrjForm(p => ({...p, description: e.target.value}))} placeholder="Project scope and objectives…"/>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setShowCreateProject(false)} className={btnSecondary}>Cancel</button>
              <button type="submit" disabled={saving} className={btnPrimary}>{saving ? 'Creating…' : 'Create Project'}</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Edit Project */}
      {showEditProject && (
        <Modal title="Update Project" onClose={() => setShowEditProject(null)}>
          <form onSubmit={handleUpdateProject} className="space-y-4">
            <div>
              <label className={labelCls}>Title</label>
              <input className={inputCls} value={showEditProject.title} onChange={e => setShowEditProject((p: any) => ({...p, title: e.target.value}))}/>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Status</label>
                <select className={inputCls} value={showEditProject.status} onChange={e => setShowEditProject((p: any) => ({...p, status: e.target.value}))}>
                  {['planned','active','on_hold','completed','cancelled'].map(s => <option key={s} value={s}>{s.replace('_',' ')}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Progress (%)</label>
                <input type="number" min="0" max="100" className={inputCls} value={showEditProject.progress_pct || 0} onChange={e => setShowEditProject((p: any) => ({...p, progress_pct: e.target.value}))}/>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Budget (UGX)</label>
                <input type="number" className={inputCls} value={showEditProject.budget || 0} onChange={e => setShowEditProject((p: any) => ({...p, budget: e.target.value}))}/>
              </div>
              <div>
                <label className={labelCls}>Spent (UGX)</label>
                <input type="number" className={inputCls} value={showEditProject.spent || 0} onChange={e => setShowEditProject((p: any) => ({...p, spent: e.target.value}))}/>
              </div>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setShowEditProject(null)} className={btnSecondary}>Cancel</button>
              <button type="submit" disabled={saving} className={btnPrimary}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Post Announcement */}
      {showAnnouncement && (
        <Modal title="Post Announcement" onClose={() => setShowAnnouncement(false)}>
          <form onSubmit={handleCreateAnnouncement} className="space-y-4">
            <div>
              <label className={labelCls}>Title *</label>
              <input className={inputCls} required value={annForm.title} onChange={e => setAnnForm(p => ({...p, title: e.target.value}))} placeholder="Announcement title"/>
            </div>
            <div>
              <label className={labelCls}>Priority</label>
              <select className={inputCls} value={annForm.priority} onChange={e => setAnnForm(p => ({...p, priority: e.target.value}))}>
                {['normal','important','urgent'].map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Content *</label>
              <textarea className={inputCls} rows={4} required value={annForm.content} onChange={e => setAnnForm(p => ({...p, content: e.target.value}))} placeholder="Full announcement text…"/>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button type="button" onClick={() => setShowAnnouncement(false)} className={btnSecondary}>Cancel</button>
              <button type="submit" disabled={saving} className={btnPrimary}>{saving ? 'Posting…' : 'Post Announcement'}</button>
            </div>
          </form>
        </Modal>
      )}

    </>)}

    </div>
  );
}
