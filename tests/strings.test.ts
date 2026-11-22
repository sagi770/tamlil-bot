import { getStrings } from '../src/strings/index.js';

const he = getStrings('he');
const en = getStrings('en');

describe('strings', () => {
  // Steps 2-3 deviate from spec 5.4 (see docs/DECISIONS.md): a variable added only in Vercel is
  // removed by the next `npm run setup`, so the lock goes into .env.local.
  it('pins the Hebrew open warning', () => {
    expect(he.openWarning(123456789)).toBe(
      '⚠️ הבוט הזה פתוח לכולם\n' +
        'כל מי שמוצא אותו יכול לתמלל על חשבונך.\n\n' +
        'מומלץ מאוד לנעול אותו אליך:\n' +
        '1. ה-ID שלך בטלגרם: 123456789\n' +
        '2. הוסף לקובץ ‎.env.local את השורה: ALLOWED_USER_IDS=123456789\n' +
        '3. הרץ: npm run setup\n\n' +
        'או בקש מ-Claude Code: "תנעל את הבוט ל-ID 123456789"',
    );
  });

  it('pins the English open warning', () => {
    expect(en.openWarning(123456789)).toBe(
      '⚠️ This bot is open to everyone\n' +
        'Anyone who finds it can transcribe at your expense.\n\n' +
        'We strongly recommend locking it to you:\n' +
        '1. Your Telegram ID: 123456789\n' +
        '2. Add this line to the .env.local file: ALLOWED_USER_IDS=123456789\n' +
        '3. Run: npm run setup\n\n' +
        'Or ask Claude Code: "Lock the bot to ID 123456789"',
    );
  });

  it('never tells the owner to change Vercel by hand in the open warning', () => {
    for (const s of [he, en]) expect(s.openWarning(1)).not.toMatch(/Vercel|Redeploy/);
  });

  it('pins the labels the formatter depends on', () => {
    expect(he.speaker('1')).toBe('דובר 1');
    expect(he.speakersCount(2)).toBe('2 דוברים');
    expect(he.summarizeButton).toBe('📋 סכם');
    expect(he.summaryHeader).toBe('📋 סיכום');
    expect(he.transcribing).toBe('⏳ מתמלל…');
    expect(he.transcriptFileName(new Date(Date.UTC(2026, 10, 21, 21, 48)), 'Asia/Jerusalem')).toBe('תמליל 2026-11-21 23-48.txt');
    expect(he.transcriptFileName(new Date(Date.UTC(2026, 10, 21, 21, 48)), 'UTC')).toBe('תמליל 2026-11-21 21-48.txt');
    expect(en.speaker('1')).toBe('Speaker 1');
    expect(en.speakersCount(2)).toBe('2 speakers');
  });

  it('shows the user id in the refusal and the id reply', () => {
    expect(he.notAllowed(42)).toContain('42');
    expect(he.yourId(42)).toContain('42');
    expect(en.notAllowed(42)).toContain('42');
    expect(en.yourId(42)).toContain('42');
  });

  it('mentions summary in help only when it exists', () => {
    expect(he.help(false)).not.toMatch(/סיכום|סכם/);
    expect(he.help(true)).toContain('סיכום');
    expect(en.help(false).toLowerCase()).not.toContain('summar');
    expect(en.help(true).toLowerCase()).toContain('summar');
  });

  it('never mentions summary in the static welcome', () => {
    expect(he.welcome).not.toMatch(/סיכום|סכם/);
    expect(en.welcome.toLowerCase()).not.toContain('summar');
  });

  it('uses no Markdown markers', () => {
    for (const s of [he, en]) {
      for (const v of Object.values(s)) {
        if (typeof v === 'string') expect(v).not.toMatch(/\*\*|__|`/);
      }
      for (const v of Object.values(s.commands)) expect(v).not.toMatch(/\*\*|__|`/);
      const sampled = [
        s.yourId(1),
        s.notAllowed(1),
        s.openWarning(1),
        s.speaker('1'),
        s.speakersCount(2),
        s.transcriptFileName(new Date(2026, 0, 1), 'UTC'),
        ...(['invalid-url', 'not-https', 'blocked-host', 'drive-folder', 'youtube-unsupported'] as const).map((r) =>
          s.linkRejected(r),
        ),
      ];
      for (const v of sampled) expect(v).not.toMatch(/\*\*|__|`/);
      expect(s.help(true)).not.toMatch(/\*\*|__|`/);
      expect(s.help(false)).not.toMatch(/\*\*|__|`/);
    }
  });

  it('covers every link rejection reason', () => {
    for (const r of ['invalid-url', 'not-https', 'blocked-host', 'drive-folder', 'youtube-unsupported'] as const) {
      expect(he.linkRejected(r).length).toBeGreaterThan(0);
      expect(en.linkRejected(r).length).toBeGreaterThan(0);
    }
  });

  it('pins the YouTube rejection wording', () => {
    expect(he.linkRejected('youtube-unsupported')).toBe(
      'אני לא יכול לתמלל קישורים מ-YouTube. אם הסרטון שלך, שלח את הקובץ עצמו או קישור שיתוף אליו מ-Google Drive או Dropbox.',
    );
    expect(en.linkRejected('youtube-unsupported')).toBe(
      "I can't transcribe YouTube links. If the video is yours, send the file itself or a Google Drive or Dropbox share link to it.",
    );
  });

  it('uses the agreed Hebrew copy', () => {
    const hint = 'בהגדרות השיתוף צריך לבחור "כל מי שיש לו את הקישור".';
    expect(he.messageTooOld).toBe('ההודעה ישנה מדי, ואין לי גישה לתוכן שלה. שלח את ההקלטה שוב.');
    for (const v of [he.help(false), he.tooLarge, he.linkNotMedia, he.linkJobFailed]) expect(v).toContain(hint);
    expect(he.summaryFailed).toBe('לא הצלחתי לסכם. התמליל לא נפגע, ואפשר לנסות שוב עם הכפתור "📋 סכם".');
    expect(he.linkRejected('not-https')).toContain('שלח קישור שיתוף מ-Google Drive או Dropbox.');
    expect(he.noSpeech).toContain('אם יש בה דיבור, נסה לשלוח אותה שוב.');
    expect(he.linkFetchFailed).toBe('לא הצלחתי לפתוח את הקישור. בדוק שבהגדרות השיתוף נבחר "כל מי שיש לו את הקישור", ונסה שוב.');
    expect(he.linkJobFailed).toContain('לתמלל את הקובץ שבקישור');
    expect(he.linkJobFailed).toContain('כנראה שהקישור לא מוביל');
    expect(he.linkNotMedia).toContain('לא מוביל');
    expect(he.unsupported).toContain('הודעות קוליות וקבצי אודיו ווידאו');
    expect(he.help(true)).toContain('אפשר גם לכתוב "סיכום" בכיתוב כששולחים את ההקלטה, ואז יגיע גם סיכום.');
    expect(he.tooLarge).toContain('במקום זאת');
    expect(he.tooLarge).not.toContain('במקום זה');
  });

  it('uses the agreed English copy', () => {
    expect(en.summaryFailed).toBe(
      'I couldn\'t summarize. The transcript is safe, and you can try again with the "📋 Summarize" button.',
    );
    expect(en.summaryFailed).toContain(`"${en.summarizeButton}"`);
    expect(en.unsupported).toBe('I can transcribe voice messages and audio or video files. Send one of those, or a link to a file.');
    expect(en.help(true)).toContain(
      'You can also write "summary" as the caption when you send the recording, and you\'ll get a summary as well.',
    );
  });

  it('formats the English file name and exposes command descriptions', () => {
    expect(en.transcriptFileName(new Date(Date.UTC(2026, 0, 5, 9, 7)), 'UTC')).toBe('Transcript 2026-01-05 09-07.txt');
    for (const s of [he, en]) {
      expect(s.commands.start.length).toBeGreaterThan(0);
      expect(s.commands.help.length).toBeGreaterThan(0);
      expect(s.commands.id.length).toBeGreaterThan(0);
    }
  });
});
