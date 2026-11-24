const MESSAGES = {
  "Название встречи: от 1 до 100 символов.": "Enter a workshop title between 1 and 100 characters.",
  "Добавьте от 1 до 100 ролей, каждая до 150 символов.": "Add between 1 and 100 role titles, each up to 150 characters.",
  "Не удалось выделить код сессии. Повторите запрос.": "Unable to create a workshop. Please try again.",
  "Сессия не найдена или ссылка неполная.": "Workshop not found or the invitation link is incomplete.",
  "Сессия не найдена.": "Workshop not found.",
  "Приглашение недействительно.": "This invitation is not valid.",
  "Эта сессия завершена.": "This workshop has finished.",
  "Введите имя длиной от 1 до 60 символов.": "Enter a name between 1 and 60 characters.",
  "Достигнут лимит в 200 участников.": "This workshop has reached its limit of 200 participants.",
  "Войдите в сессию, чтобы отправить оценки.": "Join the workshop to submit scores.",
  "Голосование изменилось или уже закрыто.": "Scoring has changed or closed. Refresh the page.",
  "Поставьте оценку от 1 до 5 по всем шести критериям.": "Score all six dimensions from 1 to 5.",
  "Ваши оценки уже приняты.": "Your scores have already been submitted.",
  "Управление доступно только ведущему.": "Only the facilitator can control this workshop.",
  "Сессия завершена.": "This workshop has finished.",
  "Роль не найдена.": "Role not found.",
  "Сначала закройте текущее голосование.": "Close the current scoring round first.",
  "Выберите ещё не оценённую роль.": "Select a role that has not yet been scored.",
  "Голосование не открыто.": "Scoring is not open.",
  "Неизвестное действие.": "Unknown action.",
  "Название до 150 символов; не более 100 ролей.": "Use a role title up to 150 characters; maximum 100 roles.",
  "Обновите страницу и войдите заново.": "Refresh the page and join again.",
  "Смените имя и войдите заново.": "Change your name and join again."
};
export function errorMessage(value) {
  const message = typeof value === 'string' ? value : '';
  if (MESSAGES[message]) return MESSAGES[message];
  return /[А-Яа-яЁё]/.test(message) ? 'Unable to complete the request. Please refresh the page and try again.' : message || 'Unable to complete the request.';
}
