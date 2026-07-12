const FIFA_CALENDAR_URL = 'https://api.fifa.com/api/v3/calendar/matches?language=en&count=500&idCompetition=17&idSeason=285023';
export const MATCHES_SNAPSHOT_KEY = 'matches:snapshot';
export const MATCHES_SNAPSHOT_TTL_SECONDS = 60 * 60 * 24 * 3;

const TEAM_NAME_ALIASES = {
  'Bosnia-Herzegovina': 'Bosnia and Herzegovina',
  'Cabo Verde': 'Cape Verde',
  'Congo DR': 'DR Congo',
  "Côte d'Ivoire": 'Ivory Coast',
  'Czechia': 'Czech Republic',
  'IR Iran': 'Iran',
  'Korea Republic': 'South Korea',
  'Türkiye': 'Turkey'
};

const STATUS_MAP = {
  0: 'completed',
  1: 'scheduled', 2: 'scheduled',
  3: 'live', 4: 'live', 5: 'live', 6: 'live', 7: 'live', 8: 'live', 9: 'live',
  10: 'completed', 11: 'completed', 12: 'completed',
  13: 'abandoned',
  15: 'live', 16: 'live', 17: 'live'
};

function pickLocalized(values) {
  if (!Array.isArray(values) || !values.length) return '';
  for (const item of values) {
    if ((item?.Locale || '').toLowerCase().startsWith('en')) return item?.Description || '';
  }
  return values[0]?.Description || '';
}

function normalizeTeam(team) {
  if (!team) return '';
  const raw = team.ShortClubName || pickLocalized(team.TeamName) || '';
  return TEAM_NAME_ALIASES[raw] || raw;
}

function normalizeMatch(raw) {
  const homeTeam = raw.Home || raw.HomeTeam || raw.homeTeam;
  const awayTeam = raw.Away || raw.AwayTeam || raw.awayTeam;
  const groupRaw = pickLocalized(raw.GroupName)
    || (raw.Group && raw.Group.GroupName)
    || raw.GroupLetter || raw.groupLetter || '';
  const group = typeof groupRaw === 'string' ? groupRaw : '';
  const sourceStatus = Number(raw.MatchStatus ?? raw.matchStatus ?? 0);
  const dateSource = raw.Date || raw.MatchDate || raw.matchDate || '';
  const timeSource = raw.Date || raw.MatchTime || raw.matchTime || '';
  const stadium = raw.Stadium || {};
  const venueName = pickLocalized(stadium.Name) || raw.StadiumName || raw.stadiumName || '';
  const cityName = pickLocalized(stadium.CityName) || raw.CityName || raw.cityName || '';
  const venue = [venueName, cityName].filter(Boolean).join(', ');
  const letterMatch = group.match(/Group\s+([A-Z])/i);
  const homeScore = raw.HomeTeamScore ?? raw.homeTeamScore;
  const awayScore = raw.AwayTeamScore ?? raw.awayTeamScore;

  return {
    id: String(raw.IdMatch || raw.Id || raw.MatchId || raw.matchId || ''),
    matchNumber: raw.MatchNumber || raw.matchNumber || null,
    group,
    groupLetter: raw.GroupLetter || raw.groupLetter || (letterMatch?.[1] || ''),
    matchDay: raw.MatchDay || raw.matchDay || null,
    date: dateSource.slice(0, 10),
    time: timeSource.includes('T') ? timeSource.slice(11, 16) : timeSource.slice(0, 5),
    venue,
    city: cityName,
    home: normalizeTeam(homeTeam),
    away: normalizeTeam(awayTeam),
    homeScore: homeScore != null ? Number(homeScore) : null,
    awayScore: awayScore != null ? Number(awayScore) : null,
    status: STATUS_MAP[sourceStatus] || 'unknown',
    sourceStatus,
    stage: pickLocalized(raw.StageName) || raw.stageName || '',
    lastUpdated: raw.UpdatedDate || raw.updatedDate || null
  };
}

