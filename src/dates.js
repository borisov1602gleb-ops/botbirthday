const MONTH_NAMES = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

// Принимает "ДД.ММ" или "ДД.ММ.ГГГГ", возвращает { day, month, year } либо null.
function parseDate(text) {
  const match = /^(\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{4}))?$/.exec(text.trim());
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = match[3] ? Number(match[3]) : null;

  if (month < 1 || month > 12) return null;
  const daysInMonth = new Date(year || 2000, month, 0).getDate();
  if (day < 1 || day > daysInMonth) return null;

  return { day, month, year };
}

function formatDate(day, month, year) {
  const base = `${day} ${MONTH_NAMES[month - 1]}`;
  return year ? `${base} ${year}` : base;
}

// Текущая дата в заданном часовом поясе как { day, month, year }.
function todayInTZ(timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(new Date());

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return { day: Number(map.day), month: Number(map.month), year: Number(map.year) };
}

// Дата через N дней от заданной { day, month, year }, с учётом года.
function addDays({ day, month, year }, n) {
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + n);
  return { day: d.getUTCDate(), month: d.getUTCMonth() + 1, year: d.getUTCFullYear() };
}

function isoDate({ day, month, year }) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function age(birthYear, currentYear) {
  if (!birthYear) return null;
  return currentYear - birthYear;
}

// Год ближайшего наступления даты { day, month } считая от today {day,month,year}.
function nextOccurrenceYear(today, target) {
  const beforeToday =
    target.month < today.month || (target.month === today.month && target.day < today.day);
  return beforeToday ? today.year + 1 : today.year;
}

// Сколько дней осталось от today {day,month,year} до ближайшего { day, month }.
function daysUntil(today, target) {
  const todayDate = new Date(Date.UTC(today.year, today.month - 1, today.day));
  const targetYear = nextOccurrenceYear(today, target);
  const targetDate = new Date(Date.UTC(targetYear, target.month - 1, target.day));
  return Math.round((targetDate - todayDate) / (1000 * 60 * 60 * 24));
}

module.exports = {
  parseDate,
  formatDate,
  todayInTZ,
  addDays,
  isoDate,
  age,
  daysUntil,
  nextOccurrenceYear,
};
