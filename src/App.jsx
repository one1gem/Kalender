import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Calendar, Users, Plus, X, ChevronLeft, ChevronRight, Clock, Trash2,
  CalendarX, AlertTriangle, StickyNote, Share2, MessageCircle, Instagram, LogOut,
} from "lucide-react";
import { styles, PALETTE } from "./styles.js";
import { fetchAll, insertRow, updateRow, deleteRow, deleteWhere, subscribeTable } from "./lib/db.js";
import Gate, { loadToken, validateToken, logout } from "./components/Gate.jsx";

// ---------- helpers ----------
function pad(n) { return String(n).padStart(2, "0"); }
function dateKey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function startOfWeek(d) {
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7; // Monday = 0
  date.setDate(date.getDate() - day);
  date.setHours(0, 0, 0, 0);
  return date;
}
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
function formatDateShort(dk) {
  const [y, m, d] = dk.split("-");
  return `${d}.${m}.`;
}

// ---------- main ----------
export default function App() {
  // auth: null = wird geprüft, false = PIN nötig, string = gültiger Token
  const [auth, setAuth] = useState(null);
  const [tab, setTab] = useState("kalender");
  const [members, setMembers] = useState(null);
  const [events, setEvents] = useState(null);
  const [absences, setAbsences] = useState(null);
  const [notes, setNotes] = useState(null);
  const [error, setError] = useState("");
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));

  const [showAddChoice, setShowAddChoice] = useState(null);
  const [showEventModal, setShowEventModal] = useState(null);
  const [showAbsenceQuick, setShowAbsenceQuick] = useState(null);
  const [showNoteModal, setShowNoteModal] = useState(null);
  const [showMemberModal, setShowMemberModal] = useState(false);
  const [showPersonAkte, setShowPersonAkte] = useState(null);
  const [showShare, setShowShare] = useState(null);

  // Beim Start: gespeicherten Token serverseitig validieren
  useEffect(() => {
    (async () => {
      const token = loadToken();
      const valid = await validateToken(token);
      setAuth(valid ? token : false);
    })();
  }, []);

  const reloadAll = useCallback(async () => {
    try {
      const [m, e, a, n] = await Promise.all([
        fetchAll("members"),
        fetchAll("events"),
        fetchAll("absences"),
        fetchAll("notes"),
      ]);
      setMembers(m.map((x) => ({ ...x })));
      setEvents(e.map((x) => ({ ...x, assignees: x.assignees || [] })));
      setAbsences(a.map((x) => ({ ...x, memberId: x.member_id, startDate: x.start_date, endDate: x.end_date })));
      setNotes(n.map((x) => ({ ...x })));
    } catch (err) {
      console.error(err);
      setError("Daten konnten nicht geladen werden. Bitte Internetverbindung prüfen.");
    }
  }, []);

  // Daten laden, sobald angemeldet
  useEffect(() => {
    if (typeof auth === "string") reloadAll();
  }, [auth, reloadAll]);

  // realtime: keep every device in sync
  useEffect(() => {
    if (typeof auth !== "string") return;
    const unsubs = [
      subscribeTable("members", reloadAll),
      subscribeTable("events", reloadAll),
      subscribeTable("absences", reloadAll),
      subscribeTable("notes", reloadAll),
    ];
    return () => unsubs.forEach((u) => u());
  }, [auth, reloadAll]);

  const membersById = useMemo(() => {
    const map = {};
    (members || []).forEach((m) => (map[m.id] = m));
    return map;
  }, [members]);

  const loading = members === null || events === null || absences === null || notes === null;

  // ---- mutation helpers ----
  const addMember = async (m) => {
    await insertRow("members", m);
    await reloadAll();
  };
  const updateMember = async (m) => {
    await updateRow("members", m.id, { name: m.name, role: m.role, type: m.type, color: m.color });
    await reloadAll();
  };
  const removeMember = async (id) => {
    await deleteRow("members", id);
    await deleteWhere("absences", "member_id", id);
    const affected = (events || []).filter((e) => (e.assignees || []).includes(id));
    for (const e of affected) {
      await updateRow("events", e.id, { assignees: e.assignees.filter((a) => a !== id) });
    }
    await reloadAll();
  };

  const saveEvent = async (ev) => {
    const exists = (events || []).find((e) => e.id === ev.id);
    const row = {
      id: ev.id,
      date: ev.date,
      time: ev.time,
      location: ev.location,
      notes: ev.notes,
      crew_type: ev.crewType,
      assignees: ev.assignees,
    };
    if (exists) await updateRow("events", ev.id, row);
    else await insertRow("events", row);
    await reloadAll();
  };
  const removeEvent = async (id) => {
    await deleteRow("events", id);
    await reloadAll();
  };

  const addAbsence = async (a) => {
    await insertRow("absences", {
      id: a.id,
      member_id: a.memberId,
      start_date: a.startDate,
      end_date: a.endDate,
      reason: a.reason,
    });
    await reloadAll();
  };
  const removeAbsence = async (id) => {
    await deleteRow("absences", id);
    await reloadAll();
  };

  const saveNote = async (n) => {
    const exists = (notes || []).find((x) => x.id === n.id);
    if (exists) await updateRow("notes", n.id, { date: n.date, text: n.text });
    else await insertRow("notes", n);
    await reloadAll();
  };
  const removeNote = async (id) => {
    await deleteRow("notes", id);
    await reloadAll();
  };

  // Auth-Status: wird noch geprüft
  if (auth === null) {
    return (
      <div style={styles.gateShell}>
        <div style={{ color: "#9BA3AE", fontSize: 14 }}>Lädt…</div>
      </div>
    );
  }

  // Kein gültiger Token: PIN abfragen
  if (auth === false) {
    return <Gate onDone={(token) => setAuth(token)} />;
  }

  return (
    <div style={styles.appShell} className="app-shell">
      <Sidebar
        tab={tab}
        setTab={setTab}
        onLogout={async () => {
          await logout(auth);
          setAuth(false);
        }}
      />
      <main style={styles.main} className="main-content">
        {error && (
          <div style={styles.errorBanner}>
            {error}
            <button style={styles.errorClose} onClick={() => setError("")}>
              <X size={14} />
            </button>
          </div>
        )}
        {loading ? (
          <div style={styles.loadingWrap}>Lädt…</div>
        ) : tab === "kalender" ? (
          <KalenderView
            weekStart={weekStart}
            setWeekStart={setWeekStart}
            events={events}
            members={members}
            membersById={membersById}
            absences={absences}
            notes={notes}
            onAddEntry={(dk) => setShowAddChoice(dk)}
            onEditEvent={(ev) => setShowEventModal(ev)}
            onEditNote={(n) => setShowNoteModal(n)}
            onShare={(title, text) => setShowShare({ title, text })}
          />
        ) : (
          <TeamView
            members={members}
            events={events}
            absences={absences}
            onAdd={() => setShowMemberModal(true)}
            onOpenPerson={(m) => setShowPersonAkte(m)}
          />
        )}
      </main>

      {showAddChoice && (
        <AddChoiceModal
          onClose={() => setShowAddChoice(null)}
          onChoose={(kind) => {
            const dk = showAddChoice;
            setShowAddChoice(null);
            if (kind === "termin") setShowEventModal({ dateKey: dk });
            if (kind === "abwesenheit") setShowAbsenceQuick({ dateKey: dk });
            if (kind === "notiz") setShowNoteModal({ dateKey: dk });
          }}
        />
      )}

      {showEventModal && (
        <EventModal
          data={showEventModal}
          members={members}
          absences={absences}
          events={events}
          onClose={() => setShowEventModal(null)}
          onSave={async (ev) => {
            await saveEvent(ev);
            setShowEventModal(null);
          }}
          onDelete={async (id) => {
            await removeEvent(id);
            setShowEventModal(null);
          }}
          onShare={(title, text) => setShowShare({ title, text })}
        />
      )}

      {showAbsenceQuick && (
        <AbsenceQuickModal
          members={members}
          dateKey={showAbsenceQuick.dateKey}
          onClose={() => setShowAbsenceQuick(null)}
          onSave={async (a) => {
            await addAbsence(a);
            setShowAbsenceQuick(null);
          }}
        />
      )}

      {showNoteModal && (
        <NoteModal
          data={showNoteModal}
          onClose={() => setShowNoteModal(null)}
          onSave={async (n) => {
            await saveNote(n);
            setShowNoteModal(null);
          }}
          onDelete={async (id) => {
            await removeNote(id);
            setShowNoteModal(null);
          }}
        />
      )}

      {showMemberModal && (
        <MemberModal
          member={null}
          existingCount={members.length}
          onClose={() => setShowMemberModal(false)}
          onSave={async (m) => {
            await addMember(m);
            setShowMemberModal(false);
          }}
        />
      )}

      {showPersonAkte && (
        <PersonAkte
          member={membersById[showPersonAkte.id] || showPersonAkte}
          events={events}
          absences={absences.filter((a) => a.memberId === showPersonAkte.id)}
          onClose={() => setShowPersonAkte(null)}
          onSaveMember={async (m) => {
            await updateMember(m);
            setShowPersonAkte(m);
          }}
          onDeleteMember={async (id) => {
            await removeMember(id);
            setShowPersonAkte(null);
          }}
          onAddAbsence={async (absence) => {
            await addAbsence(absence);
          }}
          onDeleteAbsence={async (id) => {
            await removeAbsence(id);
          }}
        />
      )}

      {showShare && <ShareModal title={showShare.title} text={showShare.text} onClose={() => setShowShare(null)} />}
    </div>
  );
}

