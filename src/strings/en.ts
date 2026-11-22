import type { Strings } from './index.js';
import { stamp } from './stamp.js';

const shareHint = 'In the sharing settings, choose "Anyone with the link".';

export const en: Strings = {
  welcome:
    "Hi! I'm a transcription bot.\n" +
    'Send me a voice message, an audio file or a video, and I will send back a transcript split by speaker.\n\n' +
    'For help: /help',

  help(hasSummary) {
    const lines = [
      'How to use:',
      '• Send a voice message, an audio file or a video file, up to 20MB.',
      `• For a larger file, send a Google Drive or Dropbox share link. ${shareHint}`,
    ];
    if (hasSummary) {
      lines.push(
        '• Under every transcript there is a "📋 Summarize" button. You can also write "summary" as the caption when you send the recording, and you\'ll get a summary as well.',
      );
    }
    lines.push('', 'Commands:', '/start - get started', '/help - help', '/id - your Telegram ID');
    return lines.join('\n');
  },

  yourId: (userId) => `Your Telegram ID: ${userId}`,

  notAllowed: (userId) =>
    "You don't have permission to use this bot.\n" +
    `Your ID: ${userId}\n` +
    'Send it to the bot owner and they can add you.',

  openWarning: (userId) =>
    '⚠️ This bot is open to everyone\n' +
    'Anyone who finds it can transcribe at your expense.\n\n' +
    'We strongly recommend locking it to you:\n' +
    `1. Your Telegram ID: ${userId}\n` +
    `2. Add this line to the .env.local file: ALLOWED_USER_IDS=${userId}\n` +
    '3. Run: npm run setup\n\n' +
    `Or ask Claude Code: "Lock the bot to ID ${userId}"`,

  transcribing: '⏳ Transcribing…',

  tooLarge:
    'This file is too large. Telegram only lets bots receive files up to 20MB.\n' +
    `Send a Google Drive or Dropbox share link instead. ${shareHint}`,

  unsupported: 'I can transcribe voice messages and audio or video files. Send one of those, or a link to a file.',

  noSpeech: "I couldn't find any speech in the recording. If it does contain speech, try sending it again.",

  genericError: 'Something went wrong. Please try again in a moment.',

  sonioxFailed: 'Transcription failed. Try sending the recording again.',

  sonioxPayment: 'The transcription credit has run out. Contact the bot owner to top it up.',

  linkRejected(reason) {
    switch (reason) {
      case 'invalid-url':
        return "This link isn't valid. Check it and send it again.";
      case 'not-https':
        return 'I only accept links that start with https. Send a Google Drive or Dropbox share link.';
      case 'blocked-host':
        return "This link can't be used. Send a regular share link from Google Drive or Dropbox.";
      case 'drive-folder':
        return 'This is a link to a folder. Send a link to the file itself.';
      case 'youtube-unsupported':
        return "I can't transcribe YouTube links. If the video is yours, send the file itself or a Google Drive or Dropbox share link to it.";
    }
  },

  linkNotMedia:
    "The link doesn't lead to an audio or video file.\n" +
    `${shareHint}\n` +
    'Very large files on Google Drive sometimes fail to open. In that case try Dropbox.',

  linkFetchFailed: "I couldn't open the link. Check that sharing is set to \"Anyone with the link\", and try again.",

  linkJobFailed:
    "I couldn't transcribe the file in the link. The link probably doesn't lead to an audio or video file.\n" +
    `${shareHint}\n` +
    'Very large files on Google Drive sometimes fail to open. In that case try Dropbox.',

  summarizeButton: '📋 Summarize',

  summarizing: '⏳ Summarizing…',

  summaryHeader: '📋 Summary',

  summaryFailed: 'I couldn\'t summarize. The transcript is safe, and you can try again with the "📋 Summarize" button.',

  summaryTruncated: 'The transcript is long, so the summary is based only on its first part.',

  messageTooOld: "This message is too old, and I can't access its content. Send the recording again.",

  speaker: (key) => `Speaker ${key}`,

  unknownSpeaker: 'Unknown speaker',

  speakersCount: (n) => `${n} speakers`,

  transcriptFileName: (date, timeZone) => `Transcript ${stamp(date, timeZone)}.txt`,

  botReady: 'The bot is ready. Send me a voice message to try it.',

  commands: {
    start: 'Get started',
    help: 'Help',
    id: 'Your Telegram ID',
  },
};
