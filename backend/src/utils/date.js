const IST_TZ = 'Asia/Kolkata';

export function nowIST() {
  return new Date().toLocaleString('sv-SE', { timeZone: IST_TZ }).replace(' ', 'T');
}

export function todayIST() {
  return new Date().toLocaleDateString('en-CA', { timeZone: IST_TZ });
}

export function toDateIST(date) {
  if (!date) return todayIST();
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-CA', { timeZone: IST_TZ });
}
