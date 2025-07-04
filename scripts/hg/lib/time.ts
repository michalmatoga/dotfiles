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

export function hoursToHms(hrs: number): string {
  let sign = "";
  if (hrs < 0) {
    sign = "-";
  }
  const hours = Math.abs(hrs);
  const h = Math.floor(hours);
  const m = Math.floor((hours - h) * 60);
  const s = 0;

  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");

  return `${sign}${hh}:${mm}:${ss}`;
}

export function hmsToHours(hms: string): number {
  if (!hms) {
    return 0;
  }
  const [hours, minutes, seconds = 0] = hms.split(":").map(Number);
  return hours + minutes / 60 + seconds / 3600;
}
