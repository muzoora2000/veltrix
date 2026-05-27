import { useEffect, useRef, useState } from 'react';
import { Bell, X, MapPin, Calendar, Clock, Globe } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { getVolunteerEvents } from '../../api/client';

type AlarmLevel = '30min' | '5min' | 'now';
interface AlarmState { event: any; level: AlarmLevel; diffMin: number; }

/* ── Web Audio alarm (no external files) ── */
function playAlarm(level: AlarmLevel) {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();

    type Note = { f: number; t: number };
    const notes: Note[] =
      level === '30min'
        ? [{ f: 880, t: 0 }, { f: 880, t: 0.5 }, { f: 1100, t: 1.0 }]
        : level === '5min'
        ? [{ f: 1100, t: 0 }, { f: 1100, t: 0.3 }, { f: 1100, t: 0.6 }, { f: 1300, t: 0.9 }, { f: 1300, t: 1.2 }]
        : Array.from({ length: 10 }, (_, i) => ({ f: i % 2 === 0 ? 1500 : 1200, t: i * 0.16 }));

    const vol = level === '30min' ? 0.45 : level === '5min' ? 0.75 : 1.0;
    const dur = level === 'now' ? 0.13 : 0.22;

    notes.forEach(({ f, t }) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'square';
      osc.frequency.value = f;
      gain.gain.setValueAtTime(vol, ctx.currentTime + t);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + dur);
      osc.start(ctx.currentTime + t);
      osc.stop(ctx.currentTime + t + dur + 0.05);
    });
  } catch {}
}

