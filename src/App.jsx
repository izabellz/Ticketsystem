import { useEffect, useMemo, useState } from 'react'
import {
  Activity, AlertCircle, ArrowDownUp, Bell, Check, ChevronDown, CircleHelp,
  Clock3, FileText, Filter, Inbox, LogOut, MessageSquare, Plus, Search,
  Send, ShieldCheck, Ticket, Upload, UserRound, X, Zap
} from 'lucide-react'
import { configured, supabase } from './lib/supabase'

const STATUS = {
  open: { label: 'Offen', className: 'blue' },
  in_progress: { label: 'In Bearbeitung', className: 'purple' },
  waiting: { label: 'Wartet auf Antwort', className: 'amber' },
  resolved: { label: 'Erledigt', className: 'green' },
  closed: { label: 'Geschlossen', className: 'muted' }
}
const PRIORITY = {
  low: { label: 'Niedrig', className: 'muted' },
  normal: { label: 'Normal', className: 'blue' },
  high: { label: 'Hoch', className: 'amber' },
  urgent: { label: 'Dringend', className: 'red' }
}
const CATEGORIES = ['Software', 'Hardware', 'Zugriff / Konto', 'Netzwerk', 'Sonstiges']
const fmt = (value) => value ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—'
const initials = (value = '') => value.slice(0, 2).toUpperCase()
const friendlyError = (e) => e?.message || 'Das hat nicht geklappt. Bitte erneut versuchen.'

function Badge({ children, tone = 'muted' }) { return <span className={`badge ${tone}`}>{children}</span> }
function Field({ label, children }) { return <label className="field"><span>{label}</span>{children}</label> }

