import { letterFor } from './bingo.js';

// Amharic bingo calls are played from recorded male clips in
// public/audio/calls: one MP3 per number (1..75) plus the announcement
// phrases. Only these clips are used. Do not fall back to remote TTS or the
// device speech voice: they are a different voice from the supplied caller.
const ONES = [
  '', 'አንድ', 'ሁለት', 'ሶስት', 'አራት', 'አምስት', 'ስድስት', 'ሰባት', 'ስምንት', 'ዘጠኝ',
];
const TEENS = [
  'አስር', 'አስራ አንድ', 'አስራ ሁለት', 'አስራ ሶስት', 'አስራ አራት', 'አስራ አምስት',
  'አስራ ስድስት', 'አስራ ሰባት', 'አስራ ስምንት', 'አስራ ዘጠኝ',
];
const TENS = { 2: 'ሃያ', 3: 'ሰላሳ', 4: 'አርባ', 5: 'ሃምሳ', 6: 'ስልሳ', 7: 'ሰባ' };
const LETTERS = { B: 'ቢ', I: 'አይ', N: 'ኤን', G: 'ጂ', O: 'ኦ' };

export function amharicNumber(number) {
  const n = Number(number);
  if (!Number.isInteger(n) || n < 0 || n > 99) return String(number ?? '');
  if (n < 10) return ONES[n] || 'ዜሮ';
  if (n < 20) return TEENS[n - 10];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return ones ? `${TENS[tens]} ${ONES[ones]}` : TENS[tens];
}

export function amharicCall(number) {
  return `${LETTERS[letterFor(number)] || ''} ${amharicNumber(number)}`.trim();
}

// Recorded clips live next to the bundle, so the same files are served by
// Vite in development and by the API server in production.
const CLIP_BASE = `${String(import.meta.env?.BASE_URL || '/').replace(/\/$/, '')}/audio/calls`;

// Phrases that are recorded as clips.
const PHRASE_CLIPS = {
  'ጨዋታው ተጀመረ': 'start',
  'ቢንጎ': 'bingo',
};

let currentAudio = null;
let phraseActive = false;
let queuedCall = null;
const clipCache = new Map();

// Bump this whenever a call is re-recorded. Telegram and mobile WebViews keep
// the old file for the same URL, which can leave a single call playing stale
// or wrong audio even after the clip is replaced.
const CLIP_VERSION = '20261120b';

function clipUrl(name) {
  return `${CLIP_BASE}/${name}.mp3?v=${CLIP_VERSION}`;
}

/** Cached <audio> element so a repeated call replays instantly. */
function clip(name) {
  const url = clipUrl(name);
  let audio = clipCache.get(url);
  if (!audio) {
    audio = new Audio(url);
    audio.preload = 'auto';
    clipCache.set(url, audio);
  }
  return audio;
}

function stopAudio() {
  if (!currentAudio) return;
  try {
    currentAudio.pause();
    currentAudio.currentTime = 0;
  } catch {
    /* ignore */
  }
  currentAudio = null;
}

/**
 * Plays a recorded clip. A failed request is retried once with the same clip;
 * onFail is only a notification, never a switch to a different voice.
 */
function playClip(name, onFail, attempt = 0, onEnded) {
  if (typeof Audio === 'undefined') {
    if (onFail) onFail();
    return false;
  }
  try {
    stopAudio();
    const audio = clip(name);
    audio.preservesPitch = true;
    audio.webkitPreservesPitch = true;
    audio.mozPreservesPitch = true;
    audio.playbackRate = 1;
    const retry = () => {
      // A newer call has already taken over; do not replay this one over it.
      if (currentAudio !== audio) return;
      currentAudio = null;
      if (attempt < 1) {
        setTimeout(() => playClip(name, onFail, attempt + 1, onEnded), 400);
      } else if (onFail) {
        onFail();
      }
    };
    const finish = () => {
      if (currentAudio !== audio) return;
      currentAudio = null;
      if (onEnded) onEnded();
    };
    audio.onerror = retry;
    audio.onended = finish;
    currentAudio = audio;
    audio.currentTime = 0;
    if (attempt > 0) audio.load();
    const played = audio.play();
    if (played && typeof played.catch === 'function') played.catch(retry);
    return true;
  } catch {
    currentAudio = null;
    if (attempt < 1) {
      setTimeout(() => playClip(name, onFail, attempt + 1, onEnded), 400);
    } else if (onFail) {
      onFail();
    }
    return false;
  }
}

function playQueuedCall() {
  const number = queuedCall;
  queuedCall = null;
  if (number != null) playClip(String(number));
}

function finishPhrase() {
  phraseActive = false;
  playQueuedCall();
}

/** Downloads the round's clips so calls do not wait on the network. */
export function preloadCallClips() {
  if (typeof Audio === 'undefined') return;
  for (let n = 1; n <= 75; n += 1) {
    try {
      clip(String(n)).load();
    } catch {
      /* ignore */
    }
  }
  for (const name of ['start', 'bingo']) {
    try {
      clip(name).load();
    } catch {
      /* ignore */
    }
  }
}

/** Plays the recorded male call for a number. */
export function playCallClip(number, onFail) {
  if (!number) {
    if (onFail) onFail();
    return false;
  }
  if (phraseActive) {
    // Let the start/bingo announcement finish; play the latest call after it.
    queuedCall = String(number);
    return true;
  }
  return playClip(String(number), onFail);
}

export function stopCallAudio() {
  stopAudio();
  phraseActive = false;
  queuedCall = null;
}

/** Plays a recorded announcement phrase. Unknown phrases stay silent. */
export function speakPhrase(text) {
  if (!text) return false;
  const clipName = PHRASE_CLIPS[text];
  if (!clipName) return false;
  phraseActive = true;
  const started = playClip(clipName, finishPhrase, 0, finishPhrase);
  if (!started) {
    phraseActive = false;
    playQueuedCall();
  }
  return started;
}
