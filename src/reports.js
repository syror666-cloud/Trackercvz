'use strict';

/**
 * PDF reports and mailing them:
 *  - GET  /api/nutrition/pdf          the nutrition plan as PDF (client: own, coach: ?userId=)
 *  - POST /api/nutrition/pdf/mail     coach sends the plan PDF to the client by e-mail
 *  - GET  /api/checkins/:id/pdf       a weekly check-in as PDF
 * Automatic mails (only to a confirmed address and only if the client hasn't switched report mails off):
 *  - when the coach sends a check-in: mail with key figures + check-in PDF
 *  - when a plan is created from an AI draft: mail with the plan PDF
 */

const { nutritionPlanPdf, checkinPdf } = require('./pdf');
const { renderMail } = require('./mail');
const { weekComparison, weekHighlights } = require('./weekstats');

const nf = (v, d = 0) => Number(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const fileSafe = (s) => String(s).normalize('NFKD').replace(/ß/g, 'ss').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'Klient';
const fmtSleep = (h) => {
  const t = Math.round(h * 60);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')} h`;
};

function reportRoutes({ db, HttpError, readBody, requireUser, requireCoach, targetClient, localDate, notifier, mailer, appUrl, planOf, describeProposal, goalsRow, prefsOf, log = console }) {
  const base = appUrl ? appUrl.replace(/\/+$/, '') : '';
  const q = {
    user: db.prepare('SELECT * FROM users WHERE id = ?'),
    goals: db.prepare('SELECT * FROM goals WHERE user_id = ?'),
    entries: db.prepare('SELECT * FROM entries WHERE user_id = ? ORDER BY date'),
    checkin: db.prepare('SELECT * FROM checkins WHERE id = ?'),
    anyCoach: db.prepare("SELECT display_name FROM users WHERE role = 'coach' ORDER BY id LIMIT 1"),
  };
  const today = () => localDate(Date.now(), notifier.timezone);
  const coachName = (id) => {
    const c = id ? q.user.get(id) : null;
    return (c && c.display_name) || (q.anyCoach.get() || {}).display_name || null;
  };
  const firstName = (u) => String(u.display_name || '').trim().split(/\s+/)[0] || u.username;

  /** Why a client would (not) get report mails – also shown to the coach. */
  function mailStatus(client) {
    if (!mailer || !mailer.enabled || !base) return 'disabled';
    if (!client.email) return 'no-email';
    if (!client.email_verified) return 'unverified';
    if (prefsOf(client).mailReports === false) return 'off';
    return 'ok';
  }
  const STATUS_TEXT = {
    disabled: 'E-Mail-Versand ist nicht eingerichtet.',
    'no-email': 'Für diesen Klienten ist keine E-Mail-Adresse hinterlegt.',
    unverified: 'Die E-Mail-Adresse des Klienten ist noch nicht bestätigt.',
    off: 'Der Klient hat Berichte per E-Mail abbestellt.',
  };

  // ---- PDFs ----
  function planPdf(client) {
    return nutritionPlanPdf({
      client: { displayName: client.display_name },
      coachName: coachName(null),
      date: today(),
      plan: planOf(client.id),
      goals: goalsRow(q.goals.get(client.id)),
    });
  }

  function weightDirection(client, goals) {
    const tw = goals && goals.target_weight;
    if (tw !== null && tw !== undefined) {
      const last = [...q.entries.all(client.id)].reverse().find((e) => e.weight !== null);
      if (last) return Math.sign(tw - last.weight);
    }
    return client.category === 'diet' ? -1 : client.category === 'build' ? 1 : 0;
  }

  function checkinData(ci) {
    const client = q.user.get(ci.client_id);
    const goalsRaw = q.goals.get(client.id);
    const day = localDate(Date.parse(ci.created_at), notifier.timezone);
    const comparison = weekComparison(q.entries.all(client.id), day, goalsRaw);
    let highlights = [];
    try {
      highlights = JSON.parse(ci.highlights || '[]');
    } catch {
      highlights = [];
    }
    if (!highlights.length) highlights = weekHighlights(comparison, goalsRaw, client.category);
    let changes = [];
    try {
      changes = describeProposal(JSON.parse(ci.previous || '{}'), JSON.parse(ci.proposal || '{}'));
    } catch {
      changes = [];
    }
    return { client, goalsRaw, comparison, highlights, changes };
  }

  function checkinPdfOf(ci) {
    const { client, goalsRaw, comparison, highlights, changes } = checkinData(ci);
    return checkinPdf({
      client: { displayName: client.display_name },
      coachName: coachName(ci.coach_id),
      createdAt: ci.created_at,
      message: ci.message,
      comparison,
      goals: goalsRow(goalsRaw),
      highlights,
      changes,
      weightDirection: weightDirection(client, goalsRaw),
    });
  }

  function sendPdf(ctx, buf, filename) {
    ctx.res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Length': buf.length,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    });
    ctx.res.end(buf);
  }

  // ---- mails ----
  async function mailPlan(client) {
    const pdf = await planPdf(client);
    const plan = planOf(client.id);
    const { text, html } = renderMail({
      appUrl: base,
      eyebrow: 'Ernährung',
      title: 'Dein Ernährungsplan',
      preheader: `${nf(plan.totalKcal)} kcal am Tag – dein Plan als PDF.`,
      paragraphs: [
        `Hallo ${firstName(client)},`,
        'dein Coach hat dir deinen Ernährungsplan zusammengestellt. Du findest ihn als PDF im Anhang – zum Ausdrucken oder für unterwegs. In der App siehst du ihn immer aktuell.',
      ],
      stats: [
        { label: 'Kalorien', value: `${nf(plan.totalKcal)}` },
        { label: 'Eiweiß', value: `${nf(plan.macros.protein)} g` },
        { label: 'Kohlenh.', value: `${nf(plan.macros.carbs)} g` },
        { label: 'Fett', value: `${nf(plan.macros.fat)} g` },
      ],
      button: { label: 'Plan in der App öffnen', link: `${base}/#/nutrition` },
      note: 'Diese Mail bekommst du, weil dein Coach dir deinen Plan geschickt hat. Berichte per E-Mail kannst du in der App unter Einstellungen abbestellen.',
    });
    await mailer.send({
      to: client.email, subject: 'Dein Ernährungsplan', text, html,
      attachments: [{ filename: `Ernaehrungsplan-${fileSafe(client.display_name)}.pdf`, content: pdf, contentType: 'application/pdf' }],
    });
  }

  async function mailCheckin(ci) {
    const { client, comparison } = checkinData(ci);
    const pdf = await checkinPdfOf(ci);
    const cur = comparison.current;
    const dl = comparison.delta;
    const dir = weightDirection(client, q.goals.get(client.id));
    const stats = [];
    if (cur.weightAvg !== null) {
      stats.push({
        label: 'Gewicht Ø', value: `${nf(cur.weightAvg, 1)} kg`,
        delta: dl.weightAvg === null ? null : `${dl.weightAvg > 0 ? '+' : dl.weightAvg < 0 ? '−' : '±'}${nf(Math.abs(dl.weightAvg), 1)} kg`,
        good: dl.weightAvg === null || !dir || dl.weightAvg === 0 ? undefined : Math.sign(dl.weightAvg) === dir,
      });
    }
    if (cur.stepsAvg !== null) {
      stats.push({ label: 'Schritte Ø', value: nf(cur.stepsAvg), delta: dl.stepsAvg === null ? null : `${dl.stepsAvg >= 0 ? '+' : '−'}${nf(Math.abs(dl.stepsAvg))}`, good: dl.stepsAvg ? dl.stepsAvg > 0 : undefined });
    }
    if (cur.sleepAvg !== null) {
      stats.push({ label: 'Schlaf Ø', value: fmtSleep(cur.sleepAvg), delta: dl.sleepAvg === null ? null : `${dl.sleepAvg >= 0 ? '+' : '−'}${fmtSleep(Math.abs(dl.sleepAvg))}`, good: dl.sleepAvg ? dl.sleepAvg > 0 : undefined });
    }
    if (stats.length < 3) stats.push({ label: 'Tage eingetragen', value: `${cur.daysLogged} / 7` });
    const span = `${new Date(`${cur.from}T12:00:00Z`).toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric', timeZone: 'UTC' })} – ${new Date(`${cur.to}T12:00:00Z`).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', timeZone: 'UTC' })}`;
    const { text, html } = renderMail({
      appUrl: base,
      eyebrow: `Check-in · ${span}`,
      title: 'Dein Wochen-Check-in',
      preheader: 'Deine Woche im Überblick – mit Kommentar von deinem Coach.',
      paragraphs: [
        `Hallo ${firstName(client)},`,
        'dein Coach hat sich deine Woche angeschaut. Hier die wichtigsten Zahlen im Vergleich zur Vorwoche – den ausführlichen Bericht mit Kommentar, Verlauf und allen Tagen findest du als PDF im Anhang.',
      ],
      stats: stats.slice(0, 3),
      button: { label: 'Check-in in der App öffnen', link: `${base}/#/` },
      note: 'Diese Mail bekommst du, weil dein Coach deinen Check-in abgeschlossen hat. Berichte per E-Mail kannst du in der App unter Einstellungen abbestellen.',
    });
    await mailer.send({
      to: client.email, subject: 'Dein Wochen-Check-in ist da', text, html,
      attachments: [{ filename: `Check-in-${fileSafe(client.display_name)}-${cur.to}.pdf`, content: pdf, contentType: 'application/pdf' }],
    });
  }

  /** Fire-and-forget for automatic mails: errors only end up in the log. */
  function later(fn, what) {
    setImmediate(() => fn().catch((err) => log.error(`${what} konnte nicht per E-Mail gesendet werden:`, err.message)));
  }

  const api = {
    mailStatus,
    autoCheckinMail(checkinId) {
      const ci = q.checkin.get(checkinId);
      if (!ci) return 'missing';
      const st = mailStatus(q.user.get(ci.client_id));
      if (st === 'ok') later(() => mailCheckin(ci), 'Check-in');
      return st;
    },
    autoPlanMail(clientId) {
      const client = q.user.get(clientId);
      const st = mailStatus(client);
      if (st === 'ok') later(() => mailPlan(client), 'Ernährungsplan');
      return st;
    },
  };

  api.routes = [
    ['GET', /^\/api\/nutrition\/pdf$/, async (ctx) => {
      const c = targetClient(ctx);
      const client = q.user.get(c.id);
      sendPdf(ctx, await planPdf(client), `Ernaehrungsplan-${fileSafe(client.display_name)}.pdf`);
      return undefined;
    }],

    ['POST', /^\/api\/nutrition\/pdf\/mail$/, async (ctx) => {
      requireCoach(ctx);
      await readBody(ctx.req).catch(() => ({}));
      const client = q.user.get(targetClient(ctx).id);
      const st = mailStatus(client);
      if (st !== 'ok') throw new HttpError(409, STATUS_TEXT[st]);
      if (!planOf(client.id).meals.length) throw new HttpError(409, 'Der Plan ist noch leer.');
      try {
        await mailPlan(client);
      } catch (err) {
        throw new HttpError(502, `E-Mail konnte nicht gesendet werden: ${String(err.message).slice(0, 200)}`);
      }
      return { ok: true, to: client.email };
    }],

    ['GET', /^\/api\/checkins\/(\d+)\/pdf$/, async (ctx, [, id]) => {
      const u = requireUser(ctx);
      const ci = q.checkin.get(Number(id));
      if (!ci || (u.role !== 'coach' && ci.client_id !== u.id)) throw new HttpError(404, 'Check-in nicht gefunden');
      const client = q.user.get(ci.client_id);
      sendPdf(ctx, await checkinPdfOf(ci), `Check-in-${fileSafe(client.display_name)}-${ci.created_at.slice(0, 10)}.pdf`);
      return undefined;
    }],

    // coach: may this client get report mails? (shown next to the buttons)
    ['GET', /^\/api\/reports\/status$/, async (ctx) => {
      requireCoach(ctx);
      const st = mailStatus(q.user.get(targetClient(ctx).id));
      return { status: st, text: st === 'ok' ? null : STATUS_TEXT[st] };
    }],
  ];
  return api;
}

module.exports = { reportRoutes };