export default function App() {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [tickets, setTickets] = useState([])
  const [selected, setSelected] = useState(null)
  const [messages, setMessages] = useState([])
  const [attachments, setAttachments] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [view, setView] = useState('tickets')
  const [showNew, setShowNew] = useState(false)
  const [newTicket, setNewTicket] = useState({ subject: '', description: '', category: 'Software', priority: 'normal' })
  const [reply, setReply] = useState('')
  const [replyFiles, setReplyFiles] = useState([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteResult, setInviteResult] = useState('')

  useEffect(() => {
    if (!configured) { setLoading(false); return }
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession))
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) { setProfile(null); setTickets([]); setSelected(null); setLoading(false); return }
    loadProfileAndTickets()
  }, [session?.user?.id])

  async function loadProfileAndTickets() {
    setLoading(true); setError('')
    const { data: p, error: pErr } = await supabase.from('profiles').select('id,email,display_name,role').eq('id', session.user.id).single()
    if (pErr) { setError('Dein Benutzerprofil wurde nicht gefunden. Bitte Admin kontaktieren.'); setLoading(false); return }
    setProfile(p)
    const { data, error: tErr } = await supabase.from('tickets').select('*, profiles!tickets_owner_id_fkey(display_name,email)').order('updated_at', { ascending: false })
    if (tErr) setError(friendlyError(tErr))
    else setTickets(data || [])
    setLoading(false)
  }

  async function loadMessages(ticket) {
    setSelected(ticket); setReply(''); setReplyFiles([]); setAttachments([]); setError('')
    const { data, error: mErr } = await supabase.from('ticket_messages')
      .select('id,ticket_id,author_id,body,is_internal,created_at,profiles(display_name,email)')
      .eq('ticket_id', ticket.id).order('created_at', { ascending: true })
    if (mErr) setError(friendlyError(mErr)); else setMessages(data || [])
    const { data: a, error: aErr } = await supabase.from('ticket_attachments').select('*').eq('ticket_id', ticket.id).order('created_at')
    if (!aErr) setAttachments(a || [])
  }

  async function signIn(e) {
    e.preventDefault(); setBusy(true); setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(friendlyError(error))
    setBusy(false)
  }

  async function signOut() { await supabase.auth.signOut(); setView('tickets') }

  async function uploadFiles(ticketId, files, messageId = null) {
    for (const file of Array.from(files || [])) {
      if (file.size > 8 * 1024 * 1024) throw new Error(`${file.name} ist größer als 8 MB.`)
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100)
      const path = `${ticketId}/${crypto.randomUUID()}-${safeName}`
      const { error: upErr } = await supabase.storage.from('ticket-files').upload(path, file, { upsert: false })
      if (upErr) throw upErr
      const { error: dbErr } = await supabase.from('ticket_attachments').insert({
        ticket_id: ticketId, message_id: messageId, uploader_id: session.user.id,
        storage_path: path, file_name: file.name, mime_type: file.type || 'application/octet-stream', size_bytes: file.size
      })
      if (dbErr) throw dbErr
    }
  }

  async function createTicket(e) {
    e.preventDefault(); setBusy(true); setError('')
    try {
      const { data, error: insertErr } = await supabase.from('tickets').insert({
        subject: newTicket.subject.trim(), description: newTicket.description.trim(),
        category: newTicket.category, priority: newTicket.priority, owner_id: session.user.id
      }).select().single()
      if (insertErr) throw insertErr
      if (attachments.length) await uploadFiles(data.id, attachments)
      await supabase.from('ticket_messages').insert({ ticket_id: data.id, author_id: session.user.id, body: newTicket.description.trim(), is_internal: false })
      await supabase.functions.invoke('notify-ticket', { body: { ticket_id: data.id, event: 'created' } }).catch(() => {})
      setNewTicket({ subject: '', description: '', category: 'Software', priority: 'normal' })
      setAttachments([]); setShowNew(false); setNotice('Ticket wurde erstellt.')
      await loadProfileAndTickets()
    } catch (e) { setError(friendlyError(e)) }
    setBusy(false)
  }

  async function sendReply(e) {
    e.preventDefault()
    if (!reply.trim() && !replyFiles.length) return
    setBusy(true); setError('')
    try {
      const { data, error: mErr } = await supabase.from('ticket_messages').insert({
        ticket_id: selected.id, author_id: session.user.id, body: reply.trim(), is_internal: false
      }).select().single()
      if (mErr) throw mErr
      if (replyFiles.length) await uploadFiles(selected.id, replyFiles, data.id)
      await supabase.from('tickets').update({ updated_at: new Date().toISOString() }).eq('id', selected.id)
      await supabase.functions.invoke('notify-ticket', { body: { ticket_id: selected.id, event: 'reply' } }).catch(() => {})
      setReply(''); setReplyFiles([])
      await loadMessages(selected)
      await loadProfileAndTickets()
      setNotice('Antwort wurde gesendet.')
    } catch (e) { setError(friendlyError(e)) }
    setBusy(false)
  }

  async function updateTicket(patch) {
    setBusy(true); setError('')
    const { error: uErr } = await supabase.from('tickets').update(patch).eq('id', selected.id)
    if (uErr) setError(friendlyError(uErr))
    else {
      const next = { ...selected, ...patch, updated_at: new Date().toISOString() }
      setSelected(next); await loadProfileAndTickets(); setNotice('Ticket aktualisiert.')
    }
    setBusy(false)
  }

  async function downloadAttachment(item) {
    const { data, error: dErr } = await supabase.storage.from('ticket-files').createSignedUrl(item.storage_path, 60)
    if (dErr) setError(friendlyError(dErr)); else window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  async function inviteUser(e) {
    e.preventDefault()
    setInviteResult('Einladungen müssen aus Sicherheitsgründen über Supabase Auth oder eine serverseitige Admin-Funktion ausgelöst werden.')
  }

  const isAdmin = profile?.role === 'admin'
  const filtered = useMemo(() => tickets.filter(t => {
    const matchesFilter = filter === 'all' || t.status === filter
    const s = `${t.subject} ${t.description} ${t.id} ${t.profiles?.email || ''}`.toLowerCase()
    return matchesFilter && s.includes(query.toLowerCase())
  }), [tickets, filter, query])
  const stats = useMemo(() => ({
    open: tickets.filter(t => ['open', 'in_progress', 'waiting'].includes(t.status)).length,
    urgent: tickets.filter(t => t.priority === 'urgent' && !['resolved', 'closed'].includes(t.status)).length,
    resolved: tickets.filter(t => ['resolved', 'closed'].includes(t.status)).length
  }), [tickets])

  if (!configured) return <SetupScreen />
  if (loading) return <div className="loading-screen"><div className="brand-mark"><ShieldCheck size={24}/></div><div className="spinner"/><span>Helpdesk wird geladen …</span></div>
  if (!session) return <LoginScreen email={email} setEmail={setEmail} password={password} setPassword={setPassword} onSubmit={signIn} busy={busy} error={error}/>

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><ShieldCheck size={22}/></div><div><strong>nexus<span>desk</span></strong><small>SUPPORT PORTAL</small></div></div>
      <div className="workspace-label">WORKSPACE</div>
      <nav>
        <button className={`nav-item ${view === 'tickets' ? 'active' : ''}`} onClick={() => { setView('tickets'); setSelected(null) }}><Inbox size={18}/> Tickets <span className="nav-count">{stats.open}</span></button>
        {isAdmin && <button className={`nav-item ${view === 'users' ? 'active' : ''}`} onClick={() => { setView('users'); setSelected(null) }}><UserRound size={18}/> Nutzer einladen</button>}
      </nav>
      <div className="sidebar-bottom">
        <div className="secure-note"><ShieldCheck size={17}/><div><strong>Privater Bereich</strong><small>Geschützter Zugriff</small></div></div>
        <div className="user-card"><div className="avatar">{initials(profile?.display_name || profile?.email)}</div><div className="user-meta"><strong>{profile?.display_name || 'Support-Nutzer'}</strong><small>{profile?.email}</small></div><button className="icon-btn" title="Abmelden" onClick={signOut}><LogOut size={16}/></button></div>
      </div>
    </aside>

    <main className="main">
      <header className="topbar">
        <div className="breadcrumbs"><span>Workspace</span><span className="slash">/</span><strong>{selected ? `Ticket #${selected.ticket_number || selected.id.slice(0,8)}` : view === 'users' ? 'Nutzer einladen' : 'Tickets'}</strong></div>
        <div className="top-actions"><span className="online-dot"/> System online <button className="icon-btn" title="Aktualisieren" onClick={loadProfileAndTickets}><ArrowDownUp size={16}/></button><button className="primary-btn small" onClick={() => { setSelected(null); setShowNew(true) }}><Plus size={16}/> Neues Ticket</button></div>
      </header>

      <div className="content">
        {error && <div className="alert error"><AlertCircle size={17}/>{error}<button onClick={() => setError('')}><X size={15}/></button></div>}
        {notice && <div className="alert success"><Check size={17}/>{notice}<button onClick={() => setNotice('')}><X size={15}/></button></div>}

        {view === 'users' && isAdmin ? <section className="panel invite-panel">
          <div className="eyebrow">ZUGRIFFSVERWALTUNG</div><h1>Nutzer einladen</h1>
          <p>Der öffentliche Registrierungsweg ist deaktiviert. Lade Personen über das Supabase-Dashboard ein oder richte später eine sichere Admin-Edge-Function ein.</p>
          <form onSubmit={inviteUser} className="stack-form"><Field label="E-Mail-Adresse"><input type="email" required placeholder="person@beispiel.de" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}/></Field><button className="primary-btn" type="submit"><Send size={16}/> Einladungs-Hinweis anzeigen</button></form>
          {inviteResult && <div className="alert info">{inviteResult}</div>}
          <div className="hint-box"><strong>Einladung sicher versenden</strong><ol><li>Supabase öffnen → Authentication → Users.</li><li>„Invite user“ wählen und E-Mail eingeben.</li><li>Nach erfolgreicher Anmeldung das Profil des Nutzers in der Tabelle <code>profiles</code> prüfen.</li></ol></div>
        </section> : selected ? <TicketDetail ticket={selected} isAdmin={isAdmin} profile={profile} messages={messages} attachments={attachments} reply={reply} setReply={setReply} replyFiles={replyFiles} setReplyFiles={setReplyFiles} onReply={sendReply} onBack={() => setSelected(null)} onUpdate={updateTicket} onDownload={downloadAttachment} busy={busy}/> :
          <>
            <div className="page-heading"><div><div className="eyebrow">ÜBERSICHT</div><h1>{isAdmin ? 'Support Center' : 'Meine Tickets'} <span className="heading-dot">.</span></h1><p>Alles im Blick. Probleme strukturiert lösen.</p></div><button className="primary-btn" onClick={() => setShowNew(true)}><Plus size={17}/> Ticket erstellen</button></div>
            <div className="stat-grid">
              <StatCard icon={<Inbox size={19}/>} label="Aktive Tickets" value={stats.open} foot="Noch in Bearbeitung" tone="blue"/>
              <StatCard icon={<Zap size={19}/>} label="Dringend" value={stats.urgent} foot="Benötigen Aufmerksamkeit" tone="red"/>
              <StatCard icon={<Check size={19}/>} label="Abgeschlossen" value={stats.resolved} foot="Erfolgreich gelöst" tone="green"/>
            </div>
            <section className="ticket-panel">
              <div className="panel-head"><div><h2>Ticket-Übersicht</h2><p>{filtered.length} {filtered.length === 1 ? 'Ticket' : 'Tickets'} gefunden</p></div><div className="table-actions"><label className="search-box"><Search size={16}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Tickets suchen …"/></label><label className="filter-box"><Filter size={15}/><select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">Alle Status</option>{Object.entries(STATUS).map(([key, s]) => <option key={key} value={key}>{s.label}</option>)}</select><ChevronDown size={13}/></label></div></div>
              {filtered.length === 0 ? <div className="empty-state"><div className="empty-icon"><Ticket size={25}/></div><h3>Keine Tickets gefunden</h3><p>Erstelle ein Ticket oder passe deine Suche an.</p><button className="secondary-btn" onClick={() => setShowNew(true)}><Plus size={15}/> Erstes Ticket erstellen</button></div> :
                <div className="ticket-table-wrap"><table className="ticket-table"><thead><tr><th>Ticket</th><th>Status</th><th>Priorität</th>{isAdmin && <th>Anfragende Person</th>}<th>Zuletzt aktualisiert</th><th></th></tr></thead><tbody>
                  {filtered.map(t => <tr key={t.id} onClick={() => loadMessages(t)} className="clickable-row"><td><div className="ticket-title"><span className="ticket-icon"><MessageSquare size={16}/></span><div><strong>{t.subject}</strong><small>#{t.ticket_number || t.id.slice(0,8)} · {t.category}</small></div></div></td><td><Badge tone={STATUS[t.status]?.className}>{STATUS[t.status]?.label || t.status}</Badge></td><td><Badge tone={PRIORITY[t.priority]?.className}><span className="priority-dot"/> {PRIORITY[t.priority]?.label || t.priority}</Badge></td>{isAdmin && <td><div className="requester"><div className="avatar tiny">{initials(t.profiles?.display_name || t.profiles?.email)}</div><span>{t.profiles?.display_name || t.profiles?.email || 'Nutzer'}</span></div></td>}<td className="date-cell">{fmt(t.updated_at)}</td><td><button className="icon-btn" aria-label="Ticket öffnen" onClick={e => { e.stopPropagation(); loadMessages(t) }}><ChevronDown size={16} className="rotate-270"/></button></td></tr>)}
                </tbody></table></div>}
            </section>
            <div className="footer-note"><ShieldCheck size={14}/> Deine Support-Daten sind durch rollenbasierte Zugriffsregeln geschützt.</div>
          </>}
      </div>
    </main>

    {showNew && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setShowNew(false) }}><form className="modal" onSubmit={createTicket}>
      <div className="modal-head"><div><div className="eyebrow">SUPPORT ANFRAGE</div><h2>Neues Ticket erstellen</h2><p>Beschreibe kurz, wobei du Hilfe brauchst.</p></div><button type="button" className="icon-btn" onClick={() => setShowNew(false)}><X size={18}/></button></div>
      <Field label="Betreff"><input required minLength="4" maxLength="160" placeholder="z. B. VPN-Verbindung funktioniert nicht" value={newTicket.subject} onChange={e => setNewTicket({ ...newTicket, subject: e.target.value })}/></Field>
      <div className="two-fields"><Field label="Kategorie"><select value={newTicket.category} onChange={e => setNewTicket({ ...newTicket, category: e.target.value })}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></Field><Field label="Priorität"><select value={newTicket.priority} onChange={e => setNewTicket({ ...newTicket, priority: e.target.value })}>{Object.entries(PRIORITY).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field></div>
      <Field label="Beschreibung"><textarea required minLength="10" rows="5" placeholder="Was ist passiert? Seit wann besteht das Problem? Welche Fehlermeldung erscheint?" value={newTicket.description} onChange={e => setNewTicket({ ...newTicket, description: e.target.value })}/></Field>
      <Field label="Dateien anhängen (optional, max. 8 MB pro Datei)"><input type="file" multiple onChange={e => setAttachments(Array.from(e.target.files || []))}/></Field>
      {attachments.length > 0 && <div className="file-list">{attachments.map(f => <span key={f.name}><FileText size={14}/>{f.name}</span>)}</div>}
      <div className="modal-actions"><button type="button" className="secondary-btn" onClick={() => setShowNew(false)}>Abbrechen</button><button className="primary-btn" disabled={busy}>{busy ? 'Wird erstellt …' : <><Send size={16}/> Ticket absenden</>}</button></div>
    </form></div>}
  </div>
}

