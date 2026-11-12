/*
  The static reader's one script (docs/static-reader-plan.md). A classic script, not a module, and it fetches nothing,
  as browsers allow neither on file://: every page carries what it needs inlined, and assets/i18n.js the words of every
  language. It puts the reader's language in place, keeps their settings in this browser's local storage, turns the
  pages of a book, opens the sheets of passages, ayat and cards, sorts and narrows tables, and plays the Qur'an's
  recitation when there is a connection.
*/
(function () {
  const languages = window.BAHITH_I18N || {};
  const root = document.documentElement;
  const base = root.dataset.root || '';

  const storage = {
    get(key, fallback) {
      try {
        const value = localStorage.getItem(`bahith.${key}`);
        return value === null ? fallback : value;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(`bahith.${key}`, value);
      } catch {
        // Storage refused (a private window): the setting holds for this page only.
      }
    },
  };

  /* ---------- Words: Laravel's own choice of plural, in the browser. ---------- */

  function language() {
    return languages[root.lang] ? root.lang : 'ar';
  }

  // Arabic's six forms, as lang/ar.json writes them: 0, 1, 2, 3–10, 11–99 and 100 up.
  function arabicPlural(number) {
    const hundreds = number % 100;

    if (number <= 2) {
      return number;
    }

    if (hundreds >= 3 && hundreds <= 10) {
      return 3;
    }

    return hundreds >= 11 ? 4 : 5;
  }

  function russianPlural(number) {
    const tens = number % 100;
    const units = number % 10;

    if (units === 1 && tens !== 11) {
      return 0;
    }

    return units >= 2 && units <= 4 && (tens < 10 || tens >= 20) ? 1 : 2;
  }

  // The plural index Laravel's MessageSelector gives a count in each of the site's languages.
  function pluralIndex(locale, number) {
    if (['id', 'ja', 'tr', 'zh'].includes(locale)) {
      return 0;
    }

    if (locale === 'fr') {
      return number === 0 || number === 1 ? 0 : 1;
    }

    if (locale === 'ru') {
      return russianPlural(number);
    }

    if (locale === 'ar') {
      return arabicPlural(number);
    }

    return number === 1 ? 0 : 1;
  }

  // Whether a segment's explicit condition, {n} or [a,b] with * for no bound, takes the count.
  function takes(condition, number) {
    if (!condition.includes(',')) {
      return Number(condition) === number;
    }

    const [from, to] = condition.split(',').map((bound) => bound.trim());

    return (from === '*' || number >= Number(from)) && (to === '*' || number <= Number(to));
  }

  // Laravel's choice: a segment with an explicit condition that takes the count wins; otherwise the plural index.
  function choose(line, number, locale) {
    const plain = [];
    let chosen = null;

    line.split('|').forEach((segment) => {
      const match = segment.match(/^[{[]([^[\]{}]*)[}\]]([\s\S]*)$/);

      if (!match) {
        plain.push(segment);

        return;
      }

      const [, condition, value] = match;

      if (chosen === null && takes(condition, number)) {
        chosen = value;
      }

      plain.push(value);
    });

    if (chosen !== null) {
      return chosen;
    }

    return plain[pluralIndex(locale, number)] ?? plain[0];
  }

  function translate(key, replace, count) {
    const locale = language();
    const strings = (languages[locale] || {}).strings || {};
    let line = strings[key] ?? key;

    if (count !== undefined && count !== null) {
      line = choose(line, Number(count), locale);
    }

    Object.entries(replace || {}).forEach(([name, value]) => {
      line = line.split(`:${name}`).join(String(value));
    });

    return line;
  }

  function applyLanguage(code) {
    if (!languages[code]) {
      return;
    }

    root.lang = code;
    root.dir = languages[code].dir;

    document.querySelectorAll('[data-t]').forEach((node) => {
      const replace = node.dataset.r ? JSON.parse(node.dataset.r) : null;
      node.textContent = translate(node.dataset.t, replace, node.dataset.n);
    });

    document.querySelectorAll('[data-ta]').forEach((node) => {
      Object.entries(JSON.parse(node.dataset.ta)).forEach(([attribute, key]) => {
        node.setAttribute(attribute, translate(key));
      });
    });

    // Catalogue and library text with translations: the reader's language where there is one, the original otherwise.
    document.querySelectorAll('[data-tr]').forEach((node) => {
      node.textContent = JSON.parse(node.dataset.tr)[code] || node.dataset.original || '';
    });
  }

  /* ---------- Settings, kept in this browser. ---------- */

  const defaults = {
    theme: 'system',
    arabicFont: 'amiri',
    quranFont: 'uthmani',
    reciter: 'alafasy',
    readAloudSpeed: '100',
    passages: 'on',
  };

  function setting(name) {
    return storage.get(name, defaults[name]);
  }

  function applySettings() {
    const theme = setting('theme');
    const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

    root.classList.toggle('dark', dark);
    root.dataset.arabicFont = setting('arabicFont');
    root.dataset.quranFont = setting('quranFont');

    if (setting('passages') === 'off') {
      root.dataset.hidePassages = '';
    } else {
      delete root.dataset.hidePassages;
    }

    document.querySelectorAll('[data-toggle-passages]').forEach((button) => {
      button.setAttribute('aria-pressed', setting('passages') === 'off' ? 'false' : 'true');
    });
  }

  function settingsForm() {
    const form = document.querySelector('[data-settings]');

    if (!form) {
      return;
    }

    const select = form.querySelector('[data-language-options]');
    Object.keys(languages).forEach((code) => {
      const option = document.createElement('option');
      option.value = code;
      option.textContent = languages[code].name;
      select.appendChild(option);
    });
    select.value = language();

    Object.keys(defaults).forEach((name) => {
      const field = form.elements[name];

      if (field && field.type === 'checkbox') {
        field.checked = setting(name) !== 'off';
      } else if (field) {
        field.value = setting(name);
      }
    });

    form.addEventListener('change', (event) => {
      const field = event.target;

      if (field.name === 'language') {
        storage.set('language', field.value);
        applyLanguage(field.value);

        return;
      }

      const checked = field.checked ? 'on' : 'off';
      storage.set(field.name, field.type === 'checkbox' ? checked : field.value);
      applySettings();
    });
  }

  /* ---------- The sheet: passages, ayat and cards. ---------- */

  const sheet = document.querySelector('[data-sheet]');

  function make(tag, className, text) {
    const made = document.createElement(tag);

    if (className) {
      made.className = className;
    }

    if (text !== undefined && text !== null) {
      made.textContent = text;
    }

    return made;
  }

  function link(path, text) {
    if (!path) {
      const absent = make('span', 'absent', text);
      absent.title = translate('Not in this edition');

      return absent;
    }

    const anchor = make('a', '', text);
    anchor.href = base + path;

    return anchor;
  }

  function openSheet(title, body) {
    if (!sheet) {
      return;
    }

    sheet.querySelector('[data-sheet-title]').textContent = title;
    sheet.querySelector('[data-sheet-body]').replaceChildren(body);
    sheet.showModal();
  }

  function rowsList(rows) {
    const list = make('ul', 'sheet-rows');

    rows.forEach((row) => {
      const item = make('li');
      const title = link(row.href, row.title);
      title.setAttribute('lang', 'ar');
      item.appendChild(title);

      const details = [];
      if (row.author) {
        details.push(row.author);
      }
      if (row.death) {
        details.push(translate('d. :year', { year: row.death }));
      }
      if (row.number) {
        details.push(translate('Hadith :number', { number: row.number }));
      }
      if (details.length) {
        const line = make('span', 'muted', details.join(' · '));
        line.setAttribute('dir', 'auto');
        item.appendChild(line);
      }

      if (row.editions && row.editions.length) {
        const editions = make('span', 'editions');
        row.editions.forEach((edition) => editions.appendChild(link(edition.href, edition.label)));
        item.appendChild(editions);
      }

      list.appendChild(item);
    });

    return list;
  }

  function arabicQuote(text) {
    const quote = make('p', 'sheet-quote', text);
    quote.setAttribute('lang', 'ar');
    quote.setAttribute('dir', 'rtl');

    return quote;
  }

  function sheetData() {
    const holder = document.querySelector('[data-sheets]');

    return holder ? JSON.parse(holder.textContent) : { passages: {}, quotes: {} };
  }

  // The rows of a sheet, and a line for the works beyond the twenty it lists.
  function others(body, data, label) {
    body.appendChild(make('p', 'muted', translate(label, { count: data.others }, data.others)));
    body.appendChild(rowsList(data.rows));

    if (data.more > 0) {
      body.appendChild(
        make('p', 'muted', translate('And :count more|And :count more', { count: data.more }, data.more)),
      );
    }
  }

  function passageSheet(id) {
    const data = sheetData().passages[id];

    if (!data) {
      return;
    }

    const body = make('div');
    if (data.text) {
      body.appendChild(arabicQuote(data.text));
    }
    others(body, data, 'In :count other book|In :count other books');

    openSheet(translate(data.kind === 'hadith' ? 'Hadith' : 'Shared passage'), body);
  }

  function surahName(data) {
    if (!data.surahNames) {
      return data.surah;
    }

    return language() === 'ar' ? data.surahNames.ar : data.surahNames.en;
  }

  function quoteSheet(id) {
    const data = sheetData().quotes[id];

    if (!data) {
      return;
    }

    const body = make('div');
    if (data.text) {
      body.appendChild(arabicQuote(data.text));
    }
    const where = translate('Surah :surah, ayah :ayah', { surah: surahName(data), ayah: data.ayah });
    body.appendChild(link(data.quran, `${translate("Open in the Qur'an")} · ${where}`));
    others(body, data, 'Quoted in :count other book|Quoted in :count other books');

    openSheet(translate('Ayah'), body);
  }

  function ayahSheet(number) {
    const holder = document.querySelector('[data-ayah-sheets]');
    const data = holder ? JSON.parse(holder.textContent)[number] : null;

    if (!data) {
      return;
    }

    const body = make('div');
    if (data.quotes.length) {
      body.appendChild(make('p', 'muted', translate('Quoted in')));
      body.appendChild(rowsList(data.quotes));
    }
    if (data.tafsirs.length) {
      body.appendChild(make('p', 'muted', translate('Tafsir')));
      body.appendChild(rowsList(data.tafsirs));
    }

    openSheet(`${translate('Ayah')} ${number}`, body);
  }

  /* ---------- The Qur'an's recitation, streamed from the reciter's site. ---------- */

  const quran = {
    audio: null,
    playing: null,
    holder: document.querySelector('[data-quran]'),

    url(ayah) {
      const reciters = JSON.parse(quran.holder.dataset.reciters);
      const folder = reciters[setting('reciter')] || reciters[defaults.reciter];

      return `${folder}${String(quran.holder.dataset.surah).padStart(3, '0')}${String(ayah).padStart(3, '0')}.mp3`;
    },

    mark(number) {
      document.querySelectorAll('.quran-ayah[data-playing]').forEach((ayah) => {
        delete ayah.dataset.playing;
      });

      const ayah = document.getElementById(`ayah-${number}`);
      if (ayah) {
        ayah.dataset.playing = '';
        ayah.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    },

    label() {
      const button = document.querySelector('[data-quran-listen]');
      if (button) {
        button.textContent = translate(quran.playing ? 'Stop' : 'Listen');
      }
    },

    stop() {
      if (quran.audio) {
        quran.audio.pause();
      }
      quran.audio = null;
      quran.playing = null;
      quran.mark(null);
      quran.label();
    },

    // With no connection the audio fails, and playing simply stops.
    playFrom(number, single) {
      if (!quran.holder) {
        return;
      }

      quran.stop();
      quran.audio = new Audio(quran.url(number));
      quran.playing = number;
      quran.mark(number);
      quran.audio.addEventListener('ended', () => {
        const next = quran.playing + 1;

        if (!single && document.getElementById(`ayah-${next}`)) {
          quran.playFrom(next, false);
        } else {
          quran.stop();
        }
      });
      quran.audio.addEventListener('error', () => quran.stop());
      quran.audio.play().catch(() => quran.stop());
      quran.label();
    },
  };

  const listen = document.querySelector('[data-quran-listen]');
  if (listen) {
    listen.addEventListener('click', () => {
      if (quran.playing) {
        quran.stop();
      } else {
        quran.playFrom(1, false);
      }
    });
  }

  /* ---------- What a press opens. ---------- */

  function pressPassage(passage) {
    const { quotes, passages } = passage.dataset;

    if (quotes) {
      quoteSheet(quotes.split(' ')[0]);
    } else if (passages && !(passage.dataset.kind === 'passage' && root.dataset.hidePassages !== undefined)) {
      passageSheet(passages.split(' ')[0]);
    }
  }

  function pressCard(card) {
    const template = document.getElementById(card.dataset.openCard);

    if (template) {
      openSheet(card.textContent.trim(), template.content.cloneNode(true));
    }
  }

  document.addEventListener('click', (event) => {
    const passage = event.target.closest('.passage');
    const card = event.target.closest('[data-open-card]');
    const ayah = event.target.closest('[data-ayah-links]');
    const play = event.target.closest('[data-play]');

    if (passage) {
      pressPassage(passage);
    } else if (card) {
      pressCard(card);
    } else if (play) {
      quran.playFrom(Number(play.dataset.play), true);
    } else if (ayah) {
      ayahSheet(ayah.dataset.ayahLinks);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (
      (event.key === 'Enter' || event.key === ' ') &&
      event.target.matches('.passage, [data-ayah-links], [data-play]')
    ) {
      event.preventDefault();
      event.target.click();
    }
  });

  if (sheet) {
    sheet.querySelector('[data-sheet-close]').addEventListener('click', () => sheet.close());
    sheet.addEventListener('click', (event) => {
      if (event.target === sheet) {
        sheet.close();
      }
    });
  }

  /* ---------- A book's pages, one at a time. ---------- */

  const reader = document.querySelector('[data-reader]');
  const pages = reader ? Array.from(reader.querySelectorAll('[data-page]')) : [];
  let current = 0;

  function show(index, updateHash) {
    pages.forEach((page, position) => {
      page.hidden = position !== index;
    });
    current = index;

    const page = pages[index];
    const label = document.querySelector('[data-page-number]');
    if (label) {
      const parts = [];
      if (Number(reader.dataset.parts) > 1) {
        parts.push(translate('Part :number', { number: page.dataset.part }));
      }
      if (page.dataset.number) {
        parts.push(translate('Page :number', { number: page.dataset.number }));
      }
      label.textContent = parts.join(' · ');
    }

    if (updateHash) {
      window.history.replaceState(null, '', `#${page.id}`);
    }
    window.scrollTo(0, 0);
  }

  // A step within the file is instant; past either end it follows the link to the file beside it.
  function step(direction) {
    const next = current + direction;

    if (next >= 0 && next < pages.length) {
      show(next, true);
    } else if (direction > 0 && reader.dataset.next) {
      window.location.href = reader.dataset.next;
    } else if (direction < 0 && reader.dataset.previous) {
      window.location.href = reader.dataset.previous;
    }
  }

  function openAtHash() {
    const id = window.location.hash.slice(1);
    const index = pages.findIndex((page) => page.id === id);

    show(index < 0 ? 0 : index, false);
  }

  // The page in view read aloud by the device's own voice, which works offline.
  function readAloud() {
    const button = document.querySelector('[data-read-aloud]');

    if (!button || !('speechSynthesis' in window)) {
      return;
    }

    button.hidden = false;
    button.addEventListener('click', () => {
      if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();

        return;
      }

      const utterance = new SpeechSynthesisUtterance(pages[current].innerText);
      utterance.lang = reader.getAttribute('lang') || 'ar';
      utterance.rate = Number(setting('readAloudSpeed')) / 100;
      window.speechSynthesis.speak(utterance);
    });
  }

  if (reader && pages.length) {
    openAtHash();
    window.addEventListener('hashchange', openAtHash);

    document.querySelectorAll('[data-step]').forEach((button) => {
      button.addEventListener('click', () => step(Number(button.dataset.step)));
    });

    // An Arabic book turns as a printed one does: on is to the left.
    const rtl = reader.getAttribute('dir') === 'rtl';
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const back = rtl ? 'ArrowRight' : 'ArrowLeft';

    document.addEventListener('keydown', (event) => {
      if (event.target.closest('input, select, textarea') || (sheet && sheet.open)) {
        return;
      }

      if (event.key === forward) {
        step(1);
      } else if (event.key === back) {
        step(-1);
      }
    });

    let touch = null;
    reader.addEventListener(
      'touchstart',
      (event) => {
        touch = event.touches.length === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
      },
      { passive: true },
    );
    reader.addEventListener('touchend', (event) => {
      if (!touch) {
        return;
      }

      const dx = event.changedTouches[0].clientX - touch.x;
      const dy = event.changedTouches[0].clientY - touch.y;
      touch = null;

      if (Math.abs(dx) >= 60 && Math.abs(dx) >= Math.abs(dy) * 1.5) {
        // A swipe pulls in the page lying on the side it comes from.
        step(dx > 0 === rtl ? 1 : -1);
      }
    });

    document.querySelectorAll('[data-toggle-passages]').forEach((button) => {
      button.addEventListener('click', () => {
        storage.set('passages', setting('passages') === 'off' ? 'on' : 'off');
        applySettings();
      });
    });

    readAloud();
  }

  /* ---------- Tables: sorted by a heading, narrowed by a letter. ---------- */

  const collator = new Intl.Collator(['ar', 'en'], { sensitivity: 'base', numeric: true });

  function cellValue(row, index, type) {
    const cell = row.children[index];

    if (!cell) {
      return '';
    }

    const value = cell.dataset.value ?? cell.textContent.trim();

    return type === 'number' ? Number(value) || 0 : value;
  }

  // The first letter of a row's first column; the definite article is passed over, as an index of Arabic names does.
  function firstLetter(row) {
    return row.cells[0].textContent.trim().replace(/^ال/, '').charAt(0).toUpperCase();
  }

  // The first letters of the first column, as buttons that show only the rows starting with one.
  function letterBar(table, wrap) {
    const rows = Array.from(table.tBodies[0].rows);
    const letters = [...new Set(rows.map(firstLetter).filter(Boolean))].sort(collator.compare);

    if (letters.length < 2) {
      return;
    }

    const bar = make('div', 'az');
    const buttons = letters.map((letter) => {
      const button = make('button', '', letter);
      button.type = 'button';
      button.addEventListener('click', () => {
        const on = button.getAttribute('aria-pressed') !== 'true';

        buttons.forEach((other) => other.setAttribute('aria-pressed', 'false'));
        button.setAttribute('aria-pressed', on ? 'true' : 'false');
        rows.forEach((row) => {
          row.hidden = on && firstLetter(row) !== letter;
        });
      });
      bar.appendChild(button);

      return button;
    });

    wrap.parentNode.insertBefore(bar, wrap);
  }

  function sortBy(table, heading, index) {
    const ascending = heading.getAttribute('aria-sort') !== 'ascending';
    const type = heading.dataset.sort;
    const body = table.tBodies[0];

    table.querySelectorAll('th').forEach((other) => other.removeAttribute('aria-sort'));
    heading.setAttribute('aria-sort', ascending ? 'ascending' : 'descending');

    Array.from(body.rows)
      .sort((a, b) => {
        const x = cellValue(a, index, type);
        const y = cellValue(b, index, type);
        const order = type === 'number' ? x - y : collator.compare(x, y);

        return ascending ? order : -order;
      })
      .forEach((row) => body.appendChild(row));
  }

  document.querySelectorAll('table[data-sortable]').forEach((table) => {
    const wrap = make('div', 'table-wrap');
    table.parentNode.insertBefore(wrap, table);
    wrap.appendChild(table);

    table.querySelectorAll('th[data-sort]').forEach((heading, index) => {
      heading.addEventListener('click', () => sortBy(table, heading, index));
    });

    if (table.hasAttribute('data-az')) {
      letterBar(table, wrap);
    }
  });

  /* ---------- On load. ---------- */

  applySettings();
  applyLanguage(language());
  settingsForm();
})();
