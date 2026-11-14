'use strict';

/**
 * Telegram for the coach:
 *  - every notification meant for the coach (new message, plan request, deletion request, …) also arrives in Telegram;
 *  - replying to a message notification sends the reply straight to that client;
 *  - with ANTHROPIC_API_KEY, free text goes to a small assistant (Claude Haiku 5.5 by default) that can look things up
 *    and prepare actions (write to a client, pause, bring back). Nothing changes before the coach taps "✅".
 *
 * Privacy: the assistant never sees client names – the server swaps them for codes (K12) before anything goes to the
 * API and swaps them back in the answer. Only chats linked through the app (one-time link) are served.
 *
 * Settings: TELEGRAM_BOT_TOKEN (from @BotFather). Optional: TELEGRAM_AI_MODEL (default claude-haiku-5-5).
 * With an https APP_URL the bot uses a webhook (wakes a sleeping server); otherwise it polls.
 */

const crypto = require('node:crypto');
const Anthropic = require('@anthropic-ai/sdk');
const { createAttention } = require('./attention');

const API = 'https://api.telegram.org';
const DEFAULT_MODEL = 'claude-haiku-5-5';
const LINK_TTL = 15 * 60 * 1000;
const PENDING_TTL = 30 * 60 * 1000;
const CONVO_IDLE = 30 * 60 * 1000;
const CONVO_MAX = 40; // messages; then a fresh conversation starts (history is never edited)
const AI_PER_HOUR = 40;
const MAX_STEPS = 6;

const escHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const DAY = 864e5;
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const fmtDay = (d) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', timeZone: 'UTC' }) : '');
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (v, d = 1) => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d);

const SYSTEM = `Du bist der Assistent eines Fitness- und Ernährungscoaches in der App StayOnTrack und schreibst mit ihm über Telegram.
Klienten heißen bei dir immer K und eine Zahl (z. B. K12). Verwende genau diese Kürzel, erfinde keine Namen; die App setzt die echten Namen selbst ein.
Hol dir Fakten mit den Werkzeugen, statt zu raten. Aktionen (Nachricht senden, pausieren, reaktivieren) führst du nicht selbst aus: Das Werkzeug zeigt dem Coach einen Entwurf mit Bestätigungs-Button. Danach antwortest du höchstens mit einem kurzen Satz.
Nachrichten an Klienten schreibst du im Ton des Coaches: per Du, freundlich, kurz, ohne Emojis-Flut, und ohne Kürzel wie K12 im Text – sprich den Klienten mit „{name}“ an, wenn du eine Anrede brauchst.
Antworte auf Deutsch, knapp und als einfacher Text ohne Markdown (keine Sternchen, keine Rauten). Listen mit „•“.
Bei medizinischen Fragen verweist du auf Arzt oder Physiotherapeut.`;

const TOOLS = [
  {
    name: 'brauchen_aufmerksamkeit',
    description: 'Wer den Coach gerade am meisten braucht (Score und Gründe, z. B. kein Eintrag seit Tagen, Gewicht entgegen dem Ziel, wartende Nachrichten). Pausierte Klienten fehlen.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'offene_anfragen',
    description: 'Alles, was auf den Coach wartet: ungelesene Nachrichten (mit Text), Wünsche nach einem Ernährungsplan, offene Tauschwünsche, Löschanträge.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'klienten',
    description: 'Alle Klienten mit Kürzel, Ziel-Kategorie, letztem Eintrag und Pausen-Status.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'klient_details',
    description: 'Werte eines Klienten: Wochenschnitt dieser und letzter Woche (Gewicht, Schritte, Schlaf), Ziele, letzter Check-in, letzte Nachrichten.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['klient'],
      properties: { klient: { type: 'string', description: 'Kürzel, z. B. K12' } },
    },
  },
  {
    name: 'nachricht_senden',
    description: 'Bereitet eine Chat-Nachricht des Coaches an einen Klienten vor. Der Coach bestätigt sie per Button, erst dann wird sie gesendet.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['klient', 'text'],
      properties: {
        klient: { type: 'string', description: 'Kürzel, z. B. K12' },
        text: { type: 'string', description: 'Der fertige Nachrichtentext, max. 2000 Zeichen. Anrede mit {name}.' },
      },
    },
  },
  {
    name: 'pausieren',
    description: 'Bereitet vor, einen Klienten zu pausieren (Urlaub, Verletzung, Pause): keine Erinnerungen, nicht in den To-dos. Der Coach bestätigt per Button.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['klient'],
      properties: {
        klient: { type: 'string', description: 'Kürzel, z. B. K12' },
        bis: { type: 'string', description: 'Optional: Rückkehrdatum YYYY-MM-DD (in der Zukunft, max. 1 Jahr)' },
        notiz: { type: 'string', description: 'Optional: kurze Notiz für den Coach, z. B. Urlaub' },
      },
    },
  },
  {
    name: 'reaktivieren',
    description: 'Bereitet vor, einen pausierten Klienten wieder aktiv zu setzen. Der Coach bestätigt per Button.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['klient'],
      properties: { klient: { type: 'string', description: 'Kürzel, z. B. K12' } },
    },
  },
];

