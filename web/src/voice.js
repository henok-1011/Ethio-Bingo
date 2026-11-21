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

// Bump this whenever a call is re-recorded. Telegram and mobile WebViews keep
// the old file for the same URL, which can leave a single call playing stale
// or wrong audio even after the clip is replaced.
const CLIP_VERSION = '20261120b';
const CACHE_NAME = `ethio-bingo-calls-${CLIP_VERSION}`;
const PRELOAD_CONCURRENCY = 6;

const CLIP_NAMES = [
  'start',
  'bingo',
  ...Array.from({ length: 75 }, (_, index) => String(index + 1)),
];

let currentAudio = null;
let phraseActive = false;
let queuedCall = null;
let playRequest = 0;
let preloadStarted = false;

// name -> Promise<blob URL> while downloading, name -> blob URL once ready.
// Blob URLs keep playback local even on a slow connection.
const clipLoads = new Map();
const loadedClips = new Map();

function clipUrl(name) {
  return `${CLIP_BASE}/${name}.mp3?v=${CLIP_VERSION}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchClipUrl(name, attempt = 0) {
  const url = clipUrl(name);
  try {
    let response = null;

    if (typeof caches !== 'undefined') {
      try {
        const cache = await caches.open(CACHE_NAME);
        response = await cache.match(url);
      } catch {
        /* Cache Storage is unavailable in some WebViews. */
      }
    }

    if (!response) {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), 12000) : null;
      try {
        response = await fetch(url, {
          cache: 'force-cache',
          ...(controller ? { signal: controller.signal } : {}),
        });
      } finally {
        if (timer) clearTimeout(timer);
      }
      if (!response || !response.ok) throw new Error(`Audio clip ${name} is unavailable.`);

      if (typeof caches !== 'undefined') {
        try {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(url, response.clone());
        } catch {
          /* In-memory blobs still work for this session. */
        }
      }
    }

    const blob = await response.blob();
    if (!blob.size) throw new Error(`Audio clip ${name} is empty.`);
    return URL.createObjectURL(blob);
  } catch (err) {
    // A slow or interrupted request gets one fresh attempt. The same clip is
    // always used; there is no alternate voice.
    if (attempt < 1) {
      await delay(500);
      return fetchClipUrl(name, attempt + 1);
    }
    throw err;
  }
}

function loadClip(name) {
  if (loadedClips.has(name)) return Promise.resolve(loadedClips.get(name));
  if (clipLoads.has(name)) return clipLoads.get(name);

  const load = fetchClipUrl(name)
    .then((url) => {
      loadedClips.set(name, url);
      return url;
    })
    .catch((err) => {
      // Do not cache a failed load; the next call can retry it.
      clipLoads.delete(name);
      throw err;
    });
  clipLoads.set(name, load);
  return load;
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
 * Plays a recorded clip after its cached blob is ready. A slow download waits
 * for the same clip instead of going silent or switching voices.
 */
function playClip(name, onFail, attempt = 0, onEnded) {
  if (typeof Audio === 'undefined') {
    if (onFail) onFail();
    return false;
  }

  const request = ++playRequest;
  stopAudio();

  loadClip(name)
    .then((url) => {
      if (request !== playRequest) return;
      try {
        const audio = new Audio(url);
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
        const played = audio.play();
        if (played && typeof played.catch === 'function') played.catch(retry);
      } catch {
        if (request !== playRequest) return;
        currentAudio = null;
        if (attempt < 1) {
          setTimeout(() => playClip(name, onFail, attempt + 1, onEnded), 400);
        } else if (onFail) {
          onFail();
        }
      }
    })
    .catch(() => {
      if (request !== playRequest) return;
      if (attempt < 1) {
        setTimeout(() => playClip(name, onFail, attempt + 1, onEnded), 600);
      } else if (onFail) {
        onFail();
      }
    });

  return true;
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

/** Downloads every clip into the local cache before calls need them. */
export function preloadCallClips() {
  if (preloadStarted || typeof fetch !== 'function' || typeof Audio === 'undefined') return;
  preloadStarted = true;

  let nextIndex = 0;
  let active = 0;
  const pump = () => {
    while (active < PRELOAD_CONCURRENCY && nextIndex < CLIP_NAMES.length) {
      const name = CLIP_NAMES[nextIndex];
      nextIndex += 1;
      active += 1;
      loadClip(name)
        .catch(() => {
          /* A failed item is retried when that call is played. */
        })
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  };
  pump();
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
  playRequest += 1;
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
