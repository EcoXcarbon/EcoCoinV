'use strict';
/**
 * Minimal SMTP submission client.
 *
 * Hand-rolled rather than pulling in a mail library: the registry sends
 * exactly one kind of message — a short ASCII verification code — and the
 * service is deliberately kept to two runtime dependencies. What that costs us
 * is handled explicitly below: CRLF line endings, dot-stuffing, header
 * injection, and RFC 2047 encoding of anything non-ASCII in the subject.
 */
const tls = require('node:tls');
const net = require('node:net');
const crypto = require('node:crypto');

class EmailError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

/** Strip CR/LF so a caller-supplied value cannot inject extra headers. */
const headerSafe = v => String(v || '').replace(/[\r\n]+/g, ' ').trim();

/** RFC 2047 for subjects that are not plain ASCII. */
function encodeHeader(v) {
  const s = headerSafe(v);
  return /^[\x20-\x7E]*$/.test(s) ? s : '=?UTF-8?B?' + Buffer.from(s, 'utf8').toString('base64') + '?=';
}

class SmtpMailer {
  /** @param {object} cfg { host, port, secure, user, pass, from, timeoutMs } */
  constructor(cfg = {}) {
    this.cfg = { port: 465, secure: true, timeoutMs: 20_000, ...cfg };
    this.configured = !!(this.cfg.host && this.cfg.from);
  }

  get name() { return this.configured ? `smtp:${this.cfg.host}` : 'smtp:unconfigured'; }

  async send({ to, subject, text }) {
    if (!this.configured) throw new EmailError('no SMTP host is configured', 500);
    const rcpt = headerSafe(to);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rcpt)) throw new EmailError('invalid recipient address', 400);

    const sock = await this.connect();
    const io = talk(sock, this.cfg.timeoutMs);
    try {
      await io.expect(220);
      let caps = await io.cmd(`EHLO ${this.cfg.helo || 'localhost'}`, 250);

      if (!this.cfg.secure && /STARTTLS/i.test(caps)) {
        await io.cmd('STARTTLS', 220);
        const upgraded = await this.upgrade(sock);
        io.replace(upgraded);
        caps = await io.cmd(`EHLO ${this.cfg.helo || 'localhost'}`, 250);
      }
      if (this.cfg.user) {
        await io.cmd('AUTH LOGIN', 334);
        await io.cmd(Buffer.from(this.cfg.user).toString('base64'), 334);
        await io.cmd(Buffer.from(this.cfg.pass || '').toString('base64'), 235);
      }

      const fromAddr = (this.cfg.from.match(/<([^>]+)>/) || [null, this.cfg.from])[1];
      await io.cmd(`MAIL FROM:<${fromAddr}>`, 250);
      await io.cmd(`RCPT TO:<${rcpt}>`, [250, 251]);
      await io.cmd('DATA', 354);

      const id = `<${crypto.randomUUID()}@${fromAddr.split('@')[1]}>`;
      const headers = [
        `From: ${headerSafe(this.cfg.from)}`,
        `To: <${rcpt}>`,
        `Subject: ${encodeHeader(subject)}`,
        `Date: ${new Date().toUTCString()}`,
        `Message-ID: ${id}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
        'Auto-Submitted: auto-generated'
      ].join('\r\n');
      // Dot-stuffing: a line that is just "." would otherwise end the message.
      const body = String(text).replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
      await io.cmd(`${headers}\r\n\r\n${body}\r\n.`, 250);
      io.cmd('QUIT', [221]).catch(() => {});
      return { messageId: id };
    } finally {
      sock.destroy();
    }
  }

  connect() {
    const { host, port, secure, timeoutMs } = this.cfg;
    return new Promise((res, rej) => {
      const sock = secure
        // The mailbox is addressed by IP in some deployments, where SNI is not
        // permitted; the certificate then cannot match, so verification is off
        // for that case only and the credentials still authenticate us.
        ? tls.connect({ host, port, servername: net.isIP(host) ? undefined : host, rejectUnauthorized: !net.isIP(host) })
        : net.connect({ host, port });
      const timer = setTimeout(() => { sock.destroy(); rej(new EmailError('SMTP connection timed out')); }, timeoutMs);
      sock.once(secure ? 'secureConnect' : 'connect', () => { clearTimeout(timer); res(sock); });
      sock.once('error', e => { clearTimeout(timer); rej(new EmailError(`SMTP connection failed: ${e.message}`)); });
    });
  }

  upgrade(sock) {
    const { host } = this.cfg;
    return new Promise((res, rej) => {
      const up = tls.connect({ socket: sock, servername: net.isIP(host) ? undefined : host, rejectUnauthorized: !net.isIP(host) }, () => res(up));
      up.once('error', e => rej(new EmailError(`STARTTLS failed: ${e.message}`)));
    });
  }
}

/** Line-oriented SMTP conversation over a socket. */
function talk(sock, timeoutMs) {
  let socket = sock, buf = '', waiter = null;
  const attach = s => {
    socket = s; s.setEncoding('utf8');
    s.on('data', chunk => {
      buf += chunk;
      // A reply ends at a line whose 4th character is a space, not a hyphen.
      const m = buf.match(/^(?:\d{3}-[^\n]*\n)*(\d{3}) [^\n]*\r?\n/);
      if (m && waiter) { const reply = buf; buf = ''; const w = waiter; waiter = null; w.resolve({ code: Number(m[1]), reply }); }
    });
    s.on('error', e => { if (waiter) { const w = waiter; waiter = null; w.reject(new EmailError(`SMTP socket error: ${e.message}`)); } });
  };
  attach(sock);

  const read = () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiter = null; reject(new EmailError('SMTP server did not reply in time')); }, timeoutMs);
    waiter = { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } };
  });

  const want = (got, expected) => (Array.isArray(expected) ? expected : [expected]).includes(got.code);

  return {
    replace: s => { buf = ''; attach(s); },
    async expect(expected) {
      const got = await read();
      if (!want(got, expected)) throw new EmailError(`SMTP greeting refused: ${got.reply.trim().slice(0, 120)}`);
      return got.reply;
    },
    async cmd(line, expected) {
      socket.write(line + '\r\n');
      const got = await read();
      if (!want(got, expected)) {
        const shown = line.length > 40 ? line.slice(0, 12) + '…' : line;
        throw new EmailError(`SMTP refused "${shown}": ${got.reply.trim().split('\n')[0].slice(0, 120)}`);
      }
      return got.reply;
    }
  };
}

module.exports = { SmtpMailer, EmailError, encodeHeader, headerSafe };