const HELP = [
  '<b>StayOnTrack auf Telegram</b>',
  'Hier landen alle Benachrichtigungen, die dich als Coach betreffen.',
  '',
  '↩️ <b>Antworten:</b> Antworte (wischen oder „Antworten“) auf eine Nachricht eines Klienten – dein Text geht direkt an ihn.',
  '/offen – was gerade auf dich wartet',
  '/heute – wer braucht Aufmerksamkeit',
  '/neu – neues Gespräch mit dem Assistenten',
  '/trennen – Telegram von deinem Konto lösen',
];

function createTelegram({ db, notifier, localDate, env = process.env, appUrl = null, fetchImpl = (...a) => fetch(...a), aiClient = null, log = console }) {
  const token = env.TELEGRAM_BOT_TOKEN || '';
  const enabled = Boolean(token);
  const secret = env.TELEGRAM_WEBHOOK_SECRET || crypto.createHash('sha256').update(`${token}:stayontrack-webhook`).digest('hex').slice(0, 48);
  const base = appUrl ? appUrl.replace(/\/+$/, '') : '';
  const model = env.TELEGRAM_AI_MODEL || DEFAULT_MODEL;
  const aiEnabled = () => Boolean(aiClient || env.ANTHROPIC_API_KEY);
  let anthropic = null;
  const ai = () => aiClient || (anthropic ||= new Anthropic());
  let botName = env.TELEGRAM_BOT_USERNAME || null;
  const tz = notifier.timezone;
  const today = () => localDate(Date.now(), tz);
  const attention = createAttention(db);

  const q = {
    link: db.prepare('SELECT * FROM telegram_links WHERE user_id = ?'),
    byChat: db.prepare('SELECT l.*, u.display_name, u.role FROM telegram_links l JOIN users u ON u.id = l.user_id WHERE l.chat_id = ?'),
    upsertLink: db.prepare(`INSERT INTO telegram_links (user_id, chat_id, tg_name) VALUES (?, ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET chat_id = excluded.chat_id, tg_name = excluded.tg_name, linked_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`),
    dropChat: db.prepare('DELETE FROM telegram_links WHERE chat_id = ?'),
    unlink: db.prepare('DELETE FROM telegram_links WHERE user_id = ?'),
    addRef: db.prepare('INSERT OR REPLACE INTO telegram_refs (chat_id, message_id, client_id) VALUES (?, ?, ?)'),
    ref: db.prepare('SELECT client_id FROM telegram_refs WHERE chat_id = ? AND message_id = ?'),
    pruneRefs: db.prepare("DELETE FROM telegram_refs WHERE created_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-30 days')"),
    clients: db.prepare(`SELECT u.id, u.display_name, u.category, u.archived_at, u.archive_until, u.deletion_requested_at,
        (SELECT MAX(date) FROM entries e WHERE e.user_id = u.id) AS last_entry
      FROM users u WHERE u.role = 'client' ORDER BY u.display_name COLLATE NOCASE`),
    client: db.prepare("SELECT * FROM users WHERE id = ? AND role = 'client'"),
    insertMessage: db.prepare('INSERT INTO messages (client_id, sender_id, body) VALUES (?, ?, ?)'),
    unread: db.prepare(`SELECT client_id, body, created_at FROM messages m
      WHERE m.sender_id = m.client_id AND m.read_at IS NULL ORDER BY m.id`),
    planRequests: db.prepare("SELECT client_id, updated_at FROM nutrition_requests WHERE status = 'open'"),
    swaps: db.prepare("SELECT client_id, COUNT(*) AS n FROM swap_requests WHERE status = 'open' GROUP BY client_id"),
    entries: db.prepare('SELECT date, weight, steps, sleep FROM entries WHERE user_id = ? AND date >= ? ORDER BY date'),
    goals: db.prepare('SELECT target_weight, steps_goal, sleep_goal, calories_min, calories_max FROM goals WHERE user_id = ?'),
    lastCheckin: db.prepare('SELECT created_at, status FROM checkins WHERE client_id = ? ORDER BY id DESC LIMIT 1'),
    lastMessages: db.prepare(`SELECT m.body, m.created_at, (m.sender_id = m.client_id) AS from_client FROM messages m
      WHERE m.client_id = ? ORDER BY m.id DESC LIMIT 6`),
    archive: db.prepare("UPDATE users SET archived_at = COALESCE(archived_at, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), archive_until = ?, archive_note = ? WHERE id = ? AND role = 'client'"),
    unarchive: db.prepare("UPDATE users SET archived_at = NULL, archive_until = NULL, archive_note = NULL WHERE id = ? AND role = 'client'"),
  };

  // ---- Telegram Bot API ----
  async function tg(method, params = {}) {
    const res = await fetchImpl(`${API}/bot${token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) {
      const err = new Error(`Telegram ${method}: ${data.description || res.status}`);
      err.code = data.error_code || res.status;
      throw err;
    }
    return data.result;
  }

  async function send(chatId, text, extra = {}) {
    try {
      return await tg('sendMessage', { chat_id: chatId, text: text.slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
    } catch (err) {
      // the coach blocked the bot or deleted the chat: forget the link
      if (err.code === 403) q.dropChat.run(String(chatId));
      throw err;
    }
  }
  const sendPlain = (chatId, text, extra = {}) => tg('sendMessage', { chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true, ...extra });

  const openButton = (url) => (base.startsWith('https://') && url ? { reply_markup: { inline_keyboard: [[{ text: 'In der App öffnen', url: `${base}${url}` }]] } } : {});

  async function botUsername() {
    if (!botName && enabled) botName = (await tg('getMe')).username;
    return botName;
  }

  // ---- linking (one-time code from the app) ----
  const codes = new Map(); // code -> { userId, exp }
  function newLinkCode(userId) {
    for (const [c, v] of codes) if (v.exp < Date.now() || v.userId === userId) codes.delete(c);
    const code = crypto.randomBytes(18).toString('base64url');
    codes.set(code, { userId, exp: Date.now() + LINK_TTL });
    return code;
  }

  // ---- names never reach the AI: K<id> instead ----
  function aliases() {
    const list = q.clients.all();
    const byId = new Map(list.map((c) => [c.id, c]));
    const firsts = new Map();
    for (const c of list) {
      const f = String(c.display_name).trim().split(/\s+/)[0].toLowerCase();
      firsts.set(f, (firsts.get(f) || 0) + 1);
    }
    const pairs = [];
    for (const c of list) {
      pairs.push([String(c.display_name).trim(), `K${c.id}`]);
      const f = String(c.display_name).trim().split(/\s+/)[0];
      if (f.length >= 3 && firsts.get(f.toLowerCase()) === 1 && f !== String(c.display_name).trim()) pairs.push([f, `K${c.id}`]);
    }
    pairs.sort((a, b) => b[0].length - a[0].length);
    const res = pairs.map(([name, alias]) => [new RegExp(`(?<![\\p{L}\\p{N}])${escRe(name)}(?![\\p{L}\\p{N}])`, 'giu'), alias]);
    return {
      byId,
      hide: (text) => res.reduce((t, [re, alias]) => t.replace(re, alias), String(text ?? '')),
      show: (text) => String(text ?? '').replace(/\bK(\d+)\b/g, (m, id) => (byId.get(Number(id)) ? byId.get(Number(id)).display_name : m)),
      resolve: (ref) => {
        const m = String(ref || '').trim().match(/^K?(\d+)$/i);
        if (m && byId.get(Number(m[1]))) return byId.get(Number(m[1]));
        return null;
      },
    };
  }

  // ---- facts for commands and the assistant (names as K<id>; `show` turns them back) ----
  function openRequests(A) {
    const lines = [];
    const unread = new Map();
    for (const m of q.unread.all()) {
      const u = unread.get(m.client_id) || [];
      u.push(m);
      unread.set(m.client_id, u);
    }
    for (const [id, ms] of unread) {
      if (!A.byId.get(id)) continue;
      const last = ms[ms.length - 1];
      lines.push(`• K${id}: ${ms.length} ungelesene ${ms.length === 1 ? 'Nachricht' : 'Nachrichten'}, zuletzt: „${A.hide(last.body).slice(0, 200)}“`);
    }
    for (const r of q.planRequests.all()) if (A.byId.get(r.client_id)) lines.push(`• K${r.client_id} wünscht sich einen Ernährungsplan (seit ${fmtDay(String(r.updated_at).slice(0, 10))})`);
    for (const s of q.swaps.all()) if (A.byId.get(s.client_id)) lines.push(`• K${s.client_id}: ${s.n} offene${s.n === 1 ? 'r Tauschwunsch' : ' Tauschwünsche'} im Ernährungsplan`);
    for (const c of A.byId.values()) if (c.deletion_requested_at) lines.push(`• K${c.id} möchte das Konto löschen lassen`);
    return lines.length ? lines.join('\n') : 'Nichts offen – alles erledigt.';
  }

  function attentionText(A, max = 8) {
    const r = attention.list(today(), Date.now());
    if (!r.clients.length) return `Allen ${r.total} aktiven Klienten geht es gut – niemand braucht gerade Aufmerksamkeit.`;
    const lines = r.clients.slice(0, max).map((c) => `• K${c.id} (${c.level === 'high' ? 'dringend' : c.level === 'medium' ? 'bald' : 'im Blick'}): ${c.reasons.map((x) => A.hide(x.text)).join('; ')}`);
    if (r.clients.length > max) lines.push(`… und ${r.clients.length - max} weitere`);
    if (r.archived) lines.push(`(${r.archived} pausiert, nicht berücksichtigt)`);
    return lines.join('\n');
  }

  function clientList(A) {
    return [...A.byId.values()].map((c) => {
      const pause = c.archived_at ? `, pausiert${c.archive_until ? ` bis ${c.archive_until}` : ''}` : '';
      return `• K${c.id}: ${c.category || 'ohne Kategorie'}, letzter Eintrag ${c.last_entry || 'nie'}${pause}`;
    }).join('\n') || 'Noch keine Klienten.';
  }

  function clientDetails(A, c) {
    const t = today();
    const rows = q.entries.all(c.id, addDays(t, -13));
    const week = (from, to) => rows.filter((e) => e.date >= from && e.date <= to);
    const stat = (list) => ({
      tage: list.length,
      gewicht: round(avg(list.filter((e) => e.weight !== null).map((e) => e.weight))),
      schritte: round(avg(list.filter((e) => e.steps !== null).map((e) => e.steps)), 0),
      schlafStd: round(avg(list.filter((e) => e.sleep !== null).map((e) => e.sleep))),
    });
    const ci = q.lastCheckin.get(c.id);
    return JSON.stringify({
      klient: `K${c.id}`,
      kategorie: c.category,
      pausiert: c.archived_at ? { bis: c.archive_until || null } : false,
      dieseWoche: stat(week(addDays(t, -6), t)),
      letzteWoche: stat(week(addDays(t, -13), addDays(t, -7))),
      ziele: q.goals.get(c.id) || null,
      letzterCheckin: ci ? { am: String(ci.created_at).slice(0, 10), status: ci.status } : null,
      letzteNachrichten: q.lastMessages.all(c.id).reverse().map((m) => `${m.from_client ? 'Klient' : 'Coach'}: ${A.hide(m.body).slice(0, 300)}`),
    });
  }

  // ---- actions (only after the coach confirms) ----
  function messageClient(coachId, clientId, body) {
    q.insertMessage.run(clientId, coachId, body);
    // no message text on the client's lock screen
    notifier.sendToUsers([clientId], { title: 'StayOnTrack', body: 'Du hast eine neue Nachricht von deinem Coach', url: '/#/chat' }).catch(() => {});
  }

  const pending = new Map(); // id -> { chatId, coachId, kind, clientId, text?, until?, note?, exp }
  function addPending(p) {
    for (const [k, v] of pending) if (v.exp < Date.now()) pending.delete(k);
    const id = crypto.randomBytes(6).toString('hex');
    pending.set(id, { ...p, exp: Date.now() + PENDING_TTL });
    return id;
  }
  const confirmKeyboard = (id, yes) => ({ reply_markup: { inline_keyboard: [[{ text: `✅ ${yes}`, callback_data: `ok:${id}` }, { text: '✖ Verwerfen', callback_data: `no:${id}` }]] } });

  async function propose(chatId, coach, A, name, input) {
    const c = A.resolve(input.klient);
    if (!c) return { error: `Unbekannter Klient „${input.klient}“. Nutze das Werkzeug klienten.` };
    const who = `<b>${escHtml(c.display_name)}</b>`;
    if (name === 'nachricht_senden') {
      const raw = String(input.text || '').trim();
      if (!raw) return { error: 'Leerer Text' };
      const first = String(c.display_name).split(/\s+/)[0];
      const text = A.show(raw.replace(/\{name\}/g, first)).slice(0, 2000);
      const id = addPending({ chatId, coachId: coach.user_id, kind: 'message', clientId: c.id, text });
      await send(chatId, `✉️ Nachricht an ${who}:\n\n${escHtml(text)}`, confirmKeyboard(id, 'Senden'));
    } else if (name === 'pausieren') {
      let until = null;
      if (input.bis) {
        const t = today();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(input.bis) || Number.isNaN(Date.parse(`${input.bis}T00:00:00Z`))) return { error: 'Datum bitte als YYYY-MM-DD' };
        if (input.bis <= t || input.bis > addDays(t, 366)) return { error: `Das Datum muss nach ${t} und höchstens ein Jahr entfernt liegen` };
        until = input.bis;
      }
      const note = input.notiz ? A.show(String(input.notiz)).slice(0, 200) : null;
      const id = addPending({ chatId, coachId: coach.user_id, kind: 'pause', clientId: c.id, until, note });
      await send(chatId, `⏸ ${who} pausieren${until ? ` bis ${fmtDay(until)}` : ' (ohne Enddatum)'}${note ? `\nNotiz: ${escHtml(note)}` : ''}`, confirmKeyboard(id, 'Pausieren'));
    } else if (name === 'reaktivieren') {
      if (!c.archived_at) return { error: `K${c.id} ist nicht pausiert` };
      const id = addPending({ chatId, coachId: coach.user_id, kind: 'unpause', clientId: c.id });
      await send(chatId, `▶️ ${who} wieder aktiv setzen?`, confirmKeyboard(id, 'Reaktivieren'));
    }
    return { ok: 'Der Entwurf wird dem Coach mit Bestätigungs-Button angezeigt. Nicht erneut aufrufen.' };
  }

  function runConfirmed(p) {
    const c = q.client.get(p.clientId);
    if (!c) return 'Diesen Klienten gibt es nicht mehr.';
    if (p.kind === 'message') {
      messageClient(p.coachId, c.id, p.text);
      return `✓ An ${escHtml(c.display_name)} gesendet:\n\n${escHtml(p.text)}`;
    }
    if (p.kind === 'pause') {
      q.archive.run(p.until, p.note, c.id);
      return `⏸ ${escHtml(c.display_name)} ist pausiert${p.until ? ` bis ${fmtDay(p.until)}` : ''}.`;
    }
    q.unarchive.run(c.id);
    return `▶️ ${escHtml(c.display_name)} ist wieder aktiv.`;
  }

  // ---- the assistant ----
  const convos = new Map(); // chatId -> { messages, at }
  const aiHits = new Map(); // chatId -> timestamps
  function aiAllowed(chatId) {
    const now = Date.now();
    const hits = (aiHits.get(chatId) || []).filter((t) => now - t < 3600000);
    if (hits.length >= AI_PER_HOUR) return false;
    hits.push(now);
    aiHits.set(chatId, hits);
    return true;
  }

  async function runTool(chatId, coach, A, block) {
    const input = block.input && typeof block.input === 'object' ? block.input : {};
    switch (block.name) {
      case 'brauchen_aufmerksamkeit': return attentionText(A, 15);
      case 'offene_anfragen': return openRequests(A);
      case 'klienten': return clientList(A);
      case 'klient_details': {
        const c = A.resolve(input.klient);
        return c ? clientDetails(A, c) : { error: `Unbekannter Klient „${input.klient}“` };
      }
      case 'nachricht_senden':
      case 'pausieren':
      case 'reaktivieren':
        return propose(chatId, coach, A, block.name, input);
      default: return { error: `Unbekanntes Werkzeug ${block.name}` };
    }
  }

  async function assistant(chatId, coach, text) {
    if (!aiEnabled()) {
      return send(chatId, 'Der KI-Assistent ist nicht eingerichtet (ANTHROPIC_API_KEY fehlt). Du kannst aber auf Klienten-Nachrichten antworten und /offen oder /heute nutzen.');
    }
    if (!aiAllowed(chatId)) return send(chatId, 'Kurze Pause – zu viele Anfragen in der letzten Stunde.');
    const A = aliases();
    let convo = convos.get(chatId);
    if (!convo || Date.now() - convo.at > CONVO_IDLE || convo.messages.length > CONVO_MAX) convo = { messages: [] };
    convo.at = Date.now();
    convos.set(chatId, convo);
    const { messages } = convo;
    messages.push({ role: 'user', content: `[Heute ist ${today()}]\n${A.hide(text)}` });
    tg('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
    let reply = '';
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        const r = await ai().messages.create({
          model, max_tokens: 4000, system: SYSTEM, tools: TOOLS, messages, output_config: { effort: 'low' },
        });
        messages.push({ role: 'assistant', content: r.content });
        if (r.stop_reason === 'refusal') {
          reply = 'Dabei kann ich leider nicht helfen.';
          break;
        }
        const uses = r.content.filter((b) => b.type === 'tool_use');
        const said = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
        if (r.stop_reason !== 'tool_use' || !uses.length) {
          reply = said;
          break;
        }
        const results = [];
        for (const b of uses) {
          let out;
          try {
            out = await runTool(chatId, coach, A, b);
          } catch (err) {
            out = { error: String(err.message).slice(0, 200) };
          }
          const isError = Boolean(out && typeof out === 'object' && out.error);
          results.push({ type: 'tool_result', tool_use_id: b.id, content: typeof out === 'string' ? out : JSON.stringify(out), ...(isError ? { is_error: true } : {}) });
        }
        messages.push({ role: 'user', content: results });
      }
    } catch (err) {
      log.error('Telegram-Assistent:', err.message);
      convos.delete(chatId);
      return send(chatId, err instanceof Anthropic.RateLimitError ? 'Der Assistent ist gerade ausgelastet – bitte gleich nochmal.' : 'Der Assistent ist gerade nicht erreichbar. Bitte später nochmal versuchen.');
    }
    if (reply) await sendPlain(chatId, A.show(reply));
    return null;
  }

  // ---- incoming updates ----
  async function onCallback(cb) {
    const chatId = String(cb.message && cb.message.chat ? cb.message.chat.id : '');
    const [kind, id] = String(cb.data || '').split(':');
    const p = pending.get(id);
    const link = q.byChat.get(chatId);
    let note = '';
    if (!link || link.role !== 'coach' || !p || p.chatId !== chatId || p.exp < Date.now()) {
      note = 'Abgelaufen – bitte nochmal fragen.';
      if (cb.message) await tg('editMessageReplyMarkup', { chat_id: chatId, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
    } else {
      pending.delete(id);
      const result = kind === 'ok' ? runConfirmed(p) : '✖ Verworfen.';
      note = kind === 'ok' ? 'Erledigt' : 'Verworfen';
      await tg('editMessageText', { chat_id: chatId, message_id: cb.message.message_id, text: result, parse_mode: 'HTML' }).catch(() => {});
    }
    await tg('answerCallbackQuery', { callback_query_id: cb.id, text: note }).catch(() => {});
  }

  async function handleUpdate(update) {
    if (!enabled || !update) return;
    if (update.callback_query) return onCallback(update.callback_query);
    const m = update.message;
    if (!m || typeof m.text !== 'string' || !m.chat || m.chat.type !== 'private') return;
    const chatId = String(m.chat.id);
    const text = m.text.trim();

    const start = text.match(/^\/start(?:\s+([A-Za-z0-9_-]{10,64}))?$/);
    if (start) {
      const c = start[1] && codes.get(start[1]);
      if (!c || c.exp < Date.now()) {
        const known = q.byChat.get(chatId);
        return send(chatId, known ? HELP.join('\n') : 'Hallo! Dieser Bot gehört zu StayOnTrack und ist nur für Coaches. Verbinde ihn in der App unter <b>Einstellungen → Telegram</b>.');
      }
      codes.delete(start[1]);
      q.dropChat.run(chatId);
      q.upsertLink.run(c.userId, chatId, [m.from && m.from.first_name, m.from && m.from.username ? `@${m.from.username}` : null].filter(Boolean).join(' ') || null);
      return send(chatId, `✅ <b>Verbunden!</b>\n\n${HELP.slice(1).join('\n')}${aiEnabled() ? '\n\n💬 Oder schreib einfach, was du brauchst – z. B. „Wer braucht heute Aufmerksamkeit?“ oder „Schreib Max, dass sein Plan Freitag kommt“. Bevor etwas passiert, fragt der Assistent nach.' : ''}`);
    }

    const coach = q.byChat.get(chatId);
    if (!coach || coach.role !== 'coach') {
      return send(chatId, 'Dieser Bot gehört zu StayOnTrack und ist nur für Coaches. Verbinde ihn in der App unter <b>Einstellungen → Telegram</b>.');
    }
    if (/^\/(hilfe|help)\b/i.test(text)) return send(chatId, HELP.join('\n'));
    if (/^\/offen\b/i.test(text)) {
      const A = aliases();
      return send(chatId, `<b>Wartet auf dich</b>\n${escHtml(A.show(openRequests(A)))}`, openButton('/#/messages'));
    }
    if (/^\/heute\b/i.test(text)) {
      const A = aliases();
      return send(chatId, `<b>Braucht Aufmerksamkeit</b>\n${escHtml(A.show(attentionText(A)))}`, openButton('/#/'));
    }
    if (/^\/neu\b/i.test(text)) {
      convos.delete(chatId);
      return send(chatId, 'Neues Gespräch – was kann ich tun?');
    }
    if (/^\/trennen\b/i.test(text)) {
      q.unlink.run(coach.user_id);
      return send(chatId, 'Getrennt. Du bekommst hier keine Benachrichtigungen mehr. Neu verbinden kannst du in der App.');
    }

    // a reply to a notification about a client goes straight to that client
    const replyTo = m.reply_to_message && q.ref.get(chatId, m.reply_to_message.message_id);
    if (replyTo) {
      const c = q.client.get(replyTo.client_id);
      if (!c) return send(chatId, 'Diesen Klienten gibt es nicht mehr.');
      messageClient(coach.user_id, c.id, text.slice(0, 2000));
      return send(chatId, `✓ An ${escHtml(c.display_name)} gesendet.`);
    }
    if (text.startsWith('/')) return send(chatId, HELP.join('\n'));
    return assistant(chatId, coach, text);
  }

  // ---- notifications for the coach → Telegram ----
  const clientOf = (url) => {
    const m = String(url || '').match(/#\/(?:messages|client)\/(\d+)/);
    return m ? Number(m[1]) : null;
  };
  async function forward(userIds, payload) {
    if (!enabled) return;
    for (const id of userIds) {
      const link = q.link.get(id);
      if (!link) continue;
      const clientId = clientOf(payload.url);
      const isChat = /#\/messages\/\d+|\/chat$/.test(String(payload.url || ''));
      const hint = clientId && isChat ? '\n\n<i>↩️ Antworte auf diese Nachricht, um direkt zu schreiben.</i>' : '';
      try {
        const sent = await send(link.chat_id, `<b>${escHtml(payload.title)}</b>\n${escHtml(payload.body)}${hint}`, openButton(payload.url));
        if (clientId && q.client.get(clientId)) q.addRef.run(link.chat_id, sent.message_id, clientId);
      } catch (err) {
        log.error('Telegram-Weiterleitung:', err.message);
      }
    }
  }
  notifier.onSend(forward);

  // ---- receiving: webhook with an https APP_URL, otherwise long polling ----
  let polling = false;
  async function poll() {
    let offset = 0;
    while (polling) {
      try {
        const updates = await tg('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] });
        for (const u of updates) {
          offset = u.update_id + 1;
          await handleUpdate(u).catch((err) => log.error('Telegram:', err.message));
        }
      } catch (err) {
        log.error('Telegram-Abruf:', err.message);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  async function start() {
    if (!enabled) return;
    try {
      await botUsername();
      await tg('setMyCommands', { commands: [
        { command: 'offen', description: 'Was gerade auf dich wartet' },
        { command: 'heute', description: 'Wer braucht Aufmerksamkeit' },
        { command: 'neu', description: 'Neues Gespräch mit dem Assistenten' },
        { command: 'hilfe', description: 'Was der Bot kann' },
        { command: 'trennen', description: 'Telegram vom Konto lösen' },
      ] }).catch(() => {});
      if (base.startsWith('https://')) {
        await tg('setWebhook', { url: `${base}/api/telegram/webhook`, secret_token: secret, allowed_updates: ['message', 'callback_query'] });
        log.log(`Telegram aktiv (@${botName}, Webhook)`);
      } else {
        await tg('deleteWebhook', {});
        polling = true;
        poll();
        log.log(`Telegram aktiv (@${botName}, Abruf)`);
      }
      setInterval(() => q.pruneRefs.run(), 24 * 3600000).unref();
    } catch (err) {
      log.error('Telegram konnte nicht starten:', err.message);
    }
  }
  const stop = () => {
    polling = false;
  };

  // ---- routes ----
  function routes({ HttpError, readBody, requireCoach }) {
    return [
      ['GET', /^\/api\/telegram$/, async (ctx) => {
        const u = requireCoach(ctx);
        const l = q.link.get(u.id);
        return { enabled, ai: aiEnabled(), bot: botName, linked: l ? { name: l.tg_name, linkedAt: l.linked_at } : null };
      }],
      ['POST', /^\/api\/telegram\/link$/, async (ctx) => {
        const u = requireCoach(ctx);
        if (!enabled) throw new HttpError(400, 'Telegram ist nicht eingerichtet (TELEGRAM_BOT_TOKEN fehlt)');
        const name = await botUsername();
        const code = newLinkCode(u.id);
        return { url: `https://t.me/${name}?start=${code}`, bot: name, expiresInMinutes: LINK_TTL / 60000 };
      }],
      ['POST', /^\/api\/telegram\/test$/, async (ctx) => {
        const u = requireCoach(ctx);
        const l = q.link.get(u.id);
        if (!l) throw new HttpError(400, 'Telegram ist nicht verbunden');
        await send(l.chat_id, '👋 <b>Test</b>\nSo kommen deine Benachrichtigungen hier an.');
        return { ok: true };
      }],
      ['DELETE', /^\/api\/telegram$/, async (ctx) => {
        const u = requireCoach(ctx);
        const l = q.link.get(u.id);
        q.unlink.run(u.id);
        if (l && enabled) send(l.chat_id, 'Getrennt. Du bekommst hier keine Benachrichtigungen mehr.').catch(() => {});
        return { ok: true };
      }],
      // Telegram → us. Checked with the secret token we gave Telegram when setting the webhook.
      ['POST', /^\/api\/telegram\/webhook$/, async (ctx) => {
        const got = Buffer.from(String(ctx.req.headers['x-telegram-bot-api-secret-token'] || ''));
        const want = Buffer.from(secret);
        if (!enabled || got.length !== want.length || !crypto.timingSafeEqual(got, want)) throw new HttpError(401, 'Nicht erlaubt');
        const update = await readBody(ctx.req);
        handleUpdate(update).catch((err) => log.error('Telegram:', err.message));
        return { ok: true };
      }],
    ];
  }

  return { enabled, start, stop, routes, handleUpdate, forward, secret };
}

module.exports = { createTelegram, TOOLS, SYSTEM };
