export function toHours(gtmTime: string) {
  const hoursMatch = gtmTime.match(/(\d+)h/);
  const minutesMatch = gtmTime.match(/(\d+)m/);
  const secondsMatch = gtmTime.match(/(\d+)s/);

  const hours = hoursMatch ? parseInt(hoursMatch[1], 10) : 0;
  const minutes = minutesMatch ? parseInt(minutesMatch[1], 10) : 0;
  const seconds = secondsMatch ? parseInt(secondsMatch[1], 10) : 0;

  const totalHours = hours + minutes / 60 + seconds / 3600;
  return totalHours;
}

export function dateToLocaleTimestamp(date: Date) {
  return `${new Date().toISOString().split("T")[0]} ${date.toTimeString().slice(0, 5)}`;
}
export function hoursToHms(hrs: number): string {
  let sign = "";
  if (hrs < 0) {
    sign = "-";
  }
  const hours = Math.abs(hrs);
  let h = Math.floor(hours);
  let m = Math.floor((hours - h) * 60);
  let s = Math.round((hours - h - m / 60) * 3600);
  if (s === 60) {
    s = 0;
    m += 1;
  }
  if (m === 60) {
    m = 0;
    h += 1;
  }

  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");

  return `${sign}${hh}:${mm}:${ss}`;
}

export function hoursToHm(hrs: number): string {
  return hoursToHms(hrs).slice(0, -3);
}

export function hmsToHours(hms: string): number {
  if (!hms) {
    return 0;
  }
  const [hours, minutes, seconds = 0] = hms.split(":").map(Number);
  return hours + minutes / 60 + seconds / 3600;
}

export function dateFromTime(time: string) {
  const now = new Date();
  const timeSplit = time.split(":").map((e) => Number(e));
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    timeSplit[0],
    timeSplit[1],
  );
}