async function fetchJsonWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`FIFA API HTTP ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchHeadToHead(matchId) {
  if (!matchId) return null;
  try {
    return await fetchJsonWithTimeout(
      `https://api.fifa.com/api/v3/headtohead?matchId=${encodeURIComponent(matchId)}&language=en`,
      6000
    );
  } catch {
    return null;
  }
}

function parseHeadToHead(raw) {
  if (!raw) return null;
  const matches = Array.isArray(raw.Matches) ? raw.Matches : Array.isArray(raw.matches) ? raw.matches : [];
  if (!matches.length) return null;
  let wHome = 0;
  let draws = 0;
  let wAway = 0;
  let goalsHome = 0;
  let goalsAway = 0;
  for (const match of matches) {
    const homeScore = Number(match.HomeTeamScore ?? match.homeTeamScore ?? match.homeScore ?? 0);
    const awayScore = Number(match.AwayTeamScore ?? match.awayTeamScore ?? match.awayScore ?? 0);
    if (homeScore > awayScore) wHome += 1;
    else if (homeScore < awayScore) wAway += 1;
    else draws += 1;
    goalsHome += homeScore;
    goalsAway += awayScore;
  }
  return {
    source: 'FIFA head-to-head statistics API',
    wHome, draws, wAway, total: matches.length, goalsHome, goalsAway,
    matches: matches.slice(0, 10).map((match) => ({
      date: (match.MatchDate || match.matchDate || match.Date || '').slice(0, 10),
      competition: match.CompetitionName || match.competitionName || '',
      stage: match.StageName || match.stageName || '',
      home: normalizeTeam(match.HomeTeam || match.homeTeam),
      away: normalizeTeam(match.AwayTeam || match.awayTeam),
      homeScore: Number(match.HomeTeamScore ?? match.homeTeamScore ?? match.homeScore ?? 0),
      awayScore: Number(match.AwayTeamScore ?? match.awayTeamScore ?? match.awayScore ?? 0)
    }))
  };
}

function groupByLetter(matches) {
  const groups = {};
  for (const match of matches) {
    const letter = match.groupLetter || '?';
    if (!groups[letter]) groups[letter] = { teams: [], matches: [] };
    groups[letter].matches.push(match);
  }
  for (const group of Object.values(groups)) {
    group.teams = Array.from(new Set(group.matches.flatMap((match) => [match.home, match.away]).filter(Boolean))).sort();
    group.matches.sort((a, b) => (
      `${a.date}T${a.time || '00:00'}`.localeCompare(`${b.date}T${b.time || '00:00'}`)
    ));
  }
  return groups;
}

export async function fetchFifaMatchesSnapshot() {
  const data = await fetchJsonWithTimeout(FIFA_CALENDAR_URL, 20000);
  const results = Array.isArray(data?.Results) ? data.Results : Array.isArray(data?.results) ? data.results : [];
  const matches = results.map(normalizeMatch).filter((match) => match.id);
  let h2hOk = 0;
  let h2hFail = 0;
  for (const match of matches.filter((item) => item.status === 'completed')) {
    const parsed = parseHeadToHead(await fetchHeadToHead(match.id));
    if (parsed) {
      match.headToHead = parsed;
      h2hOk += 1;
    } else {
      h2hFail += 1;
    }
  }
  return {
    metadata: {
      lastUpdated: new Date().toISOString(),
      generatedBy: 'api/_lib/worldcup-matches.js',
      sourceName: 'FIFA public calendar API',
      sourceUrl: FIFA_CALENDAR_URL,
      sourceDataDate: new Date().toISOString().slice(0, 10),
      teamCount: new Set(matches.flatMap((match) => [match.home, match.away]).filter(Boolean)).size,
      matchCount: matches.length,
      h2hAttached: h2hOk,
      h2hFailed: h2hFail,
      note: 'Synced by the daily Vercel cron. data/worldcup_matches.json is the git-tracked fallback.'
    },
    groups: groupByLetter(matches)
  };
}
