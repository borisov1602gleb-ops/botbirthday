const cron = require('node-cron');
const db = require('./db');
const { todayInTZ, addDays, isoDate, formatDate } = require('./dates');
const { randomGreeting } = require('./greetings');

const TZ = process.env.TZ || 'Europe/Moscow';
const REMIND_DAYS_BEFORE = Number(process.env.REMIND_DAYS_BEFORE || 5);

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function pluralDays(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'дня';
  return 'дней';
}

function buildMentions(members) {
  if (members.length === 0) return null;
  return members
    .map((m) => `<a href="tg://user?id=${m.user_id}">${escapeHtml(m.first_name || 'участник')}</a>`)
    .join(' ');
}

async function checkAndSendReminders(bot) {
  const today = todayInTZ(TZ);
  const reminderDate = addDays(today, REMIND_DAYS_BEFORE);
  const sentOn = isoDate(today);

  for (const chatId of db.getAllChats()) {
    const birthdays = db.listBirthdays(chatId);
    const overrides = db.getGreetingOverrides(chatId);
    const mentions = buildMentions(db.listChatMembers(chatId));

    for (const b of birthdays) {
      const isToday = b.day === today.day && b.month === today.month;
      const isReminderDay = b.day === reminderDate.day && b.month === reminderDate.month;

      if (isToday && !db.wasReminderSent(b.id, 'today', sentOn)) {
        await bot.telegram.sendMessage(chatId, randomGreeting(b.name, null, overrides));
        if (mentions) {
          await bot.telegram.sendMessage(chatId, mentions, { parse_mode: 'HTML' });
        }
        db.markReminderSent(chatId, b.id, 'today', sentOn);
      }

      if (isReminderDay && !db.wasReminderSent(b.id, 'soon', sentOn)) {
        await bot.telegram.sendMessage(
          chatId,
          `📅 Через ${REMIND_DAYS_BEFORE} ${pluralDays(REMIND_DAYS_BEFORE)} (${formatDate(b.day, b.month)}) день рождения у ${b.name}.`
        );
        if (mentions) {
          await bot.telegram.sendMessage(chatId, mentions, { parse_mode: 'HTML' });
        }
        db.markReminderSent(chatId, b.id, 'soon', sentOn);
      }
    }
  }
}

function startScheduler(bot) {
  const reminderTime = process.env.REMINDER_TIME || '09:00';
  const [hour, minute] = reminderTime.split(':').map(Number);

  cron.schedule(`${minute} ${hour} * * *`, () => {
    checkAndSendReminders(bot).catch((err) =>
      console.error('Ошибка при отправке напоминаний:', err)
    );
  }, { timezone: TZ });

  console.log(`Планировщик запущен: проверка ДР ежедневно в ${reminderTime} (${TZ})`);
}

module.exports = { startScheduler, checkAndSendReminders };