// ---------- sidebar ----------
function Sidebar({ tab, setTab, onLogout }) {
  return (
    <nav style={styles.sidebar} className="sidebar">
      <div style={styles.brand} className="brand">
        <div style={styles.brandMark}>TK</div>
        <div>
          <div style={styles.brandTitle}>Team & Kalender</div>
          <div style={styles.brandSub}>Einsatzplanung</div>
        </div>
      </div>
      <div style={styles.navList} className="nav-list">
        <button
          style={{ ...styles.navItem, ...(tab === "kalender" ? styles.navItemActive : {}) }}
          onClick={() => setTab("kalender")}
        >
          <Calendar size={17} /> Kalender
        </button>
        <button
          style={{ ...styles.navItem, ...(tab === "team" ? styles.navItemActive : {}) }}
          onClick={() => setTab("team")}
        >
          <Users size={17} /> Team
        </button>
      </div>
      <div style={{ flex: 1 }} className="sidebar-spacer" />
      <button style={styles.logoutBtn} className="logout-btn" onClick={onLogout}>
        <LogOut size={14} /> <span>Abmelden</span>
      </button>
    </nav>
  );
}

// ---------- kalender ----------
function getMonthGridDays(monthCursor) {
  const first = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1);
  const last = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 0);
  const gridStart = startOfWeek(first);
  const gridEnd = addDays(startOfWeek(last), 6);
  const out = [];
  let cur = gridStart;
  while (cur <= gridEnd) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

function crewOfEvent(ev, membersById) {
  const p = membersById[ev.assignees?.[0]];
  return p?.type;
}
function formatDateFull(dk) {
  const [y, m, d] = dk.split("-");
  return `${d}.${m}.${y}`;
}

function buildSingleEventText(crewLabel, personName, date, time, location, notes) {
  const lines = [`Auftrag${crewLabel ? ` – ${crewLabel}` : ""}`];
  if (personName) lines.push(personName);
  lines.push(`${date ? formatDateFull(date) : ""}${time ? ` · ${time} Uhr` : ""}`.trim());
  if (location) lines.push(`Ort: ${location}`);
  if (notes) lines.push(notes);
  return lines.filter(Boolean).join("\n");
}

