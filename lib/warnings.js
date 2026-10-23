// Met Éireann weather warnings feed. The forecast licence requires a public
// site that shows Met Éireann forecasts to also show these warnings, with the
// issue time, onset/expiry, area, description, severity, certainty, event
// and headline left unchanged.

const FEED = 'https://www.met.ie/Open_Data/json/warning_IRELAND.json';

// FIPS county codes used in the feed's "regions" field.
const REGIONS = {
  EI01: 'Carlow', EI02: 'Cavan', EI03: 'Clare', EI04: 'Cork', EI06: 'Donegal',
  EI07: 'Dublin', EI10: 'Galway', EI11: 'Kerry', EI12: 'Kildare', EI13: 'Kilkenny',
  EI14: 'Leitrim', EI15: 'Laois', EI16: 'Limerick', EI18: 'Longford', EI19: 'Louth',
  EI20: 'Mayo', EI21: 'Meath', EI22: 'Monaghan', EI23: 'Offaly', EI24: 'Roscommon',
  EI25: 'Sligo', EI26: 'Tipperary', EI27: 'Waterford', EI29: 'Westmeath',
  EI30: 'Wexford', EI31: 'Wicklow',
};

function normalise(list, now = Date.now()) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((w) => !w.expiry || Date.parse(w.expiry) > now)
    .map((w) => ({
      id: w.id,
      level: w.level,
      type: w.type,
      severity: w.severity,
      certainty: w.certainty,
      headline: w.headline,
      description: w.description,
      issued: w.issued,
      updated: w.updated,
      onset: w.onset,
      expiry: w.expiry,
      regions: (w.regions || []).map((r) => REGIONS[r] || r),
    }));
}

async function fetchWarnings() {
  const res = await fetch(FEED, { headers: { 'User-Agent': 'irish-weather-site' } });
  if (!res.ok) throw new Error(`Met Éireann warnings HTTP ${res.status}`);
  return normalise(await res.json());
}

module.exports = { fetchWarnings, normalise };
