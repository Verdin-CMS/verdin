/** First day of the week: 0 = Sunday … 6 = Saturday (the calendar's convention). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Regions whose week starts on Sunday or Saturday, for browsers without `getWeekInfo`. */
const SUNDAY = new Set([
  'AG',
  'AS',
  'BD',
  'BR',
  'BS',
  'BT',
  'BW',
  'BZ',
  'CA',
  'CN',
  'CO',
  'DM',
  'DO',
  'ET',
  'GT',
  'GU',
  'HK',
  'HN',
  'ID',
  'IL',
  'IN',
  'JM',
  'JP',
  'KE',
  'KH',
  'KR',
  'LA',
  'MH',
  'MM',
  'MO',
  'MT',
  'MX',
  'MZ',
  'NI',
  'NP',
  'PA',
  'PE',
  'PH',
  'PK',
  'PR',
  'PT',
  'PY',
  'SA',
  'SG',
  'SV',
  'TH',
  'TT',
  'TW',
  'UM',
  'US',
  'VE',
  'VI',
  'WS',
  'YE',
  'ZA',
  'ZW',
]);
const SATURDAY = new Set([
  'AE',
  'AF',
  'BH',
  'DJ',
  'DZ',
  'EG',
  'IQ',
  'IR',
  'JO',
  'KW',
  'LY',
  'OM',
  'QA',
  'SD',
  'SY',
]);

interface WeekInfo {
  firstDay: number; // 1 = Monday … 7 = Sunday
}

/** The first day of the week in `tag`'s region (e.g. `en-US` → Sunday, `en-GB` → Monday). */
export function firstDayOfWeek(tag: string): Weekday {
  let locale: Intl.Locale;
  try {
    locale = new Intl.Locale(tag);
  } catch {
    return 1;
  }
  const withInfo = locale as Intl.Locale & { getWeekInfo?: () => WeekInfo; weekInfo?: WeekInfo };
  const info = withInfo.getWeekInfo?.() ?? withInfo.weekInfo;
  if (info?.firstDay) return (info.firstDay % 7) as Weekday;
  const region = locale.maximize().region ?? '';
  if (SUNDAY.has(region)) return 0;
  if (SATURDAY.has(region)) return 6;
  return 1;
}
