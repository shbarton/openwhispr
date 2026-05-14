export function getInitials(displayName: string | null, email: string): string {
  if (displayName) return displayName.charAt(0).toUpperCase();
  return email.charAt(0).toUpperCase();
}

export function getInitialColor(email: string): string {
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = email.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash) % 360;
  return `hsl(${h}, 45%, 65%)`;
}
