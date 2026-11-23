// Each slot has its own Firestore document so replacing one illustration or
// video is atomic and teachers can edit different slots independently.
(() => {
  'use strict';

  const imageDescriptions = {
    heroCover: 'A green lightbulb with a sprouting plant beside a family home',
    whySaveHouse: 'A home surrounded by a lightbulb, sun, leaves and a power plug',
    lightsAndDaylight: 'An LED bulb beside an open-curtained, sunlit window',
    heatingDiagram: 'Thick green curtains and a closed door keep a living room warm',
    clothesline: 'Clothes drying in the sunshine on an Australian rotary clothesline'
  };
  const videoTitles = {
    whySaveVideo: 'How saving energy helps the planet',
    habitsVideo: 'Everyday energy-saving habits'
  };
  const sdk = 'https://www.gstatic.com/firebasejs/10.8.1/';
  let connection;

  function connect() {
    if (!connection) {
      connection = Promise.all([
        import(sdk + 'firebase-app.js'),
        import(sdk + 'firebase-auth.js'),
        import(sdk + 'firebase-firestore-lite.js')
      ]).then(async ([{ initializeApp }, { getAuth, signInAnonymously }, firestore]) => {
        const app = initializeApp({
          apiKey: 'AIzaSyCEGrh2SIC20vJj_nLm4x34ok01srxip7I',
          authDomain: 'paul-s-2026.firebaseapp.com',
          projectId: 'paul-s-2026',
          appId: '1:524167059781:web:57347f46b29c9d4a49862c'
        });
        const auth = getAuth(app);
        await auth.authStateReady();
        if (!auth.currentUser) await signInAnonymously(auth);
        return { ...firestore, db: firestore.getFirestore(app) };
      }).catch(error => {
        connection = undefined;
        throw error;
      });
    }
    return connection;
  }

  function documentFor(backend, key) {
    return backend.doc(backend.db, 'timetables', 'lesson-energy-media-' + key);
  }

  function parseVideo(value, allowLocal = false) {
    const invalid = 'Paste a YouTube link or a direct HTTPS link to an MP4 or WebM file.';
    let url;
    try {
      url = allowLocal ? new URL(value, document.baseURI) : new URL(value);
    } catch {
      throw new Error(invalid);
    }
    if (url.username || url.password ||
        (url.protocol !== 'https:' && !(allowLocal && url.origin === location.origin))) {
      throw new Error(invalid);
    }
    const host = url.hostname.toLowerCase();
    let id;
    if (host === 'youtu.be') {
      id = url.pathname.slice(1);
    } else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'www.youtube-nocookie.com'].includes(host)) {
      id = url.pathname === '/watch' ? url.searchParams.get('v') :
        url.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]+)\/?$/)?.[1];
    } else if (/\.(mp4|webm)$/i.test(url.pathname)) {
      return { src: url.href, link: url.href, youtube: false };
    }
    if (!id || !/^[\w-]{11}$/.test(id)) throw new Error(invalid);
    return {
      src: 'https://www.youtube-nocookie.com/embed/' + id,
      link: 'https://www.youtube.com/watch?v=' + id,
      youtube: true
    };
  }

  async function prepareImage(file) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      throw new Error('Choose a PNG, JPEG or WebP image.');
    }
    const input = new Image();
    const url = URL.createObjectURL(file);
    try {
      input.src = url;
      try {
        await input.decode();
      } catch {
        throw new Error('This image could not be opened. Choose another image.');
      }
      // Keep labels legible and leave room below the Firestore document limit.
      const canvas = document.createElement('canvas');
      for (const longestSide of [1600, 1280, 960, 640]) {
        const scale = Math.min(1, longestSide / Math.max(input.width, input.height));
        canvas.width = Math.max(1, Math.round(input.width * scale));
        canvas.height = Math.max(1, Math.round(input.height * scale));
        canvas.getContext('2d').drawImage(input, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.88));
        if (blob && blob.size <= 750000) return blob;
      }
      throw new Error('This image is too large to save. Try a smaller copy.');
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function renderVideo(slot, video, title) {
    const player = document.createElement(video.youtube ? 'iframe' : 'video');
    player.className = 'aspect-video w-full rounded-xl bg-black';
    player.title = title;
    if (video.youtube) {
      player.allowFullscreen = true;
      player.referrerPolicy = 'strict-origin-when-cross-origin';
    } else {
      player.controls = true;
      player.preload = 'metadata';
      player.playsInline = true;
    }
    player.src = video.src;
    const link = document.createElement('a');
    link.href = video.link;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.className = 'inline-block mt-2 text-sm underline';
    link.textContent = 'Open video in a new tab';
    slot.replaceChildren(player, link);
  }

  function setupSlot(key, isImage) {
    const slot = document.getElementById('slot-' + key);
    const title = isImage ? imageDescriptions[key] : videoTitles[key];
    const form = document.createElement('form');
    form.className = 'mt-3 flex flex-wrap items-center justify-center gap-2';
    const input = document.createElement('input');
    const button = document.createElement('button');
    button.className = 'rounded-lg bg-white border border-wagoll-forest text-wagoll-dark px-4 py-2 text-sm font-bold hover:bg-wagoll-tint disabled:opacity-60';
    if (isImage) {
      input.type = 'file';
      input.accept = 'image/png,image/jpeg,image/webp';
      input.hidden = true;
      button.type = 'button';
      button.textContent = 'Upload image';
      button.addEventListener('click', () => input.click());
      input.addEventListener('change', () => { if (input.files.length) form.requestSubmit(); });
    } else {
      input.type = 'url';
      input.required = true;
      input.placeholder = 'Paste a YouTube, MP4 or WebM link';
      input.setAttribute('aria-label', 'Video link for ' + title);
      input.className = 'min-w-0 flex-1 basis-56 rounded-lg border border-slate-400 bg-white text-slate-800 px-3 py-2 text-sm';
      button.type = 'submit';
      button.textContent = 'Save video';
    }
    const status = document.createElement('p');
    status.className = 'basis-full text-center text-sm font-medium empty:hidden';
    status.setAttribute('role', 'status');
    form.append(input, button, status);
    slot.after(form);

    let savedHere = false;
    let imageObjectUrl;
    function showImage(src) {
      const img = document.createElement('img');
      img.alt = title;
      img.className = 'block w-full max-h-[520px] object-contain rounded-xl mx-auto';
      img.src = src;
      img.onerror = () => { status.textContent = 'This image could not be displayed. You can upload a replacement.'; };
      slot.replaceChildren(img);
      if (imageObjectUrl) URL.revokeObjectURL(imageObjectUrl);
      imageObjectUrl = src.startsWith('blob:') ? src : undefined;
      button.textContent = 'Replace image';
    }
    const fallback = (isImage ? TEACHER_URLS.images : TEACHER_URLS.videos)[key];
    if (fallback) {
      try {
        if (isImage) showImage(fallback);
        else renderVideo(slot, parseVideo(fallback, true), title);
      } catch (error) { status.textContent = error.message; }
    }

    connect().then(async backend => {
      const snapshot = await backend.getDoc(documentFor(backend, key));
      if (!snapshot.exists() || savedHere) return;
      const media = snapshot.data();
      if (isImage) {
        const blob = new Blob([media.bytes.toUint8Array()], { type: media.type });
        showImage(URL.createObjectURL(blob));
      } else {
        renderVideo(slot, parseVideo(media.url), title);
        if (!input.value) input.value = media.url;
      }
    }).catch(() => {
      if (!savedHere && !button.disabled) status.textContent = 'Could not load saved media. Reload the page to retry.';
    });

    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (button.disabled) return;
      button.disabled = input.disabled = true;
      status.textContent = 'Saving…';
      try {
        const blob = isImage ? await prepareImage(input.files[0]) : null;
        const video = isImage ? null : parseVideo(input.value.trim());
        const backend = await connect();
        const data = isImage
          ? { bytes: backend.Bytes.fromUint8Array(new Uint8Array(await blob.arrayBuffer())), type: blob.type }
          : { url: video.link };
        await backend.setDoc(documentFor(backend, key), data);
        savedHere = true;
        if (isImage) showImage(URL.createObjectURL(blob));
        else renderVideo(slot, video, title);
        status.textContent = isImage ? 'Image saved to the lesson.' : 'Video saved to the lesson.';
      } catch (error) {
        const detail = error.code === 'permission-denied' ? 'Firebase denied permission to save this media.' :
          (error.code || error instanceof TypeError) ? 'Check your connection and Firebase access, then try again.' : error.message;
        status.textContent = 'Could not save. ' + detail;
      } finally {
        button.disabled = input.disabled = false;
        if (isImage) input.value = '';
      }
    });
  }

  for (const key of Object.keys(imageDescriptions)) setupSlot(key, true);
  for (const key of Object.keys(videoTitles)) setupSlot(key, false);
})();