function buildShareText(label, days, eventsByDay, notesByDay, absentByDay) {
  const lines = [`Team & Kalender – ${label}`, ""];
  days.forEach((d) => {
    const dk = dateKey(d);
    lines.push(`${WEEKDAYS[(d.getDay() + 6) % 7]} ${formatDateShort(dk)}`);
    const evs = eventsByDay[dk] || [];
    const dayNotes = notesByDay[dk] || [];
    const absent = absentByDay[dk] || [];
    if (evs.length === 0 && dayNotes.length === 0 && absent.length === 0) {
      lines.push("—");
    } else {
      evs.forEach((ev) => {
        const person = ev._personName;
        const crew = ev._crewLabel;
        const parts = [ev.time, ev.location, person ? `${person}${crew ? ` (${crew})` : ""}` : null, ev.notes]
          .filter(Boolean)
          .join(" · ");
        lines.push(`- ${parts}`);
      });
      dayNotes.forEach((n) => lines.push(`- Notiz: ${n.text}`));
      if (absent.length > 0) lines.push(`Abwesend: ${absent.map((m) => m.name).join(", ")}`);
    }
    lines.push("");
  });
  return lines.join("\n").trim();
}

function KalenderView({ weekStart, setWeekStart, events, members, membersById, absences, notes, onAddEntry, onEditEvent, onEditNote, onShare }) {
  const [viewMode, setViewMode] = useState("woche");
  const [monthCursor, setMonthCursor] = useState(() => new Date());
  const [crewFilter, setCrewFilter] = useState("alle");

  const days = useMemo(
    () => (viewMode === "woche" ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)) : getMonthGridDays(monthCursor)),
    [viewMode, weekStart, monthCursor]
  );

  const eventsByDay = useMemo(() => {
    const map = {};
    days.forEach((d) => (map[dateKey(d)] = []));
    (events || []).forEach((e) => {
      if (!map[e.date]) return;
      if (crewFilter !== "alle" && crewOfEvent(e, membersById) !== crewFilter) return;
      const person = membersById[e.assignees?.[0]];
      map[e.date].push({
        ...e,
        _personName: person?.name,
        _crewLabel: person ? (person.type === "fest" ? "One Gem" : "Beguna") : null,
      });
    });
    Object.values(map).forEach((list) => list.sort((a, b) => (a.time || "").localeCompare(b.time || "")));
    return map;
  }, [events, days, crewFilter, membersById]);

  const notesByDay = useMemo(() => {
    const map = {};
    days.forEach((d) => (map[dateKey(d)] = []));
    (notes || []).forEach((n) => {
      if (map[n.date]) map[n.date].push(n);
    });
    return map;
  }, [notes, days]);

  const absentByDay = useMemo(() => {
    const map = {};
    days.forEach((d) => {
      const dk = dateKey(d);
      map[dk] = (members || [])
        .filter((m) => (crewFilter === "alle" ? true : m.type === crewFilter))
        .filter((m) => (absences || []).some((a) => a.memberId === m.id && dk >= a.startDate && dk <= a.endDate));
    });
    return map;
  }, [absences, members, days, crewFilter]);

  const conflictDays = useMemo(() => {
    const set = new Set();
    Object.entries(eventsByDay).forEach(([dk, list]) => {
      const seen = new Set();
      list.forEach((ev) => {
        (ev.assignees || []).forEach((id) => {
          if (seen.has(id)) set.add(dk);
          seen.add(id);
        });
      });
    });
    return set;
  }, [eventsByDay]);

  const maxLoad = useMemo(() => {
    let max = 1;
    Object.values(eventsByDay).forEach((list) => {
      const count = new Set(list.flatMap((e) => e.assignees)).size;
      if (count > max) max = count;
    });
    return max;
  }, [eventsByDay]);

  const todayKey = dateKey(new Date());

  const weekLabel = viewMode === "woche"
    ? `${MONTHS[days[0].getMonth()]}${days[0].getMonth() !== days[6].getMonth() ? " / " + MONTHS[days[6].getMonth()] : ""} ${days[6].getFullYear()}`
    : `${MONTHS[monthCursor.getMonth()]} ${monthCursor.getFullYear()}`;

  const shareWeek = () => {
    onShare("Woche teilen", buildShareText(weekLabel, days, eventsByDay, notesByDay, absentByDay));
  };

  const shareDay = (d) => {
    const dk = dateKey(d);
    onShare(
      "Tag teilen",
      buildShareText(`${WEEKDAYS[(d.getDay() + 6) % 7]} ${formatDateShort(dk)}`, [d], eventsByDay, notesByDay, absentByDay)
    );
  };

  const shareEvent = (ev) => {
    onShare("Auftrag teilen", buildSingleEventText(ev._crewLabel, ev._personName, ev.date, ev.time, ev.location, ev.notes));
  };

  return (
    <div>
      <div style={styles.pageHeader} className="page-header">
        <div>
          <div style={styles.eyebrow}>{viewMode === "woche" ? "Woche" : "Monat"}</div>
          <h1 style={styles.pageTitle}>{weekLabel}</h1>
        </div>
        <div style={styles.weekNav} className="week-nav">
          <div style={styles.viewToggle}>
            <button
              style={{ ...styles.viewToggleBtn, ...(viewMode === "woche" ? styles.viewToggleBtnActive : {}) }}
              onClick={() => setViewMode("woche")}
            >
              Woche
            </button>
            <button
              style={{ ...styles.viewToggleBtn, ...(viewMode === "monat" ? styles.viewToggleBtnActive : {}) }}
              onClick={() => setViewMode("monat")}
            >
              Monat
            </button>
          </div>
          <button
            style={styles.iconBtn}
            onClick={() =>
              viewMode === "woche"
                ? setWeekStart(addDays(weekStart, -7))
                : setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() - 1, 1))
            }
          >
            <ChevronLeft size={18} />
          </button>
          <button
            style={styles.todayBtn}
            onClick={() => {
              setWeekStart(startOfWeek(new Date()));
              setMonthCursor(new Date());
            }}
          >
            Heute
          </button>
          <button
            style={styles.iconBtn}
            onClick={() =>
              viewMode === "woche"
                ? setWeekStart(addDays(weekStart, 7))
                : setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 1))
            }
          >
            <ChevronRight size={18} />
          </button>
          <button style={styles.ghostBtn} onClick={shareWeek}>
            <Share2 size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
            Teilen
          </button>
          <button style={styles.primaryBtn} onClick={() => onAddEntry(todayKey)}>
            <Plus size={16} /> Neu
          </button>
        </div>
      </div>

      <div style={styles.filterRow}>
        <span style={styles.filterLabel}>Anzeigen:</span>
        <div style={styles.segmented}>
          <button
            style={{ ...styles.segBtn, ...(crewFilter === "alle" ? styles.segBtnActive : {}) }}
            onClick={() => setCrewFilter("alle")}
          >
            Alle
          </button>
          <button
            style={{ ...styles.segBtn, ...(crewFilter === "fest" ? styles.segBtnActive : {}) }}
            onClick={() => setCrewFilter("fest")}
          >
            One Gem
          </button>
          <button
            style={{ ...styles.segBtn, ...(crewFilter === "frei" ? styles.segBtnActive : {}) }}
            onClick={() => setCrewFilter("frei")}
          >
            Beguna
          </button>
        </div>
      </div>

      {viewMode === "woche" ? (
        <div style={styles.weekGrid} className="week-grid">
          {days.map((d) => {
            const dk = dateKey(d);
            const list = eventsByDay[dk] || [];
            const dayNotes = notesByDay[dk] || [];
            const load = new Set(list.flatMap((e) => e.assignees)).size;
            const isToday = dk === todayKey;
            const hasConflict = conflictDays.has(dk);
            return (
              <div key={dk} className="day-col" style={{ ...styles.dayCol, ...(isToday ? styles.dayColToday : {}) }}>
                <div style={styles.dayHead}>
                  <div>
                    <div style={styles.dayName}>{WEEKDAYS[(d.getDay() + 6) % 7]}</div>
                    <div style={{ ...styles.dayNum, ...(isToday ? styles.dayNumToday : {}) }}>{d.getDate()}</div>
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button style={styles.addDayBtn} onClick={() => shareDay(d)} title="Tag teilen">
                      <Share2 size={12} />
                    </button>
                    <button style={styles.addDayBtn} onClick={() => onAddEntry(dk)} title="Eintrag hinzufügen">
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
                <div style={styles.loadBarTrack}>
                  <div style={{ ...styles.loadBarFill, width: `${(load / maxLoad) * 100}%` }} />
                </div>
                {hasConflict && (
                  <div style={styles.conflictTag}>
                    <AlertTriangle size={10} /> Doppelbuchung
                  </div>
                )}
                <div style={styles.dayEvents}>
                  {list.length === 0 && dayNotes.length === 0 && (absentByDay[dk] || []).length === 0 && (
                    <div style={styles.emptyDay}>—</div>
                  )}
                  {list.map((ev) => (
                    <div key={ev.id} style={styles.eventCard}>
                      <button style={styles.eventCardMain} onClick={() => onEditEvent(ev)}>
                        {ev.time && (
                          <div style={styles.eventTime}>
                            <Clock size={11} /> {ev.time}
                          </div>
                        )}
                        <div style={styles.eventTitle}>{ev.location || ev._personName || "Termin"}</div>
                        {ev.notes && <div style={styles.eventLocation}>{ev.notes}</div>}
                        {ev._personName && (
                          <div style={styles.avatarRow}>
                            <div
                              style={{ ...styles.avatar, background: membersById[ev.assignees[0]]?.color }}
                              title={`${ev._crewLabel} · ${ev._personName}`}
                            >
                              {ev._personName.slice(0, 1).toUpperCase()}
                            </div>
                            <span style={styles.avatarName}>{ev._personName}</span>
                          </div>
                        )}
                      </button>
                      <button
                        style={styles.eventShareBtn}
                        onClick={() => shareEvent(ev)}
                        title="Auftrag teilen"
                      >
                        <Share2 size={11} />
                      </button>
                    </div>
                  ))}
                  {dayNotes.map((n) => (
                    <button key={n.id} style={styles.noteCard} onClick={() => onEditNote(n)}>
                      <div style={styles.noteHead}>
                        <StickyNote size={11} /> Notiz
                      </div>
                      <div style={styles.noteText}>{n.text}</div>
                    </button>
                  ))}
                </div>
                {(absentByDay[dk] || []).length > 0 && (
                  <div style={styles.absentRow}>
                    <CalendarX size={11} style={{ flexShrink: 0, color: "#9A6B4E" }} />
                    <div style={styles.absentNames}>{absentByDay[dk].map((m) => m.name).join(", ")}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div style={styles.monthGrid} className="month-grid">
          {WEEKDAYS.map((w) => (
            <div key={w} style={styles.monthWeekdayLabel}>
              {w}
            </div>
          ))}
          {days.map((d) => {
            const dk = dateKey(d);
            const list = eventsByDay[dk] || [];
            const dayNotes = notesByDay[dk] || [];
            const absent = absentByDay[dk] || [];
            const isToday = dk === todayKey;
            const inMonth = d.getMonth() === monthCursor.getMonth();
            const hasConflict = conflictDays.has(dk);
            return (
              <button
                key={dk}
                style={{
                  ...styles.monthCell,
                  ...(isToday ? styles.monthCellToday : {}),
                  ...(!inMonth ? styles.monthCellOutside : {}),
                }}
                onClick={() => {
                  setWeekStart(startOfWeek(d));
                  setViewMode("woche");
                }}
              >
                <div style={styles.monthCellHead}>
                  <span style={{ ...styles.monthCellNum, ...(isToday ? styles.dayNumToday : {}) }}>{d.getDate()}</span>
                  {hasConflict && <AlertTriangle size={10} color="#A24E4E" />}
                </div>
                <div style={styles.monthCellDots}>
                  {list.slice(0, 3).map((ev) => (
                    <div key={ev.id} style={{ ...styles.monthDot, background: membersById[ev.assignees?.[0]]?.color || "#8A93A0" }} />
                  ))}
                  {dayNotes.length > 0 && <div style={{ ...styles.monthDot, background: "#C9A227" }} />}
                  {absent.length > 0 && <CalendarX size={10} color="#9A6B4E" />}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TeamView({ members, events, absences, onAdd, onOpenPerson }) {
  const fixed = members.filter((m) => m.type === "fest");
  const freelance = members.filter((m) => m.type === "frei");
  const todayKey = dateKey(new Date());

  const upcomingCount = (id) => {
    return events.filter((e) => e.assignees.includes(id) && e.date >= todayKey).length;
  };

  const activeAbsence = (id) => {
    return (absences || [])
      .filter((a) => a.memberId === id && a.endDate >= todayKey)
      .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  };

  return (
    <div>
      <div style={styles.pageHeader} className="page-header">
        <div>
          <div style={styles.eyebrow}>Besetzung</div>
          <h1 style={styles.pageTitle}>Team</h1>
        </div>
        <button style={styles.primaryBtn} onClick={onAdd}>
          <Plus size={16} /> Person hinzufügen
        </button>
      </div>

      <TeamGroup
        label="One Gem Crew"
        count={fixed.length}
        people={fixed}
        upcomingCount={upcomingCount}
        activeAbsence={activeAbsence}
        onOpenPerson={onOpenPerson}
      />
      <TeamGroup
        label="Beguna Crew"
        count={freelance.length}
        people={freelance}
        upcomingCount={upcomingCount}
        activeAbsence={activeAbsence}
        onOpenPerson={onOpenPerson}
      />
    </div>
  );
}

function TeamGroup({ label, count, people, upcomingCount, activeAbsence, onOpenPerson }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={styles.groupHead}>
        <span style={styles.groupLabel}>{label}</span>
        <span style={styles.groupCount}>{count}</span>
      </div>
      {people.length === 0 ? (
        <div style={styles.emptyGroup}>Noch niemand eingetragen.</div>
      ) : (
        <div style={styles.peopleGrid}>
          {people.map((m) => {
            const absence = activeAbsence(m.id);
            return (
              <button key={m.id} style={styles.personCard} onClick={() => onOpenPerson(m)}>
                <div style={{ ...styles.personAvatar, background: m.color }}>{m.name.slice(0, 1).toUpperCase()}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.personName}>{m.name}</div>
                  <div style={styles.personMeta}>
                    {m.role ? m.role + " · " : ""}
                    {upcomingCount(m.id)} anstehende Termine
                  </div>
                  {absence && (
                    <div style={styles.absenceTag}>
                      <CalendarX size={11} /> Abwesend {formatDateShort(absence.startDate)}
                      {absence.endDate !== absence.startDate ? `–${formatDateShort(absence.endDate)}` : ""}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------- modals ----------
function MemberModal({ member, existingCount, onClose, onSave }) {
  const [name, setName] = useState(member?.name || "");
  const [role, setRole] = useState(member?.role || "");
  const [type, setType] = useState(member?.type || "frei");
  const [color, setColor] = useState(member?.color || PALETTE[existingCount % PALETTE.length]);

  const canSave = name.trim().length > 0;

  return (
    <ModalShell onClose={onClose} title={member ? "Person bearbeiten" : "Person hinzufügen"}>
      <Field label="Name">
        <input
          style={styles.input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="z. B. Mira Voss"
          autoFocus
        />
      </Field>
      <Field label="Rolle (optional)">
        <input
          style={styles.input}
          value={role}
          onChange={(e) => setRole(e.target.value)}
          placeholder="z. B. Grafik, Fotografie…"
        />
      </Field>
      <Field label="Status">
        <div style={styles.segmented}>
          <button
            style={{ ...styles.segBtn, ...(type === "fest" ? styles.segBtnActive : {}) }}
            onClick={() => setType("fest")}
          >
            One Gem Crew
          </button>
          <button
            style={{ ...styles.segBtn, ...(type === "frei" ? styles.segBtnActive : {}) }}
            onClick={() => setType("frei")}
          >
            Beguna Crew
          </button>
        </div>
      </Field>
      <Field label="Farbe">
        <div style={styles.colorRow}>
          {PALETTE.map((c) => (
            <button
              key={c}
              style={{
                ...styles.colorSwatch,
                background: c,
                outline: color === c ? "2px solid #1B1E24" : "none",
                outlineOffset: 2,
              }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
      </Field>
      <div style={styles.modalFooter}>
        <button style={styles.ghostBtn} onClick={onClose}>
          Abbrechen
        </button>
        <button
          style={{ ...styles.primaryBtn, opacity: canSave ? 1 : 0.5 }}
          disabled={!canSave}
          onClick={() =>
            onSave({
              id: member?.id || uid(),
              name: name.trim(),
              role: role.trim(),
              type,
              color,
            })
          }
        >
          Speichern
        </button>
      </div>
    </ModalShell>
  );
}

function PersonAkte({ member, events, absences, onClose, onSaveMember, onDeleteMember, onAddAbsence, onDeleteAbsence }) {
  const [name, setName] = useState(member.name);
  const [role, setRole] = useState(member.role || "");
  const [type, setType] = useState(member.type);
  const [color, setColor] = useState(member.color);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [absStart, setAbsStart] = useState(dateKey(new Date()));
  const [absEnd, setAbsEnd] = useState(dateKey(new Date()));
  const [absReason, setAbsReason] = useState("");

  const todayKey = dateKey(new Date());
  const upcomingEvents = events
    .filter((e) => e.assignees.includes(member.id) && e.date >= todayKey)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5);

  const sortedAbsences = [...absences].sort((a, b) => a.startDate.localeCompare(b.startDate));

  const canSaveMember = name.trim().length > 0;
  const canAddAbsence = absStart && absEnd && absEnd >= absStart;

  const dirty = name !== member.name || role !== (member.role || "") || type !== member.type || color !== member.color;

  return (
    <ModalShell onClose={onClose} title="Personen-Akte">
      <div style={styles.akteHead}>
        <div style={{ ...styles.personAvatar, background: color, width: 44, height: 44, fontSize: 17 }}>
          {name.slice(0, 1).toUpperCase() || "?"}
        </div>
        <div style={styles.akteHeadCrew}>{type === "fest" ? "One Gem Crew" : "Beguna Crew"}</div>
      </div>

      <Field label="Name">
        <input style={styles.input} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Rolle (optional)">
        <input
          style={styles.input}
          value={role}
          onChange={(e) => setRole(e.target.value)}
          placeholder="z. B. Grafik, Fotografie…"
        />
      </Field>
      <Field label="Crew">
        <div style={styles.segmented}>
          <button
            style={{ ...styles.segBtn, ...(type === "fest" ? styles.segBtnActive : {}) }}
            onClick={() => setType("fest")}
          >
            One Gem Crew
          </button>
          <button
            style={{ ...styles.segBtn, ...(type === "frei" ? styles.segBtnActive : {}) }}
            onClick={() => setType("frei")}
          >
            Beguna Crew
          </button>
        </div>
      </Field>
      <Field label="Farbe">
        <div style={styles.colorRow}>
          {PALETTE.map((c) => (
            <button
              key={c}
              style={{
                ...styles.colorSwatch,
                background: c,
                outline: color === c ? "2px solid #1B1E24" : "none",
                outlineOffset: 2,
              }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
      </Field>
      {dirty && (
        <button
          style={{ ...styles.primaryBtn, opacity: canSaveMember ? 1 : 0.5, marginBottom: 20 }}
          disabled={!canSaveMember}
          onClick={() => onSaveMember({ ...member, name: name.trim(), role: role.trim(), type, color })}
        >
          Änderungen speichern
        </button>
      )}

      <div style={styles.akteDivider} />

      <div style={styles.akteSectionLabel}>Anstehende Termine</div>
      {upcomingEvents.length === 0 ? (
        <div style={styles.emptyGroup}>Keine anstehenden Termine.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 18 }}>
          {upcomingEvents.map((e) => (
            <div key={e.id} style={styles.akteEventLine}>
              <span style={styles.akteEventDate}>{formatDateShort(e.date)}</span> {e.location || e.notes || "Termin"}
            </div>
          ))}
        </div>
      )}

      <div style={styles.akteDivider} />

      <div style={styles.akteSectionLabel}>
        <CalendarX size={13} style={{ verticalAlign: -2, marginRight: 5 }} />
        Abwesenheiten
      </div>

      {sortedAbsences.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
          {sortedAbsences.map((a) => (
            <div key={a.id} style={styles.absenceListItem}>
              <div style={{ flex: 1, fontSize: 12.5 }}>
                {formatDateShort(a.startDate)}
                {a.endDate !== a.startDate ? ` – ${formatDateShort(a.endDate)}` : ""}
                {a.reason ? ` · ${a.reason}` : ""}
              </div>
              <button style={styles.smallIconBtnDanger} onClick={() => onDeleteAbsence(a.id)} title="Entfernen">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={styles.absenceForm}>
        <div style={{ display: "flex", gap: 10 }}>
          <Field label="Von" style={{ flex: 1, marginBottom: 10 }}>
            <input
              style={styles.input}
              type="date"
              value={absStart}
              onChange={(e) => {
                setAbsStart(e.target.value);
                if (e.target.value > absEnd) setAbsEnd(e.target.value);
              }}
            />
          </Field>
          <Field label="Bis" style={{ flex: 1, marginBottom: 10 }}>
            <input style={styles.input} type="date" value={absEnd} onChange={(e) => setAbsEnd(e.target.value)} />
          </Field>
        </div>
        <Field label="Grund (optional)" style={{ marginBottom: 10 }}>
          <input
            style={styles.input}
            value={absReason}
            onChange={(e) => setAbsReason(e.target.value)}
            placeholder="z. B. Urlaub, Krankheit…"
          />
        </Field>
        <button
          style={{ ...styles.ghostBtn, opacity: canAddAbsence ? 1 : 0.5, width: "100%" }}
          disabled={!canAddAbsence}
          onClick={() => {
            onAddAbsence({ id: uid(), memberId: member.id, startDate: absStart, endDate: absEnd, reason: absReason.trim() });
            setAbsReason("");
          }}
        >
          <CalendarX size={14} style={{ marginRight: 6, verticalAlign: -3 }} />
          Abwesenheit hinzufügen
        </button>
      </div>

      <div style={styles.akteDivider} />

      <div style={styles.modalFooter}>
        {confirmDelete ? (
          <>
            <span style={{ fontSize: 12.5, color: "#A24E4E", alignSelf: "center", marginRight: "auto" }}>
              Person wirklich entfernen?
            </span>
            <button style={styles.ghostBtn} onClick={() => setConfirmDelete(false)}>
              Abbrechen
            </button>
            <button style={styles.dangerGhostBtn} onClick={() => onDeleteMember(member.id)}>
              <Trash2 size={14} /> Endgültig entfernen
            </button>
          </>
        ) : (
          <>
            <button style={styles.dangerGhostBtn} onClick={() => setConfirmDelete(true)}>
              <Trash2 size={14} /> Person entfernen
            </button>
            <div style={{ flex: 1 }} />
            <button style={styles.ghostBtn} onClick={onClose}>
              Schließen
            </button>
          </>
        )}
      </div>
    </ModalShell>
  );
}

function EventModal({ data, members, absences, events, onClose, onSave, onDelete, onShare }) {
  const initialPersonId = data.assignees?.[0] || "";
  const initialCrew = initialPersonId ? members.find((m) => m.id === initialPersonId)?.type : data.crewType;
  const [crewType, setCrewType] = useState(initialCrew || "fest");
  const [personId, setPersonId] = useState(initialPersonId);
  const [date, setDate] = useState(data.date || data.dateKey);
  const [time, setTime] = useState(data.time || "");
  const [location, setLocation] = useState(data.location || "");
  const [notes, setNotes] = useState(data.notes || "");

  const crewMembers = members.filter((m) => m.type === crewType);
  const person = members.find((m) => m.id === personId);
  const crewLabel = crewType === "fest" ? "One Gem" : "Beguna";

  const isAbsent =
    person && (absences || []).some((a) => a.memberId === person.id && date >= a.startDate && date <= a.endDate);

  const conflictEvent =
    person &&
    date &&
    (events || []).find(
      (e) => e.id !== data.id && e.date === date && (e.assignees || []).includes(person.id)
    );

  const canSave = personId && date;

  return (
    <ModalShell onClose={onClose} title={data.id ? "Termin bearbeiten" : "Neuer Termin eintragen"}>
      <Field label="Crew">
        <div style={styles.segmented}>
          <button
            style={{ ...styles.segBtn, ...(crewType === "fest" ? styles.segBtnActive : {}) }}
            onClick={() => {
              setCrewType("fest");
              if (person && person.type !== "fest") setPersonId("");
            }}
          >
            One Gem
          </button>
          <button
            style={{ ...styles.segBtn, ...(crewType === "frei" ? styles.segBtnActive : {}) }}
            onClick={() => {
              setCrewType("frei");
              if (person && person.type !== "frei") setPersonId("");
            }}
          >
            Beguna
          </button>
        </div>
      </Field>

      <Field label="Person Auswahl">
        {crewMembers.length === 0 ? (
          <div style={styles.emptyGroup}>Noch niemand in dieser Crew.</div>
        ) : (
          <div style={styles.assigneeList}>
            {crewMembers.map((m) => (
              <button
                key={m.id}
                style={{
                  ...styles.assigneeChip,
                  ...(personId === m.id ? { background: m.color, color: "#fff", borderColor: m.color } : {}),
                }}
                onClick={() => setPersonId(m.id)}
              >
                {m.name}
              </button>
            ))}
          </div>
        )}
        {person && (
          <div style={styles.previewBox}>
            <div style={styles.previewLine}>
              <strong>{crewLabel}</strong> → {person.name} wird bei{" "}
              <strong>{location.trim() ? location.trim() : "…"}</strong>{" "}
              {notes.trim() ? notes.trim() : ""} machen
            </div>
            {isAbsent && (
              <div style={styles.absentWarning}>
                <AlertTriangle size={12} /> {person.name} ist an diesem Tag als abwesend eingetragen
              </div>
            )}
            {conflictEvent && (
              <div style={styles.absentWarning}>
                <AlertTriangle size={12} /> {person.name} hat an diesem Tag bereits einen Termin
                {conflictEvent.location ? ` (${conflictEvent.location})` : ""}
              </div>
            )}
          </div>
        )}
      </Field>

      <div style={{ display: "flex", gap: 12 }}>
        <Field label="Datum" style={{ flex: 1 }}>
          <input style={styles.input} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Uhrzeit (optional)" style={{ flex: 1 }}>
          <input style={styles.input} type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
      </div>

      <Field label="Ort">
        <input
          style={styles.input}
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="z. B. Motel One München"
        />
      </Field>

      <Field label="Notiz">
        <textarea
          style={{ ...styles.input, minHeight: 64, resize: "vertical", fontFamily: "inherit" }}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="z. B. Video machen"
        />
      </Field>

      <div style={styles.modalFooter}>
        {data.id && (
          <button style={styles.dangerGhostBtn} onClick={() => onDelete(data.id)}>
            <Trash2 size={14} /> Löschen
          </button>
        )}
        {data.id && person && (
          <button
            style={styles.ghostBtn}
            onClick={() => onShare("Auftrag teilen", buildSingleEventText(crewLabel, person.name, date, time, location, notes))}
          >
            <Share2 size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
            Teilen
          </button>
        )}
        <div style={{ flex: 1 }} />
        <button style={styles.ghostBtn} onClick={onClose}>
          Abbrechen
        </button>
        <button
          style={{ ...styles.primaryBtn, opacity: canSave ? 1 : 0.5 }}
          disabled={!canSave}
          onClick={() =>
            onSave({
              id: data.id || uid(),
              date,
              time,
              crewType,
              location: location.trim(),
              notes: notes.trim(),
              assignees: personId ? [personId] : [],
            })
          }
        >
          Speichern
        </button>
      </div>
    </ModalShell>
  );
}

// ---------- teilen ----------
function ShareModal({ title, text, onClose }) {
  const [copied, setCopied] = useState(false);
  const [igCopied, setIgCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const handleInstagram = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setIgCopied(true);
      setTimeout(() => setIgCopied(false), 2500);
    } catch {
      setIgCopied(false);
    }
    window.open("https://www.instagram.com/direct/inbox/", "_blank", "noopener,noreferrer");
  };

  const waLink = `https://wa.me/?text=${encodeURIComponent(text)}`;

  return (
    <ModalShell onClose={onClose} title={title}>
      <textarea
        readOnly
        value={text}
        onFocus={(e) => e.target.select()}
        style={{ ...styles.input, minHeight: 220, resize: "vertical", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5 }}
      />

      <div style={styles.shareChannelRow}>
        <a href={waLink} target="_blank" rel="noopener noreferrer" style={styles.shareChannelBtn}>
          <MessageCircle size={15} /> Per WhatsApp senden
        </a>
        <button style={styles.shareChannelBtn} onClick={handleInstagram}>
          <Instagram size={15} /> {igCopied ? "Kopiert – Instagram öffnet…" : "Für Instagram kopieren"}
        </button>
      </div>
      <div style={styles.shareHint}>
        Instagram erlaubt kein automatisches Einfügen – der Text wird kopiert, dann einfach in den Chat einfügen.
      </div>

      <div style={styles.modalFooter}>
        <button style={styles.ghostBtn} onClick={onClose}>
          Schließen
        </button>
        <button style={styles.primaryBtn} onClick={handleCopy}>
          {copied ? "Kopiert ✓" : "Text kopieren"}
        </button>
      </div>
    </ModalShell>
  );
}

// ---------- add choice / abwesenheit / notiz ----------
function AddChoiceModal({ onClose, onChoose }) {
  const options = [
    { key: "termin", label: "Termin", desc: "Einsatz mit Crew planen", icon: Calendar },
    { key: "abwesenheit", label: "Abwesenheit", desc: "Person als abwesend eintragen", icon: CalendarX },
    { key: "notiz", label: "Notiz", desc: "Freien Vermerk zum Tag hinzufügen", icon: StickyNote },
  ];
  return (
    <ModalShell onClose={onClose} title="Neuer Eintrag">
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {options.map((o) => (
          <button key={o.key} style={styles.choiceCard} onClick={() => onChoose(o.key)}>
            <div style={styles.choiceIcon}>
              <o.icon size={18} />
            </div>
            <div>
              <div style={styles.choiceLabel}>{o.label}</div>
              <div style={styles.choiceDesc}>{o.desc}</div>
            </div>
          </button>
        ))}
      </div>
    </ModalShell>
  );
}

function AbsenceQuickModal({ members, dateKey: dk, lockedMemberId, onClose, onSave }) {
  const [memberId, setMemberId] = useState(lockedMemberId || members[0]?.id || "");
  const [startDate, setStartDate] = useState(dk);
  const [endDate, setEndDate] = useState(dk);
  const [reason, setReason] = useState("");

  const lockedMember = lockedMemberId ? members.find((m) => m.id === lockedMemberId) : null;

  const canSave = memberId && startDate && endDate && endDate >= startDate;

  return (
    <ModalShell onClose={onClose} title="Abwesenheit eintragen">
      {lockedMember ? (
        <Field label="Person">
          <div style={styles.previewBox}>
            <div style={styles.previewLine}>
              Für <strong>{lockedMember.name}</strong>
            </div>
          </div>
        </Field>
      ) : (
        <Field label="Person">
          {members.length === 0 ? (
            <div style={styles.emptyGroup}>Noch keine Personen im Team.</div>
          ) : (
            <>
              {[
                { key: "fest", label: "One Gem Crew" },
                { key: "frei", label: "Beguna Crew" },
              ].map(({ key, label }) => {
                const group = members.filter((m) => m.type === key);
                if (group.length === 0) return null;
                return (
                  <div key={key} style={{ marginBottom: 8 }}>
                    <div style={styles.assigneeGroupLabel}>{label}</div>
                    <div style={styles.assigneeList}>
                      {group.map((m) => (
                        <button
                          key={m.id}
                          style={{
                            ...styles.assigneeChip,
                            ...(memberId === m.id ? { background: m.color, color: "#fff", borderColor: m.color } : {}),
                          }}
                          onClick={() => setMemberId(m.id)}
                        >
                          {m.name}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </Field>
      )}
      <div style={{ display: "flex", gap: 12 }}>
        <Field label="Von" style={{ flex: 1 }}>
          <input
            style={styles.input}
            type="date"
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              if (e.target.value > endDate) setEndDate(e.target.value);
            }}
          />
        </Field>
        <Field label="Bis" style={{ flex: 1 }}>
          <input style={styles.input} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </Field>
      </div>
      <Field label="Grund (optional)">
        <input
          style={styles.input}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="z. B. Urlaub, Krankheit…"
        />
      </Field>
      <div style={styles.modalFooter}>
        <button style={styles.ghostBtn} onClick={onClose}>
          Abbrechen
        </button>
        <button
          style={{ ...styles.primaryBtn, opacity: canSave ? 1 : 0.5 }}
          disabled={!canSave}
          onClick={() => onSave({ id: uid(), memberId, startDate, endDate, reason: reason.trim() })}
        >
          Speichern
        </button>
      </div>
    </ModalShell>
  );
}

function NoteModal({ data, onClose, onSave, onDelete }) {
  const [date, setDate] = useState(data.date || data.dateKey);
  const [text, setText] = useState(data.text || "");

  const canSave = text.trim().length > 0 && date;

  return (
    <ModalShell onClose={onClose} title={data.id ? "Notiz bearbeiten" : "Neue Notiz"}>
      <Field label="Datum">
        <input style={styles.input} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field label="Notiz">
        <textarea
          style={{ ...styles.input, minHeight: 90, resize: "vertical", fontFamily: "inherit" }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Was gibt es zu vermerken?"
          autoFocus
        />
      </Field>
      <div style={styles.modalFooter}>
        {data.id && (
          <button style={styles.dangerGhostBtn} onClick={() => onDelete(data.id)}>
            <Trash2 size={14} /> Löschen
          </button>
        )}
        <div style={{ flex: 1 }} />
        <button style={styles.ghostBtn} onClick={onClose}>
          Abbrechen
        </button>
        <button
          style={{ ...styles.primaryBtn, opacity: canSave ? 1 : 0.5 }}
          disabled={!canSave}
          onClick={() => onSave({ id: data.id || uid(), date, text: text.trim() })}
        >
          Speichern
        </button>
      </div>
    </ModalShell>
  );
}

function ModalShell({ title, onClose, children }) {
  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHead}>
          <h2 style={styles.modalTitle}>{title}</h2>
          <button style={styles.iconBtn} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div style={styles.modalBody}>{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children, style }) {
  return (
    <div style={{ marginBottom: 16, ...style }}>
      <label style={styles.label}>{label}</label>
      {children}
    </div>
  );
}