function StatCard({ icon, label, value, foot, tone }) {
  return <div className="stat-card"><div className={`stat-icon ${tone}`}>{icon}</div><div className="stat-label">{label}</div><div className="stat-value">{value}</div><div className="stat-foot">{foot}</div><div className={`stat-glow ${tone}`}/></div>
}

function TicketDetail({ ticket, isAdmin, profile, messages, attachments, reply, setReply, replyFiles, setReplyFiles, onReply, onBack, onUpdate, onDownload, busy }) {
  const status = STATUS[ticket.status] || STATUS.open
  return <div className="detail-page">
    <button className="back-link" onClick={onBack}>← Zurück zur Übersicht</button>
    <div className="detail-heading"><div><div className="eyebrow">TICKET #{ticket.ticket_number || ticket.id.slice(0,8)}</div><h1>{ticket.subject}</h1><p>Erstellt am {fmt(ticket.created_at)} · {ticket.category}</p></div><Badge tone={status.className}>{status.label}</Badge></div>
    <div className="detail-grid"><div className="conversation-column">
      <section className="panel description-panel"><div className="message-author"><div className="avatar">{initials(ticket.profiles?.display_name || profile?.display_name || profile?.email)}</div><div><strong>{ticket.profiles?.display_name || profile?.display_name || 'Ticket-Ersteller'}</strong><small>Ticketbeschreibung · {fmt(ticket.created_at)}</small></div></div><p className="description-text">{ticket.description}</p></section>
      <section className="panel conversation-panel"><div className="panel-title"><div><h2>Nachrichtenverlauf</h2><p>Alle Antworten zu diesem Ticket</p></div><span className="conversation-count">{messages.length}</span></div>
        {messages.length === 0 ? <p className="muted-copy">Noch keine Nachrichten.</p> : <div className="message-list">{messages.map(m => <article className={`message ${m.author_id === profile.id ? 'own' : ''}`} key={m.id}><div className="avatar">{initials(m.profiles?.display_name || m.profiles?.email)}</div><div className="message-body"><div className="message-meta"><strong>{m.profiles?.display_name || m.profiles?.email || 'Support'}</strong><span>{fmt(m.created_at)}</span></div><p>{m.body}</p>{attachments.filter(a => a.message_id === m.id).map(a => <button className="attachment-link" key={a.id} onClick={() => onDownload(a)}><FileText size={14}/>{a.file_name}<span>{Math.max(1, Math.round(a.size_bytes/1024))} KB</span></button>)}</div></article>)}</div>}
        <form className="reply-form" onSubmit={onReply}><textarea rows="3" placeholder="Schreibe eine Antwort …" value={reply} onChange={e => setReply(e.target.value)}/><div className="reply-actions"><label className="attach-btn"><Upload size={15}/> Datei anhängen<input type="file" multiple onChange={e => setReplyFiles(Array.from(e.target.files || []))}/></label><span className="reply-hint">{replyFiles.length ? `${replyFiles.length} Datei(en) ausgewählt` : 'Bitte keine Passwörter oder sensiblen Daten senden.'}</span><button className="primary-btn small" disabled={busy || (!reply.trim() && !replyFiles.length)}><Send size={15}/> Antworten</button></div></form>
      </section>
    </div><aside className="detail-sidebar"><section className="panel properties-panel"><h3>Ticket-Details</h3><Field label="Status"><select value={ticket.status} disabled={!isAdmin || busy} onChange={e => onUpdate({ status: e.target.value })}>{Object.entries(STATUS).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field><Field label="Priorität"><select value={ticket.priority} disabled={!isAdmin || busy} onChange={e => onUpdate({ priority: e.target.value })}>{Object.entries(PRIORITY).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field><div className="property-line"><span>Erstellt</span><strong>{fmt(ticket.created_at)}</strong></div><div className="property-line"><span>Aktualisiert</span><strong>{fmt(ticket.updated_at)}</strong></div>{isAdmin && <div className="admin-tip"><ShieldCheck size={16}/><span>Admin-Modus aktiv. Änderungen sind für den Ticket-Ersteller sichtbar.</span></div>}</section>
      <section className="panel attachment-panel"><h3>Anhänge</h3>{attachments.length ? attachments.map(a => <button className="attachment-link" key={a.id} onClick={() => onDownload(a)}><FileText size={15}/><span className="attachment-name">{a.file_name}</span><span>{Math.max(1, Math.round(a.size_bytes/1024))} KB</span></button>) : <p className="muted-copy">Keine Anhänge vorhanden.</p>}</section>
    </aside></div>
  </div>
}

function LoginScreen({ email, setEmail, password, setPassword, onSubmit, busy, error }) {
  return <div className="login-screen"><div className="login-decoration deco-one"/><div className="login-decoration deco-two"/><div className="login-card"><div className="brand-mark large"><ShieldCheck size={27}/></div><div className="eyebrow">PRIVATE SUPPORT WORKSPACE</div><h1>Willkommen zurück<span className="heading-dot">.</span></h1><p className="login-subtitle">Melde dich an, um deine Support-Tickets sicher zu verwalten.</p>{error && <div className="alert error"><AlertCircle size={16}/>{error}</div>}<form onSubmit={onSubmit} className="login-form"><Field label="E-Mail-Adresse"><input type="email" autoComplete="username" required placeholder="du@beispiel.de" value={email} onChange={e => setEmail(e.target.value)}/></Field><Field label="Passwort"><input type="password" autoComplete="current-password" required placeholder="Dein Passwort" value={password} onChange={e => setPassword(e.target.value)}/></Field><button className="primary-btn login-submit" disabled={busy}>{busy ? 'Anmeldung läuft …' : <>Sicher anmelden <ArrowDownUp size={16}/></>}</button></form><div className="login-security"><ShieldCheck size={15}/> Nur eingeladene Nutzer können auf diesen Bereich zugreifen.</div></div><div className="login-footer">NEXUSDESK <span>·</span> PRIVATE SUPPORT PORTAL</div></div>
}

function SetupScreen() {
  return <div className="setup-screen"><div className="brand-mark large"><ShieldCheck size={27}/></div><div className="eyebrow">KONFIGURATION ERFORDERLICH</div><h1>Fast startklar<span className="heading-dot">.</span></h1><p>Die Supabase-Verbindung fehlt noch. Lege im Projektverzeichnis eine <code>.env</code>-Datei an und trage die Projekt-URL sowie den öffentlichen Publishable-/Anon-Key ein.</p><pre>VITE_SUPABASE_URL=https://deinprojekt.supabase.co{"\n"}VITE_SUPABASE_ANON_KEY=dein_public_key</pre><p>Die Werte findest du in Supabase unter Project Settings → API. Danach den Entwicklungsserver neu starten.</p></div>
}