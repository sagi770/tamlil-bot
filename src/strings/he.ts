import type { Strings } from './index.js';
import { stamp } from './stamp.js';

const shareHint = 'בהגדרות השיתוף צריך לבחור "כל מי שיש לו את הקישור".';

export const he: Strings = {
  welcome:
    'שלום! אני בוט תמלול.\n' +
    'שלח לי הודעה קולית, קובץ אודיו או וידאו, ואחזיר לך תמליל מחולק לפי דוברים.\n\n' +
    'לעזרה: /help',

  help(hasSummary) {
    const lines = [
      'איך משתמשים:',
      '• שלח הודעה קולית, קובץ אודיו או קובץ וידאו, עד 20MB.',
      `• לקובץ גדול יותר: שלח קישור שיתוף מ-Google Drive או Dropbox. ${shareHint}`,
    ];
    if (hasSummary) {
      lines.push(
        '• מתחת לכל תמליל יש כפתור "📋 סכם". אפשר גם לכתוב "סיכום" בכיתוב כששולחים את ההקלטה, ואז יגיע גם סיכום.',
      );
    }
    lines.push('', 'פקודות:', '/start - התחלה', '/help - עזרה', '/id - ה-ID שלך בטלגרם');
    return lines.join('\n');
  },

  yourId: (userId) => `ה-ID שלך בטלגרם: ${userId}`,

  notAllowed: (userId) =>
    'אין לך הרשאה להשתמש בבוט הזה.\n' + `ה-ID שלך: ${userId}\n` + 'שלח אותו לבעל הבוט, והוא יוכל להוסיף אותך.',

  openWarning: (userId) =>
    '⚠️ הבוט הזה פתוח לכולם\n' +
    'כל מי שמוצא אותו יכול לתמלל על חשבונך.\n\n' +
    'מומלץ מאוד לנעול אותו אליך:\n' +
    `1. ה-ID שלך בטלגרם: ${userId}\n` +
    // U+200E keeps ".env.local" in reading order inside the right-to-left line.
    `2. הוסף לקובץ ‎.env.local את השורה: ALLOWED_USER_IDS=${userId}\n` +
    '3. הרץ: npm run setup\n\n' +
    `או בקש מ-Claude Code: "תנעל את הבוט ל-ID ${userId}"`,

  transcribing: '⏳ מתמלל…',

  tooLarge:
    'הקובץ גדול מדי. טלגרם מאפשרת לבוטים לקבל קבצים עד 20MB.\n' +
    `שלח במקום זאת קישור שיתוף מ-Google Drive או Dropbox. ${shareHint}`,

  unsupported: 'אני יודע לתמלל הודעות קוליות וקבצי אודיו ווידאו. שלח אחד מהם, או קישור לקובץ.',

  noSpeech: 'לא זיהיתי דיבור בהקלטה. אם יש בה דיבור, נסה לשלוח אותה שוב.',

  genericError: 'משהו השתבש. נסה שוב בעוד רגע.',

  sonioxFailed: 'התמלול נכשל. נסה לשלוח את ההקלטה שוב.',

  sonioxPayment: 'יתרת התמלול נגמרה. פנה לבעל הבוט כדי שיטען אותה.',

  linkRejected(reason) {
    switch (reason) {
      case 'invalid-url':
        return 'הקישור לא תקין. בדוק אותו ושלח שוב.';
      case 'not-https':
        return 'אני מקבל רק קישורים שמתחילים ב-https. שלח קישור שיתוף מ-Google Drive או Dropbox.';
      case 'blocked-host':
        return 'אי אפשר להשתמש בקישור הזה. שלח קישור שיתוף רגיל מ-Google Drive או Dropbox.';
      case 'drive-folder':
        return 'זה קישור לתיקייה. שלח קישור לקובץ עצמו.';
      case 'youtube-unsupported':
        return 'אני לא יכול לתמלל קישורים מ-YouTube. אם הסרטון שלך, שלח את הקובץ עצמו או קישור שיתוף אליו מ-Google Drive או Dropbox.';
    }
  },

  linkNotMedia:
    'הקישור לא מוביל לקובץ אודיו או וידאו.\n' +
    `${shareHint}\n` +
    'קבצים גדולים מאוד ב-Google Drive לפעמים לא נפתחים. במקרה כזה נסה Dropbox.',

  linkFetchFailed: 'לא הצלחתי לפתוח את הקישור. בדוק שבהגדרות השיתוף נבחר "כל מי שיש לו את הקישור", ונסה שוב.',

  linkJobFailed:
    'לא הצלחתי לתמלל את הקובץ שבקישור. כנראה שהקישור לא מוביל לקובץ אודיו או וידאו.\n' +
    `${shareHint}\n` +
    'קבצים גדולים מאוד ב-Google Drive לפעמים לא נפתחים. במקרה כזה נסה Dropbox.',

  summarizeButton: '📋 סכם',

  summarizing: '⏳ מסכם…',

  summaryHeader: '📋 סיכום',

  summaryFailed: 'לא הצלחתי לסכם. התמליל לא נפגע, ואפשר לנסות שוב עם הכפתור "📋 סכם".',

  summaryTruncated: 'התמליל ארוך, ולכן הסיכום מבוסס רק על החלק הראשון שלו.',

  messageTooOld: 'ההודעה ישנה מדי, ואין לי גישה לתוכן שלה. שלח את ההקלטה שוב.',

  speaker: (key) => `דובר ${key}`,

  unknownSpeaker: 'דובר לא מזוהה',

  speakersCount: (n) => `${n} דוברים`,

  transcriptFileName: (date, timeZone) => `תמליל ${stamp(date, timeZone)}.txt`,

  botReady: 'הבוט מוכן. שלח לי הודעה קולית כדי לנסות.',

  commands: {
    start: 'התחלה',
    help: 'עזרה',
    id: 'ה-ID שלך בטלגרם',
  },
};