export default function EventAlarmMonitor() {
  const { user } = useAuth();
  const [alarm, setAlarm]   = useState<AlarmState | null>(null);

  const eventsRef     = useRef<any[]>([]);
  const dismissedRef  = useRef<Set<string>>(new Set());
  const currentKeyRef = useRef('');
  const repeatRef     = useRef<ReturnType<typeof setInterval> | null>(null);

  // Persist dismissed keys across page refreshes within the session
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem('ev_alarm_dismissed') || '[]');
      dismissedRef.current = new Set(saved);
    } catch {}
  }, []);

  const clearRepeat = () => {
    if (repeatRef.current) { clearInterval(repeatRef.current); repeatRef.current = null; }
  };

  const dismiss = (cur: AlarmState | null) => {
    if (cur) {
      dismissedRef.current.add(`${cur.event.id}_${cur.level}`);
      try { sessionStorage.setItem('ev_alarm_dismissed', JSON.stringify([...dismissedRef.current])); } catch {}
    }
    clearRepeat();
    currentKeyRef.current = '';
    setAlarm(null);
  };

  const fire = (ev: any, level: AlarmLevel, diffMin: number) => {
    const key = `${ev.id}_${level}`;
    if (currentKeyRef.current === key) return; // already showing
    clearRepeat();
    currentKeyRef.current = key;
    setAlarm({ event: ev, level, diffMin });
    playAlarm(level);
    if (level === 'now') {
      // Repeat loud alarm every 4 s until dismissed
      repeatRef.current = setInterval(() => playAlarm('now'), 4000);
    }
  };

  useEffect(() => {
    if (!user) return;

    const fetchEvents = async () => {
      try {
        const r = await getVolunteerEvents();
        eventsRef.current = (r.data.data || []).filter((e: any) => !!e.i_joined);
      } catch {}
    };

    const check = () => {
      const now = Date.now();
      for (const ev of eventsRef.current) {
        if (!ev.event_date) continue;
        const dateOnly = String(ev.event_date).split('T')[0];
        const start    = new Date(`${dateOnly}T${ev.event_time || '00:00'}:00`).getTime();
        const diff     = (start - now) / 60000; // minutes until start

        let level: AlarmLevel | null = null;
        if      (diff >= -3  && diff <= 2)  level = 'now';
        else if (diff >   2  && diff <= 8)  level = '5min';
        else if (diff >  25  && diff <= 35) level = '30min';
        if (!level) continue;

        const key = `${ev.id}_${level}`;
        if (dismissedRef.current.has(key)) continue;

        fire(ev, level, diff);
        break; // show one alarm at a time
      }
    };

    fetchEvents().then(check);
    const fetchTimer = setInterval(fetchEvents, 5 * 60 * 1000); // re-fetch every 5 min
    const checkTimer = setInterval(check,       60 * 1000);     // check every minute

    return () => {
      clearInterval(fetchTimer);
      clearInterval(checkTimer);
      clearRepeat();
    };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!alarm) return null;

  const { event: ev, level, diffMin } = alarm;
  const isCritical = level === 'now';
  const isWarning  = level === '5min';

  const headerBg  = isCritical ? 'bg-red-600' : isWarning ? 'bg-orange-500' : 'bg-blue-600';
  const btnBg     = isCritical ? 'bg-red-600 hover:bg-red-500' : isWarning ? 'bg-orange-500 hover:bg-orange-400' : 'bg-blue-600 hover:bg-blue-500';
  const heading   = isCritical ? '🚨 EVENT STARTING NOW!' : isWarning ? '⚠️ EVENT IN ~5 MINUTES!' : '🔔 Reminder — Event in 30 Min';
  const timeLabel = isCritical
    ? 'Happening right now — do not miss it!'
    : `Starting in approximately ${Math.round(Math.max(1, diffMin))} minutes`;

  const dateOnly = ev.event_date ? String(ev.event_date).split('T')[0] : '';

  return (
    /* Clicking the backdrop also dismisses */
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.78)' }}
      onClick={() => dismiss(alarm)}
    >
      <div
        className={`relative w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl ${isCritical ? 'animate-pulse' : ''}`}
        onClick={e => e.stopPropagation()}
      >
        {/* Coloured header */}
        <div className={`${headerBg} px-5 py-4 flex items-center gap-3`}>
          <Bell size={28} className={`text-white ${isCritical ? 'animate-bounce' : ''}`} />
          <span className="text-white font-black text-base leading-tight">{heading}</span>
          <button onClick={() => dismiss(alarm)} className="ml-auto text-white/80 hover:text-white">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="bg-white dark:bg-gray-900 px-5 py-5 space-y-3">
          <p className="font-bold text-gray-900 dark:text-white text-lg leading-snug">{ev.title}</p>

          <div className="space-y-2 text-sm">
            <div className={`flex items-center gap-2 font-semibold ${isCritical ? 'text-red-600' : isWarning ? 'text-orange-500' : 'text-blue-600'}`}>
              <Clock size={14} />
              {timeLabel}
            </div>
            {dateOnly && (
              <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                <Calendar size={13} />
                {new Date(dateOnly).toLocaleDateString('en-UG', { weekday: 'short', day: 'numeric', month: 'short' })}
                {ev.event_time && ` at ${ev.event_time}`}
              </div>
            )}
            {ev.event_mode === 'online'
              ? <div className="flex items-center gap-2 text-blue-500"><Globe size={13} /> Online Event</div>
              : ev.location && <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400"><MapPin size={13} /> {ev.location}</div>
            }
            {ev.district && (
              <div className="text-xs text-gray-400">📍 {ev.district} District</div>
            )}
          </div>

          {/* Join meeting link for online events when starting now */}
          {ev.event_link && isCritical && (
            <a
              href={ev.event_link} target="_blank" rel="noopener noreferrer"
              className="block w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold text-center transition-colors"
              onClick={() => dismiss(alarm)}
            >
              🔗 Join Meeting Now
            </a>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 pt-1">
            {!isCritical && (
              <button
                onClick={() => dismiss(alarm)}
                className="flex-1 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 text-sm font-semibold transition-colors"
              >
                Snooze
              </button>
            )}
            <button
              onClick={() => dismiss(alarm)}
              className={`flex-1 py-2.5 rounded-xl text-white text-sm font-bold transition-colors ${btnBg}`}
            >
              {isCritical ? '✓ Got it, going now!' : 'Dismiss'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
