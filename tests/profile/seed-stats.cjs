// Siembra datos variados para ver las estadísticas (se ejecuta dentro de la página).
module.exports = async () => {
  const st = await import('./js/store.js'), h = await import('./js/habits.js');
  const DAY = 86400000, now = Date.now(), key = d => st.dayKey(new Date(d));
  const tracks = [...st.S.tracks.values()], moods = ['alegre', 'melancólica', 'enérgica', 'relajada', 'nostálgica'], genres = ['Pop', 'Rock', 'Jazz', 'Electronic', 'Folk', 'Reggaeton', 'Soul', 'Indie Pop'];
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  tracks.forEach((t, i) => { t.year = [1978, 1986, 1994, 2003, 2012, 2019, 2022, 2024][i % 8]; t.moods = [moods[i % 5], moods[(i + 2) % 5]]; t.genres = [genres[i % 8]]; t.addedAt = now - (i * 40 + 5) * DAY;
    st.S.stats[t.id] = { plays: 4 + i * 5, last: now - (i % 3 === 0 ? 130 : i) * DAY, done: 3 + i * 4, skips: i === 1 ? 14 : i % 2, h: [i % 2, 2 + i, 3, 1 + (i % 4) * 3] };
    st.S.favs[t.id] = { on: i % 2 === 0, at: now - i * 50 * DAY }; });
  st.S.hist.days = {}; h.H.days = {};
  for (let i = 0; i < 370; i++) {
    if (rnd() < (i < 60 ? 0.2 : 0.45)) continue;
    const plays = 2 + Math.floor(rnd() * 18), k = key(now - i * DAY);
    st.S.hist.days[k] = [plays, plays * (150 + Math.floor(rnd() * 120))];
    if (i < 100) { const g = {}; const a = genres[Math.floor(i / 9) % 8], b = genres[(Math.floor(i / 14) + 3) % 8]; g[a] = Math.ceil(plays * 0.6); g[b] = (g[b] || 0) + Math.floor(plays * 0.4) + 1;
      h.H.days[k] = { p: plays, ls: plays * 200, g, ss: [5 + Math.floor(rnd() * 30), 10 + Math.floor(rnd() * 150)].slice(0, 1 + (i % 2)), nw: i % 4, ...(i % 6 === 0 ? { rs: 900, rc: { [['ES', 'JP', 'BR', 'FR'][i % 4]]: 900 } } : {}) }; }
  }
  st.S.hist.hours = Array.from({ length: 24 }, (_, i) => Math.round(40 * Math.exp(-((i - 21) ** 2) / 14) + 18 * Math.exp(-((i - 9) ** 2) / 8)));
  st.S.hist.week = [30, 22, 41, 18, 52, 60, 35];
  st.S.trans = {};
  for (let i = 0; i < tracks.length; i++) for (let j = 1; j <= 2; j++) { const a = tracks[i].id, b = tracks[(i + j) % tracks.length].id; (st.S.trans[a] ||= {})[b] = 2 + ((i * j) % 5); }
  await Promise.all(['stats', 'hist', 'favs', 'trans'].map(k => st.saveKV(k, false)));
  return tracks.length;
};
