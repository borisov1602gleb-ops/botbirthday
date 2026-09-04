require('dotenv').config();
const { Telegraf } = require('telegraf');
const db = require('./db');
const { parseDate, formatDate, todayInTZ, daysUntil, nextOccurrenceYear, age } = require('./dates');

function ageLabel(today, b) {
  const turningYear = nextOccurrenceYear(today, b);
  const years = age(b.year, turningYear);
  if (!years) return '';
  const jubilee = years % 5 === 0 ? ', юбилей 🎊' : '';
  return `, исполнится ${years}${jubilee}`;
}
const { startScheduler, checkAndSendReminders } = require('./scheduler');
const { TEMPLATES } = require('./greetings');

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('Не задан BOT_TOKEN. Скопируйте .env.example в .env и укажите токен бота.');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

const HELP_TEXT = `Я напоминаю о днях рождения сотрудников: за ${process.env.REMIND_DAYS_BEFORE || 5} дней и в сам день.

Команды:
/add Имя Фамилия ДД.ММ.ГГГГ — добавить сотрудника (год можно не указывать: ДД.ММ)
/import — добавить сразу несколько (каждый с новой строки после команды)
/list — список всех сохранённых дней рождения
/remove ID — удалить запись (ID смотрите в /list)
/today — у кого сегодня день рождения
/greetings — посмотреть тексты поздравлений (в день ДР бот выбирает один случайно)
/setgreeting НОМЕР текст — изменить текст поздравления под этим номером
/resetgreeting НОМЕР — вернуть исходный текст поздравления
/members — кого бот сейчас упомянёт вместе с напоминанием
/help — эта справка

Добавляйте бота в общий чат команды — напоминания будут приходить туда же.
Чтобы напоминания упоминали всех участников чата, у бота должен быть выключен
режим приватности (Group Privacy) в настройках @BotFather.`;

bot.use((ctx, next) => {
  if (ctx.from && !ctx.from.is_bot && ctx.chat && ctx.chat.type !== 'private') {
    db.upsertChatMember(ctx.chat.id, ctx.from.id, ctx.from.first_name, ctx.from.username);
  }
  return next();
});

bot.start((ctx) => ctx.reply(HELP_TEXT));
bot.help((ctx) => ctx.reply(HELP_TEXT));

// Разбирает строку "Имя Фамилия ДД.ММ.ГГГГ" -> { name, parsed } либо { error }.
function parseNameAndDate(line) {
  const tokens = line.trim().split(/\s+/);
  if (tokens.length < 2) return { error: 'слишком короткая строка' };

  const lastToken = tokens[tokens.length - 1];
  const parsed = parseDate(lastToken);
  if (!parsed) return { error: 'не распознана дата (нужно ДД.ММ или ДД.ММ.ГГГГ последним значением)' };

  const name = tokens.slice(0, -1).join(' ').trim();
  if (!name) return { error: 'не указано имя' };

  return { name, parsed };
}

bot.command('add', (ctx) => {
  const text = ctx.message.text.replace(/^\/add(@\w+)?\s*/, '').trim();
  if (!text) {
    return ctx.reply('Формат: /add Имя Фамилия ДД.ММ.ГГГГ\nПример: /add Иван Петров 15.03.1990');
  }

  const result = parseNameAndDate(text);
  if (result.error) {
    return ctx.reply(
      `Не удалось разобрать: ${result.error}.\nПример: /add Иван Петров 15.03.1990`
    );
  }

  const { name, parsed } = result;
  const id = db.addBirthday(ctx.chat.id, name, parsed.day, parsed.month, parsed.year);
  ctx.reply(
    `Добавлено: ${name} — ${formatDate(parsed.day, parsed.month, parsed.year)} (ID ${id})`
  );
});

bot.command('import', (ctx) => {
  const text = ctx.message.text.replace(/^\/import(@\w+)?\s*/, '');
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  if (lines.length === 0) {
    return ctx.reply(
      'Пришлите список — каждый сотрудник с новой строки, дата последним значением:\n\n' +
        '/import\nИван Иванов 15.03.1990\nМария Петрова 22.07\nПётр Сидоров 01.01.1985'
    );
  }

  const added = [];
  const errors = [];

  for (const line of lines) {
    const result = parseNameAndDate(line);
    if (result.error) {
      errors.push(`«${line}» — ${result.error}`);
      continue;
    }
    const { name, parsed } = result;
    db.addBirthday(ctx.chat.id, name, parsed.day, parsed.month, parsed.year);
    added.push(`${name} — ${formatDate(parsed.day, parsed.month, parsed.year)}`);
  }

  let reply = '';
  if (added.length > 0) {
    reply += `Добавлено (${added.length}):\n${added.join('\n')}`;
  }
  if (errors.length > 0) {
    reply += `${reply ? '\n\n' : ''}Не удалось разобрать (${errors.length}):\n${errors.join('\n')}`;
  }
  ctx.reply(reply);
});

bot.command('list', (ctx) => {
  const birthdays = db.listBirthdays(ctx.chat.id);
  if (birthdays.length === 0) {
    return ctx.reply('Список пуст. Добавьте сотрудника командой /add.');
  }

  const today = todayInTZ(process.env.TZ || 'Europe/Moscow');
  const sorted = [...birthdays].sort(
    (a, b) => daysUntil(today, a) - daysUntil(today, b)
  );

  const lines = sorted.map((b) => {
    const days = daysUntil(today, b);
    const daysText = days === 0 ? 'сегодня!' : `через ${days} дн.`;
    return `#${b.id} — ${b.name} — ${formatDate(b.day, b.month, b.year)} (${daysText}${ageLabel(today, b)})`;
  });
  ctx.reply(lines.join('\n'));
});

