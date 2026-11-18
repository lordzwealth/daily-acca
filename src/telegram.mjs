// Formats and sends the daily message to Telegram.
import { CONFIG } from './config.mjs';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pct = (p) => `${Math.round(p * 100)}%`;
const time = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: CONFIG.timezone });
const dayLabel = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const icon = { won: '✅', lost: '❌', void: '↩️', pending: '⏳' };

export function formatMessage({ date, slips, yesterday, stats, dashboardUrl, notice }) {
  const lines = [`⚽ <b>Daily Acca — ${dayLabel(date)}</b>`];

  if (yesterday?.slips?.[0]) {
    const y = yesterday.slips[0];
    const res = y.result === 'won' ? `WON ${icon.won} @${y.paidOdds}` : y.result === 'lost' ? `LOST ${icon.lost}` : y.result.toUpperCase();
    lines.push(`Yesterday: <b>${res}</b>  ${y.legs.map((l) => icon[l.result || 'pending']).join('')}`);
  }
  if (stats?.settled) {
    lines.push(`Record: ${stats.won}/${stats.settled} (${pct(stats.hitRate)}) · ${stats.profitUnits >= 0 ? '+' : ''}${stats.profitUnits}u at 1 unit/slip`);
  }
  lines.push('');

  if (!slips.length) {
    lines.push(notice || 'No slip today — not enough legs passed the safety filters. Skipping is part of the strategy.');
  }

  slips.forEach((s, si) => {
    lines.push(si === 0 ? '<b>🎯 Main slip</b>' : '<b>🔁 Backup slip</b> (different games)');
    s.legs.forEach((l, i) => {
      const c = l.ctx;
      lines.push(`${i + 1}. <b>${esc(c.match)}</b> · ${esc(c.league)} · ${time(c.kickoff)}`);
      lines.push(`   👉 ${esc(l.label)} @<b>${l.odd.toFixed(2)}</b> — chance ${pct(l.p)}${l.note ? ` (${l.note})` : ''}`);
      if (si === 0) lines.push(`   <i>${esc(c.why.join(' · '))}</i>`);
    });
    lines.push(`Total odds <b>${s.totalOdds.toFixed(2)}</b> · combined chance <b>~${pct(s.prob)}</b>`);
    lines.push('');
  });

  if (notice && slips.length) lines.push(`ℹ️ ${esc(notice)}`);
  if (dashboardUrl) lines.push(`📊 <a href="${dashboardUrl}">Full breakdown & history</a>`);
  lines.push('<i>Probabilities are estimates, not guarantees. Stake only what you can afford to lose.</i>');
  return lines.join('\n');
}

export async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) {
    console.log('[telegram] not configured — message below\n' + text);
    return false;
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  if (!res.ok) console.error('[telegram] failed', res.status, await res.text());
  return res.ok;
}
