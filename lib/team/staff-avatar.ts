type StaffAvatarSeed = {
  id: string;
  email?: string;
  fullName?: string;
};

/** Dicebear avatar URL — same style as the Team page staff cards. */
export function staffAvatarUrl(member: StaffAvatarSeed): string {
  const seed = encodeURIComponent(
    member.id || member.email || member.fullName || "staff",
  );
  return `https://api.dicebear.com/9.x/notionists/svg?seed=${seed}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`;
}