bot.command('remove', (ctx) => {
  const arg = ctx.message.text.replace(/^\/remove(@\w+)?\s*/, '').trim();
  const id = Number(arg);
  if (!arg || Number.isNaN(id)) {
    return ctx.reply('Формат: /remove ID (номер записи из /list)');
  }

  const removed = db.removeBirthday(ctx.chat.id, id);
  ctx.reply(removed ? `Запись #${id} удалена.` : `Запись #${id} не найдена.`);
});

bot.command('today', (ctx) => {
  const today = todayInTZ(process.env.TZ || 'Europe/Moscow');
  const matches = db
    .listBirthdays(ctx.chat.id)
    .filter((b) => b.day === today.day && b.month === today.month);

  if (matches.length === 0) {
    return ctx.reply('Сегодня дней рождения нет.');
  }

  const lines = matches.map((b) => `${b.name}${ageLabel(today, b)}`);
  ctx.reply('Сегодня день рождения у: ' + lines.join(', '));
});

bot.command('test', async (ctx) => {
  await ctx.reply('Запускаю проверку напоминаний прямо сейчас (не жду 09:00)...');
  await checkAndSendReminders(bot);
  await ctx.reply(
    'Готово. Если выше ничего не появилось — значит ни у кого в /list нет дня рождения сегодня или через 3 дня (с сегодняшним годом это не связано, проверяются только число и месяц).'
  );
});

bot.command('greetings', (ctx) => {
  const overrides = db.getGreetingOverrides(ctx.chat.id);
  const lines = TEMPLATES.map((t, i) => {
    const text = overrides[i] || t;
    const marker = overrides[i] ? ' (изменено)' : '';
    return `${i + 1}${marker}: ${text}`;
  });
  ctx.reply(
    'Тексты поздравлений на день рождения (бот в день ДР выбирает один случайно):\n\n' +
      lines.join('\n\n') +
      '\n\nИзменить: /setgreeting НОМЕР текст (используйте {name} для имени, {age} — для возраста)\nВернуть исходный: /resetgreeting НОМЕР'
  );
});

bot.command('setgreeting', (ctx) => {
  const text = ctx.message.text.replace(/^\/setgreeting(@\w+)?\s*/, '').trim();
  const match = /^(\d{1,2})\s+([\s\S]+)$/.exec(text);

  if (!match) {
    return ctx.reply(
      'Формат: /setgreeting НОМЕР текст\nПример: /setgreeting 3 Поздравляем с днём рождения, {name}! Желаем всего наилучшего!'
    );
  }

  const idx = Number(match[1]) - 1;
  if (idx < 0 || idx >= TEMPLATES.length) {
    return ctx.reply(`Номер должен быть от 1 до ${TEMPLATES.length}. Список: /greetings`);
  }

  const newText = match[2].trim();
  if (!newText.includes('{name}')) {
    return ctx.reply('В тексте обязательно должно быть {name} — туда подставится имя сотрудника.');
  }

  db.setGreetingOverride(ctx.chat.id, idx, newText);
  ctx.reply(`Поздравление №${idx + 1} обновлено. Посмотреть все: /greetings`);
});

bot.command('resetgreeting', (ctx) => {
  const arg = ctx.message.text.replace(/^\/resetgreeting(@\w+)?\s*/, '').trim();
  const idx = Number(arg) - 1;

  if (!arg || Number.isNaN(idx) || idx < 0 || idx >= TEMPLATES.length) {
    return ctx.reply(`Формат: /resetgreeting НОМЕР (от 1 до ${TEMPLATES.length})`);
  }

  const removed = db.resetGreetingOverride(ctx.chat.id, idx);
  ctx.reply(
    removed
      ? `Поздравление №${idx + 1} возвращено к исходному тексту.`
      : `Поздравление №${idx + 1} не было изменено.`
  );
});

bot.command('members', (ctx) => {
  const members = db.listChatMembers(ctx.chat.id);
  if (members.length === 0) {
    return ctx.reply(
      'Пока никого не отследил — участники добавляются в список автоматически, когда пишут в этом чате. Если список долго пустой, проверьте, что у бота выключен режим приватности (Group Privacy) в @BotFather, и что бот заново добавлен в чат после этой настройки.'
    );
  }
  const names = members.map((m) => (m.username ? `@${m.username}` : m.first_name || 'без имени'));
  ctx.reply(`Вместе с напоминанием будут упомянуты (${members.length}): ${names.join(', ')}`);
});

const BOT_COMMANDS = [
  { command: 'add', description: 'Добавить сотрудника: Имя Фамилия ДД.ММ.ГГГГ' },
  { command: 'import', description: 'Добавить сразу несколько (список с новой строки)' },
  { command: 'list', description: 'Показать все сохранённые дни рождения' },
  { command: 'remove', description: 'Удалить запись по ID (см. /list)' },
  { command: 'today', description: 'У кого сегодня день рождения' },
  { command: 'greetings', description: 'Показать тексты поздравлений' },
  { command: 'setgreeting', description: 'Изменить текст поздравления по номеру' },
  { command: 'resetgreeting', description: 'Вернуть исходный текст поздравления' },
  { command: 'members', description: 'Кого бот упомянёт вместе с напоминанием' },
  { command: 'test', description: 'Проверить напоминания прямо сейчас' },
  { command: 'help', description: 'Справка по командам' },
];

bot.launch().then(() => {
  console.log('Бот запущен.');
  bot.telegram.setMyCommands(BOT_COMMANDS);
  startScheduler(bot);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

module.exports = { bot, checkAndSendReminders };
