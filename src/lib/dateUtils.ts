/**
 * Formats a date in WhatsApp-style format Returns empty string for today, "Yesterday" for yesterday, day name for dates
 * within the last week, and full date for older dates
 */
const getLocalYYYYMMDD = (d: Date): string => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseDateKey = (dateKey: string): Date | null => {
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const parsed = new Date(year, month, day);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const parseTimestamp = (timestamp: string | Date | null | undefined): Date | null => {
  if (!timestamp) return null;

  if (timestamp instanceof Date) {
    return Number.isNaN(timestamp.getTime()) ? null : timestamp;
  }

  const raw = String(timestamp).trim();
  if (!raw) return null;

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  // Fallback for "YYYY-MM-DD HH:mm:ss" style values.
  const normalized = raw.includes(' ') ? raw.replace(' ', 'T') : raw;
  const fallback = new Date(normalized);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
};

export const getLocalDateKeyFromTimestamp = (timestamp: string | Date | null | undefined): string => {
  const parsed = parseTimestamp(timestamp);
  if (!parsed) return 'unknown';
  return getLocalYYYYMMDD(parsed);
};

export function formatWhatsAppStyle(dateKey: string, now: Date = new Date()): string {
  if (dateKey === 'unknown') return 'Unknown Date';

  try {
    const localTodayKey = getLocalYYYYMMDD(now);

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const localYesterdayKey = getLocalYYYYMMDD(yesterday);

    if (dateKey === localTodayKey) {
      // Don't show header for today
      return '';
    } else if (dateKey === localYesterdayKey) {
      return 'Yesterday';
    } else {
      const msgDate = parseDateKey(dateKey);
      if (!msgDate) return 'Unknown Date';

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(now.getDate() - 7);
      sevenDaysAgo.setHours(0, 0, 0, 0);
      if (msgDate > sevenDaysAgo) {
        // Show day name for dates within the last week
        const daysOfWeek = [
          'Sunday',
          'Monday',
          'Tuesday',
          'Wednesday',
          'Thursday',
          'Friday',
          'Saturday',
        ];
        return daysOfWeek[msgDate.getDay()];
      } else {
        // For older messages (sevenDaysAgo or older), show full date
        return msgDate.toLocaleDateString('en-US', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        });
      }
    }
  } catch (error) {
    console.error('Error formatting date:', error, 'DateKey:', dateKey);
    return 'Invalid Date';
  }
}

/**
 * Creates a timestamp string in ISO format with local timezone offset Format: YYYY-MM-DDThh:mm:ss.mmmZ±hh:mm Example:
 * 2025-05-27T22:23:39.849+05:30
 */
export function createLocalTimestamp(date?: Date): string {
  const now = date || new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const milliseconds = String(now.getMilliseconds()).padStart(3, '0');

  // Get timezone offset in hours and minutes
  const offset = -now.getTimezoneOffset();
  const offsetHours = Math.floor(Math.abs(offset) / 60);
  const offsetMinutes = Math.abs(offset) % 60;
  const offsetSign = offset >= 0 ? '+' : '-';

  // Format the timestamp
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}${offsetSign}${String(
    offsetHours,
  ).padStart(2, '0')}:${String(offsetMinutes).padStart(2, '0')}`;
}

export const formatTime = (timestamp: string | Date): string => {
  try {
    const date = parseTimestamp(timestamp);
    if (!date) return '';

    const hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const formattedHours = hours % 12 || 12; // Handle midnight
    const formattedMinutes = minutes < 10 ? `0${minutes}` : minutes;
    return `${formattedHours}:${formattedMinutes} ${ampm}`;
  } catch {
    return '';
  }
};
